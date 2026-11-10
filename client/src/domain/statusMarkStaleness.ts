import type { Imperative } from "./compass";
import type { Project, Task } from "./types";
import { adelaideClock } from "./time";
import {
  daysBetweenAdelaideDates,
  imperativeLastMovementDate,
  isCalendarDate,
  projectLastMovementDate,
  taskLastMovementDate,
  type TimingClock,
} from "./timingShape";
import { statusMarkColorHex, type StatusMarkColor } from "./statusMarkColor";
import type { Appearance } from "./appearance";

export const STATUS_MARK_FADE_DAYS = 14;
export const STATUS_MARK_QUIET_GREY_DAYS = 14;
export const STATUS_MARK_GREY_HEX = "#626772";
export const STATUS_MARK_GREY_DARK_HEX = "#AEB8C7";

export function statusMarkGreyHex(appearance: Appearance = "light"): string {
  return appearance === "dark" ? STATUS_MARK_GREY_DARK_HEX : STATUS_MARK_GREY_HEX;
}

export interface StatusMarkStaleness {
  grey: boolean;
  reason: string | null;
  quietDays: number | null;
  daysSinceReview: number | null;
}

function elapsedDays(from: string | null, today: string): number | null {
  if (!from || !isCalendarDate(from) || !isCalendarDate(today)) return null;
  return Math.max(0, daysBetweenAdelaideDates(from, today));
}

function quietAge(
  lastMovement: string | null,
  clock: TimingClock
): number | null {
  return elapsedDays(lastMovement, clock.date);
}

function reviewAge(
  lastWeeklyReviewDate: string | null,
  clock: TimingClock
): number | null {
  return elapsedDays(lastWeeklyReviewDate, clock.date);
}

function baseStaleness(
  lastMovement: string | null,
  lastWeeklyReviewDate: string | null,
  clock: TimingClock
): StatusMarkStaleness {
  return {
    grey: false,
    reason: null,
    quietDays: quietAge(lastMovement, clock),
    daysSinceReview: reviewAge(lastWeeklyReviewDate, clock),
  };
}

function reviewDateIsDue(value: string | null | undefined, clock: TimingClock) {
  return Boolean(value && isCalendarDate(value) && value <= clock.date);
}

export function statusMarkStalenessForTask(
  task: Task,
  lastWeeklyReviewDate: string | null,
  clock: TimingClock = adelaideClock()
): StatusMarkStaleness {
  const state = baseStaleness(
    taskLastMovementDate(task),
    lastWeeklyReviewDate,
    clock
  );
  if (task.state === "someday") return state;

  if (reviewDateIsDue(task.reviewDate, clock)) {
    return {
      ...state,
      grey: true,
      reason: `Task review date ${task.reviewDate} is due today or has passed.`,
    };
  }
  if (
    state.quietDays !== null &&
    state.quietDays >= STATUS_MARK_QUIET_GREY_DAYS
  ) {
    return {
      ...state,
      grey: true,
      reason: `The task has had no recorded movement for ${state.quietDays} days.`,
    };
  }
  return state;
}

export function statusMarkStalenessForProject(
  project: Project,
  lastWeeklyReviewDate: string | null,
  clock: TimingClock = adelaideClock()
): StatusMarkStaleness {
  const state = baseStaleness(
    projectLastMovementDate(project),
    lastWeeklyReviewDate,
    clock
  );
  if (!project.purpose.trim()) {
    return { ...state, grey: true, reason: "The Project has no purpose." };
  }
  if (reviewDateIsDue(project.schedule?.reviewDate, clock)) {
    return {
      ...state,
      grey: true,
      reason: `Project review date ${project.schedule.reviewDate} is due today or has passed.`,
    };
  }
  if (
    state.quietDays !== null &&
    state.quietDays >= STATUS_MARK_QUIET_GREY_DAYS
  ) {
    return {
      ...state,
      grey: true,
      reason: `The Project has had no recorded movement for ${state.quietDays} days.`,
    };
  }
  return state;
}

export function statusMarkStalenessForImperative(
  imperative: Imperative,
  lastWeeklyReviewDate: string | null,
  clock: TimingClock = adelaideClock()
): StatusMarkStaleness {
  const state = baseStaleness(
    imperativeLastMovementDate(imperative),
    lastWeeklyReviewDate,
    clock
  );
  if (
    state.quietDays !== null &&
    state.quietDays >= STATUS_MARK_QUIET_GREY_DAYS
  ) {
    return {
      ...state,
      grey: true,
      reason: `The Imperative has had no recorded movement for ${state.quietDays} days.`,
    };
  }
  return state;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map(start =>
    Number.parseInt(hex.slice(start, start + 2), 16)
  ) as [number, number, number];
}

function asHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0");
}

/** Ease a Stage 2 hue toward neutral grey over 14 Adelaide days. */
export function statusMarkColorAfterReviewFade(
  color: StatusMarkColor,
  daysSinceReview: number,
  appearance: Appearance = "light"
): string {
  const ageProgress =
    Math.max(0, Math.min(STATUS_MARK_FADE_DAYS, daysSinceReview)) /
    STATUS_MARK_FADE_DAYS;
  const progress = ageProgress * ageProgress;
  const from = rgb(statusMarkColorHex(color, appearance));
  const to = rgb(statusMarkGreyHex(appearance));
  return `#${from.map((channel, index) => asHex(channel + (to[index] - channel) * progress)).join("")}`;
}

/** Visible color for the existing glyph; null leaves the Stage 2 CSS hue intact. */
export function visibleStatusMarkColor(
  color: StatusMarkColor | null,
  staleness: StatusMarkStaleness,
  appearance: Appearance = "light"
): string | null {
  if (staleness.grey) return statusMarkGreyHex(appearance);
  if (!color || staleness.daysSinceReview === null) return null;
  return statusMarkColorAfterReviewFade(color, staleness.daysSinceReview, appearance);
}
