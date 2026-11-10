import { useEffect, useMemo, useState } from "react";
import { Compass, ExternalLink, Plus, Volume2 } from "lucide-react";
import type { Task, Workspace } from "../../domain/types";
import {
  activeImperatives,
  imperativeViews,
  MAX_ACTIVE_IMPERATIVES,
  normaliseNotionUrl,
  QUIET_DAYS,
  type Imperative,
  type ImperativeView,
} from "../../domain/compass";
import { adelaideTimestamp } from "../../../../shared/time";
import { adelaideClock } from "../../domain/time";
import TimingShapeMark from "./TimingShapeMark";
import { DecisionField, NotionField } from "./CompassFields";
import { GOAL_LEVEL_LABEL, GOAL_LEVELS } from "../../domain/goals";
import {
  goalsThroughWork,
  imperativeMapLinks,
  linkImperativeToGoal,
  unlinkImperativeFromGoal,
} from "../../domain/mapPages";

interface Props {
  workspace: Workspace;
  onMutate: (fn: (w: Workspace) => Workspace) => boolean | void;
  onOpenTask: (task: Task) => void;
  onOpenGoal?: (id: string) => void;
  onRead: (text: string) => void;
  readOnly: boolean;
  focusId?: string | null;
  onFocusDone?: () => void;
}

