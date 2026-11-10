import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import {
  addGoal,
  chainsForProject,
  describeWhy,
  editGoal,
  goalsField,
  linkParent,
  linkProject,
  mapGaps,
  newGoal,
  pruneGoalLinks,
  setGoalStatus,
  type Goal,
} from "./goals";
import type { Project, Workspace } from "./types";

const T = "2026-10-25T10:00:00";
function project(id: string, title: string): Project {
  return {
    id,
    title,
    status: "active",
    updatedAt: "2026-10-24T09:00:00",
  } as unknown as Project;
}
function ws(goals: Goal[] = [], projects: Project[] = []): Workspace {
  return {
    version: 2,
    tasks: [],
    projects,
    focus: null,
    intention: null,
    matrixWeights: {
      "direction-timely": 1,
      "direction-sustained": 1,
      "support-timely": 1,
      "support-sustained": 1,
    },
    trial: { startedAt: T, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals,
  };
}
function g(
  id: string,
  level: Goal["level"],
  title: string,
  parents: string[] = []
): Goal {
  return {
    ...newGoal(level, title, T),
    id,
    parents: parents.map(p => ({ id: p, confirmed: true })),
  };
}

describe("Compass map", () => {
  const family = g("p-fam", "pillar", "Family");
  const health = g("p-hea", "pillar", "Health");
  const home = g("v-home", "value-goal", "A secure home", ["p-fam", "p-hea"]);
  const lease = {
    ...g("o-lease", "outcome", "Lease signed by March", ["v-home"]),
    projects: [{ id: "pr-rent", confirmed: true }],
  };
  const map = ws(
    [family, health, home, lease],
    [
      project("pr-rent", "Find next rental"),
      project("pr-loose", "Garage clean-out"),
    ]
  );

  it("follows every many-to-many path from a project up to its Pillars", () => {
    const chains = chainsForProject(map, "pr-rent");
    expect(chains.map(c => c.map(s => s.goal.id))).toEqual([
      ["o-lease", "v-home", "p-fam"],
      ["o-lease", "v-home", "p-hea"],
    ]);
    expect(describeWhy(map, map.projects[0])).toBe(
      "“Find next rental” serves Goal Outcome “Lease signed by March”, under Value Goal “A secure home”, under Pillars “Family” and “Health”."
    );
    expect(describeWhy(map, map.projects[1])).toMatch(
      /not linked to a Goal Outcome yet/
    );
    expect(describeWhy(map, null)).toMatch(/no project/);
    const short = ws(
      [
        g("v-x", "value-goal", "Calm mornings"),
        {
          ...g("o-x", "outcome", "Wake at 6", ["v-x"]),
          projects: [{ id: "pr-loose", confirmed: false }],
        },
      ],
      map.projects
    );
    expect(describeWhy(short, map.projects[1])).toBe(
      "“Garage clean-out” serves Goal Outcome “Wake at 6” (suggested), under Value Goal “Calm mornings”, which does not reach a Pillar yet."
    );
  });
  it("flags gaps without blocking: empty pillar, unlinked project, stalled outcome, suggested links", () => {
    const lonely = g("p-work", "pillar", "Work");
    const craft = g("p-craft", "pillar", "Craft");
    const w = linkParent(
      ws([...map.goals, lonely, craft], map.projects),
      "v-home",
      "p-craft",
      T,
      false
    );
    const kinds = mapGaps(w, "2026-11-20").map(x => `${x.kind}:${x.id}`);
    expect(kinds).toContain("pillar-empty:p-work");
    expect(kinds).toContain("project-unlinked:pr-loose");
    expect(kinds).toContain("outcome-stalled:o-lease");
    expect(kinds).toContain("suggested-link:v-home");
    expect(
      mapGaps(map, "2026-10-26").some(x => x.kind === "outcome-stalled")
    ).toBe(false);
    expect(mapGaps(ws(), "2026-10-26")).toEqual([]);
  });
  it("only links one level up, confirms suggestions, and retires without deleting", () => {
    let w = linkParent(map, "o-lease", "p-fam", T); // wrong level: ignored
    expect(
      w.goals.find(x => x.id === "o-lease")!.parents.map(p => p.id)
    ).toEqual(["v-home"]);
    w = linkProject(w, "o-lease", "pr-loose", T, false);
    expect(w.goals.find(x => x.id === "o-lease")!.projects.at(-1)).toEqual({
      id: "pr-loose",
      confirmed: false,
    });
    w = linkProject(w, "o-lease", "pr-loose", T, true);
    expect(w.goals.find(x => x.id === "o-lease")!.projects.at(-1)).toEqual({
      id: "pr-loose",
      confirmed: true,
    });
    w = setGoalStatus(w, "p-hea", "retired", T);
    expect(w.goals).toHaveLength(4);
    expect(chainsForProject(w, "pr-rent").map(c => c.at(-1)!.goal.id)).toEqual([
      "p-fam",
    ]);
    w = addGoal(w, newGoal("pillar", "Craft", T));
    expect(w.goals).toHaveLength(5);
  });
  it("edits Pillars and Goals in place without changing their IDs or Compass links", () => {
    let w = map;
    const before = new Map(w.goals.map(goal => [goal.id, goal]));
    for (const goal of w.goals) {
      w = editGoal(
        w,
        goal.id,
        {
          title: `${goal.title} updated`,
          description: `Updated ${goal.level} details.`,
          notionUrl: null,
        },
        T
      );
    }
    expect(w.goals).toHaveLength(map.goals.length);
    for (const goal of w.goals) {
      const original = before.get(goal.id)!;
      expect(goal.id).toBe(original.id);
      expect(goal.parents).toEqual(original.parents);
      expect(goal.projects).toEqual(original.projects);
      expect(goal.title).toBe(`${original.title} updated`);
      expect(goal.history.at(-1)?.text).toBe("Edited.");
    }
  });
  it("validates strictly, drops links to missing items quietly", () => {
    const stored = JSON.parse(JSON.stringify(map.goals));
    expect(goalsField(stored)).toEqual(map.goals);
    expect(() =>
      goalsField([
        { ...stored[0], parents: [{ id: "v-home", confirmed: true }] },
        stored[2],
      ])
    ).toThrow();
    expect(() => goalsField([{ ...stored[0], level: "dream" }])).toThrow();
    expect(() =>
      goalsField([{ ...stored[0], notionUrl: "https://evil.example/" }])
    ).toThrow();
    const orphaned = goalsField([stored[2]]);
    expect(orphaned[0].parents).toEqual([]);
    const pruned = pruneGoalLinks(ws(map.goals, [project("pr-loose", "x")]));
    expect(pruned.goals.find(x => x.id === "o-lease")!.projects).toEqual([]);
    expect(createTask({ title: "x" }, "2026-10-01").projectId).toBeNull();
  });
});
