import React from "react";
import { Activity, Volume2 } from "lucide-react";
import type { Workspace } from "../../domain/types";
import {
  compassStatusGroups,
  type CompassStatusGroup,
  type CompassStatusItem,
} from "../../domain/compassStatusView";
import { statusMarkColorHex } from "../../domain/statusMarkColor";
import { useStatusMarkAppearance, useStatusMarkData } from "./TaskStates";
import TimingShapeMark, {
  TimingShapeIcon,
  useStatusMarkClock,
} from "./TimingShapeMark";

const STATUS_SHAPE_KEY = [
  {
    shape: "ahead",
    heading: "Up arrow — Ahead",
    description: "Progress or completion was recorded before a dated commitment.",
  },
  {
    shape: "on-track",
    heading: "Line — On track",
    description: "A booked commitment has not been missed; undated items use the movement rule below.",
  },
  {
    shape: "behind",
    heading: "Down arrow — Behind",
    description:
      "A dated commitment passed, a booked block ended while still open, or the schedule was moved 3 or more times.",
  },
] as const;

const STATUS_SHAPE_NOTE =
  "Without a booked timing commitment, 0–6 days since recorded movement is on track; 7 or more days is behind. Date and time checks use Adelaide-local time.";

const STATUS_COLOR_KEY = [
  {
    color: "green",
    label:
      "Green: active Imperative, or Project and linked Goal Outcome share a direct active Imperative.",
  },
  {
    color: "red",
    label:
      "Red: Project has no active confirmed Goal Outcome, or is linked to an active Imperative that does not also link its Goal Outcome.",
  },
  {
    color: "amber",
    label:
      "Amber: Project has no direct active-Imperative link, or Task has no available Project or owner-confirmed catch-all.",
  },
  {
    color: "blue",
    label: "Blue: Task with owner-confirmed Life Admin catch-all.",
  },
  {
    color: "purple",
    label: "Purple: Task with owner-confirmed Erosion Guard catch-all.",
  },
] as const;

const STATUS_GREY_NOTE =
  "Grey overrides colour for a Project with no purpose, a review date due or overdue, or 14 or more quiet days; Someday and parked items stay uncoloured.";

interface Props {
  workspace: Workspace;
  onOpenProject: (id: string) => void;
  onOpenImperative: (id: string) => void;
  onRead: (text: string) => void;
}

export function statusMarkLegendReadAloudText(): string {
  const shapeKey = `Shape key. ${STATUS_SHAPE_KEY.map(
    item => `${item.heading}: ${item.description}`
  ).join(" ")} ${STATUS_SHAPE_NOTE}`;
  const colorKey = `Colour key. ${STATUS_COLOR_KEY.map(item => item.label).join(
    " "
  )} ${STATUS_GREY_NOTE}`;
  return `${shapeKey} ${colorKey}`;
}

function spokenGroups(groups: CompassStatusGroup[]): string {
  const legend = statusMarkLegendReadAloudText();
  const total = groups.reduce((count, group) => count + group.items.length, 0);
  if (!total)
    return `${legend} There are no active Imperatives or Projects in the Compass yet.`;
  return `${legend} ${groups
    .filter(group => group.items.length)
    .map(group => {
      const names = group.items
        .map(
          item =>
            `${item.kind === "project" ? "Project" : "Imperative"} ${item.item.title}`
        )
        .join(", ");
      return `${group.title}: ${names}.`;
    })
    .join(" ")}`;
}

function StatusRow({
  entry,
  onOpenProject,
  onOpenImperative,
}: {
  entry: CompassStatusItem;
  onOpenProject: (id: string) => void;
  onOpenImperative: (id: string) => void;
}) {
  const isProject = entry.kind === "project";
  return (
    <li>
      <button
        type="button"
        className="compass-status-row"
        aria-label={`Open ${isProject ? "active Project" : "active Imperative"} ${entry.item.title}`}
        onClick={() =>
          isProject
            ? onOpenProject(entry.item.id)
            : onOpenImperative(entry.item.id)
        }
      >
        <TimingShapeMark
          {...(isProject
            ? { project: entry.item }
            : { imperative: entry.item })}
        />
        <span className="compass-status-row-copy">
          <strong>{entry.item.title}</strong>
          <span className="small muted">
            {isProject ? "Active Project" : "Active Imperative"}
          </span>
        </span>
        <span className="compass-status-row-action" aria-hidden="true">
          Open
        </span>
      </button>
    </li>
  );
}

export default function CompassStatusView({
  workspace,
  onOpenProject,
  onOpenImperative,
  onRead,
}: Props) {
  const markData = useStatusMarkData();
  const clock = useStatusMarkClock();
  const appearance = useStatusMarkAppearance();
  if (!markData) return null;

  const groups = compassStatusGroups(workspace, markData, clock);
  const total = groups.reduce((count, group) => count + group.items.length, 0);

  return (
    <section
      className="compass-status-view"
      aria-labelledby="compass-status-title"
    >
      <div className="calendar-toolbar">
        <h1 id="compass-status-title">
          <Activity size={21} aria-hidden="true" /> Compass view
        </h1>
        <button
          type="button"
          className="text-button"
          onClick={() => onRead(spokenGroups(groups))}
        >
          <Volume2 size={15} aria-hidden="true" /> Read aloud
        </button>
      </div>
      <p className="small muted">
        Grey chips show only what's off normal. Green bar: serves an
        Imperative. Broken-link icon: missing its Goal Outcome or Imperative
        link.
      </p>
      {total === 0 && (
        <div className="empty-state" role="status">
          <Activity size={28} aria-hidden="true" />
          <h2>No active Imperatives or Projects</h2>
          <p>Active items will appear here with their current status marks.</p>
        </div>
      )}
      <div className="compass-status-groups">
        {groups.map(group => (
          <section
            key={group.id}
            className={`compass-status-group compass-status-group-${group.id}`}
            aria-labelledby={`compass-status-${group.id}`}
            data-sort-group={group.id}
          >
            <h2 id={`compass-status-${group.id}`}>
              {group.title}{" "}
              <span className="small muted">({group.items.length})</span>
            </h2>
            {group.items.length ? (
              <ul className="compass-status-list">
                {group.items.map(entry => (
                  <StatusRow
                    key={`${entry.kind}-${entry.item.id}`}
                    entry={entry}
                    onOpenProject={onOpenProject}
                    onOpenImperative={onOpenImperative}
                  />
                ))}
              </ul>
            ) : (
              <p className="small muted compass-status-empty">
                No items in this group.
              </p>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}
