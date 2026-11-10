import React, { type ChangeEvent } from "react";

interface Props {
  taskTitle: string;
  checked: boolean;
  disabled?: boolean;
  note?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

/**
 * A compact, visible completion tick for the shared task-detail pane.
 * This component only forwards a human checkbox change; it never writes work.
 */
export default function TaskDetailDoneControl({
  taskTitle,
  checked,
  disabled = false,
  note,
  onChange,
}: Props) {
  return (
    <div
      className="task-pane-done-control"
      data-task-autosave-exempt
    >
      <label
        className={`task-pane-done-tick${disabled ? " is-disabled" : ""}`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-label={checked ? `Unmark ${taskTitle} as done` : `Mark ${taskTitle} done`}
          onChange={onChange}
        />
        <span>Done</span>
      </label>
      {note && <span className="task-pane-done-note">{note}</span>}
    </div>
  );
}
