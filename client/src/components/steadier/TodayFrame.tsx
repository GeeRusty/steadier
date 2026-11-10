import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Compass,
  Mic,
  RefreshCw,
  Save,
  Square,
  Volume2,
} from "lucide-react";
import { addDays, derivedState, stateLabel, today } from "../../domain/engine";
import type { Task, Workspace } from "../../domain/types";
import type { CloudStatus } from "../../../../shared/cloud";
import type { VoiceControls } from "../../hooks/useVoice";

interface Props {
  workspace: Workspace;
  /** Returns false when the change was refused or could not be stored. */
  onMutate: (change: (w: Workspace) => Workspace) => boolean | void;
  onOpenTask: (t: Task) => void;
  onStartTask: (t: Task) => void;
  readOnly: boolean;
  /** Plain-language reason saving is currently unavailable, when known. */
  blockedReason?: string;
  /** Shared-space sync status, or "local" for browser-only spaces. */
  syncStatus?: CloudStatus;
  onRetry?: () => void;
  voice?: VoiceControls;
  /** Start dictation as soon as the editor opens (voice is the default). */
  autoListen?: boolean;
}

function intentionKey(
  value:
    | { date: string; text: string; taskId: string | null }
    | null
    | undefined
): string | null {
  return value ? JSON.stringify([value.date, value.text, value.taskId]) : null;
}

type Feedback =
  | { kind: "saved"; message: string }
  | { kind: "failed"; message: string }
  | null;

