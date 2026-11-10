import type { FocusSession, Project, Task } from "./types";
import {
  buildCalendar,
  type CalendarItem,
} from "./calendarModel";

/** A late open of Steadier may still catch up a booked start for 15 minutes. */
export const CALENDAR_AUTO_START_GRACE_MINUTES = 15;

export interface CalendarFocusStartCandidate {
  key: string;
  itemId: string;
  taskId: string;
  date: string;
  start: number;
  durationMinutes: number;
  title: string;
  kind: "slot" | "projected";
}

export type CalendarFocusStartDecision =
  | "start"
  | "already-active"
  | "wait-for-current-focus"
  | "wait-for-remote-focus"
  | "task-not-ready"
  | "focus-unavailable";

export function calendarFocusStartDecision(
  taskId: string,
  focus: Pick<FocusSession, "taskId" | "remaining" | "running"> | null,
  remoteFocus: boolean,
  canStart: boolean,
  taskReady: boolean
): CalendarFocusStartDecision {
  if (remoteFocus) return "wait-for-remote-focus";
  if (
    focus?.taskId === taskId &&
    focus.running &&
    focus.remaining > 0
  ) {
    return "already-active";
  }
  if (focus && focus.taskId !== taskId && focus.remaining > 0) {
    return "wait-for-current-focus";
  }
  if (!taskReady) return "task-not-ready";
  if (!canStart) return "focus-unavailable";
  return "start";
}

export function calendarFocusStartKey(
  item: Pick<CalendarItem, "id" | "date" | "start">
): string {
  return `${item.id}|${item.date}|${item.start ?? ""}`;
}

/**
 * Select booked, clock-timed task occurrences due now or up to 15 minutes ago.
 * Uses the Calendar's own occurrence builder, so recurrence, Adelaide dates,
 * and flexible-window exclusions stay aligned with the visible Calendar.
 */
export function dueCalendarFocusStarts(
  tasks: Task[],
  projects: Project[],
  date: string,
  currentMinute: number,
  handledKeys: ReadonlySet<string> = new Set()
): CalendarFocusStartCandidate[] {
  if (
    !Number.isInteger(currentMinute) ||
    currentMinute < 0 ||
    currentMinute >= 24 * 60
  ) {
    return [];
  }
  const day = buildCalendar(tasks, projects, [date], date)[0];
  if (!day) return [];

  return day.timed
    .filter(
      item =>
        (item.kind === "slot" || item.kind === "projected") &&
        item.taskId &&
        item.start !== undefined &&
        !item.done &&
        item.start <= currentMinute &&
        currentMinute - item.start <= CALENDAR_AUTO_START_GRACE_MINUTES &&
        !handledKeys.has(calendarFocusStartKey(item))
    )
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || a.id.localeCompare(b.id))
    .flatMap(item =>
      item.taskId === undefined || item.start === undefined
        ? []
        : [
            {
              key: calendarFocusStartKey(item),
              itemId: item.id,
              taskId: item.taskId,
              date: item.date,
              start: item.start,
              durationMinutes: item.minutes ?? 15,
              title: item.title,
              kind: item.kind as "slot" | "projected",
            },
          ]
    );
}
