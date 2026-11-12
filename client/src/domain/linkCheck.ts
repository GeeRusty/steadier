/**
 * Link check and the hybrid matrix row.
 *
 * List 1: active Imperatives with no open work (no active project and no open
 * task linked to them).
 * List 2: active Imperative-row ("direction") projects not linked to any
 * active Imperative.
 *
 * Only the owner's own (confirmed) links count. Suggested links never count
 * and nothing here links anything by itself. "Not yet" holds an item until
 * the next Weekly Reality Review is saved; then it comes back.
 *
 * The hybrid row is computed each time it is shown and never written: a task
 * or project linked to an active Imperative is in the Imperative row; anything
 * else keeps the owner's manual role. Retiring an Imperative therefore falls
 * back to the manual role with no data change.
 */
import type { DecisionOutcome, Imperative } from "./compass";
import { isOpenTask, settleCardState } from "./taskCard";
import type {
  LifeRole,
  LinkCheckHold,
  MatrixCell,
  Project,
  Task,
  Workspace,
} from "./types";

export type { LinkCheckHold };

/** Shown for the stored role "direction". The stored value never changes. */
export const ROLE_LABEL: Record<LifeRole, string> = {
  direction: "Imperative",
  support: "Support",
};

// ---------------------------------------------------------------------------
// Confirmed links

export function confirmedTaskImperatives(task: Task): string[] {
  return task.compass.imperativesSuggested ? [] : task.compass.imperativeIds;
}

export function confirmedProjectImperatives(project: Project): string[] {
  return project.compass.imperativesSuggested
    ? []
    : project.compass.imperativeIds;
}

function activeIds(workspace: Pick<Workspace, "imperatives">): Set<string> {
  return new Set(
    (workspace.imperatives ?? [])
      .filter(i => i.status === "active")
      .map(i => i.id)
  );
}

type LinkSource = Pick<Workspace, "imperatives" | "projects">;

/** The active Imperatives this project is (confirmed) linked to. */
export function projectActiveLinks(
  project: Project,
  workspace: Pick<Workspace, "imperatives">
): string[] {
  const active = activeIds(workspace);
  return confirmedProjectImperatives(project).filter(id => active.has(id));
}

