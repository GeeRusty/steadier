import { STEADIER_TIME_ZONE } from "../../shared/time";
import {
  COMPASS_READ_SCOPE,
  type CompassGrantedScope,
} from "../../shared/compassConnection";
import { randomBytes, createHash } from "node:crypto";
import type {
  CloudRecord,
  CloudWrite,
  CompassKeyInfo,
} from "../../shared/cloud";
import type { Workspace } from "../../client/src/domain/types";
import { emptyWorkspace, isSameFocus } from "./validation";

export type StoredWorkspace = {
  userId: number;
  workspace: Workspace;
  revision: number;
  updatedAt: string;
  timeZone: string;
  focusOwnerClientId: string | null;
};

export type NewStoredWorkspace = Omit<StoredWorkspace, "updatedAt"> & {
  updatedAt: Date;
};

export type StoredCompassKey = CompassKeyInfo & {
  userId: number;
  tokenHash: string;
  refreshTokenHash?: string | null;
  refreshExpiresAt?: string | null;
  oauthClientId?: string | null;
};

export type WorkspaceRecoveryCopy = {
  id: string;
  at: string;
  workspace: Workspace;
};

export interface SteadierRepository {
  readWorkspace(userId: number): Promise<StoredWorkspace | null>;
  listWorkspaceRecoveries(
    userId: number,
    limit: number
  ): Promise<WorkspaceRecoveryCopy[]>;
  insertWorkspace(workspace: NewStoredWorkspace): Promise<boolean>;
  /** Atomic revision compare-and-set; snapshots the actual prior document when replacement is true. */
  updateWorkspace(
    workspace: NewStoredWorkspace & {
      baseRevision: number;
      replacement: boolean;
    }
  ): Promise<boolean>;
  listCompassKeys(userId: number): Promise<CompassKeyInfo[]>;
  createCompassKey(key: {
    userId: number;
    tokenHash: string;
    label: string;
    createdAt: Date;
    expiresAt: Date;
    /** Defaults to read-only. */
    scope?: string;
    refreshTokenHash?: string;
    refreshExpiresAt?: Date;
    oauthClientId?: string;
    connectorActor?: "claude" | "chatgpt" | "connector";
  }): Promise<CompassKeyInfo>;
  revokeCompassKey(
    userId: number,
    keyId: number,
    revokedAt: Date
  ): Promise<boolean>;
  findCompassKeyByHash(tokenHash: string): Promise<StoredCompassKey | null>;
  findCompassKeyByRefreshHash?(
    tokenHash: string
  ): Promise<StoredCompassKey | null>;
  rotateCompassOAuthKey?(input: {
    userId: number;
    keyId: number;
    clientId: string;
    priorRefreshHash: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    scope: string;
    expiresAt: Date;
    refreshExpiresAt: Date;
    rotatedAt: Date;
  }): Promise<boolean>;
  touchCompassKey(keyId: number, usedAt: Date): Promise<void>;
  checkSchema(): Promise<void>;
}

export class WorkspaceConflictError extends Error {
  constructor(
    readonly code: "CONFLICT" | "FOCUS_OWNERSHIP",
    readonly record: CloudRecord
  ) {
    super(code);
    this.name = "WorkspaceConflictError";
  }
}

export function cloudRecordFromStored(record: StoredWorkspace): CloudRecord {
  return {
    workspace: record.workspace,
    revision: record.revision,
    updatedAt: record.updatedAt,
    // One calendar for every device and every Claude read: Adelaide.
    timeZone: STEADIER_TIME_ZONE,
    focusOwnerClientId: record.focusOwnerClientId,
  };
}

export function emptyCloudRecord(): CloudRecord {
  return {
    workspace: emptyWorkspace(),
    revision: 0,
    updatedAt: null,
    timeZone: STEADIER_TIME_ZONE,
    focusOwnerClientId: null,
  };
}

function focusOwnerForWrite(
  current: CloudRecord,
  write: CloudWrite
): string | null {
  const currentFocus = current.workspace.focus;
  const nextFocus = write.workspace.focus;
  const priorOwner = current.focusOwnerClientId;
  if (
    currentFocus?.running &&
    priorOwner !== null &&
    priorOwner !== write.clientId &&
    !write.claimFocus &&
    !isSameFocus(currentFocus, nextFocus)
  ) {
    throw new WorkspaceConflictError("FOCUS_OWNERSHIP", current);
  }

  if (!nextFocus || !nextFocus.running) return null;
  if (write.claimFocus) return write.clientId;
  // A non-focus edit may preserve another device's uninterrupted focus ownership.
  return priorOwner;
}

