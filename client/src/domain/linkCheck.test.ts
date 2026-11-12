import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import { emptyProjectCompass, isUnplaced, type Imperative } from "./compass";
import { emptyWorkspace, parseStrictV2Workspace } from "../../../server/steadier/validation";
import {
  effectiveMatrixKey,
  effectiveTaskRole,
  heldLinkItems,
  holdItem,
  linkCheckCount,
  linkProjectToImperative,
  linkTaskToImperative,
  makeProjectSupport,
  matrixBalance,
  projectsWithoutGoalOutcome,
  renewHoldsForReview,
  rowLabel,
  stepDownImperative,
  unlinkedImperatives,
  unlinkedProjects,
} from "./linkCheck";
import { cardDots } from "./taskCard";
import { emptyProjectSchedule } from "./time";
import type { Project, Workspace } from "./types";

const T0 = "2026-11-10T09:00:00+10:30";
const T1 = "2026-11-11T09:00:00+10:30";
const T2 = "2026-11-12T09:00:00+10:30";
const T3 = "2026-11-13T09:00:00+10:30";

function imperative(id: string, status: "active" | "retired" = "active"): Imperative {
  return {
    id,
    title: `Imp ${id}`,
    reason: "",
    status,
    setOn: "2026-11-01",
    retiredOn: null,
    notionUrl: null,
    decision: null,
    history: [],
    createdAt: T0,
    updatedAt: T0,
  };
}

function project(id: string, role: "direction" | "support", imperativeIds: string[] = [], extra: Partial<Project["compass"]> = {}): Project {
  return {
    id,
    title: `Project ${id}`,
    purpose: "",
    outcome: "",
    role,
    pattern: "timely",
    status: "active",
    milestones: [],
    progress: [],
    createdAt: T0,
    updatedAt: T0,
    schedule: emptyProjectSchedule(),
    compass: { ...emptyProjectCompass(), imperativeIds, ...extra },
  };
}

function base(): Workspace {
  const w = emptyWorkspace();
  w.trial.startedAt = "2026-10-01T00:00:00.000Z";
  w.imperatives = [imperative("i1"), imperative("i2"), imperative("old", "retired")];
  return w;
}

describe("Link check lists", () => {
  it("List 1 counts only open tasks and active projects as work", () => {
    const w = base();
    const done = { ...createTask({ title: "Done thing" }), state: "done" as const, compass: { ...createTask({ title: "x" }).compass, imperativeIds: ["i1"] } };
    w.tasks = [done];
    expect(unlinkedImperatives(w).map(i => i.id)).toEqual(["i1", "i2"]);

    const open = { ...createTask({ title: "Open thing" }), compass: { ...done.compass } };
    w.tasks = [done, open];
    expect(unlinkedImperatives(w).map(i => i.id)).toEqual(["i2"]);

    w.tasks = [];
    w.projects = [project("p1", "support", ["i2"])];
    expect(unlinkedImperatives(w).map(i => i.id)).toEqual(["i1"]);
    w.projects = [{ ...project("p1", "support", ["i2"]), status: "achieved" }];
    expect(unlinkedImperatives(w).map(i => i.id)).toEqual(["i1", "i2"]);
  });

  it("suggested links never count", () => {
    const w = base();
    const t = createTask({ title: "Suggested" });
    w.tasks = [{ ...t, compass: { ...t.compass, imperativeIds: ["i1"], imperativesSuggested: true } }];
    w.projects = [project("p1", "direction", ["i2"], { imperativesSuggested: true })];
    expect(unlinkedImperatives(w).map(i => i.id)).toEqual(["i1", "i2"]);
    expect(unlinkedProjects(w).map(p => p.id)).toEqual(["p1"]);
  });

  it("List 2 is active Imperative-row projects with no active Imperative", () => {
    const w = base();
    w.projects = [
      project("a", "direction"),
      project("b", "direction", ["i1"]),
      project("c", "direction", ["old"]),
      project("d", "support"),
      { ...project("e", "direction"), status: "achieved" },
    ];
    expect(unlinkedProjects(w).map(p => p.id)).toEqual(["a", "c"]);
    // Plus the four active projects with no Goal Outcome (approved 2026-11-12).
    expect(linkCheckCount(w)).toBe(1 + 2 + 4);
  });

  it("List 3 is active projects with no confirmed Goal Outcome", () => {
    const w = base();
    w.projects = [project("a", "support"), project("b", "support"), { ...project("c", "support"), status: "achieved" }];
    w.goals = [
      { id: "o1", level: "outcome", title: "O", description: "", status: "active", parents: [], projects: [{ id: "a", confirmed: true }, { id: "b", confirmed: false }], notionUrl: null, history: [], createdAt: T0, updatedAt: T0 },
    ];
    expect(projectsWithoutGoalOutcome(w).map(p => p.id)).toEqual(["b"]);
  });
});

