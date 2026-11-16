/**
 * Photos on tasks: storage, shrinking and the 30-day purge (owner-approved
 * 2026-11-15).
 *
 * - Each photo is stored once, as a file named by its SHA-256 fingerprint,
 *   under PHOTO_DIR/<owner id>/. The workspace only holds references, so the
 *   workspace backups saved before every change never copy a photo.
 * - Every photo over 1 MB or 2048 px is made smaller, never rejected. The phone
 *   tries first; this server always re-encodes (and converts HEIC with
 *   heif-convert when sharp can't read it).
 * - Location off (the default): the file is written with no metadata at all,
 *   then checked to carry none before it is saved.
 * - A photo no longer in the workspace is kept for 30 days, then removed. It
 *   is kept longer only while one of the kept workspace backups still points
 *   at it, so a restore never comes back with a blank. Removed fingerprints
 *   are written to PHOTO_DIR/purged.log so the nightly photo backup removes
 *   them too (scripts/backup-photos.sh).
 */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import express, { type Express, type Request, type Response } from "express";
import sharp from "sharp";
import {
  HASH_PATTERN,
  PHOTO_KEEP_DAYS,
  PHOTO_LIMIT_BYTES,
  PHOTO_MAX_SIDE,
  photoHashes,
} from "../../client/src/domain/photos";
import type { Workspace } from "../../client/src/domain/types";
import { sdk } from "../_core/sdk";

const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
const THUMB_SIDE = 360;
const DAY_MS = 24 * 60 * 60 * 1000;
/** An Undo within this time removes the file straight away (it was never kept). */
const UNDO_WINDOW_MS = 15 * 60 * 1000;

export function photoDir(): string {
  return process.env.PHOTO_DIR || path.resolve("photos");
}

export interface ProcessedPhoto {
  data: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  originalBytes: number;
  shrunk: boolean;
  locationRemoved: boolean;
}

export class PhotoUnreadable extends Error {}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile(command, args, { timeout: 60_000 }, error => (error ? reject(error) : resolve()))
  );
}

/** HEIC/HEIF (iPhone) photos: sharp's build can't read them, heif-convert can. */
async function convertHeic(input: Buffer): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "steadier-heic-"));
  try {
    const source = path.join(dir, "in.heic");
    const target = path.join(dir, "out.jpg");
    await fs.writeFile(source, input, { mode: 0o600 });
    await run("heif-convert", ["-q", "95", source, target]);
    return await fs.readFile(target);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function readable(input: Buffer): Promise<Buffer> {
  try {
    // Reading the header isn't enough (sharp reads HEIC headers but can't
    // decode them): decode a tiny copy to be sure.
    await sharp(input).resize(8, 8, { fit: "inside" }).raw().toBuffer();
    return input;
  } catch {
    /* try HEIC below */
  }
  try {
    const converted = await convertHeic(input);
    await sharp(converted).metadata();
    return converted;
  } catch {
    throw new PhotoUnreadable("This file isn't a photo Steadier can read.");
  }
}

/**
 * Shrink until it fits: longest side 2048 px first, quality stepping down,
 * then smaller sides. It always ends with a photo; it never rejects.
 */
export async function processPhoto(input: Buffer, keepLocation: boolean): Promise<ProcessedPhoto> {
  const source = await readable(input);
  const sides = [PHOTO_MAX_SIDE, 1600, 1280, 1024, 800, 640];
  const qualities = [84, 74, 64, 54];
  let best: { data: Buffer; info: sharp.OutputInfo } | null = null;
  outer: for (const side of sides) {
    for (const quality of qualities) {
      let pipeline = sharp(source, { failOn: "none" })
        .rotate()
        .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true });
      if (keepLocation) pipeline = pipeline.keepExif();
      const result = await pipeline.toBuffer({ resolveWithObject: true });
      best = result;
      if (result.data.length <= PHOTO_LIMIT_BYTES) break outer;
    }
  }
  if (!best) throw new PhotoUnreadable("This file isn't a photo Steadier can read.");
  const data = best.data;
  if (!keepLocation) {
    const meta = await sharp(data).metadata();
    if (meta.exif || meta.xmp || meta.iptc) throw new Error("Photo still had hidden details after removal.");
  }
  const thumb = await sharp(data)
    .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 70, mozjpeg: true })
    .toBuffer();
  const originalMeta = await sharp(source).metadata().catch(() => null);
  const originalSide = Math.max(originalMeta?.width ?? 0, originalMeta?.height ?? 0);
  return {
    data,
    thumb,
    width: best.info.width,
    height: best.info.height,
    originalBytes: input.length,
    shrunk: input.length > PHOTO_LIMIT_BYTES || originalSide > PHOTO_MAX_SIDE,
    locationRemoved: !keepLocation,
  };
}

