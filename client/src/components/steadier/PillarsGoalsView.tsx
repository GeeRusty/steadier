import {
  ChevronRight,
  Compass,
  Map as MapIcon,
  Square,
  Volume2,
} from "lucide-react";
import {
  GOAL_LEVELS,
  GOAL_LEVEL_LABEL,
  GOAL_LEVEL_PLURAL,
  type Goal,
} from "../../domain/goals";
import type { Workspace } from "../../domain/types";
import type { VoiceControls } from "../../hooks/useVoice";

interface Props {
  workspace: Workspace;
  onOpenGoal: (id: string) => void;
  onOpenMap: () => void;
  voice: VoiceControls;
}

function goalRelationships(goal: Goal, workspace: Workspace): string[] {
  const goals = workspace.goals ?? [];
  const relationships: string[] = [];
  if (goal.parents.length) {
    const parents = goal.parents
      .map(link => {
        const parent = goals.find(candidate => candidate.id === link.id);
        return parent
          ? `${parent.title}${link.confirmed ? "" : " (suggested)"}`
          : "";
      })
      .filter(Boolean);
    if (parents.length) relationships.push(`Under: ${parents.join(", ")}`);
  }
  if (goal.level === "outcome" && goal.projects.length) {
    const projects = goal.projects
      .map(
        link =>
          workspace.projects.find(project => project.id === link.id)?.title
      )
      .filter((title): title is string => Boolean(title));
    if (projects.length) relationships.push(`Projects: ${projects.join(", ")}`);
  }
  return relationships;
}

export default function PillarsGoalsView({
  workspace,
  onOpenGoal,
  onOpenMap,
  voice,
}: Props) {
  const goals = workspace.goals ?? [];
  const sections = GOAL_LEVELS.map(level => ({
    level,
    goals: goals
      .filter(goal => goal.level === level)
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title)),
  }));
  const spokenSummary = sections
    .map(({ level, goals: items }) => {
      const active = items.filter(goal => goal.status === "active").length;
      const retired = items.length - active;
      const titles = items.map(goal => {
        const relationships = goalRelationships(goal, workspace);
        return `${goal.title}${relationships.length ? `, ${relationships.join(". ")}` : ""}.`;
      });
      return `${GOAL_LEVEL_PLURAL[level]}: ${active} active, ${retired} retired. ${titles.join(" ")}`;
    })
    .join(" ");

  return (
    <section
      className="map-page compass-directory"
      aria-labelledby="compass-directory-title"
    >
      <div className="map-page-top">
        <h1 id="compass-directory-title" className="map-page-title">
          <Compass size={21} aria-hidden="true" /> Pillars &amp; Goals
        </h1>
        <button
          className="text-button"
          onClick={() =>
            voice.speaking ? voice.stopSpeaking() : voice.read(spokenSummary)
          }
          aria-label={
            voice.speaking ? "Stop reading" : "Read Pillars and Goals aloud"
          }
        >
          {voice.speaking ? <Square size={15} /> : <Volume2 size={15} />}{" "}
          {voice.speaking ? "Stop" : "Read aloud"}
        </button>
      </div>

      <p className="small muted compass-directory-intro">
        Open any record to edit its title, details, status and relationships.
        Nothing changes until you tap Save. Edit the two Pillar titles to
        exactly “Bec” and “Friends &amp; Family” if those are the names you
        want; IDs and links stay with each record unless you change them.
      </p>
      <div className="choice-row">
        <button className="button secondary small-button" onClick={onOpenMap}>
          <MapIcon size={15} /> Open Compass map
        </button>
      </div>

      {sections.map(({ level, goals: items }) => {
        const active = items.filter(goal => goal.status === "active").length;
        const retired = items.length - active;
        return (
          <section
            key={level}
            className="map-page-section"
            aria-labelledby={`directory-${level}`}
          >
            <h2 id={`directory-${level}`}>
              {GOAL_LEVEL_PLURAL[level]}
              <span className="small muted">
                {active} active · {retired} retired
              </span>
            </h2>
            {items.length === 0 ? (
              <p className="small muted">
                No {GOAL_LEVEL_PLURAL[level].toLowerCase()} yet.
              </p>
            ) : (
              <ul className="map-page-rows">
                {items.map(goal => {
                  const relationships = goalRelationships(goal, workspace);
                  return (
                    <li
                      key={goal.id}
                      className={
                        goal.status === "retired"
                          ? "directory-goal-retired"
                          : ""
                      }
                    >
                      <button
                        className="map-row-open"
                        onClick={() => onOpenGoal(goal.id)}
                        aria-label={`Edit ${GOAL_LEVEL_LABEL[level]} ${goal.title}`}
                      >
                        <strong>{goal.title}</strong>
                        <span
                          className={`compass-directory-status ${goal.status}`}
                        >
                          {goal.status === "active" ? "Active" : "Retired"}
                        </span>
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                      {relationships.map(relationship => (
                        <p
                          className="small muted compass-directory-item-meta"
                          key={relationship}
                        >
                          {relationship}
                        </p>
                      ))}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </section>
  );
}
