import { emptyTaskCompass } from "./compass";
import { isCardTask, isSetUp, setUpReason } from "./taskCard";
import type {
  AttentionItem,
  AttentionResult,
  Context,
  DerivedState,
  Task,
  TaskState,
  MatrixWeights,
} from "./types";

import { suggestIdentity } from "./life";
import {
  copyTaskSchedule,
  describeFlexibleWindow,
  emptyRepeat,
  emptyTaskSchedule,
  flexibleWindowState,
  flexibleCompletionNote,
  formatTime,
  isTimingAnchor,
  nextOccurrence,
  shiftFlexibleWindow,
  type RepeatRule,
} from "./time";
import { adelaideDate, adelaideTimestamp } from "../../../shared/time";

const DAY = 24 * 60 * 60 * 1000;

/** Format a Date as a calendar day in the device's local time zone. */
function formatLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Calendar dates are deliberately constructed at local noon. This avoids DST
 * transitions and avoids interpreting YYYY-MM-DD as a UTC timestamp.
 */
function localNoon(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match)
    throw new RangeError(`Expected a local calendar date, received ${value}`);
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12
  );
  if (formatLocalDate(date) !== value) {
    throw new RangeError(`Invalid local calendar date: ${value}`);
  }
  return date;
}

function isCalendarDate(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    localNoon(value);
    return true;
  } catch {
    return false;
  }
}

function currentDay(now?: string): string {
  if (now === undefined) return today();
  // Callers pass calendar dates. Accepting an ISO timestamp's calendar prefix
  // also makes storage migrations harmless without ever converting via UTC.
  const day = now.slice(0, 10);
  localNoon(day);
  return day;
}

/**
 * With an explicit calendar day (tests, imports, recurrence) keep the
 * historical day-only noon stamp. Otherwise record the real Adelaide time.
 */
function localTimestamp(day?: string): string {
  if (day === undefined) return adelaideTimestamp();
  return `${currentDay(day)}T12:00:00`;
}

function copyChecklist(checklist: Task["checklist"]): Task["checklist"] {
  return checklist.map(item => ({ ...item }));
}

function freshId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function dueDays(task: Task, now: string): number | null {
  return isCalendarDate(task.deadline) ? daysUntil(task.deadline, now) : null;
}

function reviewDays(task: Task, now: string): number | null {
  return isCalendarDate(task.reviewDate)
    ? daysUntil(task.reviewDate, now)
    : null;
}

function contextMatches(task: Task, context: Context | undefined): boolean {
  if (!context || context === "anywhere") return true;
  return task.context === "anywhere" || task.context === context;
}

function relativeReviewReason(days: number): string {
  if (days === 0) return "Review due today.";
  return `Review overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}.`;
}

function actionReason(task: Task, now: string): string {
  const next = task.nextAction.trim();
  const preparation =
    isCalendarDate(task.preparationDate) &&
    daysUntil(task.preparationDate, now) <= 0
      ? `${task.preparationSource === "suggested" ? "Suggested preparation" : "Preparation planned"} from ${task.preparationDate}. `
      : "";
  const timing = isCalendarDate(task.deadline)
    ? `${deadlineLabel(task, now)}. `
    : "";
  const planned = plannedReason(task, now);
  return `${planned}${preparation}${timing}Next: ${next}`;
}

function plannedReason(task: Task, now: string): string {
  const window = task.schedule?.flexibleWindow;
  if (window) {
    const state = flexibleWindowState(window, now);
    const label = describeFlexibleWindow(window, now);
    if (state === "upcoming") return `Available ${label}. `;
    if (state === "active") return `Finish within ${label}. `;
    if (state === "closes-today") return "Window closes today. ";
    return `Window ended ${window.endDate}; needs rescheduling. `;
  }
  const date = task.schedule?.date;
  if (!isCalendarDate(date)) return "";
  const days = daysUntil(date, now);
  const at = task.schedule.time ? ` at ${formatTime(task.schedule.time)}` : "";
  if (days === 0) return `Planned for today${at}. `;
  if (days < 0) return `Planned for ${date}${at} and still open. `;
  return "";
}
interface Candidate extends AttentionItem {
  estimateForFilter: number;
  deadlineDays: number | null;
  reviewDays: number | null;
}

