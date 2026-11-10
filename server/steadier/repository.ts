import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  steadierCompassKeys,
  steadierPendingDeletes,
  steadierWorkspaceBackups,
  steadierWorkspaceRecoveries,
  steadierWorkspaces,
} from "../../drizzle/schema";
import { STEADIER_TIME_ZONE, formatAdelaide } from "../../shared/time";
import { COMPASS_READ_SCOPE } from "../../shared/compassConnection";
import {
  BACKUP_LIMIT,
  type CommitWithBackupInput,
  type WorkspaceBackupDocument,
  type WorkspaceChangeRepository,
} from "./changes";
import { getDb } from "../db";
import { parseStrictV2Workspace } from "./validation";
import type {
  NewStoredWorkspace,
  SteadierRepository,
  StoredCompassKey,
  StoredWorkspace,
  WorkspaceRecoveryCopy,
} from "./service";
import type {
  CompassKeyInfo,
  PendingDeleteRequest,
  WorkspaceBackupSummary,
} from "../../shared/cloud";

class CompareAndSetMiss extends Error {}

function requireDate(value: Date | string, field: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Stored ${field} is not a valid timestamp.`);
  }
  return date;
}

function asIso(value: Date | string, field: string): string {
  return requireDate(value, field).toISOString();
}

function storedWorkspaceFromRow(
  row: typeof steadierWorkspaces.$inferSelect
): StoredWorkspace {
  let parsed: ReturnType<typeof parseStrictV2Workspace>;
  try {
    parsed = parseStrictV2Workspace(JSON.parse(row.workspaceJson));
  } catch (error) {
    throw new Error(
      `Stored Steadier workspace is invalid: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
  return {
    userId: row.ownerId,
    workspace: parsed,
    revision: row.revision,
    updatedAt: asIso(row.updatedAt, "workspace updatedAt"),
    timeZone: row.timeZone,
    focusOwnerClientId: row.focusOwnerClientId,
  };
}

function compassKeyInfoFromRow(
  row: typeof steadierCompassKeys.$inferSelect
): CompassKeyInfo {
  return {
    id: row.id,
    label: row.label,
    createdAt: asIso(row.createdAt, "key createdAt"),
    expiresAt: asIso(row.expiresAt, "key expiresAt"),
    lastUsedAt: row.lastUsedAt ? asIso(row.lastUsedAt, "key lastUsedAt") : null,
    revokedAt: row.revokedAt ? asIso(row.revokedAt, "key revokedAt") : null,
    scope: row.scope,
    ...(row.connectorActor ? { connectorActor: row.connectorActor } : {}),
  };
}

function backupSummaryFromRow(
  row: Omit<typeof steadierWorkspaceBackups.$inferSelect, "workspaceJson">
): WorkspaceBackupSummary {
  const createdAt = asIso(row.createdAt, "backup createdAt");
  return {
    id: row.id,
    createdAt,
    createdAtLocal: formatAdelaide(createdAt),
    actor: row.actor,
    reason: row.reason,
    sourceRevision: row.sourceRevision,
    taskCount: row.taskCount,
    projectCount: row.projectCount,
  };
}

function pendingDeleteFromRow(
  row: typeof steadierPendingDeletes.$inferSelect
): PendingDeleteRequest {
  const requestedAt = asIso(row.requestedAt, "pending delete requestedAt");
  return {
    id: row.id,
    itemKind: row.itemKind,
    itemId: row.itemId,
    itemTitle: row.itemTitle,
    reason: row.reason,
    requestedBy: row.requestedBy,
    status: row.status,
    requestedAt,
    requestedAtLocal: formatAdelaide(requestedAt),
    decidedAt: row.decidedAt
      ? asIso(row.decidedAt, "pending delete decidedAt")
      : null,
  };
}

class PendingDeleteAlreadyDecided extends Error {
  constructor() {
    super("This delete request was already decided.");
    this.name = "PendingDeleteAlreadyDecided";
  }
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

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "ER_DUP_ENTRY"
  );
}

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new Error("Database is unavailable.");
  return database;
}

