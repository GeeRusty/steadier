import { describe, expect, it } from "vitest";
import { emptyWorkspace } from "../../../server/steadier/validation";
import { newGoal } from "./goals";
import { linesToTitles, pillarCards } from "./pillarCards";
import type { Workspace } from "./types";

const STAMP = "2026-11-18T10:00:00+10:30";
const OLD = "2026-10-01T10:00:00+09:30";
const TODAY = "2026-11-18";

function setup(): Workspace {
  const career = { ...newGoal("pillar", "Career", STAMP, { description: "Current and future work" }), id: "p-career" };
  const finance = { ...newGoal("pillar", "Finance", OLD), id: "p-finance", updatedAt: OLD };
  const health = { ...newGoal("pillar", "Health", STAMP), id: "p-health", status: "retired" as const };
  const growth = { ...newGoal("pillar", "Growth", STAMP), id: "p-growth" };
  const vg = { ...newGoal("value-goal", "Career of choice", STAMP, { parents: [{ id: "p-career", confirmed: true }] }), id: "vg" };
  const oc = { ...newGoal("outcome", "Income streams", STAMP, { parents: [{ id: "vg", confirmed: true }] }), id: "oc", projects: [{ id: "pr1", confirmed: true }, { id: "pr2", confirmed: true }] };
  const w = emptyWorkspace();
  return {
    ...w,
    goals: [career, finance, health, growth, vg, oc],
    projects: [{ id: "pr1", title: "Website", updatedAt: STAMP } as never, { id: "pr2", title: "Contracts", updatedAt: STAMP } as never],
    imperatives: [
      { id: "i1", title: "Work", status: "active", mapLinks: ["vg"] } as never,
      { id: "i2", title: "Old", status: "retired", mapLinks: ["p-growth"] } as never,
    ],
  };
}

describe("Pillars & Goals cards", () => {
  it("keeps the stored order, puts retired Pillars aside, and summarises what's under each", () => {
    const { active, retired } = pillarCards(setup(), TODAY);
    expect(active.map(c => c.pillar.title)).toEqual(["Career", "Finance", "Growth"]);
    expect(retired.map(p => p.title)).toEqual(["Health"]);
    expect(active[0].summary).toBe("1 Value Goal · 1 Outcome · 2 projects");
    expect(active[0].valueGoals[0].outcomes[0].projects.map(p => p.title)).toEqual(["Website", "Contracts"]);
    expect(active[1].summary).toBe("Nothing under it yet");
  });

  it("green only for an active Imperative linked to the Pillar or anything under it", () => {
    const { active } = pillarCards(setup(), TODAY);
    expect(active.map(c => c.green)).toEqual([true, false, false]);
    expect(active[0].linkedImperatives).toEqual(["Work"]);
  });

  it("chips only when something is off, at most two", () => {
    const { active } = pillarCards(setup(), TODAY);
    expect(active[0].chips).toEqual([]);
    expect(active[1].chips).toEqual(["no definition", "no Value Goal"]);
    const described = setup();
    described.goals = described.goals!.map(g => (g.id === "p-finance" ? { ...g, description: "Money" } : g));
    expect(pillarCards(described, TODAY).active[1].chips).toEqual(["no Value Goal", "quiet 48d"]);
  });

  it("pasted lines become one item each", () => {
    expect(linesToTitles("- Calm home\n\n2. Savings buffer\n• Fit at 60 ")).toEqual(["Calm home", "Savings buffer", "Fit at 60"]);
  });
});
