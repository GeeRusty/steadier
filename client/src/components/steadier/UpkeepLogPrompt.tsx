import React, { useState } from "react";
import type { AssetCondition, AssetLogEntry, Workspace } from "../../domain/types";
import {
  addLogEntry,
  ASSET_CONDITIONS,
  CONDITION_LABEL,
  lastReading,
  newAssetLogId,
  parseMeter,
  recordRevisit,
  upkeepForTask,
} from "../../domain/assets";
import { adelaideTimestamp } from "../../../../shared/time";

/**
 * Shown after ticking a task created from Upkeep due: "Log the service now?"
 * (or "Record the check now?"). Not now changes nothing; the item stays in
 * Upkeep due exactly as before.
 */
export default function UpkeepLogPrompt({
  workspace,
  taskId,
  today,
  onMutate,
  onClose,
}: {
  workspace: Workspace;
  taskId: string;
  today: string;
  onMutate: (update: (w: Workspace) => Workspace) => boolean;
  onClose: () => void;
}) {
  const found = upkeepForTask(workspace, taskId);
  const current = found ? lastReading(found.asset) : null;
  const [date, setDate] = useState(today);
  const [reading, setReading] = useState(current ? String(current.value) : "");
  const [condition, setCondition] = useState<AssetCondition | "">("");
  const [problem, setProblem] = useState("");
  if (!found) return null;
  const { asset, kind, refId, what } = found;
  const service = kind === "service";
  const title = service ? "Log the service now?" : "Record the check now?";

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const r = asset.meter && service ? parseMeter(reading) : null;
    if (r === undefined) return setProblem(`Enter the reading as a number of ${asset.meter}, or leave it empty.`);
    if (!service && !condition) return setProblem("Choose the condition you found.");
    const at = adelaideTimestamp();
    const entry: AssetLogEntry = {
      id: newAssetLogId(),
      kind: service ? "service" : "inspection",
      date,
      reading: r,
      cost: null,
      by: "",
      notes: "",
      conditionAfter: condition || null,
      planId: service ? refId : null,
      taskId,
      createdAt: at,
      updatedAt: at,
    };
    let changed = false;
    const ok = onMutate(w => {
      const next = service ? addLogEntry(w, asset.id, entry) : recordRevisit(w, asset.id, refId, entry);
      changed = next !== w;
      return next;
    });
    if (ok && changed) onClose();
    else setProblem("Not saved. It's still in Upkeep due; try again or log it from the asset.");
  };

  return (
    <div className="uk-overlay">
      <button type="button" className="uk-scrim" aria-label="Not now" onClick={onClose} />
      <section className="uk-prompt" role="dialog" aria-modal="true" aria-labelledby="uk-prompt-title">
        <form className="lv-form" onSubmit={save}>
          <h2 id="uk-prompt-title" className="lv-subheading">
            {title}
          </h2>
          <span className="lv-meta">
            {asset.name} · {what}
          </span>
          <span className="lv-inline-form">
            <label className="lv-field">
              Date
              <input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} />
            </label>
            {service && asset.meter && (
              <label className="lv-field">
                {asset.meter === "km" ? "Odometer (km)" : "Engine hours (h)"}
                <input inputMode="decimal" value={reading} onChange={e => setReading(e.target.value)} />
              </label>
            )}
            {!service && (
              <label className="lv-field">
                Condition found
                <select value={condition} onChange={e => setCondition(e.target.value as AssetCondition | "")}>
                  <option value="">Choose…</option>
                  {ASSET_CONDITIONS.filter(c => c !== "unchecked").map(c => (
                    <option key={c} value={c}>
                      {CONDITION_LABEL[c]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </span>
          {problem && (
            <p className="lv-meta av-problem" role="alert">
              {problem}
            </p>
          )}
          <span className="lv-row-actions">
            <button type="submit" className="tp-btn tp-btn-primary" disabled={!date}>
              {service ? "Yes, log it" : "Yes, record it"}
            </button>
            <button type="button" className="tp-btn" onClick={onClose}>
              Not now
            </button>
          </span>
        </form>
      </section>
    </div>
  );
}