function newId(): string {
  return `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function spokenImperatives(views: ImperativeView[]): string {
  const active = views.filter(v => v.imperative.status === "active");
  if (!active.length) return "You have no Active Imperatives yet.";
  const parts = [
    `You have ${active.length} Active Imperative${active.length === 1 ? "" : "s"}.`,
  ];
  for (const v of active) {
    parts.push(
      `${v.imperative.title}${v.imperative.reason ? `, because ${v.imperative.reason}` : ""}. ${v.openTasks} open step${v.openTasks === 1 ? "" : "s"}${v.quiet ? `, and nothing has moved for ${v.quietDays} days` : ""}.`
    );
  }
  return parts.join(" ");
}

export default function ImperativesView({
  workspace,
  onMutate,
  onOpenTask,
  onOpenGoal,
  onRead,
  readOnly,
  focusId,
  onFocusDone,
}: Props) {
  const [mapPick, setMapPick] = useState<Record<string, string>>({});
  const today = adelaideClock().date;
  const views = useMemo(
    () => imperativeViews(workspace, today),
    [workspace, today]
  );
  const active = views.filter(v => v.imperative.status === "active");
  const retired = views.filter(v => v.imperative.status === "retired");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [notion, setNotion] = useState("");
  const [message, setMessage] = useState("");
  const [confirmOver, setConfirmOver] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    if (!focusId) return;
    document.getElementById(`imperative-${focusId}`)?.focus();
    onFocusDone?.();
    // This is a one-time navigation focus, not a data effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  function commit(fn: (w: Workspace) => Workspace, ok: string) {
    if (readOnly) return false;
    const accepted = onMutate(fn) !== false;
    setMessage(accepted ? ok : "That was not saved. Check sync and try again.");
    return accepted;
  }

  function add() {
    const clean = title.trim();
    if (!clean) return setMessage("Name the Imperative first.");
    const url = notion.trim() ? normaliseNotionUrl(notion) : null;
    if (notion.trim() && !url)
      return setMessage("Use an https notion.so or notion.site link.");
    if (
      activeImperatives(workspace).length >= MAX_ACTIVE_IMPERATIVES &&
      !confirmOver
    ) {
      setConfirmOver(true);
      return setMessage(
        `You already hold ${MAX_ACTIVE_IMPERATIVES} Active Imperatives. Retire one first, or tap Add again to hold one more.`
      );
    }
    const stamp = adelaideTimestamp();
    const imperative: Imperative = {
      id: newId(),
      title: clean.slice(0, 300),
      reason: reason.trim().slice(0, 2000),
      status: "active",
      setOn: today,
      retiredOn: null,
      notionUrl: url,
      decision: null,
      history: [{ at: stamp, text: "Set as an Active Imperative." }],
      createdAt: stamp,
      updatedAt: stamp,
    };
    if (
      commit(
        w => ({ ...w, imperatives: [...w.imperatives, imperative] }),
        `“${imperative.title}” is now active.`
      )
    ) {
      setTitle("");
      setReason("");
      setNotion("");
      setConfirmOver(false);
    }
  }

  function update(id: string, change: Partial<Imperative>, line: string) {
    const stamp = adelaideTimestamp();
    commit(
      w => ({
        ...w,
        imperatives: w.imperatives.map(i =>
          i.id === id
            ? {
                ...i,
                ...change,
                updatedAt: stamp,
                history: [...i.history, { at: stamp, text: line }],
              }
            : i
        ),
      }),
      line
    );
  }

  function mapSection(i: Imperative) {
    const goals = workspace.goals ?? [];
    const direct = imperativeMapLinks(i)
      .map(id => goals.find(g => g.id === id))
      .filter(Boolean) as typeof goals;
    const through = goalsThroughWork(workspace, i).filter(
      g => !direct.some(d => d.id === g.id)
    );
    const candidates = goals.filter(
      g => g.status === "active" && !imperativeMapLinks(i).includes(g.id)
    );
    const pick = mapPick[i.id] ?? "";
    const offMap =
      i.status === "active" && direct.length === 0 && through.length === 0;
    return (
      <div className="imperative-map">
        <p className="small">
          <strong>On the map: </strong>
          {offMap && <span className="gap-chip">not on the map yet</span>}
        </p>
        <ul className="imperative-steps">
          {direct.map(g => (
            <li key={g.id}>
              <button
                className="text-button"
                onClick={() => onOpenGoal?.(g.id)}
              >
                {GOAL_LEVEL_LABEL[g.level]} “{g.title}”
              </button>
              {!readOnly && (
                <button
                  className="text-button"
                  onClick={() =>
                    commit(
                      w =>
                        unlinkImperativeFromGoal(
                          w,
                          i.id,
                          g.id,
                          adelaideTimestamp()
                        ),
                      `Unlinked from “${g.title}”.`
                    )
                  }
                >
                  Unlink
                </button>
              )}
            </li>
          ))}
          {through.map(g => (
            <li key={g.id}>
              <button
                className="text-button"
                onClick={() => onOpenGoal?.(g.id)}
              >
                {GOAL_LEVEL_LABEL[g.level]} “{g.title}”
              </button>{" "}
              <span className="small muted">through linked work</span>
            </li>
          ))}
        </ul>
        {!readOnly && candidates.length > 0 && (
          <div className="notion-row">
            <select
              value={pick}
              aria-label={`Link ${i.title} to the map`}
              onChange={e =>
                setMapPick(m => ({ ...m, [i.id]: e.target.value }))
              }
            >
              <option value="">Link to a Pillar, Value Goal or Outcome…</option>
              {GOAL_LEVELS.map(level => (
                <optgroup key={level} label={GOAL_LEVEL_LABEL[level]}>
                  {candidates
                    .filter(g => g.level === level)
                    .map(g => (
                      <option key={g.id} value={g.id}>
                        {g.title}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <button
              className="button secondary small-button"
              disabled={!pick}
              onClick={() => {
                const g = goals.find(x => x.id === pick);
                if (
                  commit(
                    w =>
                      linkImperativeToGoal(w, i.id, pick, adelaideTimestamp()),
                    `Linked to “${g?.title}” on the map.`
                  )
                )
                  setMapPick(m => ({ ...m, [i.id]: "" }));
              }}
            >
              Link
            </button>
          </div>
        )}
      </div>
    );
  }

  function card(v: ImperativeView) {
    const i = v.imperative;
    const open = v.tasks.filter(t => t.state !== "done");
    const isEditing = editing === i.id;
    return (
      <li
        id={`imperative-${i.id}`}
        tabIndex={-1}
        aria-labelledby={`imperative-title-${i.id}`}
        key={i.id}
        className={`imperative-card${v.quiet ? " quiet" : ""}${i.status === "retired" ? " retired" : ""}`}
      >
        <div className="imperative-head">
          <div>
            <h3 id={`imperative-title-${i.id}`}>
              <TimingShapeMark imperative={i} /> {i.title}
            </h3>
            {i.reason && <p className="small">{i.reason}</p>}
          </div>
          {i.notionUrl && (
            <a
              className="text-button"
              href={i.notionUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              <ExternalLink size={14} /> Notion
            </a>
          )}
        </div>
        <p className="small muted">
          Set {i.setOn} · {v.projects.length} project
          {v.projects.length === 1 ? "" : "s"} · {open.length} open step
          {open.length === 1 ? "" : "s"}
          {v.projects.length === 0 && open.length === 0
            ? " · stands on its own, which is fine"
            : ""}
        </p>
        {v.quiet && (
          <p className="quiet-note small" role="status">
            Quiet for {v.quietDays} days. Nothing linked has moved. Is this
            still something you cannot ignore? Pick one small step, or decide in
            your review.
          </p>
        )}
        {open.length > 0 && (
          <ul className="imperative-steps">
            {open.slice(0, 5).map(t => (
              <li key={t.id}>
                <button className="text-button" onClick={() => onOpenTask(t)}>
                  <TimingShapeMark task={t} /> {t.nextAction || t.title}
                </button>
              </li>
            ))}
            {open.length > 5 && (
              <li className="small muted">and {open.length - 5} more</li>
            )}
          </ul>
        )}
        {(workspace.goals ?? []).length > 0 && mapSection(i)}
        {i.decision && (
          <p className="small">
            Decision: <strong>{i.decision.outcome}</strong>
            {i.decision.confirmed ? "" : " (suggested, not decided)"}
          </p>
        )}
        {!readOnly && (
          <div className="missed-actions">
            <button
              className="text-button"
              onClick={() => setEditing(isEditing ? null : i.id)}
            >
              {isEditing ? "Close" : "Edit"}
            </button>
            {i.status === "active" ? (
              <button
                className="text-button"
                onClick={() =>
                  update(
                    i.id,
                    { status: "retired", retiredOn: today },
                    "Retired."
                  )
                }
              >
                Retire
              </button>
            ) : (
              <button
                className="text-button"
                onClick={() =>
                  update(
                    i.id,
                    { status: "active", retiredOn: null },
                    "Made active again."
                  )
                }
              >
                Make active again
              </button>
            )}
          </div>
        )}
        {isEditing && !readOnly && (
          <div className="imperative-edit">
            <label className="field">
              Title
              <input
                defaultValue={i.title}
                maxLength={300}
                onBlur={e =>
                  e.target.value.trim() &&
                  e.target.value.trim() !== i.title &&
                  update(i.id, { title: e.target.value.trim() }, "Renamed.")
                }
              />
            </label>
            <label className="field">
              Why I cannot ignore this
              <textarea
                rows={2}
                defaultValue={i.reason}
                maxLength={2000}
                onBlur={e =>
                  e.target.value.trim() !== i.reason &&
                  update(
                    i.id,
                    { reason: e.target.value.trim() },
                    "Reason updated."
                  )
                }
              />
            </label>
            <DecisionField
              decision={i.decision}
              onChange={decision =>
                update(
                  i.id,
                  { decision },
                  decision
                    ? `Decision: ${decision.outcome}.`
                    : "Decision cleared."
                )
              }
            />
            <NotionField
              value={i.notionUrl}
              onChange={notionUrl =>
                update(i.id, { notionUrl }, "Notion link updated.")
              }
              onError={setMessage}
            />
          </div>
        )}
      </li>
    );
  }

  return (
    <section className="imperatives-view" aria-labelledby="imperatives-title">
      <div className="calendar-toolbar">
        <h1 id="imperatives-title">
          <Compass size={22} /> Imperatives
        </h1>
        <button
          className="text-button"
          onClick={() => onRead(spokenImperatives(views))}
        >
          <Volume2 size={15} /> Read aloud
        </button>
      </div>
      <p className="muted">
        What, given present reality, you cannot responsibly ignore. Set in your
        Weekly Reality Review. {active.length} of about {MAX_ACTIVE_IMPERATIVES}{" "}
        active. One can stand without any project. Steadier flags any that go
        quiet for {QUIET_DAYS} days; it never sets or retires them for you.
      </p>
      {active.length > MAX_ACTIVE_IMPERATIVES && (
        <p className="quiet-note small">
          You are holding {active.length}. More than {MAX_ACTIVE_IMPERATIVES}{" "}
          usually means some are not really imperative.
        </p>
      )}
      <ul className="imperative-list">{active.map(card)}</ul>
      {!readOnly && (
        <form
          className="imperative-add"
          onSubmit={e => {
            e.preventDefault();
            add();
          }}
        >
          <h2>Add an Imperative</h2>
          <label className="field">
            What I cannot ignore
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={300}
              placeholder="e.g. Keep the family home stable"
            />
          </label>
          <label className="field">
            Short reason
            <input
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={2000}
              placeholder="e.g. Lease ends in March"
            />
          </label>
          <label className="field">
            Notion page link (optional)
            <input
              value={notion}
              onChange={e => setNotion(e.target.value)}
              type="url"
              placeholder="https://www.notion.so/…"
            />
          </label>
          <button className="button primary small-button">
            <Plus size={14} /> Add
          </button>
        </form>
      )}
      {retired.length > 0 && (
        <details className="detail-section">
          <summary>Retired ({retired.length})</summary>
          <ul className="imperative-list">{retired.map(card)}</ul>
        </details>
      )}
      {message && (
        <p className="small muted" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
