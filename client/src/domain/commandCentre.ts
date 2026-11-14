import {
  buildCalendar,
  dateRange,
  type CalendarDay,
  type CalendarItem,
} from "./calendarModel";
import { adelaideDate } from "../../../shared/time";
import { imperativeViews, type ImperativeView } from "./compass";
import { orphanReport } from "./orphans";
import { reviewStatus, type ReviewStatus } from "./review";
import { adelaideClock, shiftDays, weekdayOf } from "./time";
import type { Task, Workspace } from "./types";

export type CommandCentreMode =
  | "weekday-before-morning"
  | "weekday-morning"
  | "weekday-evening"
  | "saturday"
  | "sunday";

export interface CommandCentreQuestion {
  /** Stable presentation key for one item and one question type. */
  id: string;
  /** The actual Steadier record ID; never a Notion or generated shadow ID. */
  itemId: string;
  itemKind: "task" | "project" | "imperative";
  kind:
    | "placement"
    | "commitment"
    | "weekend-task"
    | "weekend-project"
    | "weekend-imperative";
  title: string;
  question: string;
  detail: string;
  updatedAt: string;
  taskState?: Task["state"];
}

export interface CommandCentreWeekendChange {
  id: string;
  itemId: string;
  itemKind: "task" | "project" | "imperative";
  title: string;
  updatedAt: string;
  status: string;
}

export interface CommandCentreSnapshot {
  today: string;
  mode: CommandCentreMode;
  activeImperatives: ImperativeView[];
  questions: CommandCentreQuestion[];
  todayItems: CalendarItem[];
  upcomingDays: CalendarDay[];
  weekendChanges: CommandCentreWeekendChange[];
  review: ReviewStatus;
  lastUpdatedAt: string | null;
}


const MAX_QUESTIONS = 5;
const MORNING_START_MINUTES = 8 * 60;
const EVENING_START_MINUTES = 17 * 60;

function modeFor(date: string, minutes: number): CommandCentreMode {
  const day = weekdayOf(date);
  if (day === 6) return "saturday";
  if (day === 0) return "sunday";
  if (minutes < MORNING_START_MINUTES) return "weekday-before-morning";
  return minutes >= EVENING_START_MINUTES
    ? "weekday-evening"
    : "weekday-morning";
}

function isQuietOrParked(task: Task, today: string): boolean {
  return (
    task.state === "someday" ||
    Boolean(task.droppedAt) ||
    Boolean(task.deferredUntil && task.deferredUntil > today)
  );
}

function isUndatedDormant(task: Task): boolean {
  return !(
    task.deadline ||
    task.startDate ||
    task.schedule.date ||
    task.schedule.flexibleWindow ||
    task.schedule.repeatAnchorDate ||
    task.schedule.repeatOccurrenceDate
  );
}

function datedItems(day: CalendarDay): CalendarItem[] {
  return [
    ...day.timed,
    ...day.allDay,
    ...day.dateMarkers,
    ...day.falldue,
  ];
}

/** The newest saved record time in the workspace (shown on Server & Compass). */
export function latestRecordAt(workspace: Workspace): string | null {
  const records: { updatedAt?: string; at?: string }[] = [
    ...workspace.tasks,
    ...workspace.projects,
    ...workspace.imperatives,
    ...workspace.goals,
    ...(workspace.obligations ?? []),
    ...(workspace.people ?? []),
    ...(workspace.credentialRenewals ?? []),
    ...(workspace.evidence ?? []),
    ...(workspace.siteCards ?? []),
    ...(workspace.lists?.templates ?? []),
    ...(workspace.lists?.runs ?? []),
    ...(workspace.assets ?? []),
    ...(workspace.invoices ?? []),
    ...workspace.reviews,
  ];
  const stamps = records
    .map(record => record.updatedAt ?? record.at ?? "")
    .filter(stamp => stamp && !Number.isNaN(Date.parse(stamp)))
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return stamps[0] ?? null;
}

function weekendDates(today: string): Set<string> {
  return new Set([shiftDays(today, -2), shiftDays(today, -1)]);
}

function adelaideDateOfStamp(stamp: string): string {
  const instant = new Date(stamp);
  return Number.isNaN(instant.getTime()) ? stamp.slice(0, 10) : adelaideDate(instant);
}

