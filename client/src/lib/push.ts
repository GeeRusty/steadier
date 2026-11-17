/** This device's phone-notification sign-up (web push). */

export type PushState = "unsupported" | "blocked" | "off" | "on";

function supported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "X-Steadier-Request": "1", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function errorText(response: Response, fallback: string): Promise<string> {
  const reply = (await response.json().catch(() => null)) as { error?: string } | null;
  return reply?.error ?? fallback;
}

/** Asks for permission, signs this device up and tells the server. */
export async function turnOn(): Promise<void> {
  if (!supported()) throw new Error("This browser can't receive notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked for Steadier on this phone. Allow them in the phone's settings, then try again.");
  const reg = (await registration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const keyReply = await fetch("/api/steadier/push/key", { cache: "no-store" });
  if (!keyReply.ok) throw new Error(await errorText(keyReply, "Notifications aren't set up on the server yet."));
  const { publicKey } = (await keyReply.json()) as { publicKey: string };
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
  const saved = await post("/api/steadier/push/subscribe", sub.toJSON());
  if (!saved.ok) throw new Error(await errorText(saved, "This phone couldn't be signed up. Try again."));
}

/** Removes this device on the server and in the browser. */
export async function turnOff(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await post("/api/steadier/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}

/** Sends "Steadier test" to every phone signed up for this account. */
export async function sendTest(): Promise<{ sent: number; failed: number }> {
  const reply = await post("/api/steadier/push/test", {});
  if (!reply.ok) throw new Error(await errorText(reply, "The test couldn't be sent."));
  return (await reply.json()) as { sent: number; failed: number };
}
