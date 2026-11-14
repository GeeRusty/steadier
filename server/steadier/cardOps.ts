// Read-only views of the task card for the Claude connector.
import {
  DOT_LABEL,
  cardDots,
  isIdea,
  isSetUp,
  missingDots,
  notReadyTasks,
} from "../../client/src/domain/taskCard";
import type { Project, Task, Workspace } from "../../client/src/domain/types";
import type { Imperative } from "../../client/src/domain/compass";
import {
  heldLinkItems,
  linkCheckCount,
  unlinkedImperatives,
  unlinkedProjects,
  projectsWithoutGoalOutcome,
} from "../../client/src/domain/linkCheck";
import { toAdelaideIso } from "../../shared/time";

export function taskSetup(task: Task, all: Task[]) {
  return {
    ready: isIdea(task) ? null : isSetUp(task, all),
    isIdea: isIdea(task),
    dots: cardDots(task, all),
    missing: missingDots(task, all).map(dot => DOT_LABEL[dot]),
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

// ---------------------------------------------------------------------------
// Link check (read-only for the connector)

export function linkCheckView(workspace: Workspace) {
  const imperative = (i: Imperative) => ({
    imperativeId: i.id,
    title: i.title,
    reason: i.reason,
    ...(i.decision ? { decision: i.decision.outcome, decisionConfirmed: i.decision.confirmed } : {}),
  });
  const project = (p: Project) => ({
    projectId: p.id,
    title: p.title,
    pattern: p.pattern,
    ...(p.compass.imperativesSuggested && p.compass.imperativeIds.length
      ? { suggestedImperativeIds: p.compass.imperativeIds }
      : {}),
  });
  const held = heldLinkItems(workspace);
  return {
    count: linkCheckCount(workspace),
    imperativesWithNoWork: unlinkedImperatives(workspace).map(imperative),
    imperativeProjectsWithNoImperative: unlinkedProjects(workspace).map(project),
    projectsWithNoGoalOutcome: projectsWithoutGoalOutcome(workspace).map(p => ({ projectId: p.id, title: p.title })),
    notYet: {
      imperatives: held.imperatives.map(imperative),
      projects: held.projects.map(project),
    },
    rules:
      "List 1: active Imperatives with no open task and no active project linked by the owner. List 2: active projects in the Imperative row (stored role 'direction') not linked to an active Imperative. List 3: active projects with no confirmed Goal Outcome. Suggested links do not count. Not yet items are held until the next Weekly Reality Review. Read-only: you may suggest links with set_my_life_placement (saved as suggestions); only the owner confirms, chooses Not yet, makes a project Support, or steps an Imperative down.",
  };
}
