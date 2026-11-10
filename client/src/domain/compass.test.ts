import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import {
  decisionField,
  describeDecision,
  imperativeViews,
  isUnplaced,
  normaliseNotionUrl,
  pruneImperativeLinks,
  suggestCatchAll,
  type Imperative,
} from "./compass";
import type { Workspace } from "./types";

function imperative(id: string, updatedAt = "2026-10-01T09:00:00"): Imperative {
  return {
    id,
    title: `Imperative ${id}`,
    reason: "",
    status: "active",
    setOn: "2026-10-01",
    retiredOn: null,
    notionUrl: null,
    decision: null,
    history: [],
    createdAt: updatedAt,
    updatedAt,
  };
}
function workspace(
  tasks = [createTask({ title: "Pay rego" }, "2026-10-01")]
): Workspace {
  return {
    version: 2,
    tasks,
    projects: [],
    focus: null,
    intention: null,
    matrixWeights: {
      "direction-timely": 1,
      "direction-sustained": 1,
      "support-timely": 1,
      "support-sustained": 1,
    },
    trial: {
      startedAt: "2026-10-01T09:00:00",
      lastExportAt: null,
      lastReviewAt: null,
    },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [],
  };
}

describe("Compass layer", () => {
  it("flags a standalone open task as unplaced, but not once it is placed or done", () => {
    const task = createTask({ title: "Pay rego" }, "2026-10-01");
    expect(isUnplaced(task)).toBe(true);
    expect(
      isUnplaced({
        ...task,
        compass: { ...task.compass, catchAll: "life-admin" },
      })
    ).toBe(true); // suggested only: still needs the owner's Confirm
    expect(
      isUnplaced({
        ...task,
        compass: {
          ...task.compass,
          catchAll: "life-admin",
          catchAllConfirmed: true,
        },
      })
    ).toBe(false);
    expect(
      isUnplaced({
        ...task,
        projectId: "p1",
        compass: { ...task.compass, projectSuggested: true },
      })
    ).toBe(true);
    expect(
      isUnplaced({
        ...task,
        compass: { ...task.compass, imperativeIds: ["imp-1"] },
      })
    ).toBe(false);
    expect(isUnplaced({ ...task, projectId: "p1" })).toBe(false);
    expect(isUnplaced({ ...task, state: "done" })).toBe(false);
  });
  it("suggests a catch-all only from Support labels, never for Direction", () => {
    const base = createTask({ title: "Thing" }, "2026-10-01");
    expect(
      suggestCatchAll({ ...base, role: "support", pattern: "timely" })
    ).toBe("life-admin");
    expect(
      suggestCatchAll({ ...base, role: "support", pattern: "sustained" })
    ).toBe("erosion-guard");
    expect(
      suggestCatchAll({ ...base, role: "direction", pattern: "timely" })
    ).toBeNull();
  });
  it("marks an Imperative quiet after 7 days with no linked movement; one with no project is fine", () => {
    const ws = {
      ...workspace([]),
      imperatives: [
        imperative("a", "2026-10-01T09:00:00"),
        imperative("b", "2026-10-20T09:00:00"),
      ],
    };
    const [a, b] = imperativeViews(ws, "2026-10-25");
    expect(a.quiet).toBe(true);
    expect(a.quietDays).toBe(24);
    expect(b.quiet).toBe(false);
    expect(a.projects).toHaveLength(0);
  });
  it("accepts only https Notion links", () => {
    expect(normaliseNotionUrl("https://www.notion.so/Page-123")).toBe(
      "https://www.notion.so/Page-123"
    );
    expect(normaliseNotionUrl("https://team.notion.site/x")).toBe(
      "https://team.notion.site/x"
    );
    expect(normaliseNotionUrl("http://www.notion.so/x")).toBeNull();
    expect(normaliseNotionUrl("https://notion.so.evil.com/x")).toBeNull();
    expect(normaliseNotionUrl("javascript:alert(1)")).toBeNull();
  });
  it("drops links to Imperatives that no longer exist instead of rejecting the save", () => {
    const task = createTask({ title: "Call agent" }, "2026-10-01");
    task.compass.imperativeIds = ["gone", "kept"];
    const ws = { ...workspace([task]), imperatives: [imperative("kept")] };
    expect(pruneImperativeLinks(ws).tasks[0].compass.imperativeIds).toEqual([
      "kept",
    ]);
  });
  it("keeps ChatGPT Compass decisions visibly suggested until the owner confirms", () => {
    const decision = decisionField(
      {
        outcome: "sustain",
        at: "2026-10-26T11:30:00+10:30",
        by: "chatgpt",
        confirmed: false,
        note: "",
      },
      "ChatGPT suggestion"
    );
    expect(decision?.confirmed).toBe(false);
    expect(describeDecision(decision)).toBe("Sustain (suggested by ChatGPT)");
  });
});
