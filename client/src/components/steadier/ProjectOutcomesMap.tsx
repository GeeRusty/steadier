import type { Project, Workspace } from "../../domain/types";
import TimingShapeMark from "./TimingShapeMark";

interface Props {
  workspace: Workspace;
  onOpenProject: (project: Project) => void;
  onOpenGoal?: (id: string) => void;
  readOnly: boolean;
}

export default function ProjectOutcomesMap({
  workspace,
  onOpenProject,
  onOpenGoal,
  readOnly,
}: Props) {
  const projects = workspace.projects ?? [];
  const projectsById = new Map(projects.map(project => [project.id, project]));
  const outcomes = (workspace.goals ?? []).filter(
    goal => goal.level === "outcome" && goal.status === "active"
  );
  const linkedProjectIds = new Set<string>();
  const rows = outcomes.map(outcome => ({
    outcome,
    links: outcome.projects.flatMap(link => {
      const project = projectsById.get(link.id);
      if (!project) return [];
      linkedProjectIds.add(project.id);
      return [{ project, confirmed: link.confirmed }];
    }),
  }));
  const unlinkedProjects = projects.filter(
    project => !linkedProjectIds.has(project.id)
  );

  const projectNode = (
    project: Project,
    linkState: "linked" | "suggested" | "unlinked",
    key: string,
    outcomeId?: string
  ) => (
    <article
      className={`project-outcome-map-project${linkState === "suggested" ? " is-suggested" : ""}`}
      key={key}
    >
      <div className="project-outcome-map-project-labels">
        <span
          className={`project-outcome-link-label${linkState === "suggested" ? " is-suggested" : ""}`}
        >
          {linkState === "linked"
            ? "Linked"
            : linkState === "suggested"
              ? "Suggested"
              : "No active outcome link"}
        </span>
        <span className="small muted">
          {project.status === "achieved" ? "Achieved" : "Active"}
        </span>
      </div>
      <button
        type="button"
        className="project-outcome-map-project-title"
        onClick={() => onOpenProject(project)}
        disabled={readOnly}
      >
        <strong>
          <TimingShapeMark project={project} /> {project.title}
        </strong>
        <span className="small muted">
          {project.outcome ||
            project.purpose ||
            "No project outcome written yet."}
        </span>
      </button>
      {linkState === "suggested" && outcomeId && onOpenGoal && (
        <button
          type="button"
          className="text-button project-outcome-map-review"
          onClick={() => onOpenGoal(outcomeId)}
        >
          Review suggested link
        </button>
      )}
    </article>
  );

  return (
    <section className="project-outcomes-map" aria-label="Project Outcomes map">
      <p className="project-outcomes-map-note small muted">
        Each row connects a Goal Outcome to its projects. A project can appear
        under more than one outcome. Dashed Suggested links remain unconfirmed;
        open the outcome to review them.
      </p>

      {!outcomes.length && (
        <div className="project-outcome-map-empty">
          <strong>No active Goal Outcomes yet.</strong>
          <p className="small muted">
            Add or reactivate an outcome from Compass map to see its project
            connections here.
          </p>
        </div>
      )}

      {rows.map(({ outcome, links }) => (
        <section className="project-outcome-map-row" key={outcome.id}>
          <button
            type="button"
            className="project-outcome-map-goal"
            onClick={() => onOpenGoal?.(outcome.id)}
            disabled={!onOpenGoal}
          >
            <span className="eyebrow">GOAL OUTCOME</span>
            <strong>{outcome.title}</strong>
            <span className="small muted">
              {outcome.description || "No description written yet."}
            </span>
            <span className="small muted">
              {links.length} linked project{links.length === 1 ? "" : "s"}
            </span>
          </button>
          <div className="project-outcome-map-connector" aria-hidden="true" />
          <div className="project-outcome-map-projects">
            {links.length ? (
              links.map(({ project, confirmed }) =>
                projectNode(
                  project,
                  confirmed ? "linked" : "suggested",
                  `${outcome.id}:${project.id}`,
                  outcome.id
                )
              )
            ) : (
              <div className="project-outcome-map-empty small muted">
                No projects linked yet.
              </div>
            )}
          </div>
        </section>
      ))}

      {!!unlinkedProjects.length && (
        <section className="project-outcome-map-row project-outcome-map-unlinked">
          <div className="project-outcome-map-goal project-outcome-map-unlinked-label">
            <span className="eyebrow">NOT LINKED</span>
            <strong>Projects without an active Goal Outcome</strong>
            <span className="small muted">
              These projects stay available in List view and can be connected
              from Compass map.
            </span>
          </div>
          <div className="project-outcome-map-connector" aria-hidden="true" />
          <div className="project-outcome-map-projects">
            {unlinkedProjects.map(project =>
              projectNode(project, "unlinked", `unlinked:${project.id}`)
            )}
          </div>
        </section>
      )}

      {!projects.length && outcomes.length > 0 && (
        <p className="project-outcome-map-empty small muted">
          There are no projects yet. Use Add project above when you are ready.
        </p>
      )}
    </section>
  );
}
