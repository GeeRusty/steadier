/**
 * Compass layer (v2.2): Imperatives, catch-all placement, decision outcomes
 * and Notion links. Every field is optional on older saves and defaults to
 * "nothing set". Nothing here ever decides for the owner: a decision or
 * placement made by anyone other than the owner stays `confirmed: false`
 * until the owner confirms it.
 */
import type { Project, Task, Workspace } from "./types";

export const MAX_ACTIVE_IMPERATIVES = 8;
export const QUIET_DAYS = 7;

export const DECISION_OUTCOMES = [
  "promote",
  "sustain",
  "delegate",
  "retire",
] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];
export const DECISION_LABEL: Record<DecisionOutcome, string> = {
  promote: "Promote",
  sustain: "Sustain",
  delegate: "Delegate or minimise",
  retire: "Retire",
};

export const CATCH_ALLS = ["life-admin", "erosion-guard"] as const;
export type CatchAll = (typeof CATCH_ALLS)[number];
export const CATCH_ALL_LABEL: Record<CatchAll, string> = {
  "life-admin": "Life Admin",
  "erosion-guard": "Erosion Guard",
};

export type DecidedBy =
  | "owner"
  | "claude"
  | "chatgpt"
  | "connector"
  | "steadier";

export interface Decision {
  outcome: DecisionOutcome;
  /** Adelaide local timestamp. */
  at: string;
  by: DecidedBy;
  /** Only the owner's own choice, or the owner tapping Confirm, sets this. */
  confirmed: boolean;
  note: string;
}

export interface TaskCompass {
  imperativeIds: string[];
  catchAll: CatchAll | null;
  /** False when the catch-all was suggested, not chosen. */
  catchAllConfirmed: boolean;
  decision: Decision | null;
  /** True while a connector-made project link awaits the owner's Confirm. */
  projectSuggested: boolean;
  /** True while connector-made Imperative links await the owner's Confirm. */
  imperativesSuggested: boolean;
  /** When the task was filed in its catch-all (for the Life Admin 14-day watch). */
  catchAllSince: string | null;
}

export interface ProjectCompass {
  /** False while suggested role/pattern values await the owner's Confirm. */
  labelsConfirmed: boolean;
  imperativeIds: string[];
  decision: Decision | null;
  notionUrl: string | null;
}

export interface Imperative {
  id: string;
  title: string;
  reason: string;
  status: "active" | "retired";
  /** YYYY-MM-DD the owner set it, normally in a Weekly Reality Review. */
  setOn: string;
  retiredOn: string | null;
  notionUrl: string | null;
  decision: Decision | null;
  history: { at: string; text: string }[];
  createdAt: string;
  updatedAt: string;
  /**
   * Optional direct links to Compass map items (Pillar, Value Goal or Goal
   * Outcome ids), set only by the owner. Absent on Imperatives that were never
   * linked, so existing records stay exactly as they were.
   */
  mapLinks?: string[];
}

export function emptyTaskCompass(): TaskCompass {
  return {
    imperativeIds: [],
    catchAll: null,
    catchAllConfirmed: false,
    decision: null,
    projectSuggested: false,
    imperativesSuggested: false,
    catchAllSince: null,
  };
}
export function emptyProjectCompass(): ProjectCompass {
  return {
    labelsConfirmed: true,
    imperativeIds: [],
    decision: null,
    notionUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Notion links
// ---------------------------------------------------------------------------

/** Accept only https links to notion.so / notion.site (and their subdomains). */
export function normaliseNotionUrl(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const ok =
    url.protocol === "https:" &&
    (host === "notion.so" ||
      host.endsWith(".notion.so") ||
      host === "notion.site" ||
      host.endsWith(".notion.site"));
  if (!ok || url.username || url.password || text.length > 2000) return null;
  return url.toString();
}

// ---------------------------------------------------------------------------
// Validation (used by transfer.ts and the server's strict parser)
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;
function fail(message: string): never {
  throw new Error(`Could not import tasks: ${message}`);
}
function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Rec, keys: readonly string[], label: string) {
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    !keys.every(k => Object.prototype.hasOwnProperty.call(value, k))
  ) {
    fail(`${label} has unknown or missing fields.`);
  }
}
function text(
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
      `${label} must be ${nonEmpty ? "a non-empty" : "a"} string up to ${max} characters.`
    );
  }
  return value;
}
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
function idList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 20)
    fail(`${label} must be a list of at most 20 ids.`);
  const ids = value.map(v => {
    if (typeof v !== "string" || !ID.test(v))
      fail(`${label} contains an invalid id.`);
    return v;
  });
  return Array.from(new Set(ids));
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function date(value: unknown, label: string, nullable: boolean): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || !DATE.test(value))
    fail(`${label} must be a YYYY-MM-DD date.`);
  return value;
}
function stamp(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length > 100 ||
    Number.isNaN(Date.parse(value))
  ) {
    fail(`${label} must be a valid timestamp.`);
  }
  return value;
}
function notion(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string")
    fail(`${label} must be a Notion link or null.`);
  const url = normaliseNotionUrl(value);
  if (!url) fail(`${label} must be an https notion.so or notion.site link.`);
  return url;
}

