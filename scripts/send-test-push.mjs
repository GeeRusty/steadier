// Sends "Steadier test" to every phone signed up for one account, from the server.
// Run inside the app container:  docker compose exec app node scripts/send-test-push.mjs OWNER_ID
import webpush from "web-push";
import mysql from "mysql2/promise";

const ownerId = Number(process.argv[2]);
if (!Number.isSafeInteger(ownerId) || ownerId <= 0) {
  console.error("Give the account number, e.g. 46.");
  process.exit(1);
}
const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUBLIC_ORIGIN, DATABASE_URL } = process.env;
const db = await mysql.createConnection(DATABASE_URL);
const [rows] = await db.execute("SELECT endpoint, p256dh, auth, createdAt FROM steadier_push_subscriptions WHERE ownerId = ?", [ownerId]);
if (!rows.length) {
  console.log("No phone is signed up yet: on the phone, ⋮ › Notifications › Turn on.");
  process.exit(0);
}
const payload = JSON.stringify({ kind: "test", title: "Steadier test", body: "Sent from the server as proof that notifications reach this phone.", tag: `test:${Date.now()}`, url: "/" });
for (const r of rows) {
  try {
    const res = await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload, {
      vapidDetails: { subject: PUBLIC_ORIGIN, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY },
      TTL: 600,
      urgency: "high",
    });
    console.log(`Device signed up ${new Date(r.createdAt).toISOString().slice(0, 16)}: accepted by its push service (HTTP ${res.statusCode}).`);
  } catch (error) {
    console.log(`Device signed up ${new Date(r.createdAt).toISOString().slice(0, 16)}: not delivered (HTTP ${error.statusCode ?? "?"}).`);
  }
}
await db.end();
