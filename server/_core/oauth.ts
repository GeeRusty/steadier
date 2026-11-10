// Email + password sign-in (self-hosted; replaces Manus OAuth).
import { randomUUID } from "node:crypto";
import { COMPASS_LOGIN_RETURN_COOKIE } from "../../shared/compassConnection";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import express, { type Express, type Request, type Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  getDummyHash,
  hashPassword,
  verifyPassword,
} from "./passwords";
import { sdk } from "./sdk";

type Mode = "signin" | "signup";

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

// ---- simple in-memory rate limiting (per server process) -------------------
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

function field(req: Request, name: string): string {
  const value = (req.body as Record<string, unknown> | undefined)?.[name];
  return typeof value === "string" ? value : "";
}

/** Reject cross-site form posts (login CSRF). */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

function renderPage(opts: { mode: Mode; error?: string; email?: string; name?: string }) {
  const { mode, error = "", email = "", name = "" } = opts;
  const signup = mode === "signup";
  const needsCode = signup && ENV.signupCode !== "";
  const title = signup ? "Create your account" : "Sign in";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · Steadier</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f5f2; --card:#fff; --text:#1d1d1b; --muted:#6b6a66; --line:#d9d7d0; --accent:#2f6f5e; --err:#b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#151614; --card:#1f201d; --text:#ecebe6; --muted:#a3a29c; --line:#3a3b36; --accent:#6fbfa6; --err:#f2b8b5; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--text);
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding:16px; }
  main { width:100%; max-width:380px; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:28px 24px; }
  h1 { font-size:1.4rem; margin:0 0 4px; }
  p.sub { margin:0 0 20px; color:var(--muted); }
  label { display:block; font-weight:600; font-size:.9rem; margin:14px 0 6px; }
  input { width:100%; padding:11px 12px; font:inherit; color:inherit; background:transparent; border:1px solid var(--line); border-radius:9px; }
  input:focus { outline:2px solid var(--accent); outline-offset:1px; border-color:transparent; }
  button { width:100%; margin-top:20px; padding:12px; font:inherit; font-weight:600; color:#fff; background:var(--accent); border:0; border-radius:9px; cursor:pointer; }
  @media (prefers-color-scheme: dark) { button { color:#10201b; } }
  .err { color:var(--err); background:color-mix(in srgb, var(--err) 12%, transparent); border-radius:8px; padding:10px 12px; margin:0 0 8px; }
  .alt { margin-top:18px; text-align:center; color:var(--muted); font-size:.95rem; }
  .alt a { color:var(--accent); font-weight:600; }
  .hint { color:var(--muted); font-size:.85rem; margin-top:6px; }
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  <p class="sub">Steadier</p>
  ${error ? `<p class="err" role="alert">${escapeHtml(error)}</p>` : ""}
  <form method="post" action="/api/auth/${signup ? "register" : "login"}">
    ${signup ? `<label for="name">Your name</label>
    <input id="name" name="name" autocomplete="name" maxlength="100" value="${escapeHtml(name)}" required>` : ""}
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="email" maxlength="320" value="${escapeHtml(email)}" required ${signup ? "" : "autofocus"}>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" minlength="${signup ? PASSWORD_MIN_LENGTH : 1}" maxlength="${PASSWORD_MAX_LENGTH}"
      autocomplete="${signup ? "new-password" : "current-password"}" required>
    ${signup ? `<p class="hint">At least ${PASSWORD_MIN_LENGTH} characters.</p>` : ""}
    ${needsCode ? `<label for="code">Invite code</label>
    <input id="code" name="code" autocomplete="off" maxlength="100" required>` : ""}
    <button type="submit">${signup ? "Create account" : "Sign in"}</button>
  </form>
  ${
    signup
      ? `<p class="alt">Already have an account? <a href="/login">Sign in</a></p>`
      : `${ENV.allowSignup ? `<p class="alt">New here? <a href="/login?mode=signup">Create an account</a></p>` : ""}
  <p class="alt">Forgot your password? Ask the person who runs this Steadier to reset it.</p>`
  }
</main>
</body>
</html>`;
}

function sendPage(res: Response, status: number, opts: Parameters<typeof renderPage>[0]) {
  res
    .status(status)
    .set("Cache-Control", "no-store")
    .set("X-Frame-Options", "DENY")
    .type("html")
    .send(renderPage(opts));
}

async function finishSignIn(req: Request, res: Response, user: { openId: string; name: string | null }) {
  const sessionToken = await sdk.createSessionToken(user.openId, {
    name: user.name || "",
    expiresInMs: ONE_YEAR_MS,
  });
  res.cookie(COOKIE_NAME, sessionToken, {
    ...getSessionCookieOptions(req),
    maxAge: ONE_YEAR_MS,
  });
  // Only a fixed in-app consent return is supported, never an external URL.
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  const pendingConsent = cookies[COMPASS_LOGIN_RETURN_COOKIE] ?? "";
  res.clearCookie(COMPASS_LOGIN_RETURN_COOKIE, { path: "/", secure: true, sameSite: "none" });
  res.redirect(
    303,
    /^[A-Za-z0-9_-]{32,128}$/.test(pendingConsent)
      ? `/?compass_oauth=${encodeURIComponent(pendingConsent)}`
      : "/"
  );
}

export function registerOAuthRoutes(app: Express) {
  const form = express.urlencoded({ extended: false, limit: "10kb" });

  app.get("/login", (req, res) => {
    const mode: Mode = req.query.mode === "signup" && ENV.allowSignup ? "signup" : "signin";
    sendPage(res, 200, { mode });
  });

  app.post("/api/auth/login", form, async (req, res) => {
    const email = field(req, "email").trim().toLowerCase();
    const password = field(req, "password");
    if (!sameOrigin(req)) return sendPage(res, 403, { mode: "signin", error: "Please sign in from this site." });
    if (rateLimited(`login:${req.ip}`, 30, 15 * 60_000) || rateLimited(`login:${email}`, 10, 15 * 60_000)) {
      return sendPage(res, 429, { mode: "signin", email, error: "Too many attempts. Wait 15 minutes and try again." });
    }
    try {
      const credential = email ? await db.getLocalCredentialByEmail(email) : undefined;
      const ok = await verifyPassword(
        password.slice(0, PASSWORD_MAX_LENGTH),
        credential?.passwordHash ?? (await getDummyHash())
      );
      const user = ok && credential ? await db.getUserById(credential.userId) : undefined;
      if (!user) {
        return sendPage(res, 401, { mode: "signin", email, error: "That email and password don't match." });
      }
      await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
      await finishSignIn(req, res, user);
    } catch (error) {
      console.error("[Auth] Sign-in failed", error instanceof Error ? error.message : error);
      sendPage(res, 500, { mode: "signin", email, error: "Something went wrong. Please try again." });
    }
  });

  app.post("/api/auth/register", form, async (req, res) => {
    const name = field(req, "name").trim().slice(0, 100);
    const email = field(req, "email").trim().toLowerCase();
    const password = field(req, "password");
    const code = field(req, "code").trim();
    const again = (error: string, status = 400) =>
      sendPage(res, status, { mode: "signup", name, email, error });

    if (!ENV.allowSignup) return sendPage(res, 403, { mode: "signin", error: "New accounts are closed." });
    if (!sameOrigin(req)) return again("Please sign up from this site.", 403);
    if (rateLimited(`register:${req.ip}`, 10, 60 * 60_000)) {
      return again("Too many new accounts from here. Try again later.", 429);
    }
    if (ENV.signupCode && code !== ENV.signupCode) return again("That invite code isn't right.", 403);
    if (!name) return again("Please enter your name.");
    if (!EMAIL_RE.test(email) || email.length > 320) return again("Please enter a valid email address.");
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      return again(`Use a password of at least ${PASSWORD_MIN_LENGTH} characters.`);
    }
    try {
      const user = await db.createLocalUser({
        openId: `local_${randomUUID()}`,
        name,
        email,
        passwordHash: await hashPassword(password),
      });
      await finishSignIn(req, res, user);
    } catch (error) {
      if (error instanceof Error && error.message === "EMAIL_TAKEN") {
        return again("An account with that email already exists. Sign in instead.", 409);
      }
      console.error("[Auth] Sign-up failed", error instanceof Error ? error.message : error);
      again("Something went wrong. Please try again.", 500);
    }
  });

  // Old Manus callback address: send people to the new sign-in page.
  app.get("/api/oauth/callback", (_req, res) => res.redirect(302, "/login"));
}
