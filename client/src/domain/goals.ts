/**
 * Compass map (v2.4): Pillars → Value Goals → Goal Outcomes → projects.
 *
 * One flat list of goals, each with a level. Links always point UP one level
 * and are many-to-many (a Goal Outcome may sit under two Value Goals). Goal
 * Outcomes also hold links DOWN to projects, so existing project records keep
 * their shape. Every link carries `confirmed`: links suggested by Claude stay
 * unconfirmed until the owner confirms them.
 *
 * Steadier never creates, ranks or retires a goal on the owner's behalf. It
 * only shows the chain and flags gaps (never blocks).
 */
import type { Imperative } from "./compass";
import type { Project, Task, Workspace } from "./types";

export const GOAL_LEVELS = ["pillar", "value-goal", "outcome"] as const;
export type GoalLevel = (typeof GOAL_LEVELS)[number];
export const GOAL_LEVEL_LABEL: Record<GoalLevel, string> = {
  pillar: "Pillar",
  "value-goal": "Value Goal",
  outcome: "Goal Outcome",
};
export const GOAL_LEVEL_PLURAL: Record<GoalLevel, string> = {
  pillar: "Pillars",
  "value-goal": "Value Goals",
  outcome: "Goal Outcomes",
};
/** The level an item links up to (pillars link to nothing). */
export const PARENT_LEVEL: Record<GoalLevel, GoalLevel | null> = {
  pillar: null,
  "value-goal": "pillar",
  outcome: "value-goal",
};
/** The level an item holds below it (Goal Outcomes hold projects instead). */
export const CHILD_LEVEL: Record<GoalLevel, GoalLevel | null> = {
  pillar: "value-goal",
  "value-goal": "outcome",
  outcome: null,
};
export const MAX_GOALS = 400;
export const STALLED_OUTCOME_DAYS = 14;

export interface GoalLink {
  id: string;
  confirmed: boolean;
}

export interface Goal {
  id: string;
  level: GoalLevel;
  title: string;
  description: string;
  status: "active" | "retired";
  /** Links up one level (empty for pillars). */
  parents: GoalLink[];
  /** Goal Outcomes only: linked projects. Empty for other levels. */
  projects: GoalLink[];
  notionUrl: string | null;
  history: { at: string; text: string }[];
  createdAt: string;
  updatedAt: string;
}