// ---- Storage ----

function ownerDir(dir: string, ownerId: number): string {
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) throw new Error("Bad owner.");
  return path.join(dir, String(ownerId));
}

export function photoPath(dir: string, ownerId: number, hash: string, thumb = false): string {
  if (!HASH_PATTERN.test(hash)) throw new Error("Bad fingerprint.");
  return path.join(ownerDir(dir, ownerId), thumb ? `${hash}.thumb.jpg` : `${hash}.jpg`);
}

async function writeOnce(file: string, data: Buffer): Promise<void> {
  try {
    await fs.access(file);
    return; // Same fingerprint: already stored once.
  } catch {
    /* new file */
  }
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, data, { mode: 0o644 });
  await fs.rename(temp, file);
}

export async function storePhoto(dir: string, ownerId: number, photo: ProcessedPhoto): Promise<string> {
  const hash = createHash("sha256").update(photo.data).digest("hex");
  await fs.mkdir(ownerDir(dir, ownerId), { recursive: true, mode: 0o755 });
  await writeOnce(photoPath(dir, ownerId, hash), photo.data);
  await writeOnce(photoPath(dir, ownerId, hash, true), photo.thumb);
  return hash;
}

async function removeFiles(dir: string, ownerId: number, hash: string): Promise<void> {
  await fs.rm(photoPath(dir, ownerId, hash), { force: true });
  await fs.rm(photoPath(dir, ownerId, hash, true), { force: true });
}

async function appendPurged(dir: string, ownerId: number, hashes: string[], at: Date): Promise<void> {
  if (!hashes.length) return;
  const lines = hashes.map(hash => `${at.toISOString()} ${ownerId}/${hash}.jpg\n`).join("");
  await fs.appendFile(path.join(dir, "purged.log"), lines, { mode: 0o644 });
}

// ---- Purge ----

export interface PhotoReferenceSource {
  /** Owner IDs with a workspace. */
  current(ownerId: number): Promise<Workspace | null>;
  /** Every kept copy that a restore could bring back. */
  kept(ownerId: number): Promise<Workspace[]>;
}

interface PurgeState {
  /** Fingerprint → when it was first seen missing from the workspace. */
  gone: Record<string, string>;
}

async function readState(file: string): Promise<PurgeState> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    if (parsed && typeof parsed.gone === "object" && parsed.gone) return { gone: parsed.gone };
  } catch {
    /* none yet */
  }
  return { gone: {} };
}

/**
 * Run once a day. Returns the fingerprints removed per owner. A photo is
 * removed only when it has been out of the workspace for 30 days AND no kept
 * backup still refers to it.
 */
