import { updateTask } from "./engine";
import type { Task } from "./types";

/** Existing repeating tasks with an existing checklist; no new routine record. */
export function isRunnableRoutine(task: Task): boolean {
  return (
    task.state !== "done" &&
    Boolean(task.schedule.repeat) &&
    task.checklist.length > 0
  );
}

export function runnableRoutines(tasks: Task[]): Task[] {
  return tasks.filter(isRunnableRoutine).sort((a, b) => {
    const dateA = a.schedule.date ?? a.deadline ?? "9999-12-31";
    const dateB = b.schedule.date ?? b.deadline ?? "9999-12-31";
    return dateA.localeCompare(dateB) || a.title.localeCompare(b.title);
  });
}

/**
 * Toggle a single existing checklist item and write task history. This never
 * completes the task, advances a repeat, or creates a follow-up occurrence.
 */
export function setRoutineChecklistItem(
  tasks: Task[],
  taskId: string,
  itemId: string,
  checked: boolean
): Task[] {
  const task = tasks.find(item => item.id === taskId);
  if (!task || !isRunnableRoutine(task)) return tasks;
  const item = task.checklist.find(entry => entry.id === itemId);
  if (!item || item.done === checked) return tasks;
  const checklist = task.checklist.map(entry =>
    entry.id === itemId ? { ...entry, done: checked } : { ...entry }
  );
  const updated = updateTask(
    task,
    { checklist },
    `${checked ? "Checked" : "Reopened"} routine step: ${item.text}.`
  );
  return tasks.map(item => (item.id === taskId ? updated : item));
}
