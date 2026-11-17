import express from "express";
import { describe, expect, it } from "vitest";
import { emptyWorkspace } from "./validation";
import { createTask } from "../../client/src/domain/engine";
import { adelaideToInstant, emptyTaskSchedule } from "../../client/src/domain/time";
import type { Task } from "../../client/src/domain/types";
import { parseSubscription, pushTick, registerPushRoutes, sendToOwner, type PushStore, type PushSubscriptionRecord } from "./push";

const DEVICE: PushSubscriptionRecord = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  p256dh: "B".repeat(87),
  auth: "a".repeat(22),
};

function memoryStore(devices: Record<number, PushSubscriptionRecord[]> = {}): PushStore & { sent: Set<string>; data: typeof devices } {
  const sent = new Set<string>();
  return {
    sent,
    data: devices,
    async ownersWithDevices() {
      return Object.keys(devices).map(Number).filter(id => devices[id].length);
    },
    async devices(id) {
      return devices[id] ?? [];
    },
    async save(id, sub) {
      devices[id] = [...(devices[id] ?? []).filter(d => d.endpoint !== sub.endpoint), sub];
    },
    async remove(id, endpoint) {
      devices[id] = (devices[id] ?? []).filter(d => d.endpoint !== endpoint);
    },
    async claim(id, key) {
      const k = `${id}:${key}`;
      if (sent.has(k)) return false;
      sent.add(k);
      return true;
    },
    async sentOk() {},
    async prune() {},
  };
}

describe("push notifications on the server", () => {
  it("only accepts real browser push addresses with keys", () => {
    expect(parseSubscription({ endpoint: DEVICE.endpoint, keys: { p256dh: DEVICE.p256dh, auth: DEVICE.auth } })).toEqual(DEVICE);
    expect(() => parseSubscription({ endpoint: "https://example.com/hook", keys: { p256dh: DEVICE.p256dh, auth: DEVICE.auth } })).toThrow();
    expect(() => parseSubscription({ endpoint: "http://fcm.googleapis.com/x", keys: { p256dh: DEVICE.p256dh, auth: DEVICE.auth } })).toThrow();
    expect(() => parseSubscription({ endpoint: DEVICE.endpoint, keys: {} })).toThrow();
  });

  it("sends each due reminder once, encrypted payload text only, and forgets a phone that's gone", async () => {
    const t = createTask({ title: "Site meeting", state: "ready" } as Partial<Task> & { title: string });
    const task = { ...t, schedule: { ...emptyTaskSchedule(), date: "2026-11-18", time: "11:00", minutes: 60, fixed: true, reminders: [{ id: "r1", anchor: "slot", minutesBefore: 15 }] } } as Task;
    const workspace = { ...emptyWorkspace(), tasks: [task] };
    const gone = { ...DEVICE, endpoint: "https://fcm.googleapis.com/fcm/send/gone" };
    const store = memoryStore({ 7: [DEVICE, gone] });
    const payloads: string[] = [];
    const send = async (sub: PushSubscriptionRecord, payload: string) => {
      payloads.push(payload);
      return { status: sub.endpoint === gone.endpoint ? 410 : 201 };
    };
    const now = adelaideToInstant("2026-11-18", "10:46");
    expect(await pushTick(store, send, async () => workspace, now)).toBe(1);
    expect(JSON.parse(payloads[0])).toMatchObject({ kind: "reminder", title: "Site meeting", url: "/" });
    expect(store.data[7]).toEqual([DEVICE]);
    // The next minute: already sent, so nothing goes again.
    expect(await pushTick(store, send, async () => workspace, new Date(now.getTime() + 60_000))).toBe(0);
  });

  it("Send a test goes to every phone on the account", async () => {
    const store = memoryStore({ 3: [DEVICE] });
    const result = await sendToOwner(store, async () => ({ status: 201 }), 3, "{}");
    expect(result).toEqual({ sent: 1, failed: 0 });
  });

  it("needs a signed-in owner and the request guard", async () => {
    const app = express();
    app.use(express.json());
    const store = memoryStore();
    registerPushRoutes(app, { store, send: async () => ({ status: 201 }), userId: async r => (r.get("cookie") ? 5 : null), publicKey: () => "PUB" });
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}/api/steadier/push`;
    const body = JSON.stringify({ endpoint: DEVICE.endpoint, keys: { p256dh: DEVICE.p256dh, auth: DEVICE.auth } });
    try {
      expect((await fetch(`${base}/key`)).status).toBe(200);
      expect((await fetch(`${base}/subscribe`, { method: "POST", headers: { "Content-Type": "application/json", "X-Steadier-Request": "1" }, body })).status).toBe(401);
      expect((await fetch(`${base}/subscribe`, { method: "POST", headers: { "Content-Type": "application/json", cookie: "s=1" }, body })).status).toBe(403);
      expect((await fetch(`${base}/subscribe`, { method: "POST", headers: { "Content-Type": "application/json", cookie: "s=1", "X-Steadier-Request": "1" }, body })).status).toBe(200);
      expect(store.data[5]).toEqual([DEVICE]);
      const test = await fetch(`${base}/test`, { method: "POST", headers: { "Content-Type": "application/json", cookie: "s=1", "X-Steadier-Request": "1" }, body: "{}" });
      expect(await test.json()).toEqual({ sent: 1, failed: 0 });
    } finally {
      server.close();
    }
  });
});
