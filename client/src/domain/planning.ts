/**
 * Time reports and booked-anchor reminders. Automatic task placement and
 * movement are intentionally disabled; task time changes require explicit
 * booking or an owner action in Calendar.
 */
import type { Project, Task } from "./types";
import {
  DEFAULT_PLANNING,
  shiftDays,
  slotMinutes,
  timeToMinutes,
  weekStart,
  isBookedAnchorSchedule,
  type PlanningSettings,
} from "./time";

export interface PlannedBlock {
  taskId: string;
  title: string;
  date: string;
  start: number;
  minutes: number;
}

/** No task is auto-placed; the owner explicitly books anchors in the editor. */
export function planCandidates(_tasks: Task[], _today: string): Task[] {
  return [];
}

/** Kept for compatibility; automatic time-block suggestions are disabled. */
export function planMyDay(
  _tasks: Task[],
  _today: string,
  _nowMinutes: number,
  _settings: PlanningSettings = DEFAULT_PLANNING,
  _limit = 6
): PlannedBlock[] {
  return [];
}

/** Applies planned blocks, recording history on each task. */
export function applyPlan(
  tasks: Task[],
  _plan: PlannedBlock[],
  _verb = "Planned"
): Task[] {
  return tasks;
}

/** Open timed blocks whose time has passed (today before now, or earlier days). */
export function missedBlocks(
  tasks: Task[],
  today: string,
  nowMinutes: number
): Task[] {
  return tasks.filter(t => {
    const s = t.schedule;
    if (
      t.state === "done" ||
      !s.date ||
      !s.time ||
      !isBookedAnchorSchedule(s)
    )
      return false;
    if (s.missedHandled === s.date) return false;
    if (s.date < today) return s.date >= shiftDays(today, -7);
    if (s.date > today) return false;
    return timeToMinutes(s.time) + slotMinutes(t) <= nowMinutes;
  });
}

/** Calendar is the only place that can deliberately move a booked anchor. */
export function resetMyDay(
  _tasks: Task[],
  _today: string,
  _nowMinutes: number,
  _settings: PlanningSettings = DEFAULT_PLANNING
): PlannedBlock[] {
  return [];
}

/** Applies a reset plan (start -1 = that day, any time). */
export function applyReset(tasks: Task[], _plan: PlannedBlock[]): Task[] {
  return tasks;
}

/** Marks a missed block as handled without moving it ("leave it"). */
export function dismissMissed(task: Task): Task {
  if (!isBookedAnchorSchedule(task.schedule)) return task;
  return {
    ...task,
    schedule: { ...task.schedule, missedHandled: task.schedule.date },
  };
}

// ---------------------------------------------------------------------------
// Time actually spent
// ---------------------------------------------------------------------------

/** Adds a focus/manual entry, keeping the log within its limit. */
export function logTime(
  task: Task,
  start: string,
  minutes: number,
  source: "focus" | "manual"
): Task {
  if (minutes < 1) return task;
  const timeLog = [
    ...task.schedule.timeLog,
    { start, minutes: Math.round(minutes), source },
  ].slice(-2000);
  return { ...task, schedule: { ...task.schedule, timeLog } };
}

export function minutesLogged(task: Task, from: string, to: string): number {
  return task.schedule.timeLog
    .filter(e => e.start.slice(0, 10) >= from && e.start.slice(0, 10) <= to)
    .reduce((sum, e) => sum + e.minutes, 0);
}

export interface BudgetStatus {
  projectId: string;
  title: string;
  budget: number;
  spent: number;
  planned: number;
}

/** Weekly time budgets for active projects (Monday-start week, Adelaide). */
export function weeklyBudgets(
  projects: Project[],
  tasks: Task[],
  today: string
): BudgetStatus[] {
  const from = weekStart(today);
  const to = shiftDays(from, 6);
  return projects
    .filter(p => p.status === "active" && p.schedule.weeklyBudgetMinutes)
    .map(p => {
      const own = tasks.filter(t => t.projectId === p.id);
      const spent = own.reduce((sum, t) => sum + minutesLogged(t, from, to), 0);
      const planned = own
        .filter(
          t =>
            t.state !== "done" &&
            isBookedAnchorSchedule(t.schedule) &&
            t.schedule.date &&
            t.schedule.date >= today &&
            t.schedule.date <= to
        )
        .reduce((sum, t) => sum + slotMinutes(t), 0);
      return {
        projectId: p.id,
        title: p.title,
        budget: p.schedule.weeklyBudgetMinutes!,
        spent,
        planned,
      };
    });
}

export interface DayTotals {
  date: string;
  planned: number;
  actual: number;
}

/** Planned (timed blocks) vs actual (logged) minutes per day. */
export function plannedVsActual(tasks: Task[], dates: string[]): DayTotals[] {
  return dates.map(date => ({
    date,
    planned: tasks
      .filter(
        t =>
          isBookedAnchorSchedule(t.schedule) &&
          t.schedule.date === date &&
          t.schedule.time
      )
      .reduce((sum, t) => sum + slotMinutes(t), 0),
    actual: tasks.reduce((sum, t) => sum + minutesLogged(t, date, date), 0),
  }));
}

/** Minutes of timed, open blocks still ahead today (for "how full is today"). */
export function remainingLoad(
  tasks: Task[],
  today: string,
  nowMinutes: number
): number {
  return tasks
    .filter(
      t =>
        t.state !== "done" &&
        isBookedAnchorSchedule(t.schedule) &&
        t.schedule.date === today &&
        t.schedule.time
    )
    .filter(t => timeToMinutes(t.schedule.time!) + slotMinutes(t) > nowMinutes)
    .reduce((sum, t) => sum + slotMinutes(t), 0);
}
