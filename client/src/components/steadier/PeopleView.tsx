import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  CalendarDays,
  Mic,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  UserRound,
  Volume2,
  X,
} from "lucide-react";
import { nanoid } from "nanoid";
import { adelaideTimestamp } from "../../../../shared/time";
import {
  createContact,
  deleteContact,
  MAX_PEOPLE,
  normalizeContactInput,
  setContactArchived,
  updateContact,
  type ContactInput,
} from "../../domain/people";
import type { Workspace, WorkspaceContact } from "../../domain/types";
import { groupByStable } from "../../domain/accordionGroups";
import AccordionSection from "./AccordionSection";
import type { VoiceControls } from "../../hooks/useVoice";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";

interface Props {
  workspace: Workspace;
  day: string;
  readOnly: boolean;
  onMutate: (update: (workspace: Workspace) => Workspace) => boolean;
  voice: VoiceControls;
}

const blankContact = (): ContactInput => ({
  name: "",
  relationship: "",
  context: "",
  lastContactDate: null,
  nextContactDate: null,
  birthdayMonthDay: null,
});

function displayDate(value: string | null): string {
  if (!value) return "Not set";
  const time = Date.parse(`${value}T12:00:00Z`);
  if (!Number.isFinite(time)) return "Date not recorded";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Adelaide",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(time);
}

function displayBirthday(value?: string | null): string {
  if (!value) return "";
  const [month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Adelaide",
    day: "numeric",
    month: "long",
  }).format(new Date(2000, month - 1, day, 12));
}

function followUpState(value: string | null, day: string) {
  if (!value) return { label: "No follow-up date", state: "none" as const };
  if (value < day)
    return {
      label: `Overdue · ${displayDate(value)}`,
      state: "overdue" as const,
    };
  if (value === day) return { label: "Due today", state: "today" as const };
  return { label: `Next · ${displayDate(value)}`, state: "upcoming" as const };
}

