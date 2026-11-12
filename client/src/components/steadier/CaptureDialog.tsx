import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Mic, Square, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";
import { installCaptureDraftFlush, parseCapture } from "../../domain/capture";

const IDEA_PREFIX = /^\s*(?:an?\s+)?idea\s*[:,.\-–—]?\s+/i;
import { createTask } from "../../domain/engine";
import { CATCH_ALL_LABEL, type CatchAll } from "../../domain/compass";
import { looksLikeAction, settleCardState } from "../../domain/taskCard";
import CardDotsMark from "./CardDotsMark";
import {
  adelaideClock,
  describeFlexibleWindow,
  formatDuration,
  type TaskSchedule,
} from "../../domain/time";
import { parseQuickAdd, scheduleFromQuickParse } from "../../domain/quickParse";
import {
  hasNativeVoiceDraftHandoff,
  isNativeVoiceDraftEvent,
} from "../../domain/nativeVoice";
import {
  TASK_AUTOSAVE_IDLE_MS,
  autosaveSyncAdvanced,
  hasMeaningfulParsedTaskTitle,
  isServerConfirmedAutosave,
  taskEditFingerprint,
  type PendingTaskAutosave,
  type TaskAutosaveCloudState,
  type TaskAutosaveSaveResult,
} from "../../domain/taskAutosave";
import { identityLabel } from "../../domain/life";
import type {
  Task,
  TaskState,
  Project,
  LifeRole,
  LifePattern,
} from "../../domain/types";
import type { useVoice } from "../../hooks/useVoice";