export function decisionField(value: unknown, label: string): Decision | null {
  if (value === null) return null;
  if (!isRec(value)) fail(`${label} decision must be an object or null.`);
  exactKeys(
    value,
    ["outcome", "at", "by", "confirmed", "note"],
    `${label} decision`
  );
  if (!DECISION_OUTCOMES.includes(value.outcome as DecisionOutcome))
    fail(`${label} decision outcome is not recognised.`);
  if (
    !["owner", "claude", "chatgpt", "connector", "steadier"].includes(
      value.by as string
    )
  )
    fail(`${label} decision "by" is not recognised.`);
  if (typeof value.confirmed !== "boolean")
    fail(`${label} decision confirmed must be true or false.`);
  return {
    outcome: value.outcome as DecisionOutcome,
    at: stamp(value.at, `${label} decision time`),
    by: value.by as DecidedBy,
    confirmed: value.confirmed,
    note: text(value.note, `${label} decision note`, 1000),
  };
}

export function taskCompassField(value: unknown, label: string): TaskCompass {
  if (!isRec(value)) fail(`${label} compass is not an object.`);
  // The three orphan-protection fields are optional so older records load
  // unchanged (they read as "not suggested" and "filed time unknown").
  const required = [
    "imperativeIds",
    "catchAll",
    "catchAllConfirmed",
    "decision",
  ];
  const optional = [
    "projectSuggested",
    "imperativesSuggested",
    "catchAllSince",
  ];
  const keys = Object.keys(value);
  if (
    !required.every(k => Object.prototype.hasOwnProperty.call(value, k)) ||
    keys.some(k => !required.includes(k) && !optional.includes(k))
  ) {
    fail(`${label} compass has unknown or missing fields.`);
  }
  for (const k of ["projectSuggested", "imperativesSuggested"])
    if (value[k] !== undefined && typeof value[k] !== "boolean")
      fail(`${label} ${k} must be true or false.`);
  if (
    value.catchAll !== null &&
    !CATCH_ALLS.includes(value.catchAll as CatchAll)
  ) {
    fail(`${label} catch-all must be life-admin, erosion-guard or null.`);
  }
  if (typeof value.catchAllConfirmed !== "boolean")
    fail(`${label} catchAllConfirmed must be true or false.`);
  return {
    imperativeIds: idList(value.imperativeIds, `${label} imperativeIds`),
    catchAll: (value.catchAll as CatchAll | null) ?? null,
    catchAllConfirmed:
      value.catchAll === null ? false : value.catchAllConfirmed,
    decision: decisionField(value.decision, label),
    projectSuggested: value.projectSuggested === true,
    imperativesSuggested: value.imperativesSuggested === true,
    catchAllSince:
      value.catchAll === null ||
      value.catchAllSince === undefined ||
      value.catchAllSince === null
        ? null
        : stamp(value.catchAllSince, `${label} catchAllSince`),
  };
}

export function projectCompassField(
  value: unknown,
  label: string
): ProjectCompass {
  if (!isRec(value)) fail(`${label} compass is not an object.`);
  exactKeys(
    value,
    ["labelsConfirmed", "imperativeIds", "decision", "notionUrl"],
    `${label} compass`
  );
  if (typeof value.labelsConfirmed !== "boolean")
    fail(`${label} labelsConfirmed must be true or false.`);
  return {
    labelsConfirmed: value.labelsConfirmed,
    imperativeIds: idList(value.imperativeIds, `${label} imperativeIds`),
    decision: decisionField(value.decision, label),
    notionUrl: notion(value.notionUrl, `${label} Notion link`),
  };
}

const IMPERATIVE_KEYS = [
  "id",
  "title",
  "reason",
  "status",
  "setOn",
  "retiredOn",
  "notionUrl",
  "decision",
  "history",
  "createdAt",
  "updatedAt",
] as const;

