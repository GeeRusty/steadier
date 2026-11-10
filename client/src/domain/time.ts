/**
 * Time concepts for tasks and projects: a planned slot (date, optional start
 * time and length), reminders, repeat rules, a completion series and an
 * actual-time log. Everything is calendar-local to Australia/Adelaide.
 */
import { STEADIER_TIME_ZONE } from "../../../shared/time";

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
export const WEEKDAY_SHORT = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

export type RepeatFreq = "daily" | "weekly" | "monthly" | "yearly" | "after";

export interface RepeatRule {
  /** "after" = N days/weeks after you finish, rather than on a fixed calendar. */
  freq: RepeatFreq;
  /** Every N units (days for daily/after, weeks, months, years). */
  interval: number;
  /** Weekly: which days (0 = Sunday). Empty = same weekday as the planned date. */
  weekdays: number[];
  /** Monthly by date: 1–31, or -1 for the last day. */
  monthDay: number | null;
  /** Monthly by weekday: e.g. { n: 2, weekday: 2 } = 2nd Tuesday; n = -1 = last. */
  nthWeekday: { n: number; weekday: number } | null;
  /** Stop after this date (inclusive). */
  until: string | null;
  /** Stop after this many times in total. */
  count: number | null;
}

export interface Reminder {
  id: string;
  /** Minutes before the anchor. 0 = at the time. */
  minutesBefore: number;
  anchor: "slot" | "deadline";
}

export interface FlexibleTimeWindow {
  /** Adelaide-local inclusive start date in YYYY-MM-DD form. */
  startDate: string;
  /** Adelaide-local inclusive end date in YYYY-MM-DD form. */
  endDate: string;
}

export interface TimeEntry {
  /** Adelaide local "YYYY-MM-DDTHH:MM". */
  start: string;
  minutes: number;
  source: "focus" | "manual";
}

export interface TaskSchedule {
  /** The planned day ("do date"). */
  date: string | null;
  /** "HH:MM" 24-hour start; null = any time that day. */
  time: string | null;
  /** Planned length in minutes; null = use the estimate. */
  minutes: number | null;
  /** Explicit Booked anchor shown on clock/calendar; never auto-assigned. */
  fixed: boolean;
  /** Explicitly include this booked anchor in the Month overview. */
  majorAnchor?: boolean;
  /** Present only for a flexible window; legacy schedules omit this property. */
  flexibleWindow?: FlexibleTimeWindow;
  /** Optional time on the real deadline, "HH:MM". */
  deadlineTime: string | null;
  reminders: Reminder[];
  repeat: RepeatRule | null;
  /** Stable start date used to align the recurrence pattern and its interval. */
  repeatAnchorDate?: string | null;
  /** Pattern date represented by this occurrence before a one-off reschedule. */
  repeatOccurrenceDate?: string | null;
  /** Series time to restore on later occurrences after this one is moved. */
  repeatTime?: string | null;
  /** Links the occurrences of one repeating series. */
  seriesId: string | null;
  /** Days this series was completed (carried to each new occurrence). */
  completions: string[];
  /** Days this series was skipped. */
  skipped: string[];
  /** Actual time spent. */
  timeLog: TimeEntry[];
  /** A missed block already handled for this date (so it is asked once). */
  missedHandled: string | null;
}

export type AnchorScheduleFields = Pick<
  TaskSchedule,
  | "date"
  | "fixed"
  | "flexibleWindow"
  | "deadlineTime"
  | "repeat"
  | "repeatAnchorDate"
  | "repeatOccurrenceDate"
>;

/** A booked work block that occupies clock time; deadline markers do not. */
export function isBookedAnchorSchedule(schedule: AnchorScheduleFields): boolean {
  const hasDate = Boolean(
    schedule.date ||
      (schedule.repeat &&
        (schedule.repeatOccurrenceDate || schedule.repeatAnchorDate))
  );
  return schedule.fixed === true && hasDate && !schedule.flexibleWindow;
}

