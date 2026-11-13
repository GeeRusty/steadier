import React, { useState } from "react";
import { toast } from "sonner";
import { adelaideTimestamp } from "../../../../shared/time";
import { privateRequest } from "../../lib/cloudApi";
import {
  PASTE_KIND_LABEL,
  applyPasteDrafts,
  draftWhen,
  similarOpenTask,
  type PasteDraft,
  type PasteKind,
} from "../../domain/pasteSplit";
import { adelaideClock } from "../../domain/time";
import type { Task, Workspace } from "../../domain/types";

interface Props {
  text: string;
  tasks: Task[];
  readOnly?: boolean;
  onApply: (change: (w: Workspace) => Workspace) => boolean | void;
  /** Called after a successful save, to close the capture box. */
  onSaved: () => void;
}

type Row = PasteDraft & { key: number; ticked: boolean; editing: boolean };

/** "Split into items": drafts to tick, edit and save. Nothing saves on its own. */
export default function PasteSplitPanel({ text, tasks, readOnly = false, onApply, onSaved }: Props) {
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [removed, setRemoved] = useState(0);
  const [error, setError] = useState("");
  const clock = adelaideClock();

  const split = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await privateRequest("/api/capture/split", { method: "POST", body: JSON.stringify({ text }) });
      const reply = (await response.json().catch(() => null)) as { items?: PasteDraft[]; removed?: number; error?: string } | null;
      if (!response.ok || !reply?.items) {
        setError(reply?.error ?? "It couldn't be split. Save it as one task instead.");
        return;
      }
      setRows(reply.items.map((item, key) => ({ ...item, key, ticked: true, editing: false })));
      setRemoved(reply.removed ?? 0);
    } catch {
      setError("It couldn't be split right now. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  const change = (key: number, patch: Partial<Row>) =>
    setRows(current => current?.map(row => (row.key === key ? { ...row, ...patch } : row)) ?? null);

  const save = () => {
    if (!rows || readOnly) return;
    const chosen = rows.filter(row => row.ticked);
    if (!chosen.length) return;
    const drafts: PasteDraft[] = chosen.map(({ kind, text: t, date, amount, shoppingItems }) => ({
      kind,
      text: t,
      date,
      amount,
      shoppingItems: kind === "shopping" ? t.split(",").map(s => s.trim()).filter(Boolean) : shoppingItems,
    }));
    const ok = onApply(w => applyPasteDrafts(w, drafts, clock.date, clock.minutes, adelaideTimestamp()));
    if (ok === false) {
      setError("That wasn't saved. Check sync and try again.");
      return;
    }
    toast.success(`Saved ${chosen.length} item${chosen.length === 1 ? "" : "s"}.`);
    onSaved();
  };

  if (!rows) {
    return (
      <div className="paste-split">
        <p className="tp-meta">That looks like several things.</p>
        <button type="button" className="tp-big" disabled={busy || readOnly} onClick={() => void split()}>
          {busy ? "Splitting…" : "Split into items"}
        </button>
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  const ticked = rows.filter(row => row.ticked).length;
  return (
    <section className="paste-split" aria-label="Split items">
      <div className="paste-head">
        <span className="tp-title">
          {rows.length} item{rows.length === 1 ? "" : "s"} found
        </span>
        {removed > 0 && (
          <span className="tp-meta">
            Removed {removed} account detail{removed === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <ul className="paste-list">
        {rows.map(row => {
          const when = draftWhen(row, clock.date, clock.minutes);
          const like = row.kind === "task" ? similarOpenTask(row.text, tasks) : null;
          return (
            <li key={row.key} className="paste-row">
              <input
                type="checkbox"
                checked={row.ticked}
                aria-label={`Keep ${row.text}`}
                onChange={e => change(row.key, { ticked: e.target.checked })}
              />
              {row.editing ? (
                <span className="paste-edit">
                  <input
                    value={row.text}
                    maxLength={300}
                    aria-label="Words"
                    onChange={e => change(row.key, { text: e.target.value })}
                  />
                  <select
                    value={row.kind}
                    aria-label="Type"
                    onChange={e => change(row.key, { kind: e.target.value as PasteKind })}
                  >
                    {Object.entries(PASTE_KIND_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {(row.kind === "bill" || row.kind === "cancel-by") && (
                    <input
                      type="date"
                      aria-label={row.kind === "bill" ? "Due date" : "Cancel by"}
                      value={row.date ?? ""}
                      onChange={e => change(row.key, { date: e.target.value || null })}
                    />
                  )}
                  <button type="button" className="tp-btn" onClick={() => change(row.key, { editing: false })}>
                    Done
                  </button>
                </span>
              ) : (
                <button type="button" className="paste-main" onClick={() => change(row.key, { editing: true })}>
                  <span className="paste-text">{row.text}</span>
                  <span className="tp-signals">
                    <span className="tp-chip">{PASTE_KIND_LABEL[row.kind]}</span>
                    {when && <span className="tp-chip">{when}</span>}
                    {like && <span className="tp-meta">looks like “{like.title}”</span>}
                  </span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <div className="tp-now-actions">
        <button type="button" className="tp-big tp-big--second" onClick={() => setRows(null)}>
          Back
        </button>
        <button type="button" className="tp-big" disabled={readOnly || ticked === 0} onClick={save}>
          Save {ticked} ticked
        </button>
      </div>
    </section>
  );
}
