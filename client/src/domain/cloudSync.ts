import type {
  CloudRecord,
  CloudStatus,
  CloudUser,
  CloudWrite,
} from "@shared/cloud";
import { addRecoveryCopy, validateRecoveryCopies } from "./storage";
import { validateWorkspace } from "./transfer";
import type { RecoveryCopy } from "./storage";
import type { Workspace } from "./types";

/**
 * The cache is deliberately distinct from the legacy local workspaces. It is
 * owner-scoped and contains a complete pending document so an interrupted PUT
 * can never turn into a last-writer-wins update on the next visit.
 */
export const CLOUD_CACHE_VERSION = 1;
export const CLOUD_CACHE_PREFIX = "steadier.cloud.v1.user.";

export interface CloudPending {
  workspace: Workspace;
  /** The exact server revision that this complete snapshot compares against. */
  baseRevision: number;
  /** A user explicitly started/resumed/took focus on this client. */
  claimFocus: boolean;
  /** A user explicitly chose to replace the checked server version. */
  replacement: boolean;
  queuedAt: string;
}

export interface CloudCache {
  version: typeof CLOUD_CACHE_VERSION;
  userId: number;
  /** Last checked or acknowledged server record, never an optimistic document. */
  server: CloudRecord;
  /** Optimistic complete document; null means server is the visible document. */
  pending: CloudPending | null;
  recoveryCopies: RecoveryCopy[];
  /** Local-only time of a successful, checked server read/write; old caches omit it. */
  lastSyncedAt?: string | null;
}

export interface CloudAcknowledgement {
  cache: CloudCache;
  /** True only when it is safe for the hook to render the returned server doc. */
  replaceVisibleWorkspace: boolean;
  /** False when a 200 response was not the exact CAS candidate that was sent. */
  acknowledged: boolean;
  /** Preserved remote record to present as a visible conflict when acknowledgement is unsafe. */
  conflict: CloudRecord | null;
}

export type CloudFetchReconciliation =
  | { kind: "adopt"; cache: CloudCache }
  | { kind: "acknowledged"; cache: CloudCache }
  | { kind: "pending"; cache: CloudCache }
  | { kind: "conflict"; cache: CloudCache; conflict: CloudRecord };

function fail(message: string): never {
  throw new Error(`Could not use shared workspace data: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some(key => !keys.includes(key))
  ) {
    fail(`${label} has unknown or missing fields.`);
  }
}

function validInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 100 &&
    Number.isFinite(Date.parse(value))
  );
}

function nonNegativeRevision(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function userId(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function clientId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200
  );
}

function checkedBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} must be true or false.`);
  return value;
}

/** Validate the small, owner-safe session payload from GET /session. */
export function validateCloudSession(value: unknown): { user: CloudUser } {
  if (!isRecord(value)) fail("session response is not an object.");
  hasExactKeys(value, ["user"], "session response");
  if (!isRecord(value.user)) fail("session user is not an object.");
  hasExactKeys(value.user, ["id", "name"], "session user");
  if (!userId(value.user.id)) fail("session user has an invalid ID.");
  if (
    value.user.name !== null &&
    (typeof value.user.name !== "string" || value.user.name.length > 500)
  ) {
    fail("session user has an invalid name.");
  }
  return { user: { id: value.user.id, name: value.user.name } };
}

/** Validate a server record before it can become visible or be cached. */
export function validateCloudRecord(value: unknown): CloudRecord {
  if (!isRecord(value)) fail("workspace response is not an object.");
  hasExactKeys(
    value,
    ["workspace", "revision", "updatedAt", "timeZone", "focusOwnerClientId"],
    "workspace response"
  );
  if (!nonNegativeRevision(value.revision)) {
    fail("workspace response has an invalid revision.");
  }
  if (value.updatedAt !== null && !validInstant(value.updatedAt)) {
    fail("workspace response has an invalid updated timestamp.");
  }
  if (
    typeof value.timeZone !== "string" ||
    value.timeZone.length === 0 ||
    value.timeZone.length > 100
  ) {
    fail("workspace response has an invalid time zone.");
  }
  if (value.focusOwnerClientId !== null && !clientId(value.focusOwnerClientId)) {
    fail("workspace response has an invalid focus owner.");
  }
  return {
    workspace: validateWorkspace(value.workspace),
    revision: value.revision,
    updatedAt: value.updatedAt,
    timeZone: value.timeZone,
    focusOwnerClientId: value.focusOwnerClientId,
  };
}

