import type { Imperative } from "./compass";
import type { Goal } from "./goals";
import type { Project, Task, Workspace } from "./types";
import type { Appearance } from "./appearance";

export type StatusMarkColor = "green" | "red" | "amber" | "blue" | "purple";

export interface StatusMarkColorResult {
  color: StatusMarkColor | null;
  reason: string;
}

/** Minimal read-only relationships required by Stage 2; excludes private collections. */
export interface StatusMarkData {
  projects: Project[];
  goals: Goal[];
  imperatives: Imperative[];
  /** Latest completed Weekly Review date, used only for live colour fading. */
  lastWeeklyReviewDate?: string | null;
  /** Precomputed once per workspace revision so repeated marks stay inexpensive. */
  projectColors?: ReadonlyMap<string, StatusMarkColorResult>;
}

type StatusMarkSource = Pick<Workspace, "projects" | "goals" | "imperatives">;

export const STATUS_MARK_COLOR_NAME: Record<StatusMarkColor, string> = {
  green: "Green",
  red: "Red",
  amber: "Amber",
  blue: "Blue",
  purple: "Purple",
};

export const STATUS_MARK_COLOR_HEX_LIGHT: Record<StatusMarkColor, string> = {
  green: "#009F55",
  red: "#EE0033",
  amber: "#B87900",
  blue: "#087DE0",
  purple: "#8B2DC9",
};

export const STATUS_MARK_COLOR_HEX_DARK: Record<StatusMarkColor, string> = {
  green: "#27E39B",
  red: "#FF6178",
  amber: "#FFD166",
  blue: "#5CC8FF",
  purple: "#D09BFF",
};

/** Backward-compatible light palette; prefer statusMarkColorHex in UI. */
export const STATUS_MARK_COLOR_HEX = STATUS_MARK_COLOR_HEX_LIGHT;

export function statusMarkColorHex(
  color: StatusMarkColor,
  appearance: Appearance = "light"
): string {
  return (appearance === "dark" ? STATUS_MARK_COLOR_HEX_DARK : STATUS_MARK_COLOR_HEX_LIGHT)[color];
}

const UNCOLOURED_SOMEDAY: StatusMarkColorResult = {
  color: null,
  reason: "Someday is deliberately uncoloured.",
};

function projectResult(
  project: Project,
  linkedOutcomeIds: Set<string>,
  outcomeImperativeIds: Map<string, Set<string>>,
  activeImperativeIds: Set<string>
): StatusMarkColorResult {
  if (linkedOutcomeIds.size === 0) {
    return {
      color: "red",
      reason: "The Project has no active confirmed Goal Outcome.",
    };
  }

  const projectImperativeIds = (project.compass?.imperativeIds ?? []).filter(
    id => activeImperativeIds.has(id)
  );
  const sameImperativeAlignsProjectAndOutcome = projectImperativeIds.some(id =>
    [...linkedOutcomeIds].some(outcomeId =>
      outcomeImperativeIds.get(outcomeId)?.has(id)
    )
  );

  if (sameImperativeAlignsProjectAndOutcome) {
    return {
      color: "green",
      reason:
        "The same active Imperative directly links the Project and a linked Goal Outcome.",
    };
  }

  if (projectImperativeIds.length > 0) {
    return {
      color: "red",
      reason:
        "The Project is directly linked to an active Imperative, but no same active Imperative also directly links a linked Goal Outcome.",
    };
  }

  return {
    color: "amber",
    reason: "The Project is not directly linked to an active Imperative.",
  };
}

function buildIndexes(data: StatusMarkSource) {
  const activeImperatives = data.imperatives.filter(
    imperative => imperative.status === "active"
  );
  const activeImperativeIds = new Set(activeImperatives.map(item => item.id));
  const outcomeImperativeIds = new Map<string, Set<string>>();
  for (const imperative of activeImperatives) {
    for (const linkedId of imperative.mapLinks ?? []) {
      const ids = outcomeImperativeIds.get(linkedId) ?? new Set<string>();
      ids.add(imperative.id);
      outcomeImperativeIds.set(linkedId, ids);
    }
  }

  const linkedOutcomeIdsByProject = new Map<string, Set<string>>();
  for (const goal of data.goals) {
    if (goal.level !== "outcome" || goal.status !== "active") continue;
    for (const link of goal.projects ?? []) {
      if (!link.confirmed) continue;
      const outcomes =
        linkedOutcomeIdsByProject.get(link.id) ?? new Set<string>();
      outcomes.add(goal.id);
      linkedOutcomeIdsByProject.set(link.id, outcomes);
    }
  }
  return {
    activeImperativeIds,
    outcomeImperativeIds,
    linkedOutcomeIdsByProject,
  };
}

export function createStatusMarkData(source: StatusMarkSource): StatusMarkData {
  const data: StatusMarkData = {
    projects: source.projects,
    goals: source.goals,
    imperatives: source.imperatives,
  };
  const indexes = buildIndexes(source);
  const projectColors = new Map<string, StatusMarkColorResult>();
  for (const project of source.projects) {
    projectColors.set(
      project.id,
      projectResult(
        project,
        indexes.linkedOutcomeIdsByProject.get(project.id) ?? new Set(),
        indexes.outcomeImperativeIds,
        indexes.activeImperativeIds
      )
    );
  }
  return { ...data, projectColors };
}

function deriveProjectColor(
  project: Project,
  data: StatusMarkData
): StatusMarkColorResult {
  const indexes = buildIndexes(data);
  return projectResult(
    project,
    indexes.linkedOutcomeIdsByProject.get(project.id) ?? new Set(),
    indexes.outcomeImperativeIds,
    indexes.activeImperativeIds
  );
}

export function statusMarkColorForProject(
  project: Project,
  data: StatusMarkData
): StatusMarkColorResult {
  return (
    data.projectColors?.get(project.id) ?? deriveProjectColor(project, data)
  );
}

export function statusMarkColorForTask(
  task: Task,
  data: StatusMarkData
): StatusMarkColorResult {
  if (task.state === "someday") return UNCOLOURED_SOMEDAY;

  // A Project takes precedence: tasks inherit their Project's colour.
  if (task.projectId) {
    const cachedProjectColor = data.projectColors?.get(task.projectId);
    if (cachedProjectColor) return cachedProjectColor;
    const project = data.projects.find(item => item.id === task.projectId);
    return project
      ? statusMarkColorForProject(project, data)
      : {
          color: "amber",
          reason:
            "The linked Project is unavailable; no active alignment is inferred.",
        };
  }

  if (
    task.compass?.catchAllConfirmed &&
    task.compass.catchAll === "life-admin"
  ) {
    return {
      color: "blue",
      reason: "Owner-confirmed Life Admin catch-all.",
    };
  }
  if (
    task.compass?.catchAllConfirmed &&
    task.compass.catchAll === "erosion-guard"
  ) {
    return {
      color: "purple",
      reason: "Owner-confirmed Erosion Guard catch-all.",
    };
  }

  return {
    color: "amber",
    reason: "The task has no Project or owner-confirmed catch-all colour.",
  };
}

export function statusMarkColorForImperative(
  imperative: Imperative
): StatusMarkColorResult {
  return imperative.status === "active"
    ? {
        color: "green",
        reason: "Active Imperative; green is its alignment-anchor colour.",
      }
    : {
        color: null,
        reason: "Retired Imperatives are uncoloured.",
      };
}
