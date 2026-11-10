/**
 * Subtasks (v2.6), Todoist-style: a subtask is a full task with its own
 * dates, time slot, reminders and repeat, linked to a parent task. Subtasks
 * can nest up to four levels below a top-level task.
 *
 * The link lives only on the child (`task.parent`), so adding or ticking a
 * subtask never rewrites the parent record, and old records stay unchanged.
 * Every traversal is cycle- and depth-guarded so damaged data cannot hang
 * the app.
 */
import { addDays, completeTask, createTask, daysUntil, today } from "./engine";
import { emptyTaskCompass } from "./compass";
import { copyTaskSchedule, rescheduleOccurrenceSchedule } from "./time";
import { adelaideTimestamp } from "../../../shared/time";
import type { Task, TaskParent } from "./types";

/** Levels allowed below a top-level task (Todoist allows four). */
export const MAX_SUBTASK_DEPTH = 4;
const GUARD = 64;

function quoted(text: string): string {
  const t = text.trim();
  return `“${t.length > 60 ? `${t.slice(0, 59)}…` : t}”`;
}
function stampFor(now?: string): string {
  return now === undefined
    ? adelaideTimestamp()
    : `${now.slice(0, 10)}T12:00:00`;
}
function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function")
    return globalThis.crypto.randomUUID();
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function byCreated(a: Task, b: Task): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export function parentOf(tasks: Task[], task: Task): Task | null {
  if (!task.parent) return null;
  return tasks.find(t => t.id === task.parent!.id) ?? null;
}
/** Direct subtasks, oldest first. */
export function childrenOf(tasks: Task[], id: string): Task[] {
  return tasks.filter(t => t.parent?.id === id && t.id !== id).sort(byCreated);
}
/** Parent, grandparent, … (nearest first). Stops at a missing link or a loop. */
export function ancestorsOf(tasks: Task[], task: Task): Task[] {
  const out: Task[] = [];
  const seen = new Set([task.id]);
  let current = parentOf(tasks, task);
  while (current && !seen.has(current.id) && out.length < GUARD) {
    out.push(current);
    seen.add(current.id);
    current = parentOf(tasks, current);
  }
  return out;
}
export function depthOf(tasks: Task[], task: Task): number {
  return ancestorsOf(tasks, task).length;
}
/** Every subtask below this task, at any depth. */
export function descendantsOf(tasks: Task[], id: string): Task[] {
  const out: Task[] = [];
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length && out.length < 5000) {
    const current = queue.shift()!;
    for (const child of childrenOf(tasks, current)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      queue.push(child.id);
    }
  }
  return out;
}
/** How many levels sit below this task (0 when it has no subtasks). */
export function subtreeHeight(tasks: Task[], id: string): number {
  return heightOf(tasks, id);
}
function heightOf(tasks: Task[], id: string, guard = 0): number {
  if (guard > GUARD) return GUARD;
  const kids = childrenOf(tasks, id);
  if (!kids.length) return 0;
  return 1 + Math.max(...kids.map(k => heightOf(tasks, k.id, guard + 1)));
}
/** Direct subtasks finished / total, e.g. 2/5. */
export function subtaskProgress(
  tasks: Task[],
  id: string
): { done: number; total: number } {
  const kids = childrenOf(tasks, id);
  return {
    done: kids.filter(k => k.state === "done").length,
    total: kids.length,
  };
}
/** Open subtasks at any depth. */
export function openSubtasks(tasks: Task[], id: string): Task[] {
  return descendantsOf(tasks, id).filter(t => t.state !== "done");
}

/** Why this task cannot sit under that one, or null when it can. */
export function parentProblem(
  tasks: Task[],
  childId: string,
  parentId: string
): string | null {
  const child = tasks.find(t => t.id === childId);
  const parent = tasks.find(t => t.id === parentId);
  if (!child) return "That task no longer exists.";
  if (!parent) return "The parent task no longer exists.";
  if (childId === parentId) return "A task cannot be its own subtask.";
  if (descendantsOf(tasks, childId).some(t => t.id === parentId))
    return "That would make a circle: the parent is already one of its subtasks.";
  if (parent.state === "done") return "That task is finished. Reopen it first.";
  if (depthOf(tasks, parent) + 1 + heightOf(tasks, childId) > MAX_SUBTASK_DEPTH)
    return `Subtasks can go ${MAX_SUBTASK_DEPTH} levels deep. Move it higher up instead.`;
  return null;
}

function withoutParent(task: Task): Task {
  const { parent: _parent, ...rest } = task;
  return rest;
}
function logged(task: Task, stamp: string, text: string): Task {
  return {
    ...task,
    updatedAt: stamp,
    history: [...task.history.map(e => ({ ...e })), { at: stamp, text }],
  };
}

