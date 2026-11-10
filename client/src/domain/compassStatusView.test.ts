import { describe, expect, it } from "vitest";
import type { Imperative } from "./compass";
import { emptyProjectCompass } from "./compass";
import type { Goal } from "./goals";
import { emptyProjectSchedule } from "./time";
import type { Project } from "./types";
import { createStatusMarkData } from "./statusMarkColor";
import { compassStatusGroups } from "./compassStatusView";

const CLOCK = { date: "2026-11-03", minutes: 600 };
const TODAY = "2026-11-03";

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    title: `Synthetic ${id}`,
    purpose: "Synthetic purpose",
    outcome: "",
    role: "direction",
    pattern: "timely",
    status: "active",
    milestones: [],
    progress: [],
    createdAt: `${TODAY}T09:00:00+10:30`,
    updatedAt: `${TODAY}T09:00:00+10:30`,
    schedule: emptyProjectSchedule(),
    compass: emptyProjectCompass(),
    ...overrides,
  };
}

function imperative(
  id: string,
  overrides: Partial<Imperative> = {}
): Imperative {
  return {
    id,
    title: `Synthetic ${id}`,
    reason: "Synthetic reason",
    status: "active",
    setOn: TODAY,
    retiredOn: null,
    notionUrl: null,
    decision: null,
    history: [],
    createdAt: `${TODAY}T09:00:00+10:30`,
    updatedAt: `${TODAY}T09:00:00+10:30`,
    ...overrides,
  };
}

function outcome(id: string, projectId: string): Goal {
  return {
    id,
    level: "outcome",
    title: `Synthetic ${id}`,
    description: "",
    status: "active",
    parents: [],
    projects: [{ id: projectId, confirmed: true }],
    notionUrl: null,
    history: [],
    createdAt: `${TODAY}T09:00:00+10:30`,
    updatedAt: `${TODAY}T09:00:00+10:30`,
  };
}

describe("Stage 4 Compass status grouping", () => {
  it("orders fresh red first, visibly grey second, then all other active marks", () => {
    const redProject = project("red-project");
    const greyProject = project("grey-project", {
      createdAt: "2026-10-20T09:00:00+10:30",
      updatedAt: "2026-10-20T09:00:00+10:30",
      schedule: {
        ...emptyProjectSchedule(),
        reviewDate: "2026-11-10",
      },
    });
    const amberProject = project("amber-project");
    const activeImperative = imperative("active-imperative");
    const retiredImperative = imperative("retired-imperative", {
      status: "retired",
      retiredOn: "2026-10-01",
    });
    const achievedProject = project("achieved-project", {
      status: "achieved",
    });
    const goals = [outcome("amber-outcome", amberProject.id)];
    const markData = createStatusMarkData({
      projects: [redProject, greyProject, amberProject, achievedProject],
      goals,
      imperatives: [activeImperative, retiredImperative],
    });
    const workspace = {
      projects: [redProject, greyProject, amberProject, achievedProject],
      imperatives: [activeImperative, retiredImperative],
    };
    const before = JSON.stringify(workspace);

    const groups = compassStatusGroups(workspace, markData, CLOCK);

    expect(groups.map(group => group.id)).toEqual(["red", "grey", "rest"]);
    expect(groups[0].items.map(item => `${item.kind}:${item.item.id}`)).toEqual(
      ["project:red-project"]
    );
    expect(groups[1].items.map(item => `${item.kind}:${item.item.id}`)).toEqual(
      ["project:grey-project"]
    );
    expect(groups[2].items.map(item => `${item.kind}:${item.item.id}`)).toEqual(
      ["imperative:active-imperative", "project:amber-project"]
    );
    expect(groups[1].items[0]).toMatchObject({
      color: "red",
      grey: true,
      group: "grey",
    });
    expect(JSON.stringify(workspace)).toBe(before);
  });

  it("greys stale active Imperatives and excludes non-active records", () => {
    const staleImperative = imperative("stale-imperative", {
      setOn: "2026-10-20",
      createdAt: "2026-10-20T09:00:00+10:30",
      updatedAt: "2026-10-20T09:00:00+10:30",
    });
    const inactiveImperative = imperative("inactive-imperative", {
      status: "retired",
      retiredOn: "2026-10-25",
    });
    const achievedProject = project("achieved", { status: "achieved" });
    const markData = createStatusMarkData({
      projects: [achievedProject],
      goals: [],
      imperatives: [staleImperative, inactiveImperative],
    });

    const groups = compassStatusGroups(
      {
        projects: [achievedProject],
        imperatives: [staleImperative, inactiveImperative],
      },
      markData,
      CLOCK
    );

    expect(groups[1].items.map(item => item.item.id)).toEqual([
      "stale-imperative",
    ]);
    expect(
      groups.flatMap(group => group.items).map(item => item.item.id)
    ).toEqual(["stale-imperative"]);
  });
});
