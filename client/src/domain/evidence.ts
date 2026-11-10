import type { Workspace, WorkspaceEvidence } from "./types";

export const MAX_EVIDENCE_ENTRIES = 1000;
export const MAX_EVIDENCE_TEXT_LENGTH = 2000;

export interface EvidenceInput {
  targetKind: WorkspaceEvidence["targetKind"];
  targetId: string;
  text: string;
}

export function createEvidenceId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `evidence-${uuid}`;
  return `evidence-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Adds only a user-requested evidence entry; it never creates or changes a task. */
export function appendEvidenceEntry(
  workspace: Workspace,
  input: EvidenceInput,
  at: string,
  id = createEvidenceId()
): Workspace {
  const text = input.text.trim();
  const existing = workspace.evidence ?? [];
  if (
    !text ||
    text.length > MAX_EVIDENCE_TEXT_LENGTH ||
    existing.length >= MAX_EVIDENCE_ENTRIES ||
    existing.some(entry => entry.id === id)
  ) {
    return workspace;
  }
  const target =
    input.targetKind === "task"
      ? workspace.tasks.find(task => task.id === input.targetId)
      : workspace.projects.find(project => project.id === input.targetId);
  if (!target) return workspace;
  const entry: WorkspaceEvidence = {
    id,
    targetKind: input.targetKind,
    targetId: input.targetId,
    titleSnapshot: target.title,
    text,
    createdAt: at,
    updatedAt: at,
  };
  return { ...workspace, evidence: [...existing, entry] };
}

export function removeEvidenceEntry(
  workspace: Workspace,
  id: string
): Workspace {
  const existing = workspace.evidence ?? [];
  const next = existing.filter(entry => entry.id !== id);
  return next.length === existing.length
    ? workspace
    : { ...workspace, evidence: next };
}
