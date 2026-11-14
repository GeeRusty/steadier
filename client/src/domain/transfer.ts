import { STATES } from "./types";
import {
  emptyProjectCompass,
  emptyTaskCompass,
  imperativesField,
  projectCompassField,
  pruneImperativeLinks,
  taskCompassField,
} from "./compass";
import { reviewsField } from "./review";
import { goalsField, pruneGoalLinks } from "./goals";
import { MAX_PLACES, MAX_RADIUS, MIN_RADIUS, prunePlaceLinks } from "./places";
import { obligationsField, taskObligationField } from "./obligations";
import { MAX_EVIDENCE_ENTRIES, MAX_EVIDENCE_TEXT_LENGTH } from "./evidence";
import { MAX_SITE_CARDS, isCanonicalPublicHttpsUrl } from "./siteCards";
import { pruneAssetLinks, validateAssets } from "./assets";
import { moveIdeasToFrontOfMind, pruneFrontOfMindLinks, validateFrontOfMind } from "./frontOfMind";
import {
  MAX_SHOPPING_ITEMS_PER_LIST,
  MAX_SHOPPING_ITEMS_TOTAL,
  MAX_SHOPPING_LISTS,
} from "./shoppingLists";
import { validateDailyLogEntries } from "./dailyLog";
import { listsFromShoppingLists, pruneListLinks, validateLists } from "./lists";
import {
  MAX_PEOPLE,
  MAX_PERSON_CONTEXT_LENGTH,
  MAX_PERSON_NAME_LENGTH,
  MAX_PERSON_RELATIONSHIP_LENGTH,
} from "./people";
import { credentialRenewalsField } from "./credentialRenewals";
import {
  invoiceSettingsField,
  invoicesField,
  validateInvoiceSequence,
} from "./invoices";
import type {
  Context,
  DailyLogEntry,
  LinkCheckHold,
  DailyIntention,
  FocusSession,
  LifePattern,
  LifeRole,
  MatrixCell,
  MatrixWeights,
  Project,
  Task,
  TaskParent,
  Place,
  TaskState,
  SiteCard,
  ShoppingList,
  ListsStore,
  FrontOfMindStore,
  WorkspaceContact,
  Workspace,
  WorkspaceEvidence,
} from "./types";

import {
  DEFAULT_PLANNING,
  emptyProjectSchedule,
  emptyTaskSchedule,
  isDate,
  isTime,
  type PlanningSettings,
  type FlexibleTimeWindow,
  type ProjectSchedule,
  type RepeatRule,
  type TaskSchedule,
} from "./time";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_TASKS = 5000;
const MAX_PROJECTS = 1000;
const MAX_DEPENDENCIES = 1000;
const MAX_CHECKLIST_ITEMS = 1000;
const MAX_HISTORY_ITEMS = 1000;
const MAX_MILESTONES = 1000;
const MAX_PROGRESS_ITEMS = 1000;

const CONTEXTS: readonly Context[] = ["anywhere", "home", "computer", "out"];
const ROLES: readonly LifeRole[] = ["direction", "support"];
const PATTERNS: readonly LifePattern[] = ["timely", "sustained"];
const LABEL_SOURCES = ["unclassified", "suggested", "confirmed"] as const;
const PREPARATION_SOURCES = ["suggested", "confirmed"] as const;
const PROJECT_STATUSES = ["active", "achieved"] as const;
const MATRIX_CELLS: readonly MatrixCell[] = [
  "direction-timely",
  "direction-sustained",
  "support-timely",
  "support-sustained",
];

const LEGACY_TASK_KEYS = [
  "id",
  "title",
  "nextAction",
  "notes",
  "state",
  "pinned",
  "deadline",
  "startDate",
  "reviewDate",
  "deferredUntil",
  "estimate",
  "context",
  "waitingFor",
  "dependencies",
  "checklist",
  "repeatDays",
  "createdAt",
  "updatedAt",
  "completedAt",
  "history",
] as const;

const TASK_KEYS = [
  ...LEGACY_TASK_KEYS,
  "purpose",
  "role",
  "pattern",
  "labelSource",
  "projectId",
  "preparationDate",
  "preparationSource",
  "progressEvidence",
] as const;

const PROJECT_KEYS = [
  "id",
  "title",
  "purpose",
  "outcome",
  "role",
  "pattern",
  "status",
  "milestones",
  "progress",
  "createdAt",
  "updatedAt",
] as const;

/** CSV intentionally contains only portable scalar core fields and prerequisite IDs. */
const CSV_FIELDS = [
  "id",
  "title",
  "nextAction",
  "notes",
  "state",
  "pinned",
  "deadline",
  "startDate",
  "reviewDate",
  "deferredUntil",
  "estimate",
  "context",
  "waitingFor",
  "repeatDays",
  "createdAt",
  "updatedAt",
  "completedAt",
  "dependencies",
] as const;

/** Older exports also had area and important; they still import. */
const LEGACY_CSV_FIELDS = [...CSV_FIELDS, "area", "important"] as const;

type JsonRecord = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(`Could not import tasks: ${message}`);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: JsonRecord,
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

function hasOneOfExactKeySets(
  value: JsonRecord,
  sets: readonly (readonly string[])[],
  label: string
): number {
  const actual = Object.keys(value);
  const match = sets.findIndex(
    keys =>
      actual.length === keys.length && actual.every(key => keys.includes(key))
  );
  if (match < 0) fail(`${label} has unknown or missing fields.`);
  return match;
}

function localDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function validInstant(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
  );
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function stringField(
  record: JsonRecord,
  key: string,
  maximum: number,
  options: { nonEmpty?: boolean; id?: boolean } = {}
): string {
  const value = record[key];
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (options.nonEmpty && value.trim().length === 0)
  ) {
    fail(
      `${key} must be a ${options.nonEmpty ? "non-empty " : ""}string up to ${maximum} characters.`
    );
  }
  if (options.id && !validId(value)) fail(`${key} is not a valid portable ID.`);
  return value;
}

function nullableStringField(
  record: JsonRecord,
  key: string,
  maximum: number,
  options: { id?: boolean } = {}
): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maximum) {
    fail(`${key} must be a string or null.`);
  }
  if (options.id && !validId(value)) fail(`${key} is not a valid portable ID.`);
  return value;
}

function nullableDateField(record: JsonRecord, key: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string" || !localDate(value)) {
    fail(`${key} must be a local YYYY-MM-DD date or null.`);
  }
  return value;
}

function instantField(record: JsonRecord, key: string): string {
  const value = stringField(record, key, 100, { nonEmpty: true });
  if (!validInstant(value)) fail(`${key} must be a valid timestamp.`);
  return value;
}

function nullableInstantField(record: JsonRecord, key: string): string | null {
  if (record[key] === null) return null;
  return instantField(record, key);
}

function booleanField(record: JsonRecord, key: string): boolean {
  if (typeof record[key] !== "boolean") fail(`${key} must be true or false.`);
  return record[key] as boolean;
}

