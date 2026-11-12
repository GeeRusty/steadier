import React, { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { DECISION_LABEL, type Imperative } from "../../domain/compass";
import {
  confirmProjectImperatives,
  heldLinkItems,
  holdItem,
  imperativesWithoutWork,
  isHeld,
  linkProjectToImperative,
  linkTaskToImperative,
  makeProjectSupport,
  projectsWithoutImperative,
  STEP_DOWN_OUTCOMES,
  stepDownImperative,
  unlinkedImperatives,
  unlinkedProjects,
  type StepDownOutcome,
} from "../../domain/linkCheck";
import { isOpenTask } from "../../domain/taskCard";
import type { Project, Workspace } from "../../domain/types";
import { adelaideTimestamp } from "../../../../shared/time";
import { adelaideClock } from "../../domain/time";

interface Props {
  workspace: Workspace;
  readOnly: boolean;
  onMutate: (fn: (w: Workspace) => Workspace) => boolean | void;
  /** Weekly Review step: show the Not yet items that must be decided again. */
  reviewMode?: boolean;
}

type Open = { id: string; panel: "link" | "step" } | null;

/**
 * Link check: Imperatives with no work, and Imperative-row projects with no
 * Imperative. Every choice is one owner tap; nothing links itself.
 */
export default function LinkCheckView({ workspace, readOnly, onMutate, reviewMode = false }: Props) {
  const [open, setOpen] = useState<Open>(null);
  const [message, setMessage] = useState("");
  const imperatives = reviewMode ? heldLinkItems(workspace).imperatives : unlinkedImperatives(workspace);
  const projects = reviewMode ? heldLinkItems(workspace).projects : unlinkedProjects(workspace);
  const activeImperatives = workspace.imperatives.filter(i => i.status === "active");
  const activeProjects = workspace.projects.filter(p => p.status === "active");
  const openTasks = workspace.tasks.filter(isOpenTask);
  const heldCount = reviewMode
    ? 0
    : imperativesWithoutWork(workspace).filter(i => isHeld(workspace, "imperative", i.id)).length +
      projectsWithoutImperative(workspace).filter(p => isHeld(workspace, "project", p.id)).length;

  const run = (fn: (w: Workspace, stamp: string, day: string) => Workspace, ok: string) => {
    if (readOnly) return;
    const stamp = adelaideTimestamp();
    const day = adelaideClock().date;
    const saved = onMutate(w => fn(w, stamp, day)) !== false;
    setMessage(saved ? ok : "That was not saved. Check sync and try again.");
    if (saved) setOpen(null);
  };
  const toggle = (id: string, panel: "link" | "step") =>
    setOpen(o => (o && o.id === id && o.panel === panel ? null : { id, panel }));
  const notYetLabel = reviewMode ? "Not yet again" : "Not yet";

  const imperativeCard = (imp: Imperative) => {
    const linking = open?.id === imp.id && open.panel === "link";
    const stepping = open?.id === imp.id && open.panel === "step";
    return (
      <li key={imp.id} className="idea-card link-card">
        <strong>{imp.title}</strong>
        {imp.reason.trim() && <p className="small muted">{imp.reason}</p>}
        <p className="small muted">No open task or active project is linked.</p>
        <div className="idea-actions">
          <button type="button" className={`card-btn card-btn--main${linking ? " is-picked" : ""}`} disabled={readOnly} onClick={() => toggle(imp.id, "link")}>
            <Link2 size={18} aria-hidden="true" /> Link work
          </button>
          <button
            type="button"
            className="card-btn"
            disabled={readOnly}
            onClick={() => run((w, stamp) => holdItem(w, "imperative", imp.id, stamp), `“${imp.title}” held until your next Weekly Review.`)}
          >
            {notYetLabel}
          </button>
          <button type="button" className={`card-btn card-btn--quiet${stepping ? " is-picked" : ""}`} disabled={readOnly} onClick={() => toggle(imp.id, "step")}>
            Step down
          </button>
        </div>
        {linking && (
          <div className="link-pick" role="group" aria-label={`Link work to ${imp.title}`}>
            <label className="field">
              A project
              <select
                className="card-select"
                value=""
                disabled={readOnly || activeProjects.length === 0}
                onChange={e => {
                  const id = e.target.value;
                  const project = workspace.projects.find(p => p.id === id);
                  if (id) run((w, stamp) => linkProjectToImperative(w, id, imp.id, stamp), `“${project?.title}” now serves “${imp.title}”.`);
                }}
              >
                <option value="">{activeProjects.length ? "Pick a project…" : "No active projects"}</option>
                {activeProjects.map(p => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Or a task
              <select
                className="card-select"
                value=""
                disabled={readOnly || openTasks.length === 0}
                onChange={e => {
                  const id = e.target.value;
                  const task = workspace.tasks.find(t => t.id === id);
                  if (id) run((w, stamp) => linkTaskToImperative(w, id, imp.id, stamp), `“${task?.title}” now serves “${imp.title}”.`);
                }}
              >
                <option value="">{openTasks.length ? "Pick a task…" : "No open tasks"}</option>
                {openTasks.map(t => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            </label>
            <button type="button" className="text-button" onClick={() => setOpen(null)}>Cancel</button>
          </div>
        )}
        {stepping && (
          <div className="link-pick" role="group" aria-label={`Step down ${imp.title}`}>
            <p className="small muted">Your decision, saved as yours. Retire can be undone on the Imperatives page.</p>
            <div className="idea-actions">
              {STEP_DOWN_OUTCOMES.map(outcome => (
                <button
                  key={outcome}
                  type="button"
                  className="card-btn"
                  disabled={readOnly}
                  onClick={() =>
                    run(
                      (w, stamp, day) => stepDownImperative(w, imp.id, outcome as StepDownOutcome, stamp, day),
                      outcome === "retire" ? `“${imp.title}” retired.` : `“${imp.title}”: ${DECISION_LABEL[outcome]}. Asked again at your next review.`
                    )
                  }
                >
                  {DECISION_LABEL[outcome]}
                </button>
              ))}
              <button type="button" className="text-button" onClick={() => setOpen(null)}>Cancel</button>
            </div>
          </div>
        )}
      </li>
    );
  };

  const projectCard = (project: Project) => {
    const linking = open?.id === project.id && open.panel === "link";
    const suggested = project.compass.imperativesSuggested
      ? project.compass.imperativeIds
          .map(id => activeImperatives.find(i => i.id === id))
          .filter((i): i is Imperative => Boolean(i))
      : [];
    return (
      <li key={project.id} className="idea-card link-card">
        <strong>{project.title}</strong>
        {project.purpose.trim() && <p className="small muted">{project.purpose}</p>}
        {suggested.length > 0 && (
          <p className="suggestion-line small">
            <span className="suggested-chip">Suggested</span> {suggested.map(i => i.title).join(", ")}
            <button
              type="button"
              className="text-button"
              disabled={readOnly}
              onClick={() =>
                run(
                  (w, stamp) => ({ ...w, projects: w.projects.map(p => (p.id === project.id ? confirmProjectImperatives(p, stamp) : p)) }),
                  `Confirmed: “${project.title}” serves ${suggested.map(i => `“${i.title}”`).join(", ")}.`
                )
              }
            >
              Confirm
            </button>
          </p>
        )}
        <div className="idea-actions">
          <button type="button" className={`card-btn card-btn--main${linking ? " is-picked" : ""}`} disabled={readOnly || activeImperatives.length === 0} onClick={() => toggle(project.id, "link")}>
            <Link2 size={18} aria-hidden="true" /> Link to an Imperative
          </button>
          <button
            type="button"
            className="card-btn"
            disabled={readOnly}
            onClick={() => run((w, stamp) => makeProjectSupport(w, project.id, stamp), `“${project.title}” is now Support.`)}
          >
            Make it Support
          </button>
          <button
            type="button"
            className="card-btn card-btn--quiet"
            disabled={readOnly}
            onClick={() => run((w, stamp) => holdItem(w, "project", project.id, stamp), `“${project.title}” held until your next Weekly Review.`)}
          >
            {notYetLabel}
          </button>
        </div>
        {linking && (
          <div className="link-pick" role="group" aria-label={`Link ${project.title} to an Imperative`}>
            <div className="idea-actions">
              {activeImperatives.map(i => (
                <button
                  key={i.id}
                  type="button"
                  className="card-btn"
                  disabled={readOnly}
                  onClick={() => run((w, stamp) => linkProjectToImperative(w, project.id, i.id, stamp), `“${project.title}” now serves “${i.title}”.`)}
                >
                  {i.title}
                </button>
              ))}
              <button type="button" className="text-button" onClick={() => setOpen(null)}>Cancel</button>
            </div>
          </div>
        )}
      </li>
    );
  };

  const nothing = imperatives.length === 0 && projects.length === 0;

  return (
    <section className="ideas-shelf link-check" aria-labelledby="link-check-title">
      {reviewMode ? (
        <h3 id="link-check-title">Link check: Not yet ({imperatives.length + projects.length})</h3>
      ) : (
        <h1 id="link-check-title" className="page-purpose-heading"><Link2 size={22} aria-hidden="true" /> Link check</h1>
      )}
      <p className="small muted">
        {reviewMode
          ? "These were held with Not yet. Decide each again: link it, change it, or hold it one more week. Anything left expires when you save the review and comes back to Link check."
          : "Only links you made count. Work means open tasks and active projects. Not yet holds an item until your next Weekly Review."}
      </p>
      {nothing ? (
        <p className="ideas-empty">
          <Check size={18} aria-hidden="true" /> {reviewMode ? "Nothing was held with Not yet." : "Everything is linked."}
          {!reviewMode && heldCount > 0 ? ` ${heldCount} held with Not yet until your next review.` : ""}
        </p>
      ) : (
        <>
          {imperatives.length > 0 && (
            <>
              <h2 className="lbl">Imperatives with no work ({imperatives.length})</h2>
              <ul className="ideas-list">{imperatives.map(imperativeCard)}</ul>
            </>
          )}
          {projects.length > 0 && (
            <>
              <h2 className="lbl">Imperative projects with no Imperative ({projects.length})</h2>
              <ul className="ideas-list">{projects.map(projectCard)}</ul>
            </>
          )}
          {!reviewMode && heldCount > 0 && (
            <p className="small muted">{heldCount} more held with Not yet until your next review.</p>
          )}
        </>
      )}
      {message && <p className="small muted" role="status">{message}</p>}
    </section>
  );
}
