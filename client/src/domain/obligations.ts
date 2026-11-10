import { adelaideDate, adelaideTimestamp } from "../../../shared/time";
import { createTask } from "./engine";
import { emptyTaskCompass } from "./compass";
import { isDate, nextOccurrence, emptyTaskSchedule, shiftDays } from "./time";
import type { Imperative } from "./compass";
import type {
  Obligation,
  ObligationCadence,
  ObligationKind,
  ObligationLink,
  ObligationStatus,
  Task,
  TaskObligationOrigin,
  Workspace,
} from "./types";
import type { Goal } from "./goals";
import type { RepeatRule } from "./time";

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const KINDS: readonly ObligationKind[] = [
  "bill",
  "renewal",
  "licence",
  "insurance",
  "tax",
];
const STATUSES: readonly ObligationStatus[] = ["draft", "active", "paid"];
const CADENCES: readonly ObligationCadence[] = [
  "none",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
];
const OBLIGATION_KEYS = [
  "id",
  "title",
  "kind",
  "dueDate",
  "leadTimeDays",
  "cadence",
  "cadenceAnchorDate",
  "link",
  "status",
  "amountDue",
  "nextAction",
  "referenceUrl",
  "lastPaidOn",
  "lastPaidDueDate",
  "preparationTaskId",
  "createdAt",
  "updatedAt",
] as const;

