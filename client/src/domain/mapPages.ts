/**
 * Level pages for the Compass map (Pillar, Value Goal, Goal Outcome).
 *
 * These are owner actions taken from the page that owns an item. Every link
 * still lives where it always has (a goal's `parents`, an outcome's `projects`,
 * an Imperative's optional `mapLinks`), so no existing record changes shape.
 *
 * Rules that keep suggested/confirmed status honest:
 * - Adding an existing child from a parent's page never touches a link that
 *   already exists. A suggested link stays suggested until the owner taps
 *   Confirm; a confirmed link is never downgraded.
 * - Confirm only upgrades a link that is currently suggested.
 * - Each change is written to the history of BOTH ends.
 */
import { emptyProjectCompass, type Imperative } from "./compass";
import {
  CHILD_LEVEL,
  GOAL_LEVEL_LABEL,
  PARENT_LEVEL,
  childrenOf,
  imperativeProjectIds,
  linkParent,
  linkProject,
  mapGaps,
  newGoal,
  outcomesForProject,
  unlinkParent,
  unlinkProject,
  type Goal,
  type MapGap,
} from "./goals";
import { emptyProjectSchedule } from "./time";
import type { Project, Workspace } from "./types";

export type LinkStatus = "none" | "suggested" | "confirmed";

function goalById(w: Workspace, id: string): Goal | undefined {
  return (w.goals ?? []).find(g => g.id === id);
}
function note(goal: Goal, stamp: string, text: string): Goal {
  return {
    ...goal,
    updatedAt: stamp,
    history: [...goal.history, { at: stamp, text }].slice(-500),
  };
}
function noteOn(w: Workspace, goalId: string, stamp: string, text: string) {
  return {
    ...w,
    goals: (w.goals ?? []).map(g =>
      g.id === goalId ? note(g, stamp, text) : g
    ),
  };
}

// ---------------------------------------------------------------------------
// Goal ↔ goal links, edited from either end
// ---------------------------------------------------------------------------

export function parentLinkStatus(
  w: Workspace,
  childId: string,
  parentId: string
): LinkStatus {
  const link = goalById(w, childId)?.parents.find(l => l.id === parentId);
  return !link ? "none" : link.confirmed ? "confirmed" : "suggested";
}

/** True when `child` may sit directly under `parent`. */
export function canSitUnder(child: Goal, parent: Goal): boolean {
  return PARENT_LEVEL[child.level] === parent.level;
}

/**
 * Owner adds an existing item under this one. Creates a CONFIRMED link only
 * when no link exists; if a link already exists (suggested or confirmed) the
 * workspace is returned unchanged.
 */
export function addExistingChild(
  w: Workspace,
  parentId: string,
  childId: string,
  stamp: string
): Workspace {
  const parent = goalById(w, parentId);
  const child = goalById(w, childId);
  if (!parent || !child || !canSitUnder(child, parent)) return w;
  if (parentLinkStatus(w, childId, parentId) !== "none") return w;
  const linked = linkParent(w, childId, parentId, stamp, true);
  return noteOn(
    linked,
    parentId,
    stamp,
    `Added ${GOAL_LEVEL_LABEL[child.level]} “${child.title}” under this.`
  );
}

/** Owner adds this item under another (from the child's page). */
export function addParent(
  w: Workspace,
  childId: string,
  parentId: string,
  stamp: string
): Workspace {
  const parent = goalById(w, parentId);
  const child = goalById(w, childId);
  if (!parent || !child || !canSitUnder(child, parent)) return w;
  if (parentLinkStatus(w, childId, parentId) !== "none") return w;
  const linked = linkParent(w, childId, parentId, stamp, true);
  return noteOn(
    linked,
    parentId,
    stamp,
    `${GOAL_LEVEL_LABEL[child.level]} “${child.title}” now sits under this.`
  );
}

/** Owner confirms a suggested goal link. Does nothing unless it is suggested. */
export function confirmGoalLink(
  w: Workspace,
  childId: string,
  parentId: string,
  stamp: string
): Workspace {
  if (parentLinkStatus(w, childId, parentId) !== "suggested") return w;
  const child = goalById(w, childId)!;
  const linked = linkParent(w, childId, parentId, stamp, true);
  return noteOn(
    linked,
    parentId,
    stamp,
    `Confirmed suggested link: ${GOAL_LEVEL_LABEL[child.level]} “${child.title}” sits under this.`
  );
}

/** Owner removes a goal link (rejects a suggestion or unlinks a confirmed one). */
export function removeGoalLink(
  w: Workspace,
  childId: string,
  parentId: string,
  stamp: string
): Workspace {
  const status = parentLinkStatus(w, childId, parentId);
  if (status === "none") return w;
  const child = goalById(w, childId)!;
  const unlinked = unlinkParent(w, childId, parentId, stamp);
  return noteOn(
    unlinked,
    parentId,
    stamp,
    status === "suggested"
      ? `Rejected suggested link from ${GOAL_LEVEL_LABEL[child.level]} “${child.title}”.`
      : `${GOAL_LEVEL_LABEL[child.level]} “${child.title}” no longer sits under this.`
  );
}

