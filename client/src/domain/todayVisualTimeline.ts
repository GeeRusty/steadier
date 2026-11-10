import { estimateAnchorFinish } from "./anchorPlanning";
import { buildCalendar, countOverlappingTimedItems, type CalendarDay } from "./calendarModel";
import {
  DEFAULT_PLANNING,
  isTime,
  timeToMinutes,
  type PlanningSettings,
} from "./time";
import type { Project, Task } from "./types";

export interface AnchorFinishDisplay {
  itemId: string;
  plannedEnd: number;
  likelyEnd: number;
  samples: number;
}

export interface TodayVisualTimelineModel {
  day: CalendarDay;
  startHour: number;
  endHour: number;
  planningStart: number;
  planningEnd: number;
  freeAfterMinutes: number;
  freeAfterLabel: string;
  overrunSamples: number;
  anchorFinishes: AnchorFinishDisplay[];
  overlapCount: number;
}

/**
 * Build today's read-only strip from the shared Calendar anchor model. It does
 * not expose edit callbacks, show free-space invitations, or place task data.
 */
export function buildTodayVisualTimelineModel(
  tasks: Task[],
  projects: Project[],
  date: string,
  nowMinutes: number,
  planning: PlanningSettings = DEFAULT_PLANNING
): TodayVisualTimelineModel {
  const day = buildCalendar(tasks, projects, [date], date)[0];
  const rawStart = isTime(planning.dayStart)
    ? timeToMinutes(planning.dayStart)
    : timeToMinutes(DEFAULT_PLANNING.dayStart);
  const rawEnd = isTime(planning.dayEnd)
    ? timeToMinutes(planning.dayEnd)
    : timeToMinutes(DEFAULT_PLANNING.dayEnd);
  const [planningStart, planningEnd] =
    rawEnd > rawStart
      ? [rawStart, rawEnd]
      : [
          timeToMinutes(DEFAULT_PLANNING.dayStart),
          timeToMinutes(DEFAULT_PLANNING.dayEnd),
        ];
  const now = Math.max(0, Math.min(24 * 60 - 1, Math.floor(nowMinutes)));
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const anchorFinishes: AnchorFinishDisplay[] = [];
  let overrunSamples = 0;

  for (const item of day.timed) {
    if (!item.fixed || item.kind === "deadline" || item.start === undefined) continue;
    const task = item.taskId ? taskById.get(item.taskId) : undefined;
    const duration = item.minutes ?? 0;
    const plannedEnd = item.start + duration;
    const estimate = task ? estimateAnchorFinish(task, tasks) : null;
    overrunSamples = Math.max(overrunSamples, estimate?.samples ?? 0);
    const likelyEnd =
      estimate?.overrunRatio !== null && estimate?.overrunRatio !== undefined
        ? Math.max(plannedEnd, Math.ceil(item.start + duration * estimate.overrunRatio))
        : plannedEnd;
    anchorFinishes.push({
      itemId: item.id,
      plannedEnd,
      likelyEnd,
      samples: estimate?.samples ?? 0,
    });
  }

  const hasAllDayAnchor = day.allDay.some(item => item.fixed);
  const lastFinish = anchorFinishes.reduce(
    (latest, finish) => Math.max(latest, finish.likelyEnd),
    planningStart
  );
  const freeFrom = Math.max(planningStart, now, lastFinish);
  const freeAfterMinutes = hasAllDayAnchor
    ? 0
    : Math.max(0, planningEnd - Math.min(planningEnd, freeFrom));
  const sortedTimedAnchors = [...day.timed]
    .filter(item => item.fixed && item.kind !== "deadline" && item.start !== undefined)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const lastTimedAnchor = sortedTimedAnchors[sortedTimedAnchors.length - 1];
  const lastFinishRecord = lastTimedAnchor
    ? anchorFinishes.find(finish => finish.itemId === lastTimedAnchor.id)
    : undefined;
  const freeAfterLabel = hasAllDayAnchor
    ? "All-day booked anchor"
    : lastTimedAnchor && lastFinishRecord && lastFinishRecord.likelyEnd > now
      ? `Free after ${lastTimedAnchor.title}`
      : "Free from now";

  const rangeStarts = [
    planningStart,
    now,
    ...day.timed.map(item => item.start ?? 0),
  ];
  const rangeEnds = [
    planningEnd,
    now + 1,
    ...day.timed.map(item => (item.start ?? 0) + (item.minutes ?? 0)),
    ...anchorFinishes.map(finish => finish.likelyEnd),
  ];
  const startHour = Math.max(0, Math.floor(Math.min(...rangeStarts) / 60));
  const endHour = Math.min(
    24,
    Math.max(
      startHour + 1,
      Math.ceil(Math.min(24 * 60, Math.max(...rangeEnds)) / 60)
    )
  );

  return {
    day,
    startHour,
    endHour,
    planningStart,
    planningEnd,
    freeAfterMinutes,
    freeAfterLabel,
    overrunSamples,
    anchorFinishes,
    overlapCount: countOverlappingTimedItems(day.timed),
  };
}
