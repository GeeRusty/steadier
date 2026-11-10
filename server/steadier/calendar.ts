import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { steadierCalendarFeeds } from "../../drizzle/schema";
import type { Task, Workspace } from "../../client/src/domain/types";
import { COMPASS_PUBLIC_ORIGIN } from "../../shared/compassConnection";
import { STEADIER_TIME_ZONE } from "../../shared/time";
import { getDb } from "../db";
import {
  adelaideToInstant,
  formatTime,
  isBookedAnchorSchedule,
  minutesToTime,
  nextOccurrence,
  shiftDays,
  slotMinutes,
  timeToMinutes,
  type Reminder,
  type RepeatRule,
} from "../../client/src/domain/time";
import { repeatRuleOf } from "../../client/src/domain/engine";
import { focusChimeInterval } from "../../client/src/domain/focusChimes";

/** Path segment form: /api/calendar/<token>/steadier.ics */
export const CALENDAR_TOKEN_PATTERN = /^stdc_[A-Za-z0-9_-]{43}$/;

export type CalendarFeedStatus = {
  active: boolean;
  hideTitles: boolean;
  createdAt: string | null;
  lastFetchedAt: string | null;
};

export interface CalendarFeedRepository {
  readActiveFeed(userId: number): Promise<CalendarFeedStatus>;
  /** Revokes any previous link and stores the new hash, atomically. */
  replaceFeed(
    userId: number,
    tokenHash: string,
    hideTitles: boolean,
    now: Date
  ): Promise<void>;
  revokeFeed(userId: number, now: Date): Promise<boolean>;
  findActiveFeedByHash(
    tokenHash: string
  ): Promise<{ id: number; userId: number; hideTitles: boolean } | null>;
  touchFeed(id: number, now: Date): Promise<void>;
}

export function createCalendarToken(): string {
  return `stdc_${randomBytes(32).toString("base64url")}`;
}

export function hashCalendarToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function calendarFeedUrl(
  token: string,
  origin = COMPASS_PUBLIC_ORIGIN
): string {
  return `${origin}/api/calendar/${token}/steadier.ics`;
}

// ---------------------------------------------------------------------------
// iCalendar (RFC 5545) output
// ---------------------------------------------------------------------------

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** Folds content lines at 75 octets, never splitting a UTF-8 character. */
function fold(line: string): string {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, "utf8");
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = char;
      bytes = size;
    } else {
      current += char;
      bytes += size;
    }
  }
  out.push(current);
  return out.join("\r\n ");
}

function compactDate(date: string): string {
  return date.replace(/-/g, "");
}

function nextDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10).replace(/-/g, "");
}

function utcStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function validDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

type DateKind = "deadline" | "preparation" | "review" | "start";

const KIND_LABEL: Record<DateKind, string> = {
  deadline: "Due",
  preparation: "Prepare",
  review: "Review",
  start: "Start",
};

/**
 * Alarm offsets for an all-day event, relative to midnight starting that day.
 * Deadlines: 9:00 the day before and 9:00 on the day. Others: 9:00 on the day.
 * (Apple and Outlook use these; Google Calendar uses its own per-calendar
 * default notifications for subscribed calendars.)
 */
const KIND_ALARMS: Record<DateKind, string[]> = {
  deadline: ["-PT15H", "PT9H"],
  preparation: ["PT9H"],
  review: ["PT9H"],
  start: ["PT9H"],
};

function eventLines(
  task: Task,
  kind: DateKind,
  date: string,
  projectTitle: string | null,
  hideTitles: boolean,
  stamp: string
): string[] {
  const title = hideTitles ? "Steadier task" : task.title;
  const summary = `${KIND_LABEL[kind]}: ${title}`;
  const description: string[] = [];
  if (!hideTitles) {
    if (task.nextAction) description.push(`Next step: ${task.nextAction}`);
    if (projectTitle) description.push(`Project: ${projectTitle}`);
    if (kind === "preparation" && validDate(task.deadline))
      description.push(`Real deadline: ${task.deadline}`);
  }
  description.push(`Open Steadier: ${COMPASS_PUBLIC_ORIGIN}/`);
  const lines = [
    "BEGIN:VEVENT",
    `UID:${task.id}-${kind}@steadier`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compactDate(date)}`,
    `DTEND;VALUE=DATE:${nextDay(date)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description.join("\n"))}`,
    "TRANSP:TRANSPARENT",
    `CATEGORIES:${KIND_LABEL[kind]}`,
  ];
  for (const trigger of KIND_ALARMS[kind]) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(summary)}`,
      `TRIGGER;RELATED=START:${trigger}`,
      "END:VALARM"
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

const RRULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function countBoundaryDate(rule: RepeatRule, firstDate: string): string | null {
  if (rule.count === null) return null;
  const total = Math.floor(rule.count);
  if (total < 1) return null;
  const unboundedRule = { ...rule, count: null, until: null };
  let date = firstDate;
  for (let occurrence = 1; occurrence < total; occurrence += 1) {
    const next = nextOccurrence(unboundedRule, date, firstDate);
    if (!next) return date;
    date = next;
  }
  return date;
}

/** RFC 5545 RRULE for a fixed-calendar repeat ("after done" has none). */
export function rruleFor(rule: RepeatRule, firstDate: string): string | null {
  if (rule.freq === "after") return null;
  const parts = [`FREQ=${rule.freq.toUpperCase()}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === "weekly" && rule.weekdays.length) {
    parts.push(`BYDAY=${rule.weekdays.map(d => RRULE_DAYS[d]).join(",")}`);
  }
  if (rule.freq === "monthly") {
    if (rule.nthWeekday)
      parts.push(
        `BYDAY=${rule.nthWeekday.n}${RRULE_DAYS[rule.nthWeekday.weekday]}`
      );
    else if (rule.monthDay === -1) parts.push("BYMONTHDAY=-1");
    else if (rule.monthDay && rule.monthDay !== Number(firstDate.slice(8)))
      parts.push(`BYMONTHDAY=${rule.monthDay}`);
  }
  const countBoundary = countBoundaryDate(rule, firstDate);
  const endDate =
    rule.until && countBoundary
      ? rule.until < countBoundary
        ? rule.until
        : countBoundary
      : (rule.until ?? countBoundary);
  if (endDate) parts.push(`UNTIL=${compactDate(endDate)}T235959Z`);
  else if (rule.count) parts.push(`COUNT=${rule.count}`);
  return `RRULE:${parts.join(";")}`;
}

function alarm(summary: string, minutesBefore: number): string[] {
  return [
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(summary)}`,
    `TRIGGER;RELATED=START:${minutesBefore <= 0 ? `PT${-minutesBefore}M` : `-PT${minutesBefore}M`}`,
    "END:VALARM",
  ];
}

const MAX_REMINDER_OCCURRENCES = 400;

