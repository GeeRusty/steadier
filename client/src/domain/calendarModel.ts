/**
 * Calendar data for a date range: explicit booked anchors, timed hard-deadline
 * markers, and separate Month-only bills, birthdays and renewals. Pure, so the
 * view and tests share one source of truth.
 */
import type {
  CredentialRenewal,
  Obligation,
  Project,
  Task,
  WorkspaceContact,
} from "./types";
import { repeatRuleOf } from "./engine";
import { nextObligationDueDate } from "./obligations";
import {
  occurrencesBetween,
  hasTimedDeadlineAnchor,
  isDate,
  isBookedAnchorSchedule,
  shiftDays,
  daysBetween,
  weekdayOf,
  WEEKDAY_SHORT,
  slotMinutes,
  timeToMinutes,
  type TimeEntry,
} from "./time";

export type CalendarItemKind =
  | "slot"
  | "projected"
  | "allday"
  | "window"
  | "deadline"
  | "planned-date"
  | "project-deadline"
  | "project-review"
  | "milestone"
  | "obligation"
  | "credential-renewal"
  | "birthday";

export interface CalendarItem {
  id: string;
  kind: CalendarItemKind;
  date: string;
  title: string;
  personId?: string;
  birthdayMonthDay?: string;
  taskId?: string;
  projectId?: string;
  /** Minutes from midnight (timed items only). */
  start?: number;
  minutes?: number;
  done?: boolean;
  fixed?: boolean;
  majorAnchor?: boolean;
  overdue?: boolean;
  repeating?: boolean;
  /** Flexible window items only: inclusive first and last day of the whole window. */
  windowStart?: string;
  windowEnd?: string;
  /** Flexible window items only: true for a later occurrence of a repeating window. */
  windowProjected?: boolean;
  /** A closed, unfinished window shown again on today so it can still be ticked. */
  windowCarried?: boolean;
  /** Layout for overlapping timed items. */
  lane?: number;
  lanes?: number;
  label?: string;
}

export interface CalendarDay {
  date: string;
  timed: CalendarItem[];
  allDay: CalendarItem[];
  /** Date-only deadlines and project dates, outside booked clock geometry. */
  dateMarkers: CalendarItem[];
  /** Bills, birthdays, and renewals are displayed only in Month view. */
  falldue: CalendarItem[];
  /** Actual focus time logged that day (planned vs actual). */
  actual: (TimeEntry & { taskId: string; title: string })[];
}

export interface CalendarFalldueData {
  obligations?: Obligation[];
  credentialRenewals?: CredentialRenewal[];
  people?: WorkspaceContact[];
}

export function dateRange(start: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => shiftDays(start, i));
}

