// Read-only views of the task card and Ideas shelf for the Claude connector.
import {
  DOT_LABEL,
  cardDots,
  ideas,
  isIdea,
  isSetUp,
  letGoIdeas,
  missingDots,
  notReadyTasks,
} from "../../client/src/domain/taskCard";
import type { Task, Workspace } from "../../client/src/domain/types";
import { toAdelaideIso } from "../../shared/time";

export function taskSetup(task: Task, all: Task[]) {
  return {
    ready: isIdea(task) ? null : isSetUp(task, all),
    isIdea: isIdea(task),
    dots: cardDots(task, all),
    missing: missingDots(task, all).map(dot => DOT_LABEL[dot]),
  };
}

export function ideasView(workspace: Workspace, includeLetGo: boolean) {
  const present = (t: Task) => ({
    taskId: t.id,
    title: t.title,
    notes: t.notes,
    capturedAt: toAdelaideIso(t.createdAt),
    ...(t.droppedAt ? { letGoAt: toAdelaideIso(t.droppedAt) } : {}),
  });
  const shelf = ideas(workspace.tasks);
  const gone = letGoIdeas(workspace.tasks);
  return {
    ideas: shelf.map(present),
    count: shelf.length,
    letGoCount: gone.length,
    ...(includeLetGo ? { letGo: gone.map(present) } : {}),
  };
}

export function setupView(workspace: Workspace, taskId: string | null, limit: number) {
  const all = workspace.tasks;
  if (taskId) {
    const task = all.find(t => t.id === taskId);
    if (!task) return null;
    return { tasks: [{ taskId: task.id, title: task.title, ...taskSetup(task, all) }] };
  }
  const faded = notReadyTasks(all);
  return {
    notReadyCount: faded.length,
    tasks: faded.slice(0, limit).map(t => ({ taskId: t.id, title: t.title, ...taskSetup(t, all) })),
  };
}