function integerField(
  record: JsonRecord,
  key: string,
  min: number,
  max: number
): number {
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    fail(`${key} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function finiteNumberField(
  record: JsonRecord,
  key: string,
  min: number,
  max: number
): number {
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    fail(`${key} must be a finite number between ${min} and ${max}.`);
  }
  return value;
}

function nullableIntegerField(
  record: JsonRecord,
  key: string,
  min: number,
  max: number
): number | null {
  if (record[key] === null) return null;
  return integerField(record, key, min, max);
}

function enumField<T extends string>(
  record: JsonRecord,
  key: string,
  values: readonly T[]
): T {
  const value = record[key];
  if (typeof value !== "string" || !values.includes(value as T)) {
    fail(`${key} has an unsupported value.`);
  }
  return value as T;
}

function nullableEnumField<T extends string>(
  record: JsonRecord,
  key: string,
  values: readonly T[]
): T | null {
  if (record[key] === null) return null;
  return enumField(record, key, values);
}

function dependenciesField(record: JsonRecord): string[] {
  const value = record.dependencies;
  if (!Array.isArray(value) || value.length > MAX_DEPENDENCIES) {
    fail(`dependencies must be an array of at most ${MAX_DEPENDENCIES} IDs.`);
  }
  const dependencies = value.map(dependency => {
    if (typeof dependency !== "string" || !validId(dependency)) {
      fail("dependencies contains an invalid ID.");
    }
    return dependency;
  });
  if (new Set(dependencies).size !== dependencies.length) {
    fail("dependencies must not contain duplicate IDs.");
  }
  return dependencies;
}

function checklistField(record: JsonRecord): Task["checklist"] {
  const value = record.checklist;
  if (!Array.isArray(value) || value.length > MAX_CHECKLIST_ITEMS) {
    fail(
      `checklist must be an array of at most ${MAX_CHECKLIST_ITEMS} entries.`
    );
  }
  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry))
      fail(`checklist entry ${index + 1} is not an object.`);
    hasExactKeys(entry, ["id", "text", "done"], `checklist entry ${index + 1}`);
    const id = stringField(entry, "id", 128, { nonEmpty: true, id: true });
    if (ids.has(id)) fail("checklist IDs must be unique within a task.");
    ids.add(id);
    return {
      id,
      text: stringField(entry, "text", 2000),
      done: booleanField(entry, "done"),
    };
  });
}

function historyField(
  record: JsonRecord,
  strictTimestamps = false
): Task["history"] {
  const value = record.history;
  if (!Array.isArray(value) || value.length > MAX_HISTORY_ITEMS) {
    fail(`history must be an array of at most ${MAX_HISTORY_ITEMS} entries.`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`history entry ${index + 1} is not an object.`);
    hasExactKeys(entry, ["at", "text"], `history entry ${index + 1}`);
    return {
      at: strictTimestamps
        ? instantField(entry, "at")
        : stringField(entry, "at", 100, { nonEmpty: true }),
      text: stringField(entry, "text", 2000),
    };
  });
}

/**
 * Accept exact legacy task records and exact v2 records.  A v1 workspace can
 * already contain newly-created tasks, so recognised v2 fields are retained;
 * partial extensions and unknown fields are never accepted.
 */
const MAX_REMINDERS = 10;
const MAX_SERIES_DATES = 2000;
const MAX_TIME_LOG = 2000;
const REPEAT_FREQS = ["daily", "weekly", "monthly", "yearly", "after"] as const;
const REPEAT_KEYS = [
  "freq",
  "interval",
  "weekdays",
  "monthDay",
  "nthWeekday",
  "until",
  "count",
] as const;
const TASK_SCHEDULE_KEYS = [
  "date",
  "time",
  "minutes",
  "fixed",
  "deadlineTime",
  "reminders",
  "repeat",
  "seriesId",
  "completions",
  "skipped",
  "timeLog",
  "missedHandled",
] as const;
const TASK_SCHEDULE_OCCURRENCE_KEYS = [
  ...TASK_SCHEDULE_KEYS,
  "repeatOccurrenceDate",
  "repeatTime",
] as const;
const TASK_SCHEDULE_SERIES_KEYS = [
  ...TASK_SCHEDULE_OCCURRENCE_KEYS,
  "repeatAnchorDate",
] as const;
const TASK_SCHEDULE_FLEXIBLE_KEYS = [
  ...TASK_SCHEDULE_KEYS,
  "flexibleWindow",
] as const;
const TASK_SCHEDULE_FLEXIBLE_OCCURRENCE_KEYS = [
  ...TASK_SCHEDULE_OCCURRENCE_KEYS,
  "flexibleWindow",
] as const;
const TASK_SCHEDULE_FLEXIBLE_SERIES_KEYS = [
  ...TASK_SCHEDULE_SERIES_KEYS,
  "flexibleWindow",
] as const;
function nullableTimeField(record: JsonRecord, key: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (!isTime(value)) fail(`${key} must be a 24-hour HH:MM time or null.`);
  return value;
}
function strictDateValue(value: unknown, label: string): string {
  if (!isDate(value)) fail(`${label} must be a YYYY-MM-DD date.`);
  return value;
}
function nullableStrictDate(record: JsonRecord, key: string): string | null {
  const value = record[key];
  if (value === null) return null;
  return strictDateValue(value, key);
}
function flexibleWindowField(
  value: unknown,
  label: string
): FlexibleTimeWindow {
  if (!isRecord(value)) fail(`${label} flexible window must be an object.`);
  hasExactKeys(value, ["startDate", "endDate"], `${label} flexible window`);
  const startDate = strictDateValue(value.startDate, "flexible window start");
  const endDate = strictDateValue(value.endDate, "flexible window end");
  if (endDate < startDate)
    fail("flexible window end must be on or after its start.");
  return { startDate, endDate };
}
function boundedInteger(
  value: unknown,
  label: string,
  min: number,
  max: number
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    fail(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}
function dateList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_SERIES_DATES) {
    fail(`${label} must be a list of at most ${MAX_SERIES_DATES} dates.`);
  }
  return value.map((entry, index) =>
    strictDateValue(entry, `${label} ${index + 1}`)
  );
}
function repeatField(value: unknown, label: string): RepeatRule | null {
  if (value === null) return null;
  if (!isRecord(value)) fail(`${label} repeat must be an object or null.`);
  hasExactKeys(value, REPEAT_KEYS, `${label} repeat`);
  const freq = enumField(value, "freq", REPEAT_FREQS);
  const weekdays = value.weekdays;
  if (!Array.isArray(weekdays) || weekdays.length > 7) {
    fail(`${label} repeat weekdays must be a list of up to 7 days.`);
  }
  const nth = value.nthWeekday;
  let nthWeekday: RepeatRule["nthWeekday"] = null;
  if (nth !== null) {
    if (!isRecord(nth))
      fail(`${label} repeat nthWeekday must be an object or null.`);
    hasExactKeys(nth, ["n", "weekday"], `${label} repeat nthWeekday`);
    const n = boundedInteger(nth.n, "nthWeekday.n", -1, 5);
    if (n === 0) fail("nthWeekday.n cannot be 0.");
    nthWeekday = {
      n,
      weekday: boundedInteger(nth.weekday, "nthWeekday.weekday", 0, 6),
    };
  }
  const monthDay =
    value.monthDay === null
      ? null
      : boundedInteger(value.monthDay, "repeat monthDay", -1, 31);
  if (monthDay === 0) fail("repeat monthDay cannot be 0.");
  return {
    freq,
    interval: boundedInteger(value.interval, "repeat interval", 1, 366),
    weekdays: [
      ...new Set(
        weekdays.map((day, index) =>
          boundedInteger(day, `repeat weekday ${index + 1}`, 0, 6)
        )
      ),
    ],
    monthDay,
    nthWeekday,
    until: nullableStrictDate(value, "until"),
    count:
      value.count === null
        ? null
        : boundedInteger(value.count, "repeat count", 1, 10000),
  };
}
function taskScheduleField(value: unknown, label: string): TaskSchedule {
  if (!isRecord(value)) fail(`${label} schedule is not an object.`);
  const hasMajorAnchor = Object.prototype.hasOwnProperty.call(
    value,
    "majorAnchor"
  );
  const shapeRecord = { ...value };
  delete shapeRecord.majorAnchor;
  const shape = hasOneOfExactKeySets(
    shapeRecord,
    [
      TASK_SCHEDULE_KEYS,
      TASK_SCHEDULE_OCCURRENCE_KEYS,
      TASK_SCHEDULE_SERIES_KEYS,
      TASK_SCHEDULE_FLEXIBLE_KEYS,
      TASK_SCHEDULE_FLEXIBLE_OCCURRENCE_KEYS,
      TASK_SCHEDULE_FLEXIBLE_SERIES_KEYS,
    ],
    `${label} schedule`
  );
  const flexible = shape >= 3;
  const baseShape = shape % 3;
  const flexibleWindow = flexible
    ? flexibleWindowField(value.flexibleWindow, label)
    : null;
  const date = nullableStrictDate(value, "date");
  const time = nullableTimeField(value, "time");
  const fixed = booleanField(value, "fixed");
  const majorAnchor = hasMajorAnchor
    ? booleanField(value, "majorAnchor")
    : undefined;
  const repeatTime =
    baseShape > 0 ? nullableTimeField(value, "repeatTime") : null;
  if (flexible && (date !== null || time !== null || fixed || repeatTime))
    fail(`${label} flexible window cannot also have fixed appointment timing.`);
  if (flexible && majorAnchor)
    fail(`${label} flexible window cannot be marked as a major anchor.`);
  const reminders = value.reminders;
  if (!Array.isArray(reminders) || reminders.length > MAX_REMINDERS) {
    fail(`${label} reminders must be a list of at most ${MAX_REMINDERS}.`);
  }
  const reminderIds = new Set<string>();
  const timeLog = value.timeLog;
  if (!Array.isArray(timeLog) || timeLog.length > MAX_TIME_LOG) {
    fail(
      `${label} time log must be a list of at most ${MAX_TIME_LOG} entries.`
    );
  }
  return {
    date,
    time,
    minutes:
      value.minutes === null
        ? null
        : boundedInteger(value.minutes, "schedule minutes", 1, 1440),
    fixed,
    ...(majorAnchor !== undefined ? { majorAnchor } : {}),
    ...(flexibleWindow ? { flexibleWindow } : {}),
    deadlineTime: nullableTimeField(value, "deadlineTime"),
    reminders: reminders.map((entry, index) => {
      if (!isRecord(entry)) fail(`reminder ${index + 1} is not an object.`);
      hasExactKeys(
        entry,
        ["id", "minutesBefore", "anchor"],
        `reminder ${index + 1}`
      );
      const id = stringField(entry, "id", 128, { nonEmpty: true, id: true });
      if (reminderIds.has(id))
        fail("reminder IDs must be unique within a task.");
      reminderIds.add(id);
      return {
        id,
        minutesBefore: boundedInteger(
          entry.minutesBefore,
          "reminder minutesBefore",
          0,
          60 * 24 * 30
        ),
        anchor: enumField(entry, "anchor", ["slot", "deadline"] as const),
      };
    }),
    repeat: repeatField(value.repeat, label),
    seriesId: nullableStringField(value, "seriesId", 128, { id: true }),
    completions: dateList(value.completions, "completions"),
    skipped: dateList(value.skipped, "skipped"),
    timeLog: timeLog.map((entry, index) => {
      if (!isRecord(entry)) fail(`time entry ${index + 1} is not an object.`);
      hasExactKeys(
        entry,
        ["start", "minutes", "source"],
        `time entry ${index + 1}`
      );
      const start = entry.start;
      if (
        typeof start !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
        !isDate(start.slice(0, 10))
      ) {
        fail(`time entry ${index + 1} start must be YYYY-MM-DDTHH:MM.`);
      }
      return {
        start,
        minutes: boundedInteger(entry.minutes, "time entry minutes", 1, 1440),
        source: enumField(entry, "source", ["focus", "manual"] as const),
      };
    }),
    missedHandled: nullableStrictDate(value, "missedHandled"),
    ...(baseShape > 0
      ? {
          repeatOccurrenceDate: nullableStrictDate(
            value,
            "repeatOccurrenceDate"
          ),
          repeatTime,
        }
      : {}),
    ...(baseShape === 2
      ? { repeatAnchorDate: nullableStrictDate(value, "repeatAnchorDate") }
      : {}),
  };
}
/** Older tasks: carry a legacy "repeat every N days" into the new rule. */
function legacyTaskSchedule(value: JsonRecord): TaskSchedule {
  const schedule = emptyTaskSchedule();
  const days = value.repeatDays;
  if (typeof days === "number" && Number.isInteger(days) && days > 0) {
    schedule.repeat = {
      freq: "after",
      interval: Math.min(366, days),
      weekdays: [],
      monthDay: null,
      nthWeekday: null,
      until: null,
      count: null,
    };
  }
  return schedule;
}
function projectScheduleField(value: unknown, label: string): ProjectSchedule {
  if (!isRecord(value)) fail(`${label} schedule is not an object.`);
  hasExactKeys(
    value,
    ["deadline", "reviewDate", "weeklyBudgetMinutes", "milestoneDates"],
    `${label} schedule`
  );
  const dates = value.milestoneDates;
  if (!Array.isArray(dates) || dates.length > MAX_MILESTONES) {
    fail(`${label} milestone dates must be a list.`);
  }
  return {
    deadline: nullableStrictDate(value, "deadline"),
    reviewDate: nullableStrictDate(value, "reviewDate"),
    weeklyBudgetMinutes:
      value.weeklyBudgetMinutes === null
        ? null
        : boundedInteger(
            value.weeklyBudgetMinutes,
            "weeklyBudgetMinutes",
            5,
            60 * 24 * 7
          ),
    milestoneDates: dates.map((entry, index) => {
      if (!isRecord(entry))
        fail(`milestone date ${index + 1} is not an object.`);
      hasExactKeys(entry, ["id", "date"], `milestone date ${index + 1}`);
      return {
        id: stringField(entry, "id", 128, { nonEmpty: true, id: true }),
        date: strictDateValue(entry.date, `milestone date ${index + 1}`),
      };
    }),
  };
}
function planningField(value: unknown): PlanningSettings {
  if (!isRecord(value)) fail("planning settings must be an object.");
  const hasThreshold = Object.prototype.hasOwnProperty.call(
    value,
    "passOverThreshold"
  );
  hasExactKeys(
    value,
    hasThreshold
      ? ["dayStart", "dayEnd", "bufferMinutes", "passOverThreshold"]
      : ["dayStart", "dayEnd", "bufferMinutes"],
    "planning settings"
  );
  const dayStart = value.dayStart;
  const dayEnd = value.dayEnd;
  if (!isTime(dayStart) || !isTime(dayEnd) || dayEnd <= dayStart) {
    fail(
      "planning day start and end must be HH:MM times with end after start."
    );
  }
  return {
    dayStart,
    dayEnd,
    bufferMinutes: boundedInteger(value.bufferMinutes, "bufferMinutes", 0, 120),
    ...(hasThreshold
      ? {
          passOverThreshold: boundedInteger(
            value.passOverThreshold,
            "passOverThreshold",
            1,
            10
          ),
        }
      : {}),
  };
}
/** "General" was the automatic filler, so only a chosen Area is kept. */
function areaWorthKeeping(area: string): boolean {
  return area !== "" && area.toLowerCase() !== "general";
}
export function notesWithArea(notes: string, area: string): string {
  if (!areaWorthKeeping(area)) return notes;
  const line = `Area: ${area}`;
  if (notes.split(/\r?\n/).some(l => l.trim() === line)) return notes;
  return (notes.trim() ? `${notes.trimEnd()}\n${line}` : line).slice(0, 20000);
}
function historyWithArea(
  history: Task["history"],
  area: string,
  at: string,
  notes: string
): Task["history"] {
  if (notesWithArea(notes, area) === notes) return history;
  return [...history, { at, text: `Area “${area}” moved into the notes (Area was removed).` }];
}

function validateTask(value: unknown, label: string, requireV2 = false): Task {
  if (!isRecord(value)) fail(`${label} is not an object.`);
  const hasPassOverCount = Object.prototype.hasOwnProperty.call(
    value,
    "passOverCount"
  );
  const hasDroppedAt = Object.prototype.hasOwnProperty.call(value, "droppedAt");
  const hasActionConfirmed = Object.prototype.hasOwnProperty.call(
    value,
    "actionConfirmed"
  );
  const shapeRecord = { ...value };
  delete shapeRecord.passOverCount;
  delete shapeRecord.droppedAt;
  delete shapeRecord.actionConfirmed;
  // Removed fields (2026-11-12): older saves, backups and CSVs still load.
  // Important is dropped; a chosen Area is moved into the notes.
  delete shapeRecord.area;
  delete shapeRecord.important;
  if (Object.prototype.hasOwnProperty.call(value, "important"))
    booleanField(value, "important");
  const legacyArea = Object.prototype.hasOwnProperty.call(value, "area")
    ? stringField(value, "area", 120).trim()
    : "";
  const baseShapes = [
    LEGACY_TASK_KEYS,
    TASK_KEYS,
    [...TASK_KEYS, "schedule"],
    [...TASK_KEYS, "schedule", "compass"],
    [...TASK_KEYS, "schedule", "compass", "parent"],
    [...TASK_KEYS, "schedule", "compass", "placeId"],
    [...TASK_KEYS, "schedule", "compass", "parent", "placeId"],
  ] as const;
  const shape = hasOneOfExactKeySets(
    shapeRecord,
    [
      ...baseShapes,
      ...baseShapes.slice(1).map(keys => [...keys, "obligation"]),
    ],
    label
  );
  const hasObligation = Object.prototype.hasOwnProperty.call(
    value,
    "obligation"
  );
  const baseShape = hasObligation ? shape - baseShapes.length + 1 : shape;
  if (requireV2 && baseShape === 0) {
    fail(`${label} is missing required v2 fields.`);
  }

  const legacy = baseShape === 0;
  return {
    id: stringField(value, "id", 128, { nonEmpty: true, id: true }),
    title: stringField(value, "title", 500, { nonEmpty: true }),
    nextAction: stringField(value, "nextAction", 2000),
    notes: notesWithArea(stringField(value, "notes", 20000), legacyArea),
    state: enumField(value, "state", STATES) as TaskState,
    pinned: booleanField(value, "pinned"),
    deadline: nullableDateField(value, "deadline"),
    startDate: nullableDateField(value, "startDate"),
    reviewDate: nullableDateField(value, "reviewDate"),
    deferredUntil: nullableDateField(value, "deferredUntil"),
    estimate: integerField(value, "estimate", 0, 1440),
    context: enumField(value, "context", CONTEXTS),
    waitingFor: stringField(value, "waitingFor", 1000),
    dependencies: dependenciesField(value),
    checklist: checklistField(value),
    repeatDays: nullableIntegerField(value, "repeatDays", 1, 3650),
    createdAt: requireV2
      ? instantField(value, "createdAt")
      : stringField(value, "createdAt", 100, { nonEmpty: true }),
    updatedAt: requireV2
      ? instantField(value, "updatedAt")
      : stringField(value, "updatedAt", 100, { nonEmpty: true }),
    completedAt: requireV2
      ? nullableInstantField(value, "completedAt")
      : nullableStringField(value, "completedAt", 100),
    history: historyWithArea(
      historyField(value, requireV2),
      legacyArea,
      String(value.updatedAt),
      String(value.notes)
    ),
    ...(hasPassOverCount
      ? {
          passOverCount: boundedInteger(
            value.passOverCount,
            "passOverCount",
            0,
            10000
          ),
        }
      : {}),
    ...(hasDroppedAt
      ? { droppedAt: nullableInstantField(value, "droppedAt") }
      : {}),
    ...(hasActionConfirmed
      ? { actionConfirmed: booleanField(value, "actionConfirmed") }
      : {}),
    // Legacy fields are deliberately neutral: migration never fabricates a
    // deadline, a confirmed classification, or an outcome relationship.
    purpose: legacy ? "" : stringField(value, "purpose", 4000),
    role: legacy ? null : nullableEnumField(value, "role", ROLES),
    pattern: legacy ? null : nullableEnumField(value, "pattern", PATTERNS),
    labelSource: legacy
      ? "unclassified"
      : enumField(value, "labelSource", LABEL_SOURCES),
    projectId: legacy
      ? null
      : nullableStringField(value, "projectId", 128, { id: true }),
    preparationDate: legacy
      ? null
      : nullableDateField(value, "preparationDate"),
    preparationSource: legacy
      ? "suggested"
      : enumField(value, "preparationSource", PREPARATION_SOURCES),
    progressEvidence: legacy
      ? ""
      : stringField(value, "progressEvidence", 4000),
    schedule:
      baseShape >= 2
        ? taskScheduleField(value.schedule, label)
        : legacyTaskSchedule(value),
    compass:
      baseShape >= 3
        ? taskCompassField(value.compass, label)
        : emptyTaskCompass(),
    // Subtask link (v2.6): only present on subtasks.
    ...(baseShape === 4 || baseShape === 6
      ? { parent: taskParentField(value.parent, label) }
      : {}),
    // Place link (v2.7): only present when set.
    ...(baseShape === 5 || baseShape === 6
      ? {
          placeId: stringField(value, "placeId", 128, {
            nonEmpty: true,
            id: true,
          }),
        }
      : {}),
    ...(hasObligation
      ? {
          obligation: taskObligationField(
            value.obligation,
            `${label} obligation source`
          ),
        }
      : {}),
  };
}
function placesField(value: unknown): Place[] {
  if (!Array.isArray(value) || value.length > MAX_PLACES) {
    fail(`places must be an array of at most ${MAX_PLACES} entries.`);
  }
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const label = `place ${index + 1}`;
    if (!isRecord(entry)) fail(`${label} is not an object.`);
    hasExactKeys(
      entry,
      ["id", "name", "address", "lat", "lng", "radius"],
      label
    );
    const id = stringField(entry, "id", 128, { nonEmpty: true, id: true });
    if (ids.has(id)) fail("place IDs must be unique.");
    ids.add(id);
    const lat = entry.lat;
    const lng = entry.lng;
    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      fail(`${label} has invalid coordinates.`);
    }
    return {
      id,
      name: stringField(entry, "name", 120, { nonEmpty: true }),
      address: stringField(entry, "address", 300),
      lat,
      lng,
      radius: integerField(entry, "radius", MIN_RADIUS, MAX_RADIUS),
    };
  });
}

function evidenceField(value: unknown): WorkspaceEvidence[] {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_ENTRIES) {
    fail(
      `evidence must be an array of at most ${MAX_EVIDENCE_ENTRIES} entries.`
    );
  }
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const label = `evidence entry ${index + 1}`;
    if (!isRecord(entry)) fail(`${label} is not an object.`);
    hasExactKeys(
      entry,
      [
        "id",
        "targetKind",
        "targetId",
        "titleSnapshot",
        "text",
        "createdAt",
        "updatedAt",
      ],
      label
    );
    const id = stringField(entry, "id", 128, { nonEmpty: true, id: true });
    if (ids.has(id)) fail("evidence IDs must be unique.");
    ids.add(id);
    return {
      id,
      targetKind: enumField(entry, "targetKind", ["task", "project"] as const),
      targetId: stringField(entry, "targetId", 128, {
        nonEmpty: true,
        id: true,
      }),
      titleSnapshot: stringField(entry, "titleSnapshot", 500, {
        nonEmpty: true,
      }),
      text: stringField(entry, "text", MAX_EVIDENCE_TEXT_LENGTH, {
        nonEmpty: true,
      }),
      createdAt: instantField(entry, "createdAt"),
      updatedAt: instantField(entry, "updatedAt"),
    };
  });
}

function siteCardsField(value: unknown): SiteCard[] {
  if (!Array.isArray(value) || value.length > MAX_SITE_CARDS) {
    fail(`siteCards must be an array of at most ${MAX_SITE_CARDS} entries.`);
  }
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const label = `site card ${index + 1}`;
    if (!isRecord(entry)) fail(`${label} is not an object.`);
    hasExactKeys(
      entry,
      [
        "id",
        "title",
        "category",
        "purpose",
        "url",
        "status",
        "createdAt",
        "updatedAt",
      ],
      label
    );
    const id = stringField(entry, "id", 128, { nonEmpty: true, id: true });
    if (ids.has(id)) fail("site card IDs must be unique.");
    ids.add(id);
    const url = nullableStringField(entry, "url", 2048);
    if (url !== null && !isCanonicalPublicHttpsUrl(url)) {
      fail(
        `${label} URL must be a canonical public HTTPS URL without credentials, query, or fragment.`
      );
    }
    return {
      id,
      title: stringField(entry, "title", 120, { nonEmpty: true }),
      category: stringField(entry, "category", 80),
      purpose: stringField(entry, "purpose", 500),
      url,
      status: enumField(entry, "status", ["active", "archived"] as const),
      createdAt: instantField(entry, "createdAt"),
      updatedAt: instantField(entry, "updatedAt"),
    };
  });
}

const MAX_LINK_CHECK_HOLDS = 400;
function linkCheckHoldsField(value: unknown): LinkCheckHold[] {
  if (!Array.isArray(value) || value.length > MAX_LINK_CHECK_HOLDS)
    fail(`linkCheckHolds must be a list of at most ${MAX_LINK_CHECK_HOLDS}.`);
  return value.map((item, index) => {
    const label = `link check hold ${index + 1}`;
    if (!isRecord(item)) fail(`${label} is not an object.`);
    hasExactKeys(item, ["kind", "id", "heldOn"], label);
    if (item.kind !== "imperative" && item.kind !== "project")
      fail(`${label} kind must be imperative or project.`);
    const id = stringField(item, "id", 128, { nonEmpty: true, id: true });
    const heldOn = stringField(item, "heldOn", 100, { nonEmpty: true });
    if (Number.isNaN(Date.parse(heldOn)))
      fail(`${label} heldOn must be a valid timestamp.`);
    return { kind: item.kind, id, heldOn };
  });
}

function dailyLogField(value: unknown): DailyLogEntry[] {
  try {
    return validateDailyLogEntries(value);
  } catch (error) {
    fail(error instanceof Error ? error.message : "dailyLog is not valid.");
  }
}

function shoppingListsField(value: unknown): ShoppingList[] {
  if (!Array.isArray(value) || value.length > MAX_SHOPPING_LISTS) {
    fail(
      `shoppingLists must be an array of at most ${MAX_SHOPPING_LISTS} lists.`
    );
  }
  const listIds = new Set<string>();
  const itemIds = new Set<string>();
  let totalItems = 0;
  return value.map((entry, listIndex) => {
    const label = `shopping list ${listIndex + 1}`;
    if (!isRecord(entry)) fail(`${label} is not an object.`);
    hasExactKeys(
      entry,
      ["id", "title", "items", "createdAt", "updatedAt"],
      label
    );
    const id = stringField(entry, "id", 128, { nonEmpty: true, id: true });
    if (listIds.has(id)) fail("shopping list IDs must be unique.");
    listIds.add(id);
    if (
      !Array.isArray(entry.items) ||
      entry.items.length > MAX_SHOPPING_ITEMS_PER_LIST
    ) {
      fail(
        `${label} items must be an array of at most ${MAX_SHOPPING_ITEMS_PER_LIST} items.`
      );
    }
    totalItems += entry.items.length;
    if (totalItems > MAX_SHOPPING_ITEMS_TOTAL) {
      fail(
        `shopping lists may contain at most ${MAX_SHOPPING_ITEMS_TOTAL} items in total.`
      );
    }
    const items = entry.items.map((rawItem, itemIndex) => {
      const itemLabel = `${label} item ${itemIndex + 1}`;
      if (!isRecord(rawItem)) fail(`${itemLabel} is not an object.`);
      hasExactKeys(
        rawItem,
        ["id", "text", "checked", "createdAt", "updatedAt"],
        itemLabel
      );
      const itemId = stringField(rawItem, "id", 128, {
        nonEmpty: true,
        id: true,
      });
      if (itemIds.has(itemId)) fail("shopping item IDs must be unique.");
      itemIds.add(itemId);
      return {
        id: itemId,
        text: stringField(rawItem, "text", 300, { nonEmpty: true }),
        checked: booleanField(rawItem, "checked"),
        createdAt: instantField(rawItem, "createdAt"),
        updatedAt: instantField(rawItem, "updatedAt"),
      };
    });
    return {
      id,
      title: stringField(entry, "title", 120, { nonEmpty: true }),
      items,
      createdAt: instantField(entry, "createdAt"),
      updatedAt: instantField(entry, "updatedAt"),
    };
  });
}

function peopleField(value: unknown): WorkspaceContact[] {
  if (!Array.isArray(value) || value.length > MAX_PEOPLE) {
    fail(`people must be an array of at most ${MAX_PEOPLE} entries.`);
  }
  const ids = new Set<string>();
  return value.map((rawPerson, index) => {
    const label = `person ${index + 1}`;
    if (!isRecord(rawPerson)) fail(`${label} is not an object.`);
    const hasBirthday = Object.prototype.hasOwnProperty.call(
      rawPerson,
      "birthdayMonthDay"
    );
    hasExactKeys(
      rawPerson,
      hasBirthday
        ? [
            "id",
            "name",
            "relationship",
            "context",
            "lastContactDate",
            "nextContactDate",
            "birthdayMonthDay",
            "status",
            "createdAt",
            "updatedAt",
          ]
        : [
        "id",
        "name",
        "relationship",
        "context",
        "lastContactDate",
        "nextContactDate",
        "status",
        "createdAt",
        "updatedAt",
          ],
      label
    );
    const id = stringField(rawPerson, "id", 128, { nonEmpty: true, id: true });
    if (ids.has(id)) fail("people record IDs must be unique.");
    ids.add(id);
    const lastContactDate =
      rawPerson.lastContactDate === null
        ? null
        : stringField(rawPerson, "lastContactDate", 10, { nonEmpty: true });
    const nextContactDate =
      rawPerson.nextContactDate === null
        ? null
        : stringField(rawPerson, "nextContactDate", 10, { nonEmpty: true });
    if (lastContactDate !== null && !isDate(lastContactDate)) {
      fail(`${label} last contact date is invalid.`);
    }
    if (nextContactDate !== null && !isDate(nextContactDate)) {
      fail(`${label} next contact date is invalid.`);
    }
    const birthdayMonthDay = hasBirthday
      ? nullableStringField(rawPerson, "birthdayMonthDay", 5)
      : undefined;
    if (
      birthdayMonthDay !== undefined &&
      birthdayMonthDay !== null &&
      (!/^\d{2}-\d{2}$/.test(birthdayMonthDay) ||
        !isDate(`2000-${birthdayMonthDay}`))
    ) {
      fail(`${label} birthday must be a valid month and day (MM-DD).`);
    }
    return {
      id,
      name: stringField(rawPerson, "name", MAX_PERSON_NAME_LENGTH, {
        nonEmpty: true,
      }),
      relationship: stringField(
        rawPerson,
        "relationship",
        MAX_PERSON_RELATIONSHIP_LENGTH
      ),
      context: stringField(rawPerson, "context", MAX_PERSON_CONTEXT_LENGTH),
      lastContactDate,
      nextContactDate,
      ...(birthdayMonthDay !== undefined ? { birthdayMonthDay } : {}),
      status: enumField(rawPerson, "status", ["active", "archived"] as const),
      createdAt: instantField(rawPerson, "createdAt"),
      updatedAt: instantField(rawPerson, "updatedAt"),
    };
  });
}

function taskParentField(value: unknown, label: string): TaskParent {
  if (!isRecord(value)) fail(`${label} parent is not an object.`);
  hasExactKeys(value, ["id", "suggested"], `${label} parent`);
  return {
    id: stringField(value, "id", 128, { nonEmpty: true, id: true }),
    suggested: booleanField(value, "suggested"),
  };
}

function milestonesField(record: JsonRecord): Project["milestones"] {
  const value = record.milestones;
  if (!Array.isArray(value) || value.length > MAX_MILESTONES) {
    fail(`milestones must be an array of at most ${MAX_MILESTONES} entries.`);
  }
  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`milestone ${index + 1} is not an object.`);
    hasExactKeys(entry, ["id", "title", "done"], `milestone ${index + 1}`);
    const id = stringField(entry, "id", 128, { nonEmpty: true, id: true });
    if (ids.has(id)) fail("milestone IDs must be unique within a project.");
    ids.add(id);
    return {
      id,
      title: stringField(entry, "title", 1000, { nonEmpty: true }),
      done: booleanField(entry, "done"),
    };
  });
}

function progressField(record: JsonRecord): Project["progress"] {
  const value = record.progress;
  if (!Array.isArray(value) || value.length > MAX_PROGRESS_ITEMS) {
    fail(`progress must be an array of at most ${MAX_PROGRESS_ITEMS} entries.`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry))
      fail(`project progress ${index + 1} is not an object.`);
    hasExactKeys(entry, ["at", "text"], `project progress ${index + 1}`);
    return {
      at: instantField(entry, "at"),
      text: stringField(entry, "text", 4000, { nonEmpty: true }),
    };
  });
}

function validateProject(value: unknown, label: string): Project {
  if (!isRecord(value)) fail(`${label} is not an object.`);
  const projectShape = hasOneOfExactKeySets(
    value,
    [
      PROJECT_KEYS,
      [...PROJECT_KEYS, "schedule"],
      [...PROJECT_KEYS, "schedule", "compass"],
    ],
    label
  );
  return {
    id: stringField(value, "id", 128, { nonEmpty: true, id: true }),
    title: stringField(value, "title", 500, { nonEmpty: true }),
    purpose: stringField(value, "purpose", 4000),
    outcome: stringField(value, "outcome", 4000),
    role: enumField(value, "role", ROLES),
    pattern: enumField(value, "pattern", PATTERNS),
    status: enumField(value, "status", PROJECT_STATUSES),
    milestones: milestonesField(value),
    progress: progressField(value),
    createdAt: instantField(value, "createdAt"),
    updatedAt: instantField(value, "updatedAt"),
    schedule:
      projectShape >= 1
        ? projectScheduleField(value.schedule, label)
        : emptyProjectSchedule(),
    compass:
      projectShape === 2
        ? projectCompassField(value.compass, label)
        : emptyProjectCompass(),
  };
}

function assertFileSize(text: string): void {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) {
    fail(
      `file is larger than the ${MAX_FILE_BYTES / 1024 / 1024} MB import limit.`
    );
  }
}

function parseJsonValue(text: string): unknown {
  assertFileSize(text);
  try {
    return JSON.parse(text);
  } catch {
    fail("JSON is malformed.");
  }
}

function validateFocus(
  value: unknown,
  tasks: Task[],
  label: string
): FocusSession | null {
  if (value === null) return null;
  if (!isRecord(value)) fail(`${label} is not an object.`);
  const keySet = hasOneOfExactKeySets(
    value,
    [
      ["taskId", "remaining", "duration", "running", "updatedAt", "step"],
      [
        "taskId",
        "remaining",
        "duration",
        "running",
        "updatedAt",
        "step",
        "continueAfterDone",
      ],
    ],
    label
  );
  const taskId = stringField(value, "taskId", 128, {
    nonEmpty: true,
    id: true,
  });
  const duration = integerField(value, "duration", 1, 86400);
  const remaining = integerField(value, "remaining", 0, duration);
  const updatedAt = integerField(
    value,
    "updatedAt",
    0,
    Number.MAX_SAFE_INTEGER
  );
  const task = tasks.find(item => item.id === taskId);
  const continueAfterDone =
    keySet === 1 ? booleanField(value, "continueAfterDone") : false;
  if (!task || (task.state === "done" && !continueAfterDone)) {
    fail(`${label} refers to missing or completed work.`);
  }
  return {
    taskId,
    duration,
    remaining,
    updatedAt,
    running: booleanField(value, "running"),
    step: stringField(value, "step", 2000),
    ...(keySet === 1 ? { continueAfterDone } : {}),
  };
}

function defaultWeights(): MatrixWeights {
  return {
    "direction-timely": 1,
    "direction-sustained": 1,
    "support-timely": 1,
    "support-sustained": 1,
  };
}

function validateMatrixWeights(value: unknown): MatrixWeights {
  if (!isRecord(value)) fail("matrixWeights is not an object.");
  hasExactKeys(value, MATRIX_CELLS, "matrixWeights");
  const record = value;
  return {
    "direction-timely": integerField(record, "direction-timely", 1, 3),
    "direction-sustained": integerField(record, "direction-sustained", 1, 3),
    "support-timely": integerField(record, "support-timely", 1, 3),
    "support-sustained": integerField(record, "support-sustained", 1, 3),
  };
}

function validateIntention(
  value: unknown,
  tasks: Task[]
): DailyIntention | null {
  if (value === null) return null;
  if (!isRecord(value)) fail("intention is not an object.");
  hasExactKeys(value, ["date", "text", "taskId"], "intention");
  const date = stringField(value, "date", 10, { nonEmpty: true });
  if (!localDate(date)) fail("intention date must be a local YYYY-MM-DD date.");
  const taskId = nullableStringField(value, "taskId", 128, { id: true });
  if (taskId !== null && !tasks.some(task => task.id === taskId)) {
    fail("intention refers to a missing task.");
  }
  return { date, text: stringField(value, "text", 2000), taskId };
}

function validateTrial(value: unknown): Workspace["trial"] {
  if (!isRecord(value)) fail("trial is not an object.");
  hasExactKeys(value, ["startedAt", "lastExportAt", "lastReviewAt"], "trial");
  return {
    startedAt: instantField(value, "startedAt"),
    lastExportAt: nullableInstantField(value, "lastExportAt"),
    lastReviewAt: nullableInstantField(value, "lastReviewAt"),
  };
}

function assertUniqueAndAcyclic(tasks: Task[], existing: Task[]): void {
  const sourceIds = new Set<string>();
  for (const task of tasks) {
    if (sourceIds.has(task.id)) {
      fail(`task ID ${task.id} appears more than once in the import.`);
    }
    sourceIds.add(task.id);
  }
  const existingIds = new Set(existing.map(task => task.id));
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!sourceIds.has(dependency) && !existingIds.has(dependency)) {
        fail(`task ${task.id} refers to unknown dependency ${dependency}.`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(tasks.map(task => [task.id, task]));
  const visit = (id: string): void => {
    if (visiting.has(id)) fail("imported dependencies contain a cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)!.dependencies) {
      if (byId.has(dependency)) visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}

function workspaceFromV1(tasks: Task[], focus: FocusSession | null): Workspace {
  return validateV2Workspace({
    version: 2,
    tasks,
    projects: [],
    focus,
    intention: null,
    matrixWeights: defaultWeights(),
    trial: {
      startedAt: new Date().toISOString(),
      lastExportAt: null,
      lastReviewAt: null,
    },
  });
}

function validateV1Workspace(value: JsonRecord): Workspace {
  hasExactKeys(value, ["version", "tasks", "focus"], "saved workspace");
  if (value.version !== 1 || !Array.isArray(value.tasks)) {
    fail("saved workspace must contain version 1 and a bounded tasks array.");
  }
  if (value.tasks.length > MAX_IMPORT_TASKS) {
    fail(`saved workspace contains more than ${MAX_IMPORT_TASKS} tasks.`);
  }
  const tasks = value.tasks.map((task, index) =>
    validateTask(task, `saved task ${index + 1}`)
  );
  assertUniqueAndAcyclic(tasks, []);
  return workspaceFromV1(
    tasks,
    validateFocus(value.focus, tasks, "saved focus")
  );
}

const WORKSPACE_KEYS = [
  "version",
  "tasks",
  "projects",
  "focus",
  "intention",
  "matrixWeights",
  "trial",
] as const;
function nextThingField(
  value: unknown,
  tasks: Task[]
): Workspace["nextThing"] {
  if (value === null) return null;
  if (!isRecord(value)) {
    fail("nextThing must be an object or null.");
    return null;
  }
  const record: JsonRecord = value;
  hasExactKeys(record, ["taskId", "when", "date", "updatedAt"], "nextThing");
  const taskId = stringField(record, "taskId", 128, {
    nonEmpty: true,
    id: true,
  });
  if (!tasks.some(task => task.id === taskId))
    fail("nextThing refers to a missing task.");
  const date = stringField(record, "date", 10);
  if (!localDate(date)) fail("nextThing date must be a local YYYY-MM-DD date.");
  return {
    taskId,
    when: stringField(record, "when", 300),
    date,
    updatedAt: instantField(record, "updatedAt"),
  };
}
function validateV2Workspace(value: JsonRecord): Workspace {
  const optionalKeys = [
    "planning",
    "imperatives",
    "reviews",
    "goals",
    "places",
    "obligations",
    "evidence",
    "siteCards",
    "shoppingLists",
    "lists",
    "frontOfMind",
    "dailyLog",
    "linkCheckHolds",
    "hideAmountsFromAI",
    "assets",
    "people",
    "credentialRenewals",
    "invoiceSettings",
    "invoices",
    "nextThing",
  ] as const;
  const allowedKeys = new Set<string>([...WORKSPACE_KEYS, ...optionalKeys]);
  const hasKey = (key: string) =>
    Object.prototype.hasOwnProperty.call(value, key);
  if (
    Object.keys(value).some(key => !allowedKeys.has(key)) ||
    WORKSPACE_KEYS.some(key => !hasKey(key))
  ) {
    fail("saved workspace has unknown or missing fields.");
  }
  const hasPlanning = hasKey("planning");
  const hasImperatives = hasKey("imperatives");
  const hasReviews = hasKey("reviews");
  const hasGoals = hasKey("goals");
  const hasPlaces = hasKey("places");
  const hasObligations = hasKey("obligations");
  const hasEvidence = hasKey("evidence");
  const hasSiteCards = hasKey("siteCards");
  const hasShoppingLists = hasKey("shoppingLists");
  const hasLists = hasKey("lists");
  const hasFrontOfMind = hasKey("frontOfMind");
  const hasDailyLog = hasKey("dailyLog");
  const hasLinkCheckHolds = hasKey("linkCheckHolds");
  if (hasKey("hideAmountsFromAI") && typeof value.hideAmountsFromAI !== "boolean") {
    fail("hideAmountsFromAI must be true or false.");
  }
  const hasAssets = hasKey("assets");
  const hasPeople = hasKey("people");
  const hasCredentialRenewals = hasKey("credentialRenewals");
  const hasInvoiceSettings = hasKey("invoiceSettings");
  const hasInvoices = hasKey("invoices");
  const hasNextThing = hasKey("nextThing");
  if (
    (hasImperatives && !hasPlanning) ||
    (hasReviews && !hasImperatives) ||
    (hasGoals && !hasReviews) ||
    ((hasPlaces ||
      hasObligations ||
      hasEvidence ||
      hasSiteCards ||
      hasShoppingLists ||
      hasLists ||
      hasAssets) &&
      !hasGoals)
  ) {
    fail("saved workspace has inconsistent version 2 extension fields.");
  }
  if (
    value.version !== 2 ||
    !Array.isArray(value.tasks) ||
    !Array.isArray(value.projects)
  ) {
    fail(
      "saved workspace must contain version 2 with tasks and projects arrays."
    );
  }
  if (value.tasks.length > MAX_IMPORT_TASKS) {
    fail(`saved workspace contains more than ${MAX_IMPORT_TASKS} tasks.`);
  }
  if (value.projects.length > MAX_PROJECTS) {
    fail(`saved workspace contains more than ${MAX_PROJECTS} projects.`);
  }

  const tasks = value.tasks.map((task, index) =>
    validateTask(task, `saved task ${index + 1}`, true)
  );
  const projects = value.projects.map((project, index) =>
    validateProject(project, `saved project ${index + 1}`)
  );
  const imperatives = hasImperatives ? imperativesField(value.imperatives) : [];
  const goals = hasGoals ? goalsField(value.goals) : [];
  const obligations = hasObligations
    ? obligationsField(value.obligations, goals, imperatives)
    : [];
  const places = hasPlaces ? placesField(value.places) : undefined;
  const evidence = hasEvidence ? evidenceField(value.evidence) : undefined;
  const siteCards = hasSiteCards ? siteCardsField(value.siteCards) : undefined;
  // Lists replaced Shopping Lists (2026-11-14). Older saves still load: each
  // shopping list becomes a template, and any ticks become a run in progress.
  let lists: ListsStore | undefined;
  if (hasLists) {
    try {
      lists = validateLists(value.lists);
    } catch (error) {
      fail(error instanceof Error ? error.message : "lists is not valid.");
    }
  } else if (hasShoppingLists) {
    lists = listsFromShoppingLists(shoppingListsField(value.shoppingLists));
  }
  let frontOfMind: FrontOfMindStore | undefined;
  if (hasFrontOfMind) {
    try {
      frontOfMind = validateFrontOfMind(value.frontOfMind);
    } catch (error) {
      fail(error instanceof Error ? error.message : "frontOfMind is not valid.");
    }
  }
  const dailyLog = hasDailyLog ? dailyLogField(value.dailyLog) : undefined;
  const linkCheckHolds = hasLinkCheckHolds
    ? linkCheckHoldsField(value.linkCheckHolds)
    : undefined;
  const assets = hasAssets ? validateAssets(value.assets) : undefined;
  const people = hasPeople ? peopleField(value.people) : undefined;
  const nextThing = hasNextThing
    ? nextThingField(value.nextThing, tasks)
    : undefined;
  const credentialRenewals = hasCredentialRenewals
    ? credentialRenewalsField(value.credentialRenewals)
    : undefined;
  const invoiceSettings = hasInvoiceSettings
    ? invoiceSettingsField(value.invoiceSettings)
    : undefined;
  const invoices = hasInvoices ? invoicesField(value.invoices) : undefined;
  validateInvoiceSequence(invoiceSettings, invoices);
  assertUniqueAndAcyclic(tasks, []);

  const projectIds = new Set<string>();
  for (const project of projects) {
    if (projectIds.has(project.id)) {
      fail(`project ID ${project.id} appears more than once in the workspace.`);
    }
    projectIds.add(project.id);
  }
  for (const task of tasks) {
    if (task.projectId !== null && !projectIds.has(task.projectId)) {
      fail(`task ${task.id} refers to a missing project.`);
    }
  }

  // Front of Mind replaced the Ideas shelf (2026-11-14): ideas move over once.
  return pruneFrontOfMindLinks(moveIdeasToFrontOfMind(pruneListLinks(pruneAssetLinks(
    prunePlaceLinks(
      pruneGoalLinks(
        pruneImperativeLinks({
          version: 2,
          tasks,
          projects,
          focus: validateFocus(value.focus, tasks, "saved focus"),
          intention: validateIntention(value.intention, tasks),
          ...(nextThing !== undefined ? { nextThing } : {}),
          matrixWeights: validateMatrixWeights(value.matrixWeights),
          trial: validateTrial(value.trial),
          planning: hasPlanning
            ? planningField(value.planning)
            : { ...DEFAULT_PLANNING },
          imperatives,
          reviews: hasReviews ? reviewsField(value.reviews) : [],
          goals,
          ...(places ? { places } : {}),
          ...(hasObligations ? { obligations } : {}),
          ...(evidence ? { evidence } : {}),
          ...(hasSiteCards ? { siteCards } : {}),
          ...(lists ? { lists } : {}),
          ...(frontOfMind ? { frontOfMind } : {}),
          ...(dailyLog ? { dailyLog } : {}),
          ...(linkCheckHolds ? { linkCheckHolds } : {}),
          ...(typeof value.hideAmountsFromAI === "boolean"
            ? { hideAmountsFromAI: value.hideAmountsFromAI }
            : {}),
          ...(hasAssets ? { assets } : {}),
          ...(hasPeople ? { people } : {}),
          ...(hasCredentialRenewals ? { credentialRenewals } : {}),
          ...(hasInvoiceSettings ? { invoiceSettings } : {}),
          ...(hasInvoices ? { invoices } : {}),
        })
      )
    )
  ))));
}

/**
 * Validate persisted identities without import ID remapping.  Version 1 values
 * are returned as a safe version 2 workspace; every v1 task ID and recognised
 * value is retained.
 */
export function validateWorkspace(value: unknown): Workspace {
  if (!isRecord(value)) fail("saved workspace is not an object.");
  if (value.version === 1) return validateV1Workspace(value);
  if (value.version === 2) return validateV2Workspace(value);
  fail("saved workspace has an unsupported version.");
}

function parseTaskOnlyV1(value: JsonRecord): Task[] {
  hasExactKeys(value, ["version", "tasks"], "JSON root");
  if (value.version !== 1 || !Array.isArray(value.tasks)) {
    fail("JSON must contain version 1 and a tasks array.");
  }
  if (value.tasks.length > MAX_IMPORT_TASKS) {
    fail(`JSON contains more than ${MAX_IMPORT_TASKS} tasks.`);
  }
  const tasks = value.tasks.map((taskValue, index) =>
    validateTask(taskValue, `task ${index + 1}`)
  );
  assertUniqueAndAcyclic(tasks, []);
  return tasks;
}

/**
 * Parse a checked, complete workspace backup.  Task-only v1 JSON is accepted
 * for recovery by migrating it into a complete empty-project workspace.
 */
export function parseBackup(text: string): Workspace {
  const value = parseJsonValue(text);
  if (!isRecord(value)) fail("JSON root must be an object.");
  if (value.version === 1 && Object.keys(value).length === 2) {
    return workspaceFromV1(parseTaskOnlyV1(value), null);
  }
  return validateWorkspace(value);
}

function parseTaskImport(text: string): {
  tasks: Task[];
  projectIds: Set<string>;
} {
  const value = parseJsonValue(text);
  if (!isRecord(value)) fail("JSON root must be an object.");
  if (value.version === 2) {
    const workspace = validateWorkspace(value);
    return {
      tasks: workspace.tasks,
      projectIds: new Set(workspace.projects.map(project => project.id)),
    };
  }
  return { tasks: parseTaskOnlyV1(value), projectIds: new Set() };
}

function quoteCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Prefix formula-looking data with an apostrophe. We also prefix an initial
 * apostrophe, making the operation reversible on re-import while preventing a
 * spreadsheet from evaluating =, +, -, or @ values.
 */
function spreadsheetSafe(value: string): string {
  return /^[=+\-@']/.test(value) ? `'${value}` : value;
}

function unspreadsheetSafe(value: string): string {
  return value.startsWith("'") && /^[=+\-@']/.test(value.slice(1))
    ? value.slice(1)
    : value;
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0) fail("CSV contains a quote in an unquoted field.");
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      // Ignore blank physical lines, but never ignore an otherwise malformed row.
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) fail("CSV has an unclosed quoted field.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
  }
  return rows;
}

