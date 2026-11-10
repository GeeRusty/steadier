import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Mic,
  MoreHorizontal,
  Save,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { evidenceFeedEntries } from "../../domain/activityLog";
import { groupByStable, monthGroup } from "../../domain/accordionGroups";
import AccordionSection from "./AccordionSection";
import {
  MAX_EVIDENCE_ENTRIES,
  MAX_EVIDENCE_TEXT_LENGTH,
  type EvidenceInput,
} from "../../domain/evidence";
import type { Task, Workspace } from "../../domain/types";
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
  readOnly: boolean;
  onOpenTask: (task: Task) => void;
  onOpenProject: (projectId: string) => void;
  onSaveEvidence: (input: EvidenceInput) => boolean;
  onDeleteEvidence: (id: string) => boolean;
  voice: VoiceControls;
}

function evidenceDate(at: string | null): string {
  if (!at) return "Current field · no separate entry date";
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return "Date not recorded";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Adelaide",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(time);
}

export default function EvidenceFeedView({
  workspace,
  readOnly,
  onOpenTask,
  onOpenProject,
  onSaveEvidence,
  onDeleteEvidence,
  voice,
}: Props) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(50);
  const [targetKind, setTargetKind] = useState<"task" | "project">(
    workspace.tasks.length ? "task" : "project"
  );
  const [targetId, setTargetId] = useState(
    workspace.tasks[0]?.id ?? workspace.projects[0]?.id ?? ""
  );
  const [text, setText] = useState("");
  const [textSource, setTextSource] = useState<"typed" | "voice">("typed");
  const [status, setStatus] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const dictationActive = useRef(false);

  const targets = targetKind === "task" ? workspace.tasks : workspace.projects;
  const selectedTarget = targets.find(item => item.id === targetId);
  const entries = useMemo(() => evidenceFeedEntries(workspace), [workspace]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return entries;
    return entries.filter(entry =>
      `${entry.title} ${entry.source} ${entry.text}`
        .toLocaleLowerCase()
        .includes(needle)
    );
  }, [entries, query]);
  const visible = query.trim() ? filtered : filtered.slice(0, visibleCount);
  const groups = useMemo(
    () => groupByStable(visible, entry => monthGroup(entry.at)),
    [visible]
  );
  const voiceTranscriptPending =
    textSource === "voice" &&
    (voice.listening ||
      Boolean(voice.interimTranscript.trim()) ||
      !voice.finalTranscript.trim() ||
      voice.finalTranscript.trim() !== text.trim());
  const canSave =
    !readOnly &&
    Boolean(selectedTarget) &&
    Boolean(text.trim()) &&
    text.trim().length <= MAX_EVIDENCE_TEXT_LENGTH &&
    (workspace.evidence?.length ?? 0) < MAX_EVIDENCE_ENTRIES &&
    !voiceTranscriptPending;

  useEffect(() => {
    if (!dictationActive.current) return;
    if (voice.transcript) setText(voice.transcript);
    if (!voice.listening && voice.finalTranscript.trim()) {
      dictationActive.current = false;
    }
  }, [voice.transcript, voice.listening, voice.finalTranscript]);

  useEffect(() => {
    setVisibleCount(50);
  }, [query]);

  useEffect(() => {
    if (targets.some(target => target.id === targetId)) return;
    setTargetId(targets[0]?.id ?? "");
  }, [targetId, targets]);

  function startDictation() {
    if (voice.listening) {
      voice.stop();
      return;
    }
    voice.clear();
    dictationActive.current = true;
    setTextSource("voice");
    setStatus("");
    voice.start();
  }

  function clearDraft() {
    dictationActive.current = false;
    voice.abort();
    voice.clear();
    setText("");
    setTextSource("typed");
    setStatus("");
  }

  function saveEvidence(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (voice.listening || voiceTranscriptPending) {
      setStatus("Stop and review the final transcript before saving.");
      return;
    }
    if (!selectedTarget || !text.trim()) return;
    const accepted = onSaveEvidence({
      targetKind,
      targetId,
      text: text.trim(),
    });
    if (!accepted) {
      setStatus("Evidence was not saved. Check sync/storage and retry.");
      return;
    }
    clearDraft();
    setStatus(
      "Evidence saved to the shared workspace. It does not create a task."
    );
  }

  function confirmDelete() {
    if (!pendingDeleteId) return;
    const accepted = onDeleteEvidence(pendingDeleteId);
    setStatus(
      accepted
        ? "Evidence entry deleted from the shared workspace."
        : "Evidence was not deleted. Check sync/storage and retry."
    );
    setPendingDeleteId(null);
  }

  return (
    <section className="evidence-feed-view">
      <div className="page-heading">
        <div className="eyebrow">OWNER-SAVED RECORDS</div>
        <h1>Evidence Feed</h1>
        <p>
          Add a dated note to an existing task or project. Saving evidence never
          creates a task or changes its status.
        </p>
      </div>
      <div className="notice evidence-privacy" role="note">
        Saved evidence syncs with this workspace and appears in full backups. It
        is excluded from Claude/ChatGPT workspace projections. Voice starts only
        when you ask; your browser may send speech to its recognition provider.
      </div>
      {!readOnly && (
        <form
          className="settings-section evidence-form"
          onSubmit={saveEvidence}
        >
          <div className="section-heading compact">
            <div>
              <div className="eyebrow">A HUMAN-RECORDED OBSERVATION</div>
              <h2>Add evidence</h2>
            </div>
            <span className="small muted">
              {workspace.evidence?.length ?? 0} / {MAX_EVIDENCE_ENTRIES} saved
            </span>
          </div>
          <div className="form-pair">
            <label className="field">
              Record type
              <select
                value={targetKind}
                onChange={event => {
                  const kind = event.target.value as "task" | "project";
                  setTargetKind(kind);
                  const nextTargets =
                    kind === "task" ? workspace.tasks : workspace.projects;
                  setTargetId(nextTargets[0]?.id ?? "");
                }}
              >
                <option value="task">Task</option>
                <option value="project">Project</option>
              </select>
            </label>
            <label className="field">
              Record
              <select
                value={targetId}
                onChange={event => setTargetId(event.target.value)}
                required
              >
                <option value="">Select a {targetKind}</option>
                {targets.map(target => (
                  <option value={target.id} key={target.id}>
                    {target.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {targets.length === 0 && (
            <p className="small muted">
              Add a {targetKind} before recording evidence against it.
            </p>
          )}
          <div className="daily-log-voice-row">
            <button
              className={`button ${voice.listening ? "listening" : "secondary"}`}
              type="button"
              onClick={startDictation}
              disabled={readOnly || !voice.supported}
            >
              {voice.listening ? <Square size={16} /> : <Mic size={16} />}
              {voice.listening ? "Stop listening" : "Dictate evidence"}
            </button>
            <span className="small muted" role="status" aria-live="polite">
              {voice.listening
                ? "Listening only because you started it. Stop, then review the words."
                : voiceTranscriptPending
                  ? "Wait for the final transcript or edit it before saving."
                  : "Voice is optional; the transcript remains an editable draft until you save."}
            </span>
          </div>
          {voice.error && (
            <p className="error" role="alert">
              {voice.error}
            </p>
          )}
          <label className="field">
            Evidence text
            <textarea
              value={text}
              onChange={event => {
                dictationActive.current = false;
                setText(event.target.value);
                setTextSource("typed");
              }}
              maxLength={MAX_EVIDENCE_TEXT_LENGTH}
              rows={5}
              placeholder="What did you observe or complete? Keep this as a factual note."
              disabled={readOnly}
            />
          </label>
          <div className="evidence-form-footer">
            <span className="small muted">
              {text.length.toLocaleString()} / {MAX_EVIDENCE_TEXT_LENGTH}
            </span>
            <div className="button-row">
              {text && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={clearDraft}
                >
                  <X size={15} /> Cancel draft
                </button>
              )}
              <button
                className="button primary"
                type="submit"
                disabled={!canSave}
              >
                <Save size={15} /> Save evidence
              </button>
            </div>
          </div>
          {status && (
            <p className="small" role="status">
              {status}
            </p>
          )}
          {voiceTranscriptPending && (
            <p className="small muted">
              Speech is not final yet; nothing will save.
            </p>
          )}
          {readOnly && (
            <p className="error">
              This workspace is read-only until sync is restored.
            </p>
          )}
        </form>
      )}
      {readOnly && (
        <div className="notice" role="status">
          This workspace is read-only until sync is restored. Existing evidence
          remains available below.
        </div>
      )}
      <label className="field evidence-search">
        <span className="visually-hidden">Search evidence</span>
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search records"
        />
      </label>
      {filtered.length === 0 ? (
        <div className="empty-state">
          <Activity size={28} />
          <h2>
            {entries.length ? "No matching records." : "Nothing recorded yet."}
          </h2>
          <p>
            {entries.length
              ? "Try another search term."
              : "Saved evidence, task evidence, task history and project progress will appear here."}
          </p>
        </div>
      ) : (
        <div className="accordion-group-list evidence-feed-groups">
          {groups.map((group, index) => (
            <AccordionSection
              key={group.key}
              persistenceKey={group.key}
              title={group.label}
              count={group.items.length}
              collapsible={filtered.length > 5}
              defaultOpen={index === 0}
              revealToken={query && group.items.length ? query : ""}
              className="evidence-feed-group"
            >
        <div className="evidence-feed-list">
                {group.items.map(entry => {
            const record =
              entry.itemKind === "task"
                ? workspace.tasks.find(task => task.id === entry.itemId)
                : workspace.projects.find(
                    project => project.id === entry.itemId
                  );
            const spoken = `${entry.source}. ${entry.title}. ${entry.text}`;
            return (
              <article className="evidence-feed-entry" key={entry.id}>
                <div className="evidence-feed-entry-top">
                  <span className="badge">{entry.source}</span>
                  <time dateTime={entry.at ?? undefined}>
                    {evidenceDate(entry.at)}
                  </time>
                </div>
                <h2>{entry.title}</h2>
                <p className="evidence-feed-text">{entry.text}</p>
                <div className="evidence-feed-actions">
                  <div className="button-row">
                    {record && (
                      <button
                        className="text-button"
                        type="button"
                        onClick={() =>
                          entry.itemKind === "task"
                            ? onOpenTask(record as Task)
                            : onOpenProject(entry.itemId)
                        }
                      >
                        Open {entry.itemKind} <ArrowUpRight size={14} />
                      </button>
                    )}
                    {entry.evidenceId && !readOnly && (
                      <button
                        className="icon-button danger"
                        type="button"
                              onClick={() =>
                                setPendingDeleteId(entry.evidenceId!)
                              }
                        aria-label="Delete saved evidence"
                        title="Delete saved evidence"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() =>
                            voice.speaking
                              ? voice.stopSpeaking()
                              : voice.read(spoken)
                    }
                    aria-label={
                      voice.speaking
                        ? "Stop reading record"
                        : "Read record aloud"
                    }
                    title={voice.speaking ? "Stop reading" : "Read aloud"}
                  >
                    {voice.speaking ? (
                      <Square size={16} />
                    ) : (
                      <Volume2 size={16} />
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
            </AccordionSection>
          ))}
        </div>
      )}
      {!query.trim() && visible.length < filtered.length && (
        <button
          className="button secondary evidence-more"
          type="button"
          onClick={() => setVisibleCount(count => count + 50)}
        >
          <MoreHorizontal size={16} /> Show more (
          {filtered.length - visible.length} remaining)
        </button>
      )}
      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={open => !open && setPendingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this evidence entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved evidence text from the shared workspace and
              its future backups. It does not change the linked task or project.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep entry</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Delete entry
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
