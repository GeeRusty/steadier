import type { Imperative } from "./compass";
import type { Project, Workspace } from "./types";
import { adelaideClock } from "./time";
import {
  statusMarkColorForImperative,
  statusMarkColorForProject,
  type StatusMarkColor,
  type StatusMarkData,
} from "./statusMarkColor";
import {
  statusMarkStalenessForImperative,
  statusMarkStalenessForProject,
  type StatusMarkStaleness,
} from "./statusMarkStaleness";
import type { TimingClock } from "./timingShape";

export type CompassStatusGroupId = "red" | "grey" | "rest";

export interface CompassStatusGroup {
  id: CompassStatusGroupId;
  title: string;
  items: CompassStatusItem[];
}

export type CompassStatusItem =
  | {
      kind: "project";
      item: Project;
      color: StatusMarkColor | null;
      grey: boolean;
      staleness: StatusMarkStaleness;
      group: CompassStatusGroupId;
    }
  | {
      kind: "imperative";
      item: Imperative;
      color: StatusMarkColor | null;
      grey: boolean;
      staleness: StatusMarkStaleness;
      group: CompassStatusGroupId;
    };

export const COMPASS_STATUS_GROUPS: ReadonlyArray<
  Pick<CompassStatusGroup, "id" | "title">
> = [
  { id: "red", title: "Red — unaligned Projects" },
  { id: "grey", title: "Grey — stale or due" },
  { id: "rest", title: "Other active marks" },
];

function groupFor(color: StatusMarkColor | null, grey: boolean) {
  // Grey is the visible override. Fresh red marks remain first; a red mark
  // overridden to grey belongs in the grey group, matching what is shown.
  if (color === "red" && !grey) return "red" as const;
  if (grey) return "grey" as const;
  return "rest" as const;
}

/**
 * Read-only Stage 4 projection. Active Imperatives appear before active
 * Projects inside each group; each collection otherwise keeps workspace order.
 */
export function compassStatusGroups(
  workspace: Pick<Workspace, "imperatives" | "projects">,
  markData: StatusMarkData,
  clock: TimingClock = adelaideClock()
): CompassStatusGroup[] {
  const items: CompassStatusItem[] = [];

  for (const imperative of workspace.imperatives) {
    if (imperative.status !== "active") continue;
    const color = statusMarkColorForImperative(imperative).color;
    const staleness = statusMarkStalenessForImperative(
      imperative,
      markData.lastWeeklyReviewDate ?? null,
      clock
    );
    items.push({
      kind: "imperative",
      item: imperative,
      color,
      grey: staleness.grey,
      staleness,
      group: groupFor(color, staleness.grey),
    });
  }

  for (const project of workspace.projects) {
    if (project.status !== "active") continue;
    const color = statusMarkColorForProject(project, markData).color;
    const staleness = statusMarkStalenessForProject(
      project,
      markData.lastWeeklyReviewDate ?? null,
      clock
    );
    items.push({
      kind: "project",
      item: project,
      color,
      grey: staleness.grey,
      staleness,
      group: groupFor(color, staleness.grey),
    });
  }

  return COMPASS_STATUS_GROUPS.map(group => ({
    ...group,
    items: items.filter(item => item.group === group.id),
  }));
}