export function imperativesField(value: unknown): Imperative[] {
  if (!Array.isArray(value) || value.length > 200)
    fail("imperatives must be a list of at most 200.");
  const seen = new Set<string>();
  return value.map((item, index) => {
    const label = `imperative ${index + 1}`;
    if (!isRec(item)) fail(`${label} is not an object.`);
    const hasMapLinks = Object.prototype.hasOwnProperty.call(item, "mapLinks");
    exactKeys(
      item,
      hasMapLinks ? [...IMPERATIVE_KEYS, "mapLinks"] : IMPERATIVE_KEYS,
      label
    );
    let mapLinks: string[] | undefined;
    if (hasMapLinks) {
      if (!Array.isArray(item.mapLinks) || item.mapLinks.length > 60)
        fail(`${label} map links must be a list of at most 60.`);
      mapLinks = [];
      for (const raw of item.mapLinks) {
        const linkId = text(raw, `${label} map link`, 128, true);
        if (!ID.test(linkId)) fail(`${label} map link is not a valid ID.`);
        if (!mapLinks.includes(linkId)) mapLinks.push(linkId);
      }
    }
    const id = text(item.id, `${label} id`, 128, true);
    if (!ID.test(id)) fail(`${label} id is not a valid portable ID.`);
    if (seen.has(id)) fail(`imperative ID ${id} appears more than once.`);
    seen.add(id);
    if (item.status !== "active" && item.status !== "retired")
      fail(`${label} status must be active or retired.`);
    if (!Array.isArray(item.history) || item.history.length > 500)
      fail(`${label} history must be a list.`);
    return {
      id,
      title: text(item.title, `${label} title`, 300, true),
      reason: text(item.reason, `${label} reason`, 2000),
      status: item.status,
      setOn: date(item.setOn, `${label} setOn`, false)!,
      retiredOn: date(item.retiredOn, `${label} retiredOn`, true),
      notionUrl: notion(item.notionUrl, `${label} Notion link`),
      decision: decisionField(item.decision, label),
      history: item.history.map((h, i) => {
        if (!isRec(h)) fail(`${label} history ${i + 1} is not an object.`);
        exactKeys(h, ["at", "text"], `${label} history ${i + 1}`);
        return {
          at: stamp(h.at, `${label} history time`),
          text: text(h.text, `${label} history text`, 2000),
        };
      }),
      createdAt: stamp(item.createdAt, `${label} createdAt`),
      updatedAt: stamp(item.updatedAt, `${label} updatedAt`),
      ...(mapLinks ? { mapLinks } : {}),
    };
  });
}

/** Drop links to Imperatives that no longer exist instead of rejecting the save. */
export function pruneImperativeLinks(workspace: Workspace): Workspace {
  const ids = new Set(workspace.imperatives.map(i => i.id));
  const clean = (list: string[]) => list.filter(id => ids.has(id));
  const changed =
    workspace.tasks.some(t =>
      t.compass.imperativeIds.some(id => !ids.has(id))
    ) ||
    workspace.projects.some(p =>
      p.compass.imperativeIds.some(id => !ids.has(id))
    );
  if (!changed) return workspace;
  return {
    ...workspace,
    tasks: workspace.tasks.map(t => ({
      ...t,
      compass: { ...t.compass, imperativeIds: clean(t.compass.imperativeIds) },
    })),
    projects: workspace.projects.map(p => ({
      ...p,
      compass: { ...p.compass, imperativeIds: clean(p.compass.imperativeIds) },
    })),
  };
}

// ---------------------------------------------------------------------------
// Orphan protection and drift signals (flag, never block)
// ---------------------------------------------------------------------------

/**
 * True when an open task has no confirmed home. A home is a project, an
 * Imperative, catch-all, or an active obligation link; one that was only
 * suggested (by Steadier or any connector) does not count until confirmed.
 */
/** The task has its own confirmed home (project, Imperative, catch-all or obligation). */
export function hasOwnPlacement(task: Task): boolean {
  const c = task.compass;
  const project = task.projectId !== null && !c.projectSuggested;
  const imperative = c.imperativeIds.length > 0 && !c.imperativesSuggested;
  const catchAll = c.catchAll !== null && c.catchAllConfirmed;
  const obligation = Boolean(task.obligation?.link.id);
  return project || imperative || catchAll || obligation;
}
/**
 * Open and without a confirmed home. With the task list supplied, a subtask
 * under a confirmed parent is placed through that parent (at any depth).
 * A suggested parent does not count until the owner confirms it.
 */