function adelaideDateTime(instant: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STEADIER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

function calendarDateOffset(fromDate: string, toDate: string): number {
  const [fromYear, fromMonth, fromDay] = fromDate.split("-").map(Number);
  const [toYear, toMonth, toDay] = toDate.split("-").map(Number);
  return Math.round(
    (Date.UTC(toYear, toMonth - 1, toDay) -
      Date.UTC(fromYear, fromMonth - 1, fromDay)) /
      86_400_000
  );
}

function reminderRecurrenceDates(
  rule: RepeatRule,
  firstDate: string,
  limit = MAX_REMINDER_OCCURRENCES
): string[] {
  const max = Math.min(
    limit,
    rule.count === null ? limit : Math.max(0, Math.floor(rule.count))
  );
  const dates: string[] = [];
  let date: string | null = firstDate;
  while (date && dates.length < max) {
    if (rule.until && date > rule.until) break;
    dates.push(date);
    date = nextOccurrence(rule, date, firstDate);
  }
  return dates;
}

function shiftedReminderRepeat(
  rule: RepeatRule,
  firstDate: string,
  dayOffset: number
): { firstDate: string; rule: RepeatRule } | null {
  if (rule.freq === "after") return null;
  const shiftedDate = shiftDays(firstDate, dayOffset);
  const shifted: RepeatRule = {
    ...rule,
    until: rule.until ? shiftDays(rule.until, dayOffset) : null,
  };
  if (rule.freq === "weekly" && rule.weekdays.length) {
    shifted.weekdays = [
      ...new Set(
        rule.weekdays.map(day => ((day + dayOffset) % 7 + 7) % 7)
      ),
    ].sort((a, b) => a - b);
  }
  if (rule.freq === "monthly") {
    shifted.monthDay = Number(shiftedDate.slice(8));
    shifted.nthWeekday = null;
  }

  const sourceDates = reminderRecurrenceDates(
    rule,
    firstDate,
    Math.min(48, MAX_REMINDER_OCCURRENCES)
  );
  const expectedDates = sourceDates.map(date => shiftDays(date, dayOffset));
  const shiftedDates = reminderRecurrenceDates(
    shifted,
    shiftedDate,
    expectedDates.length
  );
  return expectedDates.length > 0 &&
    expectedDates.length === shiftedDates.length &&
    expectedDates.every((date, index) => date === shiftedDates[index])
    ? { firstDate: shiftedDate, rule: shifted }
    : null;
}

interface FeedRecurrence {
  patternDate: string;
  patternTime: string | null;
  seriesId: string;
  rule: RepeatRule | null;
  moved: boolean;
}

function isFuturePatternDate(
  rule: RepeatRule,
  firstDate: string,
  targetDate: string,
  remaining: number | null
): boolean {
  if (targetDate <= firstDate || (rule.until && targetDate > rule.until)) {
    return false;
  }
  let current = firstDate;
  let count = 1;
  const limit = remaining ?? 10_000;
  while (count < limit) {
    const next = nextOccurrence(rule, current, firstDate);
    if (!next || next > targetDate) return false;
    if (next === targetDate) return true;
    current = next;
    count++;
  }
  return false;
}

function feedRecurrence(task: Task): FeedRecurrence | null {
  const sourceRule = repeatRuleOf(task);
  if (!sourceRule || sourceRule.freq === "after") return null;
  const schedule = task.schedule;
  const patternDate =
    schedule.repeatOccurrenceDate ??
    schedule.date ??
    schedule.repeatAnchorDate ??
    null;
  if (!validDate(patternDate)) return null;
  const patternTime =
    schedule.repeatTime !== undefined ? schedule.repeatTime : schedule.time;
  const consumed = schedule.completions.length + schedule.skipped.length;
  const remainingBeforeMove =
    sourceRule.count === null ? null : sourceRule.count - consumed;
  const moved = schedule.date !== patternDate || schedule.time !== patternTime;
  const movedOntoFutureOccurrence =
    moved &&
    validDate(schedule.date) &&
    schedule.date > patternDate &&
    (remainingBeforeMove === null || remainingBeforeMove > 1) &&
    isFuturePatternDate(
      sourceRule,
      patternDate,
      schedule.date,
      remainingBeforeMove
    );
  // If the moved instance occupies a later pattern date, the app still keeps
  // the same number of future instances after that date. Extend COUNT so the
  // extra EXDATE below does not shorten the subscribed series by one.
  const remaining =
    remainingBeforeMove === null
      ? null
      : remainingBeforeMove + (movedOntoFutureOccurrence ? 1 : 0);
  const rule =
    (sourceRule.until === null || patternDate <= sourceRule.until) &&
    (remaining === null || remaining > 0)
      ? remaining === null
        ? sourceRule
        : { ...sourceRule, count: remaining }
      : null;
  return {
    patternDate,
    patternTime,
    seriesId: schedule.seriesId ?? task.id,
    rule,
    moved,
  };
}

interface SlotEventSpec {
  uid: string;
  date: string;
  time: string | null;
  rule?: RepeatRule | null;
  exclude?: { date: string; time: string | null }[];
}

function slotEventLines(
  task: Task,
  projectTitle: string | null,
  hideTitles: boolean,
  stamp: string,
  event: SlotEventSpec
): string[] {
  const s = task.schedule;
  const title = hideTitles ? "Steadier task" : task.title;
  const description: string[] = [];
  if (!hideTitles) {
    if (task.nextAction) description.push(`Next step: ${task.nextAction}`);
    if (projectTitle) description.push(`Project: ${projectTitle}`);
  }
  description.push(`Open Steadier: ${COMPASS_PUBLIC_ORIGIN}/`);
  const lines = ["BEGIN:VEVENT", `UID:${event.uid}`, `DTSTAMP:${stamp}`];
  if (event.time) {
    lines.push(
      `DTSTART;TZID=${STEADIER_TIME_ZONE}:${compactDate(event.date)}T${event.time.replace(":", "")}00`,
      `DURATION:PT${slotMinutes(task)}M`,
      s.fixed ? "TRANSP:OPAQUE" : "TRANSP:TRANSPARENT"
    );
  } else {
    lines.push(
      `DTSTART;VALUE=DATE:${compactDate(event.date)}`,
      `DTEND;VALUE=DATE:${nextDay(event.date)}`,
      "TRANSP:TRANSPARENT"
    );
  }
  lines.push(
    `SUMMARY:${escapeText(title)}`,
    `DESCRIPTION:${escapeText(description.join("\n"))}`,
    "CATEGORIES:Planned"
  );
  const rrule = event.rule ? rruleFor(event.rule, event.date) : null;
  if (rrule) lines.push(rrule);
  for (const exclusion of event.exclude ?? []) {
    lines.push(
      exclusion.time
        ? `EXDATE;TZID=${STEADIER_TIME_ZONE}:${compactDate(exclusion.date)}T${exclusion.time.replace(":", "")}00`
        : `EXDATE;VALUE=DATE:${compactDate(exclusion.date)}`
    );
  }
  const slotReminders = s.reminders.filter(r => r.anchor === "slot");
  for (const r of slotReminders) {
    // All-day: reminders count back from 9:00 on the day.
    lines.push(
      ...alarm(title, event.time ? r.minutesBefore : r.minutesBefore - 9 * 60)
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

/** Planned slot (timed or all-day), with repeat and reminders. */
function slotLines(
  task: Task,
  projectTitle: string | null,
  hideTitles: boolean,
  stamp: string
): string[] {
  const s = task.schedule;
  if (s.flexibleWindow) return [];
  const recurrence = feedRecurrence(task);
  if (!validDate(s.date)) {
    if (!recurrence?.rule) return [];
    return slotEventLines(task, projectTitle, hideTitles, stamp, {
      uid: `${recurrence.seriesId}-slot@steadier`,
      date: recurrence.patternDate,
      time: recurrence.patternTime,
      rule: recurrence.rule,
      exclude: [
        {
          date: recurrence.patternDate,
          time: recurrence.patternTime,
        },
      ],
    });
  }
  if (recurrence?.moved) {
    const movedInstance = slotEventLines(
      task,
      projectTitle,
      hideTitles,
      stamp,
      {
        uid: `${task.id}-slot-instance@steadier`,
        date: s.date,
        time: s.time,
      }
    );
    if (!recurrence.rule) return movedInstance;
    const futureSeries = slotEventLines(task, projectTitle, hideTitles, stamp, {
      uid: `${recurrence.seriesId}-slot@steadier`,
      date: recurrence.patternDate,
      time: recurrence.patternTime,
      rule: recurrence.rule,
      exclude: [
        {
          date: recurrence.patternDate,
          time: recurrence.patternTime,
        },
        ...(s.date > recurrence.patternDate
          ? [{ date: s.date, time: recurrence.patternTime }]
          : []),
      ],
    });
    return [...futureSeries, ...movedInstance];
  }
  if (recurrence) {
    return slotEventLines(task, projectTitle, hideTitles, stamp, {
      uid: `${recurrence.seriesId}-slot@steadier`,
      date: recurrence.patternDate,
      time: recurrence.patternTime,
      rule: recurrence.rule,
    });
  }
  return slotEventLines(task, projectTitle, hideTitles, stamp, {
    uid: `${task.id}-slot@steadier`,
    date: s.date,
    time: s.time,
  });
}

/** Flexible availability is all-day and transparent: it reserves no time. */
function flexibleWindowLines(
  task: Task,
  projectTitle: string | null,
  hideTitles: boolean,
  stamp: string
): string[] {
  const window = task.schedule.flexibleWindow;
  if (!window) return [];
  const title = hideTitles ? "Steadier task" : task.title;
  const description = [
    `Available ${window.startDate} through ${window.endDate} inclusive.`,
    "Flexible time window; no time is reserved.",
    ...(!hideTitles && task.nextAction
      ? [`Next step: ${task.nextAction}`]
      : []),
    ...(!hideTitles && projectTitle ? [`Project: ${projectTitle}`] : []),
    `Open Steadier: ${COMPASS_PUBLIC_ORIGIN}/`,
  ];
  return [
    "BEGIN:VEVENT",
    `UID:${task.id}-window@steadier`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compactDate(window.startDate)}`,
    `DTEND;VALUE=DATE:${nextDay(window.endDate)}`,
    `SUMMARY:${escapeText(`${title} (flexible window)`)}`,
    `DESCRIPTION:${escapeText(description.join("\n"))}`,
    "TRANSP:TRANSPARENT",
    "CATEGORIES:Flexible window",
    "END:VEVENT",
  ];
}

/**
 * Each reminder as its own short timed entry. Google Calendar ignores alarms
 * inside subscribed feeds but notifies for timed events using the calendar's
 * default notification, so set that to "at time of event" once.
 */
function reminderPingEventLines(
  task: Task,
  hideTitles: boolean,
  stamp: string,
  reminder: Task["schedule"]["reminders"][number],
  anchorDate: string,
  anchorTime: string,
  displayTime: string | null,
  uid: string,
  repeat: RepeatRule | null = null,
  excludeDates: string[] = []
): string[] {
  const title = hideTitles ? "Steadier task" : task.title;
  const fireInstant = new Date(
    adelaideToInstant(anchorDate, anchorTime).getTime() -
      reminder.minutesBefore * 60_000
  );
  const fireLocal = adelaideDateTime(fireInstant);
  const fireDayOffset = calendarDateOffset(anchorDate, fireLocal.date);
  const isTimerEnd = reminder.id === "auto-focus-end";
  const what = isTimerEnd
    ? "at the end of the booked block"
    : reminder.minutesBefore < 0
      ? `timer check-in ${-reminder.minutesBefore} minutes into the block`
      : reminder.anchor === "slot"
        ? displayTime
          ? `at ${formatTime(displayTime)}`
          : "today"
        : `due ${displayTime ? formatTime(displayTime) : anchorDate}`;
  const summary = `⏰ ${title} (${what})`;
  let eventDate = fireLocal.date;
  let eventRepeat = repeat?.freq === "after" ? null : repeat;
  let eventExcludes = [...excludeDates];
  let eventTime = fireLocal.time.replace(":", "");
  let eventStartLine = `DTSTART;TZID=${STEADIER_TIME_ZONE}:${compactDate(eventDate)}T${eventTime}00`;
  let rdateOccurrences: Date[] = [];
  const firingDates = eventRepeat
    ? reminderRecurrenceDates(eventRepeat, anchorDate).map(sourceDate => {
        const instant = new Date(
          adelaideToInstant(sourceDate, anchorTime).getTime() -
            reminder.minutesBefore * 60_000
        );
        return { sourceDate, instant, local: adelaideDateTime(instant) };
      })
    : [];
  const fixedLocalShift =
    firingDates.length > 0 &&
    firingDates.every(
      ({ sourceDate, local }) =>
        local.date === shiftDays(sourceDate, fireDayOffset) &&
        local.time === fireLocal.time
    );
  const useUtcRdates = (): boolean => {
    const upcoming = firingDates.filter(
      ({ sourceDate }) => !excludeDates.includes(sourceDate)
    );
    if (!upcoming.length) return false;
    const first = upcoming[0];
    eventDate = first.local.date;
    eventTime = first.local.time.replace(":", "");
    eventStartLine = `DTSTART:${utcStamp(first.instant)}`;
    rdateOccurrences = upcoming.slice(1).map(({ instant }) => instant);
    eventRepeat = null;
    eventExcludes = [];
    return true;
  };

  if (eventRepeat && !fixedLocalShift) {
    if (!useUtcRdates()) return [];
  } else if (eventRepeat && fireDayOffset !== 0) {
    const shifted = shiftedReminderRepeat(eventRepeat, anchorDate, fireDayOffset);
    if (shifted) {
      eventDate = shifted.firstDate;
      eventRepeat = shifted.rule;
      eventExcludes = excludeDates.map(date => shiftDays(date, fireDayOffset));
    } else if (!useUtcRdates()) {
      return [];
    }
  }

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    eventStartLine,
    "DURATION:PT5M",
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(`Reminder from Steadier. Open: ${COMPASS_PUBLIC_ORIGIN}/`)}`,
    "TRANSP:TRANSPARENT",
    "CATEGORIES:Reminder",
  ];
  if (eventRepeat) {
    const rrule = rruleFor(eventRepeat, eventDate);
    if (rrule) lines.push(rrule);
    for (const date of eventExcludes) {
      lines.push(
        `EXDATE;TZID=${STEADIER_TIME_ZONE}:${compactDate(date)}T${eventTime}00`
      );
    }
  }
  for (const instant of rdateOccurrences) {
    lines.push(`RDATE:${utcStamp(instant)}`);
  }
  lines.push(...alarm(summary, 0), "END:VEVENT");
  return lines;
}

function automaticFocusTimerReminders(task: Task): Reminder[] {
  const schedule = task.schedule;
  if (!isBookedAnchorSchedule(schedule) || schedule.flexibleWindow) return [];
  const recurrence = feedRecurrence(task);
  const anchorTime = schedule.time ?? recurrence?.patternTime ?? null;
  if (!anchorTime) return [];
  const durationMinutes = slotMinutes(task);
  const interval = focusChimeInterval(durationMinutes * 60);
  if (interval === null) return [];
  const intervalMinutes = interval / 60;
  const reminders: Reminder[] = [];
  for (
    let elapsedMinutes = intervalMinutes;
    elapsedMinutes < durationMinutes;
    elapsedMinutes += intervalMinutes
  ) {
    reminders.push({
      id: `auto-focus-${elapsedMinutes}`,
      minutesBefore: -elapsedMinutes,
      anchor: "slot",
    });
  }
  reminders.push({
    id: "auto-focus-end",
    minutesBefore: -durationMinutes,
    anchor: "slot",
  });
  return reminders;
}

function reminderPingLines(
  task: Task,
  hideTitles: boolean,
  stamp: string
): string[] {
  const s = task.schedule;
  const out: string[] = [];
  const recurrence = feedRecurrence(task);
  for (const reminder of [
    ...s.reminders,
    ...automaticFocusTimerReminders(task),
  ]) {
    const isSlot = reminder.anchor === "slot";
    if (isSlot && s.flexibleWindow) continue;
    const actualDate = isSlot ? s.date : task.deadline;
    if (
      isSlot &&
      recurrence?.moved &&
      recurrence.rule &&
      !validDate(actualDate)
    ) {
      const patternTime = recurrence.patternTime ?? "09:00";
      out.push(
        ...reminderPingEventLines(
          task,
          hideTitles,
          stamp,
          reminder,
          recurrence.patternDate,
          patternTime,
          recurrence.patternTime,
          `${recurrence.seriesId}-rem-${reminder.id}@steadier`,
          recurrence.rule,
          [recurrence.patternDate]
        )
      );
      continue;
    }
    if (!validDate(actualDate)) continue;
    const displayTime = isSlot ? s.time : s.deadlineTime;
    const actualTime = displayTime ?? "09:00";
    const recurringRule = isSlot ? (recurrence?.rule ?? null) : null;
    const patternDate = isSlot
      ? (recurrence?.patternDate ?? actualDate)
      : actualDate;
    const patternDisplayTime = isSlot
      ? (recurrence?.patternTime ?? displayTime)
      : displayTime;
    const patternTime = patternDisplayTime ?? "09:00";
    const canRepeat = !!recurringRule;
    const moved = isSlot && recurrence?.moved === true;
    if (canRepeat && recurrence) {
      const uid = `${recurrence.seriesId}-rem-${reminder.id}@steadier`;
      const excludeDates = moved
        ? [
            recurrence.patternDate,
            ...(validDate(actualDate) && actualDate > recurrence.patternDate
              ? [actualDate]
              : []),
          ]
        : [];
      const futureSeries = reminderPingEventLines(
        task,
        hideTitles,
        stamp,
        reminder,
        patternDate,
        patternTime,
        patternDisplayTime,
        uid,
        recurringRule,
        excludeDates
      );
      out.push(...futureSeries);
      if (moved) {
        out.push(
          ...reminderPingEventLines(
            task,
            hideTitles,
            stamp,
            reminder,
            actualDate,
            actualTime,
            displayTime,
            `${task.id}-rem-${reminder.id}-instance@steadier`
          )
        );
      }
    } else {
      out.push(
        ...reminderPingEventLines(
          task,
          hideTitles,
          stamp,
          reminder,
          actualDate,
          actualTime,
          displayTime,
          `${task.id}-rem-${reminder.id}@steadier`
        )
      );
    }
  }
  return out;
}

/** Timed deadline (when a deadline time is set). */
function timedDeadlineLines(
  task: Task,
  hideTitles: boolean,
  stamp: string
): string[] {
  const s = task.schedule;
  if (!validDate(task.deadline) || !s.deadlineTime) return [];
  const title = hideTitles ? "Steadier task" : task.title;
  const start = adelaideToInstant(
    task.deadline,
    minutesToTime(Math.max(0, timeToMinutes(s.deadlineTime) - 15))
  );
  return [
    "BEGIN:VEVENT",
    `UID:${task.id}-deadline-time@steadier`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(new Date(start.getTime() + 15 * 60_000))}`,
    `SUMMARY:${escapeText(`Due ${formatTime(s.deadlineTime)}: ${title}`)}`,
    "TRANSP:TRANSPARENT",
    "CATEGORIES:Due",
    "END:VEVENT",
  ];
}

function projectLines(
  workspace: Workspace,
  hideTitles: boolean,
  stamp: string
): string[] {
  const out: string[] = [];
  for (const project of workspace.projects) {
    if (project.status !== "active") continue;
    const title = hideTitles ? "Steadier project" : project.title;
    const entries: Array<[string, string | null, string]> = [
      ["deadline", project.schedule.deadline, `Project due: ${title}`],
      ["review", project.schedule.reviewDate, `Project review: ${title}`],
      ...project.schedule.milestoneDates
        .filter(m => project.milestones.some(x => x.id === m.id && !x.done))
        .map(m => {
          const name = hideTitles
            ? "milestone"
            : (project.milestones.find(x => x.id === m.id)?.title ??
              "milestone");
          return [
            `milestone-${m.id}`,
            m.date,
            `Milestone: ${name} (${title})`,
          ] as [string, string, string];
        }),
    ];
    for (const [key, date, summary] of entries) {
      if (!validDate(date)) continue;
      out.push(
        "BEGIN:VEVENT",
        `UID:${project.id}-${key}@steadier`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${compactDate(date)}`,
        `DTEND;VALUE=DATE:${nextDay(date)}`,
        `SUMMARY:${escapeText(summary)}`,
        "TRANSP:TRANSPARENT",
        "CATEGORIES:Project",
        ...alarm(summary, -9 * 60),
        "END:VEVENT"
      );
    }
  }
  return out;
}