export function buildCalendar(
  tasks: Task[],
  projects: Project[],
  dates: string[],
  today: string,
  falldue: CalendarFalldueData = {}
): CalendarDay[] {
  const first = dates[0];
  const last = dates[dates.length - 1];
  const byDate = new Map<string, CalendarDay>(
    dates.map(date => [
      date,
      { date, timed: [], allDay: [], dateMarkers: [], falldue: [], actual: [] },
    ])
  );
  const projectsById = new Map(projects.map(p => [p.id, p]));
  for (const task of tasks) {
    const s = task.schedule;
    const done = task.state === "done";
    const bookedAnchor = isBookedAnchorSchedule(s);
    const projectTitle = task.projectId
      ? projectsById.get(task.projectId)?.title
      : undefined;
    const rule = repeatRuleOf(task);
    if (s.date && bookedAnchor) {
      const day = byDate.get(s.date);
      if (day) {
        const base = {
          id: `${task.id}:slot`,
          date: s.date,
          title: task.title,
          taskId: task.id,
          done,
          fixed: true,
          majorAnchor: s.majorAnchor === true,
          overdue: !done && s.date < today,
          repeating: !!rule,
          label: projectTitle,
        };
        if (s.time) {
          day.timed.push({
            ...base,
            kind: "slot",
            start: timeToMinutes(s.time),
            minutes: slotMinutes(task),
          });
        } else {
          day.allDay.push({ ...base, kind: "allday" });
        }
      }
    } else if (s.date && !done && !s.flexibleWindow) {
      const day = byDate.get(s.date);
      if (day) {
        day.dateMarkers.push({
          id: `${task.id}:planned-date`,
          kind: "planned-date",
          date: s.date,
          title: task.title,
          taskId: task.id,
          fixed: false,
          repeating: !!rule,
          label: rule ? "Not booked · repeats" : "Planned date · not booked",
        });
      }
    }
    // Future booked occurrences occupy the clock; other future occurrences are
    // date-only informational markers and never reserve time.
    if (!done && !s.flexibleWindow && rule && rule.freq !== "after") {
      const patternDate =
        s.repeatOccurrenceDate ?? s.date ?? s.repeatAnchorDate;
      if (patternDate) {
        const anchorDate = s.repeatAnchorDate ?? patternDate;
        const repeatTime = s.repeatTime !== undefined ? s.repeatTime : s.time;
        const candidates = occurrencesBetween(
          rule,
          anchorDate,
          first,
          last
        ).filter(date => date > patternDate && date !== s.date);
        const remaining =
          rule.count === null
            ? candidates.length
            : Math.max(
                0,
                rule.count - s.completions.length - s.skipped.length - 1
              );
        const future = candidates.slice(0, remaining);
        for (const date of future) {
          const d = byDate.get(date);
          if (!d) continue;
          const item: CalendarItem = {
            id: `${task.id}:proj:${date}`,
            kind: bookedAnchor ? "projected" : "planned-date",
            date,
            title: task.title,
            taskId: task.id,
            repeating: true,
            fixed: bookedAnchor,
            majorAnchor: bookedAnchor && s.majorAnchor === true,
            label: bookedAnchor ? projectTitle : "Not booked · repeats",
          };
          if (!bookedAnchor) {
            d.dateMarkers.push(item);
          } else if (repeatTime)
            d.timed.push({
              ...item,
              start: timeToMinutes(repeatTime),
              minutes: slotMinutes(task),
            });
          else d.allDay.push(item);
        }
      }
    }
    // A flexible window is visible on every day it is open, but it is never a
    // clock event: it carries no start time, no duration and no booked status.
    if (!done && s.flexibleWindow) {
      const current = s.flexibleWindow;
      const spanDays = Math.max(
        0,
        daysBetween(current.startDate, current.endDate)
      );
      const addWindow = (startDate: string, projected: boolean) => {
        const endDate = shiftDays(startDate, spanDays);
        const closed = !projected && endDate < today;
        const range =
          spanDays === 0
            ? WEEKDAY_SHORT[weekdayOf(startDate)]
            : `${WEEKDAY_SHORT[weekdayOf(startDate)]}–${WEEKDAY_SHORT[weekdayOf(endDate)]}`;
        const label = `${closed ? "Window closed" : "Window"} · ${range}${projected ? " · repeats" : ""}`;
        if (closed) {
          const todayCell = byDate.get(today);
          if (todayCell)
            todayCell.dateMarkers.push({
              id: `${task.id}:window:${startDate}:carried`,
              kind: "window",
              date: today,
              title: task.title,
              taskId: task.id,
              fixed: false,
              overdue: true,
              repeating: !!rule,
              windowStart: startDate,
              windowEnd: endDate,
              windowProjected: false,
              windowCarried: true,
              label,
            });
        }
        for (let i = 0; i <= spanDays; i++) {
          const date = shiftDays(startDate, i);
          const day = byDate.get(date);
          if (!day) continue;
          day.dateMarkers.push({
            id: `${task.id}:window:${startDate}:${date}`,
            kind: "window",
            date,
            title: task.title,
            taskId: task.id,
            fixed: false,
            // Late only once the whole window has closed, never while it is open.
            overdue: closed,
            repeating: !!rule,
            windowStart: startDate,
            windowEnd: endDate,
            windowProjected: projected,
            label,
          });
        }
      };
      addWindow(current.startDate, false);
      if (rule && rule.freq !== "after") {
        const patternDate = s.repeatOccurrenceDate ?? current.startDate;
        const anchorDate = s.repeatAnchorDate ?? patternDate;
        const candidates = occurrencesBetween(
          rule,
          anchorDate,
          shiftDays(first, -spanDays),
          last
        ).filter(
          date =>
            date > patternDate &&
            date > today &&
            !(date >= current.startDate && date <= current.endDate)
        );
        const remaining =
          rule.count === null
            ? candidates.length
            : Math.max(
                0,
                rule.count - s.completions.length - s.skipped.length - 1
              );
        for (const date of candidates.slice(0, remaining))
          addWindow(date, true);
      }
    }
    if (task.deadline && !done && hasTimedDeadlineAnchor(s, task.deadline)) {
      const day = byDate.get(task.deadline);
      if (day && s.deadlineTime) {
        day.timed.push({
          id: `${task.id}:deadline`,
          kind: "deadline",
          date: task.deadline,
          title: task.title,
          taskId: task.id,
          start: timeToMinutes(s.deadlineTime),
          minutes: 0,
          fixed: false,
          majorAnchor: s.majorAnchor === true,
          overdue: task.deadline < today,
          label: `Deadline · ${s.deadlineTime}`,
        });
      }
    } else if (task.deadline && !done) {
      const day = byDate.get(task.deadline);
      if (day) {
        day.dateMarkers.push({
          id: `${task.id}:deadline`,
          kind: "deadline",
          date: task.deadline,
          title: task.title,
          taskId: task.id,
          fixed: false,
          overdue: task.deadline < today,
          label: "Hard deadline",
        });
      }
    }
    for (const entry of s.timeLog) {
      const day = byDate.get(entry.start.slice(0, 10));
      if (day)
        day.actual.push({ ...entry, taskId: task.id, title: task.title });
    }
  }
  for (const project of projects) {
    if (project.status !== "active") continue;
    const addDateMarker = (
      date: string | null,
      kind: CalendarItemKind,
      title: string,
      label: string,
      id: string
    ) => {
      if (!date) return;
      const day = byDate.get(date);
      if (!day) return;
      day.dateMarkers.push({
        id,
        kind,
        date,
        title,
        projectId: project.id,
        fixed: false,
        overdue: date < today,
        label,
      });
    };
    addDateMarker(
      project.schedule.deadline,
      "project-deadline",
      project.title,
      "Project deadline",
      `${project.id}:deadline`
    );
    addDateMarker(
      project.schedule.reviewDate,
      "project-review",
      project.title,
      "Project review",
      `${project.id}:review`
    );
    for (const scheduledMilestone of project.schedule.milestoneDates) {
      const milestone = project.milestones.find(
        item => item.id === scheduledMilestone.id
      );
      if (milestone && !milestone.done) {
        addDateMarker(
          scheduledMilestone.date,
          "milestone",
          `${milestone.title} (${project.title})`,
          "Milestone",
          `${project.id}:m:${milestone.id}`
        );
      }
    }
  }
  for (const day of byDate.values()) {
    for (const obligation of falldue.obligations ?? []) {
      if (obligation.status !== "active") continue;
      let dueDate = obligation.dueDate;
      for (let occurrence = 0; occurrence < 10_000 && dueDate <= day.date; occurrence += 1) {
        if (dueDate === day.date) {
          day.falldue.push({
            id: `${obligation.id}:due:${dueDate}`,
            kind: "obligation",
            date: dueDate,
            title: obligation.title,
            label: "Bill / obligation",
          });
          break;
        }
        if (obligation.cadence === "none") break;
        const next = nextObligationDueDate({ ...obligation, dueDate });
        if (!next || next <= dueDate) break;
        dueDate = next;
      }
    }
    for (const credential of falldue.credentialRenewals ?? []) {
      if (credential.renewalDate === day.date) {
        day.falldue.push({
          id: `${credential.id}:renewal:${credential.renewalDate}`,
          kind: "credential-renewal",
          date: credential.renewalDate,
          title: credential.name || credential.category,
          label: "Renewal",
        });
      }
    }
    for (const person of falldue.people ?? []) {
      if (
        person.status !== "active" ||
        !person.birthdayMonthDay ||
        `${day.date.slice(0, 4)}-${person.birthdayMonthDay}` !== day.date ||
        !isDate(day.date)
      )
        continue;
        day.falldue.push({
          id: `${person.id}:birthday:${day.date}`,
          kind: "birthday",
          date: day.date,
          title: person.name,
          personId: person.id,
          birthdayMonthDay: person.birthdayMonthDay,
          label: "Birthday",
        });
    }
    day.timed = day.timed.filter(
      item => item.kind === "deadline" || item.fixed === true
    );
    day.allDay = day.allDay.filter(item => item.fixed === true);
    layoutLanes(day.timed);
    day.allDay.sort(
      (a, b) =>
        kindOrder(a.kind) - kindOrder(b.kind) || a.title.localeCompare(b.title)
    );
    day.falldue.sort((a, b) => a.title.localeCompare(b.title));
    day.dateMarkers.sort(
      (a, b) =>
        kindOrder(a.kind) - kindOrder(b.kind) || a.title.localeCompare(b.title)
    );
  }
  return dates.map(date => byDate.get(date)!);
}

