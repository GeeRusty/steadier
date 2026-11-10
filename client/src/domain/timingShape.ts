import type { Imperative } from "./compass";
import type { Project, Task } from "./types";
import {
  adelaideClock,
  isTimingAnchor,
  slotMinutes,
  timeToMinutes,
} from "./time";

export type TimingShape = "ahead" | "on-track" | "behind";

export interface TimingClock {
  date: string;
  minutes: number;
}

export interface TimingShapeResult {
  shape: TimingShape;
  label: string;
  reason: string;
  targetDate: string | null;
}

export const TIMING_SHAPE_THRESHOLDS = {
  rescheduled: 3,
  quietDays: 7,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;
const ZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;

export function isCalendarDate(
  value: string | null | undefined
): value is string {
  if (!value) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  );
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  );
}

/** Convert saved timestamps to the Adelaide day; day-only values stay day-only. */
function adelaideDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const prefix = DATE_PREFIX.exec(value)?.[1];
  if (!prefix || !isCalendarDate(prefix)) return null;
  if (value.length === 10 || !ZONE_SUFFIX.test(value)) return prefix;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? prefix : adelaideClock(instant).date;
}

function dayNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

export function daysBetweenAdelaideDates(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

function uniqueDates(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter(isCalendarDate))].sort();
}

function latestDate(values: Array<string | null | undefined>): string | null {
  const dates = values
    .map(adelaideDate)
    .filter((value): value is string => !!value);
  return dates.sort().at(-1) ?? null;
}

function result(
  shape: TimingShape,
  reason: string,
  targetDate: string | null = null
): TimingShapeResult {
  const label =
    shape === "ahead" ? "Ahead" : shape === "behind" ? "Behind" : "On track";
  return { shape, label, reason, targetDate };
}

function noDateResult(
  lastMovement: string | null,
  clock: TimingClock,
  reschedules: number
): TimingShapeResult {
  if (reschedules >= TIMING_SHAPE_THRESHOLDS.rescheduled) {
    return result(
      "behind",
      `Rescheduled ${reschedules} times; the starting threshold is ${TIMING_SHAPE_THRESHOLDS.rescheduled}.`
    );
  }
  const days = lastMovement
    ? Math.max(0, daysBetweenAdelaideDates(lastMovement, clock.date))
    : 0;
  if (days >= TIMING_SHAPE_THRESHOLDS.quietDays) {
    return result(
      "behind",
      `No booked timing commitment; last recorded movement was ${days} days ago.`
    );
  }
  return result(
    "on-track",
    `No booked timing commitment; last recorded movement was ${days} day${days === 1 ? "" : "s"} ago.`
  );
}

/** A stable timing-only signature used to audit owner-saved schedule moves. */
export function taskTimingSignature(task: Task): string {
  return JSON.stringify({
    deadline: task.deadline,
    preparationDate: task.preparationDate,
    date: task.schedule.date,
    time: task.schedule.time,
    deadlineTime: task.schedule.deadlineTime,
    flexibleWindow: task.schedule.flexibleWindow ?? null,
  });
}

export function hasTaskTimingCommitment(task: Task): boolean {
  return Boolean(
    task.deadline ||
      task.preparationDate ||
      task.schedule.date ||
      task.schedule.time ||
      task.schedule.flexibleWindow
  );
}

export function taskTimingChanged(before: Task, after: Task): boolean {
  return taskTimingSignature(before) !== taskTimingSignature(after);
}

/**
 * Count only schedule events already present in the task's own audit trail.
 * Repeated legacy "Planned for" entries count beyond their first placement;
 * the explicit skipped-date list covers recurring skipped occurrences.
 */
export function taskRescheduleCount(task: Task): number {
  const history = task.history ?? [];
  const explicit = history.filter(entry =>
    /\brescheduled\b|\bmissed block moved to\b/i.test(entry.text)
  ).length;
  const planned = history.filter(entry =>
    /^planned for\b/i.test(entry.text.trim())
  ).length;
  const legacyMoves = Math.max(0, planned - 1);
  return Math.max(explicit + legacyMoves, task.schedule.skipped?.length ?? 0);
}