/**
 * Validator output has a stable, complete field ordering. Comparing its JSON
 * avoids shallow/partial comparisons and makes uncertain PUT reconciliation
 * safe without a third-party deep-equality dependency.
 */
export function serializeWorkspace(workspace: Workspace): string {
  return JSON.stringify(validateWorkspace(workspace));
}

export function sameWorkspace(left: Workspace, right: Workspace): boolean {
  return serializeWorkspace(left) === serializeWorkspace(right);
}

/**
 * Private owner-scoped responses can prove that the browser cookie no longer
 * represents the account captured by an active cloud transport. This stays
 * deliberately small and pure so callers never retry an account error through
 * an unscoped request.
 */
export function isAccountGuardFailure(status: number, value: unknown): boolean {
  if (status === 401) return true;
  if (!isRecord(value) || typeof value.code !== "string") return false;
  return [
    "ACCOUNT_CHANGED",
    "ACCOUNT_BINDING_REQUIRED",
    "UNAUTHORIZED",
  ].includes(value.code);
}

/** True only for a server-acknowledged running focus owned by another client. */
export function hasRemoteRunningFocus(
  record: CloudRecord,
  localClientId: string
): boolean {
  const server = validateCloudRecord(record);
  return (
    server.workspace.focus?.running === true &&
    server.focusOwnerClientId !== null &&
    server.focusOwnerClientId !== localClientId
  );
}

export function cloudCacheKey(id: number): string {
  if (!userId(id)) fail("cache user ID is invalid.");
  return `${CLOUD_CACHE_PREFIX}${id}`;
}

export function createCloudCache(user: CloudUser, server: CloudRecord): CloudCache {
  if (!userId(user.id)) fail("cache user ID is invalid.");
  return {
    version: CLOUD_CACHE_VERSION,
    userId: user.id,
    server: validateCloudRecord(server),
    pending: null,
    recoveryCopies: [],
    lastSyncedAt: null,
  };
}

/** Validate an owner-scoped browser cache before relying on pending edits. */
export function validateCloudCache(value: unknown, expectedUserId: number): CloudCache {
  if (!userId(expectedUserId)) fail("cache user ID is invalid.");
  if (!isRecord(value)) fail("recovery cache is not an object.");
  const legacyKeys = ["version", "userId", "server", "pending", "recoveryCopies"];
  const hasSyncTime = Object.prototype.hasOwnProperty.call(value, "lastSyncedAt");
  hasExactKeys(
    value,
    hasSyncTime ? [...legacyKeys, "lastSyncedAt"] : legacyKeys,
    "recovery cache"
  );
  if (value.version !== CLOUD_CACHE_VERSION) {
    fail("recovery cache has an unsupported version.");
  }
  if (value.userId !== expectedUserId) {
    fail("recovery cache belongs to another account.");
  }
  const server = validateCloudRecord(value.server);
  if (hasSyncTime && value.lastSyncedAt !== null && !validInstant(value.lastSyncedAt)) {
    fail("recovery cache has an invalid last sync time.");
  }
  let pending: CloudPending | null = null;
  if (value.pending !== null) {
    if (!isRecord(value.pending)) fail("pending change is not an object.");
    hasExactKeys(
      value.pending,
      ["workspace", "baseRevision", "claimFocus", "replacement", "queuedAt"],
      "pending change"
    );
    if (!nonNegativeRevision(value.pending.baseRevision)) {
      fail("pending change has an invalid base revision.");
    }
    if (!validInstant(value.pending.queuedAt)) {
      fail("pending change has an invalid queued timestamp.");
    }
    pending = {
      workspace: validateWorkspace(value.pending.workspace),
      baseRevision: value.pending.baseRevision,
      claimFocus: checkedBoolean(value.pending.claimFocus, "pending claimFocus"),
      replacement: checkedBoolean(value.pending.replacement, "pending replacement"),
      queuedAt: value.pending.queuedAt,
    };
  }
  return {
    version: CLOUD_CACHE_VERSION,
    userId: expectedUserId,
    server,
    pending,
    recoveryCopies: validateRecoveryCopies(value.recoveryCopies),
    ...(hasSyncTime ? { lastSyncedAt: value.lastSyncedAt as string | null } : {}),
  };
}