/** Owner creates a new item directly under this one (confirmed link). */
export function createChildUnder(
  w: Workspace,
  parentId: string,
  title: string,
  stamp: string
): { workspace: Workspace; id: string | null } {
  const parent = goalById(w, parentId);
  const level = parent ? CHILD_LEVEL[parent.level] : null;
  const clean = title.trim();
  if (!parent || !level || !clean) return { workspace: w, id: null };
  const goal = newGoal(level, clean, stamp, {
    parents: [{ id: parentId, confirmed: true }],
  });
  goal.history = [
    {
      at: stamp,
      text: `${GOAL_LEVEL_LABEL[level]} added under “${parent.title}”.`,
    },
  ];
  const added = { ...w, goals: [...(w.goals ?? []), goal] };
  return {
    workspace: noteOn(
      added,
      parentId,
      stamp,
      `Added new ${GOAL_LEVEL_LABEL[level]} “${goal.title}” under this.`
    ),
    id: goal.id,
  };
}

// ---------------------------------------------------------------------------
// Goal Outcome ↔ project links, edited from the Outcome or the project
// ---------------------------------------------------------------------------

export function projectLinkStatus(
  w: Workspace,
  outcomeId: string,
  projectId: string
): LinkStatus {
  const link = goalById(w, outcomeId)?.projects.find(l => l.id === projectId);
  return !link ? "none" : link.confirmed ? "confirmed" : "suggested";
}

/** Owner links a project to an Outcome. Never alters an existing link. */
export function addProjectLink(
  w: Workspace,
  outcomeId: string,
  projectId: string,
  stamp: string
): Workspace {
  const outcome = goalById(w, outcomeId);
  if (!outcome || outcome.level !== "outcome") return w;
  if (projectLinkStatus(w, outcomeId, projectId) !== "none") return w;
  return linkProject(w, outcomeId, projectId, stamp, true);
}

/** Owner confirms a suggested project link. Does nothing unless suggested. */
export function confirmProjectLink(
  w: Workspace,
  outcomeId: string,
  projectId: string,
  stamp: string
): Workspace {
  if (projectLinkStatus(w, outcomeId, projectId) !== "suggested") return w;
  return linkProject(w, outcomeId, projectId, stamp, true);
}

export function removeProjectLink(
  w: Workspace,
  outcomeId: string,
  projectId: string,
  stamp: string
): Workspace {
  const status = projectLinkStatus(w, outcomeId, projectId);
  if (status === "none") return w;
  const project = w.projects.find(p => p.id === projectId);
  const unlinked = unlinkProject(w, outcomeId, projectId, stamp);
  if (status === "confirmed") return unlinked;
  // Make the history say it was a rejected suggestion, not a plain unlink.
  return {
    ...unlinked,
    goals: (unlinked.goals ?? []).map(g =>
      g.id === outcomeId
        ? {
            ...g,
            history: [
              ...g.history.slice(0, -1),
              {
                at: stamp,
                text: `Rejected suggested project “${project?.title ?? projectId}”.`,
              },
            ],
          }
        : g
    ),
  };
}

/**
 * Owner creates a new project that serves this Outcome. Role and pattern get
 * placeholder values marked unconfirmed, exactly as for a connector-created
 * project, so the owner still chooses them.
 */
export function createProjectUnder(
  w: Workspace,
  outcomeId: string,
  title: string,
  stamp: string,
  id: string = newProjectId()
): { workspace: Workspace; id: string | null } {
  const outcome = goalById(w, outcomeId);
  const clean = title.trim().slice(0, 300);
  if (!outcome || outcome.level !== "outcome" || !clean)
    return { workspace: w, id: null };
  const project: Project = {
    id,
    title: clean,
    purpose: "",
    outcome: "",
    role: "direction",
    pattern: "sustained",
    status: "active",
    milestones: [],
    progress: [],
    schedule: emptyProjectSchedule(),
    compass: { ...emptyProjectCompass(), labelsConfirmed: false },
    createdAt: stamp,
    updatedAt: stamp,
  };
  const added = { ...w, projects: [...w.projects, project] };
  return {
    workspace: linkProject(added, outcomeId, project.id, stamp, true),
    id: project.id,
  };
}

function newProjectId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Imperatives on the map
// ---------------------------------------------------------------------------

export function imperativeMapLinks(imperative: Imperative): string[] {
  return imperative.mapLinks ?? [];
}

function mapImperative(
  w: Workspace,
  id: string,
  fn: (i: Imperative) => Imperative
): Workspace {
  return {
    ...w,
    imperatives: w.imperatives.map(i => (i.id === id ? fn(i) : i)),
  };
}

