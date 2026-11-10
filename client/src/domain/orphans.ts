/**
 * Orphan protection: every open task needs a confirmed home (a project, an
 * Imperative, Life Admin or Erosion Guard). Nothing here blocks a task or
 * files one automatically; it only works out how loudly to flag it.
 *
 * Stages are computed from the task's capture time and the current clock
 * every time they are read, never stored. Opening the app after days away
 * therefore shows every task's true stage at once.
 */
import { adelaideDate, adelaideTimestamp } from "../../../shared/time";
import { isUnplaced, pendingPlacement } from "./compass";
import type { Task } from "./types";

export type OrphanStage = 1 | 2 | 3;
export const STAGE_HOURS = { quiet: 8, flag: 24, overdue: 72 } as const;
/** An unplaced task due within this many hours is overdue for placement at once. */
export const URGENT_DUE_HOURS = 48;
export const LIFE_ADMIN_WATCH_DAYS = 14;
export const RECURRING_WINDOW_DAYS = 60;
export const RECURRING_MIN = 3;

export const STAGE_LABEL: Record<OrphanStage | 0, string> = {
  0: "New",
  1: "Unplaced",
  2: "Needs a home",
  3: "Overdue for placement",
};

export interface OrphanInfo {
  task: Task;
  /** 0 = captured under 8 hours ago and not urgent: counted, but no marker yet. */
  stage: OrphanStage | 0;
  ageHours: number;
  /** Why it skipped ahead, e.g. "has a deadline". */
  urgent: string | null;
  /** A home waiting for the owner's Confirm ("project", "imperative", "catch-all"). */
  pending: string | null;
}

function hoursBetween(fromStamp: string, now: Date): number {
  const from = Date.parse(fromStamp);
  if (Number.isNaN(from)) return 0;
  return Math.max(0, (now.getTime() - from) / 3_600_000);
}

/** Hours until the task's deadline (end of day unless a deadline time is set), Adelaide wall clock. */
function hoursUntilDue(task: Task, now: Date): number | null {
  if (!task.deadline) return null;
  const time = task.schedule.deadlineTime ?? "23:59";
  // Both sides are naive Adelaide wall-clock strings, parsed the same way.
  const due = Date.parse(`${task.deadline}T${time}:00`);
  const current = Date.parse(`${adelaideTimestamp(now).slice(0, 16)}:00`);
  if (Number.isNaN(due) || Number.isNaN(current)) return null;
  return (due - current) / 3_600_000;
}

function urgentReason(task: Task): string | null {
  if (task.deadline) return "has a deadline";
  if (task.schedule.time || task.schedule.fixed) return "has a fixed time";
  if (task.schedule.reminders.length > 0) return "has a reminder";
  return null;
}

export function orphanInfo(task: Task, now: Date = new Date()): OrphanInfo {
  const ageHours = hoursBetween(task.createdAt, now);
  const urgent = urgentReason(task);
  let stage: OrphanStage | 0 =
    ageHours >= STAGE_HOURS.overdue
      ? 3
      : ageHours >= STAGE_HOURS.flag
        ? 2
        : ageHours >= STAGE_HOURS.quiet
          ? 1
          : 0;
  if (urgent && stage < 2) stage = 2;
  const due = hoursUntilDue(task, now);
  if (due !== null && due <= URGENT_DUE_HOURS) stage = 3;
  return {
    task,
    stage,
    ageHours: Math.round(ageHours * 10) / 10,
    urgent:
      due !== null && due <= URGENT_DUE_HOURS
        ? due < 0
          ? "deadline has passed"
          : "due within 2 days"
        : urgent,
    pending: pendingPlacement(task),
  };
}

/** Every unplaced open task, most overdue first, then oldest first. */
export function orphanReport(tasks: Task[], now: Date = new Date()) {
  const items = tasks
    .filter(t => isUnplaced(t, tasks))
    .map(task => orphanInfo(task, now))
    .sort((a, b) => b.stage - a.stage || b.ageHours - a.ageHours);
  return {
    items,
    count: items.length,
    overdue: items.filter(i => i.stage === 3).length,
    flagged: items.filter(i => i.stage >= 2).length,
  };
}