function taskDates(task: Task): string[] {
  return uniqueDates([
    task.schedule.flexibleWindow?.endDate,
    task.schedule.date,
    task.deadline,
    task.preparationDate,
  ]);
}

export function taskLastMovementDate(task: Task): string | null {
  return latestDate([
    task.createdAt,
    task.updatedAt,
    task.completedAt,
    ...(task.history ?? []).map(entry => entry.at),
    ...(task.schedule.timeLog ?? []).map(entry => entry.start),
    ...(task.schedule.completions ?? []),
  ]);
}

function taskProgressDates(task: Task): string[] {
  const hasChecklistProgress = (task.checklist ?? []).some(item => item.done);
  const hasWrittenEvidence = Boolean(task.progressEvidence?.trim());
  return uniqueDates([
    ...(task.schedule.timeLog ?? [])
      .filter(entry => entry.minutes > 0)
      .map(entry => adelaideDate(entry.start)),
    ...(task.schedule.completions ?? []),
    ...(task.state === "done" ? [task.completedAt] : []),
    ...(hasChecklistProgress || hasWrittenEvidence ? [task.updatedAt] : []),
  ]);
}

function missedTimedBlock(task: Task, clock: TimingClock): boolean {
  if (
    task.state === "done" ||
    task.schedule.date !== clock.date ||
    !task.schedule.time
  )
    return false;
  return timeToMinutes(task.schedule.time) + slotMinutes(task) <= clock.minutes;
}

function taskFinishedDate(task: Task): string | null {
  return (
    adelaideDate(task.completedAt) ??
    latestDate(
      (task.history ?? [])
        .filter(entry => /completed task\./i.test(entry.text))
        .map(entry => entry.at)
    )
  );
}

export function timingShapeForTask(
  task: Task,
  clock: TimingClock = adelaideClock()
): TimingShapeResult {
  const hasAnchorTime = isTimingAnchor(task.schedule, task.deadline);
  const targetDates = hasAnchorTime
    ? task.schedule.flexibleWindow && task.schedule.deadlineTime && task.deadline
      ? [task.deadline]
      : taskDates(task)
    : taskDates(task);
  const targetDate = targetDates[0] ?? null;
  const reschedules = taskRescheduleCount(task);

  // Self-chosen dates remain visible as information, but never create a late
  // or missed state. Their shape uses movement; explicit anchors use dates.
  if (!hasAnchorTime) {
    if (task.state === "done" && targetDate) {
      const finished = taskFinishedDate(task);
      if (finished && finished < targetDate)
        return result("ahead", `Completed ${finished}, before ${targetDate}.`, targetDate);
      if (finished && finished > targetDate)
        return result("behind", `Completed after the recorded date ${targetDate}.`, targetDate);
      if (finished === targetDate)
        return result("on-track", `Completed on the recorded date ${targetDate}.`, targetDate);
    }
    if (targetDate) {
      const earlyProgress = taskProgressDates(task)
        .filter(date => date < targetDate)
        .sort()[0];
      if (earlyProgress)
        return result("ahead", `Recorded progress ${earlyProgress}, before ${targetDate}.`, targetDate);
    }
    return noDateResult(taskLastMovementDate(task), clock, 0);
  }

  if (reschedules >= TIMING_SHAPE_THRESHOLDS.rescheduled) {
    return result(
      "behind",
      `Rescheduled ${reschedules} times; the starting threshold is ${TIMING_SHAPE_THRESHOLDS.rescheduled}.`,
      targetDate
    );
  }

  if (task.state === "done" && targetDate) {
    const finished = taskFinishedDate(task);
    if (finished && finished < targetDate) {
      return result(
        "ahead",
        `Completed ${finished}, before ${targetDate}.`,
        targetDate
      );
    }
    if (finished && finished > targetDate) {
      return result(
        "behind",
        `Completed after the commitment date ${targetDate}.`,
        targetDate
      );
    }
    if (!finished && targetDate < clock.date) {
      return result(
        "behind",
        `The commitment date ${targetDate} has passed.`,
        targetDate
      );
    }
    return result(
      "on-track",
      `The commitment date is ${targetDate}.`,
      targetDate
    );
  }

  if (missedTimedBlock(task, clock)) {
    return result(
      "behind",
      "The timed block has ended today and the task is still open.",
      targetDate
    );
  }

  if (task.state !== "done" && targetDate && targetDate < clock.date) {
    return result(
      "behind",
      `The commitment date ${targetDate} has passed.`,
      targetDate
    );
  }

  if (
    task.state !== "done" &&
    task.deadline === clock.date &&
    task.schedule.deadlineTime &&
    clock.minutes >= timeToMinutes(task.schedule.deadlineTime)
  ) {
    return result(
      "behind",
      "The hard-deadline time has passed today.",
      targetDate
    );
  }

  if (targetDate) {
    const progressedBefore = taskProgressDates(task).find(
      date => date < targetDate
    );
    if (progressedBefore) {
      return result(
        "ahead",
        `Progress was recorded on ${progressedBefore}, before ${targetDate}.`,
        targetDate
      );
    }
    return result(
      "on-track",
      `The next timing commitment is ${targetDate}.`,
      targetDate
    );
  }

  return noDateResult(taskLastMovementDate(task), clock, reschedules);
}