function candidateRank(candidate: Candidate): number {
  if (candidate.task.pinned) return 0;
  const hasAnchorDeadline = isTimingAnchor(
    candidate.task.schedule,
    candidate.task.deadline
  );
  if (
    candidate.deadlineDays !== null &&
    candidate.deadlineDays <= 0 &&
    (candidate.deadlineDays === 0 || hasAnchorDeadline)
  )
    return 1;
  // Planned for today (or an earlier day and still open).
  if (candidate.task.schedule?.date && candidate.kind === "action") return 1.5;
  if (
    candidate.deadlineDays !== null &&
    candidate.deadlineDays <= 3 &&
    (candidate.deadlineDays >= 0 || hasAnchorDeadline)
  )
    return 2;
  if (candidate.kind === "followup") return 3;
  if (candidate.kind === "review") return 4;
  return 5;
}

function compareCandidates(
  a: Candidate,
  b: Candidate,
  _weights?: MatrixWeights
): number {
  const rank = candidateRank(a) - candidateRank(b);
  if (rank !== 0) return rank;

  const aDeadline =
    a.deadlineDays !== null &&
    a.deadlineDays < 0 &&
    !isTimingAnchor(a.task.schedule, a.task.deadline)
      ? Number.POSITIVE_INFINITY
      : a.deadlineDays ?? Number.POSITIVE_INFINITY;
  const bDeadline =
    b.deadlineDays !== null &&
    b.deadlineDays < 0 &&
    !isTimingAnchor(b.task.schedule, b.task.deadline)
      ? Number.POSITIVE_INFINITY
      : b.deadlineDays ?? Number.POSITIVE_INFINITY;
  if (aDeadline !== bDeadline) return aDeadline - bDeadline;
  // The matrix describes work; it never orders it (Balance, not ranking).

  const aReview = a.reviewDays ?? Number.POSITIVE_INFINITY;
  const bReview = b.reviewDays ?? Number.POSITIVE_INFINITY;
  if (aReview !== bReview) return aReview - bReview;

  return a.task.id.localeCompare(b.task.id);
}

/** Return today's calendar date in local YYYY-MM-DD form. */
export function today(): string {
  // Steadier's calendar is Adelaide's, whatever zone this device reports.
  return adelaideDate();
}

/** Add calendar days using local noon, so DST never changes the requested day. */
export function addDays(date: string, days: number): string {
  if (!Number.isFinite(days) || !Number.isInteger(days)) {
    throw new RangeError("Days must be a finite integer");
  }
  const result = localNoon(date);
  result.setDate(result.getDate() + days);
  return formatLocalDate(result);
}

/** Number of local calendar days from now to date (negative means past). */
export function daysUntil(date: string, now?: string): number {
  const target = localNoon(date).getTime();
  const reference = localNoon(currentDay(now)).getTime();
  return Math.round((target - reference) / DAY);
}

/**
 * Derive availability from immutable workflow facts. Stored blocked is released
 * as soon as all listed prerequisites are complete; a missing prerequisite is
 * always blocked.
 */
export function derivedState(
  task: Task,
  tasks: Task[],
  now?: string
): DerivedState {
  const base = baseDerivedState(task, tasks, now);
  // Card tasks are ready only when all three dots are lit (see taskCard.ts).
  if ((base === "ready" || base === "inbox") && isCardTask(task)) {
    return isSetUp(task, tasks) ? "ready" : "inbox";
  }
  return base;
}

function baseDerivedState(
  task: Task,
  tasks: Task[],
  now?: string
): DerivedState {
  if (task.state === "done" || task.state === "someday") return task.state;

  const byId = new Map(tasks.map(item => [item.id, item]));
  const prerequisitesComplete = task.dependencies.every(dependencyId => {
    const dependency = byId.get(dependencyId);
    return Boolean(dependency && dependency.state === "done");
  });
  if (!prerequisitesComplete) return "blocked";

  const day = currentDay(now);
  if (
    isCalendarDate(task.deferredUntil) &&
    daysUntil(task.deferredUntil, day) > 0
  ) {
    return "deferred";
  }
  if (isCalendarDate(task.startDate) && daysUntil(task.startDate, day) > 0) {
    return "scheduled";
  }
  // A task planned for a later day stays quiet until then (Todoist-style).
  if (
    isCalendarDate(task.schedule?.date) &&
    daysUntil(task.schedule.date as string, day) > 0
  ) {
    return "scheduled";
  }
  // Waiting remains waiting even if its review date has arrived.
  if (task.state === "waiting") return "waiting";

  // Named blockers remain real until explicitly resolved. Dependency-only
  // blocks release automatically once their prerequisites finish.
  if (task.state === "blocked" && task.waitingFor.trim()) return "blocked";
  if (task.state === "blocked")
    return task.nextAction.trim() ? "ready" : "inbox";
  return task.state;
}

