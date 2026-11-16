import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTask } from "../../client/src/domain/engine";
import type { Workspace } from "../../client/src/domain/types";
import { PHOTO_LIMIT_BYTES } from "../../client/src/domain/photos";
import { processPhoto, purgePhotos, registerPhotoRoutes, storePhoto } from "./photos";

/** A noisy photo that compresses badly, so it starts well over 1 MB. */
async function bigPhoto(width = 4000, height = 3000, withGps = false): Promise<Buffer> {
  const noise = Buffer.alloc(width * height * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
  let image = sharp(noise, { raw: { width, height, channels: 3 } }).jpeg({ quality: 98 });
  if (withGps) {
    image = image.withExif({
      IFD0: { Make: "TestCam", Model: "Serial 1234" },
      // sharp writes the GPS IFD from these keys.
      IFD3: { GPSLatitudeRef: "S", GPSLatitude: "34/1 55/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "138/1 36/1 0/1" },
    });
  }
  return image.toBuffer();
}

function workspaceWithHashes(hashes: string[]): Workspace {
  const task = createTask({ title: "Gutter" });
  return {
    tasks: [
      {
        ...task,
        photos: hashes.map((hash, i) => ({
          id: `p${i}`,
          hash,
          addedAt: "2026-11-16T10:00:00+10:30",
          label: null,
          width: 10,
          height: 10,
          bytes: 10,
          markup: [],
        })),
      },
    ],
  } as unknown as Workspace;
}

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "photos-test-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("processPhoto", () => {
  it("always shrinks a big photo under the limit and never rejects it", async () => {
    const input = await bigPhoto();
    expect(input.length).toBeGreaterThan(PHOTO_LIMIT_BYTES);
    const out = await processPhoto(input, false);
    expect(out.data.length).toBeLessThanOrEqual(PHOTO_LIMIT_BYTES);
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(2048);
    expect(out.shrunk).toBe(true);
    expect(out.thumb.length).toBeLessThan(out.data.length);
  }, 60_000);

  it("removes location and every other hidden detail when location is off", async () => {
    const input = await bigPhoto(800, 600, true);
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await processPhoto(input, false);
    const meta = await sharp(out.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(out.data.includes(Buffer.from("TestCam"))).toBe(false);
    expect(out.locationRemoved).toBe(true);
  });

  it("keeps the photo's details when location is on", async () => {
    const input = await bigPhoto(800, 600, true);
    const out = await processPhoto(input, true);
    expect((await sharp(out.data).metadata()).exif).toBeDefined();
    expect(out.locationRemoved).toBe(false);
  });

  it("converts an iPhone HEIC photo (where heif tools are installed, as in the server image)", async () => {
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync("heif-enc", ["--version"], { stdio: "ignore" });
    } catch {
      return; // the dev container has no heif tools; the server image does
    }
    const png = path.join(dir, "in.png");
    const heic = path.join(dir, "in.heic");
    await fs.writeFile(png, await sharp(await bigPhoto(1200, 900)).png().toBuffer());
    execFileSync("heif-enc", ["-q", "60", "-o", heic, png], { stdio: "ignore" });
    const out = await processPhoto(await fs.readFile(heic), false);
    expect((await sharp(out.data).metadata()).format).toBe("jpeg");
    expect(out.width).toBe(1200);
  }, 60_000);

  it("refuses only a file that is not an image", async () => {
    await expect(processPhoto(Buffer.from("hello, not a photo"), false)).rejects.toThrow(/isn't a photo/);
  });
});

describe("storage and purge", () => {
  it("stores the same photo once", async () => {
    const out = await processPhoto(await bigPhoto(400, 300), false);
    const first = await storePhoto(dir, 7, out);
    const second = await storePhoto(dir, 7, out);
    expect(first).toBe(second);
    const files = await fs.readdir(path.join(dir, "7"));
    expect(files.filter(f => f.endsWith(".jpg")).sort()).toEqual([`${first}.jpg`, `${first}.thumb.jpg`]);
  });

  it("keeps a deleted photo 30 days, longer only while a kept backup points at it", async () => {
    const out = await processPhoto(await bigPhoto(400, 300), false);
    const hash = await storePhoto(dir, 7, out);
    let kept: Workspace[] = [workspaceWithHashes([hash])];
    const source = { current: async () => workspaceWithHashes([]), kept: async () => kept };
    const day0 = new Date("2026-11-16T00:00:00Z");
    const at = (days: number) => new Date(day0.getTime() + days * 86_400_000);

    expect(await purgePhotos(dir, source, day0)).toEqual({});
    expect(await purgePhotos(dir, source, at(29))).toEqual({});
    // Day 30, but a kept backup still refers to it: stays.
    expect(await purgePhotos(dir, source, at(30))).toEqual({});
    await fs.access(path.join(dir, "7", `${hash}.jpg`));
    // The backup rolls off: removed, and logged for the photo backup.
    kept = [];
    expect(await purgePhotos(dir, source, at(31))).toEqual({ 7: [hash] });
    await expect(fs.access(path.join(dir, "7", `${hash}.jpg`))).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, "purged.log"), "utf8")).toContain(`7/${hash}.jpg`);
  }, 30_000);

  it("restarts the 30 days if a restore brings the photo back", async () => {
    const out = await processPhoto(await bigPhoto(400, 300), false);
    const hash = await storePhoto(dir, 7, out);
    let current = workspaceWithHashes([]);
    const source = { current: async () => current, kept: async () => [] };
    const day0 = new Date("2026-11-16T00:00:00Z");
    await purgePhotos(dir, source, day0);
    current = workspaceWithHashes([hash]);
    await purgePhotos(dir, source, new Date(day0.getTime() + 10 * 86_400_000));
    current = workspaceWithHashes([]);
    await purgePhotos(dir, source, new Date(day0.getTime() + 20 * 86_400_000));
    expect(await purgePhotos(dir, source, new Date(day0.getTime() + 35 * 86_400_000))).toEqual({});
  }, 30_000);

  it("purges nothing when the workspace can't be read", async () => {
    const out = await processPhoto(await bigPhoto(400, 300), false);
    await storePhoto(dir, 7, out);
    const source = { current: async () => null, kept: async () => [] };
    expect(await purgePhotos(dir, source, new Date("2027-06-01T00:00:00Z"))).toEqual({});
  });
});