describe("Not yet", () => {
  it("holds until the next review is saved, then comes back", () => {
    let w = base();
    w.projects = [project("a", "direction")];
    w = holdItem(w, "project", "a", T1);
    expect(unlinkedProjects(w)).toHaveLength(0);
    expect(heldLinkItems(w).projects.map(p => p.id)).toEqual(["a"]);

    // A review saved after the hold: it expires.
    const expired = { ...w, reviews: [{ at: T2, date: "2026-11-12" } as Workspace["reviews"][number]] };
    expect(unlinkedProjects(expired).map(p => p.id)).toEqual(["a"]);
  });

  it("Not yet again during a review survives that review's save", () => {
    let w = base();
    w.projects = [project("a", "direction"), project("b", "direction")];
    w = holdItem(w, "project", "a", T0); // before the review
    w = holdItem(w, "project", "b", T2); // chosen again in the review
    w = { ...w, reviews: [{ at: T3, date: "2026-11-13" } as Workspace["reviews"][number]] };
    w = renewHoldsForReview(w, T1, T3);
    expect(w.linkCheckHolds).toEqual([{ kind: "project", id: "b", heldOn: T3 }]);
    expect(unlinkedProjects(w).map(p => p.id)).toEqual(["a"]);
  });

  it("round-trips through strict validation, and old saves without it still load", () => {
    const w = base();
    w.projects = [project("a", "direction", ["i1"], { imperativesSuggested: true })];
    const held = holdItem(w, "project", "a", "2026-11-11T09:00:00.000Z");
    const parsed = parseStrictV2Workspace(JSON.parse(JSON.stringify(held)));
    expect(parsed.linkCheckHolds).toEqual([{ kind: "project", id: "a", heldOn: "2026-11-11T09:00:00.000Z" }]);
    expect(parsed.projects[0].compass.imperativesSuggested).toBe(true);
    const plain = parseStrictV2Workspace(JSON.parse(JSON.stringify(base())));
    expect(plain.linkCheckHolds).toBeUndefined();
  });
});

describe("Owner choices", () => {
  it("Link work links only on the owner's tap and clears the hold", () => {
    let w = base();
    const t = createTask({ title: "Ring the council" });
    w.tasks = [t];
    w = holdItem(w, "imperative", "i1", T1);
    w = linkTaskToImperative(w, t.id, "i1", T2);
    expect(w.tasks[0].compass.imperativeIds).toEqual(["i1"]);
    expect(w.tasks[0].compass.imperativesSuggested).toBe(false);
    expect(w.linkCheckHolds).toEqual([]);
    expect(unlinkedImperatives(w).map(i => i.id)).toEqual(["i2"]);
  });

  it("linking a project replaces a pending suggestion with the owner's own link", () => {
    let w = base();
    w.projects = [project("p", "direction", ["i2"], { imperativesSuggested: true })];
    w = linkProjectToImperative(w, "p", "i1", T2);
    expect(w.projects[0].compass.imperativeIds).toEqual(["i1"]);
    expect("imperativesSuggested" in w.projects[0].compass).toBe(false);
  });

  it("Make it Support changes only the stored role", () => {
    let w = base();
    w.projects = [project("p", "direction")];
    w = makeProjectSupport(w, "p", T2);
    expect(w.projects[0].role).toBe("support");
    expect(unlinkedProjects(w)).toHaveLength(0);
  });

  it("Step down uses the existing decisions; Sustain waits for the next review", () => {
    let w = base();
    w = stepDownImperative(w, "i1", "sustain", T2, "2026-11-12");
    expect(w.imperatives[0].decision).toMatchObject({ outcome: "sustain", by: "owner", confirmed: true });
    expect(w.imperatives[0].status).toBe("active");
    expect(unlinkedImperatives(w).map(i => i.id)).toEqual(["i2"]);
    const afterReview = { ...w, reviews: [{ at: T3, date: "2026-11-13" } as Workspace["reviews"][number]] };
    expect(unlinkedImperatives(afterReview).map(i => i.id)).toEqual(["i1", "i2"]);

    w = stepDownImperative(w, "i2", "retire", T2, "2026-11-12");
    expect(w.imperatives[1]).toMatchObject({ status: "retired", retiredOn: "2026-11-12" });
  });
});