/** Owner links an Imperative directly to a Pillar, Value Goal or Outcome. */
export function linkImperativeToGoal(
  w: Workspace,
  imperativeId: string,
  goalId: string,
  stamp: string
): Workspace {
  const imp = w.imperatives.find(i => i.id === imperativeId);
  const goal = goalById(w, goalId);
  if (!imp || !goal || imperativeMapLinks(imp).includes(goalId)) return w;
  const linked = mapImperative(w, imperativeId, i => ({
    ...i,
    mapLinks: [...imperativeMapLinks(i), goalId],
    updatedAt: stamp,
    history: [
      ...i.history,
      {
        at: stamp,
        text: `Linked on the map to ${GOAL_LEVEL_LABEL[goal.level]} “${goal.title}”.`,
      },
    ],
  }));
  return noteOn(
    linked,
    goalId,
    stamp,
    `Imperative “${imp.title}” linked here.`
  );
}

export function unlinkImperativeFromGoal(
  w: Workspace,
  imperativeId: string,
  goalId: string,
  stamp: string
): Workspace {
  const imp = w.imperatives.find(i => i.id === imperativeId);
  if (!imp || !imperativeMapLinks(imp).includes(goalId)) return w;
  const goal = goalById(w, goalId);
  const unlinked = mapImperative(w, imperativeId, i => ({
    ...i,
    mapLinks: imperativeMapLinks(i).filter(id => id !== goalId),
    updatedAt: stamp,
    history: [
      ...i.history,
      {
        at: stamp,
        text: `Unlinked on the map from ${goal ? `${GOAL_LEVEL_LABEL[goal.level]} “${goal.title}”` : "a removed map item"}.`,
      },
    ],
  }));
  return goal
    ? noteOn(
        unlinked,
        goalId,
        stamp,
        `Imperative “${imp.title}” unlinked from here.`
      )
    : unlinked;
}

/** This item plus everything below it (active only), and the outcomes among them. */
export function descendants(w: Workspace, goalId: string): Goal[] {
  const out: Goal[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const g = goalById(w, id);
    if (!g) return;
    out.push(g);
    for (const k of childrenOf(w, id)) walk(k.id);
  };
  walk(goalId);
  return out;
}

export interface GoalImperatives {
  /** Linked directly to this item by the owner. */
  direct: Imperative[];
  /** Reaching this item through items below it or through linked work. */
  through: Imperative[];
}

export function imperativesForGoal(
  w: Workspace,
  goalId: string
): GoalImperatives {
  const active = w.imperatives.filter(i => i.status === "active");
  const direct = active.filter(i => imperativeMapLinks(i).includes(goalId));
  const below = descendants(w, goalId);
  const belowIds = new Set(below.filter(g => g.id !== goalId).map(g => g.id));
  const projectIds = new Set(
    below
      .filter(g => g.level === "outcome")
      .flatMap(g => g.projects.map(l => l.id))
  );
  const through = active.filter(
    i =>
      !direct.includes(i) &&
      (imperativeMapLinks(i).some(id => belowIds.has(id)) ||
        imperativeProjectIds(w, i).some(id => projectIds.has(id)))
  );
  return { direct, through };
}

/** Map items an Imperative reaches through its linked projects and tasks. */
export function goalsThroughWork(w: Workspace, imperative: Imperative): Goal[] {
  const seen = new Map<string, Goal>();
  for (const pid of imperativeProjectIds(w, imperative))
    for (const g of outcomesForProject(w, pid)) seen.set(g.id, g);
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Page summary
// ---------------------------------------------------------------------------

export function gapsFor(w: Workspace, id: string, today: string): MapGap[] {
  return mapGaps(w, today).filter(g => g.id === id);
}

export function spokenMapItem(w: Workspace, goal: Goal, today: string): string {
  const parts: string[] = [
    `${GOAL_LEVEL_LABEL[goal.level]}: ${goal.title}.${goal.status === "retired" ? " Retired." : ""}`,
  ];
  if (goal.description) parts.push(goal.description);
  const parents = goal.parents
    .map(l => ({ g: goalById(w, l.id), c: l.confirmed }))
    .filter(x => x.g);
  if (PARENT_LEVEL[goal.level])
    parts.push(
      parents.length
        ? `Sits under ${parents.map(x => `${x.g!.title}${x.c ? "" : " (suggested)"}`).join(", ")}.`
        : "It does not sit under anything yet."
    );
  if (goal.level === "outcome") {
    const projects = goal.projects
      .map(l => w.projects.find(p => p.id === l.id))
      .filter(Boolean) as Project[];
    parts.push(
      projects.length
        ? `Served by ${projects.map(p => p.title).join(", ")}.`
        : "No project serves it yet."
    );
  } else {
    const kids = childrenOf(w, goal.id);
    parts.push(
      kids.length
        ? `Holds ${kids.map(k => k.title).join(", ")}.`
        : `Nothing sits under it yet.`
    );
  }
  const imps = imperativesForGoal(w, goal.id);
  const all = [...imps.direct, ...imps.through];
  if (all.length)
    parts.push(`Imperatives here: ${all.map(i => i.title).join(", ")}.`);
  const gaps = gapsFor(w, goal.id, today);
  if (gaps.length) parts.push(`Gaps: ${gaps.map(g => g.text).join(" ")}`);
  return parts.join(" ");
}
