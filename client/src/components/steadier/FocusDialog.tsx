import { useEffect, useState } from "react";
import {
  Pause,
  Play,
  Check,
  Volume2,
  Mic,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";
import type { FocusSession, Task } from "../../domain/types";
import TimingShapeMark from "./TimingShapeMark";
interface Props {
  task: Task;
  projectTitle?: string;
  focus: FocusSession;
  onFocus: (f: FocusSession | null) => boolean | void;
  onClose: () => void;
  onDone: (id: string) => void;
  onEdit: (t: Task) => void;
  onRead: (text: string) => void;
  onVoice: () => void;
  remoteFocus?: boolean;
  takeoverPending?: boolean;
  takeoverBlocked?: boolean;
  takeoverStatus?: string;
  takeoverError?: string;
  onTakeFocus?: () => boolean | void;
}
export default function FocusDialog(p: Props) {
  const [drifting, setDrifting] = useState(false);
  const [step, setStep] = useState(p.focus.step);
  const [takeoverQueued, setTakeoverQueued] = useState(false);
  const [takeoverActionError, setTakeoverActionError] = useState("");
  const taskCompleted = p.task.state === "done";
  useEffect(() => {
    if (!p.remoteFocus || p.takeoverPending || p.takeoverBlocked) {
      setTakeoverQueued(false);
      setTakeoverActionError("");
    }
  }, [p.remoteFocus, p.takeoverPending, p.takeoverBlocked]);
  const requestTakeover = () => {
    setTakeoverActionError("");
    if (!p.onTakeFocus || p.onTakeFocus() === false) {
      setTakeoverQueued(false);
      setTakeoverActionError(
        "Focus transfer was not started. Check the shared workspace sync or recovery status, then retry."
      );
      return;
    }
    setTakeoverQueued(true);
  };
  let takeoverMessage = "";
  let takeoverMessageRole: "status" | "alert" = "status";
  if (p.takeoverPending) {
    takeoverMessage = `Transfer queued. ${
      p.takeoverError ||
      "Waiting for the shared workspace to confirm; the timer remains paused here."
    }`;
  } else if (takeoverActionError) {
    takeoverMessage = takeoverActionError;
    takeoverMessageRole = "alert";
  } else if (takeoverQueued) {
    takeoverMessage =
      "Sending the focus transfer. The timer remains paused here until the shared workspace confirms ownership.";
  } else if (p.takeoverBlocked) {
    takeoverMessage =
      p.takeoverError ||
      (p.takeoverStatus === "loading"
        ? "The shared workspace is still loading. Try again once it is ready."
        : "The shared workspace needs attention. Open Server & Compass, resolve the sync issue, then retry.");
    takeoverMessageRole = "alert";
  } else if (p.takeoverStatus === "offline" && p.takeoverError) {
    takeoverMessage = p.takeoverError;
  }
  const change = (patch: Partial<FocusSession>) =>
    p.onFocus({ ...p.focus, ...patch, updatedAt: Date.now() }) !== false;
  const reset = (mins: number) =>
    change({ remaining: mins * 60, duration: mins * 60, running: true });
  const remaining = Math.max(0, p.focus.remaining);
  const minutes = Math.floor(remaining / 60);
  const seconds = Math.floor(remaining % 60)
    .toString()
    .padStart(2, "0");
  return (
    <Dialog open onOpenChange={open => !open && p.onClose()}>
      <DialogContent className="focus-dialog">
        <div className="eyebrow">ONE THING IS ENOUGH FOR THIS MOMENT</div>
        <DialogTitle className="dialog-heading">
          <TimingShapeMark task={p.task} /> {p.task.title}
        </DialogTitle>
        <DialogDescription>
          {taskCompleted
            ? "This responsibility is complete; its scheduled timer continues."
            : "Your place is saved, even if you pause."}
        </DialogDescription>
        {p.remoteFocus && (
          <div className="notice">
            <strong>The running timer belongs to another device.</strong>
            <p>
              This device shows the saved checkpoint. Take focus here
              deliberately to continue; it does not run a second timer
              automatically.
            </p>
            <button
              type="button"
              className="button secondary"
              disabled={p.takeoverBlocked || p.takeoverPending || takeoverQueued}
              onClick={requestTakeover}
            >
              {p.takeoverPending || takeoverQueued
                ? "Requesting focus…"
                : "Take focus on this device"}
            </button>
            {takeoverMessage && (
              <p
                className={
                  takeoverMessageRole === "alert" ? "small error" : "small muted"
                }
                role={takeoverMessageRole}
              >
                {takeoverMessage}
              </p>
            )}
          </div>
        )}
        {(p.task.purpose || p.projectTitle) && (
          <div className="focus-purpose">
            <span className="eyebrow">WHAT THIS STEP SUPPORTS</span>
            <p>{p.task.purpose || p.projectTitle}</p>
            {p.projectTitle && p.task.purpose && (
              <span className="small muted">Outcome: {p.projectTitle}</span>
            )}
          </div>
        )}
        <div className="focus-next">
          <span className="eyebrow">THE STEP YOU CHOSE</span>
          <p>{p.focus.step || p.task.nextAction}</p>
        </div>
        <div
          className="focus-timer"
          role="timer"
          aria-label={`${minutes} minutes ${seconds} seconds remaining`}
        >
          {minutes.toString().padStart(2, "0")}
          <span>:</span>
          {seconds}
        </div>
        <p className="small muted timer-note">
          {remaining === 0
            ? taskCompleted
              ? "The timebox has ended. The task stays complete."
              : "A good moment to choose again. The task is not automatically complete."
            : taskCompleted
              ? p.focus.running
                ? "The countdown continues; time after completion is not added to task work."
                : "Task complete. Timer paused; resume or end it when ready."
              : p.focus.running
                ? "A little protected time. No need to finish everything."
                : "Paused. Changing the plan is allowed."}
        </p>
        <div className="focus-controls">
          {remaining > 0 ? (
            <button
              className="button primary"
              disabled={p.remoteFocus}
              onClick={() => change({ running: !p.focus.running })}
            >
              {p.focus.running ? <Pause size={17} /> : <Play size={17} />}
              {p.focus.running ? "Pause" : "Resume"}
            </button>
          ) : (
            <button
              className="button primary"
              disabled={p.remoteFocus}
              onClick={() => reset(10)}
            >
              <Play size={16} />
              Another 10 minutes
            </button>
          )}
          {!taskCompleted && (
            <button
              className="button secondary"
              disabled={p.remoteFocus}
              onClick={() => p.onDone(p.task.id)}
            >
              <Check size={17} />
              Finished this responsibility
            </button>
          )}
        </div>
        <div className="duration-options">
          <span className="small muted">Choose a smaller start:</span>
          {[2, 10, 25].map(n => (
            <button
              key={n}
              className="text-button"
              disabled={p.remoteFocus}
              onClick={() => reset(n)}
            >
              {n} min
            </button>
          ))}
        </div>
        <div className="focus-tools">
          <button
            className="text-button"
            onClick={() =>
              p.onRead(
                `${p.task.title}. Your next step is ${p.focus.step || p.task.nextAction}`
              )
            }
          >
            <Volume2 size={16} />
            Read my next step
          </button>
          <button
            className="text-button"
            disabled={p.remoteFocus}
            onClick={p.onVoice}
          >
            <Mic size={16} />
            Voice action
          </button>
          <button
            className="text-button"
            disabled={p.remoteFocus}
            onClick={() => {
              if (change({ running: false })) setDrifting(!drifting);
            }}
          >
            <RefreshCw size={16} />
            I'm drifting
          </button>
        </div>
        {drifting && (
          <div className="drift-panel">
            <h3>No judgement. Find your footing.</h3>
            <p className="small">
              You chose to give this part of your life attention. Has something
              genuinely more timely arisen, or would a smaller step help you
              return? Compass can help if the choice itself needs revisiting.
            </p>
            <label className="field">
              A two-minute entry step
              <input
                value={step}
                onChange={e => setStep(e.target.value)}
                maxLength={1000}
                placeholder="e.g. Open the document. Find the phone number."
              />
            </label>
            <button
              className="button primary"
              disabled={p.remoteFocus || !step.trim()}
              onClick={() => {
                change({
                  step: step.trim(),
                  remaining: 120,
                  duration: 120,
                  running: true,
                });
                setDrifting(false);
              }}
            >
              Try just this step
              <ArrowRight size={16} />
            </button>
            <div className="drift-options">
              <button
                className="text-button"
                onClick={() => {
                  p.onEdit(p.task);
                  p.onClose();
                }}
              >
                Something is blocking me — update the plan
              </button>
              <button
                className="text-button"
                onClick={() => {
                  change({ running: false });
                  p.onClose();
                }}
              >
                Take a break. Keep my place.
              </button>
            </div>
          </div>
        )}
        <button
          className="text-button end-focus"
          disabled={p.remoteFocus}
          onClick={() => {
            if (p.onFocus(null) !== false) p.onClose();
          }}
        >
          {taskCompleted ? "End timer" : "End focus without completing the task"}
        </button>
        <p className="privacy-note">
          A calm tone marks the end (and halfway, if you chose it in Settings)
          while Steadier is open. It is a checkpoint, not a measure of your
          attention. Voice actions always ask you to confirm.
        </p>
      </DialogContent>
    </Dialog>
  );
}
