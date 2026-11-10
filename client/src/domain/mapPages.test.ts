import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import { imperativesField, type Imperative } from "./compass";
import { mapGaps, newGoal, type Goal } from "./goals";
import {
  addExistingChild,
  addParent,
  addProjectLink,
  confirmGoalLink,
  confirmProjectLink,
  createChildUnder,
  createProjectUnder,
  goalsThroughWork,
  imperativesForGoal,
  linkImperativeToGoal,
  parentLinkStatus,
  projectLinkStatus,
  removeGoalLink,
  removeProjectLink,
  spokenMapItem,
  unlinkImperativeFromGoal,
} from "./mapPages";
import type { Project, Workspace } from "./types";

const T = "2026-10-26T14:00:00+10:30";
const TODAY = "2026-10-26";

function project(id: string, title: string): Project {
  return {
    id,
    title,
    status: "active",
    compass: { imperativeIds: [] },
    updatedAt: "2026-10-24T09:00:00",
  } as unknown as Project;
}
function imperative(
  id: string,
  title: string,
  extra: Partial<Imperative> = {}
): Imperative {
  return {
    id,
    title,
    reason: "",
    status: "active",
    notionUrl: null,
    setOn: "2026-10-01",
    retiredOn: null,
    decision: null,
    history: [],
    createdAt: T,
    updatedAt: T,
    ...extra,
  } as Imperative;
}
function g(
  id: string,
  level: Goal["level"],
  title: string,
  parents: [string, boolean][] = []
): Goal {
  return {
    ...newGoal(level, title, T),
    id,
    parents: parents.map(([p, confirmed]) => ({ id: p, confirmed })),
  };
}
function ws(
  goals: Goal[],
  projects: Project[] = [],
  imperatives: Imperative[] = []
): Workspace {
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
    imperatives,
    reviews: [],
    goals,
  } as unknown as Workspace;
}
const find = (w: Workspace, id: string) => w.goals!.find(x => x.id === id)!;

describe("Map level pages: goal links from either end", () => {
  const base = () =>
    ws([
      g("p1", "pillar", "Family"),
      g("p2", "pillar", "Health"),
      g("v1", "value-goal", "Secure home", [["p1", true]]),
      g("v2", "value-goal", "Strong body"),
      g("v3", "value-goal", "Suggested one", [["p2", false]]),
      g("o1", "outcome", "Lease signed", [["v1", true]]),
    ]);

  it("adding an existing child from the parent page makes one confirmed link and logs both ends", () => {
    const w = base();
    const next = addExistingChild(w, "p2", "v2", T);
    expect(find(next, "v2").parents).toEqual([{ id: "p2", confirmed: true }]);
    expect(find(next, "p2").history.at(-1)!.text).toBe(
      "Added Value Goal “Strong body” under this."
    );
    expect(find(next, "v2").history.at(-1)!.text).toMatch(/Health/);
    // Nothing else changed.
    for (const id of ["p1", "v1", "v3", "o1"])
      expect(find(next, id)).toEqual(find(w, id));
    expect(next.tasks).toBe(w.tasks);
    expect(next.projects).toBe(w.projects);
    expect(next.imperatives).toBe(w.imperatives);
  });

  it("never downgrades a confirmed link and never silently confirms a suggested one", () => {
    const w = base();
    // Already confirmed: returned unchanged (same object).
    expect(addExistingChild(w, "p1", "v1", T)).toBe(w);
    // Suggested: stays suggested until the owner taps Confirm.
    const same = addExistingChild(w, "p2", "v3", T);
    expect(same).toBe(w);
    expect(parentLinkStatus(same, "v3", "p2")).toBe("suggested");
    expect(addParent(w, "v3", "p2", T)).toBe(w);
  });

  it("refuses links between the wrong levels", () => {
    const w = base();
    expect(addExistingChild(w, "p1", "o1", T)).toBe(w);
    expect(addParent(w, "o1", "p1", T)).toBe(w);
  });

  it("Confirm only upgrades a suggested link and logs it", () => {
    const w = base();
    expect(confirmGoalLink(w, "v1", "p1", T)).toBe(w);
    expect(confirmGoalLink(w, "v2", "p2", T)).toBe(w);
    const next = confirmGoalLink(w, "v3", "p2", T);
    expect(parentLinkStatus(next, "v3", "p2")).toBe("confirmed");
    expect(find(next, "p2").history.at(-1)!.text).toMatch(
      /^Confirmed suggested link/
    );
  });

  it("Reject removes only the suggestion and says so", () => {
    const next = removeGoalLink(base(), "v3", "p2", T);
    expect(find(next, "v3").parents).toEqual([]);
    expect(find(next, "p2").history.at(-1)!.text).toMatch(
      /^Rejected suggested link/
    );
  });

  it("creates a new item directly under a parent with a confirmed link", () => {
    const { workspace, id } = createChildUnder(
      base(),
      "v1",
      "Bond back by May",
      T
    );
    const made = find(workspace, id!);
    expect(made.level).toBe("outcome");
    expect(made.parents).toEqual([{ id: "v1", confirmed: true }]);
    expect(createChildUnder(base(), "o1", "x", T).id).toBeNull();
    expect(createChildUnder(base(), "v1", "   ", T).id).toBeNull();
  });
});

