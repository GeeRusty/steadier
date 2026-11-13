/**
 * Calendar Board: one line per booked item, like a departure board.
 * time · title · status (status last). Status shows only when something is
 * off normal; see docs/design-language.md (Calendar).
 */
import type { CalendarDay } from "./calendarModel";
import { estimateAnchorFinish } from "./anchorPlanning";
import { effectiveTaskRole } from "./linkCheck";
import { clockText } from "./todayPlan";
import type { Task, Workspace } from "./types";

/** Show the likely finish only when it is this many minutes or more late. */
export const LATE_THRESHOLD_MINUTES = 10;

export interface BoardRow {
  id: string;
  taskId: string | null;
  start: number;
  timeText: string;
  title: string;
  status: string | null;
  red: boolean;
  done: boolean;
  green: boolean;
}

export function boardRows(
  day: CalendarDay,
  tasks: Task[],
  workspace: Pick<Workspace, "imperatives" | "projects">,
  today: string,
  minute: number
): BoardRow[] {
  const isToday = day.date === today;
  const items = day.timed.filter(item => item.start !== undefined);
  const fixedStarts = items
    .filter(item => item.fixed && item.kind !== "deadline" && !item.done)
    .map(item => ({ id: item.id, start: item.start! }));
  const deadlinePoints = items.filter(item => item.kind === "deadline" && !item.done).map(item => item.start!);

  return items
    .map(item => {
      const task = item.taskId ? tasks.find(t => t.id === item.taskId) : undefined;
      const start = item.start!;
      const end = start + (item.minutes ?? 0);
      const done = !!item.done || task?.state === "done";
      let status: string | null = null;
      let red = false;
      if (done) status = "Done";
      else if (item.kind === "deadline") status = "Due";
      else if (isToday && item.fixed) {
        let likelyEnd = end;
        const estimate = task ? estimateAnchorFinish(task, tasks) : null;
        if (estimate?.overrunRatio != null && (item.minutes ?? 0) > 0) {
          likelyEnd = Math.ceil(start + (item.minutes ?? 0) * estimate.overrunRatio);
        }
        const late = likelyEnd - end;
        if (Math.max(end, likelyEnd) <= minute) status = "Slipped";
        else if (late >= LATE_THRESHOLD_MINUTES) {
          status = `~${clockText(likelyEnd)} · +${late}m`;
          const nextFixed = fixedStarts.filter(f => f.id !== item.id && f.start > start).sort((a, b) => a.start - b.start)[0];
          const nextDeadline = deadlinePoints.filter(d => d > start).sort((a, b) => a - b)[0];
          const limit = Math.min(nextFixed?.start ?? Infinity, nextDeadline ?? Infinity);
          red = likelyEnd > limit;
        } else if (start <= minute && minute < end) status = "Now";
      }
      return {
        id: item.id,
        taskId: item.taskId ?? null,
        start,
        timeText: clockText(start),
        title: item.title,
        status,
        red,
        done,
        green: !!task && effectiveTaskRole(task, workspace) === "direction",
      };
    })
    .sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}