export function newGoal(
  level: GoalLevel,
  title: string,
  stamp: string,
  extra: Partial<Pick<Goal, "description" | "notionUrl" | "parents">> = {}
): Goal {
  return {
    id: `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    level,
    title: title.trim().slice(0, 300),
    description: (extra.description ?? "").slice(0, 2000),
    status: "active",
    parents: extra.parents ?? [],
    projects: [],
    notionUrl: extra.notionUrl ?? null,
    history: [{ at: stamp, text: `${GOAL_LEVEL_LABEL[level]} added.` }],
    createdAt: stamp,
    updatedAt: stamp,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;
function fail(message: string): never {
  throw new Error(`Could not import tasks: ${message}`);
}
function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function exact(v: Rec, keys: readonly string[], label: string) {
  const actual = Object.keys(v);
  if (
    actual.length !== keys.length ||
    !keys.every(k => Object.prototype.hasOwnProperty.call(v, k))
  ) {
    fail(`${label} has unknown or missing fields.`);
  }
}
function str(v: unknown, label: string, max: number, min = 0): string {
  if (typeof v !== "string" || v.length > max || v.trim().length < min)
    fail(`${label} must be text up to ${max} characters.`);
  return v;
}
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
function id(v: unknown, label: string): string {
  if (typeof v !== "string" || !ID.test(v)) fail(`${label} is not a valid id.`);
  return v;
}
function stampField(v: unknown, label: string): string {
  if (typeof v !== "string" || v.length > 40 || Number.isNaN(Date.parse(v)))
    fail(`${label} is not a valid time.`);
  return v;
}
function links(v: unknown, label: string): GoalLink[] {
  if (!Array.isArray(v) || v.length > 50)
    fail(`${label} must be a list of at most 50 links.`);
  const seen = new Set<string>();
  return v.map((l, i) => {
    if (!isRec(l)) fail(`${label} link ${i + 1} is not an object.`);
    exact(l, ["id", "confirmed"], `${label} link ${i + 1}`);
    const linkId = id(l.id, `${label} link id`);
    if (seen.has(linkId)) fail(`${label} links the same item twice.`);
    seen.add(linkId);
    if (typeof l.confirmed !== "boolean")
      fail(`${label} link confirmed must be true or false.`);
    return { id: linkId, confirmed: l.confirmed };
  });
}
function notionField(v: unknown, label: string): string | null {
  if (v === null) return null;
  if (typeof v !== "string") fail(`${label} must be a link or empty.`);
  const ok = normaliseNotion(v);
  if (!ok) fail(`${label} must be an https notion.so or notion.site link.`);
  return ok;
}
function normaliseNotion(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const isNotion =
      host === "notion.so" ||
      host.endsWith(".notion.so") ||
      host === "notion.site" ||
      host.endsWith(".notion.site");
    return url.protocol === "https:" &&
      isNotion &&
      !url.username &&
      !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

const GOAL_KEYS = [
  "id",
  "level",
  "title",
  "description",
  "status",
  "parents",
  "projects",
  "notionUrl",
  "history",
  "createdAt",
  "updatedAt",
] as const;

export function goalsField(value: unknown): Goal[] {
  if (!Array.isArray(value) || value.length > MAX_GOALS)
    fail(`goals must be a list of at most ${MAX_GOALS}.`);
  const goals = value.map((g, n) => {
    const label = `goal ${n + 1}`;
    if (!isRec(g)) fail(`${label} is not an object.`);
    exact(g, GOAL_KEYS, label);
    if (
      typeof g.level !== "string" ||
      !GOAL_LEVELS.includes(g.level as GoalLevel)
    )
      fail(`${label} level is not recognised.`);
    if (g.status !== "active" && g.status !== "retired")
      fail(`${label} status must be active or retired.`);
    if (!Array.isArray(g.history) || g.history.length > 500)
      fail(`${label} history must be a list.`);
    const level = g.level as GoalLevel;
    const goal: Goal = {
      id: id(g.id, `${label} id`),
      level,
      title: str(g.title, `${label} title`, 300, 1),
      description: str(g.description, `${label} description`, 2000),
      status: g.status,
      parents: links(g.parents, `${label} parents`),
      projects: links(g.projects, `${label} projects`),
      notionUrl: notionField(g.notionUrl, `${label} Notion link`),
      history: g.history.map((h, i) => {
        if (!isRec(h)) fail(`${label} history ${i + 1} is not an object.`);
        exact(h, ["at", "text"], `${label} history ${i + 1}`);
        return {
          at: stampField(h.at, `${label} history time`),
          text: str(h.text, `${label} history text`, 1000),
        };
      }),
      createdAt: stampField(g.createdAt, `${label} createdAt`),
      updatedAt: stampField(g.updatedAt, `${label} updatedAt`),
    };
    if (level === "pillar" && goal.parents.length)
      fail(`${label}: a Pillar does not sit under anything.`);
    if (level !== "outcome" && goal.projects.length)
      fail(`${label}: only Goal Outcomes link to projects.`);
    return goal;
  });
  const ids = new Set<string>();
  for (const g of goals) {
    if (ids.has(g.id)) fail(`goal id ${g.id} is used twice.`);
    ids.add(g.id);
  }
  // Parents must be exactly one level up.
  const byId = new Map(goals.map(g => [g.id, g]));
  for (const g of goals) {
    // Links to items that no longer exist are dropped quietly, never rejected.
    g.parents = g.parents.filter(p => byId.has(p.id));
    for (const p of g.parents) {
      const parent = byId.get(p.id);
      if (!parent || parent.level !== PARENT_LEVEL[g.level]) {
        fail(
          `${GOAL_LEVEL_LABEL[g.level]} “${g.title}” links to something that is not a ${PARENT_LEVEL[g.level] ? GOAL_LEVEL_LABEL[PARENT_LEVEL[g.level]!] : "parent"}.`
        );
      }
    }
  }
  return goals;
}

/** Drop links to goals or projects that no longer exist (never rejects a save). */
export function pruneGoalLinks(workspace: Workspace): Workspace {
  const goals = workspace.goals ?? [];
  const goalIds = new Set(goals.map(g => g.id));
  const projectIds = new Set(workspace.projects.map(p => p.id));
  let changed = false;
  const next = goals.map(g => {
    const parents = g.parents.filter(l => goalIds.has(l.id));
    const projects = g.projects.filter(l => projectIds.has(l.id));
    if (
      parents.length === g.parents.length &&
      projects.length === g.projects.length
    )
      return g;
    changed = true;
    return { ...g, parents, projects };
  });
  const withGoals = changed ? { ...workspace, goals: next } : workspace;
  // Imperative map links (optional field) must point at existing map items.
  const imperatives = withGoals.imperatives ?? [];
  if (!imperatives.some(i => i.mapLinks?.some(id => !goalIds.has(id))))
    return withGoals;
  return {
    ...withGoals,
    imperatives: imperatives.map(i =>
      i.mapLinks?.some(id => !goalIds.has(id))
        ? { ...i, mapLinks: i.mapLinks.filter(id => goalIds.has(id)) }
        : i
    ),
  };
}

// ---------------------------------------------------------------------------
// Reading the map
// ---------------------------------------------------------------------------

export function goalsAt(
  workspace: Workspace,
  level: GoalLevel,
  includeRetired = false
): Goal[] {
  return (workspace.goals ?? []).filter(
    g => g.level === level && (includeRetired || g.status === "active")
  );
}
export function childrenOf(
  workspace: Workspace,
  parentId: string,
  includeRetired = false
): Goal[] {
  return (workspace.goals ?? []).filter(
    g =>
      (includeRetired || g.status === "active") &&
      g.parents.some(l => l.id === parentId)
  );
}
export function outcomesForProject(
  workspace: Workspace,
  projectId: string
): Goal[] {
  return (workspace.goals ?? []).filter(
    g =>
      g.level === "outcome" &&
      g.status === "active" &&
      g.projects.some(l => l.id === projectId)
  );
}

export interface ChainStep {
  goal: Goal;
  confirmed: boolean;
}
/**
 * Every upward path from a project to a Pillar ("why am I doing this?").
 * Many-to-many means several paths; each is ordered outcome → value goal → pillar.
 */
export function chainsForProject(
  workspace: Workspace,
  projectId: string,
  max = 6
): ChainStep[][] {
  const byId = new Map(
    (workspace.goals ?? [])
      .filter(g => g.status === "active")
      .map(g => [g.id, g])
  );
  const out: ChainStep[][] = [];
  const walk = (goal: Goal, confirmed: boolean, path: ChainStep[]) => {
    if (out.length >= max) return;
    const here = [...path, { goal, confirmed }];
    const parents = goal.parents
      .map(l => ({ g: byId.get(l.id), c: l.confirmed }))
      .filter(x => x.g) as { g: Goal; c: boolean }[];
    if (!parents.length) {
      out.push(here);
      return;
    }
    for (const p of parents) walk(p.g, p.c, here);
  };
  for (const outcome of outcomesForProject(workspace, projectId)) {
    const link = outcome.projects.find(l => l.id === projectId)!;
    walk(outcome, link.confirmed, []);
  }
  return out;
}

/** Plain-language "why" for a task or project, used on screen and read aloud. */
export function describeWhy(
  workspace: Workspace,
  project: Project | null | undefined
): string {
  if (!project)
    return "This step has no project, so it is not linked to a Goal Outcome yet.";
  const chains = chainsForProject(workspace, project.id);
  if (!chains.length)
    return `“${project.title}” is not linked to a Goal Outcome yet.`;
  // Merge paths that differ only in their top item ("…under Pillars A and B").
  const label = (st: ChainStep) =>
    `${GOAL_LEVEL_LABEL[st.goal.level]} “${st.goal.title}”${st.confirmed ? "" : " (suggested)"}`;
  const groups = new Map<string, { prefix: ChainStep[]; tops: ChainStep[] }>();
  for (const chain of chains) {
    const prefix = chain.slice(0, -1);
    const key = prefix.map(st => st.goal.id).join(">");
    const group = groups.get(key) ?? { prefix, tops: [] };
    group.tops.push(chain.at(-1)!);
    groups.set(key, group);
  }
  const lines = [...groups.values()].map(({ prefix, tops }) => {
    const parts = prefix.map(label);
    const pillars = tops.filter(t => t.goal.level === "pillar");
    const others = tops.filter(t => t.goal.level !== "pillar");
    if (pillars.length > 1) {
      const names = pillars.map(
        t => `“${t.goal.title}”${t.confirmed ? "" : " (suggested)"}`
      );
      parts.push(
        `Pillars ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
      );
    } else if (pillars.length === 1) parts.push(label(pillars[0]));
    if (!pillars.length) {
      return `${[...parts, ...others.map(label)].join(", under ")}, which does not reach a Pillar yet`;
    }
    let text = parts.join(", under ");
    if (others.length)
      text += `; also under ${others.map(label).join(", ")}, which does not reach a Pillar yet`;
    return text;
  });
  return `“${project.title}” serves ${lines.join("; and ")}.`;
}
export function describeTaskWhy(workspace: Workspace, task: Task): string {
  const project = task.projectId
    ? workspace.projects.find(p => p.id === task.projectId)
    : null;
  return describeWhy(workspace, project);
}

