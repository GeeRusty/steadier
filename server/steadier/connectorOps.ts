import {
  addSubtask,
  releaseSubtasks,
  setTaskParent,
} from "../../client/src/domain/subtasks";
import {
  CATCH_ALL_LABEL,
  DECISION_LABEL,
  normaliseNotionUrl,
  type CatchAll,
  type Decision,
  type DecisionOutcome,
} from "../../client/src/domain/compass";
import { emptyProjectCompass } from "../../client/src/domain/compass";
import {
  GOAL_LEVEL_LABEL,
  linkParent,
  linkProject,
  PARENT_LEVEL,
  type Goal,
} from "../../client/src/domain/goals";
import {
  adelaideClock,
  DEFAULT_PLANNING,
  describeRepeat,
  emptyProjectSchedule,
  formatTime,
  type ProjectSchedule,
  type TaskSchedule,
} from "../../client/src/domain/time";
import { poolTasks } from "../../client/src/domain/anchorPlanning";
import { clearNextThingForTask } from "../../client/src/domain/nextThing";
import { randomUUID } from "node:crypto";
import type {
  Context,
  LifePattern,
  LifeRole,
  Project,
  Task,
  TaskState,
  WorkspaceContact,
  Workspace,
} from "../../client/src/domain/types";
import { completeTask, createTask } from "../../client/src/domain/engine";
import type { ConnectorActor, PendingDeleteRequest } from "../../shared/cloud";
import { adelaideTimestamp, formatAdelaide } from "../../shared/time";
import {
  ChangeError,
  type ChangePlan,
  type WorkspaceBackupDocument,
} from "./changes";

/** Human-readable source label for an authenticated connector. */
export function connectorName(actor: ConnectorActor): string {
  return actor === "chatgpt"
    ? "ChatGPT"
    : actor === "claude"
      ? "Claude"
      : "MCP connector";
}

export type TaskFields = {
  title?: string;
  area?: string;
  nextAction?: string;
  notes?: string;
  state?: TaskState;
  projectId?: string | null;
  role?: LifeRole | null;
  pattern?: LifePattern | null;
  purpose?: string;
  deadline?: string | null;
  reviewDate?: string | null;
  startDate?: string | null;
  preparationDate?: string | null;
  waitingFor?: string;
  estimate?: number;
  context?: Context;
  progressEvidence?: string;
  passOverCount?: number;
  /** A reversible owner decision; this never deletes the task. */
  dropped?: boolean;
};

export type ProjectFields = {
  title?: string;
  purpose?: string;
  outcome?: string;
  role?: LifeRole;
  pattern?: LifePattern;
  status?: Project["status"];
};

const TASK_FIELD_LABELS: Record<keyof TaskFields, string> = {
  title: "title",
  area: "area",
  nextAction: "next action",
  notes: "notes",
  state: "state",
  projectId: "project link",
  role: "role",
  pattern: "pattern",
  purpose: "purpose",
  deadline: "deadline",
  reviewDate: "review date",
  startDate: "start date",
  preparationDate: "preparation date",
  waitingFor: "waiting for",
  estimate: "estimate",
  context: "context",
  progressEvidence: "progress evidence",
  passOverCount: "pass-over count",
  dropped: "kept Dropped decision",
};
/** Short scalar fields whose new value is written into the history line. */
const SHOW_VALUE = new Set<keyof TaskFields>([
  "state",
  "role",
  "pattern",
  "deadline",
  "reviewDate",
  "startDate",
  "preparationDate",
  "estimate",
  "context",
  "passOverCount",
  "dropped",
]);

const PROJECT_FIELD_LABELS: Record<keyof ProjectFields, string> = {
  title: "title",
  purpose: "purpose",
  outcome: "outcome",
  role: "role",
  pattern: "pattern",
  status: "status",
};

function quoted(text: string, max = 80): string {
  const single = text.replace(/\s+/g, " ").trim();
  return `“${single.length > max ? `${single.slice(0, max - 1)}…` : single}”`;
}

function connectorLine(
  actor: ConnectorActor,
  text: string,
  note?: string
): string {
  const name = connectorName(actor);
  const extra = note?.trim()
    ? ` ${name}'s note: ${note.trim().slice(0, 300)}`
    : "";
  return `${name}: ${text}${extra}`;
}

function requireTask(workspace: Workspace, taskId: string): Task {
  const task = workspace.tasks.find(candidate => candidate.id === taskId);
  if (!task) throw new ChangeError("NOT_FOUND", "Task not found.");
  return task;
}

function requireProject(workspace: Workspace, projectId: string): Project {
  const project = workspace.projects.find(
    candidate => candidate.id === projectId
  );
  if (!project) throw new ChangeError("NOT_FOUND", "Project not found.");
  return project;
}

function checkProjectLink(
  workspace: Workspace,
  projectId: string | null | undefined
) {
  if (projectId) requireProject(workspace, projectId);
}

function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined)
  ) as Partial<T>;
}