/** A real, timed hard deadline is a point anchor, not an assumed-duration block. */
export function hasTimedDeadlineAnchor(
  schedule: AnchorScheduleFields,
  deadline: string | null | undefined
): boolean {
  return Boolean(deadline && schedule.deadlineTime);
}

/** Any task time indicator that may legitimately appear on a clock. */
export function isTimingAnchor(
  schedule: AnchorScheduleFields,
  deadline: string | null | undefined
): boolean {
  return isBookedAnchorSchedule(schedule) || hasTimedDeadlineAnchor(schedule, deadline);
}

export interface ProjectSchedule {
  deadline: string | null;
  reviewDate: string | null;
  /** For Sustained projects: target minutes per week. */
  weeklyBudgetMinutes: number | null;
  /** Optional date per milestone id. */
  milestoneDates: { id: string; date: string }[];
}

export interface PlanningSettings {
  /** "HH:MM" */
  dayStart: string;
  dayEnd: string;
  /** Gap kept between planned blocks. */
  bufferMinutes: number;
  /** Explicit Not now choices before the owner is asked to reconsider. */
  passOverThreshold?: number;
}

export const DEFAULT_PLANNING: PlanningSettings = {
  dayStart: "08:00",
  dayEnd: "18:00",
  bufferMinutes: 10,
  passOverThreshold: 3,
};

export function emptyTaskSchedule(): TaskSchedule {
  return {
    date: null,
    time: null,
    minutes: null,
    fixed: false,
    deadlineTime: null,
    reminders: [],
    repeat: null,
    seriesId: null,
    completions: [],
    skipped: [],
    timeLog: [],
    missedHandled: null,
  };
}

export function emptyProjectSchedule(): ProjectSchedule {
  return {
    deadline: null,
    reviewDate: null,
    weeklyBudgetMinutes: null,
    milestoneDates: [],
  };
}

export function copyTaskSchedule(s: TaskSchedule): TaskSchedule {
  return {
    ...s,
    ...(s.flexibleWindow ? { flexibleWindow: { ...s.flexibleWindow } } : {}),
    reminders: s.reminders.map(r => ({ ...r })),
    repeat: s.repeat ? copyRepeat(s.repeat) : null,
    completions: [...s.completions],
    skipped: [...s.skipped],
    timeLog: s.timeLog.map(e => ({ ...e })),
  };
}

/** Convert one task's timing in place while keeping its real deadline and effort. */
export function setFlexibleWindowSchedule(
  schedule: TaskSchedule,
  window: FlexibleTimeWindow,
  fallbackDate?: string | null
): TaskSchedule {
  const next = copyTaskSchedule(schedule);
  const seriesAnchor =
    schedule.repeatAnchorDate ??
    schedule.repeatOccurrenceDate ??
    schedule.flexibleWindow?.startDate ??
    schedule.date ??
    fallbackDate ??
    window.startDate;
  next.flexibleWindow = { ...window };
  next.date = null;
  next.time = null;
  next.fixed = false;
  next.reminders = next.reminders.filter(
    reminder => reminder.anchor === "deadline"
  );
  next.missedHandled = null;
  if (next.repeat) {
    next.repeatAnchorDate = seriesAnchor;
    next.repeatOccurrenceDate = window.startDate;
    next.repeatTime = null;
  }
  return next;
}

/**
 * Set the day a repeating flexible window is anchored to (e.g. a Saturday for a
 * weekly weekend job). The window opens on the anchor and keeps its length, so
 * a Saturday anchor with a window ending Sunday runs Sat–Sun every cycle. The
 * result never carries a clock time, a booked anchor or a fixed date.
 */
export function setFlexibleRecurrenceAnchor(
  schedule: TaskSchedule,
  anchorDate: string
): TaskSchedule {
  const next = copyTaskSchedule(schedule);
  if (!schedule.flexibleWindow || !schedule.repeat) return next;
  const span = Math.max(
    0,
    daysBetween(schedule.flexibleWindow.startDate, schedule.flexibleWindow.endDate)
  );
  next.flexibleWindow = {
    startDate: anchorDate,
    endDate: shiftDays(anchorDate, span),
  };
  next.date = null;
  next.time = null;
  next.fixed = false;
  next.repeatAnchorDate = anchorDate;
  next.repeatOccurrenceDate = anchorDate;
  next.repeatTime = null;
  next.missedHandled = null;
  return next;
}