/** Adelaide has no fixed offset (ACST/ACDT), so ship its rules for TZID use. */
const ADELAIDE_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${STEADIER_TIME_ZONE}`,
  "BEGIN:STANDARD",
  "DTSTART:19700405T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU",
  "TZOFFSETFROM:+1030",
  "TZOFFSETTO:+0930",
  "TZNAME:ACST",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:19701004T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU",
  "TZOFFSETFROM:+0930",
  "TZOFFSETTO:+1030",
  "TZNAME:ACDT",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
];

/**
 * Builds the private feed: every open task's real deadline, suggested
 * preparation day, review date and start date as all-day events. Completed
 * tasks are excluded. Notes are never included.
 */
export function workspaceCalendarIcs(
  workspace: Workspace,
  options: { hideTitles?: boolean; now?: Date } = {}
): string {
  const hideTitles = options.hideTitles ?? false;
  const stamp = utcStamp(options.now ?? new Date());
  const projects = new Map(
    workspace.projects.map(project => [project.id, project.title])
  );
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Steadier//My Life calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Steadier (My Life)",
    `X-WR-TIMEZONE:${STEADIER_TIME_ZONE}`,
    "X-WR-CALDESC:Planned times\\, reminders\\, deadlines\\, reviews and project dates from Steadier.",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...ADELAIDE_VTIMEZONE,
  ];
  for (const task of workspace.tasks) {
    if (task.state === "done") continue;
    const projectTitle = task.projectId
      ? (projects.get(task.projectId) ?? null)
      : null;
    const dates: Array<[DateKind, string | null]> = [
      ["deadline", task.deadline],
      ["preparation", task.preparationDate],
      ["review", task.reviewDate],
      ["start", task.startDate],
    ];
    const seen = new Set<string>();
    for (const [kind, date] of dates) {
      if (!validDate(date)) continue;
      // A preparation day equal to the deadline adds nothing.
      if (kind === "preparation" && date === task.deadline) continue;
      const key = `${kind}:${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // A timed deadline replaces the all-day "Due" entry.
      if (kind === "deadline" && task.schedule.deadlineTime) continue;
      lines.push(
        ...eventLines(task, kind, date, projectTitle, hideTitles, stamp)
      );
    }
    lines.push(
      ...flexibleWindowLines(task, projectTitle, hideTitles, stamp),
      ...slotLines(task, projectTitle, hideTitles, stamp),
      ...timedDeadlineLines(task, hideTitles, stamp),
      ...reminderPingLines(task, hideTitles, stamp)
    );
  }
  lines.push(...projectLines(workspace, hideTitles, stamp));
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------------------
// Production storage
// ---------------------------------------------------------------------------

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new Error("Database is unavailable.");
  return database;
}

