import { describe, expect, it } from "vitest";
import type { Imperative } from "./compass";
import { emptyProjectCompass, emptyTaskCompass } from "./compass";
import type { Goal } from "./goals";
import type { Project, Task } from "./types";
import { createTask } from "./engine";
import { emptyProjectSchedule, emptyTaskSchedule } from "./time";
import {
  STATUS_MARK_COLOR_HEX,
  STATUS_MARK_COLOR_HEX_DARK,
  STATUS_MARK_COLOR_HEX_LIGHT,
  statusMarkColorForImperative,
  statusMarkColorForProject,
  statusMarkColorForTask,
  type StatusMarkData,
} from "./statusMarkColor";
import { statusMarkColorAfterReviewFade, statusMarkGreyHex } from "./statusMarkStaleness";

const STAMP = "2026-11-03T09:00:00+10:30";

function project(extra: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    title: "Synthetic project",
    purpose: "",
    outcome: "",
    role: "direction",
    pattern: "timely",
    status: "active",
    milestones: [],
    progress: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    schedule: emptyProjectSchedule(),
    compass: emptyProjectCompass(),
    ...extra,
  };
}

function goal(
  id: string,
  projects: Goal["projects"] = [],
  level: Goal["level"] = "outcome",
  status: Goal["status"] = "active",
  parents: Goal["parents"] = []
): Goal {
  return {
    id,
    level,
    title: `Synthetic ${level}`,
    description: "",
    status,
    parents,
    projects,
    notionUrl: null,
    history: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function imperative(
  id: string,
  mapLinks: string[] = [],
  status: Imperative["status"] = "active"
): Imperative {
  return {
    id,
    title: `Synthetic ${id}`,
    reason: "",
    status,
    setOn: "2026-11-01",
    retiredOn: status === "retired" ? "2026-11-02" : null,
    notionUrl: null,
    decision: null,
    history: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    mapLinks,
  };
}

function task(extra: Partial<Task> = {}): Task {
  const base = createTask(
    {
      title: "Synthetic task",
      state: "ready",
      deadline: null,
      startDate: null,
      reviewDate: null,
      preparationDate: null,
      projectId: null,
      schedule: emptyTaskSchedule(),
      compass: emptyTaskCompass(),
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    "2026-11-03"
  );
  return {
    ...base,
    ...extra,
    compass: { ...base.compass, ...(extra.compass ?? {}) },
  };
}

function data(
  projects: Project[],
  goals: Goal[],
  imperatives: Imperative[]
): StatusMarkData {
  return { projects, goals, imperatives };
}

const confirmedLink: Goal["projects"][number] = {
  id: "project-1",
  confirmed: true,
};

function alignedFixture(projectImperatives = ["imperative-1"]) {
  const p = project({
    compass: {
      ...emptyProjectCompass(),
      imperativeIds: projectImperatives,
    },
  });
  const outcome = goal("outcome-1", [confirmedLink]);
  const imp = imperative("imperative-1", [outcome.id]);
  return { project: p, outcome, imperative: imp };
}

describe("Stage 2 status-mark alignment colours", () => {
  it("is green only when the same active Imperative directly links the Project and its confirmed Outcome", () => {
    const f = alignedFixture();
    expect(
      statusMarkColorForProject(
        f.project,
        data([f.project], [f.outcome], [f.imperative])
      ).color
    ).toBe("green");
  });

  it("is red when different active Imperatives link the Project and Outcome", () => {
    const outcome = goal("outcome-1", [confirmedLink]);
    const p = project({
      compass: {
        ...emptyProjectCompass(),
        imperativeIds: ["project-imperative"],
      },
    });
    const projectImperative = imperative("project-imperative");
    const outcomeImperative = imperative("outcome-imperative", [outcome.id]);
    expect(
      statusMarkColorForProject(
        p,
        data([p], [outcome], [projectImperative, outcomeImperative])
      ).color
    ).toBe("red");
  });

  it("is red when a project has no active confirmed Goal Outcome, even without an Imperative link", () => {
    const p = project();
    expect(statusMarkColorForProject(p, data([p], [], [])).color).toBe("red");
  });

  it("is red when an active direct Project Imperative has no directly aligned Outcome", () => {
    const f = alignedFixture();
    const notDirect = imperative("imperative-1", ["value-goal-1"]);
    expect(
      statusMarkColorForProject(
        f.project,
        data([f.project], [f.outcome], [notDirect])
      ).color
    ).toBe("red");
  });

  it("does not inherit an Imperative from a Value Goal or Pillar", () => {
    const f = alignedFixture();
    const valueGoal = goal("value-goal-1", [], "value-goal");
    const childOutcome = goal(
      f.outcome.id,
      [confirmedLink],
      "outcome",
      "active",
      [{ id: valueGoal.id, confirmed: true }]
    );
    const linkedAbove = imperative("imperative-1", [valueGoal.id]);
    expect(
      statusMarkColorForProject(
        f.project,
        data([f.project], [valueGoal, childOutcome], [linkedAbove])
      ).color
    ).toBe("red");
  });

  it("uses amber for an ordinary Project even if an Outcome is directly linked to an Imperative", () => {
    const f = alignedFixture([]);
    expect(
      statusMarkColorForProject(
        f.project,
        data([f.project], [f.outcome], [f.imperative])
      ).color
    ).toBe("amber");
  });

  it("does not count a suggested or retired Goal Outcome as an active confirmed link", () => {
    const f = alignedFixture();
    const suggested = goal("outcome-1", [
      { ...confirmedLink, confirmed: false },
    ]);
    expect(
      statusMarkColorForProject(
        f.project,
        data([f.project], [suggested], [f.imperative])
      ).color
    ).toBe("red");
    const retired = goal("outcome-1", [confirmedLink], "outcome", "retired");
    expect(
      statusMarkColorForProject(
        f.project,
        data([f.project], [retired], [f.imperative])
      ).color
    ).toBe("red");
  });

  it("does not count a retired Imperative as a direct active alignment", () => {
    const f = alignedFixture();
    const retired = imperative("imperative-1", [f.outcome.id], "retired");
    expect(
      statusMarkColorForProject(
        f.project,
        data([f.project], [f.outcome], [retired])
      ).color
    ).toBe("amber");
  });

  it("accepts any directly aligned linked Outcome when a Project serves several", () => {
    const f = alignedFixture();
    const otherOutcome = goal("outcome-2", [confirmedLink]);
    const direct = imperative("imperative-1", [otherOutcome.id]);
    expect(
      statusMarkColorForProject(
        f.project,
        data([f.project], [f.outcome, otherOutcome], [direct])
      ).color
    ).toBe("green");
  });

  it("makes tasks inherit their Project colour before considering task catch-all fields", () => {
    const f = alignedFixture();
    const t = task({
      projectId: f.project.id,
      compass: {
        ...emptyTaskCompass(),
        catchAll: "life-admin",
        catchAllConfirmed: true,
      },
    });
    expect(
      statusMarkColorForTask(t, data([f.project], [f.outcome], [f.imperative]))
        .color
    ).toBe("green");
  });

  it("maps owner-confirmed no-Project catch-alls to blue and purple only", () => {
    const d = data([], [], []);
    expect(
      statusMarkColorForTask(
        task({
          compass: {
            ...emptyTaskCompass(),
            catchAll: "life-admin",
            catchAllConfirmed: true,
          },
        }),
        d
      ).color
    ).toBe("blue");
    expect(
      statusMarkColorForTask(
        task({
          compass: {
            ...emptyTaskCompass(),
            catchAll: "erosion-guard",
            catchAllConfirmed: true,
          },
        }),
        d
      ).color
    ).toBe("purple");
  });

  it("keeps unconfirmed catch-alls amber and Someday tasks uncoloured", () => {
    const d = data([], [], []);
    expect(
      statusMarkColorForTask(
        task({
          compass: {
            ...emptyTaskCompass(),
            catchAll: "life-admin",
            catchAllConfirmed: false,
          },
        }),
        d
      ).color
    ).toBe("amber");
    const f = alignedFixture();
    expect(
      statusMarkColorForTask(
        task({
          state: "someday",
          projectId: f.project.id,
          compass: {
            ...emptyTaskCompass(),
            catchAll: "life-admin",
            catchAllConfirmed: true,
          },
        }),
        data([f.project], [f.outcome], [f.imperative])
      ).color
    ).toBeNull();
  });

  it("uses green for active Imperatives as alignment anchors and no colour for retired ones", () => {
    expect(statusMarkColorForImperative(imperative("active")).color).toBe(
      "green"
    );
    expect(
      statusMarkColorForImperative(imperative("retired", [], "retired")).color
    ).toBeNull();
  });
});

describe("Status Mark color palette", () => {
  it("keeps base, faded, and grey arrows at 3:1 contrast in both themes", () => {
    expect(STATUS_MARK_COLOR_HEX).toEqual(STATUS_MARK_COLOR_HEX_LIGHT);
    const themes = [
      { appearance: "light" as const, colors: STATUS_MARK_COLOR_HEX_LIGHT, surfaces: ["#FFFFFF", "#F8F9F5"] },
      { appearance: "dark" as const, colors: STATUS_MARK_COLOR_HEX_DARK, surfaces: ["#121518", "#1B2026"] },
    ];
    const luminance = (hex: string) => {
      const channels = [1, 3, 5].map(start => {
        const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    for (const { appearance, colors, surfaces } of themes) {
      const baseColors = Object.values(colors);
      expect(new Set(baseColors).size).toBe(5);
      const arrows = [
        ...baseColors,
        ...Object.keys(colors).flatMap(color =>
          Array.from({ length: 15 }, (_, day) =>
            statusMarkColorAfterReviewFade(color as keyof typeof colors, day, appearance)
          )
        ),
        statusMarkGreyHex(appearance),
      ];
      for (const arrow of arrows) {
        for (const surface of surfaces) {
          const a = luminance(arrow);
          const b = luminance(surface);
          expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});
