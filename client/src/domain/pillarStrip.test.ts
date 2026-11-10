import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import { newGoal, type Goal } from "./goals";
import {
  PILLAR_SLOTS,
  pillarHealth,
  pillarStrip,
  spokenStrip,
  stripCaption,
} from "./pillarStrip";
import type { Project, Task, Workspace } from "./types";

const T0 = "2026-01-01T09:00:00+10:30";
const TODAY = "2026-10-26";

function project(id: string, updated: string): Project {
  return {
    id,
    title: id,
    status: "active",
    compass: { imperativeIds: [] },
    updatedAt: updated,
  } as unknown as Project;
}
function goal(
  id: string,
  level: Goal["level"],
  title: string,
  parent?: [string, boolean],
  created = T0
): Goal {
  return {
    ...newGoal(level, title, created),
    id,
    parents: parent ? [{ id: parent[0], confirmed: parent[1] }] : [],
  };
}
function withProject(o: Goal, id: string, confirmed = true): Goal {
  return { ...o, projects: [{ id, confirmed }] };
}
function ws(goals: Goal[], projects: Project[] = [], tasks: Task[] = []) {
  return {
    version: 2,
    tasks,
    projects,
    focus: null,
    intention: null,
    matrixWeights: {
      "direction-timely": 1,
      "direction-sustained": 1,
      "support-timely": 1,
      "support-sustained": 1,
    },
    trial: { startedAt: T0, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals,
  } as unknown as Workspace;
}
const health = (w: Workspace, id: string) =>
  pillarHealth(w, w.goals!.find(g => g.id === id)!, TODAY);

describe("Pillar strip: slots", () => {
  it("always has eight slots; pillars first, free slots after, in the order added", () => {
    const w = ws([
      goal("b", "pillar", "Health", undefined, "2026-03-01T09:00:00+10:30"),
      goal("a", "pillar", "Family", undefined, "2026-02-01T09:00:00+10:30"),
    ]);
    const s = pillarStrip(w, TODAY);
    expect(s.slots).toHaveLength(PILLAR_SLOTS);
    expect(s.slots.map(x => (x.kind === "pillar" ? x.goal.id : "-"))).toEqual([
      "a",
      "b",
      "-",
      "-",
      "-",
      "-",
      "-",
      "-",
    ]);
  });

  it("a ninth Pillar is never hidden: it is reported as overflow", () => {
    const pillars = Array.from({ length: 10 }, (_, i) =>
      goal(
        `p${i}`,
        "pillar",
        `P${i}`,
        undefined,
        `2026-01-${10 + i}T09:00:00+10:30`
      )
    );
    const s = pillarStrip(ws(pillars), TODAY);
    expect(s.slots.every(x => x.kind === "pillar")).toBe(true);
    expect(s.overflow.map(p => p.goal.id)).toEqual(["p8", "p9"]);
    expect(s.counts.amber + s.counts.green + s.counts.red).toBe(10);
  });

  it("retired Pillars take no slot", () => {
    const w = ws([{ ...goal("a", "pillar", "Old"), status: "retired" }]);
    expect(pillarStrip(w, TODAY).slots.every(x => x.kind === "empty")).toBe(
      true
    );
  });
});

describe("Pillar strip: health", () => {
  const chain = (moved: string, extra: Goal[] = []) => {
    const o = withProject(goal("o", "outcome", "Lease", ["v", true]), "pr");
    return ws(
      [
        goal("p", "pillar", "Family"),
        goal("v", "value-goal", "Home", ["p", true]),
        o,
        ...extra,
      ],
      [project("pr", moved)]
    );
  };

  it("green: chain in place and something moved in the last 14 days", () => {
    const h = health(chain("2026-10-20T09:00:00"), "p");
    expect(h.health).toBe("green");
    expect(h.reasons).toEqual([]);
  });

  it("amber: a brand-new Pillar with nothing under it (a gap, not a failure)", () => {
    const h = health(
      ws([goal("p", "pillar", "Family", undefined, TODAY)]),
      "p"
    );
    expect(h.health).toBe("amber");
    expect(h.reasons[0]).toMatch(/no Value Goal/);
  });

  it("amber: Value Goal without an outcome, outcome without a project", () => {
    const a = health(
      ws([goal("p", "pillar", "F"), goal("v", "value-goal", "H", ["p", true])]),
      "p"
    );
    expect(a.health).toBe("amber");
    expect(a.reasons[0]).toMatch(/no Goal Outcome/);
    const b = health(
      ws([
        goal("p", "pillar", "F"),
        goal("v", "value-goal", "H", ["p", true]),
        goal("o", "outcome", "O", ["v", true]),
      ]),
      "p"
    );
    expect(b.health).toBe("amber");
    expect(b.reasons.join(" ")).toMatch(/no confirmed project/);
  });

  it("amber: quiet for 14 to 29 days; red from 30", () => {
    expect(health(chain("2026-10-10T09:00:00"), "p").health).toBe("amber");
    expect(health(chain("2026-10-10T09:00:00"), "p").reasons[0]).toMatch(
      /quiet for 16 days/
    );
    const r = health(chain("2026-09-20T09:00:00"), "p");
    expect(r.health).toBe("red");
    expect(r.reasons[0]).toMatch(/nothing has moved for 36 days/);
  });

  it("red: open work past its deadline under the Pillar, even if recently touched", () => {
    const late = createTask({ title: "Pay rates" }, "2026-10-01T09:00:00");
    late.projectId = "pr";
    late.deadline = "2026-10-20";
    const w = chain("2026-10-25T09:00:00");
    w.tasks = [late];
    const h = health(w, "p");
    expect(h.health).toBe("red");
    expect(h.reasons[0]).toMatch(/1 open step is past its deadline/);
  });

  it("a done task past its deadline does not turn it red", () => {
    const done = createTask({ title: "Paid" }, "2026-10-01T09:00:00");
    done.projectId = "pr";
    done.deadline = "2026-10-20";
    done.state = "done";
    const w = chain("2026-10-25T09:00:00");
    w.tasks = [done];
    expect(health(w, "p").health).toBe("green");
  });

  it("suggested links never count: not as a chain and not as movement", () => {
    const o = withProject(
      goal("o", "outcome", "Lease", ["v", true]),
      "pr",
      false
    );
    const w = ws(
      [
        goal("p", "pillar", "Family"),
        goal("v", "value-goal", "Home", ["p", true]),
        o,
      ],
      [project("pr", "2026-10-25T09:00:00")]
    );
    const h = health(w, "p");
    expect(h.health).toBe("amber");
    expect(h.reasons.join(" ")).toMatch(/no confirmed project/);
    expect(h.reasons.join(" ")).toMatch(/suggested link/);
  });

  it("an outcome shared by two Pillars counts for both", () => {
    const o = {
      ...withProject(goal("o", "outcome", "Shared", ["v1", true]), "pr"),
      parents: [
        { id: "v1", confirmed: true },
        { id: "v2", confirmed: true },
      ],
    };
    const w = ws(
      [
        goal("p1", "pillar", "A"),
        goal("p2", "pillar", "B"),
        goal("v1", "value-goal", "V1", ["p1", true]),
        goal("v2", "value-goal", "V2", ["p2", true]),
        o,
      ],
      [project("pr", "2026-10-24T09:00:00")]
    );
    expect(health(w, "p1").health).toBe("green");
    expect(health(w, "p2").health).toBe("green");
  });
});

describe("Pillar strip: words", () => {
  it("caption names the Pillar to look at first (red before amber)", () => {
    const w = ws([
      goal("a", "pillar", "Family", undefined, "2026-02-01T09:00:00+10:30"),
      goal("b", "pillar", "Health", undefined, "2026-03-01T09:00:00+10:30"),
    ]);
    const c = stripCaption(pillarStrip(w, TODAY));
    expect(c).toMatch(/^Family: no Value Goal yet/);
    expect(c).toMatch(/\+1 more to look at/);
  });

  it("caption says so when everything is steady, and nudges when empty", () => {
    expect(stripCaption(pillarStrip(ws([]), TODAY))).toMatch(/No Pillars yet/);
  });

  it("spoken summary names every Pillar, the free slots, and says it is not a score", () => {
    const w = ws([goal("a", "pillar", "Family")]);
    const t = spokenStrip(pillarStrip(w, TODAY));
    expect(t).toMatch(/1 Pillar\./);
    expect(t).toMatch(/Family: needs a look/);
    expect(t).toMatch(/7 free slots/);
    expect(t).toMatch(/not a score/);
  });

  it("reading the strip changes nothing in the workspace", () => {
    const w = ws([goal("a", "pillar", "Family")]);
    const before = JSON.stringify(w);
    pillarStrip(w, TODAY);
    spokenStrip(pillarStrip(w, TODAY));
    expect(JSON.stringify(w)).toBe(before);
  });
});