/** Record a successful server exchange without changing any workspace data. */
export function markCloudCacheSynced(cache: CloudCache, at: string): CloudCache {
  if (!validInstant(at)) fail("last sync time is invalid.");
  return { ...cache, lastSyncedAt: at };
}

/** Validate the bounded authenticated server-recovery response. */
export function validateCloudRecoveries(value: unknown): RecoveryCopy[] {
  if (!isRecord(value)) fail("recovery response is not an object.");
  hasExactKeys(value, ["copies"], "recovery response");
  if (!Array.isArray(value.copies) || value.copies.length > 3) {
    fail("recovery response must contain at most three copies.");
  }
  const ids = new Set<string>();
  const copies = value.copies.map((copy, index) => {
    if (!isRecord(copy)) fail(`recovery copy ${index + 1} is not an object.`);
    hasExactKeys(copy, ["id", "at", "workspace"], `recovery copy ${index + 1}`);
    if (!clientId(copy.id)) fail(`recovery copy ${index + 1} has an invalid ID.`);
    if (ids.has(copy.id)) fail("recovery copy IDs must be unique.");
    ids.add(copy.id);
    if (!validInstant(copy.at)) fail(`recovery copy ${index + 1} has an invalid timestamp.`);
    return {
      id: copy.id,
      at: copy.at,
      workspace: validateWorkspace(copy.workspace),
    };
  });
  return copies.sort((left, right) => right.at.localeCompare(left.at));
}

export function visibleCloudWorkspace(cache: CloudCache): Workspace {
  return cache.pending?.workspace ?? cache.server.workspace;
}

export function withCloudRecovery(
  cache: CloudCache,
  workspace: Workspace,
  at: string,
  id: string,
  force = false
): CloudCache {
  return {
    ...cache,
    recoveryCopies: addRecoveryCopy(
      cache.recoveryCopies,
      validateWorkspace(workspace),
      at,
      id,
      force
    ),
  };
}

/** Create the exact compare-and-swap payload for a complete snapshot. */
export function makeCloudWrite(
  pending: CloudPending,
  clientIdValue: string,
  timeZone?: string
): CloudWrite {
  if (!clientId(clientIdValue)) fail("client ID is invalid.");
  if (!nonNegativeRevision(pending.baseRevision)) {
    fail("pending change has an invalid base revision.");
  }
  if (timeZone !== undefined && (timeZone.length === 0 || timeZone.length > 100)) {
    fail("time zone is invalid.");
  }
  return {
    workspace: validateWorkspace(pending.workspace),
    baseRevision: pending.baseRevision,
    clientId: clientIdValue,
    ...(timeZone ? { timeZone } : {}),
    ...(pending.claimFocus ? { claimFocus: true } : {}),
    ...(pending.replacement ? { replacement: true } : {}),
  };
}

export function serializeCloudWrite(
  pending: CloudPending,
  clientIdValue: string,
  timeZone?: string
): string {
  return JSON.stringify(makeCloudWrite(pending, clientIdValue, timeZone));
}

/**
 * A PUT acknowledgement is safe only when it is the exact next revision and
 * complete document submitted by this client. A later revision could otherwise
 * be another device's post-write reread response.
 */
export function isExpectedCloudAcknowledgement(
  sent: CloudPending,
  acknowledgement: CloudRecord
): boolean {
  const server = validateCloudRecord(acknowledgement);
  const expectedRevision = sent.baseRevision + 1;
  return (
    Number.isSafeInteger(expectedRevision) &&
    server.revision === expectedRevision &&
    sameWorkspace(server.workspace, sent.workspace)
  );
}