function csvBoolean(value: string, field: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  fail(`${field} must be true or false in CSV.`);
}

function csvInteger(
  value: string,
  field: string,
  nullable = false
): number | null {
  if (nullable && value === "") return null;
  if (!/^\d+$/.test(value)) fail(`${field} must be a whole number in CSV.`);
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) {
    fail(`${field} is outside the supported number range.`);
  }
  return numeric;
}

function parseCsv(text: string): Task[] {
  assertFileSize(text);
  const rows = csvRows(text);
  if (rows.length === 0) fail("CSV is empty.");
  const header = rows[0].map((cell, index) =>
    index === 0 ? cell.replace(/^\uFEFF/, "") : cell
  );
  const matches = (fields: readonly string[]) =>
    header.length === fields.length &&
    new Set(header).size === header.length &&
    header.every(field => fields.includes(field));
  const legacyColumns = matches(LEGACY_CSV_FIELDS);
  if (!matches(CSV_FIELDS) && !legacyColumns) {
    fail("CSV headers must be exactly the documented task export columns.");
  }
  if (rows.length - 1 > MAX_IMPORT_TASKS) {
    fail(`CSV contains more than ${MAX_IMPORT_TASKS} tasks.`);
  }

  const tasks = rows.slice(1).map((row, index) => {
    if (row.length !== header.length) {
      fail(`CSV row ${index + 2} has the wrong number of columns.`);
    }
    const cells = Object.fromEntries(
      header.map((field, column) => [field, unspreadsheetSafe(row[column])])
    );
    let dependencies: unknown;
    try {
      dependencies = JSON.parse(cells.dependencies);
    } catch {
      fail(`CSV row ${index + 2} has invalid dependencies JSON.`);
    }

    const raw: JsonRecord = {
      id: cells.id,
      title: cells.title,
      ...(legacyColumns
        ? {
            area: cells.area,
            important: csvBoolean(cells.important, "important"),
          }
        : {}),
      nextAction: cells.nextAction,
      notes: cells.notes,
      state: cells.state,
      pinned: csvBoolean(cells.pinned, "pinned"),
      deadline: cells.deadline === "" ? null : cells.deadline,
      startDate: cells.startDate === "" ? null : cells.startDate,
      reviewDate: cells.reviewDate === "" ? null : cells.reviewDate,
      deferredUntil: cells.deferredUntil === "" ? null : cells.deferredUntil,
      estimate: csvInteger(cells.estimate, "estimate"),
      context: cells.context,
      waitingFor: cells.waitingFor,
      dependencies,
      checklist: [],
      repeatDays: csvInteger(cells.repeatDays, "repeatDays", true),
      createdAt: cells.createdAt,
      updatedAt: cells.updatedAt,
      completedAt: cells.completedAt === "" ? null : cells.completedAt,
      history: [],
    };
    return validateTask(raw, `CSV task ${index + 1}`);
  });
  assertUniqueAndAcyclic(tasks, []);
  return tasks;
}

