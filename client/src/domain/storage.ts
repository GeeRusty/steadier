import type { Workspace } from "./types";
import { validateWorkspace } from "./transfer";

export type WorkspaceKind = "demo" | "personal";

export interface RecoveryCopy {
  id: string;
  at: string;
  workspace: Workspace;
}

export const preferredWorkspaceKey = "steadier.preferred";

export function workspaceKey(kind: WorkspaceKind): string {
  return `steadier.workspace.v2.${kind}`;
}

export function legacyWorkspaceKey(kind: WorkspaceKind): string {
  return `steadier.workspace.v1.${kind}`;
}

export function recoveryKey(kind: WorkspaceKind): string {
  return `steadier.workspace.v2.${kind}.recovery`;
}

export function corruptCopyKey(kind: WorkspaceKind, at: string): string {
  return `steadier.workspace.v2.${kind}.corrupt.${at.replace(/[^A-Za-z0-9]/g, "-")}`;
}

function fail(message: string): never {
  throw new Error(`Could not read local recovery copies: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validInstant(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function dayOf(at: string): string {
  return at.slice(0, 10);
}

function validRecoveryId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  );
}

/** Validate the bounded one-copy-per-day recovery format before it is displayed. */
export function validateRecoveryCopies(value: unknown): RecoveryCopy[] {
  if (!Array.isArray(value) || value.length > 3) {
    fail("expected at most three recovery copies.");
  }
  const days = new Set<string>();
  const ids = new Set<string>();
  const copies = value.map((copy, index) => {
    if (!isRecord(copy)) fail(`copy ${index + 1} is not an object.`);
    const keys = Object.keys(copy);
    if (
      keys.length !== 3 ||
      keys.some(key => !["id", "at", "workspace"].includes(key))
    ) {
      fail(`copy ${index + 1} has unknown or missing fields.`);
    }
    if (!validRecoveryId(copy.id)) fail(`copy ${index + 1} has an invalid ID.`);
    if (ids.has(copy.id)) fail("copy IDs must be unique.");
    ids.add(copy.id);
    if (typeof copy.at !== "string" || !validInstant(copy.at)) {
      fail(`copy ${index + 1} has an invalid timestamp.`);
    }
    const day = dayOf(copy.at);
    if (days.has(day)) fail("recovery copies must be from different days.");
    days.add(day);
    if (
      !isRecord(copy.workspace) ||
      copy.workspace.version !== 2
    ) {
      fail("recovery copy is not a version 2 workspace.");
    }
    const workspace = validateWorkspace(copy.workspace);
    return { id: copy.id, at: copy.at, workspace };
  });
  return [...copies].sort((left, right) => right.at.localeCompare(left.at));
}

/**
 * Add at most one snapshot per calendar day. A forced snapshot refreshes that
 * day's copy immediately before a deliberate full restore.
 */
export function addRecoveryCopy(
  copies: RecoveryCopy[],
  workspace: Workspace,
  at: string,
  id: string,
  force = false
): RecoveryCopy[] {
  if (!validInstant(at)) throw new Error("Recovery copy timestamp is invalid.");
  const checked = validateWorkspace(workspace);
  const day = dayOf(at);
  const existing = copies.find(copy => dayOf(copy.at) === day);
  if (existing && !force) return copies;

  const next: RecoveryCopy = {
    id: existing?.id ?? id,
    at,
    workspace: checked,
  };
  const withoutDay = copies.filter(copy => dayOf(copy.at) !== day);
  return [...withoutDay, next]
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 3);
}
