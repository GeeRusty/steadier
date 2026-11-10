import type {
  ChangeActor,
  PendingDeleteRequest,
  WorkspaceBackupSummary,
} from "../../shared/cloud";
import type { Workspace } from "../../client/src/domain/types";
import { STEADIER_TIME_ZONE } from "../../shared/time";
import type { StoredWorkspace } from "./service";
import { parseStrictV2Workspace, ValidationError } from "./validation";

/** The newest snapshots kept per owner. Older ones are pruned in the same transaction. */
export const BACKUP_LIMIT = 20;
const MAX_ATTEMPTS = 3;

export type WorkspaceBackupDocument = WorkspaceBackupSummary & {
  workspace: Workspace;
};

export type NewPendingDelete = {
  itemKind: "task" | "project";
  itemId: string;
  itemTitle: string;
  reason: string;
  requestedBy: Exclude<ChangeActor, "owner">;
};

export type CommitWithBackupInput = {
  userId: number;
  baseRevision: number;
  workspace: Workspace;
  updatedAt: Date;
  focusOwnerClientId: string | null;
  backup: { actor: ChangeActor; reason: string };
  /** Recorded in the same transaction as the change. */
  pendingDelete?: NewPendingDelete;
  /** Settles an existing request in the same transaction as the change. */
  settlePendingDelete?: { id: number; status: "deleted" | "kept" };
};

/**
 * Storage needed for server-applied changes. The production implementation
 * inserts the pre-change snapshot, prunes to {@link BACKUP_LIMIT}, records any
 * pending-delete bookkeeping and performs the revision compare-and-set inside
 * ONE database transaction: if the backup cannot be written, nothing changes.
 */
export interface WorkspaceChangeRepository {
  readWorkspace(userId: number): Promise<StoredWorkspace | null>;
  /** Returns false only for a revision compare-and-set miss. Throws on backup failure. */
  commitWithBackup(input: CommitWithBackupInput): Promise<boolean>;
  listWorkspaceBackups(
    userId: number,
    limit: number
  ): Promise<WorkspaceBackupSummary[]>;
  readWorkspaceBackup(
    userId: number,
    backupId: number
  ): Promise<WorkspaceBackupDocument | null>;
  listPendingDeletes(
    userId: number,
    status?: PendingDeleteRequest["status"]
  ): Promise<PendingDeleteRequest[]>;
  findPendingDelete(
    userId: number,
    id: number
  ): Promise<PendingDeleteRequest | null>;
}

export class ChangeError extends Error {
  constructor(
    readonly code:
      | "NO_WORKSPACE"
      | "NOT_FOUND"
      | "INVALID_CHANGE"
      | "BACKUP_FAILED"
      | "BUSY"
      | "ALREADY_DECIDED"
      | "ALREADY_PENDING",
    message: string
  ) {
    super(message);
    this.name = "ChangeError";
  }
}

export type ChangePlan<T> = {
  workspace: Workspace;
  /** Human summary stored on the backup, e.g. "Claude: updated task …". */
  summary: string;
  result: T;
  pendingDelete?: NewPendingDelete;
  settlePendingDelete?: CommitWithBackupInput["settlePendingDelete"];
};

export type AppliedChange<T> = {
  result: T;
  revision: number;
  summary: string;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Apply one change against the latest server document. The planner receives a
 * private copy, so a thrown planning error never leaks a half-made change.
 */
export async function applyGuardedChange<T>(
  repository: WorkspaceChangeRepository,
  userId: number,
  actor: ChangeActor,
  plan: (current: Workspace) => ChangePlan<T>,
  now: () => Date = () => new Date()
): Promise<AppliedChange<T>> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const stored = await repository.readWorkspace(userId);
    if (!stored) {
      throw new ChangeError(
        "NO_WORKSPACE",
        "No shared My Life space exists on the server yet. Open Steadier, connect your shared personal space, and let it sync once."
      );
    }
    const planned = plan(clone(stored.workspace));
    let next: Workspace;
    try {
      next = parseStrictV2Workspace(planned.workspace);
    } catch (error) {
      throw new ChangeError(
        "INVALID_CHANGE",
        error instanceof ValidationError
          ? `The change was not applied because it would not form a valid workspace: ${error.message}`
          : "The change was not applied because it would not form a valid workspace."
      );
    }
    const focus = next.focus;
    let committed: boolean;
    try {
      committed = await repository.commitWithBackup({
        userId,
        baseRevision: stored.revision,
        workspace: next,
        updatedAt: now(),
        // Server-applied changes never take focus ownership from a device.
        focusOwnerClientId: focus?.running ? stored.focusOwnerClientId : null,
        backup: { actor, reason: planned.summary.slice(0, 500) },
        pendingDelete: planned.pendingDelete,
        settlePendingDelete: planned.settlePendingDelete,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "PendingDeleteAlreadyDecided"
      ) {
        throw new ChangeError(
          "ALREADY_DECIDED",
          "This delete request was already decided. Nothing else was changed."
        );
      }
      // The backup and the change share one transaction: either both or neither.
      throw new ChangeError(
        "BACKUP_FAILED",
        "The automatic backup could not be completed, so no change was made. Nothing in My Life was altered."
      );
    }
    if (committed) {
      return {
        result: planned.result,
        revision: stored.revision + 1,
        summary: planned.summary,
      };
    }
  }
  throw new ChangeError(
    "BUSY",
    "My Life changed on another device at the same moment. No change was made; read the context again and retry."
  );
}

export function backupTimeZone(): string {
  return STEADIER_TIME_ZONE;
}