export async function purgePhotos(
  dir: string,
  source: PhotoReferenceSource,
  now: Date = new Date()
): Promise<Record<number, string[]>> {
  const removed: Record<number, string[]> = {};
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return removed;
  }
  for (const entry of entries) {
    if (!/^[1-9]\d*$/.test(entry)) continue;
    const ownerId = Number(entry);
    const folder = ownerDir(dir, ownerId);
    const files = (await fs.readdir(folder)).filter(name => /^[0-9a-f]{64}\.jpg$/.test(name));
    const stored = files.map(name => name.slice(0, 64));
    const current = await source.current(ownerId);
    // If the workspace can't be read, purge nothing for this owner.
    if (!current) continue;
    const live = photoHashes(current);
    const stateFile = path.join(folder, ".purge-state.json");
    const state = await readState(stateFile);
    const next: PurgeState = { gone: {} };
    const due: string[] = [];
    for (const hash of stored) {
      if (live.has(hash)) continue;
      const since = state.gone[hash] ?? now.toISOString();
      next.gone[hash] = since;
      if (now.getTime() - Date.parse(since) >= PHOTO_KEEP_DAYS * DAY_MS) due.push(hash);
    }
    let purged: string[] = [];
    if (due.length) {
      const keptHashes = new Set<string>();
      for (const workspace of await source.kept(ownerId)) for (const hash of photoHashes(workspace)) keptHashes.add(hash);
      purged = due.filter(hash => !keptHashes.has(hash));
      for (const hash of purged) {
        await removeFiles(dir, ownerId, hash);
        delete next.gone[hash];
      }
      await appendPurged(dir, ownerId, purged, now);
    }
    await fs.writeFile(stateFile, JSON.stringify(next), { mode: 0o644 });
    if (purged.length) removed[ownerId] = purged;
  }
  return removed;
}

// ---- Event log ----
// One line per upload attempt (and any failure the app reports), kept in the
// photos folder so it survives a redeploy. Never holds photo contents.

const EVENTS_MAX_BYTES = 2 * 1024 * 1024;

export async function photoEvent(dir: string, fields: Record<string, string | number | boolean | null>): Promise<void> {
  const line = `${new Date().toISOString()} ${Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, "_").slice(0, 200)}`)
    .join(" ")}\n`;
  console.log(`[Photos] ${line.trim()}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "photo-events.log");
    const size = await fs.stat(file).then(st => st.size).catch(() => 0);
    if (size > EVENTS_MAX_BYTES) await fs.rename(file, `${file}.1`).catch(() => undefined);
    await fs.appendFile(file, line, { mode: 0o644 });
  } catch {
    /* logging must never block a photo */
  }
}

function signInSeen(request: Request): string {
  const cookie = request.headers.cookie ?? "";
  if (/(?:^|;\s*)webdev_app_session=/.test(cookie)) return "cookie";
  if (request.headers.authorization) return "bearer";
  return cookie ? "other-cookies-only" : "none";
}

// ---- Routes ----

export interface PhotoRouteDeps {
  dir?: string;
  userId?: (request: Request) => Promise<number | null>;
  /** Fingerprints the owner's current workspace refers to (for Undo). */
  currentHashes?: (ownerId: number) => Promise<Set<string> | null>;
}

async function signedInUserId(request: Request): Promise<number | null> {
  try {
    const user = await sdk.authenticateRequest(request);
    return user.isCron || !Number.isSafeInteger(user.id) || user.id <= 0 ? null : user.id;
  } catch {
    return null;
  }
}

function ownerHeaderMatches(request: Request, userId: number): boolean {
  const header = request.get("x-steadier-owner");
  return !header || header === String(userId);
}