/** Production repository. Connections are managed by Drizzle/mysql2, not per request. */
export class DrizzleSteadierRepository
  implements SteadierRepository, WorkspaceChangeRepository
{
  async readWorkspace(userId: number): Promise<StoredWorkspace | null> {
    const database = await requireDatabase();
    const [row] = await database
      .select()
      .from(steadierWorkspaces)
      .where(eq(steadierWorkspaces.ownerId, userId))
      .limit(1);
    return row ? storedWorkspaceFromRow(row) : null;
  }

  async listWorkspaceRecoveries(
    userId: number,
    limit: number
  ): Promise<WorkspaceRecoveryCopy[]> {
    const database = await requireDatabase();
    const rows = await database
      .select()
      .from(steadierWorkspaceRecoveries)
      .where(eq(steadierWorkspaceRecoveries.ownerId, userId))
      .orderBy(desc(steadierWorkspaceRecoveries.createdAt))
      .limit(limit);
    return rows.map(row => {
      let workspace: ReturnType<typeof parseStrictV2Workspace>;
      try {
        workspace = parseStrictV2Workspace(JSON.parse(row.workspaceJson));
      } catch (error) {
        throw new Error(
          `Stored Steadier recovery is invalid: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
      return {
        id: String(row.id),
        at: asIso(row.createdAt, "recovery createdAt"),
        workspace,
      };
    });
  }

  async insertWorkspace(workspace: NewStoredWorkspace): Promise<boolean> {
    const database = await requireDatabase();
    try {
      await database.insert(steadierWorkspaces).values({
        ownerId: workspace.userId,
        workspaceJson: JSON.stringify(workspace.workspace),
        revision: workspace.revision,
        timeZone: workspace.timeZone,
        focusOwnerClientId: workspace.focusOwnerClientId,
        updatedAt: workspace.updatedAt,
      });
      return true;
    } catch (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    }
  }

  async updateWorkspace(
    workspace: NewStoredWorkspace & {
      baseRevision: number;
      replacement: boolean;
    }
  ): Promise<boolean> {
    const database = await requireDatabase();
    try {
      await database.transaction(async transaction => {
        const [current] = await transaction
          .select()
          .from(steadierWorkspaces)
          .where(
            and(
              eq(steadierWorkspaces.ownerId, workspace.userId),
              eq(steadierWorkspaces.revision, workspace.baseRevision)
            )
          )
          .limit(1);
        if (!current) throw new CompareAndSetMiss();

        if (workspace.replacement) {
          await transaction.insert(steadierWorkspaceRecoveries).values({
            ownerId: current.ownerId,
            sourceRevision: current.revision,
            workspaceJson: current.workspaceJson,
            timeZone: current.timeZone,
            focusOwnerClientId: current.focusOwnerClientId,
            createdAt: workspace.updatedAt,
          });
        }

        const result = await transaction
          .update(steadierWorkspaces)
          .set({
            workspaceJson: JSON.stringify(workspace.workspace),
            revision: workspace.revision,
            timeZone: workspace.timeZone,
            focusOwnerClientId: workspace.focusOwnerClientId,
            updatedAt: workspace.updatedAt,
          })
          .where(
            and(
              eq(steadierWorkspaces.ownerId, workspace.userId),
              eq(steadierWorkspaces.revision, workspace.baseRevision)
            )
          );
        if (affectedRows(result) !== 1) throw new CompareAndSetMiss();
      });
      return true;
    } catch (error) {
      if (error instanceof CompareAndSetMiss) return false;
      throw error;
    }
  }

  async listCompassKeys(userId: number): Promise<CompassKeyInfo[]> {
    const database = await requireDatabase();
    const rows = await database
      .select()
      .from(steadierCompassKeys)
      .where(eq(steadierCompassKeys.ownerId, userId))
      .orderBy(desc(steadierCompassKeys.createdAt));
    return rows.map(compassKeyInfoFromRow);
  }

  async createCompassKey(key: {
    userId: number;
    tokenHash: string;
    label: string;
    createdAt: Date;
    expiresAt: Date;
    scope?: string;
    refreshTokenHash?: string;
    refreshExpiresAt?: Date;
    oauthClientId?: string;
    connectorActor?: "claude" | "chatgpt" | "connector";
  }): Promise<CompassKeyInfo> {
    const database = await requireDatabase();
    await database.insert(steadierCompassKeys).values({
      ownerId: key.userId,
      tokenHash: key.tokenHash,
      label: key.label,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
      scope: key.scope ?? COMPASS_READ_SCOPE,
      refreshTokenHash: key.refreshTokenHash ?? null,
      refreshExpiresAt: key.refreshExpiresAt ?? null,
      oauthClientId: key.oauthClientId ?? null,
      connectorActor: key.connectorActor ?? null,
    });
    const [stored] = await database
      .select()
      .from(steadierCompassKeys)
      .where(eq(steadierCompassKeys.tokenHash, key.tokenHash))
      .limit(1);
    if (!stored)
      throw new Error("Compass key was not readable after creation.");
    return compassKeyInfoFromRow(stored);
  }

  async revokeCompassKey(
    userId: number,
    keyId: number,
    revokedAt: Date
  ): Promise<boolean> {
    const database = await requireDatabase();
    const result = await database
      .update(steadierCompassKeys)
      .set({ revokedAt })
      .where(
        and(
          eq(steadierCompassKeys.ownerId, userId),
          eq(steadierCompassKeys.id, keyId)
        )
      );
    return affectedRows(result) === 1;
  }

  async findCompassKeyByHash(
    tokenHash: string
  ): Promise<StoredCompassKey | null> {
    const database = await requireDatabase();
    const [row] = await database
      .select()
      .from(steadierCompassKeys)
      .where(eq(steadierCompassKeys.tokenHash, tokenHash))
      .limit(1);
    if (!row) return null;
    return {
      userId: row.ownerId,
      tokenHash: row.tokenHash,
      refreshTokenHash: row.refreshTokenHash,
      refreshExpiresAt: row.refreshExpiresAt
        ? asIso(row.refreshExpiresAt, "key refreshExpiresAt")
        : null,
      oauthClientId: row.oauthClientId,
      ...compassKeyInfoFromRow(row),
    };
  }

  async findCompassKeyByRefreshHash(
    tokenHash: string
  ): Promise<StoredCompassKey | null> {
    const database = await requireDatabase();
    const [row] = await database
      .select()
      .from(steadierCompassKeys)
      .where(eq(steadierCompassKeys.refreshTokenHash, tokenHash))
      .limit(1);
    if (!row) return null;
    return {
      userId: row.ownerId,
      tokenHash: row.tokenHash,
      refreshTokenHash: row.refreshTokenHash,
      refreshExpiresAt: row.refreshExpiresAt
        ? asIso(row.refreshExpiresAt, "key refreshExpiresAt")
        : null,
      oauthClientId: row.oauthClientId,
      ...compassKeyInfoFromRow(row),
    };
  }

  async rotateCompassOAuthKey(input: {
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
  }): Promise<boolean> {
    const database = await requireDatabase();
    const result = await database
      .update(steadierCompassKeys)
      .set({
        tokenHash: input.accessTokenHash,
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
        refreshExpiresAt: input.refreshExpiresAt,
        scope: input.scope,
        lastUsedAt: input.rotatedAt,
      })
      .where(
        and(
          eq(steadierCompassKeys.id, input.keyId),
          eq(steadierCompassKeys.ownerId, input.userId),
          eq(steadierCompassKeys.oauthClientId, input.clientId),
          eq(steadierCompassKeys.refreshTokenHash, input.priorRefreshHash),
          isNull(steadierCompassKeys.revokedAt),
          gt(steadierCompassKeys.refreshExpiresAt, input.rotatedAt)
        )
      );
    return affectedRows(result) === 1;
  }

  async touchCompassKey(keyId: number, usedAt: Date): Promise<void> {
    const database = await requireDatabase();
    await database
      .update(steadierCompassKeys)
      .set({ lastUsedAt: usedAt })
      .where(eq(steadierCompassKeys.id, keyId));
  }

  /**
   * One transaction: snapshot the CURRENT stored document, prune to the newest
   * BACKUP_LIMIT, record pending-delete bookkeeping, then compare-and-set the
   * change. Any failure (including the backup insert) rolls everything back.
   */
  async commitWithBackup(input: CommitWithBackupInput): Promise<boolean> {
    const database = await requireDatabase();
    try {
      await database.transaction(async transaction => {
        const [current] = await transaction
          .select()
          .from(steadierWorkspaces)
          .where(
            and(
              eq(steadierWorkspaces.ownerId, input.userId),
              eq(steadierWorkspaces.revision, input.baseRevision)
            )
          )
          .limit(1);
        if (!current) throw new CompareAndSetMiss();
        const currentWorkspace = parseStrictV2Workspace(
          JSON.parse(current.workspaceJson)
        );

        await transaction.insert(steadierWorkspaceBackups).values({
          ownerId: current.ownerId,
          sourceRevision: current.revision,
          workspaceJson: current.workspaceJson,
          timeZone: STEADIER_TIME_ZONE,
          actor: input.backup.actor,
          reason: input.backup.reason.slice(0, 500),
          taskCount: currentWorkspace.tasks.length,
          projectCount: currentWorkspace.projects.length,
          createdAt: input.updatedAt,
        });
        const keep = await transaction
          .select({ id: steadierWorkspaceBackups.id })
          .from(steadierWorkspaceBackups)
          .where(eq(steadierWorkspaceBackups.ownerId, input.userId))
          .orderBy(desc(steadierWorkspaceBackups.id))
          .limit(BACKUP_LIMIT);
        const all = await transaction
          .select({ id: steadierWorkspaceBackups.id })
          .from(steadierWorkspaceBackups)
          .where(eq(steadierWorkspaceBackups.ownerId, input.userId));
        const keepIds = new Set(keep.map(row => row.id));
        const prune = all.map(row => row.id).filter(id => !keepIds.has(id));
        if (prune.length > 0) {
          await transaction
            .delete(steadierWorkspaceBackups)
            .where(
              and(
                eq(steadierWorkspaceBackups.ownerId, input.userId),
                inArray(steadierWorkspaceBackups.id, prune)
              )
            );
        }

        if (input.pendingDelete) {
          await transaction.insert(steadierPendingDeletes).values({
            ownerId: input.userId,
            itemKind: input.pendingDelete.itemKind,
            itemId: input.pendingDelete.itemId,
            itemTitle: input.pendingDelete.itemTitle.slice(0, 500),
            reason: input.pendingDelete.reason,
            requestedBy: input.pendingDelete.requestedBy,
            status: "pending",
            requestedAt: input.updatedAt,
          });
        }
        if (input.settlePendingDelete) {
          const settled = await transaction
            .update(steadierPendingDeletes)
            .set({
              status: input.settlePendingDelete.status,
              decidedAt: input.updatedAt,
            })
            .where(
              and(
                eq(steadierPendingDeletes.ownerId, input.userId),
                eq(steadierPendingDeletes.id, input.settlePendingDelete.id),
                eq(steadierPendingDeletes.status, "pending")
              )
            );
          if (affectedRows(settled) !== 1)
            throw new PendingDeleteAlreadyDecided();
        }

        const result = await transaction
          .update(steadierWorkspaces)
          .set({
            workspaceJson: JSON.stringify(input.workspace),
            revision: input.baseRevision + 1,
            timeZone: STEADIER_TIME_ZONE,
            focusOwnerClientId: input.focusOwnerClientId,
            updatedAt: input.updatedAt,
          })
          .where(
            and(
              eq(steadierWorkspaces.ownerId, input.userId),
              eq(steadierWorkspaces.revision, input.baseRevision)
            )
          );
        if (affectedRows(result) !== 1) throw new CompareAndSetMiss();
      });
      return true;
    } catch (error) {
      if (error instanceof CompareAndSetMiss) return false;
      throw error;
    }
  }

  async listWorkspaceBackups(
    userId: number,
    limit: number
  ): Promise<WorkspaceBackupSummary[]> {
    const database = await requireDatabase();
    const rows = await database
      .select({
        id: steadierWorkspaceBackups.id,
        ownerId: steadierWorkspaceBackups.ownerId,
        sourceRevision: steadierWorkspaceBackups.sourceRevision,
        timeZone: steadierWorkspaceBackups.timeZone,
        actor: steadierWorkspaceBackups.actor,
        reason: steadierWorkspaceBackups.reason,
        taskCount: steadierWorkspaceBackups.taskCount,
        projectCount: steadierWorkspaceBackups.projectCount,
        createdAt: steadierWorkspaceBackups.createdAt,
      })
      .from(steadierWorkspaceBackups)
      .where(eq(steadierWorkspaceBackups.ownerId, userId))
      .orderBy(desc(steadierWorkspaceBackups.id))
      .limit(limit);
    return rows.map(backupSummaryFromRow);
  }

  async readWorkspaceBackup(
    userId: number,
    backupId: number
  ): Promise<WorkspaceBackupDocument | null> {
    const database = await requireDatabase();
    const [row] = await database
      .select()
      .from(steadierWorkspaceBackups)
      .where(
        and(
          eq(steadierWorkspaceBackups.ownerId, userId),
          eq(steadierWorkspaceBackups.id, backupId)
        )
      )
      .limit(1);
    if (!row) return null;
    return {
      ...backupSummaryFromRow(row),
      workspace: parseStrictV2Workspace(JSON.parse(row.workspaceJson)),
    };
  }

  async listPendingDeletes(
    userId: number,
    status?: PendingDeleteRequest["status"]
  ): Promise<PendingDeleteRequest[]> {
    const database = await requireDatabase();
    const rows = await database
      .select()
      .from(steadierPendingDeletes)
      .where(
        status
          ? and(
              eq(steadierPendingDeletes.ownerId, userId),
              eq(steadierPendingDeletes.status, status)
            )
          : eq(steadierPendingDeletes.ownerId, userId)
      )
      .orderBy(desc(steadierPendingDeletes.id))
      .limit(100);
    return rows.map(pendingDeleteFromRow);
  }

  async findPendingDelete(
    userId: number,
    id: number
  ): Promise<PendingDeleteRequest | null> {
    const database = await requireDatabase();
    const [row] = await database
      .select()
      .from(steadierPendingDeletes)
      .where(
        and(
          eq(steadierPendingDeletes.ownerId, userId),
          eq(steadierPendingDeletes.id, id)
        )
      )
      .limit(1);
    return row ? pendingDeleteFromRow(row) : null;
  }

  async checkSchema(): Promise<void> {
    const database = await requireDatabase();
    // Querying every required table makes readiness fail closed before migrations run.
    await database.execute(sql`SELECT 1 FROM steadier_workspaces LIMIT 1`);
    await database.execute(
      sql`SELECT 1 FROM steadier_workspace_recoveries LIMIT 1`
    );
    await database.execute(sql`SELECT 1 FROM steadier_compass_keys LIMIT 1`);
    await database.execute(
      sql`SELECT refreshTokenHash, refreshExpiresAt, oauthClientId, connectorActor FROM steadier_compass_keys LIMIT 1`
    );
    await database.execute(
      sql`SELECT 1 FROM steadier_workspace_backups LIMIT 1`
    );
    await database.execute(sql`SELECT 1 FROM steadier_pending_deletes LIMIT 1`);
    await database.execute(
      sql`SELECT requestedBy FROM steadier_pending_deletes LIMIT 1`
    );
    await database.execute(
      sql`SELECT refreshEnabled FROM steadier_compass_oauth_clients LIMIT 1`
    );
    await database.execute(
      sql`SELECT offlineAccess FROM steadier_compass_oauth_codes LIMIT 1`
    );
    await database.execute(
      sql`SELECT connectorActor FROM steadier_compass_oauth_codes LIMIT 1`
    );
    await database.execute(
      sql`SELECT offlineAccess FROM steadier_compass_oauth_requests LIMIT 1`
    );
  }
}

export function createProductionRepository(): DrizzleSteadierRepository {
  return new DrizzleSteadierRepository();
}
