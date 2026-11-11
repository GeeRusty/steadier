/**
 * The task card: three dots (Action, Place, First step) decide whether a task
 * is set up ("ready", solid card) or not yet ("inbox", faded card). When is
 * shown on the card but has no dot: a task can be ready without a date.
 *
 * Tasks made before the card existed have no `actionConfirmed` field. They
 * keep the old rule (ready once they have a next action), so existing ready
 * tasks are not faded overnight. A task becomes a "card task" the first time
 * the owner uses the card on it, or when it is captured through the card.
 *
 * Ideas reuse the existing "someday" state. "Let go" reuses the existing
 * Dropped decision, so an idea is never deleted and can be brought back.
 *
 * Nothing here blocks saving.
 */
import { CATCH_ALL_LABEL, isUnplaced, type CatchAll } from "./compass";
import type { Project, Task, Workspace } from "./types";

export interface CardDots {
  action: boolean;
  place: boolean;
  step: boolean;
}

export type CardDot = keyof CardDots;

export const DOT_LABEL: Record<CardDot, string> = {
  action: "Action",
  place: "Place",
  step: "First step",
};

/** True once the card owns this task's readiness. */
export function isCardTask(task: Task): boolean {
  return typeof task.actionConfirmed === "boolean";
}

/** Placed in a project, Imperative, Life Admin or Erosion Guard (confirmed). */
export function isPlaced(task: Task, all?: Task[]): boolean {
  return !isUnplaced({ ...task, state: "ready" }, all);
}

export function cardDots(task: Task, all?: Task[]): CardDots {
  return {
    action: task.actionConfirmed !== false,
    place: isPlaced(task, all),
    step: task.nextAction.trim().length > 0,
  };
}

export function missingDots(task: Task, all?: Task[]): CardDot[] {
  const dots = cardDots(task, all);
  return (Object.keys(dots) as CardDot[]).filter(key => !dots[key]);
}

export function isIdea(task: Task): boolean {
  return task.state === "someday" && !task.droppedAt;
}

/** An open task in the work pool: not done, not an idea, not dropped. */
export function isOpenTask(task: Task): boolean {
  return task.state !== "done" && task.state !== "someday" && !task.droppedAt;
}

/**
 * Set up means a solid card. Card tasks need all three dots; older tasks keep
 * the old rule (anything except "inbox" counts as set up).
 */
export function isSetUp(task: Task, all?: Task[]): boolean {
  if (!isCardTask(task)) return task.state !== "inbox";
  const dots = cardDots(task, all);
  return dots.action && dots.place && dots.step;
}

/** A faded card: open and not set up yet. These make up "Not ready" and Sort. */
export function isFaded(task: Task, all?: Task[]): boolean {
  return isOpenTask(task) && !isSetUp(task, all);
}

export function notReadyTasks(tasks: Task[]): Task[] {
  return tasks.filter(task => isFaded(task, tasks));
}