// ---------------------------------------------------------------------------
// Drift signals (flag, never block)
// ---------------------------------------------------------------------------

function dayOf(stamp: string): string {
  return stamp.slice(0, 10);
}
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000
  );
}

/** Latest movement under an outcome: linked project updates or their tasks' history. */
export function outcomeLastMovement(
  workspace: Workspace,
  outcome: Goal
): string | null {
  const projectIds = new Set(outcome.projects.map(l => l.id));
  let latest: string | null = null;
  const bump = (s: string | null | undefined) => {
    if (s && (!latest || dayOf(s) > latest)) latest = dayOf(s);
  };
  for (const p of workspace.projects)
    if (projectIds.has(p.id)) bump(p.updatedAt);
  for (const t of workspace.tasks) {
    if (!t.projectId || !projectIds.has(t.projectId)) continue;
    bump(t.completedAt);
    bump(t.history.at(-1)?.at);
  }
  return latest;
}

export interface MapGap {
  kind:
    | "pillar-empty"
    | "value-goal-empty"
    | "value-goal-orphan"
    | "outcome-orphan"
    | "outcome-no-project"
    | "outcome-stalled"
    | "project-unlinked"
    | "suggested-link"
    | "imperative-unmapped";
  id: string;
  title: string;
  text: string;
}

