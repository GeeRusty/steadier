import React, { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
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
import { shortDate } from "../../domain/assets";
import {
  goalRoutesThroughWork,
  imperativeMapLinks,
  routeText,
  linkImperativeToGoal,
  unlinkImperativeFromGoal,
} from "../../domain/mapPages";

/** The page's explanation, word for word, behind the i. */
export const IMPERATIVES_INFO = `What, given present reality, you cannot responsibly ignore. Set in your Weekly Reality Review. About ${MAX_ACTIVE_IMPERATIVES} active. One can stand without any project. Steadier flags any that go quiet for ${QUIET_DAYS} days; it never sets or retires them for you.`;

interface Props {
  workspace: Workspace;
  onMutate: (fn: (w: Workspace) => Workspace) => boolean | void;
  onOpenTask: (task: Task) => void;
  onOpenGoal?: (id: string) => void;
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
  const [linking, setLinking] = useState<string | null>(null);
  const [retiring, setRetiring] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showRetired, setShowRetired] = useState(false);

  useEffect(() => {
    if (!focusId) return;
    if (workspace.imperatives.some(i => i.id === focusId && i.status === "retired")) setShowRetired(true);
    // After the retired list (if any) has opened.
    setTimeout(() => document.getElementById(`imperative-${focusId}`)?.focus(), 0);
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
    if (!clean) {
      setMessage("Name the Imperative first.");
      return false;
    }
    const url = notion.trim() ? normaliseNotionUrl(notion) : null;
    if (notion.trim() && !url) {
      setMessage("Use an https notion.so or notion.site link.");
      return false;
    }
    if (
      activeImperatives(workspace).length >= MAX_ACTIVE_IMPERATIVES &&
      !confirmOver
    ) {
      setConfirmOver(true);
      setMessage(
        `You already hold ${MAX_ACTIVE_IMPERATIVES} Active Imperatives. Retire one first, or tap Add again to hold one more.`
      );
      return false;
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
      return true;
    }
    return false;
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

  function unlinkGoal(i: Imperative, goalId: string, title: string) {
    commit(
      w => unlinkImperativeFromGoal(w, i.id, goalId, adelaideTimestamp()),
      `Unlinked from “${title}”.`
    );
  }

  function mapSection(i: Imperative) {
    const goals = workspace.goals ?? [];
    const direct = imperativeMapLinks(i)
      .map(id => goals.find(g => g.id === id))
      .filter(Boolean) as typeof goals;
    const through = goalRoutesThroughWork(workspace, i).filter(
      r => !direct.some(d => d.id === r.goal.id)
    );
    const candidates = goals.filter(
      g => g.status === "active" && !imperativeMapLinks(i).includes(g.id)
    );
    const pick = mapPick[i.id] ?? "";
    const offMap =
      i.status === "active" && direct.length === 0 && through.length === 0;
    const picking = linking === i.id;
    return (
      <div className="imp-map">
        <span className="imp-label">On the map</span>
        {offMap && <span className="lv-meta">Not on the map yet</span>}
        {direct.map(g => (
          <div className="imp-map-row" key={g.id}>
            <button type="button" className="imp-goal" onClick={() => onOpenGoal?.(g.id)}>
              {GOAL_LEVEL_LABEL[g.level]} “{g.title}”
            </button>
            {!readOnly && (
              <button type="button" className="imp-unlink" onClick={() => unlinkGoal(i, g.id, g.title)}>
                Unlink
              </button>
            )}
          </div>
        ))}
        {through.map(({ goal: g, projects }) => (
          <div className="imp-map-row" key={g.id}>
            <button type="button" className="imp-goal" onClick={() => onOpenGoal?.(g.id)}>
              {GOAL_LEVEL_LABEL[g.level]} “{g.title}”
            </button>
            {projects.length > 1 ? (
              <details className="imp-route">
                <summary className="lv-meta">{routeText(projects)}</summary>
                <span className="lv-meta">{projects.map(p => p.title).join(", ")}</span>
              </details>
            ) : (
              <span className="lv-meta">{routeText(projects)}</span>
            )}
          </div>
        ))}
        {!readOnly && candidates.length > 0 && !picking && (
          <button type="button" className="lv-link" onClick={() => setLinking(i.id)}>
            + Link
          </button>
        )}
        {!readOnly && candidates.length > 0 && picking && (
          <div className="imp-link-form">
            <label className="lv-meta" htmlFor={`imp-link-${i.id}`}>
              Link to a Pillar, Value Goal or Outcome
            </label>
            <select
              id={`imp-link-${i.id}`}
              value={pick}
              onChange={e => setMapPick(m => ({ ...m, [i.id]: e.target.value }))}
            >
              <option value="">Choose…</option>
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
            <span className="lv-row-actions">
              <button
                type="button"
                className="tp-btn tp-btn-primary"
                disabled={!pick}
                onClick={() => {
                  const g = goals.find(x => x.id === pick);
                  if (
                    commit(
                      w => linkImperativeToGoal(w, i.id, pick, adelaideTimestamp()),
                      `Linked to “${g?.title}” on the map.`
                    )
                  ) {
                    setMapPick(m => ({ ...m, [i.id]: "" }));
                    setLinking(null);
                  }
                }}
              >
                Link
              </button>
              <button
                type="button"
                className="tp-btn"
                onClick={() => {
                  setMapPick(m => ({ ...m, [i.id]: "" }));
                  setLinking(null);
                }}
              >
                Cancel
              </button>
            </span>
          </div>
        )}
      </div>
    );
  }

  function card(v: ImperativeView) {
    const i = v.imperative;
    const open = v.tasks.filter(t => t.state !== "done");
    const isEditing = editing === i.id;
    const counts =
      v.projects.length === 0 && open.length === 0
        ? "stands on its own, no projects"
        : `${v.projects.length} project${v.projects.length === 1 ? "" : "s"} · ${open.length} open step${open.length === 1 ? "" : "s"}`;
    return (
      <li
        id={`imperative-${i.id}`}
        tabIndex={-1}
        aria-labelledby={`imperative-title-${i.id}`}
        key={i.id}
        className={`lv-card imp-card${i.status === "active" ? " imp-active" : " imp-retired"}`}
      >
        <span className="lv-row-top">
          <h3 id={`imperative-title-${i.id}`} className="imp-title">
            {i.title}
          </h3>
          {v.quiet && v.quietDays !== null && <span className="tp-chip">quiet {v.quietDays}d</span>}
        </span>
        {i.reason && <span className="imp-why">{i.reason}</span>}
        <span className="lv-meta">
          {i.status === "retired" && i.retiredOn
            ? `Retired ${shortDate(i.retiredOn, today)} · `
            : ""}
          Set {shortDate(i.setOn, today)} · {counts}
          {i.notionUrl && (
            <>
              {" · "}
              <a href={i.notionUrl} target="_blank" rel="noreferrer noopener">
                Notion
              </a>
            </>
          )}
        </span>
        {open.length > 0 && (
          <ul className="imp-steps">
            {open.slice(0, 5).map(t => (
              <li key={t.id}>
                <button type="button" className="imp-step" onClick={() => onOpenTask(t)}>
                  <span className="imp-step-text">{t.nextAction || t.title}</span>
                  <TimingShapeMark task={t} />
                </button>
              </li>
            ))}
            {open.length > 5 && <li className="lv-meta">and {open.length - 5} more</li>}
          </ul>
        )}
        {(workspace.goals ?? []).length > 0 && mapSection(i)}
        {i.decision && (
          <span className="lv-meta">
            Decision: <strong>{i.decision.outcome}</strong>
            {i.decision.confirmed ? "" : " (suggested, not decided)"}
          </span>
        )}
        {!readOnly && retiring === i.id ? (
          <div className="lv-card lv-confirm imp-confirm" role="alertdialog" aria-label={`Retire ${i.title}?`}>
            <strong>Retire “{i.title}”?</strong>
            <span className="lv-meta">
              It moves to Retired, with its history kept. Its projects and steps stay as they are. You can make it active again at any time.
            </span>
            <span className="lv-row-actions">
              <button
                type="button"
                className="tp-btn tp-btn-primary"
                onClick={() => {
                  update(i.id, { status: "retired", retiredOn: today }, "Retired.");
                  setRetiring(null);
                }}
              >
                Retire
              </button>
              <button type="button" className="tp-btn" onClick={() => setRetiring(null)}>
                Cancel
              </button>
            </span>
          </div>
        ) : (
          !readOnly && (
            <div className="imp-actions">
              <button type="button" className="tp-btn" onClick={() => setEditing(isEditing ? null : i.id)}>
                {isEditing ? "Close" : "Edit"}
              </button>
              {i.status === "active" ? (
                <button type="button" className="imp-retire" onClick={() => setRetiring(i.id)}>
                  Retire…
                </button>
              ) : (
                <button
                  type="button"
                  className="imp-retire"
                  onClick={() => update(i.id, { status: "active", retiredOn: null }, "Made active again.")}
                >
                  Make active again
                </button>
              )}
            </div>
          )
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
                  update(i.id, { reason: e.target.value.trim() }, "Reason updated.")
                }
              />
            </label>
            <DecisionField
              decision={i.decision}
              onChange={decision =>
                update(i.id, { decision }, decision ? `Decision: ${decision.outcome}.` : "Decision cleared.")
              }
            />
            <NotionField
              value={i.notionUrl}
              onChange={notionUrl => update(i.id, { notionUrl }, "Notion link updated.")}
              onError={setMessage}
            />
          </div>
        )}
      </li>
    );
  }

  return (
    <section className="lv imp" aria-labelledby="imperatives-title">
      <h1 id="imperatives-title" className="sr-only">
        Imperatives
      </h1>
      <span className="lv-meta imp-count">{active.length} active</span>
      {active.length > MAX_ACTIVE_IMPERATIVES && (
        <span className="lv-meta">
          You are holding {active.length}. More than {MAX_ACTIVE_IMPERATIVES} usually means some are not really imperative.
        </span>
      )}
      {!active.length && <p className="lv-quiet">No Active Imperatives yet.</p>}
      <ul className="imp-list">{active.map(card)}</ul>
      {!readOnly && !adding && (
        <button type="button" className="lv-link" onClick={() => setAdding(true)}>
          + Add an Imperative
        </button>
      )}
      {!readOnly && adding && (
        <form
          className="lv-card imperative-add"
          onSubmit={e => {
            e.preventDefault();
            if (add()) setAdding(false);
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
          <span className="lv-row-actions">
            <button type="submit" className="tp-btn tp-btn-primary">
              <Plus size={14} aria-hidden="true" /> Add
            </button>
            <button type="button" className="tp-btn" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </span>
        </form>
      )}
      {retired.length > 0 && (
        <>
          <button type="button" className="lv-link" aria-expanded={showRetired} onClick={() => setShowRetired(v => !v)}>
            Retired ({retired.length}) {showRetired ? "⌄" : "›"}
          </button>
          {showRetired && <ul className="imp-list">{retired.map(card)}</ul>}
        </>
      )}
      {message && (
        <p className="lv-meta" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
