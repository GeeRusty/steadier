import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ArrowRight,
  Mic,
  Pencil,
  Save,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { nanoid } from "nanoid";
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
import { adelaideClock } from "../../domain/time";
import { groupByStable, monthGroup } from "../../domain/accordionGroups";
import AccordionSection from "./AccordionSection";
import {
  readDailyLog,
  writeDailyLog,
  type DailyLogEntry,
  type DailyLogStorage,
} from "../../domain/dailyLog";
import type { VoiceControls } from "../../hooks/useVoice";
import { adelaideTimestamp } from "../../../../shared/time";

interface Props {
  voice: VoiceControls;
  onConvertToTask: (sourceNote: string) => void;
}

function localStorageOrNull(): DailyLogStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function dateLabel(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Adelaide",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function DailyLogView({ voice, onConvertToTask }: Props) {
  const [storage] = useState(localStorageOrNull);
  const [entries, setEntries] = useState<DailyLogEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [draft, setDraft] = useState("");
  const [entryDate, setEntryDate] = useState(() => adelaideClock().date);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftSource, setDraftSource] = useState<"typed" | "voice">("typed");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const dictationActive = useRef(false);

  useEffect(() => {
    const result = readDailyLog(storage);
    setEntries(result.entries);
    setLoadError(result.error);
    setStorageReady(result.ok);
  }, [storage]);

  useEffect(() => {
    if (dictationActive.current && voice.transcript) {
      setDraft(voice.transcript);
      setDraftSource("voice");
    }
  }, [voice.transcript]);

  useEffect(
    () => () => {
      voice.abort();
      voice.clear();
      voice.stopSpeaking();
    },
    [voice.abort, voice.clear, voice.stopSpeaking]
  );

  const transcriptPending =
    draftSource === "voice" &&
    (voice.listening ||
      Boolean(voice.interimTranscript.trim()) ||
      !voice.finalTranscript.trim() ||
      voice.finalTranscript.trim() !== draft.trim());

  const orderedEntries = useMemo(
    () =>
      [...entries]
        .filter(entry => {
          const text = query.trim().toLocaleLowerCase();
          return (
            !text ||
            entry.text.toLocaleLowerCase().includes(text) ||
            entry.date.includes(text)
          );
        })
        .sort(
          (left, right) =>
            right.date.localeCompare(left.date) ||
            right.updatedAt.localeCompare(left.updatedAt) ||
            right.createdAt.localeCompare(left.createdAt)
        ),
    [entries, query]
  );
  const entryGroups = useMemo(
    () => groupByStable(orderedEntries, entry => monthGroup(entry.date)),
    [orderedEntries]
  );

  function resetDraft() {
    setDraft("");
    setEntryDate(adelaideClock().date);
    setEditingId(null);
    setDraftSource("typed");
    dictationActive.current = false;
    setStatusMessage("");
    voice.abort();
    voice.clear();
  }

  function startDictation() {
    voice.clear();
    dictationActive.current = true;
    setDraftSource("voice");
    setStatusMessage("");
    voice.start();
  }

  function saveEntry() {
    if (
      !storageReady ||
      !draft.trim() ||
      voice.listening ||
      transcriptPending
    ) {
      return;
    }
    const timestamp = adelaideTimestamp();
    const existing = editingId
      ? entries.find(entry => entry.id === editingId)
      : undefined;
    const nextEntry: DailyLogEntry = {
      id: existing?.id ?? nanoid(),
      date: entryDate,
      text: draft.trim(),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    const nextEntries = existing
      ? entries.map(entry => (entry.id === existing.id ? nextEntry : entry))
      : [nextEntry, ...entries];
    const result = writeDailyLog(storage, nextEntries);
    if (!result.ok) {
      setStatusMessage(result.error ?? "Daily Log was not saved.");
      return;
    }
    setEntries(nextEntries);
    setStatusMessage(
      existing ? "Entry updated on this device." : "Entry saved on this device."
    );
    resetDraft();
  }

  function beginEdit(entry: DailyLogEntry) {
    dictationActive.current = false;
    setDraft(entry.text);
    setEntryDate(entry.date);
    setEditingId(entry.id);
    setDraftSource("typed");
    setStatusMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function confirmDelete() {
    const target = entries.find(entry => entry.id === pendingDeleteId);
    if (!target || !storageReady) return;
    const nextEntries = entries.filter(entry => entry.id !== target.id);
    const result = writeDailyLog(storage, nextEntries);
    if (!result.ok) {
      setStatusMessage(result.error ?? "Entry was not deleted.");
      setPendingDeleteId(null);
      return;
    }
    setEntries(nextEntries);
    if (editingId === target.id) resetDraft();
    setPendingDeleteId(null);
    setStatusMessage("Entry deleted from this device.");
  }

  return (
    <section className="daily-log-view">
      <div className="page-heading">
        <div className="eyebrow">MY LIFE · NOTES TO SELF</div>
        <h1>Daily Log</h1>
        <p>
          Put a thought somewhere safe to revisit. Nothing here becomes a task.
        </p>
      </div>

      <div className="daily-log-private notice" role="note">
        <strong>Private to this browser on this device.</strong> Entries are
        stored in browser storage only; Steadier does not sync or back them up,
        and they are not sent to Compass or AI. This storage is not encrypted by
        Steadier and may be cleared by your browser. Do not store passwords,
        account details or secrets.
      </div>

      <div className="settings-layout daily-log-layout">
        <section
          className="settings-section daily-log-editor"
          aria-labelledby="daily-log-editor-title"
        >
          <div className="section-heading compact">
            <div>
              <div className="eyebrow">A PRIVATE NOTE</div>
              <h2 id="daily-log-editor-title">
                {editingId ? "Edit entry" : "Add an entry"}
              </h2>
            </div>
            {editingId && (
              <button
                className="text-button"
                onClick={resetDraft}
                type="button"
              >
                <X size={15} /> Discard edit
              </button>
            )}
          </div>

          <div className="daily-log-voice-row">
            <button
              className={`button ${voice.listening ? "listening" : "secondary"}`}
              type="button"
              onClick={voice.listening ? voice.stop : startDictation}
              disabled={!storageReady || !voice.supported}
            >
              {voice.listening ? <Square size={16} /> : <Mic size={16} />}
              {voice.listening ? "Stop listening" : "Dictate a note"}
            </button>
            <span className="small muted" role="status" aria-live="polite">
              {voice.listening
                ? "Listening only because you started it. Stop, then review the words."
                : transcriptPending
                  ? "Speech is not final yet. Wait for the final transcript or edit it before saving."
                  : "Voice is optional. Your browser may send speech to its recognition provider; review before saving."}
            </span>
          </div>

          {!voice.supported && (
            <p className="notice small">
              Speech recognition is unavailable in this browser. You can type
              instead.
            </p>
          )}
          {voice.error && (
            <p className="error" role="alert">
              {voice.error}
            </p>
          )}

          <label className="field">
            Entry date
            <input
              type="date"
              value={entryDate}
              max={adelaideClock().date}
              onChange={event => setEntryDate(event.target.value)}
              disabled={!storageReady}
            />
          </label>
          <label className="field">
            Your words
            <textarea
              value={draft}
              onChange={event => {
                dictationActive.current = false;
                setDraft(event.target.value);
                setDraftSource("typed");
              }}
              rows={7}
              maxLength={10_000}
              placeholder="What do you want to remember about today?"
              disabled={!storageReady}
            />
          </label>
          <div className="daily-log-editor-footer">
            <span className="small muted">
              {draft.length.toLocaleString()} / 10,000
            </span>
            <div className="button-row">
              {draft.trim() && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={resetDraft}
                >
                  Clear draft
                </button>
              )}
              <button
                className="button primary"
                type="button"
                onClick={saveEntry}
                disabled={
                  !storageReady ||
                  !draft.trim() ||
                  voice.listening ||
                  transcriptPending
                }
              >
                <Save size={16} /> {editingId ? "Save changes" : "Save entry"}
              </button>
            </div>
          </div>
          {statusMessage && (
            <p className="small" role="status">
              {statusMessage}
            </p>
          )}
          {loadError && (
            <p className="error" role="alert">
              {loadError}
            </p>
          )}
        </section>

        <section
          className="daily-log-entries"
          aria-labelledby="daily-log-entries-title"
        >
          <div className="section-heading compact">
            <div>
              <div className="eyebrow">YOUR OWN WORDS</div>
              <h2 id="daily-log-entries-title">Recent entries</h2>
            </div>
            <span className="small muted">{entries.length} total</span>
          </div>
          {entries.length > 0 && (
            <label className="field daily-log-search">
              <span className="visually-hidden">Search Daily Log</span>
              <input
                type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search entries"
              />
            </label>
          )}
          {orderedEntries.length === 0 ? (
            <div className="empty-state daily-log-empty">
              <BookOpen size={28} />
              <h2>
                {entries.length
                  ? "No matching entries"
                  : "A little room to think."}
              </h2>
              <p>
                {entries.length
                  ? "Try another word or date."
                  : "Save a short note when you want to remember something. It stays separate from your tasks."}
              </p>
            </div>
          ) : (
            <div className="accordion-group-list daily-log-groups">
              {entryGroups.map((group, index) => (
                <AccordionSection
                  key={group.key}
                  persistenceKey={group.key}
                  title={group.label}
                  count={group.items.length}
                  collapsible={orderedEntries.length > 5}
                  defaultOpen={index === 0}
                  revealToken={query && group.items.length ? query : ""}
                  className="daily-log-group"
                >
            <div className="daily-log-list">
                    {group.items.map(entry => (
                <article className="daily-log-entry" key={entry.id}>
                  <div className="daily-log-entry-header">
                    <div>
                            <time dateTime={entry.date}>
                              {dateLabel(entry.date)}
                            </time>
                      <span className="small muted">
                        Updated {timeLabel(entry.updatedAt)}
                      </span>
                    </div>
                    <div className="daily-log-entry-actions">
                      <button
                        className="text-button daily-log-convert"
                        type="button"
                        onClick={() => onConvertToTask(entry.text)}
                        disabled={!storageReady}
                      >
                        <ArrowRight size={14} /> Create task draft
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={
                          voice.speaking
                            ? "Stop reading entry aloud"
                            : "Read entry aloud"
                        }
                              title={
                                voice.speaking ? "Stop reading" : "Read aloud"
                              }
                        onClick={() =>
                          voice.speaking
                            ? voice.stopSpeaking()
                            : voice.read(entry.text)
                        }
                      >
                        {voice.speaking ? (
                          <Square size={16} />
                        ) : (
                          <Volume2 size={16} />
                        )}
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label="Edit entry"
                        onClick={() => beginEdit(entry)}
                        disabled={!storageReady}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label="Delete entry"
                        onClick={() => setPendingDeleteId(entry.id)}
                        disabled={!storageReady}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <p className="daily-log-entry-text">{entry.text}</p>
                </article>
              ))}
            </div>
                </AccordionSection>
              ))}
            </div>
          )}
        </section>
      </div>

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={open => !open && setPendingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this Daily Log entry?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be removed from this browser on this device. This cannot
              be undone here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep entry</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={event => {
                event.preventDefault();
                confirmDelete();
              }}
            >
              Delete entry
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
