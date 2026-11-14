import React, { useEffect, useState } from "react";
import type { FrontOfMindItem, Workspace } from "../../domain/types";
import { adelaideTimestamp } from "../../../../shared/time";
import { adelaideClock } from "../../domain/time";
import {
  bringBack,
  chipsFor,
  clearImperativeDraft,
  editWording,
  FRONT_OF_MIND_TEXT_LIMIT,
  keepItem,
  letGo,
  letGoItems,
  openItems,
  saveImperativeDraft,
} from "../../domain/frontOfMind";

interface Props {
  workspace: Workspace;
  readOnly: boolean;
  onMutate: (update: (w: Workspace) => Workspace) => boolean;
  /** Opens the usual unsaved task draft with the wording filled in. */
  onMakeTask: (item: FrontOfMindItem) => void;
  readRef?: React.MutableRefObject<(() => string) | null>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dayText(at: string, today: string): string {
  const [y, m, d] = at.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${String(y) === today.slice(0, 4) ? "" : ` ${y}`}`;
}

function useChange(onMutate: Props["onMutate"], readOnly: boolean) {
  return (update: (w: Workspace, at: string) => Workspace): boolean => {
    if (readOnly) return false;
    let changed = false;
    const ok = onMutate(w => {
      const next = update(w, adelaideTimestamp());
      changed = next !== w;
      return next;
    });
    return ok && changed;
  };
}
type Change = ReturnType<typeof useChange>;

export function Chips({ item, today }: { item: FrontOfMindItem; today: string }) {
  return (
    <>
      {chipsFor(item, today).map(c => (
        <span key={c.text} className={c.dashed ? "tp-chip fm-dashed" : "tp-chip"}>
          {c.text}
        </span>
      ))}
    </>
  );
}

export function metaLine(item: FrontOfMindItem, today: string): string {
  const parts = [`added ${dayText(item.createdAt, today)}${item.addedBy === "claude" ? " by Claude" : ""}`];
  if (item.lookedAt) parts.push(`looked at ${dayText(item.lookedAt, today)}`);
  return parts.join(" · ");
}

export default function FrontOfMindView({ workspace, readOnly, onMutate, onMakeTask, readRef }: Props) {
  const change = useChange(onMutate, readOnly);
  const today = adelaideClock().date;
  const items = openItems(workspace);
  const gone = letGoItems(workspace);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showGone, setShowGone] = useState(false);

  useEffect(() => {
    if (!readRef) return;
    readRef.current = () =>
      items.length
        ? `Front of Mind. ${items.map(i => `${i.text}${i.claudeLabel ? ", added by Claude" : ""}${i.letGoSuggestion ? ", Claude suggests letting it go" : ""}.`).join(" ")}`
        : "Front of Mind is empty.";
    return () => {
      readRef.current = null;
    };
  });

  return (
    <section className="lv" aria-labelledby="fom-title">
      <h1 id="fom-title" className="sr-only">
        Front of Mind
      </h1>
      {!items.length && <p className="lv-quiet">Nothing here. Add with the + button and choose Idea.</p>}
      {items.map(item => (
        <Row
          key={item.id}
          item={item}
          today={today}
          open={openId === item.id}
          onToggle={() => setOpenId(openId === item.id ? null : item.id)}
          readOnly={readOnly}
          change={change}
          onMakeTask={() => onMakeTask(item)}
        />
      ))}
      {gone.length > 0 && (
        <>
          <button type="button" className="lv-link" aria-expanded={showGone} onClick={() => setShowGone(v => !v)}>
            Let go ({gone.length}) {showGone ? "⌄" : "›"}
          </button>
          {showGone &&
            gone.map(item => (
              <div key={item.id} className="lv-card fm-row fm-gone">
                <span className="lv-row-top">
                  <span className="fm-text">{item.text}</span>
                  {!readOnly && (
                    <button type="button" className="tp-btn" onClick={() => change((w, at) => bringBack(w, item.id, at))}>
                      Bring back
                    </button>
                  )}
                </span>
                <span className="lv-meta">let go {dayText(item.letGoAt!, today)}</span>
                <History item={item} today={today} />
              </div>
            ))}
        </>
      )}
    </section>
  );
}

function Row({
  item,
  today,
  open,
  onToggle,
  readOnly,
  change,
  onMakeTask,
}: {
  item: FrontOfMindItem;
  today: string;
  open: boolean;
  onToggle: () => void;
  readOnly: boolean;
  change: Change;
  onMakeTask: () => void;
}) {
  const [mode, setMode] = useState<"edit" | "promote" | null>(null);
  const [text, setText] = useState(item.text);
  const [reason, setReason] = useState("");
  const close = () => setMode(null);

  return (
    <div className="lv-card fm-row">
      <button type="button" className="fm-head" aria-expanded={open} onClick={onToggle}>
        <span className="lv-row-top">
          <span className="fm-text">{item.text}</span>
          <Chips item={item} today={today} />
        </span>
        <span className="lv-meta">
          {item.imperativeDraft ? "Imperative draft · decide in Weekly Review" : metaLine(item, today)}
        </span>
      </button>
      {item.letGoSuggestion && (
        <div className="fm-suggestion">
          <span className="lv-meta">Claude suggests letting this go, {dayText(item.letGoSuggestion.at, today)}:</span>
          {item.letGoSuggestion.reason && <span>“{item.letGoSuggestion.reason}”</span>}
          {!readOnly && (
            <span className="lv-row-actions">
              <button type="button" className="tp-btn" onClick={() => change((w, at) => letGo(w, item.id, at))}>
                Let go
              </button>
              <button type="button" className="tp-btn" onClick={() => change((w, at) => keepItem(w, item.id, at))}>
                Keep
              </button>
            </span>
          )}
        </div>
      )}
      {open && (
        <div className="fm-body">
          {!readOnly && mode === null && (
            <Actions
              onMakeTask={onMakeTask}
              onPromote={() => {
                setText(item.imperativeDraft?.title ?? item.text);
                setReason(item.imperativeDraft?.reason ?? "");
                setMode("promote");
              }}
              onKeep={() => change((w, at) => keepItem(w, item.id, at))}
              onLetGo={() => change((w, at) => letGo(w, item.id, at))}
            />
          )}
          {item.claudeLabel && mode === null && <span className="lv-meta">Keep removes the “added by Claude” label.</span>}
          {mode === "edit" && (
            <form
              className="lv-form"
              onSubmit={e => {
                e.preventDefault();
                if (text.trim() === item.text || change((w, at) => editWording(w, item.id, text, at))) close();
              }}
            >
              <label className="lv-field">
                Wording
                <input autoFocus value={text} maxLength={FRONT_OF_MIND_TEXT_LIMIT} onChange={e => setText(e.target.value)} />
              </label>
              <span className="lv-row-actions">
                <button type="submit" className="tp-btn tp-btn-primary" disabled={!text.trim()}>
                  Save
                </button>
                <button type="button" className="lv-link" onClick={close}>
                  Cancel
                </button>
              </span>
            </form>
          )}
          {mode === "promote" && (
            <form
              className="lv-form fm-promote"
              onSubmit={e => {
                e.preventDefault();
                if (change((w, at) => saveImperativeDraft(w, item.id, text, reason, at))) close();
              }}
            >
              <span className="fm-tag">Imperative draft · your Imperatives don't change</span>
              <label className="lv-field">
                What I cannot ignore
                <input autoFocus value={text} maxLength={300} onChange={e => setText(e.target.value)} />
              </label>
              <label className="lv-field">
                Why it matters now (optional)
                <textarea rows={2} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} />
              </label>
              <span className="lv-meta">It waits for your next Weekly Review, where you choose Add as Imperative or Not now.</span>
              <span className="lv-row-actions">
                <button type="submit" className="tp-btn tp-btn-primary" disabled={!text.trim()}>
                  Save draft
                </button>
                <button type="button" className="lv-link" onClick={close}>
                  Cancel
                </button>
                {item.imperativeDraft && (
                  <button type="button" className="lv-link" onClick={() => change((w, at) => clearImperativeDraft(w, item.id, at)) && close()}>
                    Remove draft
                  </button>
                )}
              </span>
            </form>
          )}
          {item.notes && mode === null && <p className="fm-notes">{item.notes}</p>}
          {mode === null && (
            <span className="lv-row-actions fm-foot">
              {!readOnly && (
                <button
                  type="button"
                  className="lv-link"
                  onClick={() => {
                    setText(item.text);
                    setMode("edit");
                  }}
                >
                  Edit wording
                </button>
              )}
            </span>
          )}
          <History item={item} today={today} />
        </div>
      )}
    </div>
  );
}

export function Actions({
  onMakeTask,
  onPromote,
  onKeep,
  onLetGo,
  chosen,
}: {
  onMakeTask: () => void;
  onPromote: () => void;
  onKeep: () => void;
  onLetGo: () => void;
  /** Weekly Review: the choice made so far (applied on save). */
  chosen?: "task" | "promote" | "keep" | "letgo" | null;
}) {
  const cls = (key: string) => `tp-btn${chosen === key ? " fm-on" : ""}`;
  return (
    <span className="fm-actions">
      <button type="button" className={cls("task")} aria-pressed={chosen === undefined ? undefined : chosen === "task"} onClick={onMakeTask}>
        Make it a task
      </button>
      <button type="button" className={cls("promote")} aria-pressed={chosen === undefined ? undefined : chosen === "promote"} onClick={onPromote}>
        Promote to Imperative
      </button>
      <button type="button" className={cls("keep")} aria-pressed={chosen === undefined ? undefined : chosen === "keep"} onClick={onKeep}>
        Keep
      </button>
      <button type="button" className={cls("letgo")} aria-pressed={chosen === undefined ? undefined : chosen === "letgo"} onClick={onLetGo}>
        Let go
      </button>
    </span>
  );
}

function History({ item, today }: { item: FrontOfMindItem; today: string }) {
  const [open, setOpen] = useState(false);
  if (!item.history.length) return null;
  return (
    <>
      <button type="button" className="lv-link fm-history-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        History {open ? "⌄" : "›"}
      </button>
      {open && (
        <ol className="av-timeline fm-history">
          {[...item.history].reverse().map((h, i) => (
            <li key={i}>
              <span className="lv-meta">
                <b>{dayText(h.at, today)}</b> · {h.text}
              </span>
              {h.was !== undefined && <span className="fm-was">was: “{h.was}”</span>}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
