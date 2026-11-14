import React from "react";
import type { Workspace } from "../../domain/types";
import { upkeepDue, type UpkeepItem } from "../../domain/assets";

export type UpkeepAction = "log" | "record" | "reading";

/**
 * The rows under "Upkeep due" (Needs attention and the Weekly Review): each due
 * service, revisit or stale reading once. Create task only opens a draft.
 */
export default function UpkeepDueList({
  workspace,
  today,
  readOnly,
  onCreateTask,
  onOpenTask,
  onAct,
}: {
  workspace: Workspace;
  today: string;
  readOnly: boolean;
  onCreateTask: (item: UpkeepItem) => void;
  onOpenTask: (taskId: string) => void;
  onAct: (item: UpkeepItem, action: UpkeepAction) => void;
}) {
  const items = upkeepDue(workspace, today);
  if (!items.length) return <p className="lv-quiet">No upkeep due.</p>;
  return (
    <ul className="uk-list" aria-label="Upkeep due">
      {items.map(item => {
        const task = item.taskId ? workspace.tasks.find(t => t.id === item.taskId) : undefined;
        return (
          <li key={item.key} className="uk-item">
            <span>
              {item.assetName} · {item.what}
            </span>
            <span className="lv-meta">{item.detail}</span>
            {task && task.state === "done" && (
              <span className="lv-meta">The task is done. Log it here so the next one counts from today.</span>
            )}
            {!readOnly && (
              <span className="lv-row-actions">
                {item.kind !== "reading" &&
                  (task ? (
                    <button type="button" className="tp-btn" onClick={() => onOpenTask(task.id)}>
                      {task.state === "done" ? "Task done ›" : "Task ›"}
                    </button>
                  ) : (
                    <button type="button" className="tp-btn" onClick={() => onCreateTask(item)}>
                      Create task
                    </button>
                  ))}
                <button
                  type="button"
                  className="tp-btn"
                  onClick={() => onAct(item, item.kind === "service" ? "log" : item.kind === "revisit" ? "record" : "reading")}
                >
                  {item.kind === "service" ? "Log it done" : item.kind === "revisit" ? "Record check" : "Update reading"}
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