export function stateLabel(state: DerivedState): string {
  const labels: Record<DerivedState, string> = {
    ready: "Can start",
    inbox: "Needs next action",
    waiting: "Waiting",
    blocked: "Blocked",
    someday: "Someday",
    done: "Done",
    scheduled: "Starts later",
    deferred: "Deferred",
  };
  return labels[state];
}

/**
 * Select a small, explainable attention set. Commitments deliberately live
 * outside the five-item cap so filters cannot hide a near or overdue promise.
 */
export function attention(
  tasks: Task[],
  options: {
    now?: string;
    context?: Context;
    minutes?: number;
    matrixWeights?: MatrixWeights;
  } = {}
): AttentionResult {
  const now = currentDay(options.now);
  const minutes =
    options.minutes && options.minutes > 0 ? options.minutes : null;
  const states = new Map(
    tasks.map(task => [task.id, derivedState(task, tasks, now)])
  );

  const commitments = tasks
    .filter(task => task.state !== "done" && isCalendarDate(task.deadline))
    .filter(task => {
      const days = daysUntil(task.deadline as string, now);
      return (
        days <= 3 &&
        (days >= 0 || isTimingAnchor(task.schedule, task.deadline))
      );
    })
    .sort((a, b) => {
      const dateOrder =
        daysUntil(a.deadline as string, now) -
        daysUntil(b.deadline as string, now);
      return dateOrder || a.id.localeCompare(b.id);
    });

  const reviewDue = tasks
    .filter(task => {
      const state = states.get(task.id)!;
      return (
        state !== "done" &&
        state !== "someday" &&
        state !== "scheduled" &&
        state !== "deferred" &&
        !(
          isCalendarDate(task.deferredUntil) &&
          daysUntil(task.deferredUntil, now) > 0
        ) &&
        isCalendarDate(task.reviewDate) &&
        daysUntil(task.reviewDate, now) <= 0
      );
    })
    .sort((a, b) => {
      const dateOrder =
        daysUntil(a.reviewDate as string, now) -
        daysUntil(b.reviewDate as string, now);
      return dateOrder || a.id.localeCompare(b.id);
    });

  const candidates: Candidate[] = [];
  // A parent with open subtasks is worked through its subtasks, so it is not
  // recommended alongside them (commitments still show it if it is due).
  const parentsWithOpenSubtasks = new Set(
    tasks
      .filter(t => t.parent && !t.parent.suggested && t.state !== "done")
      .map(t => t.parent!.id)
  );
  for (const task of tasks) {
    if (parentsWithOpenSubtasks.has(task.id)) continue;
    const state = states.get(task.id)!;
    const review = reviewDays(task, now);
    const deadline = dueDays(task, now);
    const preparation = isCalendarDate(task.preparationDate)
      ? daysUntil(task.preparationDate, now)
      : null;
    // Explicit attention deferral does not erase a blocked inventory state
    // or its independent real-commitment summary.
    if (
      isCalendarDate(task.deferredUntil) &&
      daysUntil(task.deferredUntil, now) > 0
    )
      continue;
    if (isCalendarDate(task.startDate) && daysUntil(task.startDate, now) > 0)
      continue;
    if (
      isCalendarDate(task.schedule?.date) &&
      daysUntil(task.schedule.date as string, now) > 0
    )
      continue;
    let item: Candidate | null = null;

    if (state === "waiting") {
      if (
        (review !== null && review <= 0) ||
        (preparation !== null && preparation <= 0) ||
        (deadline !== null && deadline <= 3)
      ) {
        item = {
          task,
          kind: "followup",
          reason: task.waitingFor.trim()
            ? `Follow up with ${task.waitingFor.trim()}.`
            : "A follow-up is due.",
          estimateForFilter: 5,
          deadlineDays: deadline,
          reviewDays: review,
        };
      }
    } else if (state === "blocked") {
      // A review can be useful while a prerequisite remains unfinished, but it
      // is never offered as a startable action.
      if (
        (review !== null && review <= 0) ||
        (preparation !== null && preparation <= 0) ||
        (deadline !== null && deadline <= 3)
      ) {
        item = {
          task,
          kind: "review",
          reason: `${review !== null && review <= 0 ? relativeReviewReason(review) : "Check the missing condition before the next commitment."} ${task.waitingFor.trim() ? `Blocked: ${task.waitingFor.trim()}.` : "A prerequisite is still unfinished."}`,
          estimateForFilter: 5,
          deadlineDays: deadline,
          reviewDays: review,
        };
      }
    } else if (state === "inbox") {
      const clarifyText = isCardTask(task)
        ? `${setUpReason(task, tasks)} Tap Set up.`
        : "Choose the next physical action.";
      item = {
        task,
        kind: "clarify",
        reason:
          review !== null && review <= 0
            ? `${relativeReviewReason(review)} ${clarifyText}`
            : clarifyText,
        estimateForFilter: 5,
        deadlineDays: deadline,
        reviewDays: review,
      };
    } else if (state === "ready") {
      if (
        review !== null &&
        review <= 0 &&
        !task.pinned &&
        !(deadline !== null && deadline <= 3)
      ) {
        item = {
          task,
          kind: "review",
          reason: relativeReviewReason(review),
          estimateForFilter: 5,
          deadlineDays: deadline,
          reviewDays: review,
        };
      } else if (task.nextAction.trim()) {
        item = {
          task,
          kind: "action",
          reason: actionReason(task, now),
          estimateForFilter: task.estimate > 0 ? task.estimate : 5,
          deadlineDays: deadline,
          reviewDays: review,
        };
      }
    }

    if (
      item &&
      contextMatches(task, options.context) &&
      (minutes === null || item.estimateForFilter <= minutes)
    ) {
      candidates.push(item);
    }
  }

  candidates.sort((a, b) => compareCandidates(a, b, options.matrixWeights));
  const selected = candidates.slice(0, 5);
  const protectedIds = new Set<string>();

  // Keep one due-review and one sustained undated task visible where there is a
  // non-pinned slot to exchange. This avoids a list made entirely of urgent
  // dated tasks while respecting explicit pins.
  const reserve = (matches: (candidate: Candidate) => boolean) => {
    if (selected.some(matches)) return;
    const replacement = candidates.find(
      candidate =>
        matches(candidate) &&
        !selected.some(chosen => chosen.task.id === candidate.task.id)
    );
    if (!replacement) return;
    if (selected.length < 5) {
      selected.push(replacement);
      protectedIds.add(replacement.task.id);
      return;
    }
    const index = [...selected]
      .map((candidate, position) => ({ candidate, position }))
      .reverse()
      .find(
        ({ candidate }) =>
          !candidate.task.pinned && !protectedIds.has(candidate.task.id)
      )?.position;
    if (index === undefined) return;
    selected[index] = replacement;
    protectedIds.add(replacement.task.id);
  };

  reserve(candidate => candidate.kind === "review");
  reserve(
    candidate =>
      candidate.task.pattern === "sustained" &&
      candidate.task.deadline === null &&
      (candidate.kind === "action" ||
        candidate.kind === "clarify" ||
        candidate.kind === "review")
  );
  selected.sort((a, b) => compareCandidates(a, b, options.matrixWeights));

  return {
    items: selected.map(
      ({
        estimateForFilter: _estimateForFilter,
        deadlineDays: _deadlineDays,
        reviewDays: _reviewDays,
        ...item
      }) => item
    ),
    commitments,
    reviewDue,
    eligibleCount: candidates.length,
    waitingCount: tasks.filter(task => states.get(task.id) === "waiting")
      .length,
    blockedCount: tasks.filter(task => states.get(task.id) === "blocked")
      .length,
    outstandingCount: tasks.filter(task => states.get(task.id) !== "done")
      .length,
  };
}