export interface ParentChange {
  tasks: Task[];
  error: string | null;
}
/**
 * Put a task under a parent (or back to top level with `parentId: null`).
 * A task with no project joins its parent's project, so it shows in the
 * project and counts as placed. Connector-made links pass `suggested: true`
 * and stay suggested until the owner confirms.
 */
export function setTaskParent(
  tasks: Task[],
  childId: string,
  parentId: string | null,
  options: {
    suggested?: boolean;
    prefix?: string;
    now?: string;
    stamp?: string;
  } = {}
): ParentChange {
  const child = tasks.find(t => t.id === childId);
  if (!child) return { tasks, error: "That task no longer exists." };
  const stamp = options.stamp ?? stampFor(options.now);
  const prefix = options.prefix ?? "";
  if (parentId === null) {
    if (!child.parent) return { tasks, error: null };
    const old = parentOf(tasks, child);
    const updated = logged(
      withoutParent(child),
      stamp,
      `${prefix}Moved to the top level${old ? ` (was under ${quoted(old.title)})` : ""}.`
    );
    return {
      tasks: tasks.map(t => (t.id === childId ? updated : t)),
      error: null,
    };
  }
  const problem = parentProblem(tasks, childId, parentId);
  if (problem) return { tasks, error: problem };
  const parent = tasks.find(t => t.id === parentId)!;
  const suggested = Boolean(options.suggested);
  // Never silently confirm a suggestion or downgrade a confirmed link.
  if (child.parent?.id === parentId) {
    if (child.parent.suggested === suggested || !child.parent.suggested)
      return { tasks, error: null };
  }
  let updated: Task = { ...child, parent: { id: parentId, suggested } };
  if (!child.projectId && parent.projectId) {
    updated = {
      ...updated,
      projectId: parent.projectId,
      compass: {
        ...updated.compass,
        projectSuggested: suggested || parent.compass.projectSuggested,
      },
    };
  }
  updated = logged(
    updated,
    stamp,
    `${prefix}${suggested ? "Suggested it as a subtask of" : "Made it a subtask of"} ${quoted(parent.title)}.`
  );
  return {
    tasks: tasks.map(t => (t.id === childId ? updated : t)),
    error: null,
  };
}

export function confirmTaskParent(
  tasks: Task[],
  id: string,
  now?: string
): Task[] {
  const task = tasks.find(t => t.id === id);
  if (!task?.parent?.suggested) return tasks;
  const parent = parentOf(tasks, task);
  const updated = logged(
    { ...task, parent: { id: task.parent.id, suggested: false } },
    stampFor(now),
    `Confirmed suggested parent ${quoted(parent?.title ?? "task")}.`
  );
  return tasks.map(t => (t.id === id ? updated : t));
}
export function rejectTaskParent(
  tasks: Task[],
  id: string,
  now?: string
): Task[] {
  const task = tasks.find(t => t.id === id);
  if (!task?.parent?.suggested) return tasks;
  const parent = parentOf(tasks, task);
  const updated = logged(
    withoutParent(task),
    stampFor(now),
    `Rejected suggested parent ${quoted(parent?.title ?? "task")}.`
  );
  return tasks.map(t => (t.id === id ? updated : t));
}

/** Create a new subtask under a parent. Title only, like capture. */
export function addSubtask(
  tasks: Task[],
  parentId: string,
  title: string,
  options: {
    suggested?: boolean;
    prefix?: string;
    now?: string;
    /** Exact timestamp to record (overrides `now`). */
    stamp?: string;
    fields?: Partial<Task>;
  } = {}
): { tasks: Task[]; task: Task | null; error: string | null } {
  const parent = tasks.find(t => t.id === parentId);
  const clean = title.trim();
  if (!parent)
    return { tasks, task: null, error: "The parent task no longer exists." };
  if (!clean) return { tasks, task: null, error: "Give the subtask a name." };
  if (parent.state === "done")
    return {
      tasks,
      task: null,
      error: "That task is finished. Reopen it first.",
    };
  if (depthOf(tasks, parent) + 1 > MAX_SUBTASK_DEPTH)
    return {
      tasks,
      task: null,
      error: `Subtasks can go ${MAX_SUBTASK_DEPTH} levels deep.`,
    };
  const stamp = options.stamp ?? stampFor(options.now);
  const suggested = Boolean(options.suggested);
  const fields = options.fields ?? {};
  const projectId = fields.projectId ?? parent.projectId;
  const task = createTask({
    area: parent.area,
    context: parent.context,
    ...fields,
    title: clean,
    projectId,
    compass: {
      ...emptyTaskCompass(),
      ...(fields.compass ?? {}),
      projectSuggested:
        projectId !== null &&
        (suggested ||
          (projectId === parent.projectId && parent.compass.projectSuggested)),
    },
    createdAt: stamp,
    updatedAt: stamp,
    history: [
      {
        at: stamp,
        text: `${options.prefix ?? ""}${suggested ? "Suggested as a subtask of" : "Added as a subtask of"} ${quoted(parent.title)}.`,
      },
    ],
  });
  const withLink: Task = { ...task, parent: { id: parentId, suggested } };
  return { tasks: [...tasks, withLink], task: withLink, error: null };
}