describe("Hybrid matrix row", () => {
  it("linked to an active Imperative → Imperative row, derived; otherwise the manual role", () => {
    const w = base();
    const t = createTask({ title: "Gym", role: "support", pattern: "sustained", labelSource: "confirmed" });
    const linked = { ...t, compass: { ...t.compass, imperativeIds: ["i1"] } };
    expect(effectiveTaskRole(t, w)).toBe("support");
    expect(effectiveTaskRole(linked, w)).toBe("direction");
    expect(effectiveMatrixKey(linked, w)).toBe("direction-sustained");
    expect(rowLabel(linked, w)).toBe("Imperative (linked) · Sustained");
    expect(rowLabel(t, w)).toBe("Support · Sustained");
  });

  it("follows the task's project link, but not a suggested one", () => {
    const w = base();
    w.projects = [project("p", "support", ["i1"]), project("s", "support", ["i1"], { imperativesSuggested: true })];
    const t = { ...createTask({ title: "x", role: "support", pattern: "timely" }), projectId: "p" };
    expect(effectiveTaskRole(t, w)).toBe("direction");
    expect(effectiveTaskRole({ ...t, projectId: "s" }, w)).toBe("support");
  });

  it("retiring the Imperative falls back to the manual choice with no data change", () => {
    const w = base();
    const t = createTask({ title: "x", role: "support", pattern: "timely" });
    const linked = { ...t, compass: { ...t.compass, imperativeIds: ["old"] } };
    expect(effectiveTaskRole(linked, w)).toBe("support");
    expect(linked.role).toBe("support");
  });

  it("does not touch orphan flags or the card dots", () => {
    const w = base();
    const t = { ...createTask({ title: "x", role: "support", pattern: "timely" }), actionConfirmed: false };
    const before = { unplaced: isUnplaced(t), dots: cardDots(t) };
    effectiveTaskRole(t, w);
    rowLabel(t, w);
    expect({ unplaced: isUnplaced(t), dots: cardDots(t) }).toEqual(before);
  });

  it("matrix balance counts open work and time per cell", () => {
    const w = base();
    const a = { ...createTask({ title: "a", role: "support", pattern: "timely" }), estimate: 30 };
    a.schedule = { ...a.schedule, timeLog: [{ start: "2026-11-11T09:00", minutes: 20, source: "manual" }] };
    const b = { ...createTask({ title: "b", role: "support", pattern: "timely" }), estimate: 15, compass: { ...a.compass, imperativeIds: ["i1"] } };
    const idea = { ...createTask({ title: "idea", role: "support", pattern: "timely" }), state: "someday" as const };
    w.tasks = [a, b, idea];
    const { cells } = matrixBalance(w, "2026-11-12");
    expect(cells["support-timely"].tasks.map(t => t.title)).toEqual(["a"]);
    expect(cells["support-timely"].estimateMinutes).toBe(30);
    expect(cells["support-timely"].loggedMinutes).toBe(20);
    expect(cells["direction-timely"].tasks.map(t => t.title)).toEqual(["b"]);
  });
});
