import { isBookedAnchorSchedule, type TaskSchedule } from "./time";

const HOUR_SECONDS = 60 * 60;
const QUARTER_HOUR_SECONDS = 15 * 60;

/** Short focus blocks get quarter-hour chimes; longer blocks get hourly chimes. */
export function focusChimeInterval(durationSeconds: number): number | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  return durationSeconds < HOUR_SECONDS
    ? QUARTER_HOUR_SECONDS
    : HOUR_SECONDS;
}

/** Recurring booked tasks may keep their clock time on the series template. */
export function isBookedClockTimedCalendarSchedule(
  schedule: TaskSchedule | null | undefined
): boolean {
  return Boolean(
    schedule &&
      isBookedAnchorSchedule(schedule) &&
      (schedule.time || schedule.repeatTime)
  );
}

/** Return every crossed interval boundary, excluding the timebox-end boundary. */
export function crossedFocusChimeBoundaries(
  durationSeconds: number,
  beforeRemaining: number,
  remaining: number
): number[] {
  const interval = focusChimeInterval(durationSeconds);
  if (
    interval === null ||
    !Number.isFinite(beforeRemaining) ||
    !Number.isFinite(remaining) ||
    beforeRemaining < 0 ||
    beforeRemaining > durationSeconds ||
    remaining < 0 ||
    remaining >= beforeRemaining
  ) {
    return [];
  }
  const beforeElapsed = durationSeconds - beforeRemaining;
  const elapsed = durationSeconds - remaining;
  const firstIndex = Math.floor(beforeElapsed / interval) + 1;
  const lastIndex = Math.floor(elapsed / interval);
  const boundaries: number[] = [];
  for (let index = firstIndex; index <= lastIndex; index++) {
    const boundary = index * interval;
    if (boundary < durationSeconds) boundaries.push(boundary);
  }
  return boundaries;
}

/** True when at least one interval boundary was crossed, but not at timebox end. */
export function crossedFocusChimeBoundary(
  durationSeconds: number,
  beforeRemaining: number,
  remaining: number
): boolean {
  return crossedFocusChimeBoundaries(
    durationSeconds,
    beforeRemaining,
    remaining
  ).length > 0;
}

export function automaticCalendarChimeBoundaries(
  isBookedTimedCalendarTask: boolean,
  running: boolean,
  durationSeconds: number,
  beforeRemaining: number,
  remaining: number
): number[] {
  const endedOnThisTick = beforeRemaining > 0 && remaining === 0;
  return isBookedTimedCalendarTask && (running || endedOnThisTick)
    ? crossedFocusChimeBoundaries(durationSeconds, beforeRemaining, remaining)
    : [];
}

/** Automatic timer chimes apply only to running, booked clock-time Calendar tasks. */
export function automaticCalendarChimeDue(
  isBookedTimedCalendarTask: boolean,
  running: boolean,
  durationSeconds: number,
  beforeRemaining: number,
  remaining: number
): boolean {
  return automaticCalendarChimeBoundaries(
    isBookedTimedCalendarTask,
    running,
    durationSeconds,
    beforeRemaining,
    remaining
  ).length > 0;
}

/** The task title is spoken at each automatic interval when speech is supported. */
export function automaticTaskTitleSpeech(
  text: string,
  speechSupported: boolean
): string | null {
  const title = text.trim();
  return speechSupported && title ? title : null;
}

export function automaticCheckInSpeech(
  title: string,
  boundaryCount: number,
  speechSupported: boolean
): string | null {
  const cleanTitle = title.trim();
  if (!cleanTitle || !speechSupported || !Number.isFinite(boundaryCount))
    return null;
  const count = Math.min(100, Math.max(0, Math.floor(boundaryCount)));
  return count ? Array.from({ length: count }, () => cleanTitle).join(". ") : null;
}