export function registerPhotoRoutes(app: Express, deps: PhotoRouteDeps = {}): void {
  const dir = () => deps.dir ?? photoDir();
  const userIdFor = deps.userId ?? signedInUserId;
  const send = (response: Response, status: number, body: unknown) =>
    response.status(status).set("Cache-Control", "private, no-store").json(body);

  app.post(
    "/api/steadier/photos",
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    async (request, response) => {
      const userId = await userIdFor(request);
      const body = request.body;
      const base = {
        event: "upload",
        user: userId ?? "none",
        signin: signInSeen(request),
        bytes: Buffer.isBuffer(body) ? body.length : 0,
        type: request.get("content-type") ?? "none",
        agent: (request.get("user-agent") ?? "").includes("Android") ? "android" : "other",
      };
      if (!userId) {
        void photoEvent(dir(), { ...base, status: 401 });
        return send(response, 401, { error: "Steadier couldn't see your sign-in. Close and reopen the app, then try again." });
      }
      if (request.get("x-steadier-request") !== "1" || !ownerHeaderMatches(request, userId)) {
        void photoEvent(dir(), { ...base, status: 403 });
        return send(response, 403, { error: "This upload wasn't allowed." });
      }
      if (!Buffer.isBuffer(body) || body.length === 0) {
        void photoEvent(dir(), { ...base, status: 400 });
        return send(response, 400, { error: "No photo was sent." });
      }
      const keepLocation = request.query.location === "keep";
      try {
        const processed = await processPhoto(body, keepLocation);
        const hash = await storePhoto(dir(), userId, processed);
        void photoEvent(dir(), { ...base, status: 201, stored: processed.data.length, hash: hash.slice(0, 12) });
        return send(response, 201, {
          hash,
          width: processed.width,
          height: processed.height,
          bytes: processed.data.length,
          originalBytes: processed.originalBytes,
          shrunk: processed.shrunk,
          locationRemoved: processed.locationRemoved,
        });
      } catch (error) {
        void photoEvent(dir(), { ...base, status: error instanceof PhotoUnreadable ? 422 : 500, error: error instanceof Error ? error.message : "unknown" });
        if (error instanceof PhotoUnreadable) return send(response, 422, { error: error.message });
        return send(response, 500, { error: "The photo couldn't be saved. Try again." });
      }
    }
  );

  /** The app reports a photo that failed before or after the upload. */
  app.post("/api/steadier/photos-trace", async (request, response) => {
    const userId = await userIdFor(request);
    const body = (typeof request.body === "object" && request.body) || {};
    const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string).slice(0, 200) : "none");
    await photoEvent(dir(), {
      event: "app-report",
      user: userId ?? "none",
      signin: signInSeen(request),
      stage: text("stage"),
      message: text("message"),
      agent: (request.get("user-agent") ?? "").includes("Android") ? "android" : "other",
    });
    response.status(204).set("Cache-Control", "no-store").end();
  });

  app.get("/api/steadier/photos/:file", async (request, response) => {
    const userId = await userIdFor(request);
    if (!userId) return send(response, 401, { error: "Please sign in to Steadier first." });
    const match = /^([0-9a-f]{64})(\.thumb)?\.jpg$/.exec(request.params.file ?? "");
    if (!match) return send(response, 404, { error: "Not found." });
    const file = photoPath(dir(), userId, match[1], Boolean(match[2]));
    try {
      const data = await fs.readFile(file);
      response
        .status(200)
        // Content-addressed: the same name always means the same bytes.
        .set("Cache-Control", "private, max-age=31536000, immutable")
        .set("Content-Type", "image/jpeg")
        .set("X-Content-Type-Options", "nosniff")
        .send(data);
    } catch {
      send(response, 404, { error: "This photo is no longer stored." });
    }
  });

  /** Undo straight after adding: remove the file if nothing refers to it. */
  app.delete("/api/steadier/photos/:hash", async (request, response) => {
    const userId = await userIdFor(request);
    if (!userId) return send(response, 401, { error: "Please sign in to Steadier first." });
    if (request.get("x-steadier-request") !== "1" || !ownerHeaderMatches(request, userId))
      return send(response, 403, { error: "Not allowed." });
    const hash = request.params.hash ?? "";
    if (!HASH_PATTERN.test(hash)) return send(response, 404, { error: "Not found." });
    const file = photoPath(dir(), userId, hash);
    try {
      const stat = await fs.stat(file);
      if (Date.now() - stat.mtimeMs > UNDO_WINDOW_MS) return send(response, 409, { kept: true });
      const current = deps.currentHashes ? await deps.currentHashes(userId) : null;
      if (!current || current.has(hash)) return send(response, 409, { kept: true });
      await removeFiles(dir(), userId, hash);
      return send(response, 200, { removed: true });
    } catch {
      return send(response, 200, { removed: true });
    }
  });
}

/** Daily purge timer inside the server process. */
export function schedulePhotoPurge(source: PhotoReferenceSource, dir: string = photoDir()): void {
  const tick = () =>
    purgePhotos(dir, source)
      .then(removed => {
        const count = Object.values(removed).reduce((n, list) => n + list.length, 0);
        if (count) console.log(`Photo purge: removed ${count} photo(s) deleted over ${PHOTO_KEEP_DAYS} days ago.`);
      })
      .catch(error => console.error("Photo purge failed:", error instanceof Error ? error.message : error));
  setTimeout(tick, 5 * 60 * 1000).unref();
  setInterval(tick, DAY_MS).unref();
}
