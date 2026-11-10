/**
 * Pillar strip (v3.0): up to eight Pillar slots shown as a row.
 *
 * Health is a gentle read of the saved map, never a score and never a block:
 *  - green: a Value Goal → Goal Outcome → confirmed project chain is in place,
 *    no gaps, and something moved in the last 14 days;
 *  - amber: a gap in the chain, a suggested link waiting, or 14–29 quiet days;
 *  - red: 30+ quiet days under a chain that exists, or open work past its
 *    deadline under this Pillar;
 *  - empty: a free slot (dashed).
 * Suggested (unconfirmed) links never count as a chain or as movement.
 */
import { daysUntil } from "./engine";
import {
  STALLED_OUTCOME_DAYS,
  goalsAt,
  mapGaps,
  outcomeLastMovement,
  type Goal,
} from "./goals";
import { descendants } from "./mapPages";
import type { Workspace } from "./types";

export const PILLAR_SLOTS = 8;
export const PILLAR_RED_DAYS = 30;

export type PillarHealth = "green" | "amber" | "red";

export interface PillarSlot {
  kind: "pillar";
  goal: Goal;
  health: PillarHealth;
  /** Plain-language reasons, most important first. Empty when green. */
  reasons: string[];
  /** Days since anything moved under it; null when nothing ever has. */
  quietDays: number | null;
}
export interface EmptySlot {
  kind: "empty";
}
export type StripSlot = PillarSlot | EmptySlot;

export interface PillarStrip {
  /** Always PILLAR_SLOTS long: pillars first, then empty slots. */
  slots: StripSlot[];
  /** Pillars beyond the eighth; never hidden, reached through the map. */
  overflow: PillarSlot[];
  counts: Record<PillarHealth, number>;
}

function dayOf(stamp: string): string {
  return stamp.slice(0, 10);
}
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000
  );
}

/** One Pillar's health, from the saved map only. */
export function pillarHealth(
  w: Workspace,
  pillar: Goal,
  today: string,
  allGaps = mapGaps(w, today)
): PillarSlot {
  const below = descendants(w, pillar.id);
  const ids = new Set(below.map(g => g.id));
  const outcomes = below.filter(g => g.level === "outcome");
  const valueGoals = below.filter(g => g.level === "value-goal");
  const activeProjects = new Set(
    w.projects.filter(p => p.status === "active").map(p => p.id)
  );

  // Only confirmed links count toward the chain and movement.
  const confirmed = outcomes.map(o => ({
    ...o,
    projects: o.projects.filter(l => l.confirmed && activeProjects.has(l.id)),
  }));
  const withChain = confirmed.filter(o => o.projects.length > 0);

  let last: string | null = null;
  for (const o of withChain) {
    const m = outcomeLastMovement(w, o);
    if (m && (!last || m > last)) last = m;
  }
  const quietDays = last ? daysBetween(last, today) : null;
  const sinceCreated = daysBetween(dayOf(pillar.createdAt), today);

  const projectIds = new Set(withChain.flatMap(o => o.projects.map(l => l.id)));
  const overdue = w.tasks.filter(
    t =>
      t.state !== "done" &&
      t.projectId !== null &&
      projectIds.has(t.projectId) &&
      !!t.deadline &&
      daysUntil(t.deadline, today) < 0
  ).length;

  const gaps = allGaps.filter(g => ids.has(g.id));
  const reasons: string[] = [];
  let red = false;
  let amber = false;

  if (overdue) {
    red = true;
    reasons.push(
      `${overdue} open step${overdue === 1 ? " is" : "s are"} past ${overdue === 1 ? "its" : "their"} deadline`
    );
  }
  if (withChain.length) {
    const quiet = quietDays ?? sinceCreated;
    if (quiet >= PILLAR_RED_DAYS) {
      red = true;
      reasons.push(
        quietDays === null
          ? `nothing has moved since it was added ${sinceCreated} days ago`
          : `nothing has moved for ${quiet} days`
      );
    } else if (quiet >= STALLED_OUTCOME_DAYS) {
      amber = true;
      reasons.push(`quiet for ${quiet} days`);
    }
  }
  if (!valueGoals.length) {
    amber = true;
    reasons.push("no Value Goal yet");
  } else if (!outcomes.length) {
    amber = true;
    reasons.push("no Goal Outcome yet");
  } else if (!withChain.length) {
    amber = true;
    reasons.push("no confirmed project serving its outcomes");
  }
  const kinds = new Set(gaps.map(g => g.kind));
  if (
    kinds.has("value-goal-empty") &&
    valueGoals.length &&
    outcomes.length // already said "no Goal Outcome yet" when none
  ) {
    amber = true;
    reasons.push("a Value Goal has no Goal Outcome");
  }
  if (kinds.has("outcome-no-project") && withChain.length) {
    amber = true;
    reasons.push("an outcome has no project");
  }
  if (kinds.has("suggested-link")) {
    amber = true;
    reasons.push("a suggested link is waiting for you");
  }

  const health: PillarHealth = red ? "red" : amber ? "amber" : "green";
  return {
    kind: "pillar",
    goal: pillar,
    health,
    reasons: health === "green" ? [] : [...new Set(reasons)],
    quietDays,
  };
}