/** Plain-language summary of a repeating flexible window and its anchor. */
export function describeFlexibleRecurrence(schedule: TaskSchedule): string {
  const window = schedule.flexibleWindow;
  if (!window || !schedule.repeat) return "";
  const anchor = schedule.repeatAnchorDate ?? window.startDate;
  const days = daysBetween(window.startDate, window.endDate) + 1;
  const opens = WEEKDAY_NAMES[weekdayOf(window.startDate)];
  const closes = WEEKDAY_NAMES[weekdayOf(window.endDate)];
  const span =
    days === 1
      ? `open on ${opens}`
      : `opens ${opens}, closes end of ${closes} (${days} days)`;
  return `${describeRepeat(schedule.repeat)} from ${anchor}: ${span}. No set time.`;
}

export type FlexibleCompletionStatus = "early" | "within" | "late";

/**
 * How a completion day relates to a flexible window. Completion is always
 * allowed: only a day after the window's last day counts as late, and the
 * anchor/start day passing never makes anything late.
 */
export function flexibleCompletionStatus(
  window: FlexibleTimeWindow,
  day: string
): FlexibleCompletionStatus {
  if (day > window.endDate) return "late";
  if (day < window.startDate) return "early";
  return "within";
}

/** History/progress wording for completing a flexible-window occurrence. */
export function flexibleCompletionNote(
  schedule: TaskSchedule,
  day: string
): { status: FlexibleCompletionStatus; text: string } | null {
  const window = schedule.flexibleWindow;
  if (!window) return null;
  const status = flexibleCompletionStatus(window, day);
  const span =
    window.startDate === window.endDate
      ? window.startDate
      : `${window.startDate} to ${window.endDate}`;
  if (status === "late")
    return {
      status,
      text: `Completed late on ${day}: its window (${span}) closed on ${window.endDate}.`,
    };
  if (status === "early")
    return {
      status,
      text: `Completed on ${day}, before its window (${span}) opened.`,
    };
  return { status, text: `Completed on ${day}, within its window (${span}).` };
}

/** Reschedule one repeated occurrence without changing the series pattern. */
export function rescheduleOccurrenceSchedule(
  schedule: TaskSchedule,
  changes: Partial<Pick<TaskSchedule, "date" | "time">>,
  baseDate?: string | null
): TaskSchedule {
  const convertedFromWindow =
    !!schedule.flexibleWindow && ("date" in changes || "time" in changes);
  const next = { ...schedule, ...changes };
  // A direct day/time placement is an explicit conversion back to fixed timing.
  if ("date" in changes || "time" in changes) delete next.flexibleWindow;
  if (!schedule.repeat) return next;
  const originalDate =
    schedule.repeatOccurrenceDate ??
    schedule.date ??
    baseDate ??
    changes.date ??
    null;
  return {
    ...next,
    repeatAnchorDate:
      schedule.repeatAnchorDate ??
      schedule.repeatOccurrenceDate ??
      schedule.date ??
      baseDate ??
      changes.date ??
      null,
    repeatOccurrenceDate: originalDate,
    repeatTime:
      convertedFromWindow && "time" in changes
        ? (changes.time ?? null)
        : schedule.repeatTime !== undefined
          ? schedule.repeatTime
          : schedule.time,
  };
}

export function copyRepeat(rule: RepeatRule): RepeatRule {
  return {
    ...rule,
    weekdays: [...rule.weekdays],
    nthWeekday: rule.nthWeekday ? { ...rule.nthWeekday } : null,
  };
}

export function emptyRepeat(freq: RepeatFreq = "weekly"): RepeatRule {
  return {
    freq,
    interval: 1,
    weekdays: [],
    monthDay: null,
    nthWeekday: null,
    until: null,
    count: null,
  };
}

