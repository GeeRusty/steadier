import type { Task, Workspace } from "./types";
import {
  DEFAULT_PLANNING,
  adelaideClock,
  isDate,
  slotMinutes,
  isBookedAnchorSchedule,
  isTimingAnchor,
  timeToMinutes,
  type PlanningSettings,
} from "./time";
import { derivedState } from "./engine";

/** A task with an explicit booked block or a real deadline clock marker. */
export function isTaskAnchor(task: Task): boolean {
  return isTimingAnchor(task.schedule, task.deadline);
}

/** A block that consumes planned capacity; deadline markers are zero-duration. */
export function isBookedAnchor(task: Task): boolean {
  return isBookedAnchorSchedule(task.schedule);
}

export function isMajorAnchor(task: Task): boolean {
  return isTaskAnchor(task) && task.schedule.majorAnchor === true;
}

/** A fixed block is no longer occupying today's future capacity once it ended. */
export function isSlippedAnchor(
  task: Task,
  day: string,
  minute: number
): boolean {
  if (!isBookedAnchor(task) || task.state === "done") return false;
  const date = task.schedule.date ?? task.deadline;
  if (!date || date > day) return false;
  if (date < day) return true;
  if (task.schedule.deadlineTime && task.deadline === day) {
    return timeToMinutes(task.schedule.deadlineTime) < minute;
  }
  if (!task.schedule.time) return minute >= 1440;
  return timeToMinutes(task.schedule.time) + slotMinutes(task) <= minute;
}

/**
 * Work that can be chosen now without a time slot. Dates remain availability
 * constraints; they never create a clock block. A slipped booking becomes pool
 * work by derivation only, leaving its stored booking untouched.
 */
export function poolTasks(
  tasks: Task[],
  day: string,
  minute: number
): Task[] {
  return tasks.filter(task => {
    if (task.state === "done" || task.state === "someday" || task.droppedAt)
      return false;
    const availabilityDate =
      task.schedule.flexibleWindow?.startDate ?? task.schedule.date;
    if (availabilityDate && availabilityDate > day) return false;
    const stateTask = isBookedAnchor(task)
      ? task
      : { ...task, schedule: { ...task.schedule, time: null, fixed: false } };
    const state = derivedState(stateTask, tasks, day);
    if (state === "waiting" || state === "blocked" || state === "deferred")
      return false;
    if (state === "scheduled" && !isSlippedAnchor(task, day, minute))
      return false;
    if (isBookedAnchor(task) && !isSlippedAnchor(task, day, minute)) return false;
    return state === "ready" || state === "inbox" || state === "scheduled";
  });
}

export function taskPassOvers(task: Task): number {
  return Number.isInteger(task.passOverCount) && (task.passOverCount ?? 0) > 0
    ? task.passOverCount!
    : 0;
}

export function passOverThreshold(
  workspace: Pick<Workspace, "planning">
): number {
  const value = workspace.planning?.passOverThreshold;
  return Number.isInteger(value) && value! >= 1 && value! <= 10
    ? value!
    : DEFAULT_PLANNING.passOverThreshold ?? 3;
}

export interface AnchorFinish {
  plannedEnd: number;
  likelyEnd: number | null;
  overrunRatio: number | null;
  samples: number;
}