/** Create one task. Done is not a starting state; complete it with an update. */
export function planCreateTask(
  workspace: Workspace,
  fields: TaskFields & { title: string },
  note: string | undefined,
  now: Date,
  actor: ConnectorActor = "claude"
): ChangePlan<{ task: Task }> {
  checkProjectLink(workspace, fields.projectId);
  if (fields.state === "done") {
    throw new ChangeError(
      "INVALID_CHANGE",
      "Create the task first, then mark it done with update_my_life_task."
    );
  }
  const stamp = adelaideTimestamp(now);
  const input = defined(fields);
  const task = createTask({
    ...input,
    title: fields.title,
    ...(fields.role !== undefined || fields.pattern !== undefined
      ? { labelSource: "suggested" as const }
      : {}),
    ...(fields.preparationDate !== undefined
      ? { preparationSource: "suggested" as const }
      : {}),
    createdAt: stamp,
    updatedAt: stamp,
    history: [
      { at: stamp, text: connectorLine(actor, "Created this task.", note) },
    ],
  });
  // A project link made by Claude is a suggestion until the owner confirms it.
  if (task.projectId)
    task.compass = { ...task.compass, projectSuggested: true };
  return {
    workspace: { ...workspace, tasks: [...workspace.tasks, task] },
    summary: `${connectorName(actor)}: created task ${quoted(task.title)}`,
    result: { task },
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function planUpdateTask(
  workspace: Workspace,
  taskId: string,
  fields: TaskFields,
  note: string | undefined,
  now: Date,
  actor: ConnectorActor = "claude"
): ChangePlan<{ task: Task; changed: string[] }> {
  const task = requireTask(workspace, taskId);
  checkProjectLink(workspace, fields.projectId);
  const patch = defined(fields);
  const changedKeys = (Object.keys(patch) as (keyof TaskFields)[]).filter(
    key =>
      key === "dropped"
        ? Boolean(task.droppedAt) !== Boolean(patch.dropped)
        : !sameValue(task[key as keyof Task], patch[key])
  );
  if (changedKeys.length === 0) {
    throw new ChangeError(
      "INVALID_CHANGE",
      "Nothing to change: every supplied value already matches the saved task."
    );
  }
  const stamp = adelaideTimestamp(now);
  const described = changedKeys.map(key => {
    const label = TASK_FIELD_LABELS[key];
    if (key === "dropped")
      return patch.dropped ? `${label} recorded` : `${label} reopened`;
    if (key === "projectId") {
      const target = patch.projectId
        ? workspace.projects.find(project => project.id === patch.projectId)
        : null;
      return target
        ? `${label} → ${quoted(target.title, 60)}`
        : `${label} removed`;
    }
    return SHOW_VALUE.has(key)
      ? `${label} → ${String(patch[key] ?? "none")}`
      : label;
  });
  const completing = patch.state === "done" && task.state !== "done";
  const reopening =
    patch.state !== undefined &&
    patch.state !== "done" &&
    task.state === "done";
  const {
    state: _state,
    dropped,
    passOverCount,
    ...otherFields
  } = patch;
  const updated: Task = {
    ...task,
    ...otherFields,
    ...(passOverCount !== undefined ? { passOverCount } : {}),
    ...(dropped !== undefined ? { droppedAt: dropped ? stamp : null } : {}),
    ...(completing
      ? {}
      : patch.state !== undefined
        ? { state: patch.state }
        : {}),
    ...(reopening ? { completedAt: null } : {}),
    ...(patch.role !== undefined || patch.pattern !== undefined
      ? { labelSource: "suggested" as const }
      : {}),
    ...(patch.preparationDate !== undefined
      ? { preparationSource: "suggested" as const }
      : {}),
    ...(patch.projectId !== undefined && patch.projectId !== task.projectId
      ? {
          compass: {
            ...task.compass,
            projectSuggested: patch.projectId !== null,
          },
        }
      : {}),
    updatedAt: stamp,
    history: [
      ...task.history,
      {
        at: stamp,
        text: connectorLine(actor, `Changed ${described.join(", ")}.`, note),
      },
    ],
  };
  let tasks = workspace.tasks.map(candidate =>
    candidate.id === taskId ? updated : candidate
  );
  let focus = workspace.focus;
  if (completing) {
    const before = new Set(tasks.map(candidate => candidate.id));
    tasks = completeTask(tasks, taskId).map(candidate => {
      if (candidate.id === taskId) {
        const history = candidate.history.slice(0, -1);
        return {
          ...candidate,
          completedAt: stamp,
          updatedAt: stamp,
          history: [
            ...history,
            { at: stamp, text: connectorLine(actor, "Marked this task done.") },
          ],
        };
      }
      if (!before.has(candidate.id)) {
        // The next recurring occurrence is also a connector-made change.
        return {
          ...candidate,
          createdAt: stamp,
          updatedAt: stamp,
          history: [
            {
              at: stamp,
              text: connectorLine(
                actor,
                "Created the next recurring occurrence."
              ),
            },
          ],
        };
      }
      return candidate;
    });
    if (focus?.taskId === taskId) focus = null;
  }
  const final = tasks.find(candidate => candidate.id === taskId)!;
  return {
    workspace: completing
      ? clearNextThingForTask({ ...workspace, tasks, focus }, taskId)
      : { ...workspace, tasks, focus },
    summary: `${connectorName(actor)}: updated task ${quoted(task.title)} (${described.join(", ")})`,
    result: {
      task: final,
      changed: changedKeys.map(key => TASK_FIELD_LABELS[key]),
    },
  };
}

export function planCreateProject(
  workspace: Workspace,
  fields: ProjectFields & {
    title: string;
    role: LifeRole;
    pattern: LifePattern;
  },
  now: Date,
  actor: ConnectorActor = "claude"
): ChangePlan<{ project: Project }> {
  const stamp = adelaideTimestamp(now);
  const project: Project = {
    id: randomUUID(),
    title: fields.title.trim(),
    purpose: fields.purpose ?? "",
    outcome: fields.outcome ?? "",
    role: fields.role,
    pattern: fields.pattern,
    status: fields.status ?? "active",
    milestones: [],
    progress: [],
    schedule: emptyProjectSchedule(),
    // Claude must supply role and pattern; they stay suggested until confirmed.
    compass: { ...emptyProjectCompass(), labelsConfirmed: false },
    createdAt: stamp,
    updatedAt: stamp,
  };
  return {
    workspace: { ...workspace, projects: [...workspace.projects, project] },
    summary: `${connectorName(actor)}: created project ${quoted(project.title)}`,
    result: { project },
  };
}

export function planUpdateProject(
  workspace: Workspace,
  projectId: string,
  fields: ProjectFields,
  note: string | undefined,
  now: Date,
  actor: ConnectorActor = "claude"
): ChangePlan<{ project: Project; changed: string[] }> {
  const project = requireProject(workspace, projectId);
  const patch = defined(fields);
  const changedKeys = (Object.keys(patch) as (keyof ProjectFields)[]).filter(
    key => !sameValue(project[key], patch[key])
  );
  if (changedKeys.length === 0) {
    throw new ChangeError(
      "INVALID_CHANGE",
      "Nothing to change: every supplied value already matches the saved project."
    );
  }
  const stamp = adelaideTimestamp(now);
  const described = changedKeys.map(key =>
    key === "role" || key === "pattern" || key === "status"
      ? `${PROJECT_FIELD_LABELS[key]} → ${String(patch[key])}`
      : PROJECT_FIELD_LABELS[key]
  );
  const labelsTouched = patch.role !== undefined || patch.pattern !== undefined;
  const updated: Project = {
    ...project,
    ...patch,
    compass: labelsTouched
      ? { ...project.compass, labelsConfirmed: false }
      : project.compass,
    updatedAt: stamp,
  };
  // Projects have no history list of their own, so each linked task records
  // the project change, labelled and timed like every other connector change.
  const line = connectorLine(
    actor,
    `Changed its project ${quoted(project.title, 60)}: ${described.join(", ")}.`,
    note
  );
  const tasks = workspace.tasks.map(task =>
    task.projectId === projectId
      ? { ...task, history: [...task.history, { at: stamp, text: line }] }
      : task
  );
  return {
    workspace: {
      ...workspace,
      tasks,
      projects: workspace.projects.map(candidate =>
        candidate.id === projectId ? updated : candidate
      ),
    },
    summary: `${connectorName(actor)}: updated project ${quoted(project.title)} (${described.join(", ")})`,
    result: {
      project: updated,
      changed: changedKeys.map(key => PROJECT_FIELD_LABELS[key]),
    },
  };
}

/** Claude may only ask. The item stays fully intact until the owner decides. */
export function planRequestDelete(
  workspace: Workspace,
  kind: "task" | "project",
  itemId: string,
  reason: string,
  now: Date,
  actor: ConnectorActor = "claude"
): ChangePlan<{ itemTitle: string }> {
  const stamp = adelaideTimestamp(now);
  const cleanReason = reason.trim().slice(0, 1000);
  if (kind === "task") {
    const task = requireTask(workspace, itemId);
    const line = connectorLine(
      actor,
      `Asked to delete this task. It is only marked pending delete until you confirm or keep it in Steadier. Reason given: ${cleanReason}`
    );
    return {
      workspace: {
        ...workspace,
        tasks: workspace.tasks.map(candidate =>
          candidate.id === itemId
            ? {
                ...candidate,
                history: [...candidate.history, { at: stamp, text: line }],
              }
            : candidate
        ),
      },
      summary: `${connectorName(actor)}: requested deletion of task ${quoted(task.title)} (pending your confirmation)`,
      result: { itemTitle: task.title },
      pendingDelete: {
        itemKind: "task",
        itemId,
        itemTitle: task.title.slice(0, 500),
        reason: cleanReason,
        requestedBy: actor,
      },
    };
  }
  const project = requireProject(workspace, itemId);
  const line = connectorLine(
    actor,
    `Asked to delete its project ${quoted(project.title, 60)}. Nothing is removed until you confirm in Steadier. Reason given: ${cleanReason}`
  );
  return {
    workspace: {
      ...workspace,
      tasks: workspace.tasks.map(task =>
        task.projectId === itemId
          ? { ...task, history: [...task.history, { at: stamp, text: line }] }
          : task
      ),
    },
    summary: `${connectorName(actor)}: requested deletion of project ${quoted(project.title)} (pending your confirmation)`,
    result: { itemTitle: project.title },
    pendingDelete: {
      itemKind: "project",
      itemId,
      itemTitle: project.title.slice(0, 500),
      reason: cleanReason,
      requestedBy: actor,
    },
  };
}

/** Owner-confirmed deletion. Relationships are cleaned so the workspace stays valid. */
export function planConfirmDelete(
  workspace: Workspace,
  request: PendingDeleteRequest,
  now: Date
): ChangePlan<{ removed: boolean }> {
  const stamp = adelaideTimestamp(now);
  const requestedBy = connectorName(request.requestedBy ?? "claude");
  const settle = { id: request.id, status: "deleted" as const };
  if (request.itemKind === "task") {
    const exists = workspace.tasks.some(task => task.id === request.itemId);
    const removedTask = workspace.tasks.find(
      task => task.id === request.itemId
    );
    const line = `You confirmed ${requestedBy}'s request: deleted task ${quoted(request.itemTitle, 60)} and removed it from this task's prerequisites.`;
    const remaining = workspace.tasks
      .filter(task => task.id !== request.itemId)
      .map(task =>
        task.dependencies.includes(request.itemId)
          ? {
              ...task,
              dependencies: task.dependencies.filter(
                id => id !== request.itemId
              ),
              updatedAt: stamp,
              history: [...task.history, { at: stamp, text: line }],
            }
          : task
      );
    const tasks = removedTask
      ? releaseSubtasks(remaining, removedTask, { stamp })
      : remaining;
    return {
      workspace: clearNextThingForTask({
        ...workspace,
        tasks,
        focus:
          workspace.focus?.taskId === request.itemId ? null : workspace.focus,
        intention:
          workspace.intention?.taskId === request.itemId
            ? { ...workspace.intention, taskId: null }
            : workspace.intention,
      }, request.itemId),
      summary: `You confirmed deleting task ${quoted(request.itemTitle)} (requested by ${requestedBy})`,
      result: { removed: exists },
      settlePendingDelete: settle,
    };
  }
  const exists = workspace.projects.some(
    project => project.id === request.itemId
  );
  const line = `You confirmed ${requestedBy}'s request: deleted project ${quoted(request.itemTitle, 60)}. This task is kept and no longer linked to it.`;
  return {
    workspace: {
      ...workspace,
      projects: workspace.projects.filter(
        project => project.id !== request.itemId
      ),
      tasks: workspace.tasks.map(task =>
        task.projectId === request.itemId
          ? {
              ...task,
              projectId: null,
              updatedAt: stamp,
              history: [...task.history, { at: stamp, text: line }],
            }
          : task
      ),
    },
    summary: `You confirmed deleting project ${quoted(request.itemTitle)} (requested by ${requestedBy})`,
    result: { removed: exists },
    settlePendingDelete: settle,
  };
}

export function planKeepItem(
  workspace: Workspace,
  request: PendingDeleteRequest,
  now: Date
): ChangePlan<{ kept: true }> {
  const stamp = adelaideTimestamp(now);
  const requestedBy = connectorName(request.requestedBy ?? "claude");
  const line = `You kept this ${request.itemKind === "task" ? "task" : `task's project ${quoted(request.itemTitle, 60)}`} and declined ${requestedBy}'s delete request.`;
  return {
    workspace: {
      ...workspace,
      tasks: workspace.tasks.map(task =>
        (request.itemKind === "task" && task.id === request.itemId) ||
        (request.itemKind === "project" && task.projectId === request.itemId)
          ? { ...task, history: [...task.history, { at: stamp, text: line }] }
          : task
      ),
    },
    summary: `You kept ${request.itemKind} ${quoted(request.itemTitle)} (declined ${requestedBy}'s delete request)`,
    result: { kept: true },
    settlePendingDelete: { id: request.id, status: "kept" },
  };
}

/** Owner-only restore. The current workspace is itself backed up first. */
export function planRestore(
  backup: WorkspaceBackupDocument
): ChangePlan<{ restoredBackupId: number }> {
  return {
    // A restored running timer could fight a device's live focus; restore it paused.
    workspace: {
      ...backup.workspace,
      focus: backup.workspace.focus
        ? { ...backup.workspace.focus, running: false }
        : null,
    },
    summary:
      `Before you restored the backup from ${formatAdelaide(backup.createdAt)} (${backup.reason})`.slice(
        0,
        500
      ),
    result: { restoredBackupId: backup.id },
  };
}

// ---------------------------------------------------------------------------
// Time: planned slot, repeat, reminders (tasks); dates and budget (projects)
// ---------------------------------------------------------------------------

function describeSchedule(s: TaskSchedule): string {
  const parts: string[] = [];
  if (s.flexibleWindow) {
    parts.push(
      `flexible window ${s.flexibleWindow.startDate} through ${s.flexibleWindow.endDate}${s.minutes ? ` · ${s.minutes} min effort` : ""}`
    );
  } else if (s.date) {
    parts.push(
      `planned ${s.date}${s.time ? ` at ${formatTime(s.time)}` : " (any time)"}${s.time && s.minutes ? ` for ${s.minutes} min` : ""}${s.fixed ? ", fixed" : ""}`
    );
  } else parts.push("no planned day");
  if (s.repeat) parts.push(`repeats ${describeRepeat(s.repeat).toLowerCase()}`);
  if (s.deadlineTime) parts.push(`deadline time ${formatTime(s.deadlineTime)}`);
  if (s.reminders.length)
    parts.push(
      `${s.reminders.length} reminder${s.reminders.length === 1 ? "" : "s"}`
    );
  return parts.join(", ");
}

export function planSetTaskTime(
  workspace: Workspace,
  taskId: string,
  schedule: TaskSchedule,
  note: string | undefined,
  now: Date,
  actor: ConnectorActor = "claude"
): ChangePlan<{ task: Task; time: string }> {
  const task = requireTask(workspace, taskId);
  if (sameValue(task.schedule, schedule)) {
    throw new ChangeError(
      "INVALID_CHANGE",
      "Nothing to change: the time, repeat and reminders already match."
    );
  }
  const sameRepeat = sameValue(task.schedule.repeat, schedule.repeat);
  const fallbackDate =
    task.schedule.flexibleWindow?.startDate ??
    task.deadline ??
    task.startDate ??
    null;
  const normalizedSchedule: TaskSchedule = schedule.repeat
    ? {
        ...schedule,
        repeatAnchorDate: sameRepeat
          ? (schedule.repeatAnchorDate ??
            task.schedule.repeatAnchorDate ??
            task.schedule.repeatOccurrenceDate ??
            task.schedule.date ??
            fallbackDate)
          : (schedule.date ?? fallbackDate),
        repeatOccurrenceDate: sameRepeat
          ? (schedule.repeatOccurrenceDate ??
            task.schedule.repeatOccurrenceDate ??
            task.schedule.date ??
            fallbackDate)
          : (schedule.date ?? fallbackDate),
        repeatTime: sameRepeat
          ? schedule.repeatTime !== undefined
            ? schedule.repeatTime
            : task.schedule.repeatTime !== undefined
              ? task.schedule.repeatTime
              : task.schedule.time
          : schedule.time,
      }
    : {
        ...schedule,
        repeatAnchorDate: null,
        repeatOccurrenceDate: null,
        repeatTime: null,
      };
  if (sameValue(task.schedule, normalizedSchedule)) {
    throw new ChangeError(
      "INVALID_CHANGE",
      "Nothing to change: the time, repeat and reminders already match."
    );
  }
  if (
    normalizedSchedule.repeat &&
    !normalizedSchedule.date &&
    !normalizedSchedule.flexibleWindow &&
    normalizedSchedule.repeat.freq !== "after"
  ) {
    throw new ChangeError(
      "INVALID_CHANGE",
      "A repeating task needs a planned date for its first occurrence."
    );
  }
  const stamp = adelaideTimestamp(now);
  const time = describeSchedule(normalizedSchedule);
  const updated: Task = {
    ...task,
    schedule: normalizedSchedule,
    // A repeat rule replaces the older day-count repeat.
    repeatDays: normalizedSchedule.repeat ? null : task.repeatDays,
    updatedAt: stamp,
    history: [
      ...task.history,
      { at: stamp, text: connectorLine(actor, `Set time: ${time}.`, note) },
    ],
  };
  return {
    workspace: {
      ...workspace,
      tasks: workspace.tasks.map(candidate =>
        candidate.id === taskId ? updated : candidate
      ),
    },
    summary: `${connectorName(actor)}: set time for ${quoted(task.title)} (${time})`,
    result: { task: updated, time },
  };
}

/**
 * Select or clear the single Today Next thing. A selected task must be available
 * in the untimed pool and already have a concrete DO action. This planner is
 * applied by the normal backup/revision/CAS path and records task history.
 */
export function planSetNextThing(
  workspace: Workspace,
  taskId: string | null,
  when: string | null | undefined,
  note: string | undefined,
  now: Date,
  actor: ConnectorActor = "claude"
): ChangePlan<{ task: Task | null; nextThing: Workspace["nextThing"] }> {
  const current = workspace.nextThing ?? null;
  const clock = adelaideClock(now);
  const cleanWhen = when?.trim() ?? "";
  if (
    taskId === null &&
    (cleanWhen || (when !== undefined && when !== null))
  ) {
    throw new ChangeError("INVALID_CHANGE", "Clear the task and WHEN together.");
  }

  let selected: Task | null = null;
  if (taskId !== null) {
    selected = requireTask(workspace, taskId);
    if (!cleanWhen || cleanWhen.length > 300)
      throw new ChangeError("INVALID_CHANGE", "WHEN must be 1–300 characters.");
    if (!selected.nextAction.trim())
      throw new ChangeError(
        "INVALID_CHANGE",
        "Set the task's concrete DO action with update_my_life_task.nextAction first."
      );
    if (
      !poolTasks(workspace.tasks, clock.date, clock.minutes).some(
        task => task.id === taskId
      )
    )
      throw new ChangeError(
        "INVALID_CHANGE",
        "That task is not currently available in the untimed pool."
      );
  }
  if (
    taskId === current?.taskId &&
    clock.date === current?.date &&
    cleanWhen === current?.when
  ) {
    throw new ChangeError("INVALID_CHANGE", "That Next thing already matches.");
  }
  if (taskId === null && !current)
    throw new ChangeError("INVALID_CHANGE", "There is no selected Next thing to clear.");

  const stamp = adelaideTimestamp(now);
  const touched = new Set<string>();
  if (current?.taskId) touched.add(current.taskId);
  if (taskId) touched.add(taskId);
  const tasks = workspace.tasks.map(task => {
    if (!touched.has(task.id)) return task;
    const lines: string[] = [];
    if (current?.taskId === task.id && current.taskId !== taskId)
      lines.push("No longer selected as today's Next thing.");
    if (taskId === task.id) {
      lines.push(
        current?.taskId === task.id
          ? `Updated today's WHEN trigger to ${quoted(cleanWhen, 120)}.`
          : `Selected as today's Next thing; WHEN ${quoted(cleanWhen, 120)}.`
      );
    } else if (taskId === null && current?.taskId === task.id) {
      lines.push("Cleared as today's Next thing.");
    }
    return {
      ...task,
      updatedAt: stamp,
      history: [
        ...task.history,
        ...lines.map(text => ({ at: stamp, text: connectorLine(actor, text, note) })),
      ],
    };
  });
  const nextThing = taskId
    ? { taskId, when: cleanWhen, date: clock.date, updatedAt: stamp }
    : null;
  const updatedTask = taskId
    ? tasks.find(task => task.id === taskId) ?? null
    : current?.taskId
      ? tasks.find(task => task.id === current.taskId) ?? null
      : null;
  const action = taskId
    ? `selected ${quoted(selected!.title)} as today's Next thing`
    : "cleared today's Next thing";
  return {
    workspace: { ...workspace, tasks, nextThing },
    summary: `${connectorName(actor)}: ${action}`,
    result: { task: updatedTask, nextThing },
  };
}

/** Change the workspace-level pass-over threshold through the guarded writer. */
export function planUpdatePassOverThreshold(
  workspace: Workspace,
  threshold: number,
  note: string | undefined,
  now: Date,
  actor: ConnectorActor = "claude"
): ChangePlan<{ passOverThreshold: number }> {
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 10) {
    throw new ChangeError(
      "INVALID_CHANGE",
      "Pass-over threshold must be a whole number from 1 to 10."
    );
  }
  const current = {
    ...DEFAULT_PLANNING,
    ...workspace.planning,
  };
  if (current.passOverThreshold === threshold) {
    throw new ChangeError(
      "INVALID_CHANGE",
      "That pass-over threshold already matches."
    );
  }
  const planning = { ...current, passOverThreshold: threshold };
  const stamp = adelaideTimestamp(now);
  const noteSuffix = note?.trim()
    ? `; note ${quoted(note.trim(), 160)}`
    : "";
  return {
    workspace: { ...workspace, planning },
    summary: `${connectorName(actor)}: changed pass-over prompt threshold from ${current.passOverThreshold} to ${threshold} at ${stamp}${noteSuffix}`,
    result: { passOverThreshold: threshold },
  };
}

/** Change only an existing contact's month/day birthday; no birth year is stored. */
export function planSetPersonBirthday(
  workspace: Workspace,
  personId: string,
  birthdayMonthDay: string | null,
  note: string | undefined,
  now: Date,
  actor: ConnectorActor = "claude"
): ChangePlan<{ person: WorkspaceContact }> {
  const people = workspace.people ?? [];
  const person = people.find(item => item.id === personId);
  if (!person) throw new ChangeError("NOT_FOUND", "No person with that id.");
  if (person.birthdayMonthDay === birthdayMonthDay)
    throw new ChangeError("INVALID_CHANGE", "That birthday already matches.");
  const stamp = adelaideTimestamp(now);
  const updated: WorkspaceContact = {
    ...person,
    birthdayMonthDay,
    updatedAt: stamp,
  };
  return {
    workspace: {
      ...workspace,
      people: people.map(item => (item.id === personId ? updated : item)),
    },
    summary: `${connectorName(actor)}: updated birthday month/day for ${quoted(person.name)}${birthdayMonthDay ? ` to ${birthdayMonthDay}` : " (cleared)"}`,
    result: { person: updated },
  };
}

export function planSetProjectTime(
  workspace: Workspace,
  projectId: string,
  schedule: ProjectSchedule,
  note: string | undefined,
  now: Date,
  actor: ConnectorActor = "claude"
): ChangePlan<{ project: Project }> {
  const project = requireProject(workspace, projectId);
  if (sameValue(project.schedule, schedule)) {
    throw new ChangeError(
      "INVALID_CHANGE",
      "Nothing to change: the project dates already match."
    );
  }
  for (const m of schedule.milestoneDates) {
    if (!project.milestones.some(x => x.id === m.id)) {
      throw new ChangeError(
        "NOT_FOUND",
        `No milestone with id ${m.id} in this project.`
      );
    }
  }
  const stamp = adelaideTimestamp(now);
  const parts = [
    `deadline ${schedule.deadline ?? "none"}`,
    `review ${schedule.reviewDate ?? "none"}`,
    `weekly time ${schedule.weeklyBudgetMinutes ? `${schedule.weeklyBudgetMinutes} min` : "none"}`,
    `${schedule.milestoneDates.length} dated milestone${schedule.milestoneDates.length === 1 ? "" : "s"}`,
  ].join(", ");
  const line = connectorLine(
    actor,
    `Set dates for its project ${quoted(project.title, 60)}: ${parts}.`,
    note
  );
  const updated: Project = { ...project, schedule, updatedAt: stamp };
  return {
    workspace: {
      ...workspace,
      projects: workspace.projects.map(candidate =>
        candidate.id === projectId ? updated : candidate
      ),
      tasks: workspace.tasks.map(task =>
        task.projectId === projectId
          ? { ...task, history: [...task.history, { at: stamp, text: line }] }
          : task
      ),
    },
    summary: `${connectorName(actor)}: set dates for project ${quoted(project.title)} (${parts})`,
    result: { project: updated },
  };
}

// ---------------------------------------------------------------------------
// Compass placement (v2.2). Claude may link Imperatives and Notion pages
// directly (reversible, logged). Catch-all and decision outcomes are only ever
// SUGGESTED: they stay unconfirmed until the owner confirms them in Steadier.
// ---------------------------------------------------------------------------

export interface PlacementFields {
  imperativeIds?: string[];
  catchAll?: CatchAll | null;
  decision?: { outcome: DecisionOutcome; note?: string } | null;
  notionUrl?: string | null;
}

export function planSetPlacement(
  workspace: Workspace,
  kind: "task" | "project",
  id: string,
  fields: PlacementFields,
  note: string | undefined,
  now: Date,
  actor: ConnectorActor = "claude"
): ChangePlan<{ task?: Task; project?: Project; changed: string[] }> {
  const stamp = adelaideTimestamp(now);
  const known = new Set(workspace.imperatives.map(i => i.id));
  if (fields.imperativeIds?.some(i => !known.has(i))) {
    throw new ChangeError(
      "NOT_FOUND",
      "One of those Imperatives does not exist. Read list_my_life_imperatives first."
    );
  }
  const titleOf = (i: string) =>
    workspace.imperatives.find(x => x.id === i)?.title ?? i;
  const decision = (value: PlacementFields["decision"]): Decision | null =>
    value
      ? {
          outcome: value.outcome,
          at: stamp,
          by: actor,
          confirmed: false,
          note: (value.note ?? "").slice(0, 1000),
        }
      : null;
  const changed: string[] = [];
  if (fields.imperativeIds !== undefined)
    changed.push(
      fields.imperativeIds.length
        ? `Imperatives → ${fields.imperativeIds.map(i => quoted(titleOf(i), 40)).join(", ")}`
        : "Imperatives cleared"
    );
  if (fields.catchAll !== undefined)
    changed.push(
      fields.catchAll
        ? `suggested ${CATCH_ALL_LABEL[fields.catchAll]}`
        : "catch-all cleared"
    );
  if (fields.decision !== undefined)
    changed.push(
      fields.decision
        ? `suggested decision ${DECISION_LABEL[fields.decision.outcome]}`
        : "decision cleared"
    );
  if (fields.notionUrl !== undefined)
    changed.push(fields.notionUrl ? "Notion link set" : "Notion link cleared");
  if (!changed.length)
    throw new ChangeError("INVALID_CHANGE", "Nothing to change.");

  if (kind === "task") {
    if (fields.notionUrl !== undefined)
      throw new ChangeError(
        "INVALID_CHANGE",
        "Notion links belong on projects and Imperatives, not tasks."
      );
    const task = requireTask(workspace, id);
    const compass = { ...task.compass };
    if (fields.imperativeIds !== undefined) {
      compass.imperativeIds = [...new Set(fields.imperativeIds)];
      // Claude's links are suggestions until the owner confirms them.
      compass.imperativesSuggested = compass.imperativeIds.length > 0;
    }
    if (fields.catchAll !== undefined) {
      compass.catchAll = fields.catchAll;
      compass.catchAllConfirmed = false;
      compass.catchAllSince = fields.catchAll ? stamp : null;
    }
    if (fields.decision !== undefined)
      compass.decision = decision(fields.decision);
    const updated: Task = {
      ...task,
      compass,
      updatedAt: stamp,
      history: [
        ...task.history,
        {
          at: stamp,
          text: connectorLine(actor, `Placement: ${changed.join("; ")}.`, note),
        },
      ],
    };
    return {
      workspace: {
        ...workspace,
        tasks: workspace.tasks.map(t => (t.id === id ? updated : t)),
      },
      summary: `${connectorName(actor)}: placement of task ${quoted(task.title)} (${changed.join("; ")})`,
      result: { task: updated, changed },
    };
  }
  if (fields.catchAll !== undefined)
    throw new ChangeError("INVALID_CHANGE", "Catch-alls apply to tasks only.");
  const project = requireProject(workspace, id);
  let notionUrl = project.compass.notionUrl;
  if (fields.notionUrl !== undefined) {
    notionUrl =
      fields.notionUrl === null ? null : normaliseNotionUrl(fields.notionUrl);
    if (fields.notionUrl !== null && !notionUrl)
      throw new ChangeError(
        "INVALID_CHANGE",
        "Use an https notion.so or notion.site link."
      );
  }
  const updated: Project = {
    ...project,
    compass: {
      ...project.compass,
      imperativeIds:
        fields.imperativeIds !== undefined
          ? [...new Set(fields.imperativeIds)]
          : project.compass.imperativeIds,
      decision:
        fields.decision !== undefined
          ? decision(fields.decision)
          : project.compass.decision,
      notionUrl,
    },
    updatedAt: stamp,
  };
  const line = connectorLine(
    actor,
    `Placement of its project ${quoted(project.title, 60)}: ${changed.join("; ")}.`,
    note
  );
  return {
    workspace: {
      ...workspace,
      projects: workspace.projects.map(p => (p.id === id ? updated : p)),
      tasks: workspace.tasks.map(t =>
        t.projectId === id
          ? { ...t, history: [...t.history, { at: stamp, text: line }] }
          : t
      ),
    },
    summary: `${connectorName(actor)}: placement of project ${quoted(project.title)} (${changed.join("; ")})`,
    result: { project: updated, changed },
  };
}

// ---------------------------------------------------------------------------
// Compass map (v2.4). Claude may only SUGGEST links one level up (goal → goal)
// or from a project to a Goal Outcome. Suggested links stay unconfirmed until
// the owner confirms them on the Compass map. Claude never creates, edits or
// retires Pillars, Value Goals or Goal Outcomes.
// ---------------------------------------------------------------------------
export function planSuggestGoalLink(
  workspace: Workspace,
  childKind: "goal" | "project",
  childId: string,
  parentId: string,
  note: string | undefined,
  now: Date,
  actor: ConnectorActor = "claude"
): ChangePlan<{ changed: string[]; parent: Goal; childTitle: string }> {
  const stamp = adelaideTimestamp(now);
  const goals = workspace.goals ?? [];
  const parent = goals.find(g => g.id === parentId);
  if (!parent)
    throw new ChangeError(
      "NOT_FOUND",
      "That parent does not exist. Read read_my_life_compass_map first."
    );
  if (parent.status !== "active")
    throw new ChangeError("INVALID_CHANGE", "That item is retired.");
  if (childKind === "project") {
    const project = requireProject(workspace, childId);
    if (parent.level !== "outcome")
      throw new ChangeError(
        "INVALID_CHANGE",
        "Projects link to Goal Outcomes only."
      );
    if (parent.projects.some(l => l.id === childId))
      throw new ChangeError(
        "INVALID_CHANGE",
        "That project is already linked to this Goal Outcome."
      );
    const updated = linkProject(workspace, parent.id, childId, stamp, false);
    const line = connectorLine(
      actor,
      `Suggested its project ${quoted(project.title, 60)} serves Goal Outcome ${quoted(parent.title, 60)} (awaiting your confirmation).`,
      note
    );
    const nextParent = updated.goals.find(g => g.id === parent.id)!;
    return {
      workspace: {
        ...updated,
        goals: updated.goals.map(g =>
          g.id === parent.id
            ? {
                ...g,
                history: [
                  ...g.history.slice(0, -1),
                  {
                    at: stamp,
                    text: connectorLine(
                      actor,
                      `Suggested project ${quoted(project.title, 60)}.`,
                      note
                    ),
                  },
                ],
              }
            : g
        ),
        tasks: updated.tasks.map(t =>
          t.projectId === childId
            ? { ...t, history: [...t.history, { at: stamp, text: line }] }
            : t
        ),
      },
      summary: `${connectorName(actor)}: suggested project ${quoted(project.title)} → Goal Outcome ${quoted(parent.title)}`,
      result: {
        changed: ["suggested link"],
        parent: nextParent,
        childTitle: project.title,
      },
    };
  }
  const child = goals.find(g => g.id === childId);
  if (!child)
    throw new ChangeError(
      "NOT_FOUND",
      "That item does not exist. Read read_my_life_compass_map first."
    );
  if (PARENT_LEVEL[child.level] !== parent.level)
    throw new ChangeError(
      "INVALID_CHANGE",
      child.level === "pillar"
        ? "Pillars do not sit under anything."
        : `A ${GOAL_LEVEL_LABEL[child.level]} sits under a ${GOAL_LEVEL_LABEL[PARENT_LEVEL[child.level]!]}.`
    );
  if (child.parents.some(l => l.id === parentId))
    throw new ChangeError("INVALID_CHANGE", "Those two are already linked.");
  const updated = linkParent(workspace, childId, parentId, stamp, false);
  return {
    workspace: {
      ...updated,
      goals: updated.goals.map(g =>
        g.id === childId
          ? {
              ...g,
              history: [
                ...g.history.slice(0, -1),
                {
                  at: stamp,
                  text: connectorLine(
                    actor,
                    `Suggested it sits under ${quoted(parent.title, 60)}.`,
                    note
                  ),
                },
              ],
            }
          : g
      ),
    },
    summary: `${connectorName(actor)}: suggested ${GOAL_LEVEL_LABEL[child.level]} ${quoted(child.title)} sits under ${quoted(parent.title)}`,
    result: { changed: ["suggested link"], parent, childTitle: child.title },
  };
}

/**
 * Add a subtask under an existing task. It is always marked "suggested":
 * the owner confirms it in the app (it still shows straight away).
 */
export function planAddSubtask(
  workspace: Workspace,
  parentTaskId: string,
  fields: { title: string; nextAction?: string; notes?: string },
  note: string | undefined,
  now: Date,
  actor: ConnectorActor = "claude"
): ChangePlan<{ task: Task }> {
  const parent = requireTask(workspace, parentTaskId);
  const stamp = adelaideTimestamp(now);
  const added = addSubtask(workspace.tasks, parent.id, fields.title, {
    suggested: true,
    stamp,
    fields: {
      ...(fields.nextAction !== undefined
        ? { nextAction: fields.nextAction }
        : {}),
      ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
    },
  });
  if (added.error || !added.task)
    throw new ChangeError("INVALID_CHANGE", added.error ?? "Could not add it.");
  const task: Task = {
    ...added.task,
    history: [
      {
        at: stamp,
        text: connectorLine(
          actor,
          `Suggested this as a subtask of ${quoted(parent.title, 60)}.`,
          note
        ),
      },
    ],
  };
  return {
    workspace: {
      ...workspace,
      tasks: added.tasks.map(t => (t.id === task.id ? task : t)),
    },
    summary: `${connectorName(actor)}: suggested subtask ${quoted(task.title)} under ${quoted(parent.title)}`,
    result: { task },
  };
}

/**
 * Suggest moving a task under a parent. A connector may also undo its own
 * suggested link (parentTaskId null), but cannot remove a link the owner
 * has confirmed.
 */
export function planSetTaskParent(
  workspace: Workspace,
  taskId: string,
  parentTaskId: string | null,
  note: string | undefined,
  now: Date,
  actor: ConnectorActor = "claude"
): ChangePlan<{ task: Task }> {
  const task = requireTask(workspace, taskId);
  const stamp = adelaideTimestamp(now);
  if (parentTaskId === null) {
    if (!task.parent)
      throw new ChangeError(
        "INVALID_CHANGE",
        "Nothing to change: it is already a top-level task."
      );
    if (!task.parent.suggested)
      throw new ChangeError(
        "INVALID_CHANGE",
        "The owner confirmed this subtask link. Ask them to move it in the app."
      );
  } else {
    requireTask(workspace, parentTaskId);
    if (task.parent?.id === parentTaskId)
      throw new ChangeError(
        "INVALID_CHANGE",
        "Nothing to change: it already sits under that task."
      );
  }
  if (task.parent && !task.parent.suggested && parentTaskId !== null)
    throw new ChangeError(
      "INVALID_CHANGE",
      "The owner confirmed this subtask link. Ask them to move it in the app."
    );
  const change = setTaskParent(workspace.tasks, taskId, parentTaskId, {
    suggested: true,
    stamp,
  });
  if (change.error) throw new ChangeError("INVALID_CHANGE", change.error);
  const parentTitle = parentTaskId
    ? workspace.tasks.find(t => t.id === parentTaskId)!.title
    : null;
  const text = parentTitle
    ? `Suggested this as a subtask of ${quoted(parentTitle, 60)}.`
    : "Withdrew its suggested parent; it is a top-level task again.";
  const tasks = change.tasks.map(t =>
    t.id === taskId
      ? {
          ...t,
          history: [
            ...t.history.slice(0, -1),
            { at: stamp, text: connectorLine(actor, text, note) },
          ],
        }
      : t
  );
  const updated = tasks.find(t => t.id === taskId)!;
  return {
    workspace: { ...workspace, tasks },
    summary: parentTitle
      ? `${connectorName(actor)}: suggested ${quoted(task.title)} as a subtask of ${quoted(parentTitle)}`
      : `${connectorName(actor)}: moved ${quoted(task.title)} back to the top level`,
    result: { task: updated },
  };
}