/** Create a complete, local-first task without inventing a deadline. */
export function createTask(
  input: Partial<Task> & { title: string },
  now?: string
): Task {
  const day = currentDay(now);
  const stamp = now === undefined ? localTimestamp() : localTimestamp(day);
  const identity = suggestIdentity(input, day);
  const nextAction = input.nextAction ?? "";
  const state: TaskState =
    input.state ?? (nextAction.trim() ? "ready" : "inbox");
  return {
    id: input.id ?? freshId(),
    title: input.title.trim(),
    nextAction,
    notes: input.notes ?? "",
    state,
    pinned: input.pinned ?? false,
    deadline: input.deadline ?? null,
    startDate: input.startDate ?? null,
    reviewDate:
      input.reviewDate === undefined ? addDays(day, 7) : input.reviewDate,
    deferredUntil: input.deferredUntil ?? null,
    estimate: input.estimate ?? 15,
    context: input.context ?? "anywhere",
    waitingFor: input.waitingFor ?? "",
    dependencies: [...(input.dependencies ?? [])],
    checklist: copyChecklist(input.checklist ?? []),
    repeatDays: input.repeatDays ?? null,
    createdAt: input.createdAt ?? stamp,
    updatedAt: input.updatedAt ?? stamp,
    completedAt: input.completedAt ?? null,
    history: (input.history ?? []).map(entry => ({ ...entry })),
    purpose: input.purpose ?? "",
    role: input.role === undefined ? (identity.role ?? null) : input.role,
    pattern:
      input.pattern === undefined ? (identity.pattern ?? null) : input.pattern,
    labelSource: input.labelSource ?? identity.labelSource ?? "unclassified",
    projectId: input.projectId ?? null,
    preparationDate:
      input.preparationDate === undefined
        ? (identity.preparationDate ?? null)
        : input.preparationDate,
    preparationSource:
      input.preparationSource ?? identity.preparationSource ?? "suggested",
    progressEvidence: input.progressEvidence ?? "",
    compass: input.compass ?? emptyTaskCompass(),
    schedule: input.schedule
      ? copyTaskSchedule(input.schedule)
      : {
          ...emptyTaskSchedule(),
          repeat:
            input.repeatDays && input.repeatDays > 0
              ? { ...emptyRepeat("after"), interval: input.repeatDays }
              : null,
        },
  };
}
/** The task's repeat rule, including a legacy "every N days" value. */
export function repeatRuleOf(task: Task): RepeatRule | null {
  if (task.schedule.repeat) return task.schedule.repeat;
  if (task.repeatDays && task.repeatDays > 0) {
    return { ...emptyRepeat("after"), interval: task.repeatDays };
  }
  return null;
}
/** The date a repeating series is anchored to (planned day, else deadline, else start). */
function seriesDate(task: Task): string | null {
  return (
    task.schedule.repeatAnchorDate ??
    task.schedule.repeatOccurrenceDate ??
    task.schedule.date ??
    task.schedule.flexibleWindow?.startDate ??
    task.deadline ??
    task.startDate ??
    null
  );
}
function occurrenceDate(task: Task, fallback: string): string {
  return (
    task.schedule.repeatOccurrenceDate ??
    task.schedule.date ??
    task.schedule.flexibleWindow?.startDate ??
    task.deadline ??
    task.startDate ??
    fallback
  );
}
/**
 * Work out the next occurrence's dates. Fixed calendars (daily/weekly/
 * monthly/yearly) follow the pattern from the planned date, never landing in
 * the past; "after" counts from the completion day. Returns null when the
 * series has ended (until/count).
 */