// ---------------------------------------------------------------------------
// Calendar arithmetic (pure, UTC-noon based so DST never shifts a day)
// ---------------------------------------------------------------------------

export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export function isTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function toUtcNoon(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shiftDays(date: string, days: number): string {
  const value = toUtcNoon(date);
  value.setUTCDate(value.getUTCDate() + days);
  return fromUtc(value);
}

export function weekdayOf(date: string): number {
  return toUtcNoon(date).getUTCDay();
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (toUtcNoon(to).getTime() - toUtcNoon(from).getTime()) / 86_400_000
  );
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0, 12)).getUTCDate();
}

function makeDate(year: number, month0: number, day: number): string {
  return fromUtc(new Date(Date.UTC(year, month0, day, 12)));
}

/** Monday of the week containing date. */
export function weekStart(date: string): string {
  const wd = weekdayOf(date);
  return shiftDays(date, wd === 0 ? -6 : 1 - wd);
}

export type FlexibleWindowState =
  | "upcoming"
  | "active"
  | "closes-today"
  | "expired";

/** The current Saturday–Sunday window, including Sunday when today is Sunday. */
export function thisWeekendWindow(today: string): FlexibleTimeWindow {
  const weekday = weekdayOf(today);
  const startDate = shiftDays(today, weekday === 0 ? -1 : 6 - weekday);
  return { startDate, endDate: shiftDays(startDate, 1) };
}

/** Monday–Sunday of the next Adelaide-local calendar week. */
export function nextWeekWindow(today: string): FlexibleTimeWindow {
  const startDate = shiftDays(weekStart(today), 7);
  return { startDate, endDate: shiftDays(startDate, 6) };
}

/** Derived only: an expired window never changes stored workflow or completion. */
export function flexibleWindowState(
  window: FlexibleTimeWindow,
  today: string
): FlexibleWindowState {
  if (today < window.startDate) return "upcoming";
  if (today > window.endDate) return "expired";
  return today === window.endDate ? "closes-today" : "active";
}

export function shiftFlexibleWindow(
  window: FlexibleTimeWindow,
  days: number
): FlexibleTimeWindow {
  return {
    startDate: shiftDays(window.startDate, days),
    endDate: shiftDays(window.endDate, days),
  };
}