function kindOrder(kind: CalendarItemKind): number {
  return [
    "deadline",
    "planned-date",
    "project-deadline",
    "milestone",
    "window",
    "allday",
    "projected",
    "project-review",
    "slot",
  ].indexOf(kind);
}

/** Greedy lane assignment so overlapping blocks sit side by side. */
export function layoutLanes(items: CalendarItem[]): void {
  items.sort((a, b) => a.start! - b.start! || b.minutes! - a.minutes!);
  const durationBlocks = items.filter(
    item => item.kind !== "deadline" && (item.minutes ?? 0) > 0
  );
  let cluster: CalendarItem[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map(i => (i.lane ?? 0) + 1));
    for (const item of cluster) item.lanes = lanes;
    cluster = [];
  };
  const laneEnds: number[] = [];
  for (const item of durationBlocks) {
    const start = item.start!;
    const end = start + item.minutes!;
    if (start >= clusterEnd && cluster.length) {
      flush();
      laneEnds.length = 0;
    }
    let lane = laneEnds.findIndex(e => e <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = end;
    item.lane = lane;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (cluster.length) flush();
  for (const item of items) {
    if (item.kind === "deadline" || (item.minutes ?? 0) === 0) {
      item.lane = 0;
      item.lanes = 1;
    }
  }
}

/** Count intersecting timed item pairs without changing their layout or data. */
export function countOverlappingTimedItems(
  items: readonly CalendarItem[]
): number {
  const sorted = items
    .filter(
      item =>
        typeof item.start === "number" &&
        typeof item.minutes === "number" &&
        item.minutes > 0
    )
    .slice()
    .sort((a, b) => a.start! - b.start!);
  let overlaps = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    const currentEnd = current.start! + current.minutes!;
    for (
      let j = i + 1;
      j < sorted.length && sorted[j].start! < currentEnd;
      j += 1
    ) {
      if (sorted[j].start! + sorted[j].minutes! > current.start!) overlaps += 1;
    }
  }
  return overlaps;
}

/** Free gaps (minutes from midnight) in a day between `from` and `to`. */
export function freeGaps(
  busy: { start: number; end: number }[],
  from: number,
  to: number
): { start: number; end: number }[] {
  const sorted = [...busy].sort((a, b) => a.start - b.start);
  const gaps: { start: number; end: number }[] = [];
  let cursor = from;
  for (const block of sorted) {
    if (block.end <= cursor) continue;
    if (block.start > cursor)
      gaps.push({ start: cursor, end: Math.min(block.start, to) });
    cursor = Math.max(cursor, block.end);
    if (cursor >= to) break;
  }
  if (cursor < to) gaps.push({ start: cursor, end: to });
  return gaps.filter(g => g.end > g.start);
}