export function nextOccurrenceDates(
  task: Task,
  day: string,
  occurrencesSoFar: number
): { date: string; shift: number } | null {
  const rule = repeatRuleOf(task);
  if (!rule) return null;
  if (rule.count && occurrencesSoFar >= rule.count) return null;
  const anchor = seriesDate(task) ?? day;
  const current = occurrenceDate(task, anchor);
  let next: string | null;
  if (rule.freq === "after") {
    next = nextOccurrence(rule, day, anchor);
  } else {
    const after = day > current ? day : current;
    next = nextOccurrence(rule, anchor, anchor);
    let guard = 0;
    while (next && next <= after && guard < 1000) {
      next = nextOccurrence(rule, next, anchor);
      guard++;
    }
  }
  if (!next) return null;
  return { date: next, shift: daysUntil(next, current) };
}

/** Mark one task complete and create at most one future recurrence instance. */
export function completeTask(tasks: Task[], id: string, now?: string): Task[] {
  const source = tasks.find(task => task.id === id);
  if (!source || source.state === "done") return tasks;
  const day = currentDay(now);
  const stamp = now === undefined ? localTimestamp() : localTimestamp(day);
  const rule = repeatRuleOf(source);
  const seriesId = rule
    ? (source.schedule.seriesId ?? source.id)
    : source.schedule.seriesId;
  const completions = rule
    ? [...source.schedule.completions.filter(d => d !== day), day].slice(-2000)
    : [...source.schedule.completions];
  const windowNote = flexibleCompletionNote(source.schedule, day);
  const completed: Task = {
    ...source,
    checklist: copyChecklist(source.checklist),
    dependencies: [...source.dependencies],
    state: "done",
    completedAt: stamp,
    updatedAt: stamp,
    history: [
      ...source.history.map(entry => ({ ...entry })),
      { at: stamp, text: windowNote?.text ?? "Completed task." },
    ],
    schedule: { ...copyTaskSchedule(source.schedule), seriesId, completions },
  };
  const result = tasks.map(task => (task.id === id ? completed : task));
  if (!rule) return result;
  const next = nextOccurrenceDates(
    source,
    day,
    completions.length + source.schedule.skipped.length
  );
  if (!next) return result;
  // Reopening an occurrence keeps its already-generated successor. Completing
  // it again must not create a second copy of that same successor.
  if (
    result.some(
      task =>
        task.id !== id &&
        task.schedule.seriesId === seriesId &&
        task.schedule.repeatOccurrenceDate === next.date
    )
  )
    return result;
  return [
    ...result,
    nextOccurrenceTask(
      source,
      next.date,
      next.shift,
      stamp,
      seriesId,
      completions
    ),
  ];
}

