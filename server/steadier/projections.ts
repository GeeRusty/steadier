import type { CloudRecord } from "../../shared/cloud";
import type { Project, Task, Workspace } from "../../client/src/domain/types";
import {
  STEADIER_TIME_ZONE,
  adelaideTimestamp,
  toAdelaideIso,
} from "../../shared/time";

/**
 * Claude-facing copies show every instant in Adelaide time with its offset
 * (same instant, still ISO-8601). The stored document is never altered.
 */
export function presentTask(task: Task): Task {
  return {
    ...task,
    createdAt: toAdelaideIso(task.createdAt),
    updatedAt: toAdelaideIso(task.updatedAt),
    completedAt: toAdelaideIso(task.completedAt),
    history: task.history.map(entry => ({
      ...entry,
      at: toAdelaideIso(entry.at),
    })),
  };
}

export function presentProject(project: Project): Project {
  return {
    ...project,
    createdAt: toAdelaideIso(project.createdAt),
    updatedAt: toAdelaideIso(project.updatedAt),
    progress: project.progress.map(entry => ({
      ...entry,
      at: toAdelaideIso(entry.at),
    })),
  };
}

export function presentWorkspace(workspace: Workspace): Workspace {
  const connectorSafeWorkspace = { ...workspace };
  delete connectorSafeWorkspace.evidence;
  delete connectorSafeWorkspace.siteCards;
  delete connectorSafeWorkspace.shoppingLists;
  delete connectorSafeWorkspace.assets;
  delete connectorSafeWorkspace.people;
  delete connectorSafeWorkspace.credentialRenewals;
  delete connectorSafeWorkspace.invoiceSettings;
  delete connectorSafeWorkspace.invoices;
  return {
    ...connectorSafeWorkspace,
    tasks: workspace.tasks.map(presentTask),
    projects: workspace.projects.map(presentProject),
  };
}

export type DerivedTaskAvailability = {
  taskId: string;
  derivedState:
    | "ready"
    | "inbox"
    | "waiting"
    | "blocked"
    | "someday"
    | "done"
    | "scheduled"
    | "deferred";
  available: boolean;
  blockers: string[];
  daysUntilDeadline: number | null;
  daysUntilReview: number | null;
  daysUntilPreparation: number | null;
};

function localDateInTimeZone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function calendarDayDifference(
  date: string | null,
  planningDate: string
): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [planningYear, planningMonth, planningDay] = planningDate
    .split("-")
    .map(Number);
  const target = Date.UTC(year, month - 1, day);
  const planning = Date.UTC(planningYear, planningMonth - 1, planningDay);
  return Math.round((target - planning) / 86_400_000);
}

function derivedTaskState(
  task: Task,
  tasksById: Map<string, Task>,
  planningDate: string
) {
  if (task.state === "done" || task.state === "someday") return task.state;
  const missingDependencies = task.dependencies.filter(dependency => {
    const predecessor = tasksById.get(dependency);
    return !predecessor || predecessor.state !== "done";
  });
  if (missingDependencies.length > 0) return "blocked" as const;
  if ((calendarDayDifference(task.deferredUntil, planningDate) ?? 0) > 0) {
    return "deferred" as const;
  }
  if ((calendarDayDifference(task.startDate, planningDate) ?? 0) > 0) {
    return "scheduled" as const;
  }
  if (task.state === "waiting") return "waiting" as const;
  if (task.state === "blocked" && task.waitingFor.trim())
    return "blocked" as const;
  if (task.state === "blocked")
    return task.nextAction.trim() ? "ready" : "inbox";
  return task.state;
}