function weekendChangesFor(
  workspace: Workspace,
  today: string,
  mode: CommandCentreMode
): CommandCentreWeekendChange[] {
  if (mode !== "weekday-morning" || weekdayOf(today) !== 1) return [];
  const dates = weekendDates(today);
  const changes: CommandCentreWeekendChange[] = [
    ...workspace.tasks
      .filter(task => dates.has(adelaideDateOfStamp(task.updatedAt)))
      .map(task => ({
        id: `weekend:task:${task.id}`,
        itemId: task.id,
        itemKind: "task" as const,
        title: task.title,
        updatedAt: task.updatedAt,
        status: task.state === "done" ? "Completed" : "Changed over the weekend",
      })),
    ...workspace.projects
      .filter(project => dates.has(adelaideDateOfStamp(project.updatedAt)))
      .map(project => ({
        id: `weekend:project:${project.id}`,
        itemId: project.id,
        itemKind: "project" as const,
        title: project.title,
        updatedAt: project.updatedAt,
        status: "Changed over the weekend",
      })),
    ...workspace.imperatives
      .filter(item => dates.has(adelaideDateOfStamp(item.updatedAt)))
      .map(item => ({
        id: `weekend:imperative:${item.id}`,
        itemId: item.id,
        itemKind: "imperative" as const,
        title: item.title,
        updatedAt: item.updatedAt,
        status: item.status === "active" ? "Active Imperative changed" : "Retired Imperative changed",
      })),
  ];
  return changes.sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id)
  );
}

function uniqueQuestions(questions: CommandCentreQuestion[]): CommandCentreQuestion[] {
  const seen = new Set<string>();
  return questions.filter(question => {
    if (seen.has(question.id)) return false;
    seen.add(question.id);
    return true;
  });
}

function buildQuestions(
  workspace: Workspace,
  mode: CommandCentreMode,
  today: string,
  now: Date,
  todayItems: CalendarItem[],
  weekendChanges: CommandCentreWeekendChange[]
): CommandCentreQuestion[] {
  if (
    mode === "weekday-before-morning" ||
    mode === "saturday" ||
    mode === "sunday"
  ) return [];

  const placement = orphanReport(workspace.tasks, now).items
    .filter(
      item =>
        item.stage === 3 &&
        !isQuietOrParked(item.task, today) &&
        !isUndatedDormant(item.task)
    )
    .map(item => ({
      id: `placement:${item.task.id}`,
      itemId: item.task.id,
      itemKind: "task" as const,
      kind: "placement" as const,
      title: item.task.title,
      question: `Where should “${item.task.title}” live?`,
      detail: `Overdue for placement · ${item.urgent ?? "Steadier stage 3"}`,
      updatedAt: item.task.updatedAt,
      taskState: item.task.state,
    }));

  const questions: CommandCentreQuestion[] = [];
  if (mode === "weekday-morning") {
    const mondayCatchup = weekdayOf(today) === 1;
    const placementLimit = mondayCatchup ? 3 : MAX_QUESTIONS;
    questions.push(...placement.slice(0, placementLimit));
    const remaining = MAX_QUESTIONS - questions.length;
    if (mondayCatchup && remaining > 0) {
      const recentChanges = weekendChanges.filter(
        change => change.itemKind !== "task" ||
          workspace.tasks.find(task => task.id === change.itemId)?.state !== "done"
      );
      const askedAbout = new Set(questions.map(question => question.itemId));
      for (const change of recentChanges) {
        if (questions.length >= MAX_QUESTIONS) break;
        if (askedAbout.has(change.itemId)) continue;
        if (change.itemKind === "task") {
          const task = workspace.tasks.find(item => item.id === change.itemId);
          if (!task || isQuietOrParked(task, today)) continue;
          questions.push({
            id: `weekend-task:${task.id}`,
            itemId: task.id,
            itemKind: "task",
            kind: "weekend-task",
            title: task.title,
            question: `Review “${task.title}” after its weekend change?`,
            detail: "Changed over the weekend · open the current Steadier record to review it.",
            updatedAt: task.updatedAt,
            taskState: task.state,
          });
          askedAbout.add(task.id);
        } else if (change.itemKind === "project") {
          const project = workspace.projects.find(item => item.id === change.itemId);
          if (!project || project.status !== "active") continue;
          questions.push({
            id: `weekend-project:${project.id}`,
            itemId: project.id,
            itemKind: "project",
            kind: "weekend-project",
            title: project.title,
            question: `Review “${project.title}” after its weekend change?`,
            detail: "Changed over the weekend · open the current Project Outcome to review it.",
            updatedAt: project.updatedAt,
          });
          askedAbout.add(project.id);
        } else {
          const imperative = workspace.imperatives.find(item => item.id === change.itemId);
          if (!imperative || imperative.status !== "active") continue;
          questions.push({
            id: `weekend-imperative:${imperative.id}`,
            itemId: imperative.id,
            itemKind: "imperative",
            kind: "weekend-imperative",
            title: imperative.title,
            question: `Review “${imperative.title}” after its weekend change?`,
            detail: "Changed over the weekend · open Imperatives to review it.",
            updatedAt: imperative.updatedAt,
          });
          askedAbout.add(imperative.id);
        }
      }
    }
    return uniqueQuestions(questions).slice(0, MAX_QUESTIONS);
  }

  const placementIds = new Set(placement.map(question => question.itemId));
  const todayTasks: CommandCentreQuestion[] = [];
  const taskSeen = new Set<string>();
  for (const item of todayItems) {
    if (!item.taskId || taskSeen.has(item.taskId) || placementIds.has(item.taskId)) continue;
    const task = workspace.tasks.find(candidate => candidate.id === item.taskId);
    if (!task || task.state === "done" || isQuietOrParked(task, today)) continue;
    taskSeen.add(task.id);
    todayTasks.push({
      id: `commitment:${task.id}`,
      itemId: task.id,
      itemKind: "task",
      kind: "commitment",
      title: task.title,
      question: `“${task.title}” was dated for today. Is it done or does the plan need changing?`,
      detail: item.label || (item.kind === "deadline" ? "Hard deadline today" : "Dated commitment today"),
      updatedAt: task.updatedAt,
      taskState: task.state,
    });
  }

  const questionSlots = placement.length > 0 ? MAX_QUESTIONS - 1 : MAX_QUESTIONS;
  questions.push(...todayTasks.slice(0, questionSlots));
  questions.push(...placement.slice(0, MAX_QUESTIONS - questions.length));
  return uniqueQuestions(questions).slice(0, MAX_QUESTIONS);
}

