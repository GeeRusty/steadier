// Android app support: the Digital Asset Links file that lets the Trusted Web
// Activity open full-screen (no address bar), plus the APK download page.
import fs from "node:fs";
import path from "node:path";
import type { Express } from "express";

const APK_DIR = process.env.APK_DIR ?? "/app/downloads";
const APK_NAME = "steadier.apk";

export function registerAndroidAppRoutes(app: Express) {
  app.get("/.well-known/assetlinks.json", (_req, res) => {
    const pkg = process.env.ANDROID_PACKAGE ?? "";
    const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? "")
      .split(",")
      .map(s => s.trim().toUpperCase())
      .filter(s => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
    const body =
      pkg && fingerprints.length
        ? [
            {
              relation: ["delegate_permission/common.handle_all_urls"],
              target: {
                namespace: "android_app",
                package_name: pkg,
                sha256_cert_fingerprints: fingerprints,
              },
            },
          ]
        : [];
    res.set("Cache-Control", "public, max-age=3600").json(body);
  });

  app.get(`/download/${APK_NAME}`, (_req, res) => {
    const file = path.join(APK_DIR, APK_NAME);
    if (!fs.existsSync(file)) {
      res.status(404).type("text").send("The Android app isn't available yet.");
      return;
    }
    res
      .set("Cache-Control", "no-cache")
      .type("application/vnd.android.package-archive")
      .download(file, APK_NAME);
  });

  app.get("/download", (_req, res) => {
    res.set("Cache-Control", "no-cache").type("html").send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Get the Steadier app</title>
<style>
  :root { color-scheme: light dark; --bg:#f7f8f3; --card:#fff; --text:#1d1d1b; --muted:#62655f; --line:#d9dbd2; --accent:#24483e; --on:#fff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#151614; --card:#1f201d; --text:#ecebe6; --muted:#a3a29c; --line:#3a3b36; --accent:#7cc4ad; --on:#10201b; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--text);
         font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; padding:16px; }
  main { width:100%; max-width:420px; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:28px 24px; display:grid; gap:16px; }
  img { width:72px; height:72px; border-radius:16px; }
  h1 { font-size:1.4rem; margin:0; }
  p { margin:0; color:var(--muted); }
  a.btn { display:block; text-align:center; padding:14px; border-radius:10px; background:var(--accent); color:var(--on); font-weight:600; text-decoration:none; }
  ol { margin:0; padding-left:1.25em; display:grid; gap:6px; }
  .alt a { color:var(--accent); font-weight:600; }
</style>
</head>
<body>
<main>
  <img src="/icon-192.png" alt="">
  <h1>Steadier for Android</h1>
  <a class="btn" href="/download/${APK_NAME}">Download the app</a>
  <ol>
    <li>Tap <b>Download the app</b>, then open the downloaded file.</li>
    <li>If your phone asks, allow installing apps from this source.</li>
    <li>Tap <b>Install</b>, then open Steadier and sign in.</li>
  </ol>
  <p>The app needs Chrome on your phone, which most Android phones already have.</p>
  <p class="alt">Prefer not to install anything? <a href="/">Use Steadier in your browser</a>.</p>
</main>
</body>
</html>`);
  });
}
