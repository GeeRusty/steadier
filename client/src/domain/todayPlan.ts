/**
 * Today = do. Now (only what's running), your Next thing, Any time today,
 * then the agenda in time order with Free gaps. Ordered by time only.
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
import { leaveByMinute } from "./places";
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
  /** "Leave by" minute: start minus the place's travel allowance, only while still ahead. */
  leaveBy: number | null;
}

/** A Now card: a booked block in progress, or the running focus timer. */
export type NowRow = TodayRow & { mode: "block" | "focus"; focusRunning?: boolean };

/** One line of the agenda, in time order. */
export type AgendaEntry =
  | {
      kind: "item";
      row: TodayRow;
      /** A fixed booking (has a time range and length), not a deadline marker. */
      fixed: boolean;
      minutes: number;
      done: boolean;
      /** Over, or ticked off: drawn faded. A slip is never faded. */
      past: boolean;
      slipped: boolean;
      /** Slipped again after Keep going today. */
      again: boolean;
      /** Where the red now line crosses a running block, 0–1. */
      nowAt: number | null;
    }
  | { kind: "free"; start: number; end: number }
  | { kind: "now"; minute: number }
  | { kind: "soon"; row: TodayRow; minutesUntil: number };

export interface WeekDay {
  date: string;
  /** "Mon" … "Sun" */
  weekday: string;
  dayOfMonth: number;
  /** Fixed booked minutes only: never undated, flexible or deadline items. */
  bookedMinutes: number;
  today: boolean;
}

export interface TodayPlan {
  /** Only what's running now. Empty when nothing is; a booking and a different focus both show. */
  now: NowRow[];
  /** The owner's chosen Next thing, never the next booking. */
  next: (TodayRow & { when: string | null; runningNow: boolean }) | null;
  /** Dated for today with no clock time. */
  anyTime: TodayRow[];
  agenda: AgendaEntry[];
  /** The agenda's slipped blocks, for convenience. */
  slipped: (TodayRow & { again: boolean })[];
  week: WeekDay[];
}

/**
 * What "+ Add" on a Free row puts in the capture box: "today at 4:40pm ",
 * rounded up to the next 5 minutes, for the owner to type the task after.
 */
export function captureAtText(minute: number): string {
  const m = Math.min(23 * 60 + 55, Math.ceil(minute / 5) * 5);
  const h = Math.floor(m / 60);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `today at ${hour}:${String(m % 60).padStart(2, "0")}${h < 12 ? "am" : "pm"} `;
}

/** Gaps longer than this show as one "Free" row. */
export const FREE_GAP_MINUTES = 60;

const KEPT_GOING = /^Slipped: kept going\b/;