export function formatAge(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** Plain sentence used by the banner and read-aloud. */
export function orphanSentence(
  report: ReturnType<typeof orphanReport>
): string {
  if (!report.count) return "Every open task has a home.";
  const parts = [
    `${report.count} task${report.count === 1 ? " needs" : "s need"} a home`,
  ];
  if (report.overdue) parts.push(`${report.overdue} overdue for placement`);
  return `${parts.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// Stage 2 banner: shown on the first open after a task reaches Stage 2,
// at most once a day, per device. Never a pop-up.
// ---------------------------------------------------------------------------
const BANNER_KEY = "steadier.orphanBanner.v1";

interface BannerMemory {
  /** Adelaide day the banner was last dismissed or shown-and-acknowledged. */
  day: string | null;
  /** Task ids already announced at Stage 2 or above. */
  seen: string[];
}

function readMemory(): BannerMemory {
  try {
    const raw = globalThis.localStorage?.getItem(BANNER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.seen))
      return { day: parsed.day ?? null, seen: parsed.seen.slice(-500) };
  } catch {
    /* storage blocked: show the banner, it is harmless */
  }
  return { day: null, seen: [] };
}

/** Tasks newly at Stage 2+ that have not been announced; empty once dismissed today. */
export function bannerTasks(
  report: ReturnType<typeof orphanReport>,
  now: Date = new Date()
): OrphanInfo[] {
  const memory = readMemory();
  if (memory.day === adelaideDate(now)) return [];
  const seen = new Set(memory.seen);
  return report.items.filter(i => i.stage >= 2 && !seen.has(i.task.id));
}

export function dismissBanner(
  report: ReturnType<typeof orphanReport>,
  now: Date = new Date()
): void {
  const memory = readMemory();
  const ids = new Set(memory.seen);
  for (const i of report.items) if (i.stage >= 2) ids.add(i.task.id);
  try {
    globalThis.localStorage?.setItem(
      BANNER_KEY,
      JSON.stringify({ day: adelaideDate(now), seen: [...ids].slice(-500) })
    );
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Life Admin watch and recurring-job check (weekly review)
// ---------------------------------------------------------------------------
export interface CatchAllWatch {
  lifeAdminOpen: number;
  erosionGuardOpen: number;
  /** Open Life Admin tasks filed more than 14 days ago. */
  stale: { task: Task; days: number }[];
}

export function catchAllWatch(
  tasks: Task[],
  now: Date = new Date()
): CatchAllWatch {
  const open = tasks.filter(t => t.state !== "done");
  const lifeAdmin = open.filter(t => t.compass.catchAll === "life-admin");
  const stale = lifeAdmin
    .map(task => {
      // Filed time if known; older records fall back to their last change,
      // so filing an old task never flags it the same day.
      const since = task.compass.catchAllSince ?? task.updatedAt;
      return { task, days: Math.floor(hoursBetween(since, now) / 24) };
    })
    .filter(x => x.days > LIFE_ADMIN_WATCH_DAYS)
    .sort((a, b) => b.days - a.days);
  return {
    lifeAdminOpen: lifeAdmin.length,
    erosionGuardOpen: open.filter(t => t.compass.catchAll === "erosion-guard")
      .length,
    stale,
  };
}

const STOP = new Set(
  "a an the and or to of for in on at by with from my me i up out off get do make check this that it is be into new again".split(
    " "
  )
);

function keyWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .map(w => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w))
      .filter(w => w.length > 2 && !STOP.has(w))
  );
}

function similar(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  let shared = 0;
  a.forEach(w => {
    if (b.has(w)) shared += 1;
  });
  return shared / Math.min(a.size, b.size) >= 0.5 && shared >= 1;
}

export interface RecurringGroup {
  label: string;
  tasks: Task[];
}

/**
 * The same kind of job landing in Life Admin again and again (3+ similar
 * titles within 60 days). A suggestion to make it a project or an Erosion
 * Guard item; never applied automatically.
 */
export function recurringLifeAdmin(
  tasks: Task[],
  now: Date = new Date()
): RecurringGroup[] {
  const recent = tasks.filter(
    t =>
      t.compass.catchAll === "life-admin" &&
      hoursBetween(t.createdAt, now) <= RECURRING_WINDOW_DAYS * 24
  );
  const words = recent.map(t => keyWords(t.title));
  const used = new Set<number>();
  const groups: RecurringGroup[] = [];
  for (let i = 0; i < recent.length; i += 1) {
    if (used.has(i)) continue;
    const members = [i];
    for (let j = i + 1; j < recent.length; j += 1)
      if (!used.has(j) && similar(words[i], words[j])) members.push(j);
    if (members.length >= RECURRING_MIN) {
      members.forEach(m => used.add(m));
      const common = [...words[i]].filter(w =>
        members.every(m => words[m].has(w))
      );
      groups.push({
        label: common.length ? common.slice(0, 3).join(" ") : recent[i].title,
        tasks: members.map(m => recent[m]),
      });
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Owner edits: an owner's own placement is never "suggested"
// ---------------------------------------------------------------------------
/**
 * Applied to every owner change before saving. When the owner sets or changes
 * a task's project or Imperatives, the link becomes theirs (not suggested);
 * when a catch-all is newly set, its filed time is recorded.
 */
export function stampOwnerPlacement(
  previous: Task[],
  next: Task[],
  stamp: string
): Task[] {
  const before = new Map(previous.map(t => [t.id, t]));
  let changed = false;
  const result = next.map(task => {
    const old = before.get(task.id);
    const c = task.compass;
    let projectSuggested = c.projectSuggested;
    let imperativesSuggested = c.imperativesSuggested;
    let catchAllSince = c.catchAllSince;
    if (old) {
      if (old.projectId !== task.projectId) projectSuggested = false;
      if (old.compass.imperativeIds.join(",") !== c.imperativeIds.join(","))
        imperativesSuggested = false;
      if (old.compass.catchAll !== c.catchAll)
        catchAllSince = c.catchAll ? stamp : null;
    } else if (c.catchAll && !catchAllSince) {
      catchAllSince = stamp;
    }
    if (c.catchAll === null) catchAllSince = null;
    if (
      projectSuggested === c.projectSuggested &&
      imperativesSuggested === c.imperativesSuggested &&
      catchAllSince === c.catchAllSince
    )
      return task;
    changed = true;
    return {
      ...task,
      compass: { ...c, projectSuggested, imperativesSuggested, catchAllSince },
    };
  });
  return changed ? result : next;
}