export function deriveWorkspaceAvailability(
  workspace: Workspace,
  timeZone: string,
  now = new Date()
): {
  planningDate: string;
  tasks: DerivedTaskAvailability[];
  summary: Record<string, number>;
  attention: {
    commitmentTaskIds: string[];
    reviewDueTaskIds: string[];
    preparationDueTaskIds: string[];
    actionableTaskIds: string[];
  };
} {
  // The planning calendar is always Adelaide's; a UTC server or device never moves it.
  void timeZone;
  const planningDate = localDateInTimeZone(STEADIER_TIME_ZONE, now);
  const tasksById = new Map(workspace.tasks.map(task => [task.id, task]));
  const summary: Record<string, number> = {};
  const rows = workspace.tasks.map(task => {
    const derivedState = derivedTaskState(task, tasksById, planningDate);
    summary[derivedState] = (summary[derivedState] ?? 0) + 1;
    const blockers = task.dependencies.filter(dependency => {
      const predecessor = tasksById.get(dependency);
      return !predecessor || predecessor.state !== "done";
    });
    if (task.waitingFor.trim() && derivedState === "blocked") {
      blockers.push(`waiting:${task.waitingFor.trim()}`);
    }
    const daysUntilDeadline = calendarDayDifference(
      task.deadline,
      planningDate
    );
    const daysUntilReview = calendarDayDifference(
      task.reviewDate,
      planningDate
    );
    const daysUntilPreparation = calendarDayDifference(
      task.preparationDate,
      planningDate
    );
    return {
      taskId: task.id,
      derivedState,
      available: derivedState === "ready" || derivedState === "inbox",
      blockers,
      daysUntilDeadline,
      daysUntilReview,
      daysUntilPreparation,
    } satisfies DerivedTaskAvailability;
  });

  return {
    planningDate,
    tasks: rows,
    summary,
    // These deliberate complete inventories are not limited to an attention-five shortlist.
    attention: {
      commitmentTaskIds: workspace.tasks
        .filter(task => task.state !== "done")
        .filter(
          task => (calendarDayDifference(task.deadline, planningDate) ?? 4) <= 3
        )
        .map(task => task.id),
      reviewDueTaskIds: workspace.tasks
        .filter(task => task.state !== "done")
        .filter(
          task =>
            (calendarDayDifference(task.reviewDate, planningDate) ?? 1) <= 0
        )
        .map(task => task.id),
      preparationDueTaskIds: workspace.tasks
        .filter(task => task.state !== "done")
        .filter(
          task =>
            (calendarDayDifference(task.preparationDate, planningDate) ?? 1) <=
            0
        )
        .map(task => task.id),
      actionableTaskIds: rows
        .filter(row => row.available)
        .map(row => row.taskId),
    },
  };
}

export function compassContext(record: CloudRecord, now = new Date()) {
  const derived = deriveWorkspaceAvailability(
    record.workspace,
    STEADIER_TIME_ZONE,
    now
  );
  return {
    schemaVersion: "steadier-compass-context-v1",
    workspace: presentWorkspace(record.workspace),
    derived,
    freshness: {
      generatedAt: adelaideTimestamp(now),
      serverUpdatedAt: toAdelaideIso(record.updatedAt),
      revision: record.revision,
      timeZone: STEADIER_TIME_ZONE,
      warning:
        "Offline or unsynced edits are not included in this server snapshot.",
    },
  };
}

