import { StateMark } from "./TaskStates";
import TimingShapeMark from "./TimingShapeMark";
import { useContext } from "react";
import {
  Bell,
  Clock,
  CornerDownRight,
  ListTree,
  MapPin,
  Repeat,
} from "lucide-react";
import { OrphanMark, PlacesContext, TaskListContext } from "./OrphanUI";
import type { Task } from "../../domain/types";
import {
  adelaideClock,
  describeRepeat,
  describeFlexibleWindow,
  flexibleWindowState,
  formatDuration,
  formatTime,
} from "../../domain/time";
import { friendlyDate } from "../../domain/quickParse";
import { repeatRuleOf } from "../../domain/engine";
import { parentOf, subtaskProgress } from "../../domain/subtasks";

/** "at Bunnings" badge for tasks with a place. */
function PlaceChip({ task }: { task: Task }) {
  const places = useContext(PlacesContext);
  if (!task.placeId) return null;
  const place = places.find(p => p.id === task.placeId);
  if (!place) return null;
  return (
    <span className="time-chip place-chip" title="Place for this task">
      <MapPin size={13} aria-hidden />
      at {place.name.length > 28 ? `${place.name.slice(0, 27)}…` : place.name}
    </span>
  );
}
/** "Subtask of …" and "2/5 subtasks" badges, using the shared task list. */
function SubtaskChips({
  task,
  hideParent,
}: {
  task: Task;
  hideParent?: boolean;
}) {
  const all = useContext(TaskListContext);
  if (!all) return null;
  const parent = hideParent ? null : parentOf(all, task);
  const progress = subtaskProgress(all, task.id);
  if (!parent && !progress.total) return null;
  return (
    <>
      {parent && (
        <span
          className={`time-chip subtask-chip${task.parent?.suggested ? " suggested" : ""}`}
          title={
            task.parent?.suggested
              ? "Suggested parent, awaiting your Confirm"
              : "Parent task"
          }
        >
          <CornerDownRight size={13} aria-hidden />
          {task.parent?.suggested ? "suggested under " : "under "}
          {wordTrim(parent.title, 32)}
        </span>
      )}
      {progress.total > 0 && (
        <span
          className="time-chip subtask-chip"
          aria-label={`${progress.done} of ${progress.total} subtasks done`}
        >
          <ListTree size={13} aria-hidden />
          {progress.done}/{progress.total}
        </span>
      )}
    </>
  );
}

/** Shorten at a word boundary, never mid-word. */
function wordTrim(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > 8 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
/** Compact planned-slot / repeat / reminder / subtask badges for a task card. */
export default function TimeChips({
  task,
  hideParent,
}: {
  task: Task;
  /** Hide "under …" when the card already sits beneath its parent. */
  hideParent?: boolean;
}) {
  const s = task.schedule;
  const rule = repeatRuleOf(task);
  const today = adelaideClock().date;
  const overdue = s.date && s.date < today && task.state !== "done";
  return (
    <span className="time-chips">
      <TimingShapeMark task={task} />
      <StateMark task={task} />
      <OrphanMark task={task} />
      <SubtaskChips task={task} hideParent={hideParent} />
      <PlaceChip task={task} />
      {s.flexibleWindow &&
        (() => {
          const windowState = flexibleWindowState(s.flexibleWindow, today);
          const effort = s.minutes ? ` · ${formatDuration(s.minutes)}` : "";
          const label =
            windowState === "expired"
              ? "Needs rescheduling"
              : windowState === "closes-today"
                ? `Window closes today${effort}`
                : windowState === "upcoming"
                  ? `Window: ${describeFlexibleWindow(s.flexibleWindow, today)}${effort}`
                  : `Finish within: ${describeFlexibleWindow(s.flexibleWindow, today)}${effort}`;
          return (
            <span
              className={`time-chip flexible-window-chip${windowState === "expired" ? " needs-rescheduling" : ""}`}
              aria-label={label}
              title={label}
            >
              <Clock size={13} aria-hidden />
              {label}
            </span>
          );
        })()}
      {s.date && (
        <span
          className={`time-chip${overdue ? " overdue" : ""}${s.fixed ? " fixed" : ""}`}
        >
          <Clock size={13} aria-hidden />
          {friendlyDate(s.date, today)}
          {s.time ? ` ${formatTime(s.time)}` : ""}
          {s.time
            ? ` · ${formatDuration(s.minutes ?? task.estimate ?? 15)}`
            : ""}
          {s.fixed ? " · fixed" : ""}
        </span>
      )}
      {rule && (
        <span className="time-chip">
          <Repeat size={13} aria-hidden />
          {describeRepeat(rule)}
        </span>
      )}
      {s.reminders.length > 0 && (
        <span
          className="time-chip"
          aria-label={`${s.reminders.length} reminder${s.reminders.length === 1 ? "" : "s"}`}
        >
          <Bell size={13} aria-hidden />
          {s.reminders.length}
        </span>
      )}
    </span>
  );
}