type Voice = ReturnType<typeof useVoice>;
interface Props {
  voice: Voice;
  focused: Task | undefined;
  initialText?: string;
  initialNotes?: string;
  manualReviewOnly?: boolean;
  sourceAlreadyShared?: boolean;
  projects?: Project[];
  tasks: Task[];
  autosaveCloud: TaskAutosaveCloudState;
  initialProjectId?: string;
  onAdd: (
    task: Task,
    baseline: Task | null
  ) => boolean | void | TaskAutosaveSaveResult;
  onAutoSave: (
    task: Task,
    baseline: Task | null
  ) => TaskAutosaveSaveResult;
  onClose: () => void;
  onCommand: (command: "complete" | "defer" | "read") => boolean | void;
}
export default function CaptureDialog({
  voice,
  focused,
  initialText = "",
  initialNotes = "",
  manualReviewOnly = false,
  sourceAlreadyShared = false,
  projects = [],
  tasks,
  autosaveCloud,
  initialProjectId = "",
  onAdd,
  onAutoSave,
  onClose,
  onCommand,
}: Props) {
  const [text, setText] = useState(initialText);
  const [notes, setNotes] = useState(initialNotes);
  const captureTextRef = useRef<HTMLTextAreaElement>(null);
  const [textSource, setTextSource] = useState<"typed" | "voice">("typed");
  const [voiceOriginated, setVoiceOriginated] = useState(false);
  const [nextAction, setNextAction] = useState("");
  const [state, setState] = useState<TaskState | "">("");
  const [waitingFor, setWaitingFor] = useState("");
  const [error, setError] = useState("");
  const [autoSaveState, setAutoSaveState] = useState<
    "idle" | "saving" | "saved" | "not-saved"
  >("idle");
  const [autoSaveDetail, setAutoSaveDetail] = useState("");
  const autoSaveRef = useRef(onAutoSave);
  autoSaveRef.current = onAutoSave;
  const savedDraftRef = useRef<string | null>(null);
  const acceptedTaskRef = useRef<Task | null>(null);
  const pendingServerAutosaveRef = useRef<PendingTaskAutosave | null>(null);
  const [identity] = useState(() => {
    const task = createTask({ title: "Capture draft" });
    return { id: task.id, createdAt: task.createdAt, history: task.history };
  });
  // Time phrases first (dates, times, length, repeat, reminders), then the
  // existing capture rules on what remains.
  // "Idea: …" (typed or spoken) switches to Idea; the word itself is dropped.
  const startsAsIdea = IDEA_PREFIX.test(text);
  const quick = useMemo(() => {
    const clock = adelaideClock();
    return parseQuickAdd(text.replace(IDEA_PREFIX, ""), clock.date, clock.minutes);
  }, [text]);
  const parsed = useMemo(() => {
    const base = parseCapture(quick.title);
    return {
      ...base,
      deadline: quick.deadline ?? base.deadline,
      estimate: quick.minutes ?? base.estimate,
    };
  }, [quick]);
  const schedule = useMemo<TaskSchedule>(
    () => scheduleFromQuickParse(quick),
    [quick]
  );
  const [projectId, setProjectId] = useState(initialProjectId);
  // Capture asks one thing after the title: Idea or Task (Task by default).
  const [kind, setKind] = useState<"task" | "idea">("task");
  useEffect(() => {
    if (startsAsIdea) setKind("idea");
  }, [startsAsIdea]);
  const [actionOk, setActionOk] = useState(false);
  const [catchAll, setCatchAll] = useState<CatchAll | "">("");
  const [role, setRole] = useState<LifeRole | "">("");
  const [pattern, setPattern] = useState<LifePattern | "">("");
  const project = projects.find(p => p.id === projectId);
  const draftTask = useMemo(() => {
    const capturedNextAction = nextAction.trim() || parsed.nextAction || "";
    const capturedWaitingFor = waitingFor.trim() || parsed.waitingFor || "";
    const requestedState =
      state || parsed.state || (capturedNextAction ? "ready" : "inbox");
    // A task title must never be blocked by an incomplete filing detail.
    const capturedState =
      requestedState === "waiting" && !capturedWaitingFor
        ? "inbox"
        : requestedState;
    const task = createTask({
      ...parsed,
      notes,
      schedule,
      projectId: project?.id || null,
      purpose: project?.purpose || "",
      role: role || parsed.role || project?.role,
      pattern: pattern || parsed.pattern || project?.pattern,
      labelSource:
        (role && pattern) || parsed.labelSource === "confirmed"
          ? "confirmed"
          : project
            ? "suggested"
            : undefined,
      waitingFor: capturedWaitingFor,
      nextAction: capturedNextAction,
      state: capturedState,
    });
    if (kind === "idea") {
      // An idea: on the shelf, no review date, no placement, no timers.
      return {
        ...task,
        state: "someday" as const,
        reviewDate: null,
        actionConfirmed: false,
        id: identity.id,
        createdAt: identity.createdAt,
        history: identity.history,
      };
    }
    const placed: Task = catchAll && !project
      ? {
          ...task,
          compass: {
            ...task.compass,
            catchAll,
            catchAllConfirmed: true,
            catchAllSince: task.createdAt,
          },
        }
      : task;
    return settleCardState({
      ...placed,
      actionConfirmed: actionOk,
      id: identity.id,
      createdAt: identity.createdAt,
      history: identity.history,
    });
  }, [
    actionOk,
    catchAll,
    kind,
    identity,
    nextAction,
    notes,
    parsed,
    pattern,
    project,
    role,
    schedule,
    state,
    waitingFor,
  ]);
  useEffect(() => {
    if (voice.transcript) {
      setText(voice.transcript);
      setTextSource("voice");
      setVoiceOriginated(true);
      setAutoSaveState("not-saved");
      setAutoSaveDetail(
        "Voice text is an editable draft. Review it and tap Create task; it will not autosave."
      );
    }
  }, [voice.transcript]);
  const phrase = text.toLowerCase().replace(/[.!]/g, "").trim();
  const commandPhrase: "complete" | "defer" | "read" | null =
    /^(done|complete|mark (it |this )?(done|complete))$/.test(phrase)
      ? "complete"
      : /^(later|defer|defer (it |this )?(until )?tomorrow|snooze)$/.test(
            phrase
          )
        ? "defer"
        : /^(read|read (the )?(next (action|step)|task))$/.test(phrase)
          ? "read"
          : null;
  const voiceTranscriptPending =
    textSource === "voice" &&
    (Boolean(voice.interimTranscript.trim()) ||
      !voice.finalTranscript.trim() ||
      voice.finalTranscript.trim() !== text.trim());
  const voiceTextFinal = textSource !== "voice" || !voiceTranscriptPending;
  const command =
    focused && textSource === "voice" && voiceTextFinal ? commandPhrase : null;
  const unsupportedVoiceCommand =
    !focused &&
    textSource === "voice" &&
    voiceTextFinal &&
    commandPhrase !== null;
  const persistDraft = useCallback(() => {
    if (manualReviewOnly || voiceOriginated) return true;
    if (!text.trim() || command || unsupportedVoiceCommand) return true;
    if (!hasMeaningfulParsedTaskTitle(draftTask.title)) {
      if (acceptedTaskRef.current) {
        setAutoSaveState("not-saved");
        setAutoSaveDetail(
          "Enter a meaningful task title. The last accepted version remains unchanged."
        );
        return false;
      }
      return true;
    }
    const serialized = taskEditFingerprint(draftTask);
    if (savedDraftRef.current === serialized) {
      if (autoSaveState === "saving") {
        setError("Still waiting for Steadier to confirm this save. Keep this draft open for now.");
        return false;
      }
      return autoSaveState !== "not-saved";
    }
    if (voice.listening || voiceTranscriptPending) {
      setAutoSaveState("not-saved");
      setAutoSaveDetail("Speech is still an editable draft and was not autosaved.");
      return false;
    }
    const result = autoSaveRef.current(draftTask, acceptedTaskRef.current);
    if (!result.accepted) {
      setAutoSaveState("not-saved");
      setAutoSaveDetail(result.message);
      return false;
    }
    acceptedTaskRef.current = result.task;
    savedDraftRef.current = taskEditFingerprint(result.task);
    pendingServerAutosaveRef.current = result.ticket;
    setAutoSaveState(result.serverPending ? "saving" : "saved");
    setAutoSaveDetail(
      result.serverPending
        ? "Waiting for the server to confirm this draft."
        : autosaveCloud.active &&
            autosaveCloud.status === "synced" &&
            !autosaveCloud.pending
          ? "Saved to Steadier."
          : "Saved on this device; no shared server is connected."
    );
    setError("");
    if (result.serverPending) {
      setError("Still waiting for Steadier to confirm this save. Keep the draft open for now.");
      return false;
    }
    return true;
  }, [
    autoSaveState,
    command,
    draftTask,
    manualReviewOnly,
    voiceOriginated,
    text,
    unsupportedVoiceCommand,
    voice.interimTranscript,
    voice.finalTranscript,
    voice.listening,
    voiceTranscriptPending,
  ]);
  const persistDraftRef = useRef(persistDraft);
  useLayoutEffect(() => {
    persistDraftRef.current = persistDraft;
  }, [persistDraft]);
  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined")
      return;
    return installCaptureDraftFlush(document, window, () =>
      persistDraftRef.current()
    );
  }, []);
  useEffect(() => {
    if (manualReviewOnly || voiceOriginated) {
      if (!acceptedTaskRef.current) {
        setAutoSaveState("not-saved");
        setAutoSaveDetail(
          "This editable draft requires the explicit Create task action; it is not autosaved."
        );
      }
      return;
    }
    if (!text.trim() || command || unsupportedVoiceCommand) {
      setAutoSaveState("idle");
      setAutoSaveDetail("");
      return;
    }
    if (!hasMeaningfulParsedTaskTitle(draftTask.title)) {
      setAutoSaveState("not-saved");
      setAutoSaveDetail(
        "Enter a meaningful task title. Timing-only text will not create a task."
      );
      return;
    }
    if (voice.listening || voiceTranscriptPending) {
      setAutoSaveState("not-saved");
      setAutoSaveDetail("Speech is still an editable draft and was not autosaved.");
      return;
    }
    setAutoSaveState("saving");
    setAutoSaveDetail("Waiting for a short pause before saving.");
    const timeout = window.setTimeout(
      () => persistDraftRef.current(),
      TASK_AUTOSAVE_IDLE_MS
    );
    return () => window.clearTimeout(timeout);
  }, [
    command,
    draftTask,
    manualReviewOnly,
    voiceOriginated,
    text,
    unsupportedVoiceCommand,
    voice.listening,
    voiceTranscriptPending,
  ]);
  useEffect(() => {
    const ticket = pendingServerAutosaveRef.current;
    if (!ticket) return;
    if (autosaveCloud.status === "conflict") {
      setAutoSaveState("not-saved");
      setAutoSaveDetail(
        "Sync conflict. This capture draft is preserved; resolve the conflict before retrying."
      );
      return;
    }
    if (autosaveCloud.status === "offline" || autosaveCloud.status === "error") {
      setAutoSaveState("not-saved");
      setAutoSaveDetail(
        "Not saved to the server yet. Keep this draft open, check sync, and retry."
      );
      return;
    }
    const currentTask = tasks.find(item => item.id === ticket.task.id);
    if (isServerConfirmedAutosave(ticket, autosaveCloud, currentTask)) {
      pendingServerAutosaveRef.current = null;
      setAutoSaveState("saved");
      setAutoSaveDetail("Saved to Steadier.");
      setError("");
      return;
    }
    if (autosaveSyncAdvanced(ticket, autosaveCloud)) {
      pendingServerAutosaveRef.current = null;
      setAutoSaveState("not-saved");
      setAutoSaveDetail(
        "The server has a different task version. Your capture draft is preserved and was not overwritten."
      );
    }
  }, [
    autosaveCloud.active,
    autosaveCloud.lastSyncedAt,
    autosaveCloud.pending,
    autosaveCloud.revision,
    autosaveCloud.status,
    tasks,
  ]);
  const close = () => {
    if (
      !persistDraft() &&
      !window.confirm(
        "This capture is not confirmed as saved. Close and discard the editable draft? Any locally queued task remains subject to sync."
      )
    )
      return;
    voice.abort();
    voice.clear();
    onClose();
  };
  const startVoice = () => {
    if (!voiceTranscriptPending && !unsupportedVoiceCommand && !command)
      setTextSource("typed");
    voice.start();
  };
  const nativeVoiceFallback = !voice.supported && hasNativeVoiceDraftHandoff();
  const focusNativeVoiceField = () => {
    setVoiceOriginated(true);
    setTextSource("typed");
    setError("");
    const field = captureTextRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  };
  return (
    <Dialog open onOpenChange={open => !open && close()}>
      <DialogContent className="capture-dialog">
        <div className="eyebrow">MAKE A LITTLE ROOM IN YOUR HEAD</div>
        <DialogTitle className="dialog-heading">
          Put it down. Pick it up later.
        </DialogTitle>
        <DialogDescription>
          {manualReviewOnly || voiceOriginated
            ? "Review this proposed task. Nothing is saved or linked until you choose Create task."
            : "Capture a responsibility in your own words, by typing or speaking."}
        </DialogDescription>
        <div className="voice-control">
          {voice.supported ? (
            <button
              type="button"
              className={`button ${voice.listening ? "listening" : "secondary"}`}
              onClick={voice.listening ? voice.stop : startVoice}
            >
              {voice.listening ? <Square size={17} /> : <Mic size={17} />}
              {voice.listening ? "Stop listening" : "Speak a task"}
            </button>
          ) : nativeVoiceFallback ? (
            <button
              type="button"
              className="button secondary"
              onClick={focusNativeVoiceField}
            >
              <Mic size={17} /> Focus task for app Voice
            </button>
          ) : (
            <span className="small muted">Voice recognition unavailable</span>
          )}
          <span className="small muted" role="status" aria-live="polite">
            {voice.listening
              ? "Listening… your transcript will appear below."
              : voiceTranscriptPending
                ? "Speech isn't finalized yet. Edit the words or speak again before closing."
                : unsupportedVoiceCommand
                  ? "That spoken command wasn't saved because no task is focused."
                  : voiceOriginated
                    ? "Voice draft only. Review and edit it, then choose Create task to save."
                    : nativeVoiceFallback
                      ? "Focus the task text, then use the app’s opt-in Voice panel to place a reviewed draft here."
                      : command
                        ? "This will act on your focused task only after you confirm."
                        : manualReviewOnly
                          ? "Draft only. Review the title, note and any interpreted dates before creating a task."
                          : "A titled task saves automatically after a short pause; voice drafts still need Create task."}
          </span>
        </div>
        {autoSaveState !== "idle" && (
          <div
            className={`task-autosave-status capture-autosave-status is-${autoSaveState}`}
            role="status"
            aria-live="polite"
          >
            <strong>
              {autoSaveState === "saving"
                ? "Saving…"
                : autoSaveState === "saved"
                  ? "Saved"
                  : "Not saved"}
            </strong>
            {autoSaveDetail && <span>{autoSaveDetail}</span>}
          </div>
        )}
        {!voice.supported && (
          <p className="notice small">
            {nativeVoiceFallback
              ? "In the Android app, focus this field, open Tools/Voice, start dictation, review/edit the draft, then tap Place in open field. The text remains a draft; choose Create task to save."
              : "This browser does not expose speech recognition. You can still type here or use a keyboard microphone where supported."}
          </p>
        )}
        {voice.error && (
          <p className="error" role="alert">
            {voice.error}
          </p>
        )}
        <form
          onInputCapture={event => {
            if (!isNativeVoiceDraftEvent(event.nativeEvent)) return;
            setVoiceOriginated(true);
            setTextSource("typed");
            setError("");
            setAutoSaveState("not-saved");
            setAutoSaveDetail(
              "Native voice text is an editable draft. Review it and tap Create task; nothing is saved automatically."
            );
          }}
          onSubmit={e => {
            e.preventDefault();
            if (!text.trim() || voice.listening) return;
            if (voiceTranscriptPending) {
              setError(
                "Speech has not produced a final transcript. Edit the text or speak again before saving."
              );
              return;
            }
            if (unsupportedVoiceCommand) {
              setError(
                "No task is focused, so this spoken command was not saved as a new responsibility."
              );
              return;
            }
            if (command) {
              if (onCommand(command) === false) {
                setError(
                  "The action was not saved. Check sync or take focus explicitly first."
                );
                return;
              }
              close();
            } else {
              if (!hasMeaningfulParsedTaskTitle(draftTask.title)) {
                const detail =
                  "Enter a meaningful task title. Timing-only text will not create a task.";
                setError(detail);
                setAutoSaveState("not-saved");
                setAutoSaveDetail(detail);
                return;
              }
              if (
                (state || parsed.state) === "waiting" &&
                !(waitingFor.trim() || parsed.waitingFor?.trim())
              ) {
                setError(
                  "Name the person, reply or event you are waiting for."
                );
                return;
              }
              if (
                savedDraftRef.current === taskEditFingerprint(draftTask) &&
                autoSaveState === "saved" &&
                !pendingServerAutosaveRef.current
              ) {
                close();
                return;
              }
              const addResult = onAdd(draftTask, acceptedTaskRef.current);
              if (addResult === false || (typeof addResult === "object" && !addResult.accepted)) {
                setError(
                  typeof addResult === "object"
                    ? addResult.message
                    : "This draft was not saved. Keep it here and check sync/storage before retrying."
                );
                setAutoSaveState("not-saved");
                setAutoSaveDetail(
                  typeof addResult === "object"
                    ? addResult.message
                    : "The explicit create action was not accepted; your editable draft remains here."
                );
                return;
              }
              if (typeof addResult === "object") {
                acceptedTaskRef.current = addResult.task;
                savedDraftRef.current = taskEditFingerprint(addResult.task);
                pendingServerAutosaveRef.current = addResult.ticket;
                setAutoSaveState(addResult.serverPending ? "saving" : "saved");
                setAutoSaveDetail(
                  addResult.serverPending
                    ? "The task was added locally. Keep this draft open until Steadier confirms it."
                    : autosaveCloud.active &&
                        autosaveCloud.status === "synced" &&
                        !autosaveCloud.pending
                      ? "Saved to Steadier."
                      : "Saved on this device; no shared server is connected."
                );
                setError("");
                if (addResult.serverPending) return;
              } else {
                savedDraftRef.current = taskEditFingerprint(draftTask);
              }
              close();
            }
          }}
        >
          <label className="field">
            Your task or voice transcript
            <textarea
              ref={captureTextRef}
              autoFocus
              value={text}
              onChange={e => {
                setText(e.target.value);
                setTextSource("typed");
              }}
              rows={3}
              maxLength={3000}
              placeholder="Call Sam tomorrow 3pm for 30 min every Tue, remind me 15 min before"
            />
          </label>
          {!command && !unsupportedVoiceCommand && (
            <div className="capture-kind" role="radiogroup" aria-label="Idea or task">
              <button
                type="button"
                role="radio"
                aria-checked={kind === "task"}
                className={`card-btn card-btn--wide${kind === "task" ? " is-picked" : ""}`}
                onClick={() => setKind("task")}
              >
                Task
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={kind === "idea"}
                className={`card-btn card-btn--wide${kind === "idea" ? " is-picked" : ""}`}
                onClick={() => setKind("idea")}
              >
                Idea
              </button>
            </div>
          )}
          {manualReviewOnly && (
            <label className="field">
              Source text copied into task notes (editable)
              <textarea
                value={notes}
                onChange={event => setNotes(event.target.value)}
                rows={5}
                maxLength={10_000}
              />
            </label>
          )}
          {unsupportedVoiceCommand ? (
            <div className="capture-preview" role="status">
              <span className="eyebrow">VOICE COMMAND · NOT SAVED</span>
              <h3>{parsed.title}</h3>
              <p className="small">
                Focus a task to use this command, or type a task title instead.
              </p>
            </div>
          ) : command ? (
            <div className="capture-preview">
              <span className="eyebrow">REVIEW VOICE ACTION</span>
              <h3>
                {command === "complete"
                  ? "Complete"
                  : command === "defer"
                    ? "Set aside until tomorrow"
                    : "Read the next action for"}
                : {focused?.title}
              </h3>
              <p className="small">Nothing changes until you confirm below.</p>
            </div>
          ) : (
            <>
              {text.trim() && (
                <div className="capture-preview">
                  <span className="eyebrow">
                    {voiceTranscriptPending
                      ? "UNFINISHED SPEECH · NOT SAVED"
                      : manualReviewOnly || voiceOriginated
                        ? "PROPOSED TASK · NOT SAVED"
                        : "DRAFT PREVIEW · RULES, NOT AI"}
                  </span>
                  <h3>{parsed.title}</h3>
                  {quick.understood.length > 0 && (
                    <ul
                      className="chip-list when-chips"
                      aria-label="Understood times"
                    >
                      {quick.understood.map(item => (
                        <li key={item} className="chip">
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="small">
                    {parsed.deadline
                      ? `Deadline ${parsed.deadline}`
                      : "No deadline invented"}{" "}
                    ·{" "}
                    {quick.flexibleWindow
                      ? quick.minutes
                        ? `${formatDuration(quick.minutes)} explicit window effort`
                        : "window effort not estimated"
                      : `${parsed.estimate || 15} min`}
                  </p>
                  {quick.flexibleWindow && (
                    <p className="small muted">
                      Flexible window:{" "}
                      {describeFlexibleWindow(
                        quick.flexibleWindow,
                        adelaideClock().date
                      )}
                      . No time of day or reminders are set.
                    </p>
                  )}
                  <p className="small identity-label">
                    {identityLabel(draftTask)}
                  </p>
                  {draftTask.preparationDate && (
                    <p className="small muted">
                      Suggested preparation: {draftTask.preparationDate}. A
                      planning suggestion, not an extra deadline.
                    </p>
                  )}
                  {project && (
                    <p className="small">
                      Contributes to: {project.outcome || project.title}
                    </p>
                  )}
                </div>
              )}
              {kind === "idea" ? (
                <p className="small muted capture-idea-note">
                  Saved to the Ideas shelf. No timers or warnings. Make it a task whenever you're ready.
                </p>
              ) : (
                <>
              <div className="capture-dots">
                <CardDotsMark task={draftTask} tasks={tasks} showLabels />
                <span className="small muted">Light all three now, or later in Sort. Nothing stops you saving.</span>
              </div>
              <div className="capture-action">
                <button
                  type="button"
                  className={`card-btn${actionOk ? " is-picked" : ""}`}
                  aria-pressed={actionOk}
                  disabled={!text.trim()}
                  onClick={() => setActionOk(v => !v)}
                >
                  {actionOk ? "✓ It's an action" : "It's an action"}
                </button>
                {text.trim() && !actionOk && (
                  <span className="task-card-hint">
                    {looksLikeAction(parsed.title) ? "Reads like an action." : "Tip: start with a doing word, like “Call…”."}
                  </span>
                )}
              </div>
              <label className="field">
                Place
                <select
                  aria-label="Capture place"
                  value={projectId ? `p:${projectId}` : catchAll ? `c:${catchAll}` : ""}
                  onChange={e => {
                    const v = e.target.value;
                    setProjectId(v.startsWith("p:") ? v.slice(2) : "");
                    setCatchAll(v.startsWith("c:") ? (v.slice(2) as CatchAll) : "");
                  }}
                >
                  <option value="">Choose later</option>
                  {(["life-admin", "erosion-guard"] as CatchAll[]).map(c => (
                    <option key={c} value={`c:${c}`}>{CATCH_ALL_LABEL[c]}</option>
                  ))}
                  {projects
                    .filter(p => p.status === "active")
                    .map(p => (
                      <option key={p.id} value={`p:${p.id}`}>
                        {p.title}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                First step (optional)
                <input
                  value={nextAction}
                  onChange={e => setNextAction(e.target.value)}
                  maxLength={1000}
                  placeholder={
                    parsed.nextAction ||
                    "e.g. Open the estimate and check the materials."
                  }
                />
              </label>
              <button
                type="button"
                className="text-button"
                disabled={!parsed.title.trim()}
                onClick={() => {
                  setNextAction(parsed.title);
                  setActionOk(true);
                }}
              >
                Title is the step
              </button>
              <details className="detail-section">
                <summary>More</summary>
              <div className="form-pair">
                <label className="field">
                  State
                  <select
                    value={state}
                    onChange={e => setState(e.target.value as TaskState | "")}
                  >
                    <option value="">Use detected state</option>
                    <option value="inbox">Not ready yet</option>
                    <option value="waiting">Waiting</option>
                  </select>
                </label>
              </div>
              {(state || parsed.state) === "waiting" && (
                <label className="field">
                  Who or what are you waiting for?
                  <input
                    value={waitingFor}
                    onChange={e => setWaitingFor(e.target.value)}
                    placeholder={
                      parsed.waitingFor || "e.g. Maya to send the measurements"
                    }
                    maxLength={500}
                  />
                </label>
              )}
                <p className="small muted">
                  Role, pattern and Imperative links are set in the Weekly Review.
                </p>
              </details>
                </>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <p className="small muted">
                Try #home, #vehicles, #business or #personal; “due tomorrow”,
                “by Friday”, “15 minutes”, #direction / #support and #timely /
                #sustained, or “next: call the mechanic”. Without a next step it
                goes to clarification, with a review in seven days.
              </p>
            </>
          )}
          {focused && (
            <p className="small muted">
              For your focused task, you can say “done”, “later”, or “read next
              action” and review the proposed action.
            </p>
          )}
          <p className="privacy-note">
            {voiceOriginated
              ? "Voice starts only when you ask. Your browser may send speech to its recognition service. The editable transcript remains a draft until you choose Create task."
              : manualReviewOnly
                ? sourceAlreadyShared
                  ? "Voice starts only when you ask. Your browser may send speech to its recognition service. The source Wear Log stays in the shared workspace; if you choose Create task, its editable copy is saved as ordinary task content and follows the usual connector visibility."
                  : "Voice starts only when you ask. Your browser may send speech to its recognition service. The source note stays in this browser unless you choose Create task; then its editable copy is saved as ordinary task content and follows the usual connector visibility."
                : "Voice starts only when you ask. Your browser may send speech to its recognition service and may need internet access. Typed titles may autosave as drafts; browser and native voice transcripts stay editable and unsaved until you choose Create task. Nothing files automatically. Check the sync notice if typed draft saving is unavailable."}
          </p>
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={close}>
              Close
            </button>
            <button
              type="submit"
              className="button primary"
                disabled={
                  !text.trim() ||
                  !hasMeaningfulParsedTaskTitle(draftTask.title) ||
                  voice.listening ||
                  voiceTranscriptPending ||
                  unsupportedVoiceCommand ||
                  (autoSaveState === "saving" &&
                    savedDraftRef.current === taskEditFingerprint(draftTask))
                }
            >
              {command
                ? "Confirm action"
                : unsupportedVoiceCommand
                  ? "No task focused"
                  : voiceTranscriptPending
                    ? "Waiting for speech"
                    : kind === "idea"
                      ? "Save idea"
                      : manualReviewOnly || voiceOriginated
                        ? "Create task"
                        : "Save & close"}
              <ArrowRight size={16} />
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
