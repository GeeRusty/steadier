import { taskKind, type KindContext, type TaskKind } from "./todayStates";
import type { Task, Workspace } from "./types";

export type YearEventSource = "task" | "project" | "obligation" | "review";

export interface YearWheelEvent {
  id: string;
  date: string;
  label: string;
  category: string;
  source: YearEventSource;
  sourceId: string;
  taskKind: TaskKind | null;
  taskDone: boolean;
  detail: string;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function stampDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  return isCalendarDate(date) ? date : null;
}

/**
 * Read-only annual index of dates already stored in the workspace. It does not
 * synthesize future repeat occurrences or infer links between records.
 */
export function yearWheelEvents(
  workspace: Workspace,
  year: number,
  kinds: KindContext
): YearWheelEvent[] {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return [];
  const events: YearWheelEvent[] = [];
  const add = (
    dateValue: string | null | undefined,
    source: YearEventSource,
    sourceId: string,
    category: string,
    label: string,
    detail = "",
    task?: Task
  ) => {
    const date = stampDate(dateValue);
    if (!date || Number(date.slice(0, 4)) !== year) return;
    events.push({
      id: `${source}:${sourceId}:${category}:${date}`,
      date,
      label,
      category,
      source,
      sourceId,
      taskKind: task ? taskKind(task, kinds) : null,
      taskDone: task?.state === "done",
      detail,
    });
  };

  for (const task of workspace.tasks) {
    add(
      task.schedule.date,
      "task",
      task.id,
      task.obligation?.active ? "preparation-task" : "task-planned",
      task.title,
      task.obligation?.active ? "Planned preparation task" : "Planned task",
      task
    );
    add(
      task.deadline,
      "task",
      task.id,
      "task-deadline",
      task.title,
      "Task deadline",
      task
    );
    add(
      task.startDate,
      "task",
      task.id,
      "task-start",
      task.title,
      "Task starts",
      task
    );
    add(
      task.reviewDate,
      "task",
      task.id,
      "task-review",
      task.title,
      "Task review",
      task
    );
    add(
      task.deferredUntil,
      "task",
      task.id,
      "task-deferred",
      task.title,
      "Deferred until",
      task
    );
    if (task.preparationDate)
      add(
        task.preparationDate,
        "task",
        task.id,
        "task-preparation-date",
        task.title,
        task.preparationSource === "confirmed"
          ? "Confirmed preparation date"
          : "Suggested preparation date",
        task
      );
    add(
      task.completedAt,
      "task",
      task.id,
      "task-completed",
      task.title,
      "Completed",
      task
    );
  }

  for (const project of workspace.projects) {
    add(
      project.schedule.deadline,
      "project",
      project.id,
      "project-deadline",
      project.title,
      project.outcome
    );
    add(
      project.schedule.reviewDate,
      "project",
      project.id,
      "project-review",
      project.title,
      project.purpose
    );
    for (const milestoneDate of project.schedule.milestoneDates) {
      const milestone = project.milestones.find(
        item => item.id === milestoneDate.id
      );
      add(
        milestoneDate.date,
        "project",
        project.id,
        `milestone-${milestoneDate.id}`,
        milestone?.title ?? project.title,
        "Project milestone"
      );
    }
    for (const progress of project.progress) {
      add(
        progress.at,
        "project",
        project.id,
        `progress-${progress.at}`,
        project.title,
        progress.text
      );
    }
  }

  for (const obligation of workspace.obligations ?? []) {
    add(
      obligation.dueDate,
      "obligation",
      obligation.id,
      "obligation-due",
      obligation.title,
      obligation.kind
    );
    add(
      obligation.lastPaidDueDate,
      "obligation",
      obligation.id,
      "obligation-last-due",
      obligation.title,
      obligation.kind
    );
    add(
      obligation.lastPaidOn,
      "obligation",
      obligation.id,
      "obligation-paid",
      obligation.title,
      obligation.kind
    );
  }

  for (const review of workspace.reviews) {
    add(
      review.date,
      "review",
      review.id,
      "weekly-review",
      "Weekly Reality Review",
      "Review completed"
    );
  }

  for (const evidence of workspace.evidence ?? []) {
    add(
      evidence.createdAt,
      evidence.targetKind,
      evidence.targetId,
      `evidence-${evidence.id}`,
      evidence.titleSnapshot,
      "Evidence recorded"
    );
  }

  return events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.category.localeCompare(b.category) ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id)
  );
}