export default function TodayFrame({
  workspace,
  onMutate,
  onOpenTask,
  onStartTask,
  readOnly,
  blockedReason,
  syncStatus = "local",
  onRetry,
  voice,
  autoListen = false,
}: Props) {
  const [text, setText] = useState(workspace.intention?.text ?? "");
  const [taskId, setTaskId] = useState(workspace.intention?.taskId ?? "");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [dictating, setDictating] = useState(false);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const dictationBase = useRef("");
  const currentDay = today();
  const yesterday = addDays(currentDay, -1);
  const intention = workspace.intention;

  useEffect(() => {
    setText(workspace.intention?.text ?? "");
    setTaskId(workspace.intention?.taskId ?? "");
  }, [
    workspace.intention?.date,
    workspace.intention?.text,
    workspace.intention?.taskId,
  ]);

  // Dictation fills the intention box only while this frame owns the session.
  useEffect(() => {
    if (!dictating || !voice) return;
    if (voice.transcript) {
      const base = dictationBase.current;
      setText(`${base}${base ? " " : ""}${voice.transcript}`.slice(0, 1000));
      setFeedback(null);
    }
  }, [dictating, voice, voice?.transcript]);
  useEffect(() => {
    if (dictating && (!voice || !voice.listening)) setDictating(false);
  }, [dictating, voice, voice?.listening]);

  const availableTasks = useMemo(() => {
    const saved = workspace.tasks.find(task => task.id === intention?.taskId);
    const active = workspace.tasks.filter(task => task.state !== "done");
    return saved && !active.some(task => task.id === saved.id)
      ? [saved, ...active]
      : active;
  }, [intention?.taskId, workspace.tasks]);
  const chosenTask = workspace.tasks.find(task => task.id === taskId) ?? null;
  const chosenState = chosenTask
    ? derivedState(chosenTask, workspace.tasks)
    : null;
  // A local write can fail after the in-memory view already changed. Remember
  // exactly which intention was not stored so it is never labelled as saved.
  const notStored =
    !readOnly && failedKey !== null && failedKey === intentionKey(intention);
  const hasTodayIntention = intention?.date === currentDay && !notStored;
  const savedTask = intention?.taskId
    ? (workspace.tasks.find(task => task.id === intention.taskId) ?? null)
    : null;
  const unsavedEdits =
    (text.trim() !== (intention?.text ?? "") ||
      (taskId || null) !== (intention?.taskId ?? null)) &&
    Boolean(text.trim() || taskId);

  const unavailableMessage =
    blockedReason ||
    "Saving is paused in this space right now. Your words stay in the box.";

  const save = () => {
    if (readOnly) {
      setFeedback({ kind: "failed", message: unavailableMessage });
      return;
    }
    // Ask for the local date at the moment of saving, rather than holding an
    // earlier render's date across local midnight.
    const saveDay = today();
    const accepted = onMutate(current => ({
      ...current,
      intention: {
        date: saveDay,
        text: text.trim(),
        taskId: taskId || null,
      },
    }));
    if (accepted === false) {
      setFailedKey(
        intentionKey({
          date: saveDay,
          text: text.trim(),
          taskId: taskId || null,
        })
      );
      setFeedback({
        kind: "failed",
        message: `Not saved. ${blockedReason || "This browser could not store the change."} Your words are still in the box, so you can try again.`,
      });
      return;
    }
    setFailedKey(null);
    setFeedback({
      kind: "saved",
      message:
        syncStatus === "local"
          ? "Saved for today in this space."
          : "Saved for today. Sending it to your shared space now.",
    });
  };

  const readBack = () => {
    if (!voice) return;
    if (voice.speaking) {
      voice.stopSpeaking();
      return;
    }
    const words = intention?.text?.trim();
    const task = savedTask ? ` Your next task is ${savedTask.title}.` : "";
    voice.read(
      words
        ? `Today's intention: ${words}.${task}`
        : savedTask
          ? `Today's chosen task is ${savedTask.title}.`
          : "No intention is saved for today yet."
    );
  };

  const toggleDictation = () => {
    if (!voice || readOnly) return;
    if (voice.listening) {
      voice.stop();
      return;
    }
    dictationBase.current = text.trim();
    voice.clear();
    setDictating(true);
    voice.start();
  };

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoListen || autoStarted.current || !voice?.supported || readOnly)
      return;
    autoStarted.current = true;
    toggleDictation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoListen, voice?.supported, readOnly]);
  const returnToTask = () => {
    if (!chosenTask) return;
    // A return is allowed for every chosen task, but only ready work may enter
    // focus. Blocked and waiting work is opened for a conscious next choice.
    if (chosenState === "ready") onStartTask(chosenTask);
    else onOpenTask(chosenTask);
  };

  const intentionDateLabel = notStored
    ? "Not stored yet — tap save again"
    : !intention
      ? "No saved intention yet"
      : intention.date === currentDay
        ? `Saved for today · ${intention.date}`
        : intention.date === yesterday
          ? `Previous day · ${intention.date}`
          : `Saved for ${intention.date}`;

  const syncNote =
    syncStatus === "synced"
      ? "Stored on your shared server."
      : syncStatus === "saving"
        ? "Sending to your shared server…"
        : syncStatus === "offline"
          ? "Kept in this browser; it will send when you are back online."
          : null;

  return (
    <section
      className="settings-section today-frame"
      aria-labelledby="today-frame-title"
    >
      <div className="section-heading today-frame-heading">
        <div>
          <h2 id="today-frame-title">Today’s intention</h2>
        </div>
        <Compass size={21} aria-hidden="true" />
      </div>

      <div
        className={`today-frame-date ${hasTodayIntention ? "is-today" : ""}`}
      >
        <strong>
          {hasTodayIntention && <Check size={15} aria-hidden="true" />}{" "}
          {intentionDateLabel}
        </strong>
        {intention && !notStored && (intention.text || savedTask) && (
          <span className="today-saved-words">
            {intention.text ? `“${intention.text}”` : ""}
            {savedTask
              ? `${intention.text ? " · " : ""}Next: ${savedTask.title}`
              : ""}
          </span>
        )}
        {hasTodayIntention && syncNote && (
          <span className="small muted">{syncNote}</span>
        )}
        {intention && !hasTodayIntention && !notStored && (
          <span className="small muted">
            Today is {currentDay}. You can carry this forward, or choose again.
          </span>
        )}
        {voice?.speechSupported && intention && (
          <button
            type="button"
            className="text-button small"
            onClick={readBack}
          >
            {voice.speaking ? <Square size={14} /> : <Volume2 size={14} />}
            {voice.speaking ? "Stop reading" : "Read my intention aloud"}
          </button>
        )}
      </div>

      {readOnly && (
        <div className="today-frame-blocked" role="status">
          <span>{unavailableMessage}</span>
          {onRetry && (
            <button
              type="button"
              className="button secondary small-button"
              onClick={onRetry}
            >
              <RefreshCw size={14} /> Retry connection
            </button>
          )}
        </div>
      )}

      <label className="field today-intention-field">
        What have I chosen with Compass?
        <textarea
          aria-label="What have I chosen with Compass?"
          value={text}
          rows={3}
          maxLength={1000}
          disabled={readOnly}
          placeholder="Name the direction or small step you are choosing to return to."
          onChange={event => {
            setText(event.target.value);
            setFeedback(null);
          }}
        />
      </label>
      {voice?.supported && (
        <button
          type="button"
          className={`button ${voice.listening && dictating ? "listening" : "secondary"} small-button today-dictate`}
          disabled={readOnly || (voice.listening && !dictating)}
          onClick={toggleDictation}
        >
          {voice.listening && dictating ? (
            <Square size={15} />
          ) : (
            <Mic size={15} />
          )}
          {voice.listening && dictating
            ? "Stop listening"
            : "Speak my intention"}
        </button>
      )}

      <label className="field">
        Optional saved next task
        <select
          aria-label="Optional saved next task"
          value={taskId}
          disabled={readOnly}
          onChange={event => {
            setTaskId(event.target.value);
            setFeedback(null);
          }}
        >
          <option value="">No task selected</option>
          {availableTasks.map(task => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
      </label>

      {chosenTask && chosenState && (
        <div className="today-chosen-task">
          <div>
            <strong>{chosenTask.title}</strong>
            <span>
              {chosenTask.nextAction ||
                "Choose a small next step when you open it."}
            </span>
            {chosenState !== "ready" && (
              <span className="small muted">
                This task is {stateLabel(chosenState).toLocaleLowerCase()}.
                Return opens it; it will not be started.
              </span>
            )}
          </div>
          <button
            className="button secondary small-button"
            onClick={returnToTask}
          >
            Return to chosen task <ArrowRight size={15} />
          </button>
        </div>
      )}

      <div className="today-frame-actions">
        <button
          className="button primary"
          disabled={!text.trim() && !taskId}
          aria-disabled={readOnly || undefined}
          onClick={save}
        >
          <Save size={16} />{" "}
          {notStored
            ? "Try saving again"
            : unsavedEdits || !hasTodayIntention
              ? "Save today’s intention"
              : "Saved — save again"}
        </button>
        <p
          className={`small ${feedback?.kind === "failed" ? "error" : feedback ? "success" : "muted"}`}
          role={feedback?.kind === "failed" ? "alert" : "status"}
          aria-live="polite"
        >
          {feedback
            ? feedback.message
            : unsavedEdits
              ? "Not saved yet. Tap save to keep these words for today."
              : "One line is enough. Change it any time."}
        </p>
      </div>
    </section>
  );
}