export default function PeopleView({
  workspace,
  day,
  readOnly,
  onMutate,
  voice,
}: Props) {
  const people = workspace.people ?? [];
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContactInput>(blankContact);
  const [formError, setFormError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [isDictating, setIsDictating] = useState(false);
  const dictationActive = useRef(false);

  useEffect(() => {
    if (dictationActive.current && voice.transcript) {
      setDraft(current => ({ ...current, context: voice.transcript }));
    }
  }, [voice.transcript]);

  useEffect(
    () => () => {
      dictationActive.current = false;
      voice.abort();
      voice.clear();
      voice.stopSpeaking();
    },
    [voice.abort, voice.clear, voice.stopSpeaking]
  );

  const transcriptPending =
    dictationActive.current &&
    (voice.listening ||
      Boolean(voice.interimTranscript.trim()) ||
      !voice.finalTranscript.trim() ||
      voice.finalTranscript.trim() !== draft.context.trim());

  const visiblePeople = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return people
      .filter(person => (person.status === "archived") === showArchived)
      .filter(
        person =>
          !needle ||
          person.name.toLocaleLowerCase().includes(needle) ||
          person.relationship.toLocaleLowerCase().includes(needle) ||
          person.context.toLocaleLowerCase().includes(needle)
      )
      .sort((left, right) => {
        const leftDate = left.nextContactDate ?? "9999-12-31";
        const rightDate = right.nextContactDate ?? "9999-12-31";
        return (
          leftDate.localeCompare(rightDate) ||
          left.name.localeCompare(right.name)
        );
      });
  }, [people, query, showArchived]);

  const dueCount = people.filter(
    person =>
      person.status === "active" &&
      person.nextContactDate !== null &&
      person.nextContactDate <= day
  ).length;
  const peopleGroups = groupByStable(visiblePeople, person => {
    const state = followUpState(person.nextContactDate, day).state;
    const labels: Record<typeof state, string> = {
      overdue: "Overdue follow-ups",
      today: "Due today",
      upcoming: "Upcoming follow-ups",
      none: "No follow-up date",
    };
    return { key: state, label: labels[state] };
  });

  function resetForm() {
    dictationActive.current = false;
    setIsDictating(false);
    voice.abort();
    voice.clear();
    setFormOpen(false);
    setEditingId(null);
    setDraft(blankContact());
    setFormError("");
    setStatusMessage("");
  }

  function openNewForm() {
    resetForm();
    setFormOpen(true);
  }

  function openEditForm(person: WorkspaceContact) {
    resetForm();
    setEditingId(person.id);
    setDraft({
      name: person.name,
      relationship: person.relationship,
      context: person.context,
      lastContactDate: person.lastContactDate,
      nextContactDate: person.nextContactDate,
      birthdayMonthDay: person.birthdayMonthDay ?? null,
    });
    setFormOpen(true);
  }

  function startDictation() {
    if (!voice.supported) {
      setFormError("Voice dictation is not available in this browser.");
      return;
    }
    voice.clear();
    dictationActive.current = true;
    setIsDictating(true);
    setFormError("");
    voice.start();
  }

  function stopDictation() {
    voice.stop();
    setIsDictating(false);
  }

  function editContext(value: string) {
    if (dictationActive.current) {
      dictationActive.current = false;
      voice.abort();
      voice.clear();
      setIsDictating(false);
    }
    setDraft(current => ({ ...current, context: value }));
  }

  function saveContact() {
    const normalized = normalizeContactInput(draft);
    if (!normalized) {
      setFormError(
        "Enter a name, keep each field within its limit, and use valid dates."
      );
      return;
    }
    if (voice.listening || transcriptPending) {
      setFormError(
        "Stop dictation and review the final transcript before saving."
      );
      return;
    }
    if (!editingId && people.length >= MAX_PEOPLE) {
      setFormError(
        `This Workspace already contains ${MAX_PEOPLE} people records.`
      );
      return;
    }
    const at = adelaideTimestamp();
    const accepted = onMutate(current =>
      editingId
        ? updateContact(current, editingId, normalized, at)
        : createContact(current, normalized, nanoid(), at)
    );
    if (!accepted) {
      setFormError(
        "This Workspace is read-only or unavailable; the record was not saved."
      );
      return;
    }
    const successMessage = editingId
      ? "People record updated."
      : "People record saved.";
    resetForm();
    setStatusMessage(successMessage);
  }

  function markContacted(person: WorkspaceContact) {
    const at = adelaideTimestamp();
    const input: ContactInput = {
      name: person.name,
      relationship: person.relationship,
      context: person.context,
      lastContactDate: day,
      nextContactDate: person.nextContactDate,
      birthdayMonthDay: person.birthdayMonthDay ?? null,
    };
    if (!onMutate(current => updateContact(current, person.id, input, at))) {
      setStatusMessage(
        "This Workspace is read-only or unavailable; no change was made."
      );
      return;
    }
    setStatusMessage(
      `Marked ${person.name} as contacted today. No message was sent.`
    );
  }

  function toggleArchived(person: WorkspaceContact) {
    if (
      !onMutate(current =>
        setContactArchived(
          current,
          person.id,
          person.status === "active",
          adelaideTimestamp()
        )
      )
    ) {
      setStatusMessage(
        "This Workspace is read-only or unavailable; no change was made."
      );
      return;
    }
    setStatusMessage(
      person.status === "active"
        ? "People record archived."
        : "People record restored."
    );
  }

  function confirmDelete(personId: string) {
    if (!onMutate(current => deleteContact(current, personId))) {
      setStatusMessage(
        "This Workspace is read-only or unavailable; the record was not removed."
      );
      return;
    }
    setPendingDelete(null);
    setStatusMessage("People record removed from the current Workspace.");
  }

  return (
    <section className="people-view">
      <header className="people-header">
        <div>
          <p className="people-eyebrow">Relationships, at your pace</p>
          <h1>People &amp; Follow-ups</h1>
          <p className="people-summary">
            {dueCount
              ? `${dueCount} follow-up${dueCount === 1 ? "" : "s"} due or overdue`
              : "No follow-ups due"}
            {" · "}
            {people.filter(person => person.status === "active").length} active
          </p>
        </div>
        <button
          type="button"
          className="people-button people-button-primary"
          onClick={openNewForm}
          disabled={readOnly || people.length >= MAX_PEOPLE}
        >
          <Plus size={16} /> Add person
        </button>
      </header>

      <p className="people-notice">
        Keep only the details you need: name, relationship, a short context note
        and optional contact dates. No phone, email, address, contact import,
        messaging or automatic task creation. Records sync and back up with this
        Workspace, but are excluded from Claude/ChatGPT context and the Server
        sheet. Voice is opt-in and editable.
      </p>

      {statusMessage && (
        <p className="people-status" role="status">
          {statusMessage}
        </p>
      )}

      {formOpen && (
        <form
          className="people-form"
          onSubmit={event => {
            event.preventDefault();
            saveContact();
          }}
        >
          <div className="people-form-heading">
            <div>
              <p className="people-eyebrow">Owner-entered record</p>
              <h2>{editingId ? "Edit person" : "Add person"}</h2>
            </div>
            <button
              type="button"
              className="people-icon-button"
              onClick={resetForm}
              aria-label="Close form"
            >
              <X size={18} />
            </button>
          </div>
          <div className="people-form-grid">
            <label className="people-field">
              Name
              <input
                value={draft.name}
                maxLength={120}
                autoComplete="off"
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                disabled={readOnly}
                required
              />
            </label>
            <label className="people-field">
              Relationship
              <input
                value={draft.relationship}
                maxLength={80}
                autoComplete="off"
                placeholder="e.g. friend, colleague, neighbour"
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    relationship: event.target.value,
                  }))
                }
                disabled={readOnly}
              />
            </label>
            <label className="people-field">
              Last contact date
              <input
                type="date"
                value={draft.lastContactDate ?? ""}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    lastContactDate: event.target.value || null,
                  }))
                }
                disabled={readOnly}
              />
            </label>
            <label className="people-field">
              Next follow-up date
              <input
                type="date"
                value={draft.nextContactDate ?? ""}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    nextContactDate: event.target.value || null,
                  }))
                }
                disabled={readOnly}
              />
            </label>
            <label className="people-field">
              Birthday (month and day only)
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="MM-DD"
                pattern="[0-9]{2}-[0-9]{2}"
                maxLength={5}
                value={draft.birthdayMonthDay ?? ""}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    birthdayMonthDay: event.target.value || null,
                  }))
                }
                disabled={readOnly}
                aria-describedby="people-birthday-help"
              />
              <span id="people-birthday-help" className="people-help">
                Optional. The birth year is not stored.
              </span>
            </label>
          </div>
          <label className="people-field people-context-field">
            Context note
            <textarea
              value={draft.context}
              maxLength={2000}
              rows={4}
              onChange={event => editContext(event.target.value)}
              disabled={readOnly}
              placeholder="Short reminder for yourself; text is stored as data."
            />
          </label>
          <div className="people-form-actions">
            <button
              type="button"
              className="people-button people-button-secondary"
              onClick={isDictating ? stopDictation : startDictation}
              disabled={readOnly || !voice.supported}
            >
              {isDictating ? <X size={16} /> : <Mic size={16} />}
              {isDictating ? "Stop dictation" : "Dictate context"}
            </button>
            {voice.error && <span className="people-error">{voice.error}</span>}
            <span className="people-form-spacer" />
            <button
              type="button"
              className="people-button people-button-secondary"
              onClick={resetForm}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="people-button people-button-primary"
              disabled={readOnly || voice.listening || transcriptPending}
            >
              <Save size={16} /> Save record
            </button>
          </div>
          {formError && (
            <p className="people-error" role="alert">
              {formError}
            </p>
          )}
          {isDictating && (
            <p className="people-help">
              Dictation is active by your request. Review and edit the
              transcript before saving.
            </p>
          )}
        </form>
      )}

      <div className="people-toolbar">
        <label className="people-search">
          <span>Find a person</span>
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search name, relationship or context"
          />
        </label>
        <label className="people-archived-toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={event => setShowArchived(event.target.checked)}
          />
          Show archived
        </label>
      </div>

      {visiblePeople.length === 0 ? (
        <div className="people-empty">
          <UserRound size={22} />
          <h2>
            {showArchived
              ? "No archived people"
              : query
                ? "No matching people"
                : "Start with one relationship"}
          </h2>
          <p>No contact data is imported or collected in the background.</p>
        </div>
      ) : (
        <div className="accordion-group-list people-groups">
          {peopleGroups.map(group => (
            <AccordionSection
              key={group.key}
              persistenceKey={group.key}
              title={group.label}
              count={group.items.length}
              collapsible={visiblePeople.length > 5}
              defaultOpen={group.key === "overdue" || group.key === "today"}
              autoOpen={group.key === "overdue" || group.key === "today"}
              revealToken={query && group.items.length ? query : ""}
              className="people-followup-group"
            >
        <div className="people-list">
                {group.items.map(person => {
            const followUp = followUpState(person.nextContactDate, day);
            return (
              <article className="people-card" key={person.id}>
                <div className="people-card-header">
                  <div className="people-person-mark">
                    <UserRound size={17} />
                  </div>
                  <div className="people-card-title">
                    <h2>{person.name}</h2>
                    {person.relationship && <p>{person.relationship}</p>}
                  </div>
                  <span
                    className={`people-followup people-followup-${followUp.state}`}
                  >
                    <CalendarDays size={14} /> {followUp.label}
                  </span>
                </div>
                {person.context && (
                  <div className="people-context">
                    <p>{person.context}</p>
                    {voice.speechSupported && (
                      <button
                        type="button"
                        className="people-icon-button"
                        onClick={() => voice.read(person.context)}
                        aria-label={`Read context for ${person.name}`}
                      >
                        <Volume2 size={16} />
                      </button>
                    )}
                  </div>
                )}
                <div className="people-dates">
                  <span>
                    Last contact{" "}
                    <strong>{displayDate(person.lastContactDate)}</strong>
                  </span>
                  <span>
                    Next follow-up{" "}
                    <strong>{displayDate(person.nextContactDate)}</strong>
                  </span>
                  {person.birthdayMonthDay && (
                    <span>
                      Birthday <strong>{displayBirthday(person.birthdayMonthDay)}</strong>
                    </span>
                  )}
                </div>
                <div className="people-card-actions">
                  <button
                    type="button"
                    className="people-button people-button-secondary"
                    onClick={() => markContacted(person)}
                    disabled={readOnly}
                  >
                    <CalendarDays size={15} /> Mark contacted today
                  </button>
                  <button
                    type="button"
                    className="people-button people-button-secondary"
                    onClick={() => openEditForm(person)}
                    disabled={readOnly}
                  >
                    <Pencil size={15} /> Edit
                  </button>
                  <button
                    type="button"
                    className="people-button people-button-secondary"
                    onClick={() => toggleArchived(person)}
                    disabled={readOnly}
                  >
                    {person.status === "active" ? (
                      <Archive size={15} />
                    ) : (
                      <RotateCcw size={15} />
                    )}
                    {person.status === "active" ? "Archive" : "Restore"}
                  </button>
                  <button
                    type="button"
                    className="people-button people-button-danger"
                    onClick={() => setPendingDelete(person.id)}
                    disabled={readOnly}
                  >
                    <Trash2 size={15} /> Delete
                  </button>
                </div>
                <AlertDialog
                  open={pendingDelete === person.id}
                  onOpenChange={open => !open && setPendingDelete(null)}
                >
                  <AlertDialogContent>
                    <AlertDialogHeader>
                            <AlertDialogTitle>
                              Remove {person.name}?
                            </AlertDialogTitle>
                      <AlertDialogDescription>
                              This removes the record from the current
                              Workspace. Existing backups may still contain it.
                              No message will be sent and no task will change.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep record</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => confirmDelete(person.id)}
                      >
                        Remove record
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </article>
            );
          })}
        </div>
            </AccordionSection>
          ))}
        </div>
      )}
    </section>
  );
}
