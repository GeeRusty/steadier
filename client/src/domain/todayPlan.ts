/**
 * Today = do. One Now · Next · Later list, ordered by time only.
 * See docs/design-language.md. Nothing here ranks work or changes data;
 * the only writes are the owner's own taps (keepGoing, removePrerequisites).
 */
import { buildCalendar, type CalendarItem } from "./calendarModel";
import { estimateAnchorFinish, pastDueTasks } from "./anchorPlanning";
import { pendingPlacement } from "./compass";
import { derivedState, repeatRuleOf } from "./engine";
import { effectiveTaskRole } from "./linkCheck";
import { createStatusMarkData, statusMarkColorForTask, statusMarkColorForProject, type StatusMarkData } from "./statusMarkColor";
import { statusMarkStalenessForTask } from "./statusMarkStaleness";
import { isFaded } from "./taskCard";
import { daysBetween, minutesToTime, slotMinutes, timeToMinutes } from "./time";
import { taskRescheduleCount } from "./timingShape";
import type { Project, Task, Workspace } from "./types";

export type ChipKind = "clash" | "slipped" | "overdue" | "late" | "early" | "moved" | "review" | "quiet";
export interface Chip {
  kind: ChipKind;
  text: string;
  /** Red only when it will clash with a fixed booking or deadline. */
  red: boolean;
}

export interface TodayRow {
  task: Task;
  /** Minutes after midnight, or null for dated-but-untimed. */
  start: number | null;
  /** Planned end (minutes), when booked. */
  end: number | null;
  /** Honest likely end (minutes), when booked. */
  likelyEnd: number | null;
  timeText: string;
  chips: Chip[];
  /** Serves an active Imperative through a confirmed link: the green bar. */
  green: boolean;
  faded: boolean;
  suggested: boolean;
  brokenLink: boolean;
  /** "Life Admin" / "Erosion Guard" small text label. */
  label: string | null;
  /** Unfinished prerequisites, when booked today. */
  blockedBy: Task[];
}

export interface TodayPlan {
  now: (TodayRow & { mode: "block" | "focus" | "next" | "upnext"; minutesUntil?: number }) | null;
  slipped: (TodayRow & { again: boolean })[];
  next: (TodayRow & { when: string | null }) | null;
  later: TodayRow[];
}

const KEPT_GOING = /^Slipped: kept going\b/;

export function clockText(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, "0")}` : `${hour}:00`;
}

function delta(minutes: number): string {
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` : `${minutes}m`;
}

/** Times the owner chose "Keep going" for this task's slip today. */
export function keptGoingToday(task: Task, day: string): number {
  return (task.history ?? []).filter(e => KEPT_GOING.test(e.text) && e.at.slice(0, 10) === day).length;
}

/** The broken-link icon: where the old red mark was (no Goal Outcome, or an Imperative mismatch). */
export function taskHasBrokenLink(task: Task, data: StatusMarkData): boolean {
  if (task.state === "someday" || !task.projectId) return false;
  return statusMarkColorForTask(task, data).color === "red";
}
export function projectHasBrokenLink(project: Project, data: StatusMarkData): boolean {
  return statusMarkColorForProject(project, data).color === "red";
}

function catchAllLabel(task: Task): string | null {
  if (task.projectId || !task.compass?.catchAllConfirmed) return null;
  return task.compass.catchAll === "life-admin" ? "Life Admin" : task.compass.catchAll === "erosion-guard" ? "Erosion Guard" : null;
}

export interface ChipContext {
  day: string;
  minute: number;
  lastReviewDate: string | null;
}