describe("photo routes", () => {
  async function serve(userId: number | null, current = new Set<string>()) {
    const app = express();
    registerPhotoRoutes(app, { dir, userId: async () => userId, currentHashes: async () => current });
    const server = app.listen(0);
    await new Promise(resolve => server.once("listening", resolve));
    const port = (server.address() as { port: number }).port;
    return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
  }

  it("uploads, serves only to the owner's folder, and undoes straight after", async () => {
    const { base, close } = await serve(7);
    try {
      const body = await bigPhoto(900, 700, true);
      const refused = await fetch(`${base}/api/steadier/photos`, { method: "POST", body });
      expect(refused.status).toBe(403);
      const up = await fetch(`${base}/api/steadier/photos`, {
        method: "POST",
        body,
        headers: { "X-Steadier-Request": "1", "X-Steadier-Owner": "7", "Content-Type": "image/jpeg" },
      });
      expect(up.status).toBe(201);
      const info = (await up.json()) as { hash: string; locationRemoved: boolean };
      expect(info.locationRemoved).toBe(true);
      const got = await fetch(`${base}/api/steadier/photos/${info.hash}.jpg`);
      expect(got.status).toBe(200);
      expect(got.headers.get("cache-control")).toContain("private");
      const thumb = await fetch(`${base}/api/steadier/photos/${info.hash}.thumb.jpg`);
      expect(thumb.status).toBe(200);
      const undo = await fetch(`${base}/api/steadier/photos/${info.hash}`, {
        method: "DELETE",
        headers: { "X-Steadier-Request": "1" },
      });
      expect(await undo.json()).toEqual({ removed: true });
      expect((await fetch(`${base}/api/steadier/photos/${info.hash}.jpg`)).status).toBe(404);
    } finally {
      close();
    }
  }, 30_000);

  it("keeps a photo on Undo if the workspace still refers to it", async () => {
    const out = await processPhoto(await bigPhoto(300, 200), false);
    const hash = await storePhoto(dir, 7, out);
    const { base, close } = await serve(7, new Set([hash]));
    try {
      const undo = await fetch(`${base}/api/steadier/photos/${hash}`, { method: "DELETE", headers: { "X-Steadier-Request": "1" } });
      expect(undo.status).toBe(409);
    } finally {
      close();
    }
  });

  it("asks for sign-in and never serves another owner's photo", async () => {
    const out = await processPhoto(await bigPhoto(300, 200), false);
    const hash = await storePhoto(dir, 7, out);
    const anon = await serve(null);
    try {
      expect((await fetch(`${anon.base}/api/steadier/photos/${hash}.jpg`)).status).toBe(401);
    } finally {
      anon.close();
    }
    const other = await serve(8);
    try {
      expect((await fetch(`${other.base}/api/steadier/photos/${hash}.jpg`)).status).toBe(404);
      expect((await fetch(`${other.base}/api/steadier/photos/..%2F7%2F${hash}.jpg`)).status).toBe(404);
    } finally {
      other.close();
    }
  });
});