export function clockText(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, "0")}` : `${hour}:00`;
}

export function delta(minutes: number): string {
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

/** Lateness (or earliness) shows only at this many minutes or more, on Today and the Calendar Board. */
export const LATE_THRESHOLD_MINUTES = 10;

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
  if (extra.lateBy && extra.lateBy >= LATE_THRESHOLD_MINUTES) chips.push({ kind: "late", text: `⏱ +${delta(extra.lateBy)}`, red: false });
  if (extra.earlyBy && extra.earlyBy >= LATE_THRESHOLD_MINUTES) chips.push({ kind: "early", text: `⏱ −${delta(extra.earlyBy)}`, red: false });
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
  done: boolean;
  item: CalendarItem;
}

/** Today's dated and booked work, one entry per task. Done ones only with `withDone` (the agenda). */
function slotsForToday(workspace: Workspace, tasks: Task[], day: string, withDone = false): Slot[] {
  const calendar = buildCalendar(tasks, workspace.projects, [day], day)[0];
  const byId = new Map(tasks.map(t => [t.id, t]));
  const seen = new Map<string, Slot>();
  const consider = (item: CalendarItem, timed: boolean) => {
    if (!item.taskId || item.date !== day) return;
    if (item.kind === "window") return;
    const task = byId.get(item.taskId);
    if (!task || task.state === "someday" || task.droppedAt) return;
    const done = !!item.done || task.state === "done";
    if (done && (!withDone || !timed)) return;
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
      done,
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
      leaveBy: start !== null && start > minute && !slippedNow ? leaveByMinute(workspace, task, start) : null,
    };
  };

  // Now: only what's running. A booked block in progress (to its likely
  // finish), and the focus timer. When they point at different tasks, both
  // show, each labelled; neither is picked for you.
  const booked = slots.filter(s => s.start !== null && s.fixed);
  const finishOf = (row: TodayRow) => Math.max(row.end!, row.likelyEnd ?? row.end!);
  const now: NowRow[] = booked
    .map(s => rowFor(s))
    .filter(row => row.start! <= minute && finishOf(row) > minute)
    .sort((a, b) => a.start! - b.start!)
    .map(row => ({ ...row, mode: "block" as const }));
  const focusTask = workspace.focus?.taskId ? tasks.find(t => t.id === workspace.focus!.taskId && t.state !== "done") : undefined;
  if (focusTask && !now.some(r => r.task.id === focusTask.id)) {
    const slot = slots.find(s => s.task.id === focusTask.id);
    now.push({
      ...rowFor(slot ?? { task: focusTask, start: null, minutes: slotMinutes(focusTask) }),
      mode: "focus",
      focusRunning: !!workspace.focus?.running,
    });
  } else if (focusTask) {
    const same = now.find(r => r.task.id === focusTask.id)!;
    same.focusRunning = !!workspace.focus?.running;
  }
  const nowIds = new Set(now.map(r => r.task.id));

  // Next thing: only the owner's choice. The next booking never fills it.
  const chosen =
    workspace.nextThing?.date === day
      ? tasks.find(t => t.id === workspace.nextThing!.taskId && t.state !== "done" && t.state !== "someday" && !t.droppedAt)
      : undefined;
  let next: TodayPlan["next"] = null;
  if (chosen) {
    const slot = slots.find(s => s.task.id === chosen.id);
    next = {
      ...rowFor(slot ?? { task: chosen, start: null, minutes: slotMinutes(chosen) }),
      when: workspace.nextThing?.when || null,
      runningNow: nowIds.has(chosen.id),
    };
  }

  // Any time today: dated for today, no clock time.
  const anyTime = slots
    .filter(s => s.start === null)
    .map(s => rowFor(s))
    .sort((a, b) => a.task.title.localeCompare(b.task.title));

  // The agenda: every timed item today, done ones included (faded).
  const timed = slotsForToday(workspace, tasks, day, true).filter(s => s.start !== null);
  const items: Extract<AgendaEntry, { kind: "item" }>[] = timed.map(slot => {
    const base = rowFor(slot);
    const finish = slot.fixed ? finishOf(base) : slot.start!;
    const slipped =
      !slot.done && slot.fixed && finish <= minute && slot.task.schedule.missedHandled !== day;
    const row = slipped ? rowFor(slot, true) : slot.done ? { ...base, chips: [], leaveBy: null } : base;
    const running = !slot.done && slot.fixed && slot.start! <= minute && finish > minute;
    return {
      kind: "item",
      row,
      fixed: slot.fixed,
      minutes: slot.minutes,
      done: slot.done,
      past: !slipped && (slot.done || (slot.fixed ? finish <= minute : slot.start! < minute)),
      slipped,
      again: slipped && keptGoingToday(slot.task, day) > 0,
      nowAt: running ? Math.min(1, Math.max(0, (minute - slot.start!) / Math.max(1, finish - slot.start!))) : null,
    };
  });
  items.sort((a, b) => a.row.start! - b.row.start! || a.row.task.title.localeCompare(b.row.task.title));

  // Free gaps over an hour between bookings, counted from now when now is inside one.
  const fixedItems = items.filter(i => i.fixed);
  const freeBefore = new Map<string, { start: number; end: number }>();
  let cursor: number | null = null;
  for (const item of fixedItems) {
    const start = item.row.start!;
    const from = cursor === null ? minute : Math.max(cursor, minute);
    if (start > minute && start - from > FREE_GAP_MINUTES) freeBefore.set(item.row.task.id, { start: from, end: start });
    const end = item.done ? item.row.end! : finishOf(item.row);
    cursor = cursor === null ? end : Math.max(cursor, end);
  }
  const soon = fixedItems.find(i => !i.done && i.row.start! > minute);

  const agenda: AgendaEntry[] = [];
  const lineInBlock = items.some(i => i.nowAt !== null);
  let linePlaced = lineInBlock;
  for (const item of items) {
    if (!linePlaced && item.row.start! > minute) {
      agenda.push({ kind: "now", minute });
      linePlaced = true;
    }
    const free = freeBefore.get(item.row.task.id);
    if (free) agenda.push({ kind: "free", ...free });
    if (soon && item === soon) agenda.push({ kind: "soon", row: item.row, minutesUntil: item.row.start! - minute });
    agenda.push(item);
  }
  if (!linePlaced && items.length) agenda.push({ kind: "now", minute });

  const slipped = items.filter(i => i.slipped).map(i => ({ ...i.row, again: i.again }));

  return { now, next, anyTime, agenda, slipped, week: weekStrip(workspace, tasks, day) };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday to Sunday around `day`, with each day's fixed booked minutes. */
export function weekStrip(workspace: Workspace, tasks: Task[], day: string): WeekDay[] {
  const [y, m, d] = day.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const offset = (base.getUTCDay() + 6) % 7; // Monday = 0
  const dates = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(base.getTime() + (i - offset) * 86_400_000);
    return dt.toISOString().slice(0, 10);
  });
  const calendar = buildCalendar(tasks, workspace.projects, dates, day);
  return dates.map((date, i) => {
    const dayCal = calendar.find(c => c.date === date);
    const bookedMinutes = (dayCal?.timed ?? [])
      .filter(item => item.taskId && item.fixed && item.kind !== "deadline" && item.kind !== "window" && item.date === date)
      .reduce((sum, item) => sum + (item.minutes ?? 0), 0);
    return { date, weekday: WEEKDAYS[i], dayOfMonth: Number(date.slice(8, 10)), bookedMinutes, today: date === day };
  });
}

function latestReview(workspace: Workspace): string | null {
  const dates = (workspace.reviews ?? []).map(r => r.date).filter(Boolean).sort();
  return dates.at(-1) ?? null;
}

/** Ids of every task Today shows, for "Needs attention" and Overview. */
export function todayTaskIds(plan: TodayPlan): Set<string> {
  return new Set([
    ...plan.now.map(r => r.task.id),
    ...(plan.next ? [plan.next.task.id] : []),
    ...plan.anyTime.map(r => r.task.id),
    ...plan.agenda.flatMap(e => (e.kind === "item" && !e.done ? [e.row.task.id] : [])),
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