/** Active Imperatives a task reaches: its own links, or its project's. */
export function taskActiveLinks(task: Task, workspace: LinkSource): string[] {
  const active = activeIds(workspace);
  const ids = new Set(
    confirmedTaskImperatives(task).filter(id => active.has(id))
  );
  if (task.projectId && !task.compass.projectSuggested) {
    const project = workspace.projects.find(p => p.id === task.projectId);
    if (project)
      for (const id of projectActiveLinks(project, workspace)) ids.add(id);
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// Hybrid matrix row (computed only)

export function taskRowIsLinked(task: Task, workspace: LinkSource): boolean {
  return taskActiveLinks(task, workspace).length > 0;
}

export function projectRowIsLinked(
  project: Project,
  workspace: Pick<Workspace, "imperatives">
): boolean {
  return projectActiveLinks(project, workspace).length > 0;
}

/** Imperative when linked to an active Imperative; otherwise the manual role. */
export function effectiveTaskRole(
  task: Task,
  workspace: LinkSource
): LifeRole | null {
  return taskRowIsLinked(task, workspace) ? "direction" : task.role;
}

export function effectiveProjectRole(
  project: Project,
  workspace: Pick<Workspace, "imperatives">
): LifeRole {
  return projectRowIsLinked(project, workspace) ? "direction" : project.role;
}

/** The matrix cell, using the hybrid row. Null until the pattern is set too. */
export function effectiveMatrixKey(
  task: Task,
  workspace: LinkSource
): MatrixCell | null {
  const role = effectiveTaskRole(task, workspace);
  if (!role || !task.pattern) return null;
  return `${role}-${task.pattern}` as MatrixCell;
}

/** "Imperative · Timely", "Support · Sustained (provisional)" and so on. */
export function rowLabel(task: Task, workspace: LinkSource): string {
  const linked = taskRowIsLinked(task, workspace);
  const role = linked ? "direction" : task.role;
  const roleText = role
    ? `${ROLE_LABEL[role]}${linked ? " (linked)" : ""}`
    : null;
  const pattern = task.pattern
    ? task.pattern === "timely"
      ? "Timely"
      : "Sustained"
    : null;
  const label = [roleText, pattern].filter(Boolean).join(" · ");
  if (!label) return "Unclassified";
  return task.labelSource === "suggested" && !linked
    ? `${label} (provisional)`
    : label;
}

// ---------------------------------------------------------------------------
// Not yet holds

/** The moment the last Weekly Reality Review was saved, if any. */
export function lastReviewAt(
  workspace: Pick<Workspace, "reviews" | "trial">
): string | null {
  return (
    (workspace.reviews ?? []).at(-1)?.at ?? workspace.trial.lastReviewAt ?? null
  );
}

function time(value: string | null | undefined): number {
  const t = value ? Date.parse(value) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** A hold lasts until the next review is saved after it. */
export function holdIsLive(
  hold: LinkCheckHold,
  workspace: Pick<Workspace, "reviews" | "trial">
): boolean {
  const last = lastReviewAt(workspace);
  return !last || time(hold.heldOn) >= time(last);
}

export function liveHolds(workspace: Workspace): LinkCheckHold[] {
  return (workspace.linkCheckHolds ?? []).filter(h =>
    holdIsLive(h, workspace)
  );
}

export function isHeld(
  workspace: Workspace,
  kind: LinkCheckHold["kind"],
  id: string
): boolean {
  return liveHolds(workspace).some(h => h.kind === kind && h.id === id);
}

/** Hold one item; expired holds are tidied away at the same time. */
export function holdItem(
  workspace: Workspace,
  kind: LinkCheckHold["kind"],
  id: string,
  stamp: string
): Workspace {
  const keep = liveHolds(workspace).filter(
    h => !(h.kind === kind && h.id === id)
  );
  return { ...workspace, linkCheckHolds: [...keep, { kind, id, heldOn: stamp }] };
}

export function releaseHold(
  workspace: Workspace,
  kind: LinkCheckHold["kind"],
  id: string
): Workspace {
  if (!workspace.linkCheckHolds) return workspace;
  return {
    ...workspace,
    linkCheckHolds: workspace.linkCheckHolds.filter(
      h => !(h.kind === kind && h.id === id)
    ),
  };
}

// ---------------------------------------------------------------------------
// The two lists

/** Open tasks and active projects linked (confirmed) to this Imperative. */
export function imperativeWork(
  workspace: Workspace,
  imperativeId: string
): { projects: Project[]; tasks: Task[] } {
  const projects = workspace.projects.filter(
    p =>
      p.status === "active" &&
      confirmedProjectImperatives(p).includes(imperativeId)
  );
  const tasks = workspace.tasks.filter(
    t => isOpenTask(t) && confirmedTaskImperatives(t).includes(imperativeId)
  );
  return { projects, tasks };
}

/**
 * Step down with Sustain or Delegate keeps the Imperative active, so it is
 * treated as decided until the next review, like Not yet.
 */
function steppedDownSinceReview(
  imperative: Imperative,
  workspace: Workspace
): boolean {
  const d = imperative.decision;
  if (!d || !d.confirmed || d.by !== "owner") return false;
  if (d.outcome !== "sustain" && d.outcome !== "delegate") return false;
  const last = lastReviewAt(workspace);
  return !last || time(d.at) >= time(last);
}

/** Every active Imperative with no open work, held or not. */
export function imperativesWithoutWork(workspace: Workspace): Imperative[] {
  return (workspace.imperatives ?? []).filter(i => {
    if (i.status !== "active") return false;
    const work = imperativeWork(workspace, i.id);
    return work.projects.length === 0 && work.tasks.length === 0;
  });
}

/** Every active Imperative-row project with no active Imperative, held or not. */
export function projectsWithoutImperative(workspace: Workspace): Project[] {
  return workspace.projects.filter(
    p =>
      p.status === "active" &&
      p.role === "direction" &&
      projectActiveLinks(p, workspace).length === 0
  );
}

/** List 1, without held or stepped-down items. */
export function unlinkedImperatives(workspace: Workspace): Imperative[] {
  return imperativesWithoutWork(workspace).filter(
    i =>
      !isHeld(workspace, "imperative", i.id) &&
      !steppedDownSinceReview(i, workspace)
  );
}

/** List 2, without held items. */
export function unlinkedProjects(workspace: Workspace): Project[] {
  return projectsWithoutImperative(workspace).filter(
    p => !isHeld(workspace, "project", p.id)
  );
}

/**
 * Active projects with no confirmed Goal Outcome (the broken-link icon).
 * Counted in Link check since 2026-11-12 (owner-approved).
 */
export function projectsWithoutGoalOutcome(workspace: Workspace): Project[] {
  const linked = new Set<string>();
  for (const goal of workspace.goals ?? []) {
    if (goal.level !== "outcome" || goal.status !== "active") continue;
    for (const link of goal.projects ?? []) if (link.confirmed) linked.add(link.id);
  }
  return workspace.projects.filter(p => p.status === "active" && !linked.has(p.id));
}

export function linkCheckCount(workspace: Workspace): number {
  return (
    unlinkedImperatives(workspace).length +
    unlinkedProjects(workspace).length +
    projectsWithoutGoalOutcome(workspace).length
  );
}

/** Not yet items that still need a decision (for the Weekly Review step). */
export function heldLinkItems(workspace: Workspace): {
  imperatives: Imperative[];
  projects: Project[];
} {
  return {
    imperatives: imperativesWithoutWork(workspace).filter(i =>
      isHeld(workspace, "imperative", i.id)
    ),
    projects: projectsWithoutImperative(workspace).filter(p =>
      isHeld(workspace, "project", p.id)
    ),
  };
}

// ---------------------------------------------------------------------------
// Owner choices. Each is one explicit tap; nothing links itself.

function addLink(
  ids: string[],
  suggested: boolean | undefined,
  imperativeId: string
): string[] {
  // A pending suggestion is replaced by the owner's own pick.
  const base = suggested ? [] : ids;
  return base.includes(imperativeId) ? base : [...base, imperativeId];
}

function imperativeTitle(workspace: Workspace, id: string): string {
  return workspace.imperatives.find(i => i.id === id)?.title ?? "an Imperative";
}

/** Link a task to an Imperative (the owner's own link, confirmed). */
export function linkTaskToImperative(
  workspace: Workspace,
  taskId: string,
  imperativeId: string,
  stamp: string
): Workspace {
  const title = imperativeTitle(workspace, imperativeId);
  const tasks = workspace.tasks.map(t => {
    if (t.id !== taskId) return t;
    const next: Task = {
      ...t,
      compass: {
        ...t.compass,
        imperativeIds: addLink(
          t.compass.imperativeIds,
          t.compass.imperativesSuggested,
          imperativeId
        ),
        imperativesSuggested: false,
      },
      updatedAt: stamp,
      history: [
        ...t.history,
        { at: stamp, text: `Linked to Imperative “${title}” in Link check.` },
      ],
    };
    return next;
  });
  const settled = tasks.map(t => (t.id === taskId ? settleCardState(t, tasks) : t));
  return releaseHold({ ...workspace, tasks: settled }, "imperative", imperativeId);
}

/** Link a project to an Imperative (the owner's own link, confirmed). */
export function linkProjectToImperative(
  workspace: Workspace,
  projectId: string,
  imperativeId: string,
  stamp: string
): Workspace {
  const projects = workspace.projects.map(p => {
    if (p.id !== projectId) return p;
    const { imperativesSuggested, ...compass } = p.compass;
    return {
      ...p,
      compass: {
        ...compass,
        imperativeIds: addLink(
          p.compass.imperativeIds,
          imperativesSuggested,
          imperativeId
        ),
      },
      updatedAt: stamp,
    };
  });
  const next = { ...workspace, projects };
  return releaseHold(
    releaseHold(next, "imperative", imperativeId),
    "project",
    projectId
  );
}

/** Confirm a connector's suggested project–Imperative links. */
export function confirmProjectImperatives(project: Project, stamp: string): Project {
  if (!project.compass.imperativesSuggested) return project;
  const { imperativesSuggested: _drop, ...compass } = project.compass;
  return { ...project, compass, updatedAt: stamp };
}

/** Make it Support: the owner's own change to the stored role. */
export function makeProjectSupport(
  workspace: Workspace,
  projectId: string,
  stamp: string
): Workspace {
  return releaseHold(
    {
      ...workspace,
      projects: workspace.projects.map(p =>
        p.id === projectId ? { ...p, role: "support" as const, updatedAt: stamp } : p
      ),
    },
    "project",
    projectId
  );
}

export const STEP_DOWN_OUTCOMES = ["sustain", "delegate", "retire"] as const;
export type StepDownOutcome = Extract<
  DecisionOutcome,
  (typeof STEP_DOWN_OUTCOMES)[number]
>;

/** Step down: the existing Sustain / Delegate / Retire decision, by the owner. */
export function stepDownImperative(
  workspace: Workspace,
  imperativeId: string,
  outcome: StepDownOutcome,
  stamp: string,
  today: string
): Workspace {
  const retire = outcome === "retire";
  return releaseHold(
    {
      ...workspace,
      imperatives: workspace.imperatives.map(i =>
        i.id === imperativeId
          ? {
              ...i,
              decision: {
                outcome,
                at: stamp,
                by: "owner" as const,
                confirmed: true,
                note: i.decision?.note ?? "",
              },
              ...(retire
                ? { status: "retired" as const, retiredOn: today }
                : {}),
              updatedAt: stamp,
              history: [
                ...i.history,
                {
                  at: stamp,
                  text: `Link check: ${retire ? "retired" : outcome}.`,
                },
              ],
            }
          : i
      ),
    },
    "imperative",
    imperativeId
  );
}

// ---------------------------------------------------------------------------
// Balance (counts and time) for the matrix page. Describes; never ranks.

export interface CellBalance {
  tasks: Task[];
  /** Estimated minutes of the open tasks in the cell. */
  estimateMinutes: number;
  /** Minutes logged in the last seven days on tasks in the cell. */
  loggedMinutes: number;
}

export function matrixBalance(
  workspace: Workspace,
  today: string
): { cells: Record<MatrixCell, CellBalance>; unclassified: Task[] } {
  const empty = (): CellBalance => ({
    tasks: [],
    estimateMinutes: 0,
    loggedMinutes: 0,
  });
  const cells: Record<MatrixCell, CellBalance> = {
    "direction-timely": empty(),
    "direction-sustained": empty(),
    "support-timely": empty(),
    "support-sustained": empty(),
  };
  const unclassified: Task[] = [];
  const weekStart = shiftDay(today, -6);
  for (const task of workspace.tasks) {
    if (task.droppedAt || task.state === "someday") continue;
    const key = effectiveMatrixKey(task, workspace);
    const logged = task.schedule.timeLog
      .filter(e => {
        const day = e.start.slice(0, 10);
        return day >= weekStart && day <= today;
      })
      .reduce((sum, e) => sum + e.minutes, 0);
    if (task.state === "done") {
      if (key) cells[key].loggedMinutes += logged;
      continue;
    }
    if (!key) {
      unclassified.push(task);
      continue;
    }
    cells[key].tasks.push(task);
    cells[key].estimateMinutes += task.estimate || 0;
    cells[key].loggedMinutes += logged;
  }
  return { cells, unclassified };
}

function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function minutesText(minutes: number): string {
  if (minutes <= 0) return "0 min";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * On saving a Weekly Review: holds chosen again during this review ("Not yet
 * again") are carried to the new review time; every older hold expires and
 * is removed, so its item comes back to Link check.
 */
export function renewHoldsForReview(
  workspace: Workspace,
  reviewStartedAt: string | null,
  reviewAt: string
): Workspace {
  if (!workspace.linkCheckHolds) return workspace;
  const start = reviewStartedAt ? time(reviewStartedAt) : Infinity;
  const kept = workspace.linkCheckHolds
    .filter(h => time(h.heldOn) >= start)
    .map(h => ({ ...h, heldOn: reviewAt }));
  return { ...workspace, linkCheckHolds: kept };
}
