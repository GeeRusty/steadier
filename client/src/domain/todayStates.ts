/**
 * The four task states shown on every screen (v2.8, display only).
 *
 * Every open task is exactly one state, checked in this order, first match
 * wins:
 *   1. Scheduled: it has a time.
 *   2. Chosen: the owner picked it (today's intention task or the running
 *      focus task).
 *   3. Suggested: Steadier proposes it (today's suggestions) or a home for it
 *      awaits the owner's Confirm (from Steadier, Claude or ChatGPT).
 *   4. Held: everything else still open.
 * Someday, Deferred, Waiting and Blocked stay as they are; they only appear
 * as a small reason tag on held cards. Nothing here is stored.
 */
import { CATCH_ALL_LABEL, pendingPlacement } from "./compass";
import { isTaskAnchor } from "./anchorPlanning";
import { derivedState } from "./engine";
import type { AttentionResult, Task, Workspace } from "./types";

export type TaskKind = "scheduled" | "chosen" | "suggested" | "held";

export interface KindContext {
  chosenIds: Set<string>;
  suggestedIds: Set<string>;
}

export const KIND_LABEL: Record<TaskKind, string> = {
  scheduled: "Scheduled",
  chosen: "Chosen",
  suggested: "Suggested",
  held: "Held",
};

export function kindContext(
  workspace: Workspace,
  result: Pick<AttentionResult, "items"> | null,
  day: string
): KindContext {
  const chosenIds = new Set<string>();
  const intention = workspace.intention;
  if (intention?.date === day && intention.taskId)
    chosenIds.add(intention.taskId);
  if (workspace.nextThing?.date === day && workspace.nextThing.taskId)
    chosenIds.add(workspace.nextThing.taskId);
  if (workspace.focus?.taskId) chosenIds.add(workspace.focus.taskId);
  const suggestedIds = new Set<string>();
  for (const item of result?.items ?? []) suggestedIds.add(item.task.id);
  for (const task of workspace.tasks)
    if (task.state !== "done" && pendingPlacement(task))
      suggestedIds.add(task.id);
  return { chosenIds, suggestedIds };
}

/** The task's one state, or null when it is done. */
export function taskKind(task: Task, ctx: KindContext): TaskKind | null {
  if (task.state === "done") return null;
  if (isTaskAnchor(task)) return "scheduled";
  if (ctx.chosenIds.has(task.id)) return "chosen";
  if (ctx.suggestedIds.has(task.id)) return "suggested";
  return "held";
}

/** Short reason tag for a held card, from the existing statuses. */
export function heldReason(task: Task, tasks: Task[]): string | null {
  const state = derivedState(task, tasks);
  if (
    state === "scheduled" &&
    !isTaskAnchor(task) &&
    (task.schedule.date || task.schedule.time || task.schedule.flexibleWindow)
  )
    return "Date set, not booked";
  switch (state) {
    case "someday":
      return "Someday";
    case "deferred":
      return "Deferred";
    case "waiting":
      return "Waiting";
    case "blocked":
      return "Blocked";
    case "scheduled":
      return "Starts later";
    case "inbox":
      return "No next action";
    default:
      return null;
  }
}

/** "[n] active · [n] held": active = scheduled + chosen. */
export function kindCounts(tasks: Task[], ctx: KindContext) {
  let active = 0;
  let suggested = 0;
  let held = 0;
  for (const task of tasks) {
    const kind = taskKind(task, ctx);
    if (kind === "scheduled" || kind === "chosen") active++;
    else if (kind === "suggested") suggested++;
    else if (kind === "held") held++;
  }
  return { active, suggested, held };
}

export function countLabel(counts: { active: number; held: number }): string {
  return `${counts.active} active · ${counts.held} held`;
}

/**
 * Who proposed a pending home: the latest connector line in the task's
 * history names Claude or ChatGPT; otherwise Steadier suggested it.
 */
export function suggestionSource(task: Task): string {
  for (let i = task.history.length - 1; i >= 0; i--) {
    const text = task.history[i].text;
    if (text.startsWith("ChatGPT:")) return "ChatGPT";
    if (text.startsWith("Claude:")) return "Claude";
    if (text.startsWith("MCP connector:")) return "Connector";
  }
  return "Steadier";
}

/** Plain title of what a pending home would be, for the Confirm card. */
export function pendingHomeLabel(task: Task, workspace: Workspace): string {
  const kind = pendingPlacement(task);
  if (kind === "project")
    return (
      workspace.projects.find(p => p.id === task.projectId)?.title ?? "Project"
    );
  if (kind === "imperative") {
    const titles = task.compass.imperativeIds
      .map(id => workspace.imperatives.find(i => i.id === id)?.title)
      .filter(Boolean);
    return titles.join(", ") || "Imperative";
  }
  if (kind === "catch-all")
    return task.compass.catchAll
      ? CATCH_ALL_LABEL[task.compass.catchAll]
      : "Catch-all";
  if (kind === "parent")
    return (
      workspace.tasks.find(t => t.id === task.parent?.id)?.title ?? "Parent"
    );
  return "";
}

/** Days since the last backup download, or null when never downloaded. */
export function daysSinceBackup(
  lastExportAt: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!lastExportAt) return null;
  const at = Date.parse(lastExportAt);
  if (!Number.isFinite(at)) return null;
  return Math.floor((now.getTime() - at) / 86_400_000);
}

/** Backup is overdue: never downloaded, or no download in 7 days. */
export function backupOverdue(
  lastExportAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  const days = daysSinceBackup(lastExportAt, now);
  return days === null || days >= 7;
}

/** A next step is worth clarifying only when none is set. */
export function needsClarify(task: Task, dismissed: Set<string>): boolean {
  return !task.nextAction.trim() && !dismissed.has(task.id);
}