export function mapGaps(workspace: Workspace, today: string): MapGap[] {
  const gaps: MapGap[] = [];
  const goals = (workspace.goals ?? []).filter(g => g.status === "active");
  if (!goals.length) return gaps;
  const activeProjects = new Set(
    workspace.projects.filter(p => p.status === "active").map(p => p.id)
  );
  for (const g of goals) {
    const kids = childrenOf(workspace, g.id);
    if (g.level === "pillar" && !kids.some(k => k.level === "value-goal")) {
      gaps.push({
        kind: "pillar-empty",
        id: g.id,
        title: g.title,
        text: `Pillar “${g.title}” has no Value Goal under it.`,
      });
    }
    if (g.level === "value-goal") {
      if (!g.parents.length)
        gaps.push({
          kind: "value-goal-orphan",
          id: g.id,
          title: g.title,
          text: `Value Goal “${g.title}” does not sit under a Pillar.`,
        });
      if (!kids.length)
        gaps.push({
          kind: "value-goal-empty",
          id: g.id,
          title: g.title,
          text: `Value Goal “${g.title}” has no Goal Outcome.`,
        });
    }
    if (g.level === "outcome") {
      if (!g.parents.length)
        gaps.push({
          kind: "outcome-orphan",
          id: g.id,
          title: g.title,
          text: `Goal Outcome “${g.title}” does not sit under a Value Goal.`,
        });
      const live = g.projects.filter(l => activeProjects.has(l.id));
      if (!live.length) {
        gaps.push({
          kind: "outcome-no-project",
          id: g.id,
          title: g.title,
          text: `Goal Outcome “${g.title}” has no active project.`,
        });
      } else {
        const last = outcomeLastMovement(workspace, g);
        const days = last ? daysBetween(last, today) : null;
        if (days === null || days >= STALLED_OUTCOME_DAYS) {
          gaps.push({
            kind: "outcome-stalled",
            id: g.id,
            title: g.title,
            text: `Goal Outcome “${g.title}” has had no movement for ${days ?? "many"} days.`,
          });
        }
      }
    }
    const pending = [...g.parents, ...g.projects].filter(
      l => !l.confirmed
    ).length;
    if (pending)
      gaps.push({
        kind: "suggested-link",
        id: g.id,
        title: g.title,
        text: `“${g.title}” has ${pending} suggested link${pending === 1 ? "" : "s"} to confirm.`,
      });
  }
  for (const p of workspace.projects) {
    if (p.status === "active" && !outcomesForProject(workspace, p.id).length) {
      gaps.push({
        kind: "project-unlinked",
        id: p.id,
        title: p.title,
        text: `Project “${p.title}” is not linked to a Goal Outcome.`,
      });
    }
  }
  // An active Imperative is on the map if it links directly to an active map
  // item, or any project it touches (directly or through its tasks) serves an
  // active Goal Outcome. Otherwise it sits outside the chain.
  const activeGoalIds = new Set(goals.map(g => g.id));
  for (const imp of workspace.imperatives ?? []) {
    if (imp.status !== "active") continue;
    if (imp.mapLinks?.some(id => activeGoalIds.has(id))) continue;
    if (
      imperativeProjectIds(workspace, imp).some(
        id => outcomesForProject(workspace, id).length > 0
      )
    )
      continue;
    gaps.push({
      kind: "imperative-unmapped",
      id: imp.id,
      title: imp.title,
      text: `Imperative “${imp.title}” is not on the map yet.`,
    });
  }
  return gaps;
}