/** The status chips for any open task, most time-critical first, at most two. */
export function taskChips(
  task: Task,
  ctx: ChipContext,
  extra: { clashAt?: number | null; slipped?: boolean; lateBy?: number; earlyBy?: number } = {}
): Chip[] {
  const chips: Chip[] = [];
  if (task.state === "done") return chips;
  if (extra.clashAt != null) chips.push({ kind: "clash", text: `clashes ${clockText(extra.clashAt)}`, red: true });
  if (extra.slipped) chips.push({ kind: "slipped", text: "slipped", red: false });
  const due = task.deadline;
  if (due && due < ctx.day) chips.push({ kind: "overdue", text: `overdue ${daysBetween(due, ctx.day)}d`, red: false });
  else if (task.schedule.date && task.schedule.date < ctx.day && !repeatRuleOf(task))
    chips.push({ kind: "overdue", text: `overdue ${daysBetween(task.schedule.date, ctx.day)}d`, red: false });
  if (extra.lateBy && extra.lateBy > 0) chips.push({ kind: "late", text: `⏱ +${delta(extra.lateBy)}`, red: false });
  if (extra.earlyBy && extra.earlyBy > 0) chips.push({ kind: "early", text: `⏱ −${delta(extra.earlyBy)}`, red: false });
  const moved = taskRescheduleCount(task);
  if (moved >= 3) chips.push({ kind: "moved", text: `moved ${moved}×`, red: false });
  const stale = statusMarkStalenessForTask(task, ctx.lastReviewDate, { date: ctx.day, minutes: ctx.minute });
  if (task.reviewDate && task.reviewDate <= ctx.day) chips.push({ kind: "review", text: "review due", red: false });
  else if (!task.schedule.date && !task.deadline && stale.quietDays !== null && stale.quietDays >= 7)
    chips.push({ kind: "quiet", text: `quiet ${stale.quietDays}d`, red: false });
  return chips.slice(0, 2);
}

interface Slot {
  task: Task;
  start: number | null;
  minutes: number;
  fixed: boolean;
  item: CalendarItem;
}

function slotsForToday(workspace: Workspace, tasks: Task[], day: string): Slot[] {
  const calendar = buildCalendar(tasks, workspace.projects, [day], day)[0];
  const byId = new Map(tasks.map(t => [t.id, t]));
  const seen = new Map<string, Slot>();
  const consider = (item: CalendarItem, timed: boolean) => {
    if (!item.taskId || item.done || item.date !== day) return;
    if (item.kind === "window") return;
    const task = byId.get(item.taskId);
    if (!task || task.state === "done" || task.state === "someday" || task.droppedAt) return;
    const start = timed && item.start !== undefined ? item.start : null;
    const existing = seen.get(task.id);
    // One thing, once: keep the earliest timed appearance.
    if (existing && (existing.start !== null || start === null)) {
      if (existing.start === null || start === null || existing.start <= start) return;
    }
    seen.set(task.id, {
      task,
      start,
      minutes: item.minutes ?? slotMinutes(task),
      fixed: timed && item.kind !== "deadline" && !!item.fixed,
      item,
    });
  };
  for (const item of calendar?.timed ?? []) consider(item, true);
  for (const item of [...(calendar?.allDay ?? []), ...(calendar?.dateMarkers ?? [])]) consider(item, false);
  return [...seen.values()];
}