function projectDates(project: Project): string[] {
  const incompleteMilestoneIds = new Set(
    (project.milestones ?? [])
      .filter(milestone => !milestone.done)
      .map(milestone => milestone.id)
  );
  return uniqueDates([
    project.schedule?.deadline,
    ...(project.schedule?.milestoneDates ?? [])
      .filter(item => incompleteMilestoneIds.has(item.id))
      .map(item => item.date),
  ]);
}

export function projectLastMovementDate(project: Project): string | null {
  return latestDate([
    project.createdAt,
    project.updatedAt,
    ...(project.progress ?? []).map(entry => entry.at),
  ]);
}

function projectRescheduleCount(project: Project): number {
  return (project.progress ?? []).filter(entry =>
    /^\s*(?:rescheduled|deadline moved)\b/i.test(entry.text)
  ).length;
}

export function timingShapeForProject(
  project: Project,
  clock: TimingClock = adelaideClock()
): TimingShapeResult {
  const targetDate = projectDates(project)[0] ?? null;
  const reschedules = projectRescheduleCount(project);
  if (reschedules >= TIMING_SHAPE_THRESHOLDS.rescheduled) {
    return result(
      "behind",
      `Three or more schedule changes were recorded in project progress (${reschedules}).`,
      targetDate
    );
  }
  if (!targetDate) {
    return noDateResult(projectLastMovementDate(project), clock, reschedules);
  }

  const progress = latestDate([
    ...(project.progress ?? []).map(entry => entry.at),
    ...(project.status === "achieved" ? [project.updatedAt] : []),
  ]);
  if (progress && progress < targetDate) {
    return result(
      "ahead",
      `Project progress was recorded on ${progress}, before ${targetDate}.`,
      targetDate
    );
  }
  if (targetDate < clock.date) {
    return result(
      "behind",
      `The project commitment date ${targetDate} has passed.`,
      targetDate
    );
  }
  return result(
    "on-track",
    `The next project commitment is ${targetDate}.`,
    targetDate
  );
}

export function imperativeLastMovementDate(
  imperative: Imperative
): string | null {
  return latestDate([
    imperative.setOn,
    imperative.createdAt,
    imperative.updatedAt,
    ...(imperative.history ?? []).map(entry => entry.at),
  ]);
}

export function timingShapeForImperative(
  imperative: Imperative,
  clock: TimingClock = adelaideClock()
): TimingShapeResult {
  return noDateResult(imperativeLastMovementDate(imperative), clock, 0);
}
