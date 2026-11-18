// Phone notifications by web push (owner-approved 17 Nov).
//
// Each message is encrypted here (RFC 8291) before it goes to the phone's
// push service (Google's, for Chrome on Android), so that service sees only
// that a message of some size went to a device, never its text. Nothing else
// leaves the server. Only two kinds are ever sent: a task's own reminders and
// "leave by" (client/src/domain/notifications.ts). A reminder that falls in
// quiet hours is dropped.
import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import webpush from "web-push";
import { and, eq, lt } from "drizzle-orm";
import { getDb } from "../db";
import { steadierPushSent, steadierPushSubscriptions } from "../../drizzle/schema";
import { sdk } from "../_core/sdk";
import { pushesDue, type PushMessage } from "../../client/src/domain/notifications";
import type { Workspace } from "../../client/src/domain/types";

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushStore {
  ownersWithDevices(): Promise<number[]>;
  devices(ownerId: number): Promise<PushSubscriptionRecord[]>;
  save(ownerId: number, sub: PushSubscriptionRecord): Promise<void>;
  remove(ownerId: number, endpoint: string): Promise<void>;
  /** Holds a message while it's being sent; false when it was already sent or is being sent. */
  claim(ownerId: number, key: string): Promise<boolean>;
  /** Gives a claim back when no phone accepted the message, so the next minute tries again. */
  release(ownerId: number, key: string): Promise<void>;
  sentOk(endpoint: string): Promise<void>;
  prune(before: Date): Promise<void>;
}

export type PushSender = (sub: PushSubscriptionRecord, payload: string) => Promise<{ status: number }>;

const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

/** Push services that real browsers use; nothing else is ever posted to. */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
];

export function parseSubscription(body: unknown): PushSubscriptionRecord {
  const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const endpoint = typeof b?.endpoint === "string" ? b.endpoint : "";
  const p256dh = typeof b?.keys?.p256dh === "string" ? b.keys.p256dh : "";
  const auth = typeof b?.keys?.auth === "string" ? b.keys.auth : "";
  let host = "";
  try {
    const url = new URL(endpoint);
    if (url.protocol === "https:") host = url.hostname;
  } catch {
    // invalid below
  }
  if (!host || endpoint.length > 1000 || !PUSH_HOSTS.some(h => h.test(host)))
    throw new Error("That isn't a push address Steadier can use.");
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(auth))
    throw new Error("The device's push keys are missing.");
  return { endpoint, p256dh, auth };
}

export function pushPayload(m: Pick<PushMessage, "title" | "body" | "key"> & { kind: PushMessage["kind"] | "test" }): string {
  return JSON.stringify({ kind: m.kind, title: m.title, body: m.body, tag: m.key.slice(0, 120), url: "/" });
}

