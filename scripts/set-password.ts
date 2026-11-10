// Reset someone's password, or list accounts.
//   docker compose exec app pnpm exec tsx scripts/set-password.ts list
//   docker compose exec app pnpm exec tsx scripts/set-password.ts person@example.com 'new password'
import { hashPassword, PASSWORD_MIN_LENGTH } from "../server/_core/passwords";
import * as db from "../server/db";
import { users } from "../drizzle/schema";

async function main() {
  const [emailArg, password] = process.argv.slice(2);
  if (emailArg === "list") {
    const conn = await db.getDb();
    const rows = await conn!.select({ id: users.id, name: users.name, email: users.email, role: users.role, lastSignedIn: users.lastSignedIn }).from(users);
    console.table(rows);
    return;
  }
  const email = (emailArg ?? "").trim().toLowerCase();
  if (!email || !password) throw new Error("Usage: set-password.ts <email> <new password>   (or: list)");
  if (password.length < PASSWORD_MIN_LENGTH) throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  const credential = await db.getLocalCredentialByEmail(email);
  if (!credential) throw new Error(`No account with email ${email}`);
  await db.setLocalPassword(credential.userId, await hashPassword(password));
  console.log(`Password updated for ${email}.`);
}

main().then(
  () => process.exit(0),
  error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
);