function spreadsheetSafe(value: unknown): string {
  const text = value == null ? "" : String(value);
  // Spreadsheet applications may trim leading whitespace before evaluating formulas.
  return /^[\t\r\n ]*[=+\-@']/.test(text) ? `'${text}` : text;
}

function csvCell(value: unknown): string {
  const safe = spreadsheetSafe(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const SHEET_COLUMNS = [
  "row_type",
  "task_id",
  "project_id",
  "project_title",
  "project_status",
  "title",
  "stored_state",
  "derived_state",
  "available",
  "next_action",
  "notes",
  "purpose",
  "role",
  "pattern",
  "label_source",
  "deadline",
  "start_date",
  "review_date",
  "deferred_until",
  "preparation_date",
  "preparation_source",
  "estimate_minutes",
  "context",
  "waiting_for",
  "dependencies_json",
  "checklist_json",
  "progress_evidence",
  "task_created_at",
  "task_updated_at",
  "completed_at",
  "task_history_json",
  "project_purpose",
  "project_outcome",
  "project_role",
  "project_pattern",
  "project_milestones_json",
  "project_progress_json",
  "project_created_at",
  "project_updated_at",
  "intention_date",
  "intention_text",
  "intention_task_id",
  "focus_task_id",
  "focus_running",
  "focus_remaining_seconds",
  "matrix_direction_timely",
  "matrix_direction_sustained",
  "matrix_support_timely",
  "matrix_support_sustained",
  "workspace_revision",
  "server_updated_at",
  "time_zone",
  "planning_date",
  "parent_task_id",
  "parent_suggested",
] as const;

type SheetRow = Record<(typeof SHEET_COLUMNS)[number], unknown>;

function blankRow(): SheetRow {
  return Object.fromEntries(
    SHEET_COLUMNS.map(column => [column, ""])
  ) as SheetRow;
}

function workspaceColumns(
  row: SheetRow,
  record: CloudRecord,
  planningDate: string
): SheetRow {
  const { workspace } = record;
  row.intention_date = workspace.intention?.date ?? "";
  row.intention_text = workspace.intention?.text ?? "";
  row.intention_task_id = workspace.intention?.taskId ?? "";
  row.focus_task_id = workspace.focus?.taskId ?? "";
  row.focus_running = workspace.focus?.running ?? "";
  row.focus_remaining_seconds = workspace.focus?.remaining ?? "";
  row.matrix_direction_timely = workspace.matrixWeights["direction-timely"];
  row.matrix_direction_sustained =
    workspace.matrixWeights["direction-sustained"];
  row.matrix_support_timely = workspace.matrixWeights["support-timely"];
  row.matrix_support_sustained = workspace.matrixWeights["support-sustained"];
  row.workspace_revision = record.revision;
  row.server_updated_at = toAdelaideIso(record.updatedAt) ?? "";
  row.time_zone = STEADIER_TIME_ZONE;
  row.planning_date = planningDate;
  return row;
}

/** Complete flattened inventory: every task plus standalone project rows. */
export function workspaceSheetCsv(
  stored: CloudRecord,
  now = new Date()
): string {
  const record: CloudRecord = {
    ...stored,
    workspace: presentWorkspace(stored.workspace),
  };
  const derived = deriveWorkspaceAvailability(
    record.workspace,
    STEADIER_TIME_ZONE,
    now
  );
  const availabilityById = new Map(derived.tasks.map(row => [row.taskId, row]));
  const projectsById = new Map(
    record.workspace.projects.map(project => [project.id, project])
  );
  const rows: SheetRow[] = [];

  for (const task of record.workspace.tasks) {
    const project = task.projectId
      ? projectsById.get(task.projectId)
      : undefined;
    const availability = availabilityById.get(task.id);
    const row = workspaceColumns(blankRow(), record, derived.planningDate);
    row.row_type = "task";
    row.task_id = task.id;
    row.project_id = task.projectId ?? "";
    row.project_title = project?.title ?? "";
    row.parent_task_id = task.parent?.id ?? "";
    row.parent_suggested = task.parent ? task.parent.suggested : "";
    row.project_status = project?.status ?? "";
    row.title = task.title;
    row.stored_state = task.state;
    row.derived_state = availability?.derivedState ?? "";
    row.available = availability?.available ?? false;
    row.next_action = task.nextAction;
    row.notes = task.notes;
    row.purpose = task.purpose;
    row.role = task.role ?? "";
    row.pattern = task.pattern ?? "";
    row.label_source = task.labelSource;
    row.deadline = task.deadline ?? "";
    row.start_date = task.startDate ?? "";
    row.review_date = task.reviewDate ?? "";
    // Preparation date and its provenance intentionally remain separate from real deadlines.
    row.deferred_until = task.deferredUntil ?? "";
    row.preparation_date = task.preparationDate ?? "";
    row.preparation_source = task.preparationSource;
    row.estimate_minutes = task.estimate;
    row.context = task.context;
    row.waiting_for = task.waitingFor;
    row.dependencies_json = JSON.stringify(task.dependencies);
    row.checklist_json = JSON.stringify(task.checklist);
    row.progress_evidence = task.progressEvidence;
    row.task_created_at = task.createdAt;
    row.task_updated_at = task.updatedAt;
    row.completed_at = task.completedAt ?? "";
    row.task_history_json = JSON.stringify(task.history);
    row.project_purpose = project?.purpose ?? "";
    row.project_outcome = project?.outcome ?? "";
    row.project_role = project?.role ?? "";
    row.project_pattern = project?.pattern ?? "";
    row.project_milestones_json = project
      ? JSON.stringify(project.milestones)
      : "";
    row.project_progress_json = project ? JSON.stringify(project.progress) : "";
    row.project_created_at = project?.createdAt ?? "";
    row.project_updated_at = project?.updatedAt ?? "";
    rows.push(row);
  }

  const taskProjectIds = new Set(
    record.workspace.tasks.flatMap(task =>
      task.projectId ? [task.projectId] : []
    )
  );
  for (const project of record.workspace.projects) {
    if (taskProjectIds.has(project.id)) continue;
    const row = workspaceColumns(blankRow(), record, derived.planningDate);
    row.row_type = "project";
    row.project_id = project.id;
    row.project_title = project.title;
    row.project_status = project.status;
    row.title = project.title;
    row.purpose = project.purpose;
    row.project_purpose = project.purpose;
    row.project_outcome = project.outcome;
    row.project_role = project.role;
    row.project_pattern = project.pattern;
    row.project_milestones_json = JSON.stringify(project.milestones);
    row.project_progress_json = JSON.stringify(project.progress);
    row.project_created_at = project.createdAt;
    row.project_updated_at = project.updatedAt;
    rows.push(row);
  }

  return `\uFEFF${[SHEET_COLUMNS.join(","), ...rows.map(row => SHEET_COLUMNS.map(column => csvCell(row[column])).join(","))].join("\r\n")}\r\n`;
}
