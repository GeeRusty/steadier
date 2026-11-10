/**
 * Weekly Reality Review and Floor Check (v2.3).
 *
 * A review is the owner's own record: what was checked, what was decided and
 * which Imperatives were held. Steadier only gathers the facts (missed
 * commitments, quiet Imperatives, unplaced steps) and writes down the answers.
 * Nothing here decides on the owner's behalf.
 */
import type { Task, Workspace } from "./types";
import {
  DECISION_OUTCOMES,
  imperativeViews,
  unplacedTasks,
  type DecisionOutcome,
} from "./compass";

export const REVIEW_DUE_DAYS = 7;
export const MAX_REVIEWS = 300;
const MAX_ACTION_CHECKS = 40;

export type MoneyAnswer = "ok" | "concern";
export type CapacityAnswer = "low" | "medium" | "high";
export type ActionAnswer = "done" | "not-yet" | "drop";

export interface FloorCheck {
  money: { answer: MoneyAnswer | null; note: string };
  /** One plain "is it done?" per unconfirmed commitment. */
  action: { taskId: string; title: string; answer: ActionAnswer }[];
  capacity: { answer: CapacityAnswer | null; note: string };
}

export interface ReviewDecision {
  kind: "task" | "project" | "imperative";
  id: string;
  title: string;
  outcome: DecisionOutcome;
  note: string;
}

export interface WeeklyReview {
  id: string;
  /** Adelaide local timestamp of completion. */
  at: string;
  /** Adelaide YYYY-MM-DD of the review day. */
  date: string;
  floor: FloorCheck;
  decisions: ReviewDecision[];
  /** Imperatives held active when the review was saved (id + title snapshot). */
  imperatives: { id: string; title: string }[];
  quietImperatives: { id: string; title: string; days: number }[];
  unplacedBefore: number;
  unplacedAfter: number;
  notes: string;
}

export function emptyFloor(): FloorCheck {
  return {
    money: { answer: null, note: "" },
    action: [],
    capacity: { answer: null, note: "" },
  };
}

// ---------------------------------------------------------------------------
// Facts the review gathers
// ---------------------------------------------------------------------------

/**
 * Unconfirmed commitments: open steps whose planned day or deadline has
 * passed, or that have been waiting on someone for more than a week. Each
 * gets one plain "is it done?" question.
 */
export function unconfirmedCommitments(tasks: Task[], today: string): Task[] {
  const weekAgo = shiftDate(today, -7);
  const due = tasks.filter(task => {
    if (task.state === "done" || task.state === "someday") return false;
    const planned = task.schedule.date;
    if (planned && planned < today) return true;
    if (task.deadline && task.deadline < today) return true;
    if (task.state === "waiting" && task.updatedAt.slice(0, 10) <= weekAgo)
      return true;
    return false;
  });
  const key = (t: Task) =>
    t.deadline ?? t.schedule.date ?? t.updatedAt.slice(0, 10);
  return due
    .sort((a, b) => key(a).localeCompare(key(b)))
    .slice(0, MAX_ACTION_CHECKS);
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000
  );
}

export interface ReviewStatus {
  lastReviewDate: string | null;
  daysSince: number | null;
  due: boolean;
  quiet: { id: string; title: string; days: number }[];
  unplaced: number;
  commitments: number;
}

/** Latest completed Weekly Review day, with the legacy trial timestamp as fallback. */
export function latestWeeklyReviewDate(
  source: Pick<Workspace, "reviews" | "trial">
): string | null {
  const last = (source.reviews ?? []).at(-1) ?? null;
  return last?.date ?? source.trial.lastReviewAt?.slice(0, 10) ?? null;
}

/** Whether a review is due, plus the drift signals that make it worth doing. */
export function reviewStatus(
  workspace: Workspace,
  today: string
): ReviewStatus {
  const lastDate = latestWeeklyReviewDate(workspace);
  const daysSince = lastDate ? Math.max(0, daysBetween(lastDate, today)) : null;
  const quiet = imperativeViews(workspace, today)
    .filter(v => v.quiet)
    .map(v => ({
      id: v.imperative.id,
      title: v.imperative.title,
      days: v.quietDays ?? 0,
    }));
  return {
    lastReviewDate: lastDate,
    daysSince,
    due:
      daysSince === null
        ? workspace.tasks.length > 0
        : daysSince >= REVIEW_DUE_DAYS,
    quiet,
    unplaced: unplacedTasks(workspace.tasks).length,
    commitments: unconfirmedCommitments(workspace.tasks, today).length,
  };
}

// ---------------------------------------------------------------------------
// Saving a review: record it, and apply only what the owner answered
// ---------------------------------------------------------------------------

/**
 * Record the review and apply the owner's own answers:
 * - Action "done" completes the step; "drop" moves it to Someday (never
 *   deleted); "not yet" leaves it as it is and notes it in history.
 * - Each decision is written to its item as the owner's confirmed decision.
 * - trial.lastReviewAt is filled.
 */