function newId(occupied: Set<string>): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const generated =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    if (!occupied.has(generated)) return generated;
  }
  fail("could not create a fresh import ID.");
}

/** JSON is task-only/lossless; CSV is intentionally small spreadsheet interchange. */
export function exportJSON(tasks: Task[]): string {
  // The stable task-only document remains version 1 so existing exported files
  // continue to import, while its task records retain every recognised v2 field.
  return JSON.stringify({ version: 1, tasks }, null, 2);
}

/** A complete v2 workspace backup preserves identities and every relationship. */
export function exportBackup(workspace: Workspace): string {
  return JSON.stringify(validateWorkspace(workspace), null, 2);
}

export function exportCSV(tasks: Task[]): string {
  const rows = tasks.map(task => {
    const values: Record<(typeof CSV_FIELDS)[number], string> = {
      id: task.id,
      title: task.title,
      nextAction: task.nextAction,
      notes: task.notes,
      state: task.state,
      pinned: String(task.pinned),
      deadline: task.deadline ?? "",
      startDate: task.startDate ?? "",
      reviewDate: task.reviewDate ?? "",
      deferredUntil: task.deferredUntil ?? "",
      estimate: String(task.estimate),
      context: task.context,
      waitingFor: task.waitingFor,
      repeatDays: task.repeatDays === null ? "" : String(task.repeatDays),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt ?? "",
      dependencies: JSON.stringify(task.dependencies),
    };
    return CSV_FIELDS.map(field =>
      quoteCsv(spreadsheetSafe(values[field]))
    ).join(",");
  });
  return [CSV_FIELDS.join(","), ...rows].join("\r\n");
}