/** Projects an Imperative touches: linked directly, or through a linked task. */
export function imperativeProjectIds(
  workspace: Workspace,
  imperative: Imperative
): string[] {
  const ids = new Set<string>();
  for (const p of workspace.projects)
    if (p.compass.imperativeIds.includes(imperative.id)) ids.add(p.id);
  for (const t of workspace.tasks)
    if (t.projectId && t.compass.imperativeIds.includes(imperative.id))
      ids.add(t.projectId);
  return [...ids];
}

// ---------------------------------------------------------------------------
// Owner edits (pure functions over the workspace)
// ---------------------------------------------------------------------------

function touch(goal: Goal, stamp: string, text: string): Goal {
  return {
    ...goal,
    updatedAt: stamp,
    history: [...goal.history, { at: stamp, text }].slice(-500),
  };
}
function mapGoal(
  workspace: Workspace,
  goalId: string,
  fn: (g: Goal) => Goal
): Workspace {
  return {
    ...workspace,
    goals: (workspace.goals ?? []).map(g => (g.id === goalId ? fn(g) : g)),
  };
}

export function addGoal(workspace: Workspace, goal: Goal): Workspace {
  return { ...workspace, goals: [...(workspace.goals ?? []), goal] };
}
export function editGoal(
  workspace: Workspace,
  goalId: string,
  patch: Partial<Pick<Goal, "title" | "description" | "notionUrl">>,
  stamp: string
): Workspace {
  return mapGoal(workspace, goalId, g =>
    touch({ ...g, ...patch }, stamp, "Edited.")
  );
}

export function setGoalStatus(
  workspace: Workspace,
  goalId: string,
  status: Goal["status"],
  stamp: string
): Workspace {
  return mapGoal(workspace, goalId, g =>
    touch(
      { ...g, status },
      stamp,
      status === "retired"
        ? "Retired (kept, not deleted)."
        : "Made active again."
    )
  );
}
/** Link a goal up to a parent, or confirm an existing suggested link. */
export function linkParent(
  workspace: Workspace,
  goalId: string,
  parentId: string,
  stamp: string,
  confirmed = true
): Workspace {
  const parent = (workspace.goals ?? []).find(g => g.id === parentId);
  return mapGoal(workspace, goalId, g => {
    if (!parent || parent.level !== PARENT_LEVEL[g.level]) return g;
    const has = g.parents.find(l => l.id === parentId);
    if (has && has.confirmed === confirmed) return g;
    const parents = has
      ? g.parents.map(l => (l.id === parentId ? { ...l, confirmed } : l))
      : [...g.parents, { id: parentId, confirmed }];
    return touch(
      { ...g, parents },
      stamp,
      `${has ? "Confirmed link" : confirmed ? "Linked" : "Suggested link"} under “${parent.title}”.`
    );
  });
}
export function unlinkParent(
  workspace: Workspace,
  goalId: string,
  parentId: string,
  stamp: string
): Workspace {
  const parent = (workspace.goals ?? []).find(g => g.id === parentId);
  return mapGoal(workspace, goalId, g =>
    touch(
      { ...g, parents: g.parents.filter(l => l.id !== parentId) },
      stamp,
      `Unlinked from “${parent?.title ?? parentId}”.`
    )
  );
}
export function linkProject(
  workspace: Workspace,
  outcomeId: string,
  projectId: string,
  stamp: string,
  confirmed = true
): Workspace {
  const project = workspace.projects.find(p => p.id === projectId);
  return mapGoal(workspace, outcomeId, g => {
    if (g.level !== "outcome" || !project) return g;
    const has = g.projects.find(l => l.id === projectId);
    if (has && has.confirmed === confirmed) return g;
    const projects = has
      ? g.projects.map(l => (l.id === projectId ? { ...l, confirmed } : l))
      : [...g.projects, { id: projectId, confirmed }];
    return touch(
      { ...g, projects },
      stamp,
      `${has ? "Confirmed project" : confirmed ? "Linked project" : "Suggested project"} “${project.title}”.`
    );
  });
}
export function unlinkProject(
  workspace: Workspace,
  outcomeId: string,
  projectId: string,
  stamp: string
): Workspace {
  const project = workspace.projects.find(p => p.id === projectId);
  return mapGoal(workspace, outcomeId, g =>
    touch(
      { ...g, projects: g.projects.filter(l => l.id !== projectId) },
      stamp,
      `Unlinked project “${project?.title ?? projectId}”.`
    )
  );
}