/** The strip: up to eight slots, filled in the order the Pillars were added. */
export function pillarStrip(w: Workspace, today: string): PillarStrip {
  const gaps = mapGaps(w, today);
  const pillars = goalsAt(w, "pillar")
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(p => pillarHealth(w, p, today, gaps));
  const shown = pillars.slice(0, PILLAR_SLOTS);
  const slots: StripSlot[] = [
    ...shown,
    ...Array.from(
      { length: PILLAR_SLOTS - shown.length },
      (): EmptySlot => ({ kind: "empty" })
    ),
  ];
  const counts: Record<PillarHealth, number> = { green: 0, amber: 0, red: 0 };
  for (const p of pillars) counts[p.health] += 1;
  return { slots, overflow: pillars.slice(PILLAR_SLOTS), counts };
}

export const HEALTH_WORD: Record<PillarHealth, string> = {
  green: "Steady",
  amber: "Needs a look",
  red: "Gone quiet",
};

/** One line for the caption: names the quietest Pillar so the nudge is specific. */
export function stripCaption(strip: PillarStrip): string {
  const all = [
    ...strip.slots.filter((s): s is PillarSlot => s.kind === "pillar"),
    ...strip.overflow,
  ];
  if (!all.length) return "No Pillars yet. Add the first one.";
  const red = all.filter(p => p.health === "red");
  const amber = all.filter(p => p.health === "amber");
  if (!red.length && !amber.length)
    return `All ${all.length} Pillar${all.length === 1 ? " is" : "s are"} steady.`;
  const first = red[0] ?? amber[0];
  const more = red.length + amber.length - 1;
  const why = first.reasons[0] ? `: ${first.reasons[0]}` : "";
  return `${first.goal.title}${why}${more > 0 ? ` · +${more} more to look at` : ""}`;
}

/** What Read aloud says: every Pillar, its state, and the reason. */
export function spokenStrip(strip: PillarStrip): string {
  const all = [
    ...strip.slots.filter((s): s is PillarSlot => s.kind === "pillar"),
    ...strip.overflow,
  ];
  if (!all.length)
    return "You have no Pillars yet. Add the first one from the Compass map.";
  const lines = all.map(p =>
    p.health === "green"
      ? `${p.goal.title}: steady.`
      : `${p.goal.title}: ${HEALTH_WORD[p.health].toLowerCase()}. ${p.reasons.slice(0, 2).join(", ")}.`
  );
  const free = PILLAR_SLOTS - Math.min(all.length, PILLAR_SLOTS);
  return `${all.length} Pillar${all.length === 1 ? "" : "s"}. ${lines.join(" ")}${free ? ` ${free} free slot${free === 1 ? "" : "s"}.` : ""} This is a gentle read of your map, not a score. Nothing changes unless you choose.`;
}