/**
 * Validate the entire file first, then return only fresh additive tasks. IDs
 * are regenerated and internal prerequisite links are remapped; existing data
 * is never replaced or mutated. For a complete v2 backup imported as tasks,
 * project links are retained only when the target already has that project;
 * otherwise they are explicitly cleared because projects are not imported.
 */
export function importTasks(
  text: string,
  format: "json" | "csv",
  existing: Task[],
  projects: Project[] = []
): Task[] {
  const parsed =
    format === "json"
      ? parseTaskImport(text)
      : { tasks: parseCsv(text), projectIds: new Set<string>() };
  assertUniqueAndAcyclic(parsed.tasks, existing);

  const targetProjectIds = new Set(projects.map(project => project.id));
  const source = parsed.tasks.map(task => ({
    ...task,
    // A v2 backup carries projects, but additive task-only import intentionally
    // does not. Preserve a link only if its project already exists locally.
    projectId:
      task.projectId !== null && targetProjectIds.has(task.projectId)
        ? task.projectId
        : null,
    checklist: task.checklist.map(item => ({ ...item })),
    history: task.history.map(entry => ({ ...entry })),
  }));

  const occupied = new Set(existing.map(task => task.id));
  const idMap = new Map<string, string>();
  for (const sourceTask of source) {
    const id = newId(occupied);
    occupied.add(id);
    idMap.set(sourceTask.id, id);
  }

  return source.map(task => ({
    ...task,
    id: idMap.get(task.id)!,
    dependencies: task.dependencies.map(
      dependency => idMap.get(dependency) ?? dependency
    ),
  }));
}
