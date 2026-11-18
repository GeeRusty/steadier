/**
 * Pillars & Goals page (owner, 18 Nov): one card per Pillar, in the owner's
 * own stored order (never sorted by activity), all at the same strength.
 * Nothing here changes data.
 */
import { childrenOf, outcomeLastMovement, type Goal } from "./goals";
import { daysBetween } from "./time";
import type { Project, Workspace } from "./types";

/** A Pillar is quiet when nothing under it has moved for this many days. */
export const PILLAR_QUIET_DAYS = 30;

export interface OutcomeNode {
  outcome: Goal;
  projects: Project[];
}
export interface ValueGoalNode {
  valueGoal: Goal;
  outcomes: OutcomeNode[];
}
export interface PillarCard {
  pillar: Goal;
  valueGoals: ValueGoalNode[];
  /** "1 Value Goal · 1 Outcome · 2 projects", or "Nothing under it yet". */
  summary: string;
  /** Only what's off, at most two: "no definition", "no Value Goal", "quiet 30d". */
  chips: string[];
  /** An active Imperative links to this Pillar or something under it. */
  green: boolean;
  linkedImperatives: string[];
}

const dayOf = (stamp: string) => stamp.slice(0, 10);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function pillarCards(workspace: Workspace, today: string): { active: PillarCard[]; retired: Goal[] } {
  const goals = workspace.goals ?? [];
  const pillars = goals.filter(g => g.level === "pillar");
  const card = (pillar: Goal): PillarCard => {
    const valueGoals = childrenOf(workspace, pillar.id).filter(g => g.level === "value-goal");
    const nodes: ValueGoalNode[] = valueGoals.map(valueGoal => ({
      valueGoal,
      outcomes: childrenOf(workspace, valueGoal.id)
        .filter(g => g.level === "outcome")
        .map(outcome => ({
          outcome,
          projects: outcome.projects
            .map(link => workspace.projects.find(p => p.id === link.id))
            .filter((p): p is Project => !!p),
        })),
    }));
    const outcomes = nodes.flatMap(n => n.outcomes);
    const projectIds = new Set(outcomes.flatMap(o => o.projects.map(p => p.id)));
    const parts = [
      nodes.length ? plural(nodes.length, "Value Goal") : null,
      outcomes.length ? plural(outcomes.length, "Outcome") : null,
      projectIds.size ? plural(projectIds.size, "project") : null,
    ].filter(Boolean);

    // Last movement: the Pillar, anything under it, or its Outcomes' projects and tasks.
    let latest = dayOf(pillar.updatedAt);
    const bump = (day: string | null) => {
      if (day && day > latest) latest = day;
    };
    for (const n of nodes) {
      bump(dayOf(n.valueGoal.updatedAt));
      for (const o of n.outcomes) {
        bump(dayOf(o.outcome.updatedAt));
        bump(outcomeLastMovement(workspace, o.outcome));
      }
    }
    const quiet = daysBetween(latest, today);

    const chips: string[] = [];
    if (!pillar.description.trim()) chips.push("no definition");
    if (!nodes.length) chips.push("no Value Goal");
    if (quiet >= PILLAR_QUIET_DAYS) chips.push(`quiet ${quiet}d`);

    const under = new Set([pillar.id, ...nodes.map(n => n.valueGoal.id), ...outcomes.map(o => o.outcome.id)]);
    const linkedImperatives = workspace.imperatives
      .filter(i => i.status === "active" && (i.mapLinks ?? []).some(id => under.has(id)))
      .map(i => i.title);

    return {
      pillar,
      valueGoals: nodes,
      summary: parts.length ? parts.join(" · ") : "Nothing under it yet",
      chips: chips.slice(0, 2),
      green: linkedImperatives.length > 0,
      linkedImperatives,
    };
  };
  return {
    active: pillars.filter(p => p.status === "active").map(card),
    retired: pillars.filter(p => p.status !== "active"),
  };
}

/** Pasted or typed lines become one item each; blanks are skipped. */
export function linesToTitles(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .map(line => line.slice(0, 300));
}

export function spokenPillars(cards: PillarCard[]): string {
  return cards
    .map(c => {
      const parts = [c.pillar.title, c.pillar.description.trim() || "No definition yet", c.summary];
      if (c.green) parts.push(`Imperative: ${c.linkedImperatives.join(", ")}`);
      return `${parts.join(". ")}.`;
    })
    .join(" ");
}