function completedActualSamples(tasks: Task[]): number[] {
  const samples: number[] = [];
  for (const task of tasks) {
    if (!isBookedAnchor(task)) continue;
    const planned = task.schedule.minutes ?? task.estimate;
    if (!Number.isFinite(planned) || planned <= 0) continue;

    const actualByDate = new Map<string, number>();
    for (const entry of task.schedule.timeLog) {
      const date = entry.start.slice(0, 10);
      actualByDate.set(date, (actualByDate.get(date) ?? 0) + entry.minutes);
    }
    const completedDates = new Set(task.schedule.completions);
    if (task.state === "done" && task.completedAt) {
      const date = adelaideClock(new Date(task.completedAt)).date;
      if (Number.isFinite(Date.parse(task.completedAt))) completedDates.add(date);
    }
    if (task.state === "done" && completedDates.size === 0) {
      for (const date of actualByDate.keys()) completedDates.add(date);
    }
    for (const date of completedDates) {
      const actual = actualByDate.get(date) ?? 0;
      if (actual > 0) samples.push(actual / planned);
    }
  }
  return samples.filter(value => Number.isFinite(value) && value > 0);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function estimateAnchorFinish(
  task: Task,
  tasks: Task[]
): AnchorFinish | null {
  if (!isBookedAnchor(task) || !task.schedule.time) return null;
  const plannedEnd = timeToMinutes(task.schedule.time) + slotMinutes(task);
  const ratios = completedActualSamples(tasks);
  if (ratios.length < 3) {
    return { plannedEnd, likelyEnd: null, overrunRatio: null, samples: ratios.length };
  }
  const ratio = median(ratios);
  if (ratio === null) {
    return { plannedEnd, likelyEnd: null, overrunRatio: null, samples: 0 };
  }
  return {
    plannedEnd,
    likelyEnd: Math.max(plannedEnd, Math.ceil(timeToMinutes(task.schedule.time) + slotMinutes(task) * ratio)),
    overrunRatio: ratio,
    samples: ratios.length,
  };
}

export function freeAfterLastAnchorMinutes(
  tasks: Task[],
  day: string,
  settings: PlanningSettings,
  nowMinute: number,
  today: string
): number {
  const dayStart = timeToMinutes(settings.dayStart);
  const dayEnd = timeToMinutes(settings.dayEnd);
  if (dayEnd <= dayStart) return 0;
  const anchors = tasks.filter(
    task =>
      isBookedAnchor(task) &&
      task.state !== "done" &&
      task.schedule.date === day
  );
  if (anchors.some(task => !task.schedule.time)) return 0;
  const likelyFinishes = anchors.map(task => {
    const estimate = estimateAnchorFinish(task, tasks);
    return estimate?.likelyEnd ?? estimate?.plannedEnd ?? dayStart;
  });
  const earliestAvailable =
    day === today
      ? Math.max(dayStart, nowMinute, ...likelyFinishes)
      : Math.max(dayStart, ...likelyFinishes);
  return Math.max(0, dayEnd - Math.min(dayEnd, earliestAvailable));
}

/** Add a task to the selected next-thing pointer without changing the task. */
export function setWorkspaceNextThing(
  workspace: Workspace,
  taskId: string,
  when: string,
  date: string,
  updatedAt: string
): Workspace {
  const task = workspace.tasks.find(candidate => candidate.id === taskId);
  if (
    !task ||
    task.state === "done" ||
    task.state === "someday" ||
    task.droppedAt ||
    when.length > 300 ||
    !isDate(date) ||
    !updatedAt.trim()
  )
    return workspace;
  return {
    ...workspace,
    nextThing: { taskId, when: when.trim(), date, updatedAt },
  };
}

export function clearWorkspaceNextThing(workspace: Workspace): Workspace {
  if (!workspace.nextThing) return workspace;
  return { ...workspace, nextThing: null };
}

function recordDecision(task: Task, text: string, at: string): Task {
  return {
    ...task,
    updatedAt: at,
    history: [...task.history, { at, text }].slice(-1000),
  };
}

export function recordNotNow(task: Task, at: string): Task {
  return {
    ...recordDecision(task, "Not now · returned to today's untimed pool", at),
    passOverCount: taskPassOvers(task) + 1,
  };
}

export function markDropped(task: Task, at: string): Task {
  return {
    ...recordDecision(task, "Dropped — kept decision", at),
    droppedAt: at,
    passOverCount: taskPassOvers(task),
  };
}

export function markStillOn(task: Task, at: string): Task {
  return {
    ...recordDecision(task, "Still on · pass-over count reset", at),
    passOverCount: 0,
  };
}

export function reconsiderDropped(task: Task, at: string): Task {
  return {
    ...recordDecision(task, "Dropped decision reversed · returned to pool", at),
    droppedAt: null,
    passOverCount: 0,
  };
}

/**
 * The date by which an open task was meant to be done, or null when it has none.
 * A flexible window is only past when the whole window has closed; otherwise the
 * planned day, then the real deadline, is used. Derived only, never stored.
 */
export function pastDueDate(task: Task): string | null {
  const window = task.schedule.flexibleWindow;
  if (window) return window.endDate;
  if (task.schedule.date) return task.schedule.date;
  return task.deadline || null;
}
/** Open, not parked, and its date or window has passed. Oldest first. */
export function pastDueTasks(tasks: Task[], today: string): Task[] {
  return tasks
    .filter(task => {
      if (task.state === "done" || task.state === "someday") return false;
      const due = pastDueDate(task);
      return !!due && isDate(due) && due < today;
    })
    .sort((a, b) =>
      (pastDueDate(a) || "").localeCompare(pastDueDate(b) || "")
    );
}