function seriesAnchor(task: Task): string | null {
  return (
    task.schedule.repeatOccurrenceDate ??
    task.schedule.date ??
    task.deadline ??
    task.startDate ??
    null
  );
}
function freshCopy(
  child: Task,
  parent: TaskParent,
  shift: number,
  quietUntil: string | null,
  stamp: string,
  label: string
): Task {
  const move = (value: string | null) => (value ? addDays(value, shift) : null);
  const start = move(child.startDate);
  const nextOccurrenceDate = move(
    child.schedule.repeatOccurrenceDate ??
      child.schedule.date ??
      child.deadline ??
      child.startDate
  );
  const schedule = rescheduleOccurrenceSchedule(
    child.schedule,
    {
      date: move(child.schedule.date),
      time: child.schedule.time,
    },
    child.schedule.repeatAnchorDate ??
      child.schedule.repeatOccurrenceDate ??
      child.schedule.date ??
      child.deadline ??
      child.startDate
  );
  if (schedule.repeat) schedule.repeatOccurrenceDate = nextOccurrenceDate;
  return {
    ...child,
    id: newId(),
    state: child.nextAction.trim() ? "ready" : "inbox",
    completedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    checklist: child.checklist.map(item => ({ ...item, done: false })),
    dependencies: [],
    progressEvidence: "",
    deadline: move(child.deadline),
    // Stays quiet until the parent's next occurrence begins.
    startDate:
      start && quietUntil
        ? start > quietUntil
          ? start
          : quietUntil
        : (start ?? quietUntil),
    reviewDate: quietUntil ?? child.reviewDate,
    deferredUntil: null,
    preparationDate: move(child.preparationDate),
    history: [{ at: stamp, text: `Fresh subtask for the next ${label}.` }],
    compass: {
      ...child.compass,
      imperativeIds: [...child.compass.imperativeIds],
      decision: null,
    },
    schedule: {
      ...copyTaskSchedule(schedule),
      completions: [],
      timeLog: [],
      missedHandled: null,
    },
    parent: { ...parent },
  };
}

/**
 * Finish a task, optionally finishing its open subtasks with it.
 *
 * For a repeating task, its next occurrence gets the subtasks too: finished
 * ones come back fresh (dates moved by the same amount as the parent's) and
 * any left open move across to the new occurrence. Nothing is deleted.
 */
export function completeTaskTree(
  tasks: Task[],
  id: string,
  finishSubtasks: boolean,
  now?: string
): Task[] {
  const source = tasks.find(t => t.id === id);
  if (!source || source.state === "done") return tasks;
  const stamp = stampFor(now);
  let next = tasks;
  if (finishSubtasks) {
    const open = new Set(openSubtasks(tasks, id).map(t => t.id));
    if (open.size) {
      next = next.map(t =>
        open.has(t.id)
          ? logged(
              { ...t, state: "done", completedAt: stamp },
              stamp,
              `Completed with its parent ${quoted(source.title)}.`
            )
          : t
      );
    }
  }
  const before = next.length;
  next = completeTask(next, id, now);
  if (next.length === before) return next;
  const occurrence = next[next.length - 1];
  const fromDay = seriesAnchor(source) ?? (now ? now.slice(0, 10) : today());
  const toDay = seriesAnchor(occurrence) ?? occurrence.startDate ?? fromDay;
  const shift = daysUntil(toDay, fromDay);
  const label = `${quoted(occurrence.title)} (${occurrence.startDate ?? toDay})`;
  const additions: Task[] = [];
  const moves = new Map<string, TaskParent>();
  const carry = (oldParentId: string, newParent: TaskParent, guard: number) => {
    if (guard > MAX_SUBTASK_DEPTH + 1) return;
    for (const child of childrenOf(next, oldParentId)) {
      const link: TaskParent = {
        id: newParent.id,
        suggested: child.parent?.suggested ?? false,
      };
      if (child.state !== "done") {
        moves.set(child.id, link);
        continue;
      }
      const copy = freshCopy(
        child,
        link,
        shift,
        occurrence.startDate,
        stamp,
        label
      );
      additions.push(copy);
      carry(child.id, { id: copy.id, suggested: false }, guard + 1);
    }
  };
  carry(id, { id: occurrence.id, suggested: false }, 0);
  if (!additions.length && !moves.size) return next;
  return [
    ...next.map(t =>
      moves.has(t.id)
        ? logged(
            { ...t, parent: moves.get(t.id)! },
            stamp,
            `Moved to the next ${label}.`
          )
        : t
    ),
    ...additions,
  ];
}