export function isUnplaced(task: Task, all?: Task[]): boolean {
  if (task.state === "done") return false;
  if (hasOwnPlacement(task)) return false;
  if (all && task.parent && !task.parent.suggested) {
    const seen = new Set([task.id]);
    let current: Task = task;
    for (
      let i = 0;
      i < 16 && current.parent && !current.parent.suggested;
      i++
    ) {
      const parentId: string = current.parent.id;
      const parent = all.find(t => t.id === parentId);
      if (!parent || seen.has(parent.id)) break;
      if (hasOwnPlacement(parent)) return false;
      seen.add(parent.id);
      current = parent;
    }
  }
  return true;
}
/** A home that is waiting for the owner's Confirm, if any. */
export function pendingPlacement(task: Task): string | null {
  const c = task.compass;
  if (task.projectId !== null && c.projectSuggested) return "project";
  if (c.imperativeIds.length > 0 && c.imperativesSuggested) return "imperative";
  if (c.catchAll !== null && !c.catchAllConfirmed) return "catch-all";
  if (task.parent?.suggested) return "parent";
  return null;
}
/** The owner accepts every suggested home on this task. */
export function confirmPlacement(task: Task): Task {
  const c = task.compass;
  return {
    ...task,
    compass: {
      ...c,
      projectSuggested: false,
      imperativesSuggested: false,
      catchAllConfirmed: c.catchAll !== null,
    },
    ...(task.parent
      ? { parent: { id: task.parent.id, suggested: false } }
      : {}),
  };
}
export function unplacedTasks(tasks: Task[]): Task[] {
  return tasks.filter(t => isUnplaced(t, tasks));
}

/**
 * Suggest a catch-all from the task's own labels (Support + Timely = Life
 * Admin, Support + Sustained = Erosion Guard). Returns null for Direction or
 * unlabelled tasks: those belong under an Imperative or project, which only
 * the owner can choose.
 */
export function suggestCatchAll(task: Task): CatchAll | null {
  if (task.role !== "support") return null;
  if (task.pattern === "timely") return "life-admin";
  if (task.pattern === "sustained") return "erosion-guard";
  return null;
}

function dayOf(stampText: string): string {
  return stampText.slice(0, 10);
}
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000
  );
}

export interface ImperativeView {
  imperative: Imperative;
  tasks: Task[];
  projects: Project[];
  openTasks: number;
  /** Last day anything linked moved (task done, updated, time logged). */
  lastMovement: string | null;
  quietDays: number | null;
  quiet: boolean;
}

/** Linked work and drift for each Imperative. An Imperative with no project is normal. */
export function imperativeViews(
  workspace: Workspace,
  today: string
): ImperativeView[] {
  return workspace.imperatives.map(imperative => {
    const projects = workspace.projects.filter(p =>
      p.compass.imperativeIds.includes(imperative.id)
    );
    const projectIds = new Set(projects.map(p => p.id));
    const tasks = workspace.tasks.filter(
      t =>
        t.compass.imperativeIds.includes(imperative.id) ||
        (t.projectId !== null && projectIds.has(t.projectId))
    );
    const days: string[] = [dayOf(imperative.updatedAt)];
    for (const t of tasks) {
      if (t.completedAt) days.push(dayOf(t.completedAt));
      days.push(dayOf(t.updatedAt));
      for (const e of t.schedule.timeLog) days.push(e.start.slice(0, 10));
    }
    for (const p of projects)
      for (const e of p.progress) days.push(dayOf(e.at));
    const lastMovement =
      days
        .filter(d => DATE.test(d))
        .sort()
        .at(-1) ?? null;
    const quietDays = lastMovement
      ? Math.max(0, daysBetween(lastMovement, today))
      : null;
    return {
      imperative,
      tasks,
      projects,
      openTasks: tasks.filter(t => t.state !== "done").length,
      lastMovement,
      quietDays,
      quiet:
        imperative.status === "active" &&
        quietDays !== null &&
        quietDays >= QUIET_DAYS,
    };
  });
}

export function activeImperatives(workspace: Workspace): Imperative[] {
  return workspace.imperatives.filter(i => i.status === "active");
}

export function describeDecision(decision: Decision | null): string {
  if (!decision) return "";
  const who =
    decision.by === "owner"
      ? ""
      : decision.by === "claude"
        ? " (suggested by Claude)"
        : decision.by === "chatgpt"
          ? " (suggested by ChatGPT)"
          : decision.by === "connector"
            ? " (suggested by MCP connector)"
            : decision.by === "steadier"
              ? " (suggested by Steadier)"
              : " (suggested)";
  return `${DECISION_LABEL[decision.outcome]}${decision.confirmed ? "" : who || " (suggested)"}`;
}
