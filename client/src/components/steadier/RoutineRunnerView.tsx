import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Play, Volume2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { describeRepeat } from "../../domain/time";
import { KIND_LABEL, type KindContext } from "../../domain/todayStates";
import { taskKind } from "../../domain/todayStates";
import { runnableRoutines } from "../../domain/routineRunner";
import type { Task, Workspace } from "../../domain/types";
import TimingShapeMark from "./TimingShapeMark";

interface Props {
  workspace: Workspace;
  kinds: KindContext;
  readOnly: boolean;
  onToggleChecklist: (
    taskId: string,
    itemId: string,
    checked: boolean
  ) => boolean | void;
  onCompleteTask: (taskId: string) => boolean | void;
  onOpenTask: (task: Task) => void;
  onRead?: (text: string) => void;
}

export default function RoutineRunnerView({
  workspace,
  kinds,
  readOnly,
  onToggleChecklist,
  onCompleteTask,
  onOpenTask,
  onRead,
}: Props) {
  const routines = useMemo(
    () => runnableRoutines(workspace.tasks),
    [workspace.tasks]
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (selectedId && routines.some(task => task.id === selectedId)) return;
    setSelectedId(routines[0]?.id ?? null);
  }, [routines, selectedId]);
  const selected = routines.find(task => task.id === selectedId) ?? null;
  const checked = selected?.checklist.filter(item => item.done).length ?? 0;
  const remaining = (selected?.checklist.length ?? 0) - checked;
  const currentKind = selected ? taskKind(selected, kinds) : null;

  const toggle = (task: Task, itemId: string, value: boolean) => {
    setNotice("");
    if (onToggleChecklist(task.id, itemId, value) === false)
      setNotice("That step did not save. Check sync and try again.");
  };
  const readRoutine = () => {
    if (!selected || !onRead) return;
    onRead(
      `${selected.title}. ${describeRepeat(selected.schedule.repeat)}. ${selected.checklist
        .map(item => `${item.done ? "Done" : "To do"}: ${item.text}.`)
        .join(" ")}`
    );
  };

  return (
    <main className="routine-runner-view page-view">
      <header className="page-heading">
        <div>
          <div className="eyebrow">EXISTING REPEATING TASKS</div>
          <h1>Routine Runner</h1>
          <p>
            Choose a repeating Task that already has a checklist. Ticking steps
            updates that Task only; completion is always a separate action and
            uses Steadier's existing repeat rules.
          </p>
        </div>
      </header>
      {readOnly && (
        <div className="notice small" role="status">
          This workspace is read-only while it connects or resolves a sync
          conflict. You can review routines but not change checklist steps.
        </div>
      )}
      {!routines.length ? (
        <div className="empty-state">
          <Play size={24} aria-hidden />
          <h2>No checklist routines yet</h2>
          <p>
            Add a checklist and repeat rule to an existing Task. The Runner does
            not create routines or recurring Tasks for you.
          </p>
        </div>
      ) : (
        <div className="routine-layout">
          <nav className="routine-list" aria-label="Repeating checklist tasks">
            {routines.map(task => {
              const kind = taskKind(task, kinds);
              return (
                <button
                  className={`routine-choice${task.id === selectedId ? " selected" : ""}`}
                  type="button"
                  key={task.id}
                  aria-pressed={task.id === selectedId}
                  onClick={() => {
                    setNotice("");
                    setSelectedId(task.id);
                  }}
                >
                  <strong>
                    <TimingShapeMark task={task} /> {task.title}
                  </strong>
                  <span className="small muted">
                    {describeRepeat(task.schedule.repeat)} ·{" "}
                    {task.checklist.filter(i => i.done).length}/
                    {task.checklist.length} steps
                  </span>
                  {kind && (
                    <span className={`task-kind ${kind}`}>
                      {KIND_LABEL[kind]}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
          {selected && (
            <section
              className="routine-session"
              aria-labelledby="routine-title"
            >
              <div className="routine-session-heading">
                <div>
                  <div className="eyebrow">
                    {describeRepeat(selected.schedule.repeat)}
                  </div>
                  <h2 id="routine-title">{selected.title}</h2>
                </div>
                {onRead && (
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Read routine aloud"
                    onClick={readRoutine}
                  >
                    <Volume2 size={17} aria-hidden />
                  </button>
                )}
              </div>
              <div className="routine-progress" role="status">
                <span>
                  {checked} of {selected.checklist.length} steps complete
                </span>
                {currentKind && (
                  <span className={`task-kind ${currentKind}`}>
                    {KIND_LABEL[currentKind]}
                  </span>
                )}
              </div>
              <div className="routine-checklist">
                {selected.checklist.map(item => (
                  <label
                    className={`routine-step${item.done ? " done" : ""}`}
                    key={item.id}
                  >
                    <input
                      type="checkbox"
                      checked={item.done}
                      disabled={readOnly}
                      onChange={event =>
                        toggle(selected, item.id, event.target.checked)
                      }
                    />
                    <span>{item.text}</span>
                  </label>
                ))}
              </div>
              {notice && (
                <p className="error" role="alert">
                  {notice}
                </p>
              )}
              <div className="routine-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onOpenTask(selected)}
                >
                  Open Task details
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={readOnly}
                  onClick={() => setConfirmComplete(true)}
                >
                  <CheckCircle2 size={16} aria-hidden /> Complete this
                  occurrence
                </button>
              </div>
              <p className="small muted">
                {remaining
                  ? `${remaining} step${remaining === 1 ? " remains" : "s remain"} unchecked. Completing is still your choice; the checklist will not complete the Task by itself.`
                  : "All checklist steps are checked. The Task remains open until you confirm completion."}
              </p>
            </section>
          )}
        </div>
      )}
      <AlertDialog open={confirmComplete} onOpenChange={setConfirmComplete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete this task occurrence?</AlertDialogTitle>
            <AlertDialogDescription>
              {remaining
                ? `${remaining} checklist step${remaining === 1 ? " is" : "s are"} still unchecked. Nothing will be ticked for you. If this Task repeats, Steadier will use its existing recurrence and completion rules only after you confirm.`
                : "If this Task repeats, Steadier will use its existing recurrence and completion rules only after you confirm."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it open</AlertDialogCancel>
            <button
              className="button primary"
              type="button"
              disabled={readOnly || !selected}
              onClick={() => {
                if (!selected) return;
                if (onCompleteTask(selected.id) !== false)
                  setConfirmComplete(false);
              }}
            >
              Complete task
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
