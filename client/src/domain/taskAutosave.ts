import type { CloudStatus } from "../../../shared/cloud";
import { createTask, updateTask } from "./engine";
import { scheduleFromQuickParse, type QuickParse } from "./quickParse";
import type { Task, Workspace } from "./types";

/** A short pause that avoids writing on each keystroke. */
export const TASK_AUTOSAVE_IDLE_MS = 800;

export interface TaskAutosaveCloudState {
  active: boolean;
  status: CloudStatus;
  pending: boolean;
  revision: number;
  lastSyncedAt: string | null;
}

export interface PendingTaskAutosave {
  token: number;
  task: Task;
  baseRevision: number;
  baseLastSyncedAt: string | null;
}

export type TaskAutosaveSaveResult =
  | {
      accepted: true;
      task: Task;
      serverPending: boolean;
      ticket: PendingTaskAutosave | null;
    }
  | {
      accepted: false;
      reason: "stale" | "blocked" | "invalid";
      message: string;
    };

export function hasMeaningfulTaskTitle(title: string): boolean {
  return title.trim().length > 0;
}

/** Exclude quick-add input that contains only timing/recurrence metadata. */
export function hasMeaningfulParsedTaskTitle(title: string): boolean {
  const value = title.trim();
  if (!hasMeaningfulTaskTitle(value)) return false;
  const normalizedTitle = value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim();
  if (
    [
      "untitled",
      "untitled task",
      "new task",
      "new calendar task",
      "calendar draft",
      "capture draft",
      "task title",
      "enter a task",
    ].includes(normalizedTitle)
  )
    return false;
  const metadataOnly =
    /^(?:for\s+)?\d+(?:\.\d+)?\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours)(?:\s+\d+(?:\.\d+)?\s*(?:m|min|mins|minute|minutes))?$/i.test(
      value
    ) ||
    /^(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i.test(value) ||
    /^(?:today|tomorrow|tonight|this weekend|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})$/i.test(
      value
    ) ||
    /^(?:every|each)\s+(?:day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?$/i.test(
      value
    );
  return !metadataOnly;
}

/** Empty or flexible-window drafts must not create a Calendar time-block. */
export function canAutosaveCalendarDraft(
  parsedTitle: string,
  isFlexibleWindow: boolean
): boolean {
  return hasMeaningfulParsedTaskTitle(parsedTitle) && !isFlexibleWindow;
}

/** Build a Calendar draft only after a meaningful parsed title exists. */
export function buildCalendarDraftTask(
  existing: Task | null,
  parsed: QuickParse,
  placement: { date: string; start: number | null }
): Task | null {
  if (!canAutosaveCalendarDraft(parsed.title, Boolean(parsed.flexibleWindow)))
    return null;
  const parsedSchedule = scheduleFromQuickParse(parsed, {
    fallbackDate: placement.date,
    fallbackTime:
      placement.start === null
        ? null
        : `${String(Math.floor(placement.start / 60)).padStart(2, "0")}:${String(placement.start % 60).padStart(2, "0")}`,
    flexibleWindowReminders: "none",
  });
  if (!existing)
    return createTask({
      title: parsed.title.trim(),
      estimate: parsed.minutes ?? 15,
      deadline: parsed.deadline,
      schedule: { ...parsedSchedule, fixed: true },
    });

  return {
    ...existing,
    title: parsed.title.trim(),
    estimate: parsed.minutes ?? existing.estimate,
    deadline: parsed.deadline ?? existing.deadline,
    schedule: {
      ...existing.schedule,
      date: parsedSchedule.date ?? existing.schedule.date,
      time: parsedSchedule.time ?? existing.schedule.time,
      minutes: parsed.minutes ?? existing.schedule.minutes,
      fixed: true,
      repeat: parsed.repeat ? parsedSchedule.repeat : existing.schedule.repeat,
      reminders: parsed.reminders.length
        ? parsedSchedule.reminders
        : existing.schedule.reminders,
      deadlineTime: parsed.deadlineTime ?? existing.schedule.deadlineTime,
    },
  };
}

/**
 * Compare editable task content without treating audit timestamps/history as
 * user edits. The persisted/server acknowledgement check below remains exact.
 */
export function taskEditFingerprint(task: Task): string {
  const { updatedAt: _updatedAt, history: _history, ...editable } = task;
  return JSON.stringify(editable);
}

export function taskDraftChanged(draft: Task, saved: Task): boolean {
  return taskEditFingerprint(draft) !== taskEditFingerprint(saved);
}

/** Exact baseline comparison for all preflight and in-mutation stale checks. */
export function taskMatchesExpectedSnapshot(
  current: Task | undefined,
  expected: Task
): boolean {
  return Boolean(current && current.id === expected.id && JSON.stringify(current) === JSON.stringify(expected));
}

export type TaskDraftApplyResult =
  | { accepted: true; workspace: Workspace; task: Task }
  | {
      accepted: false;
      reason: "stale" | "invalid";
      message: string;
      workspace: Workspace;
    };