/**
 * Save only against the caller's base revision. An insert collision is converted
 * to the same conflict envelope as an update collision.
 */
export async function saveWorkspace(
  repository: SteadierRepository,
  userId: number,
  write: CloudWrite,
  now = new Date()
): Promise<CloudRecord> {
  const existing = await repository.readWorkspace(userId);
  const current = existing
    ? cloudRecordFromStored(existing)
    : emptyCloudRecord();
  if (write.baseRevision !== current.revision) {
    throw new WorkspaceConflictError("CONFLICT", current);
  }

  const focusOwnerClientId = focusOwnerForWrite(current, write);
  const candidate: NewStoredWorkspace = {
    userId,
    workspace: write.workspace,
    revision: current.revision + 1,
    updatedAt: now,
    // A device reporting UTC (or travelling) never moves the planning calendar.
    timeZone: STEADIER_TIME_ZONE,
    focusOwnerClientId,
  };

  const saved = existing
    ? await repository.updateWorkspace({
        ...candidate,
        baseRevision: current.revision,
        replacement: write.replacement === true,
      })
    : await repository.insertWorkspace(candidate);

  if (!saved) {
    const latest = await repository.readWorkspace(userId);
    throw new WorkspaceConflictError(
      "CONFLICT",
      latest ? cloudRecordFromStored(latest) : emptyCloudRecord()
    );
  }

  // A post-CAS reread can acknowledge a different device's later revision. Return
  // exactly the candidate this request successfully committed instead.
  return {
    workspace: candidate.workspace,
    revision: candidate.revision,
    updatedAt: candidate.updatedAt.toISOString(),
    timeZone: candidate.timeZone,
    focusOwnerClientId: candidate.focusOwnerClientId,
  };
}

export function hashCompassToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createCompassToken(): string {
  // 32 random bytes are sufficient entropy; only the SHA-256 digest is persisted.
  return `stdr_${randomBytes(32).toString("base64url")}`;
}

export function createCompassRefreshToken(): string {
  return `stdr_rt_${randomBytes(32).toString("base64url")}`;
}

export const COMPASS_KEY_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_COMPASS_KEYS = 5;

export async function createCompassKey(
  repository: SteadierRepository,
  userId: number,
  label: string,
  now = new Date(),
  scope: CompassGrantedScope = COMPASS_READ_SCOPE,
  oauth: {
    refreshTokenHash?: string;
    refreshExpiresAt?: Date;
    oauthClientId?: string;
    connectorActor?: "claude" | "chatgpt" | "connector";
  } = {}
): Promise<{ token: string; info: CompassKeyInfo }> {
  const existing = await repository.listCompassKeys(userId);
  const activeKeys = existing.filter(
    key => key.revokedAt === null && Date.parse(key.expiresAt) > now.getTime()
  );
  if (activeKeys.length >= MAX_ACTIVE_COMPASS_KEYS) {
    const error = new Error("At most five active Compass keys are allowed.");
    error.name = "CompassKeyLimitError";
    throw error;
  }

  const token = createCompassToken();
  const info = await repository.createCompassKey({
    userId,
    tokenHash: hashCompassToken(token),
    label,
    createdAt: now,
    expiresAt: new Date(now.getTime() + COMPASS_KEY_LIFETIME_MS),
    scope,
    ...oauth,
  });
  return { token, info };
}

export async function authenticateCompassToken(
  repository: SteadierRepository,
  authorization: string | undefined,
  now = new Date()
): Promise<{ userId: number; key: CompassKeyInfo }> {
  const match = /^Bearer (stdr_[A-Za-z0-9_-]{40,})$/.exec(authorization ?? "");
  if (!match) {
    const error = new Error("Invalid Compass token.");
    error.name = "CompassAuthenticationError";
    throw error;
  }
  const stored = await repository.findCompassKeyByHash(
    hashCompassToken(match[1])
  );
  if (
    !stored ||
    stored.revokedAt !== null ||
    Date.parse(stored.expiresAt) <= now.getTime()
  ) {
    const error = new Error("Invalid Compass token.");
    error.name = "CompassAuthenticationError";
    throw error;
  }
  await repository.touchCompassKey(stored.id, now);
  const { userId, tokenHash: _tokenHash, ...key } = stored;
  return { userId, key };
}
