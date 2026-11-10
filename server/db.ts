import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, steadierLocalCredentials, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (
      user.openId === ENV.ownerOpenId ||
      (ENV.ownerEmail && user.email?.toLowerCase() === ENV.ownerEmail)
    ) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// TODO: add feature queries here as your schema grows.

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db;
}

export async function getLocalCredentialByEmail(email: string) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(steadierLocalCredentials)
    .where(eq(steadierLocalCredentials.email, email))
    .limit(1);
  return rows[0];
}

export async function getUserById(id: number) {
  const db = await requireDb();
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

/** Create a user and their password in one transaction. Throws "EMAIL_TAKEN". */
export async function createLocalUser(input: {
  openId: string;
  name: string;
  email: string;
  passwordHash: string;
}) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const existing = await tx
      .select({ userId: steadierLocalCredentials.userId })
      .from(steadierLocalCredentials)
      .where(eq(steadierLocalCredentials.email, input.email))
      .limit(1);
    if (existing.length) throw new Error("EMAIL_TAKEN");
    const isOwner = ENV.ownerEmail !== "" && input.email === ENV.ownerEmail;
    await tx.insert(users).values({
      openId: input.openId,
      name: input.name,
      email: input.email,
      loginMethod: "password",
      role: isOwner ? "admin" : "user",
      lastSignedIn: new Date(),
    });
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.openId, input.openId))
      .limit(1);
    try {
      await tx.insert(steadierLocalCredentials).values({
        userId: user.id,
        email: input.email,
        passwordHash: input.passwordHash,
      });
    } catch (error) {
      const e = error as { code?: string; cause?: { code?: string } };
      if ((e?.code ?? e?.cause?.code) === "ER_DUP_ENTRY")
        throw new Error("EMAIL_TAKEN");
      throw error;
    }
    return user;
  });
}

export async function setLocalPassword(userId: number, passwordHash: string) {
  const db = await requireDb();
  await db
    .update(steadierLocalCredentials)
    .set({ passwordHash })
    .where(eq(steadierLocalCredentials.userId, userId));
}