/** Apply one ordinary draft through the existing task updater, never a stale snapshot. */
export function applyTaskDraftToWorkspace(
  workspace: Workspace,
  baseline: Task,
  draft: Task,
  historyNote = "Saved task details"
): TaskDraftApplyResult {
  const current = workspace.tasks.find(item => item.id === baseline.id);
  if (!taskMatchesExpectedSnapshot(current, baseline))
    return {
      accepted: false,
      reason: "stale",
      message:
        "This task changed elsewhere. Your draft is preserved; reopen the current version before saving.",
      workspace,
    };
  if (!hasMeaningfulTaskTitle(draft.title))
    return {
      accepted: false,
      reason: "invalid",
      message: "A non-empty task title is required. The blank draft was not saved.",
      workspace,
    };
  if (baseline.state !== "done" && draft.state === "done")
    return {
      accepted: false,
      reason: "invalid",
      message: "Use the explicit Done control to complete this task.",
      workspace,
    };

  const updated = updateTask(current!, draft, historyNote);
  const nextTask = draft.parent
    ? updated
    : (({ parent: _parent, ...rest }) => rest)(updated);
  return {
    accepted: true,
    task: nextTask,
    workspace: {
      ...workspace,
      tasks: workspace.tasks.map(item =>
        item.id === baseline.id ? nextTask : item
      ),
    },
  };
}

/** Create a new draft once, or update only the exact snapshot the editor owns. */
export function applyTaskAutosaveToWorkspace(
  workspace: Workspace,
  baseline: Task | null,
  draft: Task,
  historyNote = "Autosaved task details."
): TaskDraftApplyResult {
  if (baseline)
    return applyTaskDraftToWorkspace(workspace, baseline, draft, historyNote);
  if (!hasMeaningfulParsedTaskTitle(draft.title))
    return {
      accepted: false,
      reason: "invalid",
      message:
        "A meaningful task title is required. Blank, placeholder, or metadata-only drafts are not saved.",
      workspace,
    };
  if (draft.state === "done")
    return {
      accepted: false,
      reason: "invalid",
      message: "Use the explicit Done control to complete a task.",
      workspace,
    };
  if (workspace.tasks.some(item => item.id === draft.id))
    return {
      accepted: false,
      reason: "stale",
      message:
        "A task with this draft ID already exists. Nothing was overwritten; review the current task first.",
      workspace,
    };
  return {
    accepted: true,
    task: draft,
    workspace: { ...workspace, tasks: [...workspace.tasks, draft] },
  };
}

export function taskAutosaveBlockReason(input: {
  title: string;
  voiceDraftPending: boolean;
  stale: boolean;
  workspaceConflict: boolean;
  aiSuggestionPending?: boolean;
}):
  | "empty-title"
  | "voice-draft"
  | "stale"
  | "conflict"
  | "suggestion-pending"
  | null {
  if (input.stale) return "stale";
  if (input.workspaceConflict) return "conflict";
  if (input.voiceDraftPending) return "voice-draft";
  if (input.aiSuggestionPending) return "suggestion-pending";
  if (!hasMeaningfulTaskTitle(input.title)) return "empty-title";
  return null;
}

/** Coalesce edits and expose an explicit flush for field blur / manual action. */
export function createAutosaveDebouncer<T, R = void>(
  save: (value: T) => R,
  delayMs = TASK_AUTOSAVE_IDLE_MS
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: T;
  let hasLatest = false;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const commit = (): R | undefined => {
    clearTimer();
    if (!hasLatest) return undefined;
    const value = latest;
    hasLatest = false;
    return save(value);
  };

  return {
    schedule(value: T) {
      latest = value;
      hasLatest = true;
      clearTimer();
      timer = setTimeout(commit, delayMs);
    },
    flush: commit,
    cancel() {
      clearTimer();
      hasLatest = false;
    },
    pending() {
      return hasLatest;
    },
  };
}

/**
 * A wash is allowed only when the exact local snapshot queued by an autosave
 * is now the fully acknowledged server snapshot. Reduced-motion users retain
 * the static Saved indicator and skip the visual wash.
 */
export function isServerConfirmedAutosave(
  ticket: PendingTaskAutosave,
  cloud: TaskAutosaveCloudState,
  serverTask: Task | undefined,
  prefersReducedMotion = false
): boolean {
  if (prefersReducedMotion || !cloud.active) return false;
  if (cloud.status !== "synced" || cloud.pending) return false;
  if (cloud.revision <= ticket.baseRevision) return false;
  if (!cloud.lastSyncedAt || cloud.lastSyncedAt === ticket.baseLastSyncedAt)
    return false;
  return Boolean(
    serverTask &&
      serverTask.id === ticket.task.id &&
      JSON.stringify(serverTask) === JSON.stringify(ticket.task)
  );
}

export function autosaveSyncAdvanced(
  ticket: PendingTaskAutosave,
  cloud: TaskAutosaveCloudState
): boolean {
  return Boolean(
    cloud.active &&
      cloud.status === "synced" &&
      !cloud.pending &&
      cloud.revision > ticket.baseRevision &&
      cloud.lastSyncedAt &&
      cloud.lastSyncedAt !== ticket.baseLastSyncedAt
  );
}