export function ideas(tasks: Task[]): Task[] {
  return tasks
    .filter(isIdea)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** A short, honest reason for a faded card, e.g. "Needs Place and First step." */
export function setUpReason(task: Task, all?: Task[]): string {
  const missing = missingDots(task, all).map(dot => DOT_LABEL[dot]);
  if (!missing.length) return "Set up.";
  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `Needs ${list}.`;
}

/**
 * Move a card task between "inbox" and "ready" to match its dots. Other states
 * (waiting, blocked, done, someday) are the owner's and are left alone.
 */
export function settleCardState(task: Task, all?: Task[]): Task {
  if (!isCardTask(task)) return task;
  if (task.state !== "inbox" && task.state !== "ready") return task;
  const want = isSetUp(task, all) ? "ready" : "inbox";
  return task.state === want ? task : { ...task, state: want };
}

// ---------------------------------------------------------------------------
// Card changes. Each returns a settled card task with one history line.

function touch(task: Task, stamp: string, line: string): Task {
  return {
    ...task,
    // The first card edit makes this a card task, keeping what was true.
    actionConfirmed: task.actionConfirmed ?? true,
    updatedAt: stamp,
    history: [...task.history, { at: stamp, text: line }],
  };
}

function finish(task: Task, all?: Task[]): Task {
  const others = all?.map(t => (t.id === task.id ? task : t));
  return settleCardState(task, others);
}

export function setActionConfirmed(
  task: Task,
  confirmed: boolean,
  stamp: string,
  all?: Task[]
): Task {
  const next = touch(
    task,
    stamp,
    confirmed ? "Confirmed the title reads as an action." : "Title marked as not yet an action."
  );
  return finish({ ...next, actionConfirmed: confirmed }, all);
}

export function setCardTitle(task: Task, title: string, stamp: string, all?: Task[]): Task {
  const clean = title.trim();
  if (!clean || clean === task.title) return task;
  return finish({ ...touch(task, stamp, "Renamed on the card."), title: clean }, all);
}

export type CardPlace =
  | { kind: "project"; projectId: string }
  | { kind: "catch-all"; catchAll: CatchAll }
  | { kind: "none" };

export function setPlace(
  task: Task,
  place: CardPlace,
  stamp: string,
  all?: Task[],
  projects: Project[] = []
): Task {
  if (place.kind === "project") {
    const project = projects.find(p => p.id === place.projectId);
    const next = touch(task, stamp, `Placed in ${project?.title ?? "a project"}.`);
    return finish(
      {
        ...next,
        projectId: place.projectId,
        purpose: next.purpose || project?.purpose || "",
        compass: {
          ...next.compass,
          projectSuggested: false,
          catchAll: null,
          catchAllConfirmed: false,
          catchAllSince: null,
        },
      },
      all
    );
  }
  if (place.kind === "catch-all") {
    const next = touch(task, stamp, `Filed under ${CATCH_ALL_LABEL[place.catchAll]}.`);
    return finish(
      {
        ...next,
        projectId: null,
        compass: {
          ...next.compass,
          projectSuggested: false,
          catchAll: place.catchAll,
          catchAllConfirmed: true,
          catchAllSince: stamp,
        },
      },
      all
    );
  }
  const next = touch(task, stamp, "Place cleared on the card.");
  return finish(
    {
      ...next,
      projectId: null,
      compass: {
        ...next.compass,
        projectSuggested: false,
        catchAll: null,
        catchAllConfirmed: false,
        catchAllSince: null,
      },
    },
    all
  );
}

export function setFirstStep(task: Task, step: string, stamp: string, all?: Task[]): Task {
  const clean = step.trim().slice(0, 2000);
  if (clean === task.nextAction.trim() && isCardTask(task)) return task;
  return finish(
    { ...touch(task, stamp, clean ? "First step set on the card." : "First step cleared."), nextAction: clean },
    all
  );
}

/** "Title is the step": the title itself is the first physical action. */
export function titleIsStep(task: Task, stamp: string, all?: Task[]): Task {
  return finish(
    {
      ...touch(task, stamp, "The title is the first step."),
      nextAction: task.title,
      actionConfirmed: true,
    },
    all
  );
}

/** When: a planned day, a deadline, both, or neither. No dot. */
export function setWhen(
  task: Task,
  when: { date?: string | null; deadline?: string | null },
  stamp: string,
  all?: Task[]
): Task {
  const next = touch(task, stamp, "When changed on the card.");
  return finish(
    {
      ...next,
      ...(when.deadline !== undefined ? { deadline: when.deadline } : {}),
      ...(when.date !== undefined
        ? { schedule: { ...next.schedule, date: when.date } }
        : {}),
    },
    all
  );
}

// ---------------------------------------------------------------------------
// Ideas

/** Make it a task: the idea becomes a faded card task in the pool. */
export function ideaToTask(task: Task, stamp: string, all?: Task[]): Task {
  return finish(
    {
      ...task,
      state: "inbox",
      droppedAt: null,
      actionConfirmed: task.actionConfirmed ?? false,
      reviewDate: null,
      updatedAt: stamp,
      history: [...task.history, { at: stamp, text: "Idea made into a task." }],
    },
    all
  );
}

export function keepIdea(task: Task, stamp: string): Task {
  return {
    ...task,
    updatedAt: stamp,
    history: [...task.history, { at: stamp, text: "Idea kept." }],
  };
}

/** Let go: archived with the Dropped decision. Recoverable, never deleted. */
export function letGoIdea(task: Task, stamp: string): Task {
  return {
    ...task,
    droppedAt: stamp,
    updatedAt: stamp,
    history: [...task.history, { at: stamp, text: "Idea let go (archived, recoverable)." }],
  };
}

export function bringBackIdea(task: Task, stamp: string): Task {
  return {
    ...task,
    state: "someday",
    droppedAt: null,
    updatedAt: stamp,
    history: [...task.history, { at: stamp, text: "Idea brought back to the shelf." }],
  };
}

/** Ideas that were let go, newest first (for "Bring back"). */
export function letGoIdeas(tasks: Task[]): Task[] {
  return tasks
    .filter(t => t.state === "someday" && t.droppedAt)
    .sort((a, b) => (b.droppedAt ?? "").localeCompare(a.droppedAt ?? ""));
}

// ---------------------------------------------------------------------------
// Place choices for Sort: recent projects first, then the two catch-alls.

export function placeChoices(workspace: Workspace, limit = 6): {
  projects: Project[];
  catchAlls: CatchAll[];
} {
  const lastUsed = new Map<string, string>();
  for (const task of workspace.tasks) {
    if (!task.projectId || task.compass.projectSuggested) continue;
    const seen = lastUsed.get(task.projectId);
    if (!seen || task.updatedAt > seen) lastUsed.set(task.projectId, task.updatedAt);
  }
  const projects = workspace.projects
    .filter(p => p.status === "active")
    .sort((a, b) => {
      const at = lastUsed.get(a.id) ?? a.updatedAt;
      const bt = lastUsed.get(b.id) ?? b.updatedAt;
      return bt.localeCompare(at) || a.title.localeCompare(b.title);
    })
    .slice(0, limit);
  return { projects, catchAlls: ["life-admin", "erosion-guard"] };
}

export function placeLabel(task: Task, projects: Project[]): string | null {
  if (task.projectId && !task.compass.projectSuggested) {
    return projects.find(p => p.id === task.projectId)?.title ?? "Project";
  }
  if (task.compass.catchAll && task.compass.catchAllConfirmed) {
    return CATCH_ALL_LABEL[task.compass.catchAll];
  }
  if (task.compass.imperativeIds.length && !task.compass.imperativesSuggested) {
    return "Imperative";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dates always win: open tasks with a date of today or earlier.

export function datedForToday(tasks: Task[], today: string): Task[] {
  const due = (d: string | null | undefined) => Boolean(d && d <= today);
  return tasks.filter(
    t =>
      isOpenTask(t) &&
      (due(t.schedule.date) || due(t.deadline) || due(t.preparationDate))
  );
}

// ---------------------------------------------------------------------------
// Action hint: a gentle suggestion only. The owner always confirms.

const ACTION_VERBS = new Set(
  (
    "add answer apply arrange ask book bring buy call cancel change check choose clean clear collect confirm contact cook " +
    "create cut decide delete deliver do drop email empty file fill find finish fix follow get give go hang install " +
    "invoice list load look make measure meet message move order organise organize pack paint pay phone pick plan " +
    "post prepare print put quote read record register remove renew repair replace reply research return review " +
    "ring sell send service set share shop sign sort start submit swap take talk test text tidy transfer update " +
    "upload visit wash water write"
  ).split(" ")
);

/** True when the title starts with a common action word ("Call…", "Book…"). */
export function looksLikeAction(title: string): boolean {
  const first = title.trim().toLowerCase().split(/[\s,.:;!?]+/)[0] ?? "";
  return ACTION_VERBS.has(first);
}
