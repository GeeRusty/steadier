import type { DecisionOutcome } from "./compass";
import type { Workspace } from "./types";

export interface DecisionLogEntry {
  id: string;
  at: string;
  date: string;
  kind: "task" | "project" | "imperative";
  itemId: string;
  title: string;
  outcome: DecisionOutcome;
  note: string;
}

export type EvidenceSource =
  | "Task history"
  | "Current task evidence"
  | "Project progress"
  | "Saved evidence";

export interface EvidenceFeedEntry {
  id: string;
  at: string | null;
  source: EvidenceSource;
  itemKind: "task" | "project";
  itemId: string;
  title: string;
  text: string;
  evidenceId?: string;
}

export function decisionLogEntries(workspace: Workspace): DecisionLogEntry[] {
  return (workspace.reviews ?? [])
    .flatMap(review =>
      (review.decisions ?? []).map((decision, index) => ({
        id: `${review.id}:${decision.kind}:${decision.id}:${index}`,
        at: review.at,
        date: review.date,
        kind: decision.kind,
        itemId: decision.id,
        title: decision.title,
        outcome: decision.outcome,
        note: decision.note,
      }))
    )
    .sort((left, right) => right.at.localeCompare(left.at));
}

export function evidenceFeedEntries(workspace: Workspace): EvidenceFeedEntry[] {
  const entries: EvidenceFeedEntry[] = [];
  for (const task of workspace.tasks) {
    task.history.forEach((item, index) => {
      if (!item.text.trim()) return;
      entries.push({
        id: `task-history:${task.id}:${index}`,
        at: item.at || null,
        source: "Task history",
        itemKind: "task",
        itemId: task.id,
        title: task.title,
        text: item.text,
      });
    });
    if (task.progressEvidence.trim()) {
      entries.push({
        id: `task-evidence:${task.id}`,
        at: null,
        source: "Current task evidence",
        itemKind: "task",
        itemId: task.id,
        title: task.title,
        text: task.progressEvidence,
      });
    }
  }
  for (const project of workspace.projects) {
    project.progress.forEach((item, index) => {
      if (!item.text.trim()) return;
      entries.push({
        id: `project-progress:${project.id}:${index}`,
        at: item.at || null,
        source: "Project progress",
        itemKind: "project",
        itemId: project.id,
        title: project.title,
        text: item.text,
      });
    });
  }
  for (const item of workspace.evidence ?? []) {
    const currentTitle =
      item.targetKind === "task"
        ? workspace.tasks.find(task => task.id === item.targetId)?.title
        : workspace.projects.find(project => project.id === item.targetId)
            ?.title;
    entries.push({
      id: `saved-evidence:${item.id}`,
      evidenceId: item.id,
      at: item.createdAt,
      source: "Saved evidence",
      itemKind: item.targetKind,
      itemId: item.targetId,
      title: currentTitle || item.titleSnapshot,
      text: item.text,
    });
  }
  return entries.sort((left, right) => {
    if (!left.at) return right.at ? 1 : 0;
    if (!right.at) return -1;
    return right.at.localeCompare(left.at);
  });
}
