import {
  COMPASS_READ_SCOPE,
  COMPASS_READ_WRITE_SCOPE,
  type CompassGrantedScope,
} from "../../shared/compassConnection";
import type { ConnectorActor } from "../../shared/cloud";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import {
  steadierCompassOAuthClients,
  steadierCompassOAuthCodes,
  steadierCompassOAuthRequests,
} from "../../drizzle/schema";
import { getDb } from "../db";

function isGrantedScope(value: string): value is CompassGrantedScope {
  return value === COMPASS_READ_SCOPE || value === COMPASS_READ_WRITE_SCOPE;
}

export type CompassOAuthClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  refreshEnabled: boolean;
  createdAt: string;
};

export type CompassConsentStatus = "pending" | "approved" | "denied";

export type StoredCompassConsentRequest = {
  id: string;
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: CompassGrantedScope;
  offlineAccess: boolean;
  resource: string;
  ownerId: number | null;
  status: CompassConsentStatus;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
};

export type StoredCompassAuthorizationCode = {
  requestId: string;
  codeHash: string;
  ownerId: number;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: CompassGrantedScope;
  offlineAccess: boolean;
  connectorActor: ConnectorActor;
  resource: string;
  issuedAt: string;
  expiresAt: string;
  redeemedAt: string | null;
};

export type NewCompassOAuthClient = Omit<CompassOAuthClient, "createdAt"> & {
  createdAt: Date;
};

export type NewCompassConsentRequest = Omit<
  StoredCompassConsentRequest,
  "ownerId" | "status" | "createdAt" | "expiresAt" | "decidedAt"
> & {
  createdAt: Date;
  expiresAt: Date;
};

export type NewCompassAuthorizationCode = Omit<
  StoredCompassAuthorizationCode,
  "issuedAt" | "expiresAt" | "redeemedAt"
> & {
  issuedAt: Date;
  expiresAt: Date;
};

/**
 * Only OAuth grants use this repository. Workspace and reader-key operations stay
 * in the existing SteadierRepository so OAuth cannot acquire workspace write paths.
 */
export interface CompassOAuthRepository {
  createClient(client: NewCompassOAuthClient): Promise<CompassOAuthClient>;
  findClient(clientId: string): Promise<CompassOAuthClient | null>;
  createConsentRequest(
    request: NewCompassConsentRequest
  ): Promise<StoredCompassConsentRequest>;
  /** Binds the ticket to the first authenticated owner who opens it. */
  claimConsentRequest(
    id: string,
    ownerId: number,
    now: Date
  ): Promise<StoredCompassConsentRequest | null>;
  /** Approve/deny exactly once; approval inserts the hashed one-time code in one transaction. */
  decideConsentRequest(input: {
    id: string;
    ownerId: number;
    approve: boolean;
    authorizationCode?: NewCompassAuthorizationCode;
    now: Date;
  }): Promise<boolean>;
  findAuthorizationCode(
    codeHash: string
  ): Promise<StoredCompassAuthorizationCode | null>;
  /** Atomically records redemption only when all immutable bindings still match. */
  consumeAuthorizationCode(input: {
    codeHash: string;
    clientId: string;
    redirectUri: string;
    resource: string;
    now: Date;
  }): Promise<boolean>;
}