/**
 * When a task is removed, its subtasks move up one level (to its own
 * parent, or to the top level). Nothing else is removed with it.
 */
export function releaseSubtasks(
  tasks: Task[],
  removed: Task,
  options: { now?: string; stamp?: string } = {}
): Task[] {
  const stamp = options.stamp ?? stampFor(options.now);
  return tasks.map(t => {
    if (t.parent?.id !== removed.id) return t;
    const up = removed.parent ? { ...removed.parent } : undefined;
    const base = up ? { ...t, parent: up } : withoutParent(t);
    return logged(
      base,
      stamp,
      `Its parent ${quoted(removed.title)} was removed; moved up a level.`
    );
  });
}

/** Remove one task while keeping its children and removing prerequisite links. */
export function removeTaskAndReleaseChildren(
  tasks: Task[],
  taskId: string,
  stamp: string
): { tasks: Task[]; removed: Task | null } {
  const removed = tasks.find(task => task.id === taskId) ?? null;
  if (!removed) return { tasks, removed: null };

  const prerequisiteNote = `Task “${removed.title}” was removed; prerequisite link cleared.`;
  const remaining = tasks
    .filter(task => task.id !== taskId)
    .map(task =>
      task.dependencies.includes(taskId)
        ? {
            ...task,
            dependencies: task.dependencies.filter(id => id !== taskId),
            updatedAt: stamp,
            history: [...task.history, { at: stamp, text: prerequisiteNote }],
          }
        : task
    );

  return { tasks: releaseSubtasks(remaining, removed, { stamp }), removed };
}

export interface SubtaskRow {
  task: Task;
  /** Indent level within this list (0 = shown at the left). */
  depth: number;
  progress: { done: number; total: number };
  /** Set when the task is a subtask but its parent is not shown above it. */
  parentTitle: string | null;
  collapsed: boolean;
}
/**
 * Order a (possibly filtered) list so subtasks sit under their parents.
 * A subtask whose parent is not in the list stays at the left and names its
 * parent instead. Collapsed parents hide everything below them.
 */
export function nestRows(
  list: Task[],
  all: Task[],
  collapsed: Set<string>
): SubtaskRow[] {
  const inList = new Set(list.map(t => t.id));
  const rows: SubtaskRow[] = [];
  const seen = new Set<string>();
  const visit = (task: Task, depth: number, root: boolean) => {
    if (seen.has(task.id)) return;
    seen.add(task.id);
    const parent = parentOf(all, task);
    rows.push({
      task,
      depth,
      progress: subtaskProgress(all, task.id),
      parentTitle: root && parent ? parent.title : null,
      collapsed: collapsed.has(task.id),
    });
    if (collapsed.has(task.id) || depth > MAX_SUBTASK_DEPTH + 1) return;
    for (const child of childrenOf(all, task.id))
      if (inList.has(child.id)) visit(child, depth + 1, false);
  };
  for (const task of list) {
    const parentShown =
      task.parent &&
      inList.has(task.parent.id) &&
      !ancestorsOf(all, task).some(a => a.id === task.id);
    if (!parentShown) visit(task, 0, true);
  }
  // Anything left (e.g. under a collapsed parent) stays hidden on purpose;
  // a damaged loop is shown flat so nothing disappears.
  for (const task of list)
    if (!seen.has(task.id) && !hiddenByCollapse(task, all, collapsed, inList))
      visit(task, 0, true);
  return rows;
}
function hiddenByCollapse(
  task: Task,
  all: Task[],
  collapsed: Set<string>,
  inList: Set<string>
): boolean {
  return ancestorsOf(all, task).some(
    a => collapsed.has(a.id) && inList.has(a.id)
  );
}

/** Short spoken context, e.g. "Subtask of Move house. 2 of 5 subtasks done." */
export function spokenSubtaskContext(tasks: Task[], task: Task): string {
  const parts: string[] = [];
  const parent = parentOf(tasks, task);
  if (parent)
    parts.push(
      `${task.parent?.suggested ? "Suggested subtask of" : "Subtask of"} ${parent.title}.`
    );
  const p = subtaskProgress(tasks, task.id);
  if (p.total) parts.push(`${p.done} of ${p.total} subtasks done.`);
  return parts.join(" ");
}
