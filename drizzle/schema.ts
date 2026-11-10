import {
  boolean,
  char,
  index,
  int,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Stable sign-in identifier, e.g. "local_<uuid>". Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;

/** Email + password sign-in for a user (self-hosted). Passwords are scrypt hashes. */
export const steadierLocalCredentials = mysqlTable("steadier_local_credentials", {
  userId: int("userId").notNull().primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type LocalCredential = typeof steadierLocalCredentials.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** One strictly validated v2 workspace per authenticated numeric user ID. */
export const steadierWorkspaces = mysqlTable("steadier_workspaces", {
  ownerId: int("ownerId").notNull().primaryKey(),
  workspaceJson: mediumtext("workspaceJson").notNull(),
  revision: int("revision").notNull(),
  timeZone: varchar("timeZone", { length: 100 }).notNull(),
  focusOwnerClientId: varchar("focusOwnerClientId", { length: 128 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Durable pre-replacement documents; restores never silently discard their prior state. */
export const steadierWorkspaceRecoveries = mysqlTable(
  "steadier_workspace_recoveries",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerId: int("ownerId").notNull(),
    sourceRevision: int("sourceRevision").notNull(),
    workspaceJson: mediumtext("workspaceJson").notNull(),
    timeZone: varchar("timeZone", { length: 100 }).notNull(),
    focusOwnerClientId: varchar("focusOwnerClientId", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("steadier_recovery_owner_created").on(table.ownerId, table.createdAt),
  ]
);

/** Opaque, read-only Compass capabilities. The plaintext token is never stored. */
export const steadierCompassKeys = mysqlTable(
  "steadier_compass_keys",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerId: int("ownerId").notNull(),
    tokenHash: char("tokenHash", { length: 64 }).notNull().unique(),
    label: varchar("label", { length: 100 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    lastUsedAt: timestamp("lastUsedAt"),
    revokedAt: timestamp("revokedAt"),
    /** "steadier:read" or "steadier:read steadier:write"; older keys are read-only. */
    scope: varchar("scope", { length: 64 }).default("steadier:read").notNull(),
    /** Hash-only OAuth refresh credential; null for manually issued reader keys. */
    refreshTokenHash: char("refreshTokenHash", { length: 64 }).unique(),
    refreshExpiresAt: timestamp("refreshExpiresAt"),
    oauthClientId: varchar("oauthClientId", { length: 96 }),
    connectorActor: mysqlEnum("connectorActor", [
      "claude",
      "chatgpt",
      "connector",
    ]),
  },
  table => [index("steadier_compass_owner").on(table.ownerId)]
);

/**
 * Full-workspace snapshots taken before every connector or owner-applied server
 * change. Written in the same transaction as the change, so a failed backup
 * means no change. The newest twenty per owner are kept.
 */
export const steadierWorkspaceBackups = mysqlTable(
  "steadier_workspace_backups",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerId: int("ownerId").notNull(),
    sourceRevision: int("sourceRevision").notNull(),
    workspaceJson: mediumtext("workspaceJson").notNull(),
    timeZone: varchar("timeZone", { length: 100 }).notNull(),
    actor: mysqlEnum("actor", [
      "claude",
      "chatgpt",
      "connector",
      "owner",
    ]).notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    taskCount: int("taskCount").notNull(),
    projectCount: int("projectCount").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("steadier_backup_owner_created").on(table.ownerId, table.createdAt),
  ]
);

/** Claude may only request deletion; the owner confirms or keeps it in the app. */
export const steadierPendingDeletes = mysqlTable(
  "steadier_pending_deletes",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerId: int("ownerId").notNull(),
    itemKind: mysqlEnum("itemKind", ["task", "project"]).notNull(),
    itemId: varchar("itemId", { length: 128 }).notNull(),
    itemTitle: varchar("itemTitle", { length: 500 }).notNull(),
    reason: text("reason").notNull(),
    requestedBy: mysqlEnum("requestedBy", ["claude", "chatgpt", "connector"])
      .default("claude")
      .notNull(),
    status: mysqlEnum("status", ["pending", "deleted", "kept"])
      .default("pending")
      .notNull(),
    requestedAt: timestamp("requestedAt").defaultNow().notNull(),
    decidedAt: timestamp("decidedAt"),
  },
  table => [
    index("steadier_pending_delete_owner").on(table.ownerId, table.status),
  ]
);

/** Public dynamic clients registered for the read-only Compass OAuth issuer. */
export const steadierCompassOAuthClients = mysqlTable(
  "steadier_compass_oauth_clients",
  {
    clientId: varchar("clientId", { length: 96 }).notNull().primaryKey(),
    clientName: varchar("clientName", { length: 120 }).notNull(),
    // Exact, validated registration strings. Authorization requests must match one verbatim.
    redirectUrisJson: mediumtext("redirectUrisJson").notNull(),
    refreshEnabled: boolean("refreshEnabled").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("steadier_oauth_client_created").on(table.createdAt)]
);

/** Short-lived browser consent tickets, bound to their approving Steadier owner. */
export const steadierCompassOAuthRequests = mysqlTable(
  "steadier_compass_oauth_requests",
  {
    id: char("id", { length: 64 }).notNull().primaryKey(),
    clientId: varchar("clientId", { length: 96 }).notNull(),
    redirectUri: varchar("redirectUri", { length: 2048 }).notNull(),
    state: text("state"),
    codeChallenge: varchar("codeChallenge", { length: 128 }).notNull(),
    scope: varchar("scope", { length: 64 }).notNull(),
    offlineAccess: boolean("offlineAccess").default(false).notNull(),
    resource: varchar("resource", { length: 2048 }).notNull(),
    ownerId: int("ownerId"),
    status: mysqlEnum("status", ["pending", "approved", "denied"])
      .default("pending")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    decidedAt: timestamp("decidedAt"),
  },
  table => [
    index("steadier_oauth_request_owner").on(table.ownerId, table.createdAt),
    index("steadier_oauth_request_expiry").on(table.expiresAt),
  ]
);

/** Hashed, short-lived and atomically redeemed OAuth authorization codes. */
export const steadierCompassOAuthCodes = mysqlTable(
  "steadier_compass_oauth_codes",
  {
    id: int("id").autoincrement().primaryKey(),
    requestId: char("requestId", { length: 64 }).notNull(),
    codeHash: char("codeHash", { length: 64 }).notNull().unique(),
    ownerId: int("ownerId").notNull(),
    clientId: varchar("clientId", { length: 96 }).notNull(),
    redirectUri: varchar("redirectUri", { length: 2048 }).notNull(),
    codeChallenge: varchar("codeChallenge", { length: 128 }).notNull(),
    scope: varchar("scope", { length: 64 }).notNull(),
    offlineAccess: boolean("offlineAccess").default(false).notNull(),
    connectorActor: mysqlEnum("connectorActor", ["claude", "chatgpt", "connector"])
      .default("connector")
      .notNull(),
    resource: varchar("resource", { length: 2048 }).notNull(),
    issuedAt: timestamp("issuedAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    redeemedAt: timestamp("redeemedAt"),
  },
  table => [
    index("steadier_oauth_code_owner").on(table.ownerId, table.issuedAt),
    index("steadier_oauth_code_expiry").on(table.expiresAt),
  ]
);

/**
 * Private calendar subscription link (one active per owner). Only a SHA-256 hash
 * of the link's secret is stored; creating a new link revokes the previous one.
 */
export const steadierCalendarFeeds = mysqlTable(
  "steadier_calendar_feeds",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerId: int("ownerId").notNull(),
    tokenHash: char("tokenHash", { length: 64 }).notNull().unique(),
    hideTitles: boolean("hideTitles").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    lastFetchedAt: timestamp("lastFetchedAt"),
    revokedAt: timestamp("revokedAt"),
  },
  table => [index("steadier_calendar_owner").on(table.ownerId)]
);