function fail(message: string): never {
  throw new Error(`Could not import tasks: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some(key => !keys.includes(key))
  ) {
    fail(`${label} has unknown or missing fields.`);
  }
}

function validId(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID.test(value)) {
    fail(`${label} is not a valid ID.`);
  }
  return value;
}

function dateValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !isDate(value)) {
    fail(`${label} must be a valid YYYY-MM-DD Adelaide calendar date.`);
  }
  return value;
}

function textValue(
  value: unknown,
  label: string,
  max: number,
  nonEmpty = false
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (nonEmpty && !value.trim())
  ) {
    fail(
      `${label} must be text${nonEmpty ? " and cannot be empty" : ""} up to ${max} characters.`
    );
  }
  return value;
}

function nullableDate(value: unknown, label: string): string | null {
  return value === null ? null : dateValue(value, label);
}

function nullableUrl(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 2000) {
    fail(`${label} must be an https URL or null.`);
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      fail(`${label} must be an https URL without credentials.`);
    }
    return parsed.toString();
  } catch {
    fail(`${label} must be a valid https URL.`);
  }
}

export function obligationLinkField(
  value: unknown,
  label = "obligation link"
): ObligationLink {
  if (!isRecord(value)) fail(`${label} must be an object.`);
  exactKeys(value, ["kind", "id"], label);
  if (value.kind !== "pillar" && value.kind !== "imperative") {
    fail(`${label} kind must be pillar or imperative.`);
  }
  return {
    kind: value.kind,
    id: validId(value.id, `${label} ID`),
  };
}

function linkIsValid(
  link: ObligationLink,
  goals: Goal[],
  imperatives: Imperative[]
): boolean {
  if (link.kind === "pillar") {
    return goals.some(goal => goal.id === link.id && goal.level === "pillar");
  }
  return imperatives.some(imperative => imperative.id === link.id);
}

export function obligationsField(
  value: unknown,
  goals: Goal[],
  imperatives: Imperative[]
): Obligation[] {
  if (!Array.isArray(value) || value.length > 1000) {
    fail("obligations must be a list of at most 1000 records.");
  }
  const records = value.map((raw, index): Obligation => {
    const label = `obligation ${index + 1}`;
    if (!isRecord(raw)) fail(`${label} is not an object.`);
    exactKeys(raw, OBLIGATION_KEYS, label);
    if (
      typeof raw.kind !== "string" ||
      !KINDS.includes(raw.kind as ObligationKind)
    ) {
      fail(`${label} has an unsupported type.`);
    }
    if (
      typeof raw.cadence !== "string" ||
      !CADENCES.includes(raw.cadence as ObligationCadence)
    ) {
      fail(`${label} has an unsupported cadence.`);
    }
    if (
      typeof raw.status !== "string" ||
      !STATUSES.includes(raw.status as ObligationStatus)
    ) {
      fail(`${label} has an unsupported status.`);
    }
    if (
      typeof raw.leadTimeDays !== "number" ||
      !Number.isInteger(raw.leadTimeDays) ||
      raw.leadTimeDays < 0 ||
      raw.leadTimeDays > 365
    ) {
      fail(`${label} lead time must be a whole number from 0 to 365 days.`);
    }
    const link =
      raw.link === null ? null : obligationLinkField(raw.link, `${label} link`);
    const cadenceAnchorDate = nullableDate(
      raw.cadenceAnchorDate,
      `${label} cadence anchor`
    );
    const status = raw.status as ObligationStatus;
    const nextAction = textValue(raw.nextAction, `${label} next action`, 2000);
    const preparationTaskId =
      raw.preparationTaskId === null
        ? null
        : validId(raw.preparationTaskId, `${label} preparation task ID`);
    const lastPaidOn = nullableDate(raw.lastPaidOn, `${label} last paid on`);
    const lastPaidDueDate = nullableDate(
      raw.lastPaidDueDate,
      `${label} last paid occurrence`
    );
    if ((lastPaidOn === null) !== (lastPaidDueDate === null)) {
      fail(`${label} paid dates must both be present or both be null.`);
    }
    if (status === "active") {
      if (!link)
        fail(`${label} cannot be active without a Pillar or Imperative link.`);
      if (!linkIsValid(link, goals, imperatives)) {
        fail(`${label} must link to an existing Pillar or Imperative.`);
      }
      if (!nextAction.trim())
        fail(`${label} needs a next action before activation.`);
      if (!preparationTaskId) {
        fail(`${label} needs a preparation task ID while active.`);
      }
    }
    if (status === "paid" && (!lastPaidOn || !lastPaidDueDate)) {
      fail(
        `${label} marked paid must record the paid date and due occurrence.`
      );
    }
    const createdAt = textValue(raw.createdAt, `${label} createdAt`, 100, true);
    const updatedAt = textValue(raw.updatedAt, `${label} updatedAt`, 100, true);
    if (
      Number.isNaN(Date.parse(createdAt)) ||
      Number.isNaN(Date.parse(updatedAt))
    ) {
      fail(`${label} timestamps must be valid dates.`);
    }
    return {
      id: validId(raw.id, `${label} ID`),
      title: textValue(raw.title, `${label} name`, 300, true),
      kind: raw.kind as ObligationKind,
      dueDate: dateValue(raw.dueDate, `${label} due date`),
      leadTimeDays: raw.leadTimeDays,
      cadence: raw.cadence as ObligationCadence,
      cadenceAnchorDate,
      link,
      status,
      amountDue:
        raw.amountDue === null
          ? null
          : textValue(raw.amountDue, `${label} amount note`, 100),
      nextAction,
      referenceUrl: nullableUrl(raw.referenceUrl, `${label} reference`),
      lastPaidOn,
      lastPaidDueDate,
      preparationTaskId,
      createdAt,
      updatedAt,
    };
  });
  const ids = new Set<string>();
  const taskIds = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id))
      fail(`obligation ID ${record.id} appears more than once.`);
    ids.add(record.id);
    if (record.status === "active" && record.preparationTaskId) {
      if (taskIds.has(record.preparationTaskId)) {
        fail("active obligations cannot share a preparation task.");
      }
      taskIds.add(record.preparationTaskId);
    }
  }
  return records;
}

export function taskObligationField(
  value: unknown,
  label = "task obligation source"
): TaskObligationOrigin {
  if (!isRecord(value)) fail(`${label} must be an object.`);
  exactKeys(
    value,
    ["obligationId", "occurrenceDueDate", "link", "active"],
    label
  );
  if (typeof value.active !== "boolean")
    fail(`${label} active must be true or false.`);
  return {
    obligationId: validId(value.obligationId, `${label} obligation ID`),
    occurrenceDueDate: dateValue(value.occurrenceDueDate, `${label} due date`),
    link: obligationLinkField(value.link, `${label} link`),
    active: value.active,
  };
}

function newId(prefix: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`;
}

export function newObligationDraft(
  day = adelaideDate(),
  stamp = adelaideTimestamp(),
  id = newId("obligation")
): Obligation {
  return {
    id,
    title: "",
    kind: "bill",
    dueDate: day,
    leadTimeDays: 7,
    cadence: "none",
    cadenceAnchorDate: day,
    link: null,
    status: "draft",
    amountDue: null,
    nextAction: "",
    referenceUrl: null,
    lastPaidOn: null,
    lastPaidDueDate: null,
    preparationTaskId: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

export function preparationDateFor(
  obligation: Pick<Obligation, "dueDate" | "leadTimeDays">
): string {
  return shiftDays(obligation.dueDate, -obligation.leadTimeDays);
}

function cadenceRule(obligation: Obligation): RepeatRule | null {
  if (obligation.cadence === "none") return null;
  const weekly = obligation.cadence === "weekly";
  const monthly =
    obligation.cadence === "monthly" || obligation.cadence === "quarterly";
  const anchor = obligation.cadenceAnchorDate ?? obligation.dueDate;
  return {
    freq: weekly ? "weekly" : monthly ? "monthly" : "yearly",
    interval: obligation.cadence === "quarterly" ? 3 : 1,
    weekdays: [],
    monthDay: monthly ? Number(anchor.slice(8, 10)) : null,
    nthWeekday: null,
    until: null,
    count: null,
  };
}

export function nextObligationDueDate(obligation: Obligation): string | null {
  const rule = cadenceRule(obligation);
  const anchor = obligation.cadenceAnchorDate ?? obligation.dueDate;
  return rule ? nextOccurrence(rule, obligation.dueDate, anchor) : null;
}

function generatedTitle(title: string): string {
  return `Prepare: ${title}`;
}

function pushTaskHistory(task: Task, stamp: string, text: string): Task {
  return {
    ...task,
    updatedAt: stamp,
    history: [...task.history, { at: stamp, text }].slice(-1000),
  };
}

function holdPreparationTask(
  tasks: Task[],
  taskId: string | null,
  stamp: string,
  reason: string
): Task[] {
  if (!taskId) return tasks;
  return tasks.map(task => {
    if (task.id !== taskId || !task.obligation) return task;
    const alreadyHeld = !task.obligation.active;
    if (alreadyHeld) return task;
    const held = task.state === "done";
    return pushTaskHistory(
      {
        ...task,
        ...(held
          ? {}
          : {
              state: "someday" as const,
              deadline: null,
              startDate: null,
              reviewDate: null,
              deferredUntil: null,
              schedule: {
                ...task.schedule,
                date: null,
                time: null,
                repeat: null,
                seriesId: null,
              },
            }),
        obligation: { ...task.obligation, active: false },
      },
      stamp,
      held
        ? `${reason}; preparation task was already complete.`
        : `${reason}; open preparation task kept in Held rather than deleted.`
    );
  });
}

function reconcilePreparationTask(
  tasks: Task[],
  obligation: Obligation,
  previous: Obligation | undefined,
  stamp: string,
  nextTaskId: () => string
): { tasks: Task[]; preparationTaskId: string } {
  if (!obligation.link)
    throw new Error("Choose a Pillar or Imperative before activation.");
  const preparationTaskId = obligation.preparationTaskId ?? nextTaskId();
  const targetDate = preparationDateFor(obligation);
  const prior = previous;
  const existing = tasks.find(task => task.id === preparationTaskId);
  if (!existing) {
    const schedule = { ...emptyTaskSchedule(), date: targetDate };
    const task = createTask(
      {
        id: preparationTaskId,
        title: generatedTitle(obligation.title),
        area: "Personal",
        nextAction: obligation.nextAction.trim(),
        state: "ready",
        deadline: targetDate,
        startDate: targetDate,
        reviewDate: targetDate,
        estimate: 15,
        purpose: "Prepare for an active obligation before its due date.",
        preparationDate: null,
        preparationSource: "confirmed",
        repeatDays: null,
        schedule,
        compass: emptyTaskCompass(),
        obligation: {
          obligationId: obligation.id,
          occurrenceDueDate: obligation.dueDate,
          link: obligation.link,
          active: true,
        },
      },
      targetDate
    );
    task.createdAt = stamp;
    task.updatedAt = stamp;
    task.obligation = {
      obligationId: obligation.id,
      occurrenceDueDate: obligation.dueDate,
      link: obligation.link,
      active: true,
    };
    task.history = [
      { at: stamp, text: `Preparation task for ${obligation.title}.` },
    ];
    return { tasks: [...tasks, task], preparationTaskId };
  }

  const wasHeld = existing.obligation?.active === false;
  const oldGeneratedTitle = prior
    ? generatedTitle(prior.title)
    : generatedTitle(obligation.title);
  const nextTitle =
    existing.title === oldGeneratedTitle
      ? generatedTitle(obligation.title)
      : existing.title;
  const nextAction =
    prior && existing.nextAction === prior.nextAction
      ? obligation.nextAction.trim()
      : existing.nextAction;
  const nextState =
    wasHeld && existing.state === "someday"
      ? nextAction.trim()
        ? "ready"
        : "inbox"
      : existing.state;
  const nextSchedule = {
    ...existing.schedule,
    date: targetDate,
    repeat: null,
    seriesId: null,
  };
  const origin: TaskObligationOrigin = {
    obligationId: obligation.id,
    occurrenceDueDate: obligation.dueDate,
    link: obligation.link,
    active: true,
  };
  const changed =
    existing.title !== nextTitle ||
    existing.nextAction !== nextAction ||
    existing.deadline !== targetDate ||
    existing.startDate !== targetDate ||
    existing.reviewDate !== targetDate ||
    existing.schedule.date !== targetDate ||
    existing.schedule.repeat !== null ||
    existing.schedule.seriesId !== null ||
    existing.state !== nextState ||
    JSON.stringify(existing.obligation) !== JSON.stringify(origin);
  if (!changed) return { tasks, preparationTaskId };
  const updated: Task = {
    ...existing,
    title: nextTitle,
    nextAction,
    deadline: targetDate,
    startDate: targetDate,
    reviewDate: targetDate,
    state: nextState,
    repeatDays: null,
    schedule: nextSchedule,
    obligation: origin,
  };
  const text =
    existing.obligation?.active === false
      ? `Reactivated preparation for ${obligation.title}.`
      : `Updated preparation target for ${obligation.title} to ${targetDate}.`;
  return {
    tasks: tasks.map(task =>
      task.id === preparationTaskId
        ? pushTaskHistory(updated, stamp, text)
        : task
    ),
    preparationTaskId,
  };
}

export function saveObligation(
  workspace: Workspace,
  input: Obligation,
  status: "draft" | "active",
  stamp = adelaideTimestamp(),
  nextTaskId: () => string = () => newId("obligation-task")
): Workspace {
  const obligations = workspace.obligations ?? [];
  const previous = obligations.find(item => item.id === input.id);
  if (previous?.status === "paid")
    throw new Error(
      "A paid obligation is kept as history; add a new record for another obligation."
    );
  const title = input.title.trim().slice(0, 300);
  if (!title) throw new Error("Enter an obligation name.");
  const candidate: Obligation = {
    ...input,
    title,
    status,
    nextAction: input.nextAction.trim().slice(0, 2000),
    amountDue: input.amountDue?.trim().slice(0, 100) || null,
    referenceUrl: input.referenceUrl?.trim()
      ? nullableUrl(input.referenceUrl.trim(), "reference")
      : null,
    createdAt: previous?.createdAt ?? input.createdAt,
    updatedAt: stamp,
  };
  if (status === "active") {
    if (!candidate.link)
      throw new Error("Choose a Pillar or Imperative before activation.");
    const valid = linkIsValid(
      candidate.link,
      workspace.goals ?? [],
      workspace.imperatives ?? []
    );
    if (!valid) throw new Error("Choose an existing Pillar or Imperative.");
    if (!candidate.nextAction)
      throw new Error("Add the next action before activation.");
    candidate.preparationTaskId =
      previous?.preparationTaskId ?? candidate.preparationTaskId;
  }
  let tasks = workspace.tasks;
  if (previous?.status === "active" && status === "draft") {
    tasks = holdPreparationTask(
      tasks,
      previous.preparationTaskId,
      stamp,
      "Obligation moved back to draft"
    );
    candidate.preparationTaskId = previous.preparationTaskId;
  }
  if (status === "active") {
    const reconciled = reconcilePreparationTask(
      tasks,
      candidate,
      previous,
      stamp,
      nextTaskId
    );
    tasks = reconciled.tasks;
    candidate.preparationTaskId = reconciled.preparationTaskId;
  }
  const nextObligations = previous
    ? obligations.map(item => (item.id === candidate.id ? candidate : item))
    : [...obligations, candidate];
  return { ...workspace, tasks, obligations: nextObligations };
}

export function markObligationPaid(
  workspace: Workspace,
  id: string,
  expectedDueDate: string,
  paidOn = adelaideDate(),
  stamp = adelaideTimestamp(),
  nextTaskId: () => string = () => newId("obligation-task")
): Workspace {
  const obligations = workspace.obligations ?? [];
  const current = obligations.find(item => item.id === id);
  if (
    !current ||
    current.status !== "active" ||
    current.dueDate !== expectedDueDate
  ) {
    return workspace;
  }
  const nextDate = nextObligationDueDate(current);
  const paidRecord: Obligation = {
    ...current,
    dueDate: nextDate ?? current.dueDate,
    status: nextDate ? "active" : "paid",
    lastPaidOn: paidOn,
    lastPaidDueDate: current.dueDate,
    preparationTaskId: nextDate ? nextTaskId() : current.preparationTaskId,
    updatedAt: stamp,
  };
  const tasks = holdPreparationTask(
    workspace.tasks,
    current.preparationTaskId,
    stamp,
    "Obligation occurrence marked paid"
  );
  const updatedWorkspace = {
    ...workspace,
    tasks,
    obligations: obligations.map(item => (item.id === id ? paidRecord : item)),
  };
  if (!nextDate) return updatedWorkspace;
  const reconciled = reconcilePreparationTask(
    tasks,
    paidRecord,
    current,
    stamp,
    nextTaskId
  );
  return {
    ...updatedWorkspace,
    tasks: reconciled.tasks,
    obligations: (updatedWorkspace.obligations ?? []).map(item =>
      item.id === id
        ? { ...item, preparationTaskId: reconciled.preparationTaskId }
        : item
    ),
  };
}

export function restorePreparationTask(
  workspace: Workspace,
  id: string,
  stamp = adelaideTimestamp(),
  nextTaskId: () => string = () => newId("obligation-task")
): Workspace {
  const obligation = (workspace.obligations ?? []).find(item => item.id === id);
  if (!obligation || obligation.status !== "active") return workspace;
  const reconciled = reconcilePreparationTask(
    workspace.tasks,
    obligation,
    obligation,
    stamp,
    nextTaskId
  );
  return {
    ...workspace,
    tasks: reconciled.tasks,
    obligations: (workspace.obligations ?? []).map(item =>
      item.id === id
        ? { ...item, preparationTaskId: reconciled.preparationTaskId }
        : item
    ),
  };
}

export function obligationPreparationTask(
  workspace: Workspace,
  obligation: Obligation
): Task | undefined {
  return obligation.preparationTaskId
    ? workspace.tasks.find(task => task.id === obligation.preparationTaskId)
    : undefined;
}