function shortWindowDate(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === shiftDays(today, 1)) return "Tomorrow";
  const [year] = date.split("-").map(Number);
  const label = new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00.000Z`));
  return year === Number(today.slice(0, 4)) ? label : `${label} ${year}`;
}

/** Compact, local-date-only label; it never implies a timed appointment. */
export function describeFlexibleWindow(
  window: FlexibleTimeWindow,
  today: string
): string {
  if (window.startDate === window.endDate)
    return shortWindowDate(window.startDate, today);
  const currentWeekend = thisWeekendWindow(today);
  if (
    weekdayOf(window.startDate) === 6 &&
    window.endDate === shiftDays(window.startDate, 1) &&
    window.startDate === currentWeekend.startDate
  )
    return "This weekend";
  const nextWeek = nextWeekWindow(today);
  if (
    window.startDate === nextWeek.startDate &&
    window.endDate === nextWeek.endDate
  )
    return "Next week";
  const currentWeekStart = weekStart(today);
  if (
    window.startDate === currentWeekStart &&
    window.endDate === shiftDays(currentWeekStart, 6)
  )
    return "This week";
  return `${shortWindowDate(window.startDate, today)} – ${shortWindowDate(window.endDate, today)}`;
}

function nthWeekdayOfMonth(
  year: number,
  month0: number,
  n: number,
  weekday: number
): string | null {
  if (n === -1) {
    const last = daysInMonth(year, month0);
    for (let d = last; d > last - 7; d--) {
      if (new Date(Date.UTC(year, month0, d, 12)).getUTCDay() === weekday)
        return makeDate(year, month0, d);
    }
    return null;
  }
  let count = 0;
  for (let d = 1; d <= daysInMonth(year, month0); d++) {
    if (new Date(Date.UTC(year, month0, d, 12)).getUTCDay() === weekday) {
      count++;
      if (count === n) return makeDate(year, month0, d);
    }
  }
  return null;
}

function monthDate(year: number, month0: number, monthDay: number): string {
  const max = daysInMonth(year, month0);
  const day = monthDay === -1 ? max : Math.min(monthDay, max);
  return makeDate(year, month0, day);
}

/**
 * The next occurrence strictly after `from`, following the rule's calendar
 * pattern. `anchor` is the series' planned date (for weekday/month-day
 * defaults). For "after", `from` should be the completion day.
 */
export function nextOccurrence(
  rule: RepeatRule,
  from: string,
  anchor: string = from
): string | null {
  const interval = Math.max(1, Math.floor(rule.interval || 1));
  let next: string | null = null;
  switch (rule.freq) {
    case "after":
    case "daily":
      next = shiftDays(from, interval);
      break;
    case "weekly": {
      const days = rule.weekdays.length
        ? [...new Set(rule.weekdays)].sort()
        : [weekdayOf(anchor)];
      const anchorWeek = weekStart(anchor);
      // Walk forward day by day (bounded) looking for an allowed weekday in an allowed week.
      for (let i = 1; i <= 7 * interval * 2 + 7; i++) {
        const candidate = shiftDays(from, i);
        const weeks = Math.floor(
          daysBetween(anchorWeek, weekStart(candidate)) / 7
        );
        if (weeks % interval === 0 && days.includes(weekdayOf(candidate))) {
          next = candidate;
          break;
        }
      }
      break;
    }
    case "monthly": {
      const a = toUtcNoon(anchor);
      const f = toUtcNoon(from);
      let year = f.getUTCFullYear();
      let month0 = f.getUTCMonth();
      const anchorIndex = a.getUTCFullYear() * 12 + a.getUTCMonth();
      for (let i = 0; i < 400; i++) {
        const index = year * 12 + month0;
        if ((index - anchorIndex) % interval === 0) {
          const candidate = rule.nthWeekday
            ? nthWeekdayOfMonth(
                year,
                month0,
                rule.nthWeekday.n,
                rule.nthWeekday.weekday
              )
            : monthDate(year, month0, rule.monthDay ?? a.getUTCDate());
          if (candidate && candidate > from) {
            next = candidate;
            break;
          }
        }
        month0++;
        if (month0 > 11) {
          month0 = 0;
          year++;
        }
      }
      break;
    }
    case "yearly": {
      const a = toUtcNoon(anchor);
      let year = toUtcNoon(from).getUTCFullYear();
      for (let i = 0; i < 50; i++) {
        if ((year - a.getUTCFullYear()) % interval === 0) {
          const candidate = monthDate(year, a.getUTCMonth(), a.getUTCDate());
          if (candidate > from) {
            next = candidate;
            break;
          }
        }
        year++;
      }
      break;
    }
  }
  if (next && rule.until && next > rule.until) return null;
  return next;
}

/** Upcoming dates of a series within [from, to], for the calendar view. */
export function occurrencesBetween(
  rule: RepeatRule,
  first: string,
  from: string,
  to: string,
  limit = 400
): string[] {
  if (rule.freq === "after") return first >= from && first <= to ? [first] : [];
  const out: string[] = [];
  let current: string | null = first;
  let guard = 0;
  while (current && current <= to && guard < limit) {
    if (current >= from) out.push(current);
    current = nextOccurrence(rule, current, first);
    guard++;
  }
  return out;
}

const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th"];

export function describeRepeat(rule: RepeatRule | null): string {
  if (!rule) return "Does not repeat";
  const n = Math.max(1, rule.interval);
  let text: string;
  switch (rule.freq) {
    case "daily":
      text = n === 1 ? "Every day" : `Every ${n} days`;
      break;
    case "after":
      text =
        n % 7 === 0 && n >= 7
          ? `${n / 7 === 1 ? "1 week" : `${n / 7} weeks`} after done`
          : `${n} day${n === 1 ? "" : "s"} after done`;
      break;
    case "weekly": {
      const days = [...rule.weekdays].sort();
      const isWeekdays =
        days.length === 5 && [1, 2, 3, 4, 5].every(d => days.includes(d));
      const list = isWeekdays
        ? "weekdays"
        : days.map(d => WEEKDAY_SHORT[d]).join(", ");
      text =
        n === 1
          ? days.length
            ? `Every ${list}`
            : "Every week"
          : `Every ${n} weeks${days.length ? ` on ${list}` : ""}`;
      break;
    }
    case "monthly": {
      const on = rule.nthWeekday
        ? ` on the ${rule.nthWeekday.n === -1 ? "last" : ORDINAL[rule.nthWeekday.n]} ${WEEKDAY_NAMES[rule.nthWeekday.weekday]}`
        : rule.monthDay === -1
          ? " on the last day"
          : rule.monthDay
            ? ` on the ${rule.monthDay}${suffix(rule.monthDay)}`
            : "";
      text = (n === 1 ? "Every month" : `Every ${n} months`) + on;
      break;
    }
    case "yearly":
      text = n === 1 ? "Every year" : `Every ${n} years`;
      break;
  }
  if (rule.until) text += ` until ${rule.until}`;
  if (rule.count) text += `, ${rule.count} times`;
  return text;
}

function suffix(day: number): string {
  if (day >= 11 && day <= 13) return "th";
  return ["th", "st", "nd", "rd"][day % 10] ?? "th";
}

/** Consecutive occurrences completed without a skip or miss, newest first. */
export function streak(schedule: TaskSchedule): number {
  return schedule.completions.length === 0 ? 0 : countStreak(schedule);
}

function countStreak(s: TaskSchedule): number {
  // Completions and skips interleaved by date; a skip ends the streak.
  const events = [
    ...s.completions.map(date => ({ date, done: true })),
    ...s.skipped.map(date => ({ date, done: false })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));
  let count = 0;
  for (const event of events) {
    if (!event.done) break;
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Clock helpers
// ---------------------------------------------------------------------------

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(total: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(total)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** "3:00 pm" */
export function formatTime(time: string | null): string {
  if (!time) return "";
  const minutes = timeToMinutes(time);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatCompactDuration(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  if (hours && remainder) return `${hours}h ${remainder}m`;
  if (hours) return `${hours}h`;
  return `${remainder}m`;
}

/** Current Adelaide date and minute of day. */
export function adelaideClock(now: Date = new Date()): {
  date: string;
  minutes: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STEADIER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** Convert an Adelaide wall-clock date/time to a real instant. */
export function adelaideToInstant(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wall - 630 * 60_000;
  for (let i = 0; i < 3; i++) {
    const clock = adelaideClock(new Date(guess));
    const [cy, cm, cd] = clock.date.split("-").map(Number);
    const seen = Date.UTC(
      cy,
      cm - 1,
      cd,
      Math.floor(clock.minutes / 60),
      clock.minutes % 60
    );
    guess += wall - seen;
  }
  return new Date(guess);
}

/** Planned length for a task's slot. */
export function slotMinutes(task: {
  estimate: number;
  schedule: TaskSchedule;
}): number {
  return Math.max(5, task.schedule.minutes ?? task.estimate ?? 15);
}

/** Scheduled tasks start as a full timebox; unscheduled starts retain 10 minutes. */
export function focusPlanForTask(task: {
  estimate: number;
  schedule: TaskSchedule;
}): { durationMinutes: number; continueAfterDone: boolean } {
  const scheduled = Boolean(
    task.schedule.date ||
      task.schedule.time ||
      (task.schedule.repeatTime && isBookedAnchorSchedule(task.schedule))
  );
  return {
    durationMinutes: scheduled ? slotMinutes(task) : 10,
    continueAfterDone: scheduled,
  };
}

export function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
