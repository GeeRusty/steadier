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
import { photosOf } from "../../domain/photos";
import { LocalPreview, PhotoThumb, SlotInputs } from "./PhotoPrompts";

/**
 * Shown after ticking a task created from Upkeep due: "Log the service now?"
 * (or "Record the check now?"). Not now changes nothing; the item stays in
 * Upkeep due exactly as before.
 *
 * One sheet, not two (owner, 2026-11-15): it also holds the optional After
 * photo, so an Upkeep task never gets a separate "Add an after photo?".
 * The photo is saved only with Yes; Not now changes nothing, photo included.
 */
export default function UpkeepLogPrompt({
  workspace,
  taskId,
  today,
  onMutate,
  onClose,
  onAfterPhoto,
}: {
  workspace: Workspace;
  taskId: string;
  today: string;
  onMutate: (update: (w: Workspace) => Workspace) => boolean;
  onClose: () => void;
  /** Saves the chosen photo on the task, labelled After. */
  onAfterPhoto?: (file: File) => void;
}) {
  const found = upkeepForTask(workspace, taskId);
  const current = found ? lastReading(found.asset) : null;
  const [date, setDate] = useState(today);
  const [reading, setReading] = useState(current ? String(current.value) : "");
  const [condition, setCondition] = useState<AssetCondition | "">("");
  const [problem, setProblem] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  if (!found) return null;
  const before = photosOf(workspace.tasks.find(t => t.id === taskId)).find(p => p.label === "before");
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
    if (ok && changed) {
      if (photo && onAfterPhoto) onAfterPhoto(photo);
      onClose();
    }
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
          {onAfterPhoto && (
            <SlotInputs onPick={setPhoto}>
              {open => (
                <div className="ph-upkeep">
                  <span className="lv-meta">After photo (optional)</span>
                  <span className="ph-slots">
                    {before && <PhotoThumb photo={before} label="Before" />}
                    {photo ? (
                      <LocalPreview file={photo} label="After" />
                    ) : (
                      <button type="button" className="ph-slot ph-slot-add" onClick={open.camera}>
                        Add
                      </button>
                    )}
                    <span className="lv-meta ph-slot-note">
                      {photo ? (
                        <button type="button" className="text-button" onClick={() => setPhoto(null)}>
                          Remove
                        </button>
                      ) : (
                        <>
                          <button type="button" className="text-button" onClick={open.gallery}>
                            Choose from gallery
                          </button>
                          <br />
                          Saved with Yes, on the log entry.
                        </>
                      )}
                    </span>
                  </span>
                </div>
              )}
            </SlotInputs>
          )}
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
