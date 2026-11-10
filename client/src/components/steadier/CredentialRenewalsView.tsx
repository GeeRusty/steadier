import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Mic,
  Pencil,
  Plus,
  Square,
  Trash2,
  Volume2,
} from "lucide-react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { adelaideTimestamp } from "../../../../shared/time";
import {
  CREDENTIAL_RENEWAL_CATEGORIES,
  MAX_CREDENTIAL_RENEWALS,
  MAX_CREDENTIAL_RENEWAL_NAME_LENGTH,
  MAX_CREDENTIAL_RENEWAL_NOTES_LENGTH,
  MAX_CREDENTIAL_RENEWAL_PURPOSE_LENGTH,
  createCredentialRenewal,
  deleteCredentialRenewal,
  normalizeCredentialRenewalInput,
  updateCredentialRenewal,
} from "../../domain/credentialRenewals";
import type { VoiceControls } from "../../hooks/useVoice";
import type {
  CredentialRenewal,
  CredentialRenewalCategory,
  CredentialRenewalInput,
  Workspace,
} from "../../domain/types";
import { groupByStable, monthGroup } from "../../domain/accordionGroups";
import AccordionSection from "./AccordionSection";

interface Props {
  workspace: Workspace;
  day: string;
  readOnly: boolean;
  voice: VoiceControls;
  onMutate: (change: (workspace: Workspace) => Workspace) => boolean | void;
}

const CATEGORY_LABEL: Record<CredentialRenewalCategory, string> = {
  licence: "Licence",
  "professional-registration": "Professional registration",
  certificate: "Certificate",
  permit: "Permit",
  "identity-document": "Identity document",
  "other-credential": "Other credential",
};

type Draft = CredentialRenewalInput;
type TextField = "name" | "purpose" | "notes";

function dayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? day
    : new Intl.DateTimeFormat("en-AU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}

function dayDifference(date: string, today: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  return Math.round(
    (Date.UTC(year, month - 1, day) -
      Date.UTC(todayYear, todayMonth - 1, todayDay)) /
      86_400_000
  );
}

function dueLabel(date: string, today: string): string {
  const difference = dayDifference(date, today);
  if (difference < 0) return `Past date · ${Math.abs(difference)} days ago`;
  if (difference === 0) return "Renewal date is today";
  if (difference === 1) return "Renewal date is tomorrow";
  return `In ${difference} days`;
}

function recordName(record: CredentialRenewal): string {
  return record.name?.trim() || CATEGORY_LABEL[record.category];
}

export default function CredentialRenewalsView({
  workspace,
  day,
  readOnly,
  voice,
  onMutate,
}: Props) {
  const records = workspace.credentialRenewals ?? [];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dictatingNotes, setDictatingNotes] = useState(false);
  const [query, setQuery] = useState("");
  const dictatingNotesRef = useRef(false);
  const ordered = useMemo(
    () =>
      [...records].sort((left, right) =>
        left.renewalDate.localeCompare(right.renewalDate)
      ),
    [records]
  );
  const visibleRecords = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-AU");
    return ordered.filter(
      record =>
        !needle ||
        `${recordName(record)} ${CATEGORY_LABEL[record.category]} ${record.purpose ?? ""} ${record.notes ?? ""} ${record.renewalDate}`
          .toLocaleLowerCase("en-AU")
          .includes(needle)
    );
  }, [ordered, query]);
  const renewalGroups = useMemo(
    () =>
      groupByStable(visibleRecords, record => monthGroup(record.renewalDate)),
    [visibleRecords]
  );

  useEffect(() => {
    if (!dictatingNotes || voice.listening) return;
    const finalText = voice.finalTranscript.trim();
    if (finalText) {
      setDraft(current => {
        if (!current) return current;
        const existing = current.notes.trimEnd();
        return {
          ...current,
          notes: existing ? `${existing}\n${finalText}` : finalText,
        };
      });
      setError("");
      toast.success("Final speech added to Notes. Review it before saving.");
    } else {
      setError(
        voice.error ||
          "No final speech was received. Interim words were discarded; nothing was added."
      );
    }
    dictatingNotesRef.current = false;
    setDictatingNotes(false);
    voice.clear();
  }, [
    dictatingNotes,
    voice.clear,
    voice.error,
    voice.finalTranscript,
    voice.listening,
  ]);

  useEffect(
    () => () => {
      if (dictatingNotesRef.current) {
        voice.abort();
        voice.clear();
      }
      voice.stopSpeaking();
    },
    [voice.abort, voice.clear, voice.stopSpeaking]
  );

  function cancelNotesDictation() {
    if (!dictatingNotesRef.current) return;
    dictatingNotesRef.current = false;
    setDictatingNotes(false);
    voice.abort();
    voice.clear();
  }

  function openNew() {
    cancelNotesDictation();
    if (voice.speaking) voice.stopSpeaking();
    setDraft({
      category: "licence",
      renewalDate: day,
      name: "",
      purpose: "",
      notes: "",
    });
    setEditingId(null);
    setError("");
  }

  function openEdit(record: CredentialRenewal) {
    cancelNotesDictation();
    if (voice.speaking) voice.stopSpeaking();
    setDraft({
      category: record.category,
      renewalDate: record.renewalDate,
      name: record.name?.trim() || CATEGORY_LABEL[record.category],
      purpose: record.purpose ?? "",
      notes: record.notes ?? "",
    });
    setEditingId(record.id);
    setError("");
  }

  function closeForm() {
    cancelNotesDictation();
    setDraft(null);
    setEditingId(null);
    setError("");
  }

  function updateTextField(field: TextField, value: string) {
    if (field === "notes") cancelNotesDictation();
    setDraft(current => (current ? { ...current, [field]: value } : current));
  }

  function toggleNotesDictation() {
    if (!draft || readOnly) return;
    if (dictatingNotesRef.current) {
      if (voice.listening) voice.stop();
      return;
    }
    if (!voice.supported) {
      setError("Microphone dictation is not available in this browser.");
      return;
    }
    if (voice.listening) {
      setError("Finish the other voice action before dictating renewal notes.");
      return;
    }
    if (voice.speaking) voice.stopSpeaking();
    voice.clear();
    setError("");
    dictatingNotesRef.current = true;
    setDictatingNotes(true);
    voice.start();
  }

  function save() {
    if (!draft || readOnly) return;
    if (dictatingNotesRef.current || voice.listening) {
      setError("Finish dictation and review its final text before saving.");
      return;
    }
    const normalized = normalizeCredentialRenewalInput(draft);
    if (!normalized) {
      setError(
        `Add a name and check the length limits: name ${MAX_CREDENTIAL_RENEWAL_NAME_LENGTH}, purpose ${MAX_CREDENTIAL_RENEWAL_PURPOSE_LENGTH}, notes ${MAX_CREDENTIAL_RENEWAL_NOTES_LENGTH} characters.`
      );
      return;
    }
    const at = adelaideTimestamp();
    let unchanged = false;
    const accepted = onMutate(current => {
      const updated = editingId
        ? updateCredentialRenewal(current, editingId, normalized, at)
        : createCredentialRenewal(current, normalized, nanoid(), at);
      unchanged = updated === current;
      return updated;
    });
    if (accepted === false || unchanged) {
      setError(
        editingId
          ? "This renewal entry changed elsewhere or could not be saved. Refresh and review it before trying again."
          : "That entry was not saved. Check the record limit, sync and try again."
      );
      return;
    }
    closeForm();
    toast.success(
      editingId ? "Renewal entry updated." : "Renewal entry saved."
    );
  }

  function remove(record: CredentialRenewal) {
    if (readOnly) return;
    if (
      !window.confirm(
        `Delete “${recordName(record)}”? This removes only its renewal-register entry and does not change any task.`
      )
    ) {
      return;
    }
    let unchanged = false;
    const accepted = onMutate(current => {
      const updated = deleteCredentialRenewal(current, record.id);
      unchanged = updated === current;
      return updated;
    });
    if (accepted === false || unchanged)
      toast.error(
        "That renewal entry was not deleted. Check sync and try again."
      );
    else toast.success("Renewal entry deleted.");
  }

  function readDates() {
    if (voice.speaking) {
      voice.stopSpeaking();
      return;
    }
    if (!ordered.length) return;
    voice.read(
      `Credential renewal dates. ${ordered
        .map(
          record =>
            `${recordName(record)}, ${dayLabel(record.renewalDate)}, ${dueLabel(record.renewalDate, day)}.`
        )
        .join(" ")}`
    );
  }

  return (
    <section
      className="credential-renewals-view"
      aria-labelledby="credential-renewals-title"
    >
      <header className="page-heading credential-renewals-heading">
        <div>
          <div className="eyebrow">
            NON-SECRET RENEWAL TRACKER · NOT A VAULT
          </div>
          <h1 id="credential-renewals-title">Credential renewal dates</h1>
          <p>
            Name what the renewal is for, add optional notes, and keep the due
            date visible without storing the credential itself.
          </p>
        </div>
        <div className="credential-renewals-actions">
          {voice.speechSupported && (
            <button
              className="button secondary"
              type="button"
              onClick={readDates}
              disabled={!ordered.length || dictatingNotes || voice.listening}
              aria-label={
                voice.speaking
                  ? "Stop reading renewal dates"
                  : "Read renewal dates aloud"
              }
            >
              <Volume2 size={15} />
              {voice.speaking ? "Stop reading" : "Read dates aloud"}
            </button>
          )}
          <button
            className="button primary"
            type="button"
            onClick={openNew}
            disabled={readOnly || records.length >= MAX_CREDENTIAL_RENEWALS}
          >
            <Plus size={16} /> Add renewal entry
          </button>
        </div>
      </header>

      <div className="notice small credential-renewals-disclosure">
        Names, purpose and notes are saved in the shared Workspace and included
        in its normal backups. This entire register stays out of Claude/ChatGPT
        context and the Server sheet. Keep entries general: do not enter
        passwords, tokens, recovery codes, credential or account numbers,
        document copies, provider links or sensitive personal details. Nothing
        creates a task or reminder automatically.
      </div>

      {readOnly && (
        <div className="notice small" role="status">
          This Workspace is read-only while shared data is loading or needs
          recovery. You can review entries, but changes are disabled.
        </div>
      )}

      {draft && (
        <section
          className="settings-section credential-renewal-editor"
          aria-labelledby="credential-renewal-form-title"
        >
          <div className="section-heading">
            <div>
              <div className="eyebrow">
                {editingId ? "EDIT RENEWAL" : "NEW RENEWAL"}
              </div>
              <h2 id="credential-renewal-form-title">
                {editingId ? "Edit renewal entry" : "Add a renewal entry"}
              </h2>
            </div>
          </div>
          <p className="small muted">
            Use a non-secret label and general purpose only. Do not store the
            credential, its identifying numbers, or sensitive personal details.
          </p>
          <div className="credential-renewal-fields">
            <label className="field credential-renewal-wide">
              Name
              <input
                type="text"
                value={draft.name}
                maxLength={MAX_CREDENTIAL_RENEWAL_NAME_LENGTH}
                autoComplete="off"
                placeholder="For example, Work licence"
                onChange={event => updateTextField("name", event.target.value)}
                disabled={readOnly}
                required
              />
            </label>
            <label className="field">
              Generic type
              <select
                value={draft.category}
                onChange={event =>
                  setDraft(current =>
                    current
                      ? {
                          ...current,
                          category: event.target
                            .value as CredentialRenewalCategory,
                        }
                      : current
                  )
                }
                disabled={readOnly}
              >
                {CREDENTIAL_RENEWAL_CATEGORIES.map(category => (
                  <option key={category} value={category}>
                    {CATEGORY_LABEL[category]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Renewal date
              <input
                type="date"
                value={draft.renewalDate}
                onChange={event =>
                  setDraft(current =>
                    current
                      ? { ...current, renewalDate: event.target.value }
                      : current
                  )
                }
                disabled={readOnly}
              />
            </label>
            <label className="field credential-renewal-wide">
              What it’s for <span className="small muted">(optional)</span>
              <textarea
                value={draft.purpose}
                maxLength={MAX_CREDENTIAL_RENEWAL_PURPOSE_LENGTH}
                rows={2}
                placeholder="A short, general description"
                onChange={event =>
                  updateTextField("purpose", event.target.value)
                }
                disabled={readOnly}
              />
              <span className="small muted credential-renewal-length">
                {draft.purpose.length}/{MAX_CREDENTIAL_RENEWAL_PURPOSE_LENGTH}
              </span>
            </label>
            <div className="credential-renewal-notes-field credential-renewal-wide">
              <label htmlFor="credential-renewal-notes">Notes (optional)</label>
              <textarea
                id="credential-renewal-notes"
                value={draft.notes}
                maxLength={MAX_CREDENTIAL_RENEWAL_NOTES_LENGTH}
                rows={4}
                placeholder="General renewal notes only — no passwords or ID numbers"
                onChange={event => updateTextField("notes", event.target.value)}
                disabled={readOnly}
              />
              <div className="credential-renewal-notes-toolbar">
                <span className="small muted">
                  {draft.notes.length}/{MAX_CREDENTIAL_RENEWAL_NOTES_LENGTH}
                  {voice.supported &&
                    " · Optional dictation copies only final speech; review and edit before saving."}
                </span>
                {voice.supported && (
                  <button
                    className="button secondary credential-renewal-dictate"
                    type="button"
                    onClick={toggleNotesDictation}
                    disabled={
                      readOnly ||
                      (dictatingNotes && !voice.listening) ||
                      (voice.listening && !dictatingNotes)
                    }
                    aria-label={
                      dictatingNotes
                        ? voice.listening
                          ? "Finish notes dictation"
                          : "Finish notes dictation"
                        : "Dictate renewal notes"
                    }
                  >
                    {dictatingNotes ? <Square size={14} /> : <Mic size={15} />}
                    {dictatingNotes
                      ? voice.listening
                        ? "Finish dictation"
                        : "Finishing…"
                      : "Dictate notes"}
                  </button>
                )}
              </div>
              {dictatingNotes && (
                <p
                  className="small muted credential-renewal-voice-status"
                  role="status"
                >
                  {voice.listening
                    ? "Listening. Press Finish dictation; only a final result is copied into Notes."
                    : "Finalizing speech… wait for the editable text to appear."}
                </p>
              )}
              {voice.supported && (
                <p className="small muted credential-renewal-voice-disclosure">
                  Dictation starts only when you press the button. Browser
                  speech recognition may process audio with its provider.
                  Nothing is saved until you choose Save.
                </p>
              )}
              {!voice.supported && (
                <p className="small muted credential-renewal-voice-disclosure">
                  Microphone dictation is not available in this browser; you can
                  type notes instead.
                </p>
              )}
            </div>
          </div>
          {(error || (dictatingNotes && voice.error)) && (
            <p className="error small" role="alert">
              {error || voice.error}
            </p>
          )}
          <div className="choice-row credential-renewal-form-actions">
            <button className="text-button" type="button" onClick={closeForm}>
              Cancel
            </button>
            <span className="credential-renewal-spacer" />
            <button
              className="button primary"
              type="button"
              onClick={save}
              disabled={
                readOnly ||
                !draft.name.trim() ||
                !draft.renewalDate ||
                dictatingNotes ||
                voice.listening
              }
            >
              {editingId ? "Save changes" : "Save renewal entry"}
            </button>
          </div>
        </section>
      )}

      <div className="credential-renewal-count">
        {ordered.length} renewal entr{ordered.length === 1 ? "y" : "ies"}
      </div>
      {ordered.length > 0 && (
        <label className="field accordion-search">
          <span>Search renewal dates</span>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Name, purpose, notes or date"
          />
        </label>
      )}
      {ordered.length === 0 ? (
        <section className="empty-state credential-renewal-empty">
          <CalendarDays size={30} />
          <h2>Nothing to renew is recorded.</h2>
          <p>
            Add a name, generic type and date, with optional purpose and notes.
            Keep passwords and identifying numbers elsewhere.
          </p>
          <button
            className="button secondary"
            type="button"
            onClick={openNew}
            disabled={readOnly}
          >
            <Plus size={16} /> Add renewal entry
          </button>
        </section>
      ) : visibleRecords.length === 0 ? (
        <div className="empty-state credential-renewal-empty">
          <CalendarDays size={28} />
          <h2>No renewal entries match this search.</h2>
          <p>Try another name, purpose, note or date.</p>
        </div>
      ) : (
        <div className="accordion-group-list credential-renewal-list">
          {renewalGroups.map((group, index) => (
            <AccordionSection
              key={group.key}
              persistenceKey={group.key}
              title={group.label}
              count={group.items.length}
              collapsible={visibleRecords.length > 5}
              defaultOpen={
                index === 0 ||
                group.items.some(record => record.renewalDate <= day)
              }
              autoOpen={group.items.some(record => record.renewalDate <= day)}
              revealToken={query && group.items.length ? query : ""}
              className="credential-renewal-month-group"
            >
              <div className="credential-renewal-month-list">
                {group.items.map(record => (
            <article
              className="settings-section credential-renewal-card"
              key={record.id}
            >
              <div className="credential-renewal-copy">
                      <div className="eyebrow">
                        {CATEGORY_LABEL[record.category]}
                      </div>
                <h2>{recordName(record)}</h2>
                {record.purpose?.trim() && (
                        <p className="credential-renewal-purpose">
                          {record.purpose}
                        </p>
                )}
                <p className="small muted credential-renewal-due">
                  {dayLabel(record.renewalDate)} ·{" "}
                  {dueLabel(record.renewalDate, day)}
                </p>
                {record.notes?.trim() && (
                  <details className="credential-renewal-notes-preview">
                    <summary>Notes</summary>
                    <p>{record.notes}</p>
                  </details>
                )}
              </div>
              <div className="credential-renewal-card-actions">
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Edit ${recordName(record)} renewal entry`}
                  onClick={() => openEdit(record)}
                  disabled={readOnly}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Delete ${recordName(record)} renewal entry`}
                  onClick={() => remove(record)}
                  disabled={readOnly}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
            </AccordionSection>
          ))}
        </div>
      )}
      {!voice.speechSupported && (
        <p className="small muted credential-renewal-voice-note">
          Read-aloud is not available in this browser.
        </p>
      )}
    </section>
  );
}
