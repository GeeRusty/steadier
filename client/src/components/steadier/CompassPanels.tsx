import { useMemo, useState } from "react";
import { Check, Compass, Volume2 } from "lucide-react";
import type { Task, Workspace } from "../../domain/types";
import {
  activeImperatives,
  CATCH_ALL_LABEL,
  imperativeViews,
  confirmPlacement,
  suggestCatchAll,
  type CatchAll,
} from "../../domain/compass";
import {
  catchAllWatch,
  formatAge,
  orphanReport,
  orphanSentence,
  recurringLifeAdmin,
  STAGE_LABEL,
  type OrphanInfo,
} from "../../domain/orphans";
import { useNow } from "../../hooks/useNow";
import { adelaideTimestamp } from "../../../../shared/time";
import { adelaideClock } from "../../domain/time";
import { reviewStatus } from "../../domain/review";
import TimingShapeMark from "./TimingShapeMark";

type Mutate = (fn: (w: Workspace) => Workspace) => boolean | void;

function place(
  task: Task,
  change: Partial<Task["compass"]> & { projectId?: string },
  line: string
): Task {
  const stamp = adelaideTimestamp();
  const { projectId, ...compass } = change;
  return {
    ...task,
    ...(projectId ? { projectId } : {}),
    compass: { ...task.compass, ...compass },
    updatedAt: stamp,
    history: [...task.history, { at: stamp, text: line }],
  };
}

/**
 * The "unplaced" list: flagged, never blocked. Most overdue first. Every
 * entry ends in the owner's own one-tap choice; suggestions need Confirm.
 */