export function todayPlan(workspace: Workspace, tasks: Task[], day: string, minute: number): TodayPlan {
  const data = createStatusMarkData(workspace);
  const lastReviewDate = latestReview(workspace);
  const ctx: ChipContext = { day, minute, lastReviewDate };
  const slots = slotsForToday(workspace, tasks, day);
  const fixedStarts = slots.filter(s => s.fixed && s.start !== null).map(s => ({ id: s.task.id, start: s.start! }));

  const rowFor = (slot: { task: Task; start: number | null; minutes: number; fixed?: boolean }, slippedNow = false): TodayRow => {
    const { task, start, minutes } = slot;
    const end = start !== null ? start + minutes : null;
    let likelyEnd = end;
    let earlyBy = 0;
    if (start !== null && end !== null) {
      const estimate = task.schedule.time && task.schedule.date === day ? estimateAnchorFinish(task, tasks) : null;
      const ratio = estimate?.overrunRatio ?? null;
      if (ratio !== null) {
        likelyEnd = Math.ceil(start + minutes * ratio);
        if (likelyEnd < end) earlyBy = end - likelyEnd;
      }
    }
    let clashAt: number | null = null;
    if (start !== null && likelyEnd !== null) {
      const following = fixedStarts.filter(f => f.id !== task.id && f.start > start).sort((a, b) => a.start - b.start)[0];
      if (following && likelyEnd > following.start) clashAt = following.start;
      if (task.deadline === day && task.schedule.deadlineTime) {
        const dl = timeToMinutes(task.schedule.deadlineTime);
        if (likelyEnd > dl && dl > start && (clashAt === null || dl < clashAt)) clashAt = dl;
      }
    }
    const state = derivedState(task, tasks);
    const blockedBy =
      state === "blocked"
        ? task.dependencies
            .map(id => tasks.find(t => t.id === id))
            .filter((t): t is Task => !!t && t.state !== "done")
        : [];
    return {
      task,
      start,
      end,
      likelyEnd,
      timeText:
        start === null
          ? task.deadline === day
            ? task.schedule.deadlineTime
              ? `by ${clockText(timeToMinutes(task.schedule.deadlineTime))}`
              : "due"
            : "today"
          : clockText(start),
      chips: taskChips(task, ctx, {
        clashAt,
        slipped: slippedNow,
        lateBy: end !== null && likelyEnd !== null && likelyEnd > end ? likelyEnd - end : 0,
        earlyBy,
      }),
      green: effectiveTaskRole(task, workspace) === "direction",
      faded: isFaded(task, tasks),
      suggested: pendingPlacement(task) !== null,
      brokenLink: taskHasBrokenLink(task, data),
      label: catchAllLabel(task),
      blockedBy,
    };
  };

  // Now: the booked block running now, else the focus timer, else the chosen Next thing.
  let now: TodayPlan["now"] = null;
  const used = new Set<string>();
  const booked = slots.filter(s => s.start !== null && s.fixed);
  const running = booked
    .map(s => ({ s, row: rowFor(s) }))
    .find(({ row }) => row.start! <= minute && Math.max(row.end!, row.likelyEnd ?? row.end!) > minute);
  if (running) now = { ...running.row, mode: "block" };
  const focusTask = workspace.focus?.taskId ? tasks.find(t => t.id === workspace.focus!.taskId && t.state !== "done") : undefined;
  if (!now && focusTask) {
    const slot = slots.find(s => s.task.id === focusTask.id);
    now = { ...rowFor(slot ?? { task: focusTask, start: null, minutes: slotMinutes(focusTask) }), mode: "focus" };
  }
  const chosen =
    workspace.nextThing?.date === day
      ? tasks.find(t => t.id === workspace.nextThing!.taskId && t.state !== "done" && t.state !== "someday" && !t.droppedAt)
      : undefined;
  if (!now && chosen) {
    const slot = slots.find(s => s.task.id === chosen.id);
    now = { ...rowFor(slot ?? { task: chosen, start: null, minutes: slotMinutes(chosen) }), mode: "next" };
  }
  // Nothing running or chosen: the next booking today is "Up next in X min".
  if (!now) {
    const upcoming = booked
      .filter(s => s.start! > minute)
      .sort((a, b) => a.start! - b.start!)[0];
    if (upcoming) now = { ...rowFor(upcoming), mode: "upnext", minutesUntil: upcoming.start! - minute };
  }
  if (now) used.add(now.task.id);

  // Slipped: a booked block past its likely finish, not done, not handled.
  const slipped: TodayPlan["slipped"] = [];
  for (const s of booked) {
    if (used.has(s.task.id)) continue;
    if (s.task.schedule.missedHandled === day) continue;
    const row = rowFor(s, true);
    const finish = Math.max(row.end!, row.likelyEnd ?? row.end!);
    if (finish > minute) continue;
    slipped.push({ ...row, again: keptGoingToday(s.task, day) > 0 });
    used.add(s.task.id);
  }
  slipped.sort((a, b) => a.start! - b.start!);

  // Next: the chosen Next thing, else the next booked item by time.
  let next: TodayPlan["next"] = null;
  if (chosen && !used.has(chosen.id)) {
    const slot = slots.find(s => s.task.id === chosen.id);
    next = { ...rowFor(slot ?? { task: chosen, start: null, minutes: slotMinutes(chosen) }), when: workspace.nextThing?.when || null };
  } else {
    const upcoming = slots
      .filter(s => !used.has(s.task.id) && s.start !== null && s.start > minute)
      .sort((a, b) => a.start! - b.start!)[0];
    if (upcoming) next = { ...rowFor(upcoming), when: null };
  }
  if (next) used.add(next.task.id);

  // Later: everything else dated or booked for today, by time; untimed last.
  const later = slots
    .filter(s => !used.has(s.task.id))
    .filter(s => s.start === null || s.start + s.minutes > minute || !s.fixed)
    .map(s => rowFor(s))
    .sort((a, b) => (a.start ?? 24 * 60) - (b.start ?? 24 * 60) || a.task.title.localeCompare(b.task.title));

  return { now, slipped, next, later };
}

