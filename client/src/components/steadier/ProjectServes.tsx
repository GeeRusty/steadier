import { useState } from "react";
import { AlertTriangle, Check, ChevronRight, X } from "lucide-react";
import type { Project, Workspace } from "../../domain/types";
import { chainsForProject, describeWhy, goalsAt } from "../../domain/goals";
import {
  addProjectLink,
  confirmProjectLink,
  projectLinkStatus,
  removeProjectLink,
} from "../../domain/mapPages";
import { adelaideTimestamp } from "../../../../shared/time";
import WhyLine from "./WhyLine";

/**
 * On a project card: which Goal Outcomes this project serves. Links are stored
 * on the Outcome (as before), so this edits the same link as the Outcome page.
 */
export default function ProjectServes({
  workspace,
  project,
  onMutate,
  onOpenGoal,
  readOnly,
}: {
  workspace: Workspace;
  project: Project;
  onMutate: (fn: (w: Workspace) => Workspace) => boolean | void;
  onOpenGoal?: (id: string) => void;
  readOnly: boolean;
}) {
  const [pick, setPick] = useState("");
  const [message, setMessage] = useState("");
  const outcomes = (workspace.goals ?? []).filter(
    g =>
      g.level === "outcome" &&
      g.status === "active" &&
      g.projects.some(l => l.id === project.id)
  );
  const candidates = goalsAt(workspace, "outcome").filter(
    g => projectLinkStatus(workspace, g.id, project.id) === "none"
  );
  const act = (fn: (w: Workspace) => Workspace, done: string) => {
    if (readOnly) return false;
    let changed = false;
    const ok = onMutate(w => {
      const next = fn(w);
      changed = next !== w;
      return next;
    });
    setMessage(
      ok === false
        ? "That change was not saved. Check sync and try again."
        : changed
          ? done
          : "Nothing changed."
    );
    return ok !== false && changed;
  };
  const stamp = () => adelaideTimestamp();
  const hasMap = (workspace.goals ?? []).length > 0;
  if (!hasMap) return null;

  return (
    <div className="life-project-section project-serves">
      <div className="eyebrow">SERVES OUTCOMES</div>
      {project.status === "active" && outcomes.length === 0 && (
        <p className="map-page-gaps small" role="status">
          <AlertTriangle size={15} aria-hidden="true" /> This project is not
          linked to a Goal Outcome, so it sits outside the map.
        </p>
      )}
      <ul className="map-page-rows">
        {outcomes.map(g => {
          const confirmed = g.projects.find(
            l => l.id === project.id
          )!.confirmed;
          return (
            <li key={g.id} className={confirmed ? "" : "is-suggested"}>
              <button
                className="map-row-open"
                onClick={() => onOpenGoal?.(g.id)}
                disabled={!onOpenGoal}
              >
                <span className="map-level">Goal Outcome</span>
                <strong>{g.title}</strong>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              <div className="map-row-actions">
                {confirmed ? (
                  <span className="small muted">confirmed</span>
                ) : (
                  <span className="suggested-chip">suggested</span>
                )}
                {!confirmed && (
                  <button
                    className="quiet-chip"
                    disabled={readOnly}
                    onClick={() =>
                      act(
                        w => confirmProjectLink(w, g.id, project.id, stamp()),
                        `Confirmed: serves “${g.title}”.`
                      )
                    }
                  >
                    <Check size={13} /> Confirm
                  </button>
                )}
                <button
                  className="text-button"
                  disabled={readOnly}
                  onClick={() =>
                    act(
                      w => removeProjectLink(w, g.id, project.id, stamp()),
                      confirmed
                        ? `No longer serves “${g.title}”.`
                        : `Rejected the suggestion to serve “${g.title}”.`
                    )
                  }
                >
                  {confirmed ? (
                    "Unlink"
                  ) : (
                    <>
                      <X size={13} /> Reject
                    </>
                  )}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {!readOnly && candidates.length > 0 && (
        <div className="notion-row">
          <select
            value={pick}
            onChange={e => setPick(e.target.value)}
            aria-label={`Link ${project.title} to a Goal Outcome`}
          >
            <option value="">Serves an Outcome…</option>
            {candidates.map(g => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
          <button
            className="button secondary small-button"
            disabled={!pick}
            onClick={() => {
              const g = candidates.find(x => x.id === pick);
              if (
                act(
                  w => addProjectLink(w, pick, project.id, stamp()),
                  `Now serves “${g?.title}”.`
                )
              )
                setPick("");
            }}
          >
            Link
          </button>
        </div>
      )}
      <WhyLine
        text={describeWhy(workspace, project)}
        chains={chainsForProject(workspace, project.id)}
        onOpenGoal={onOpenGoal}
      />
      {message && (
        <p className="small muted" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
