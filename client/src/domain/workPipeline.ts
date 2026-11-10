import {
  heldReason,
  kindCounts,
  taskKind,
  type KindContext,
} from "./todayStates";
import type { Project, Task, Workspace } from "./types";

export interface PipelineTask {
  task: Task;
  kind: ReturnType<typeof taskKind>;
  heldReason: string | null;
}

export interface PipelineProject {
  project: Project;
  tasks: PipelineTask[];
  suggestedTasks: Task[];
  counts: { active: number; suggested: number; held: number };
  completedCount: number;
  milestoneProgress: { done: number; total: number };
  latestProgress: { at: string; text: string } | null;
}

function taskOrder(a: Task, b: Task): number {
  const key = (task: Task) =>
    task.schedule.date ?? task.deadline ?? task.reviewDate ?? "9999-12-31";
  return key(a).localeCompare(key(b)) || a.title.localeCompare(b.title);
}

/** Read-only project view: only saved projectId links count as membership. */
export function buildWorkPipeline(
  workspace: Workspace,
  kinds: KindContext
): PipelineProject[] {
  return [...workspace.projects]
    .sort(
      (a, b) =>
        Number(a.status === "achieved") - Number(b.status === "achieved") ||
        (a.schedule.deadline ?? "9999-12-31").localeCompare(
          b.schedule.deadline ?? "9999-12-31"
        ) ||
        a.title.localeCompare(b.title)
    )
    .map(project => {
      const projectTasks = workspace.tasks.filter(
        task => task.projectId === project.id
      );
      const linkedTasks = projectTasks
        .filter(task => !task.compass.projectSuggested)
        .sort(taskOrder);
      const openTasks = linkedTasks.filter(task => task.state !== "done");
      const tasks = linkedTasks.map(task => ({
        task,
        kind: taskKind(task, kinds),
        heldReason: heldReason(task, workspace.tasks),
      }));
      const suggestedTasks = projectTasks
        .filter(task => task.state !== "done" && task.compass.projectSuggested)
        .sort(taskOrder);
      const counts = kindCounts(openTasks, kinds);
      return {
        project,
        tasks,
        suggestedTasks,
        counts,
        completedCount: linkedTasks.filter(task => task.state === "done")
          .length,
        milestoneProgress: {
          done: project.milestones.filter(milestone => milestone.done).length,
          total: project.milestones.length,
        },
        latestProgress:
          [...project.progress].sort((a, b) => b.at.localeCompare(a.at))[0] ??
          null,
      };
    });
}