function latestReview(workspace: Workspace): string | null {
  const dates = (workspace.reviews ?? []).map(r => r.date).filter(Boolean).sort();
  return dates.at(-1) ?? null;
}

/** Ids of every task Today shows, for "Needs attention" and Overview. */
export function todayTaskIds(plan: TodayPlan): Set<string> {
  return new Set([
    ...(plan.now ? [plan.now.task.id] : []),
    ...plan.slipped.map(r => r.task.id),
    ...(plan.next ? [plan.next.task.id] : []),
    ...plan.later.map(r => r.task.id),
  ]);
}

/** Past-due open work that isn't on Today. */
export function pastDueOffToday(tasks: Task[], day: string, onToday: Set<string>): Task[] {
  return pastDueTasks(tasks, day).filter(t => !onToday.has(t.id) && !t.droppedAt);
}

// ---------------------------------------------------------------------------
// The owner's slip choices

/**
 * Keep going: stretch today's block to its likely finish (at least 15 more
 * minutes from now). A repeating task's booking is left alone; the slip is
 * just marked handled for today. Either way a history line records it.
 */
export function keepGoing(task: Task, day: string, minute: number, likelyEnd: number | null, stamp: string): Task {
  const s = task.schedule;
  const line = (text: string) => ({ at: stamp, text });
  if (!s.time || s.date !== day || repeatRuleOf(task)) {
    return {
      ...task,
      updatedAt: stamp,
      schedule: { ...s, missedHandled: day },
      history: [...task.history, line("Slipped: kept going.")].slice(-1000),
    };
  }
  const start = timeToMinutes(s.time);
  const newEnd = Math.min(24 * 60 - 1, Math.max(likelyEnd ?? 0, minute + 15));
  const minutes = Math.max(slotMinutes(task), newEnd - start);
  return {
    ...task,
    updatedAt: stamp,
    schedule: { ...s, minutes },
    history: [...task.history, line(`Slipped: kept going — block now ends ${minutesToTime(start + minutes)}.`)].slice(-1000),
  };
}

/** Remove unfinished prerequisites from a task (the owner's tap). */
export function removePrerequisites(task: Task, ids: string[], titles: string[], stamp: string): Task {
  const drop = new Set(ids);
  return {
    ...task,
    dependencies: task.dependencies.filter(id => !drop.has(id)),
    updatedAt: stamp,
    history: [...task.history, { at: stamp, text: `Prerequisite removed: ${titles.join(", ")}.` }].slice(-1000),
  };
}

/**
 * For the Weekly Review: tasks that slipped again after "Keep going" and
 * weren't touched since (no done, no move, no later history).
 */
export function slippedAgainUntouched(tasks: Task[], since: string | null, day: string, minute: number): Task[] {
  return tasks.filter(task => {
    if (task.state === "done" || task.droppedAt) return false;
    const history = task.history ?? [];
    const lastKeep = [...history].reverse().find(e => KEPT_GOING.test(e.text));
    if (!lastKeep || (since && lastKeep.at.slice(0, 10) < since)) return false;
    if (history.at(-1) !== lastKeep) return false;
    const s = task.schedule;
    if (!s.time || !s.date) return false;
    const end = timeToMinutes(s.time) + slotMinutes(task);
    return s.date < day || (s.date === day && end <= minute);
  });
}