function requireDate(value: Date | string, field: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Stored OAuth ${field} is not a valid timestamp.`);
  }
  return date;
}

function asIso(value: Date | string, field: string): string {
  return requireDate(value, field).toISOString();
}

function parseRedirectUris(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Stored OAuth client redirect URIs are invalid.");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some(uri => typeof uri !== "string")
  ) {
    throw new Error("Stored OAuth client redirect URIs are invalid.");
  }
  return parsed;
}

function clientFromRow(
  row: typeof steadierCompassOAuthClients.$inferSelect
): CompassOAuthClient {
  return {
    clientId: row.clientId,
    clientName: row.clientName,
    redirectUris: parseRedirectUris(row.redirectUrisJson),
    refreshEnabled: row.refreshEnabled,
    createdAt: asIso(row.createdAt, "client createdAt"),
  };
}

function requestFromRow(
  row: typeof steadierCompassOAuthRequests.$inferSelect
): StoredCompassConsentRequest {
  if (
    row.status !== "pending" &&
    row.status !== "approved" &&
    row.status !== "denied"
  ) {
    throw new Error("Stored OAuth consent status is invalid.");
  }
  if (!isGrantedScope(row.scope)) {
    throw new Error("Stored OAuth consent scope is invalid.");
  }
  return {
    id: row.id,
    clientId: row.clientId,
    redirectUri: row.redirectUri,
    state: row.state,
    codeChallenge: row.codeChallenge,
    scope: row.scope,
    offlineAccess: row.offlineAccess,
    resource: row.resource,
    ownerId: row.ownerId,
    status: row.status,
    createdAt: asIso(row.createdAt, "consent createdAt"),
    expiresAt: asIso(row.expiresAt, "consent expiresAt"),
    decidedAt: row.decidedAt ? asIso(row.decidedAt, "consent decidedAt") : null,
  };
}

function authorizationCodeFromRow(
  row: typeof steadierCompassOAuthCodes.$inferSelect
): StoredCompassAuthorizationCode {
  if (!isGrantedScope(row.scope)) {
    throw new Error("Stored OAuth authorization code scope is invalid.");
  }
  if (!["claude", "chatgpt", "connector"].includes(row.connectorActor)) {
    throw new Error("Stored OAuth connector label is invalid.");
  }
  return {
    requestId: row.requestId,
    codeHash: row.codeHash,
    ownerId: row.ownerId,
    clientId: row.clientId,
    redirectUri: row.redirectUri,
    codeChallenge: row.codeChallenge,
    scope: row.scope,
    offlineAccess: row.offlineAccess,
    connectorActor: row.connectorActor,
    resource: row.resource,
    issuedAt: asIso(row.issuedAt, "authorization code issuedAt"),
    expiresAt: asIso(row.expiresAt, "authorization code expiresAt"),
    redeemedAt: row.redeemedAt
      ? asIso(row.redeemedAt, "authorization code redeemedAt")
      : null,
  };
}

function affectedRows(result: unknown): number {
  if (Array.isArray(result) && result.length > 0) {
    const header = result[0] as { affectedRows?: unknown };
    if (typeof header.affectedRows === "number") return header.affectedRows;
  }
  if (result && typeof result === "object") {
    const header = result as { affectedRows?: unknown };
    if (typeof header.affectedRows === "number") return header.affectedRows;
  }
  return 0;
}

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new Error("Database is unavailable.");
  return database;
}

class ConsentDecisionMiss extends Error {}

/** Production persistence for only the additive Compass OAuth tables. */
export class DrizzleCompassOAuthRepository implements CompassOAuthRepository {
  async createClient(
    client: NewCompassOAuthClient
  ): Promise<CompassOAuthClient> {
    const database = await requireDatabase();
    await database.insert(steadierCompassOAuthClients).values({
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUrisJson: JSON.stringify(client.redirectUris),
      refreshEnabled: client.refreshEnabled,
      createdAt: client.createdAt,
    });
    return {
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUris: [...client.redirectUris],
      refreshEnabled: client.refreshEnabled,
      createdAt: client.createdAt.toISOString(),
    };
  }

  async findClient(clientId: string): Promise<CompassOAuthClient | null> {
    const database = await requireDatabase();
    const [row] = await database
      .select()
      .from(steadierCompassOAuthClients)
      .where(eq(steadierCompassOAuthClients.clientId, clientId))
      .limit(1);
    return row ? clientFromRow(row) : null;
  }

  async createConsentRequest(
    request: NewCompassConsentRequest
  ): Promise<StoredCompassConsentRequest> {
    const database = await requireDatabase();
    await database.insert(steadierCompassOAuthRequests).values({
      id: request.id,
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      state: request.state,
      codeChallenge: request.codeChallenge,
      scope: request.scope,
      offlineAccess: request.offlineAccess,
      resource: request.resource,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
    });
    return {
      ...request,
      ownerId: null,
      status: "pending",
      createdAt: request.createdAt.toISOString(),
      expiresAt: request.expiresAt.toISOString(),
      decidedAt: null,
    };
  }

  async claimConsentRequest(
    id: string,
    ownerId: number,
    now: Date
  ): Promise<StoredCompassConsentRequest | null> {
    const database = await requireDatabase();
    // Only the first authenticated owner may bind a still-pending ticket. A later
    // request by that same owner is allowed without relying on UPDATE changed-row
    // semantics, which vary by MySQL client configuration.
    await database
      .update(steadierCompassOAuthRequests)
      .set({ ownerId })
      .where(
        and(
          eq(steadierCompassOAuthRequests.id, id),
          eq(steadierCompassOAuthRequests.status, "pending"),
          gt(steadierCompassOAuthRequests.expiresAt, now),
          isNull(steadierCompassOAuthRequests.ownerId)
        )
      );

    const [row] = await database
      .select()
      .from(steadierCompassOAuthRequests)
      .where(
        and(
          eq(steadierCompassOAuthRequests.id, id),
          eq(steadierCompassOAuthRequests.ownerId, ownerId),
          eq(steadierCompassOAuthRequests.status, "pending"),
          gt(steadierCompassOAuthRequests.expiresAt, now)
        )
      )
      .limit(1);
    return row ? requestFromRow(row) : null;
  }

  async decideConsentRequest(input: {
    id: string;
    ownerId: number;
    approve: boolean;
    authorizationCode?: NewCompassAuthorizationCode;
    now: Date;
  }): Promise<boolean> {
    const database = await requireDatabase();
    try {
      await database.transaction(async transaction => {
        const result = await transaction
          .update(steadierCompassOAuthRequests)
          .set({
            status: input.approve ? "approved" : "denied",
            decidedAt: input.now,
          })
          .where(
            and(
              eq(steadierCompassOAuthRequests.id, input.id),
              eq(steadierCompassOAuthRequests.ownerId, input.ownerId),
              eq(steadierCompassOAuthRequests.status, "pending"),
              gt(steadierCompassOAuthRequests.expiresAt, input.now)
            )
          );
        if (affectedRows(result) !== 1) throw new ConsentDecisionMiss();

        if (input.approve) {
          if (!input.authorizationCode) {
            throw new Error(
              "An approved OAuth request requires an authorization code."
            );
          }
          await transaction.insert(steadierCompassOAuthCodes).values({
            requestId: input.authorizationCode.requestId,
            codeHash: input.authorizationCode.codeHash,
            ownerId: input.authorizationCode.ownerId,
            clientId: input.authorizationCode.clientId,
            redirectUri: input.authorizationCode.redirectUri,
            codeChallenge: input.authorizationCode.codeChallenge,
            scope: input.authorizationCode.scope,
            offlineAccess: input.authorizationCode.offlineAccess,
            connectorActor: input.authorizationCode.connectorActor,
            resource: input.authorizationCode.resource,
            issuedAt: input.authorizationCode.issuedAt,
            expiresAt: input.authorizationCode.expiresAt,
          });
        }
      });
      return true;
    } catch (error) {
      if (error instanceof ConsentDecisionMiss) return false;
      throw error;
    }
  }

  async findAuthorizationCode(
    codeHash: string
  ): Promise<StoredCompassAuthorizationCode | null> {
    const database = await requireDatabase();
    const [row] = await database
      .select()
      .from(steadierCompassOAuthCodes)
      .where(eq(steadierCompassOAuthCodes.codeHash, codeHash))
      .limit(1);
    return row ? authorizationCodeFromRow(row) : null;
  }

  async consumeAuthorizationCode(input: {
    codeHash: string;
    clientId: string;
    redirectUri: string;
    resource: string;
    now: Date;
  }): Promise<boolean> {
    const database = await requireDatabase();
    const result = await database
      .update(steadierCompassOAuthCodes)
      .set({ redeemedAt: input.now })
      .where(
        and(
          eq(steadierCompassOAuthCodes.codeHash, input.codeHash),
          eq(steadierCompassOAuthCodes.clientId, input.clientId),
          eq(steadierCompassOAuthCodes.redirectUri, input.redirectUri),
          eq(steadierCompassOAuthCodes.resource, input.resource),
          isNull(steadierCompassOAuthCodes.redeemedAt),
          gt(steadierCompassOAuthCodes.expiresAt, input.now)
        )
      );
    return affectedRows(result) === 1;
  }
}

export function createProductionCompassOAuthRepository(): CompassOAuthRepository {
  return new DrizzleCompassOAuthRepository();
}