describe("Map level pages: Outcome ↔ project links", () => {
  const base = () => {
    const o1 = g("o1", "outcome", "Lease signed");
    o1.projects = [{ id: "pr2", confirmed: false }];
    return ws([o1], [project("pr1", "Find rental"), project("pr2", "Pack")]);
  };
  it("links an unlinked project confirmed, leaves existing links alone", () => {
    const w = base();
    const next = addProjectLink(w, "o1", "pr1", T);
    expect(projectLinkStatus(next, "o1", "pr1")).toBe("confirmed");
    expect(addProjectLink(w, "o1", "pr2", T)).toBe(w);
    expect(projectLinkStatus(w, "o1", "pr2")).toBe("suggested");
  });
  it("confirms and rejects suggested project links", () => {
    const w = base();
    expect(
      projectLinkStatus(confirmProjectLink(w, "o1", "pr2", T), "o1", "pr2")
    ).toBe("confirmed");
    const rejected = removeProjectLink(w, "o1", "pr2", T);
    expect(projectLinkStatus(rejected, "o1", "pr2")).toBe("none");
    expect(find(rejected, "o1").history.at(-1)!.text).toBe(
      "Rejected suggested project “Pack”."
    );
  });
  it("a project created from an Outcome is linked and its role/pattern stay unconfirmed", () => {
    const { workspace, id } = createProjectUnder(
      base(),
      "o1",
      "Book movers",
      T,
      "pr-new"
    );
    const p = workspace.projects.find(x => x.id === id)!;
    expect(p.title).toBe("Book movers");
    expect(p.compass.labelsConfirmed).toBe(false);
    expect(projectLinkStatus(workspace, "o1", "pr-new")).toBe("confirmed");
  });
});

describe("Imperatives on the map", () => {
  it("old Imperative records load unchanged; the new field is optional and validated", () => {
    const old = imperative("i1", "Keep the house");
    expect(imperativesField([old])).toEqual([old]);
    expect(imperativesField([old])![0]).not.toHaveProperty("mapLinks");
    const withLinks = imperative("i2", "Rest", { mapLinks: ["p1"] });
    expect(imperativesField([withLinks])).toEqual([withLinks]);
    expect(() => imperativesField([{ ...withLinks, mapLinks: [7] }])).toThrow();
  });

  it("links directly, logs both ends, and shows through items below and linked work", () => {
    const p1 = g("p1", "pillar", "Family");
    const v1 = g("v1", "value-goal", "Home", [["p1", true]]);
    const o1 = g("o1", "outcome", "Lease", [["v1", true]]);
    o1.projects = [{ id: "pr1", confirmed: true }];
    const pr = project("pr1", "Find rental");
    (pr.compass as { imperativeIds: string[] }).imperativeIds = ["i2"];
    let w = ws(
      [p1, v1, o1],
      [pr],
      [imperative("i1", "Keep the house"), imperative("i2", "Move well")]
    );

    w = linkImperativeToGoal(w, "i1", "v1", T);
    expect(w.imperatives[0].mapLinks).toEqual(["v1"]);
    expect(w.imperatives[0].history.at(-1)!.text).toMatch(/Value Goal “Home”/);
    expect(find(w, "v1").history.at(-1)!.text).toBe(
      "Imperative “Keep the house” linked here."
    );
    expect(linkImperativeToGoal(w, "i1", "v1", T)).toBe(w);

    const atV1 = imperativesForGoal(w, "v1");
    expect(atV1.direct.map(i => i.id)).toEqual(["i1"]);
    expect(atV1.through.map(i => i.id)).toEqual(["i2"]);
    const atP1 = imperativesForGoal(w, "p1");
    expect(atP1.direct).toEqual([]);
    expect(atP1.through.map(i => i.id).sort()).toEqual(["i1", "i2"]);
    expect(goalsThroughWork(w, w.imperatives[1]).map(x => x.id)).toEqual([
      "o1",
    ]);
    expect(spokenMapItem(w, find(w, "v1"), TODAY)).toMatch(
      /Imperatives here: Keep the house, Move well/
    );

    w = unlinkImperativeFromGoal(w, "i1", "v1", T);
    expect(w.imperatives[0].mapLinks).toEqual([]);
  });

  it("flags an active Imperative that is not on the map, and clears it once linked", () => {
    const p1 = g("p1", "pillar", "Family");
    let w = ws(
      [p1],
      [],
      [
        imperative("i1", "Keep the house"),
        imperative("i3", "Old", { status: "retired" }),
      ]
    );
    const kinds = () =>
      mapGaps(w, TODAY)
        .filter(x => x.kind === "imperative-unmapped")
        .map(x => x.id);
    expect(kinds()).toEqual(["i1"]);
    w = linkImperativeToGoal(w, "i1", "p1", T);
    expect(kinds()).toEqual([]);
  });
});

describe("Map pages leave tasks and orphan protection alone", () => {
  it("does not touch tasks when links change", () => {
    const task = createTask({ title: "Call agent" }, "2026-10-20T09:00:00");
    const w = {
      ...ws([g("p1", "pillar", "Family"), g("v1", "value-goal", "Home")]),
      tasks: [task],
    };
    const next = addExistingChild(w, "p1", "v1", T);
    expect(next.tasks).toBe(w.tasks);
    expect(next.tasks[0]).toEqual(task);
  });
});