/** Reopen one completed task occurrence without deleting its completion history. */
export function reopenTaskOccurrence(tasks: Task[], id: string): Task[] {
  const source = tasks.find(task => task.id === id);
  if (!source || source.state !== "done") return tasks;

  const missingPrerequisite = source.dependencies.some(dependencyId => {
    const dependency = tasks.find(task => task.id === dependencyId);
    return !dependency || dependency.state !== "done";
  });
  const state: TaskState = source.waitingFor.trim()
    ? "waiting"
    : missingPrerequisite
      ? "blocked"
      : source.nextAction.trim()
        ? "ready"
        : "inbox";
  const reopened = updateTask(
    source,
    { state, completedAt: null },
    "Reopened completed task."
  );
  return tasks.map(task => (task.id === id ? reopened : task));
}

/** Skip this occurrence: move the same task to the next date without completing it. */
export function skipOccurrence(task: Task, now?: string): Task | null {
  const rule = repeatRuleOf(task);
  if (!rule) return null;
  const day = currentDay(now);
  const current = occurrenceDate(task, seriesDate(task) ?? day);
  const consumed =
    task.schedule.completions.length + task.schedule.skipped.length;
  if (
    (rule.count && consumed >= rule.count) ||
    (!task.schedule.date && task.schedule.skipped.includes(current))
  )
    return null;
  const next = nextOccurrenceDates(task, day, consumed + 1);
  const repeatTime =
    task.schedule.repeatTime !== undefined
      ? task.schedule.repeatTime
      : task.schedule.time;
  const actualDate = task.schedule.date ?? current;
  const skipDates = [...task.schedule.skipped, current].slice(-2000);
  if (!next) {
    return updateTask(
      task,
      {
        schedule: {
          ...copyTaskSchedule(task.schedule),
          date: null,
          time: null,
          repeatAnchorDate:
            task.schedule.repeatAnchorDate ?? seriesDate(task) ?? current,
          repeatOccurrenceDate: current,
          repeatTime,
          seriesId: task.schedule.seriesId ?? task.id,
          skipped: skipDates,
          missedHandled: null,
        },
      },
      `Skipped the final ${current} occurrence; no repeats remain.`
    );
  }
  const shift = next.shift;
  const move = (value: string | null) => (value ? addDays(value, shift) : null);
  const flexibleWindow = task.schedule.flexibleWindow
    ? shiftFlexibleWindow(task.schedule.flexibleWindow, shift)
    : undefined;
  return updateTask(
    task,
    {
      deadline: move(task.deadline),
      startDate: move(task.startDate),
      reviewDate: move(task.reviewDate),
      preparationDate: move(task.preparationDate),
      deferredUntil: null,
      schedule: {
        ...copyTaskSchedule(task.schedule),
        date: task.schedule.date ? next.date : null,
        time: repeatTime,
        ...(flexibleWindow ? { flexibleWindow } : {}),
        repeatAnchorDate:
          task.schedule.repeatAnchorDate ?? seriesDate(task) ?? current,
        repeatOccurrenceDate: next.date,
        repeatTime,
        seriesId: task.schedule.seriesId ?? task.id,
        skipped: skipDates,
        missedHandled: null,
      },
    },
    actualDate === current
      ? `Skipped ${current}; next is ${next.date}.`
      : `Skipped the ${current} occurrence rescheduled to ${actualDate}; next is ${next.date}.`
  );
}
function nextOccurrenceTask(
  source: Task,
  nextDate: string,
  shift: number,
  stamp: string,
  seriesId: string | null,
  completions: string[]
): Task {
  // Keep each date's distance from the planned day (e.g. deadline 2 days later).
  const move = (value: string | null) => (value ? addDays(value, shift) : null);
  const repeatAnchorDate = seriesDate(source) ?? nextDate;
  const repeatTime =
    source.schedule.repeatTime !== undefined
      ? source.schedule.repeatTime
      : source.schedule.time;
  const flexibleWindow = source.schedule.flexibleWindow
    ? shiftFlexibleWindow(source.schedule.flexibleWindow, shift)
    : undefined;
  return {
    ...source,
    id: freshId(),
    state: source.nextAction.trim() ? "ready" : "inbox",
    // Recurring work is a new occurrence, not a duplicate completion history.
    checklist: source.checklist.map(item => ({ ...item, done: false })),
    dependencies: [],
    // As before: the next occurrence stays quiet until its day.
    startDate: nextDate,
    deadline: move(source.deadline),
    reviewDate: nextDate,
    deferredUntil: null,
    preparationDate: move(source.preparationDate),
    progressEvidence: "",
    createdAt: stamp,
    updatedAt: stamp,
    completedAt: null,
    history: [
      { at: stamp, text: `Next occurrence (${nextDate}) of a repeating task.` },
    ],
    // Keeps its placement; a decision belonged to the finished occurrence.
    compass: {
      ...source.compass,
      imperativeIds: [...source.compass.imperativeIds],
      decision: null,
    },
    schedule: {
      ...copyTaskSchedule(source.schedule),
      date: source.schedule.date ? nextDate : null,
      time: repeatTime,
      ...(flexibleWindow ? { flexibleWindow } : {}),
      repeatAnchorDate,
      repeatOccurrenceDate: nextDate,
      repeatTime,
      seriesId,
      completions: [...completions],
      timeLog: [],
      missedHandled: null,
    },
  };
}
/** Apply a task patch immutably and leave an auditable, human-readable entry. */
export function updateTask(
  task: Task,
  patch: Partial<Task>,
  message?: string
): Task {
  const stamp = localTimestamp();
  const {
    id: _id,
    createdAt: _createdAt,
    history: _history,
    checklist,
    dependencies,
    ...safePatch
  } = patch;
  return {
    ...task,
    ...safePatch,
    checklist: checklist
      ? copyChecklist(checklist)
      : copyChecklist(task.checklist),
    dependencies: dependencies ? [...dependencies] : [...task.dependencies],
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: stamp,
    history: [
      ...task.history.map(entry => ({ ...entry })),
      { at: stamp, text: message ?? "Updated task." },
    ],
  };
}

export function deadlineLabel(task: Task, now?: string): string {
  if (!isCalendarDate(task.deadline)) return "No deadline";
  const days = daysUntil(task.deadline, now);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days > 1) return `Due in ${days} days`;
  if (!isTimingAnchor(task.schedule, task.deadline))
    return `Deadline ${task.deadline}`;
  const late = Math.abs(days);
  return `${late} day${late === 1 ? "" : "s"} past commitment`;
}