export function UnplacedPanel({
  workspace,
  onMutate,
  onOpenTask,
  onRead,
  readOnly,
  limit = 12,
  reviewMode = false,
}: {
  workspace: Workspace;
  onMutate: Mutate;
  onOpenTask: (task: Task) => void;
  onRead?: (text: string) => void;
  readOnly: boolean;
  limit?: number;
  /** Weekly review lead-in: ask about projects, add Life Admin watch. */
  reviewMode?: boolean;
}) {
  const now = useNow();
  const report = useMemo(
    () => orphanReport(workspace.tasks, now),
    [workspace.tasks, now]
  );
  const unplaced = report.items;
  const watch = useMemo(
    () => (reviewMode ? catchAllWatch(workspace.tasks, now) : null),
    [reviewMode, workspace.tasks, now]
  );
  const recurring = useMemo(
    () => (reviewMode ? recurringLifeAdmin(workspace.tasks, now) : []),
    [reviewMode, workspace.tasks, now]
  );
  const [message, setMessage] = useState("");
  // Show a few first (the oldest/most urgent lead the report); more on request.
  const [shown, setShown] = useState(Math.min(limit, 5));
  const imperatives = activeImperatives(workspace);
  const projects = workspace.projects.filter(p => p.status === "active");
  const projectTitle = (id: string | null) =>
    workspace.projects.find(p => p.id === id)?.title ?? "a project";
  const imperativeTitle = (ids: string[]) =>
    ids
      .map(id => workspace.imperatives.find(i => i.id === id)?.title)
      .filter(Boolean)
      .join(", ") || "an Imperative";

  function apply(
    task: Task,
    change: Partial<Task["compass"]> & { projectId?: string },
    line: string
  ) {
    const ok = onMutate(w => ({
      ...w,
      tasks: w.tasks.map(t => (t.id === task.id ? place(t, change, line) : t)),
    }));
    setMessage(
      ok === false
        ? "That was not saved. Check sync and try again."
        : `Placed: ${task.title}.`
    );
  }

  function confirm(task: Task) {
    const stamp = adelaideTimestamp();
    const ok = onMutate(w => ({
      ...w,
      tasks: w.tasks.map(t =>
        t.id === task.id
          ? {
              ...confirmPlacement(t),
              updatedAt: stamp,
              history: [
                ...t.history,
                { at: stamp, text: "Confirmed the suggested placement." },
              ],
            }
          : t
      ),
    }));
    setMessage(
      ok === false
        ? "That was not saved. Check sync and try again."
        : `Confirmed: ${task.title}.`
    );
  }

  function pendingLabel(info: OrphanInfo): string | null {
    const t = info.task;
    if (info.pending === "project")
      return `Suggested project “${projectTitle(t.projectId)}”`;
    if (info.pending === "imperative")
      return `Suggested Imperative “${imperativeTitle(t.compass.imperativeIds)}”`;
    if (info.pending === "catch-all" && t.compass.catchAll)
      return `Suggested ${CATCH_ALL_LABEL[t.compass.catchAll]}`;
    if (info.pending === "parent" && t.parent)
      return `Suggested subtask of “${
        workspace.tasks.find(x => x.id === t.parent!.id)?.title ?? "a task"
      }”`;
    return null;
  }

  function spoken(): string {
    const lines = [orphanSentence(report)];
    for (const i of unplaced.slice(0, 8))
      lines.push(
        `${i.task.title}: ${STAGE_LABEL[i.stage].toLowerCase()}, ${formatAge(i.ageHours)} old${i.urgent ? `, ${i.urgent}` : ""}.`
      );
    if (reviewMode) lines.push("For each one: does this belong to a project?");
    return lines.join(" ");
  }

  return (
    <section
      className={`unplaced-panel${report.overdue ? " has-overdue" : ""}`}
      aria-labelledby="unplaced-title"
      id="unplaced-panel"
    >
      <div className="section-heading">
        <div>
          <div className="eyebrow">
            {reviewMode ? "LEAD-IN · STILL UNPLACED" : "ORPHAN CHECK"}
          </div>
          <h2 id="unplaced-title">
            {unplaced.length
              ? `${unplaced.length} unplaced${report.overdue ? ` · ${report.overdue} overdue` : ""}`
              : "Every task has a home"}
          </h2>
        </div>
        {onRead && (unplaced.length > 0 || reviewMode) && (
          <button className="text-button" onClick={() => onRead(spoken())}>
            <Volume2 size={15} /> Read aloud
          </button>
        )}
      </div>
      <p className="small muted">
        {reviewMode
          ? "Only what is still unplaced. For each one: does this belong to a project? If not, an Imperative, Life Admin or Erosion Guard."
          : "Open tasks with no confirmed project, Imperative, Life Admin or Erosion Guard. Flagged, never blocked; nothing is filed until you tap."}
      </p>
      {unplaced.length > 0 && (
        <ul className="unplaced-list">
          {unplaced.slice(0, shown).map(info => {
            const task = info.task;
            const suggestion = suggestCatchAll(task);
            const pending = pendingLabel(info);
            return (
              <li key={task.id} className={`orphan-stage-${info.stage}`}>
                <div className="unplaced-head">
                  <button
                    className="text-button unplaced-title"
                    onClick={() => onOpenTask(task)}
                  >
                    <TimingShapeMark task={task} /> {task.title}
                  </button>
                  <span className={`orphan-badge stage-${info.stage}`}>
                    {STAGE_LABEL[info.stage]} · {formatAge(info.ageHours)}
                    {info.urgent ? ` · ${info.urgent}` : ""}
                  </span>
                </div>
                {reviewMode && (
                  <p className="small orphan-question">
                    Does this belong to a project?
                  </p>
                )}
                {pending && (
                  <p className="small suggestion-line">
                    {pending}, not confirmed.
                    {!readOnly && (
                      <button
                        className="text-button"
                        onClick={() => confirm(task)}
                      >
                        <Check size={14} /> Confirm
                      </button>
                    )}
                  </p>
                )}
                {!readOnly && (
                  <div className="unplaced-actions">
                    {projects.length > 0 && (
                      <select
                        aria-label={`Link ${task.title} to a project`}
                        value=""
                        onChange={e => {
                          const p = projects.find(x => x.id === e.target.value);
                          if (p)
                            apply(
                              task,
                              { projectId: p.id },
                              `Linked to project “${p.title}”.`
                            );
                        }}
                      >
                        <option value="">Project…</option>
                        {projects.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                      </select>
                    )}
                    {imperatives.length > 0 && (
                      <select
                        aria-label={`Link ${task.title} to an Imperative`}
                        value=""
                        onChange={e => {
                          const imp = imperatives.find(
                            i => i.id === e.target.value
                          );
                          if (imp)
                            apply(
                              task,
                              { imperativeIds: [imp.id] },
                              `Linked to Imperative “${imp.title}”.`
                            );
                        }}
                      >
                        <option value="">Imperative…</option>
                        {imperatives.map(i => (
                          <option key={i.id} value={i.id}>
                            {i.title}
                          </option>
                        ))}
                      </select>
                    )}
                    {(["life-admin", "erosion-guard"] as CatchAll[]).map(c => (
                      <button
                        key={c}
                        className={`chip-toggle${suggestion === c ? " hint" : ""}`}
                        title={
                          suggestion === c
                            ? "Matches its Support label"
                            : undefined
                        }
                        onClick={() =>
                          apply(
                            task,
                            { catchAll: c, catchAllConfirmed: true },
                            `Filed under ${CATCH_ALL_LABEL[c]}.`
                          )
                        }
                      >
                        {CATCH_ALL_LABEL[c]}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {unplaced.length > shown && (
        <button className="line-link" onClick={() => setShown(n => n + 10)}>
          <b>Show more</b>
          <span>
            {Math.min(10, unplaced.length - shown)} of {unplaced.length - shown}{" "}
            remaining
          </span>
        </button>
      )}
      {watch && (
        <div className="catchall-watch">
          <h3>Catch-alls</h3>
          <p className="small">
            Life Admin: {watch.lifeAdminOpen} open · Erosion Guard:{" "}
            {watch.erosionGuardOpen} open
          </p>
          {watch.stale.length > 0 && (
            <>
              <p className="small orphan-question">
                Open in Life Admin for more than 14 days. Finish, move to a
                project, or drop?
              </p>
              <ul className="unplaced-list compact">
                {watch.stale.slice(0, 10).map(({ task, days }) => (
                  <li key={task.id}>
                    <button
                      className="text-button unplaced-title"
                      onClick={() => onOpenTask(task)}
                    >
                      <TimingShapeMark task={task} /> {task.title}
                    </button>
                    <span className="orphan-badge stage-3">
                      {days} days in Life Admin
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {recurring.map(group => (
            <p key={group.label} className="small suggestion-line">
              “{group.label}” has come up {group.tasks.length} times in Life
              Admin lately. Worth making it a project, or an Erosion Guard item?
              (Suggestion only; nothing changes unless you do it.)
            </p>
          ))}
          {onRead && (
            <button
              className="text-button"
              onClick={() =>
                onRead(
                  `Life Admin has ${watch.lifeAdminOpen} open, Erosion Guard ${watch.erosionGuardOpen}. ${watch.stale.length ? `${watch.stale.length} Life Admin task${watch.stale.length === 1 ? " has" : "s have"} been open more than 14 days.` : ""} ${recurring.map(g => `${g.label} keeps coming up.`).join(" ")}`
                )
              }
            >
              <Volume2 size={15} /> Read catch-alls aloud
            </button>
          )}
        </div>
      )}
      {message && (
        <p className="small muted" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

/** One quiet line on Today: Imperatives, any gone quiet, and the unplaced count. */
export function CompassStrip({
  workspace,
  onOpenImperatives,
  onOpenUnplaced,
  onOpenReview,
  onOpenMap,
  mapGapCount = 0,
  onRead,
}: {
  workspace: Workspace;
  onOpenImperatives: () => void;
  onOpenUnplaced: () => void;
  onOpenReview: () => void;
  onOpenMap?: () => void;
  mapGapCount?: number;
  onRead: (text: string) => void;
}) {
  const review = reviewStatus(workspace, adelaideClock().date);
  const today = adelaideClock().date;
  const views = useMemo(
    () => imperativeViews(workspace, today),
    [workspace, today]
  );
  const active = views.filter(v => v.imperative.status === "active");
  const quiet = active.filter(v => v.quiet);
  const unplaced = orphanReport(workspace.tasks).count;
  if (!active.length && !unplaced && !review.due && !mapGapCount) return null;
  const spoken = [
    active.length
      ? `${active.length} Active Imperative${active.length === 1 ? "" : "s"}.`
      : "No Active Imperatives yet.",
    quiet.length
      ? `Gone quiet: ${quiet.map(v => `${v.imperative.title}, ${v.quietDays} days`).join("; ")}. Worth one small step today?`
      : "",
    unplaced
      ? `${unplaced} step${unplaced === 1 ? " is" : "s are"} unplaced.`
      : "",
    mapGapCount
      ? `${mapGapCount} gap${mapGapCount === 1 ? "" : "s"} in your Compass map.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <section
      className={`compass-strip${quiet.length ? " has-quiet" : ""}`}
      aria-label="Compass"
    >
      <button className="text-button" onClick={onOpenImperatives}>
        <Compass size={15} /> {active.length} Imperative
        {active.length === 1 ? "" : "s"}
      </button>
      {quiet.length > 0 && (
        <button className="quiet-chip" onClick={onOpenImperatives}>
          Quiet: {quiet.map(v => v.imperative.title).join(", ")}
        </button>
      )}
      {mapGapCount > 0 && onOpenMap && (
        <button className="text-button" onClick={onOpenMap}>
          {mapGapCount} map gap{mapGapCount === 1 ? "" : "s"}
        </button>
      )}
      {review.due && (
        <button className="quiet-chip" onClick={onOpenReview}>
          Review due
          {review.daysSince !== null ? ` · ${review.daysSince} days` : ""}
        </button>
      )}
      <button
        className="text-button"
        onClick={() => onRead(spoken)}
        aria-label="Read Compass summary aloud"
      >
        <Volume2 size={15} />
      </button>
    </section>
  );
}

/** Start point on the Review page; louder when a review is overdue. */
export function ReviewDueBanner({
  workspace,
  onStart,
}: {
  workspace: Workspace;
  onStart: () => void;
}) {
  const status = reviewStatus(workspace, adelaideClock().date);
  return (
    <section
      className={`review-banner${status.due ? " due" : ""}`}
      aria-label="Weekly Reality Review"
    >
      <div>
        <strong>Weekly Reality Review</strong>
        <p className="small muted">
          {status.daysSince === null
            ? "Not done yet. Floor Check (money, action, capacity), placement and Imperatives in about ten minutes."
            : `Last done ${status.lastReviewDate} (${status.daysSince} day${status.daysSince === 1 ? "" : "s"} ago).`}
          {status.commitments
            ? ` ${status.commitments} commitment${status.commitments === 1 ? "" : "s"} to confirm.`
            : ""}
          {status.quiet.length
            ? ` ${status.quiet.length} Imperative${status.quiet.length === 1 ? "" : "s"} gone quiet.`
            : ""}
        </p>
      </div>
      <button
        className="button primary small-button"
        onClick={onStart}
        aria-label="Open Weekly Reality Review"
      >
        Open weekly review
      </button>
    </section>
  );
}