export class DrizzleCalendarFeedRepository implements CalendarFeedRepository {
  async readActiveFeed(userId: number): Promise<CalendarFeedStatus> {
    const database = await requireDatabase();
    const [row] = await database
      .select()
      .from(steadierCalendarFeeds)
      .where(
        and(
          eq(steadierCalendarFeeds.ownerId, userId),
          isNull(steadierCalendarFeeds.revokedAt)
        )
      )
      .limit(1);
    return row
      ? {
          active: true,
          hideTitles: row.hideTitles,
          createdAt: row.createdAt.toISOString(),
          lastFetchedAt: row.lastFetchedAt
            ? row.lastFetchedAt.toISOString()
            : null,
        }
      : {
          active: false,
          hideTitles: false,
          createdAt: null,
          lastFetchedAt: null,
        };
  }

  async replaceFeed(
    userId: number,
    tokenHash: string,
    hideTitles: boolean,
    now: Date
  ): Promise<void> {
    const database = await requireDatabase();
    await database.transaction(async tx => {
      await tx
        .update(steadierCalendarFeeds)
        .set({ revokedAt: now })
        .where(
          and(
            eq(steadierCalendarFeeds.ownerId, userId),
            isNull(steadierCalendarFeeds.revokedAt)
          )
        );
      await tx
        .insert(steadierCalendarFeeds)
        .values({ ownerId: userId, tokenHash, hideTitles, createdAt: now });
    });
  }

  async revokeFeed(userId: number, now: Date): Promise<boolean> {
    const database = await requireDatabase();
    const active = await this.readActiveFeed(userId);
    if (!active.active) return false;
    await database
      .update(steadierCalendarFeeds)
      .set({ revokedAt: now })
      .where(
        and(
          eq(steadierCalendarFeeds.ownerId, userId),
          isNull(steadierCalendarFeeds.revokedAt)
        )
      );
    return true;
  }

  async findActiveFeedByHash(tokenHash: string) {
    const database = await requireDatabase();
    const [row] = await database
      .select()
      .from(steadierCalendarFeeds)
      .where(
        and(
          eq(steadierCalendarFeeds.tokenHash, tokenHash),
          isNull(steadierCalendarFeeds.revokedAt)
        )
      )
      .limit(1);
    return row
      ? { id: row.id, userId: row.ownerId, hideTitles: row.hideTitles }
      : null;
  }

  async touchFeed(id: number, now: Date): Promise<void> {
    const database = await requireDatabase();
    await database
      .update(steadierCalendarFeeds)
      .set({ lastFetchedAt: now })
      .where(eq(steadierCalendarFeeds.id, id));
  }
}
