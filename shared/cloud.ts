import type { Workspace } from "../client/src/domain/types";

export interface CloudUser {
  id: number;
  name: string | null;
}
export interface CloudRecord {
  workspace: Workspace;
  revision: number;
  updatedAt: string | null;
  timeZone: string;
  focusOwnerClientId: string | null;
}
export interface CloudWrite {
  workspace: Workspace;
  baseRevision: number;
  clientId: string;
  timeZone?: string;
  claimFocus?: boolean;
  replacement?: boolean;
}
export interface CompassKeyInfo {
  id: number;
  label: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** "steadier:read" or "steadier:read steadier:write". */
  scope: string;
  connectorActor?: "claude" | "chatgpt" | "connector";
}
export type ConnectorActor = "claude" | "chatgpt" | "connector";
export type ChangeActor = ConnectorActor | "owner";
/** A dated server snapshot of the whole workspace, taken before a change. */
export interface WorkspaceBackupSummary {
  id: number;
  createdAt: string;
  createdAtLocal: string;
  actor: ChangeActor;
  reason: string;
  sourceRevision: number;
  taskCount: number;
  projectCount: number;
}
export interface PendingDeleteRequest {
  id: number;
  itemKind: "task" | "project";
  itemId: string;
  itemTitle: string;
  reason: string;
  requestedBy?: ConnectorActor;
  status: "pending" | "deleted" | "kept";
  requestedAt: string;
  requestedAtLocal: string;
  decidedAt: string | null;
}
export type CloudStatus =
  | "local"
  | "loading"
  | "synced"
  | "saving"
  | "offline"
  | "conflict"
  | "error";