export function createDrizzlePushStore(): PushStore {
  const db = async () => {
    const d = await getDb();
    if (!d) throw new Error("Database unavailable");
    return d;
  };
  return {
    async ownersWithDevices() {
      const rows = await (await db()).selectDistinct({ ownerId: steadierPushSubscriptions.ownerId }).from(steadierPushSubscriptions);
      return rows.map(r => r.ownerId);
    },
    async devices(ownerId) {
      return (await db())
        .select({ endpoint: steadierPushSubscriptions.endpoint, p256dh: steadierPushSubscriptions.p256dh, auth: steadierPushSubscriptions.auth })
        .from(steadierPushSubscriptions)
        .where(eq(steadierPushSubscriptions.ownerId, ownerId));
    },
    async save(ownerId, sub) {
      const endpointHash = sha256(sub.endpoint);
      await (await db())
        .insert(steadierPushSubscriptions)
        .values({ ownerId, endpointHash, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth })
        .onDuplicateKeyUpdate({ set: { ownerId, p256dh: sub.p256dh, auth: sub.auth } });
    },
    async remove(ownerId, endpoint) {
      await (await db())
        .delete(steadierPushSubscriptions)
        .where(and(eq(steadierPushSubscriptions.ownerId, ownerId), eq(steadierPushSubscriptions.endpointHash, sha256(endpoint))));
    },
    async claim(ownerId, key) {
      try {
        await (await db()).insert(steadierPushSent).values({ ownerId, keyHash: sha256(key) });
        return true;
      } catch (error) {
        const code = (error as { code?: string; cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
        if (code === "ER_DUP_ENTRY") return false;
        throw error;
      }
    },
    async release(ownerId, key) {
      await (await db())
        .delete(steadierPushSent)
        .where(and(eq(steadierPushSent.ownerId, ownerId), eq(steadierPushSent.keyHash, sha256(key))));
    },
    async sentOk(endpoint) {
      await (await db())
        .update(steadierPushSubscriptions)
        .set({ lastSentAt: new Date() })
        .where(eq(steadierPushSubscriptions.endpointHash, sha256(endpoint)));
    },
    async prune(before) {
      await (await db()).delete(steadierPushSent).where(lt(steadierPushSent.sentAt, before));
    },
  };
}

function vapid(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  // The subject is the app's own address, never a personal email.
  const subject = process.env.PUBLIC_ORIGIN ?? "";
  if (!publicKey || !privateKey || !/^https:\/\//.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

export const webPushSender: PushSender = async (sub, payload) => {
  const keys = vapid();
  if (!keys) throw new Error("Push keys are not set up on the server.");
  try {
    const result = await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      {
        vapidDetails: keys,
        TTL: 10 * 60, // a reminder older than 10 minutes isn't worth showing
        urgency: "high",
        contentEncoding: "aes128gcm",
      }
    );
    return { status: result.statusCode };
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === "number") return { status };
    throw error;
  }
};

/** Sends to every device of an owner. Devices the push service says are gone are removed. */
export async function sendToOwner(
  store: PushStore,
  send: PushSender,
  ownerId: number,
  payload: string
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const device of await store.devices(ownerId)) {
    try {
      const { status } = await send(device, payload);
      if (status >= 200 && status < 300) {
        sent++;
        await store.sentOk(device.endpoint);
      } else {
        failed++;
        if (status === 404 || status === 410) await store.remove(ownerId, device.endpoint);
      }
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}

/** One pass: send what's due for each owner with a device, each message once. */
export async function pushTick(
  store: PushStore,
  send: PushSender,
  readWorkspace: (ownerId: number) => Promise<Workspace | null>,
  now: Date = new Date()
): Promise<number> {
  let count = 0;
  for (const ownerId of await store.ownersWithDevices()) {
    const workspace = await readWorkspace(ownerId);
    if (!workspace) continue;
    for (const message of pushesDue(workspace, now)) {
      if (!(await store.claim(ownerId, message.key))) continue;
      // The claim stops a second send while this one is in flight. It only
      // stays once a push service has accepted the message for at least one
      // phone; otherwise it's given back and the next minute tries again,
      // for as long as the reminder is inside its 10-minute window. (If one
      // phone of several accepted it, it isn't resent, so no phone rings twice.)
      let sent = 0;
      try {
        sent = (await sendToOwner(store, send, ownerId, pushPayload(message))).sent;
      } finally {
        if (sent === 0) {
          await store.release(ownerId, message.key).catch(error =>
            console.error("Push retry hold couldn't be cleared:", error instanceof Error ? error.message : error)
          );
          if ((await store.devices(ownerId).catch(() => [])).length)
            console.warn(`Push not accepted for owner ${ownerId}; will try again next minute.`);
        }
      }
      count += sent;
    }
  }
  return count;
}

export function schedulePushes(readWorkspace: (ownerId: number) => Promise<Workspace | null>, store: PushStore = createDrizzlePushStore()): void {
  if (!vapid()) {
    console.log("Push notifications are off: VAPID keys are not set.");
    return;
  }
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    pushTick(store, webPushSender, readWorkspace)
      .catch(error => console.error("Push check failed:", error instanceof Error ? error.message : error))
      .finally(() => {
        running = false;
      });
  };
  setInterval(tick, 60_000).unref();
  setTimeout(tick, 15_000).unref();
  setInterval(() => void store.prune(new Date(Date.now() - 3 * 86_400_000)).catch(() => undefined), 6 * 3_600_000).unref();
}

async function signedInUserId(request: Request): Promise<number | null> {
  try {
    const user = await sdk.authenticateRequest(request);
    return user.isCron || !Number.isSafeInteger(user.id) || user.id <= 0 ? null : user.id;
  } catch {
    return null;
  }
}

export interface PushRouteDeps {
  store?: PushStore;
  send?: PushSender;
  userId?: (request: Request) => Promise<number | null>;
  publicKey?: () => string | null;
}

export function registerPushRoutes(app: Express, deps: PushRouteDeps = {}): void {
  let lazyStore: PushStore | null = null;
  const store = () => deps.store ?? (lazyStore ??= createDrizzlePushStore());
  const send = deps.send ?? webPushSender;
  const userIdFor = deps.userId ?? signedInUserId;
  const publicKey = deps.publicKey ?? (() => vapid()?.publicKey ?? null);
  const reply = (response: Response, status: number, body: unknown) =>
    response.status(status).set("Cache-Control", "private, no-store").json(body);

  const guarded = (handler: (request: Request, response: Response, ownerId: number) => Promise<void>) =>
    async (request: Request, response: Response) => {
      const ownerId = await userIdFor(request);
      if (!ownerId) return reply(response, 401, { error: "Sign in first." });
      const header = request.get("x-steadier-owner");
      if (request.get("x-steadier-request") !== "1" || (header && header !== String(ownerId)))
        return reply(response, 403, { error: "That wasn't allowed." });
      try {
        await handler(request, response, ownerId);
      } catch (error) {
        reply(response, 400, { error: error instanceof Error ? error.message : "That didn't work." });
      }
    };

  app.get("/api/steadier/push/key", (_request, response) => {
    const key = publicKey();
    reply(response, key ? 200 : 503, key ? { publicKey: key } : { error: "Notifications aren't set up on the server yet." });
  });

  app.post(
    "/api/steadier/push/subscribe",
    guarded(async (request, response, ownerId) => {
      await store().save(ownerId, parseSubscription(request.body));
      reply(response, 200, { ok: true });
    })
  );

  app.post(
    "/api/steadier/push/unsubscribe",
    guarded(async (request, response, ownerId) => {
      const endpoint = typeof request.body?.endpoint === "string" ? request.body.endpoint : "";
      if (endpoint) await store().remove(ownerId, endpoint);
      reply(response, 200, { ok: true });
    })
  );

  app.post(
    "/api/steadier/push/test",
    guarded(async (_request, response, ownerId) => {
      const result = await sendToOwner(
        store(),
        send,
        ownerId,
        pushPayload({ kind: "test", key: `test:${Date.now()}`, title: "Steadier test", body: "Notifications reach this phone." })
      );
      reply(response, 200, result);
    })
  );
}