export function applyReview(
  workspace: Workspace,
  review: WeeklyReview,
  complete: (tasks: Task[], id: string) => Task[]
): Workspace {
  const stamp = review.at;
  let tasks = workspace.tasks;
  const note = (task: Task, text: string): Task => ({
    ...task,
    updatedAt: stamp,
    history: [...task.history, { at: stamp, text }],
  });
  for (const check of review.floor.action) {
    if (check.answer === "done") {
      tasks = complete(tasks, check.taskId).map(t =>
        t.id === check.taskId
          ? note(t, "Confirmed done in the Weekly Reality Review.")
          : t
      );
    } else if (check.answer === "drop") {
      tasks = tasks.map(t =>
        t.id === check.taskId
          ? note(
              { ...t, state: "someday" },
              "Dropped to Someday in the Weekly Reality Review (kept, not deleted)."
            )
          : t
      );
    } else {
      tasks = tasks.map(t =>
        t.id === check.taskId
          ? note(t, "Not done yet — checked in the Weekly Reality Review.")
          : t
      );
    }
  }
  const decision = (d: ReviewDecision) => ({
    outcome: d.outcome,
    at: stamp,
    by: "owner" as const,
    confirmed: true,
    note: d.note,
  });
  const byKind = (kind: ReviewDecision["kind"]) =>
    new Map(review.decisions.filter(d => d.kind === kind).map(d => [d.id, d]));
  const taskDecisions = byKind("task");
  const projectDecisions = byKind("project");
  const imperativeDecisions = byKind("imperative");
  tasks = tasks.map(t => {
    const d = taskDecisions.get(t.id);
    return d
      ? note(
          { ...t, compass: { ...t.compass, decision: decision(d) } },
          `Decision in review: ${d.outcome}.`
        )
      : t;
  });
  const projects = workspace.projects.map(p => {
    const d = projectDecisions.get(p.id);
    return d
      ? {
          ...p,
          compass: { ...p.compass, decision: decision(d) },
          updatedAt: stamp,
        }
      : p;
  });
  const imperatives = workspace.imperatives.map(i => {
    const d = imperativeDecisions.get(i.id);
    if (!d) return i;
    const retire = d.outcome === "retire";
    return {
      ...i,
      decision: decision(d),
      ...(retire ? { status: "retired" as const, retiredOn: review.date } : {}),
      updatedAt: stamp,
      history: [
        ...i.history,
        {
          at: stamp,
          text: `Weekly Reality Review: ${d.outcome}${d.note ? ` — ${d.note}` : ""}.`,
        },
      ],
    };
  });
  return {
    ...workspace,
    tasks,
    projects,
    imperatives,
    reviews: [...(workspace.reviews ?? []), review].slice(-MAX_REVIEWS),
    trial: { ...workspace.trial, lastReviewAt: stamp },
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;
function fail(message: string): never {
  throw new Error(`Could not import tasks: ${message}`);
}
function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function exact(v: Rec, keys: readonly string[], label: string) {
  const actual = Object.keys(v);
  if (
    actual.length !== keys.length ||
    !keys.every(k => Object.prototype.hasOwnProperty.call(v, k))
  ) {
    fail(`${label} has unknown or missing fields.`);
  }
}
function str(v: unknown, label: string, max: number): string {
  if (typeof v !== "string" || v.length > max)
    fail(`${label} must be text up to ${max} characters.`);
  return v;
}
function oneOf<T extends string>(
  v: unknown,
  options: readonly T[],
  label: string,
  nullable = false
): T | null {
  if (v === null && nullable) return null;
  if (typeof v !== "string" || !options.includes(v as T))
    fail(`${label} is not recognised.`);
  return v as T;
}
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
function id(v: unknown, label: string): string {
  if (typeof v !== "string" || !ID.test(v)) fail(`${label} is not a valid id.`);
  return v;
}

export function reviewsField(value: unknown): WeeklyReview[] {
  if (!Array.isArray(value) || value.length > MAX_REVIEWS)
    fail(`reviews must be a list of at most ${MAX_REVIEWS}.`);
  return value.map((r, n) => {
    const label = `review ${n + 1}`;
    if (!isRec(r)) fail(`${label} is not an object.`);
    exact(
      r,
      [
        "id",
        "at",
        "date",
        "floor",
        "decisions",
        "imperatives",
        "quietImperatives",
        "unplacedBefore",
        "unplacedAfter",
        "notes",
      ],
      label
    );
    const f = r.floor;
    if (!isRec(f)) fail(`${label} floor check is not an object.`);
    exact(f, ["money", "action", "capacity"], `${label} floor check`);
    const money = f.money,
      capacity = f.capacity;
    if (
      !isRec(money) ||
      !isRec(capacity) ||
      !Array.isArray(f.action) ||
      f.action.length > MAX_ACTION_CHECKS
    ) {
      fail(`${label} floor check is malformed.`);
    }
    exact(money, ["answer", "note"], `${label} money`);
    exact(capacity, ["answer", "note"], `${label} capacity`);
    if (typeof r.at !== "string" || Number.isNaN(Date.parse(r.at)))
      fail(`${label} time is invalid.`);
    if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date))
      fail(`${label} date is invalid.`);
    if (!Array.isArray(r.decisions) || r.decisions.length > 100)
      fail(`${label} decisions must be a list.`);
    if (!Array.isArray(r.imperatives) || r.imperatives.length > 200)
      fail(`${label} imperatives must be a list.`);
    if (!Array.isArray(r.quietImperatives) || r.quietImperatives.length > 200)
      fail(`${label} quiet list must be a list.`);
    const count = (v: unknown, l: string) => {
      if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 100000)
        fail(`${l} must be a whole number.`);
      return v as number;
    };
    return {
      id: id(r.id, `${label} id`),
      at: r.at,
      date: r.date,
      floor: {
        money: {
          answer: oneOf(
            money.answer,
            ["ok", "concern"] as const,
            `${label} money answer`,
            true
          ),
          note: str(money.note, `${label} money note`, 2000),
        },
        action: f.action.map((a, i) => {
          if (!isRec(a)) fail(`${label} action ${i + 1} is not an object.`);
          exact(a, ["taskId", "title", "answer"], `${label} action ${i + 1}`);
          return {
            taskId: id(a.taskId, `${label} action task`),
            title: str(a.title, `${label} action title`, 500),
            answer: oneOf(
              a.answer,
              ["done", "not-yet", "drop"] as const,
              `${label} action answer`
            )!,
          };
        }),
        capacity: {
          answer: oneOf(
            capacity.answer,
            ["low", "medium", "high"] as const,
            `${label} capacity answer`,
            true
          ),
          note: str(capacity.note, `${label} capacity note`, 2000),
        },
      },
      decisions: r.decisions.map((d, i) => {
        if (!isRec(d)) fail(`${label} decision ${i + 1} is not an object.`);
        exact(
          d,
          ["kind", "id", "title", "outcome", "note"],
          `${label} decision ${i + 1}`
        );
        return {
          kind: oneOf(
            d.kind,
            ["task", "project", "imperative"] as const,
            `${label} decision kind`
          )!,
          id: id(d.id, `${label} decision id`),
          title: str(d.title, `${label} decision title`, 500),
          outcome: oneOf(
            d.outcome,
            DECISION_OUTCOMES,
            `${label} decision outcome`
          )!,
          note: str(d.note, `${label} decision note`, 1000),
        };
      }),
      imperatives: r.imperatives.map((x, i) => {
        if (!isRec(x)) fail(`${label} imperative ${i + 1} is not an object.`);
        exact(x, ["id", "title"], `${label} imperative ${i + 1}`);
        return {
          id: id(x.id, `${label} imperative id`),
          title: str(x.title, `${label} imperative title`, 300),
        };
      }),
      quietImperatives: r.quietImperatives.map((x, i) => {
        if (!isRec(x)) fail(`${label} quiet ${i + 1} is not an object.`);
        exact(x, ["id", "title", "days"], `${label} quiet ${i + 1}`);
        return {
          id: id(x.id, `${label} quiet id`),
          title: str(x.title, `${label} quiet title`, 300),
          days: count(x.days, `${label} quiet days`),
        };
      }),
      unplacedBefore: count(r.unplacedBefore, `${label} unplacedBefore`),
      unplacedAfter: count(r.unplacedAfter, `${label} unplacedAfter`),
      notes: str(r.notes, `${label} notes`, 8000),
    };
  });
}

/** Plain-language summary, used on screen, read aloud and by Claude. */
export function describeReview(r: WeeklyReview): string {
  const money =
    r.floor.money.answer === "ok"
      ? "Money OK"
      : r.floor.money.answer === "concern"
        ? "Money: concern"
        : "Money not answered";
  const cap = r.floor.capacity.answer
    ? `capacity ${r.floor.capacity.answer}`
    : "capacity not answered";
  const done = r.floor.action.filter(a => a.answer === "done").length;
  const dropped = r.floor.action.filter(a => a.answer === "drop").length;
  const notYet = r.floor.action.filter(a => a.answer === "not-yet").length;
  const actions = r.floor.action.length
    ? `${r.floor.action.length} commitments checked (${done} done, ${notYet} not yet, ${dropped} dropped)`
    : "no open commitments to check";
  return `${r.date}: ${money}; ${actions}; ${cap}. ${r.imperatives.length} Imperatives held, ${r.decisions.length} decisions recorded. Unplaced ${r.unplacedBefore} → ${r.unplacedAfter}.`;
}
