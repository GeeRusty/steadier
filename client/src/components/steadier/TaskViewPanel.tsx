import React, { useMemo } from "react";
import { ArrowLeft, CalendarDays, Clock3, MapPin, Pencil, Repeat, Volume2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import type { Place, Task } from "../../domain/types";
import { googleMapsDirectionsUrl } from "../../domain/places";
import { childrenOf, parentOf, subtaskProgress } from "../../domain/subtasks";
import {
  describeFlexibleWindow,
  describeRepeat,
  formatDuration,
  formatTime,
} from "../../domain/time";
import { derivedState, repeatRuleOf, stateLabel as derivedStateLabel } from "../../domain/engine";
import { friendlyDate } from "../../domain/quickParse";
import TaskDetailDoneControl from "./TaskDetailDoneControl";
import TimingShapeMark from "./TimingShapeMark";

export interface TaskViewPanelProps {
  task: Task;
  tasks: Task[];
  places?: Place[];
  today: string;
  projectTitle?: string;
  readOnly?: boolean;
  onClose: () => void;
  onEdit: (task: Task) => void;
  onOpenTask: (task: Task) => void;
  onDone: (id: string) => boolean | void;
  onReopen: (id: string) => boolean | void;
  onCompleteSubtask: (id: string) => boolean | void;
  onConfirmSuggestion: (id: string, expectedParentId: string) => boolean | void;
  onDismissSuggestion: (id: string, expectedParentId: string) => boolean | void;
  onConfirmAll: (parentId: string) => boolean | void;
  onRead?: (text: string) => void;
}

function taskWhen(task: Task, today: string): string {
  const schedule = task.schedule;
  if (schedule.flexibleWindow) {
    return `Flexible window · ${describeFlexibleWindow(schedule.flexibleWindow, today)} (inclusive) · no fixed clock time`;
  }
  if (schedule.date) {
    const kind = schedule.fixed
      ? schedule.time ? "Booked" : "Booked all-day"
      : "Planned";
    const time = schedule.time
      ? ` · starts ${formatTime(schedule.time)}`
      : " · no fixed clock time";
    return `${kind} · ${friendlyDate(schedule.date, today)}${time}`;
  }
  if (schedule.repeatAnchorDate) {
    const time = schedule.time ? ` · ${formatTime(schedule.time)}` : " · no fixed clock time";
    return `Recurring · anchored ${friendlyDate(schedule.repeatAnchorDate, today)}${time}`;
  }
  return "No scheduled date or clock time";
}

function taskDuration(task: Task): string {
  const scheduledMinutes = task.schedule.minutes;
  const minutes = scheduledMinutes && scheduledMinutes > 0 ? scheduledMinutes : task.estimate;
  const kind = task.schedule.fixed && task.schedule.time && !task.schedule.flexibleWindow
    ? "Booked duration"
    : "Effort estimate";
  return minutes > 0 ? `${kind} · ${formatDuration(minutes)}` : "No duration estimate";
}

function deadlineLabel(task: Task, today: string): string | null {
  if (!task.deadline) return null;
  return `Hard deadline · ${friendlyDate(task.deadline, today)}${task.schedule.deadlineTime ? ` · ${formatTime(task.schedule.deadlineTime)}` : ""}`;
}

function readAloudText(task: Task, today: string, children: Task[]): string {
  const parts = [task.title, taskWhen(task, today), taskDuration(task)];
  if (task.nextAction.trim()) parts.push(`Next action: ${task.nextAction}`);
  if (task.notes.trim()) parts.push(`Notes: ${task.notes}`);
  if (children.length) {
    parts.push(`Subtasks: ${children.map(child => `${child.title}${child.state === "done" ? ", done" : ""}${child.parent?.suggested ? ", suggested, needs confirmation" : ""}`).join("; ")}.`);
  }
  return parts.join(". ");
}

export default function TaskViewPanel({
  task: selectedTask,
  tasks,
  places = [],
  today,
  projectTitle,
  readOnly = false,
  onClose,
  onEdit,
  onOpenTask,
  onDone,
  onReopen,
  onCompleteSubtask,
  onConfirmSuggestion,
  onDismissSuggestion,
  onConfirmAll,
  onRead,
}: TaskViewPanelProps) {
  const currentTask = tasks.find(candidate => candidate.id === selectedTask.id);
  const task = currentTask ?? selectedTask;
  const panelReadOnly = readOnly || !currentTask;
  const place = task.placeId
    ? places.find(candidate => candidate.id === task.placeId)
    : undefined;
  const directionsUrl = place ? googleMapsDirectionsUrl(place) : null;
  const children = useMemo(() => childrenOf(tasks, task.id), [tasks, task.id]);
  const parent = useMemo(() => parentOf(tasks, task), [tasks, task]);
  const progress = useMemo(() => subtaskProgress(tasks, task.id), [tasks, task.id]);
  const suggestedChildren = children.filter(child => child.parent?.suggested);
  const deadline = deadlineLabel(task, today);
  const suggestedParent = Boolean(task.parent?.suggested);
  const derivedStatus = derivedState(task, tasks, today);
  const doneNote = panelReadOnly
    ? "Read-only while this workspace is loading or recovering."
    : task.state === "done"
      ? repeatRuleOf(task)
        ? "Uncheck Done to reopen this occurrence. Its next occurrence will stay scheduled."
        : "Uncheck Done to reopen this task."
      : suggestedParent
        ? "Confirm or dismiss its suggested parent before marking it done."
        : undefined;
  const childDoneNote = (child: Task) => {
    if (panelReadOnly) return "Read-only while this workspace is loading or recovering.";
    if (child.parent?.suggested) return "Confirm or dismiss this suggestion before completing it.";
    return undefined;
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="task-dialog task-view-dialog">
        {parent && (
          <button
            type="button"
            className="task-view-parent-link"
            onClick={() => onOpenTask(parent)}
            aria-label={`Back to parent task ${parent.title}`}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Parent task: <strong>{parent.title}</strong></span>
          </button>
        )}

        <div className="task-view-header">
          <div className="task-view-heading-copy">
            <div className="eyebrow">TASK VIEW</div>
            <DialogTitle className="dialog-heading task-view-title">{task.title}</DialogTitle>
            <div className="task-view-status-row" aria-label="Task status">
              <TimingShapeMark task={task} />
              <span className={`task-view-state${derivedStatus === "done" ? " is-done" : ""}`}>
                {derivedStateLabel(derivedStatus)}
              </span>
              {suggestedParent && <span className="task-view-suggested-tag">Suggested subtask</span>}
            </div>
          </div>
          <div className="task-view-completion-actions" role="group" aria-label="Task completion">
            <TaskDetailDoneControl
              taskTitle={task.title}
              checked={task.state === "done"}
              disabled={panelReadOnly || suggestedParent}
              note={doneNote}
              onChange={event => {
                if (event.currentTarget.checked) onDone(task.id);
                else onReopen(task.id);
              }}
            />
          </div>
        </div>
        <DialogDescription className="task-view-description">
          {!currentTask
            ? "This task is no longer in the current workspace. Its actions are disabled."
            : panelReadOnly
              ? "Read-only while this workspace is loading or recovering."
              : "Task details. Use Edit to change the task; uncheck Done to reopen a completed task. Checking a subtask saves that completion immediately."}
        </DialogDescription>

        <section className="task-view-timing" aria-label="Task timing and placement">
          <div className="task-view-detail-line">
            <CalendarDays size={17} aria-hidden="true" />
            <span>{taskWhen(task, today)}</span>
          </div>
          <div className="task-view-detail-line">
            <Clock3 size={17} aria-hidden="true" />
            <span>{taskDuration(task)}</span>
          </div>
          {deadline && (
            <div className="task-view-detail-line is-deadline">
              <CalendarDays size={17} aria-hidden="true" />
              <span>{deadline}</span>
            </div>
          )}
          {task.schedule.repeat && (
            <div className="task-view-detail-line">
              <Repeat size={17} aria-hidden="true" />
              <span>{describeRepeat(repeatRuleOf(task) ?? task.schedule.repeat)}</span>
            </div>
          )}
          {place && (
            <div className="task-view-place-line">
              <div className="task-view-detail-line">
                <MapPin size={17} aria-hidden="true" />
                <span>
                  <strong>{place.name}</strong>
                  {place.address ? ` · ${place.address}` : ""}
                </span>
              </div>
              {directionsUrl && (
                <a
                  className="button secondary task-view-map-link"
                  href={directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open directions to ${place.name} in Google Maps`}
                  title={`Open directions to ${place.name} in Google Maps`}
                >
                  <MapPin size={16} aria-hidden="true" /> Open in Google Maps
                </a>
              )}
            </div>
          )}
          {(projectTitle || task.area) && (
            <div className="task-view-placement">
              {projectTitle && <span className="task-view-project">{projectTitle}</span>}
              {task.area && <span>{task.area}</span>}
            </div>
          )}
        </section>

        {task.nextAction.trim() ? (
          <section className="task-view-section" aria-labelledby="task-view-next-action-heading">
            <h3 id="task-view-next-action-heading">Next action</h3>
            <p>{task.nextAction}</p>
          </section>
        ) : (
          <section className="task-view-section" aria-labelledby="task-view-next-action-heading">
            <h3 id="task-view-next-action-heading">Next action</h3>
            <p className="task-view-empty">No next action yet. Add one small physical step in Edit.</p>
          </section>
        )}
        <section className="task-view-section" aria-labelledby="task-view-notes-heading">
          <h3 id="task-view-notes-heading">Notes</h3>
          {task.notes.trim()
            ? <p className="task-view-notes">{task.notes}</p>
            : <p className="task-view-empty">No notes yet.</p>}
        </section>

        {suggestedParent && parent && (
          <section className="task-view-suggestion" aria-label="Suggested parent confirmation">
            <div>
              <span className="task-view-suggested-tag">Suggested</span>
              <span> This subtask was suggested under “{parent.title}”.</span>
            </div>
            <div className="task-view-suggestion-actions">
              <button type="button" className="button small-button" disabled={panelReadOnly} aria-label={`Confirm suggested parent ${parent.title}`} onClick={() => onConfirmSuggestion(task.id, task.parent!.id)}>Confirm</button>
              <button type="button" className="button secondary small-button" disabled={panelReadOnly} aria-label={`Dismiss suggested parent ${parent.title}`} onClick={() => onDismissSuggestion(task.id, task.parent!.id)}>Dismiss</button>
            </div>
          </section>
        )}

        <section className="task-view-section task-view-subtasks" aria-labelledby="task-view-subtasks-heading">
          <div className="task-view-subtasks-heading">
            <div>
              <h3 id="task-view-subtasks-heading">Subtasks</h3>
              <span className="task-view-subtask-count">
                {progress.done} of {progress.total} done
                {suggestedChildren.length ? ` · ${suggestedChildren.length} suggested` : ""}
              </span>
            </div>
            {suggestedChildren.length > 0 && (
              <button
                type="button"
                className="button secondary small-button"
                disabled={panelReadOnly}
                onClick={() => onConfirmAll(task.id)}
              >
                Confirm all
              </button>
            )}
          </div>
          {children.length === 0 ? (
            <p className="task-view-empty">No subtasks yet.</p>
          ) : (
            <ul className="task-view-subtask-list" aria-label={`Subtasks of ${task.title}`}>
              {children.map(child => {
                const suggested = Boolean(child.parent?.suggested);
                const childState = child.state === "done";
                const childNote = childDoneNote(child);
                const childNoteId = `task-view-child-note-${child.id}`;
                return (
                  <li key={child.id} className={`task-view-subtask${suggested ? " is-suggested" : ""}${childState ? " is-done" : ""}`}>
                    <div className="task-view-subtask-main">
                      <label className="task-view-subtask-check">
                        <input
                          type="checkbox"
                          checked={childState}
                          disabled={panelReadOnly || childState || suggested}
                          aria-label={childState ? `${child.title} is done` : `Mark ${child.title} done`}
                          aria-describedby={childNote ? childNoteId : undefined}
                          onChange={() => { onCompleteSubtask(child.id); }}
                        />
                        <span className="sr-only">Done</span>
                      </label>
                      <button
                        type="button"
                        className="task-view-subtask-open"
                        onClick={() => onOpenTask(child)}
                        aria-label={`Open subtask ${child.title}`}
                      >
                        <TimingShapeMark task={child} />
                        <span>{child.title}</span>
                      </button>
                    </div>
                    {suggested && (
                      <div className="task-view-subtask-actions">
                        <span className="task-view-suggested-tag">Suggested</span>
                        <button type="button" className="text-button task-view-confirm" disabled={panelReadOnly} aria-label={`Confirm suggested subtask ${child.title}`} onClick={() => onConfirmSuggestion(child.id, task.id)}>Confirm</button>
                        <button type="button" className="text-button task-view-dismiss" disabled={panelReadOnly} aria-label={`Dismiss suggested subtask ${child.title}`} onClick={() => onDismissSuggestion(child.id, task.id)}>Dismiss</button>
                      </div>
                    )}
                    {childNote && <span id={childNoteId} className="sr-only">{childNote}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="task-view-actions task-view-sticky-actions" role="group" aria-label="Task actions">
          {onRead && (
            <button
              type="button"
              className="button secondary"
              onClick={() => onRead(readAloudText(task, today, children))}
              aria-label={`Read ${task.title} aloud`}
            >
              <Volume2 size={16} aria-hidden="true" /> Read aloud
            </button>
          )}
          <button type="button" className="button task-view-edit" disabled={panelReadOnly} onClick={() => onEdit(task)}>
            <Pencil size={16} aria-hidden="true" /> Edit
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
