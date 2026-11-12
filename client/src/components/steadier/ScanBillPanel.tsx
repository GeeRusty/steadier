import { useRef, useState } from "react";
import { Camera, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { adelaideTimestamp } from "../../../../shared/time";
import { privateRequest } from "../../lib/cloudApi";
import {
  saveScannedObligations,
  scanFormFrom,
  scanTitle,
  type ScanForm,
  type ScanReply,
} from "../../domain/billScan";
import { defaultLeadTimeDays } from "../../domain/obligations";
import type { ObligationCadence, ObligationKind, Workspace } from "../../domain/types";
import { CADENCE_LABEL, KIND_LABEL } from "./obligationLabels";

interface Props {
  day: string;
  readOnly: boolean;
  onMutate: (change: (workspace: Workspace) => Workspace) => boolean | void;
}

const MAX_SIDE = 2000;

/** Shrink the photo on the phone and return it as a JPEG data URL. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't prepare the photo.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.85);
    canvas.width = 0;
    canvas.height = 0;
    return url;
  } finally {
    bitmap.close();
  }
}

function dateLabel(kind: ObligationKind): string {
  return kind === "cancel-by" ? "Cancel by" : kind === "renewal" ? "Renewal date" : "Due date";
}

export default function ScanBillPanel({ day, readOnly, onMutate }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ScanForm | null>(null);
  const [removed, setRemoved] = useState(0);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState("");

  const reset = () => {
    setForm(null);
    setRemoved(0);
    setNotes([]);
    setError("");
  };

  const read = async (file: File | undefined) => {
    // Let go of the picked file straight away; only the shrunk copy is sent.
    if (input.current) input.current.value = "";
    if (!file) return;
    reset();
    setBusy(true);
    let image: string | null = null;
    try {
      image = await shrink(file);
      const response = await privateRequest("/api/obligations/scan", {
        method: "POST",
        body: JSON.stringify({ image }),
      });
      image = null;
      const reply = (await response.json().catch(() => null)) as (ScanReply & { error?: string }) | null;
      if (!response.ok || !reply || reply.error) {
        setError(reply?.error ?? "The bill couldn't be read. Try again, or add it by hand.");
        return;
      }
      setForm(scanFormFrom(reply, day));
      setRemoved(reply.removed);
      setNotes(reply.notes);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The bill couldn't be read.");
    } finally {
      image = null;
      setBusy(false);
    }
  };

  const change = <K extends keyof ScanForm>(key: K, value: ScanForm[K]) =>
    setForm(current => (current ? { ...current, [key]: value } : current));

  const save = () => {
    if (!form || readOnly) return;
    try {
      const accepted = onMutate(current => saveScannedObligations(current, form, adelaideTimestamp()));
      if (accepted === false) {
        setError("That wasn't saved. Check sync and try again.");
        return;
      }
      toast.success(form.extra && form.addExtra ? "Two drafts saved." : "Draft saved.");
      reset();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That wasn't saved.");
    }
  };

  return (
    <>
      <button
        type="button"
        className="button secondary"
        onClick={() => input.current?.click()}
        disabled={readOnly || busy}
      >
        <Camera size={16} /> {busy ? "Reading…" : "Scan a bill"}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/*"
        hidden
        aria-label="Bill photo"
        onChange={event => void read(event.target.files?.[0])}
      />
      {error && !form && (
        <p className="error small scan-bill-error" role="alert">
          {error}
        </p>
      )}
      {form && (
        <section className="settings-section obligation-editor scan-bill" aria-labelledby="scan-bill-title">
          <div className="eyebrow">SCAN A BILL · CHECK BEFORE SAVING</div>
          <h2 id="scan-bill-title">Check what was read</h2>
          <p className="small muted scan-bill-privacy">
            <ShieldCheck size={15} /> The photo is already gone: it was read on your server and deleted.
            Only cleaned text went to Claude.
            {removed > 0 &&
              ` Removed ${removed} thing${removed === 1 ? "" : "s"} that looked like account details or an address.`}
          </p>
          {notes.map(note => (
            <p className="small notice" key={note}>
              {note}
            </p>
          ))}
          <div className="obligation-form-grid">
            <label className="field">
              Provider
              <input value={form.provider} maxLength={80} onChange={e => change("provider", e.target.value)} />
            </label>
            <label className="field">
              What it's for
              <input value={form.forWhat} maxLength={80} onChange={e => change("forWhat", e.target.value)} />
            </label>
            <label className="field">
              Type
              <select
                value={form.kind}
                onChange={e => {
                  const kind = e.target.value as ObligationKind;
                  setForm(current =>
                    current ? { ...current, kind, leadTimeDays: defaultLeadTimeDays(kind) } : current
                  );
                }}
              >
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {dateLabel(form.kind)}
              <input type="date" value={form.dueDate} onChange={e => change("dueDate", e.target.value)} />
            </label>
            <label className="field">
              How often
              <select value={form.cadence} onChange={e => change("cadence", e.target.value as ObligationCadence)}>
                {Object.entries(CADENCE_LABEL).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Amount (optional note)
              <input value={form.amount} maxLength={100} onChange={e => change("amount", e.target.value)} />
            </label>
            <label className="field">
              Remind me (days before)
              <input
                type="number"
                min={0}
                max={365}
                step={1}
                value={form.leadTimeDays}
                onChange={e => change("leadTimeDays", Number(e.target.value))}
              />
            </label>
          </div>
          {form.extra && (
            <label className="check-row">
              <input type="checkbox" checked={form.addExtra} onChange={e => change("addExtra", e.target.checked)} />
              Also add a {KIND_LABEL[form.extra.kind]} on {form.extra.dueDate}
            </label>
          )}
          <p className="small muted">
            Saved as a draft named “{scanTitle(form) || "…"}”. Link it to a Pillar or Imperative and activate it
            when you're ready.
          </p>
          {error && (
            <p className="error small" role="alert">
              {error}
            </p>
          )}
          <div className="choice-row obligation-form-actions">
            <button className="text-button" type="button" onClick={reset}>
              Cancel
            </button>
            <span className="obligation-form-spacer" />
            <button
              className="button primary"
              type="button"
              onClick={save}
              disabled={readOnly || !scanTitle(form) || !form.dueDate}
            >
              Save draft
            </button>
          </div>
        </section>
      )}
    </>
  );
}