/**
 * Apply an acknowledged PUT without replacing edits made while the request was
 * in flight. A later complete snapshot simply rebases onto the new revision.
 */
export function acknowledgeCloudWrite(
  cache: CloudCache,
  sent: CloudPending,
  acknowledgement: CloudRecord
): CloudAcknowledgement {
  const server = validateCloudRecord(acknowledgement);
  if (!isExpectedCloudAcknowledgement(sent, server)) {
    return {
      cache: { ...cache, server },
      replaceVisibleWorkspace: false,
      acknowledged: false,
      conflict: server,
    };
  }
  const pending = cache.pending;
  if (!pending || sameWorkspace(pending.workspace, sent.workspace)) {
    return {
      cache: { ...cache, server, pending: null },
      replaceVisibleWorkspace: true,
      acknowledged: true,
      conflict: null,
    };
  }
  return {
    cache: {
      ...cache,
      server,
      pending: {
        ...pending,
        baseRevision: server.revision,
      },
    },
    replaceVisibleWorkspace: false,
    acknowledged: true,
    conflict: null,
  };
}

/**
 * Reconcile a checked GET with cache state. It never chooses a winner when a
 * server document and a pending complete document diverge.
 */
export function reconcileFetchedCloudRecord(
  cache: CloudCache,
  fetched: CloudRecord
): CloudFetchReconciliation {
  const server = validateCloudRecord(fetched);
  const pending = cache.pending;
  if (!pending) {
    return { kind: "adopt", cache: { ...cache, server } };
  }

  // A previous PUT may have reached the server even though its response died.
  if (
    server.revision !== pending.baseRevision &&
    sameWorkspace(server.workspace, pending.workspace)
  ) {
    return {
      kind: "acknowledged",
      cache: { ...cache, server, pending: null },
    };
  }

  // The server still has the precise known base: retain the complete cached
  // edit and retry only after an explicit/visible connected opportunity.
  if (
    server.revision === pending.baseRevision &&
    sameWorkspace(server.workspace, cache.server.workspace)
  ) {
    return { kind: "pending", cache: { ...cache, server } };
  }

  // A revision can change for focus ownership without changing the document.
  // Rebasing this exact complete document is safe; a later CAS still guards it.
  if (sameWorkspace(server.workspace, cache.server.workspace)) {
    return {
      kind: "pending",
      cache: {
        ...cache,
        server,
        pending: { ...pending, baseRevision: server.revision },
      },
    };
  }

  return {
    kind: "conflict",
    cache: { ...cache, server },
    conflict: server,
  };
}

/**
 * Resolve a request whose transport result is unknown. Only an exact sent
 * document is acknowledged; any other changed server document stays a visible
 * conflict with both versions preserved.
 */
export function reconcileUncertainCloudWrite(
  cache: CloudCache,
  sent: CloudPending,
  fetched: CloudRecord
): CloudFetchReconciliation {
  const server = validateCloudRecord(fetched);
  if (isExpectedCloudAcknowledgement(sent, server)) {
    return {
      kind: "acknowledged",
      cache: acknowledgeCloudWrite(cache, sent, server).cache,
    };
  }
  if (
    server.revision === sent.baseRevision &&
    sameWorkspace(server.workspace, cache.server.workspace)
  ) {
    return { kind: "pending", cache: { ...cache, server } };
  }
  return {
    kind: "conflict",
    cache: { ...cache, server },
    conflict: server,
  };
}

/** A small explicit helper keeps stale account/mode callback tests pure. */
export function isCurrentGeneration(
  capturedGeneration: number,
  currentGeneration: number
): boolean {
  return (
    Number.isSafeInteger(capturedGeneration) &&
    Number.isSafeInteger(currentGeneration) &&
    capturedGeneration === currentGeneration
  );
}

export function isCloudStatus(value: unknown): value is CloudStatus {
  return [
    "local",
    "loading",
    "synced",
    "saving",
    "offline",
    "conflict",
    "error",
  ].includes(value as CloudStatus);
}