/**
 * The weekday check-in (shown as one line above Now on Today).
 * Current check-in information, selected from existing Steadier rules.
 * All dates are Adelaide-local; this function never changes the workspace.
 */
export function commandCentreSnapshot(
  workspace: Workspace,
  now: Date = new Date()
): CommandCentreSnapshot {
  const clock = adelaideClock(now);
  const today = clock.date;
  const mode = modeFor(today, clock.minutes);
  const dates = dateRange(today, 4);
  const calendar = buildCalendar(workspace.tasks, workspace.projects, dates, today, {
    obligations: workspace.obligations ?? [],
    credentialRenewals: workspace.credentialRenewals ?? [],
    people: workspace.people ?? [],
  });
  const todayItems = datedItems(calendar[0]);
  const upcomingDays = calendar.slice(1);
  const activeImperatives = imperativeViews(workspace, today)
    .filter(view => view.imperative.status === "active")
    .sort((a, b) => {
      if (a.quiet !== b.quiet) return a.quiet ? -1 : 1;
      return (b.quietDays ?? 0) - (a.quietDays ?? 0) ||
        a.imperative.title.localeCompare(b.imperative.title);
    });
  const weekendChanges = weekendChangesFor(workspace, today, mode);
  return {
    today,
    mode,
    activeImperatives,
    questions: buildQuestions(
      workspace,
      mode,
      today,
      now,
      todayItems,
      weekendChanges
    ),
    todayItems,
    upcomingDays,
    weekendChanges,
    review: reviewStatus(workspace, today),
    lastUpdatedAt: latestRecordAt(workspace),
  };
}

/** Hashes the stable workspace start timestamp so acknowledgements survive task edits without storing workspace content. */
export function commandCentreWorkspaceKey(workspace: Workspace): string {
  const identity = workspace.trial.startedAt || `workspace-v${workspace.version}`;
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i += 1) {
    hash ^= identity.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
