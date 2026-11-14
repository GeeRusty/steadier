import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import {
  commandCentreSnapshot,
  commandCentreWorkspaceKey,
  latestRecordAt,
} from "./commandCentre";
import { COMPASS_LIBRARY_LINKS } from "./compassLibrary";
import type { Imperative } from "./compass";
import type { Obligation, Task, Workspace } from "./types";

function task(
  id: string,
  createdAt: string,
  patch: Partial<Task> = {}
): Task {
  const base = createTask({ title: `Synthetic ${id}` }, createdAt.slice(0, 10));
  return {
    ...base,
    ...patch,
    id,
    title: patch.title ?? `Synthetic ${id}`,
    state: patch.state ?? "ready",
    createdAt,
    updatedAt: patch.updatedAt ?? createdAt,
    completedAt: patch.completedAt ?? null,
    deadline: patch.deadline ?? null,
    schedule: { ...base.schedule, ...(patch.schedule ?? {}) },
    compass: { ...base.compass, ...(patch.compass ?? {}) },
  };
}

function fixedSchedule(date: string, time: string) {
  const base = createTask({ title: "Synthetic schedule" }, date).schedule;
  return { ...base, date, time, fixed: true };
}

function imperative(id: string, updatedAt: string): Imperative {
  return {
    id,
    title: `Synthetic Imperative ${id}`,
    reason: "Synthetic test only",
    status: "active",
    setOn: updatedAt.slice(0, 10),
    retiredOn: null,
    notionUrl: null,
    decision: null,
    history: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

function obligation(dueDate: string): Obligation {
  return {
    id: "synthetic-obligation",
    title: "Synthetic bill",
    kind: "bill",
    dueDate,
    leadTimeDays: 0,
    cadence: "none",
    cadenceAnchorDate: null,
    link: null,
    status: "active",
    amountDue: null,
    nextAction: "",
    referenceUrl: null,
    lastPaidOn: null,
    lastPaidDueDate: null,
    preparationTaskId: null,
    createdAt: "2026-10-01T09:00:00+10:30",
    updatedAt: "2026-10-01T09:00:00+10:30",
  };
}

function workspace(
  tasks: Task[] = [],
  extra: Partial<Workspace> = {}
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
    trial: { startedAt: "2026-10-01T09:00:00+10:30", lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [],
    ...extra,
  };
}

const WEDNESDAY_MORNING = new Date("2026-11-04T08:00:00+10:30");
const WEDNESDAY_EVENING = new Date("2026-11-04T17:00:00+10:30");

describe("Command Centre rule-based selection", () => {
  it("uses the current quiet Imperative flag and stage-3 placement rule without adding thresholds", () => {
    const quietAtSevenDays = imperative("quiet-7", "2026-10-28T10:00:00+10:30");
    const notQuietAtSixDays = imperative("quiet-6", "2026-10-29T10:00:00+10:30");
    const stageThree = task("stage-3", "2026-10-31T00:00:00Z", { deadline: "2026-11-05" });
    const stageOne = task("recent", "2026-11-04T07:00:00+10:30");
    const parked = task("someday-stage-3", "2026-10-31T00:00:00Z", { state: "someday" });
    const dormantUndated = task("dormant-undated", "2026-10-31T00:00:00Z");
    const result = commandCentreSnapshot(
      workspace([stageThree, stageOne, parked, dormantUndated], {
        imperatives: [quietAtSevenDays, notQuietAtSixDays],
      }),
      WEDNESDAY_MORNING
    );
    expect(result.activeImperatives.find(item => item.imperative.id === "quiet-7")?.quiet).toBe(true);
    expect(result.activeImperatives.find(item => item.imperative.id === "quiet-6")?.quiet).toBe(false);
    expect(result.questions.map(question => question.itemId)).toContain("stage-3");
    expect(result.questions.map(question => question.itemId)).not.toContain("recent");
    expect(result.questions.map(question => question.itemId)).not.toContain("someday-stage-3");
    expect(result.questions.map(question => question.itemId)).not.toContain("dormant-undated");
    expect(result.questions.every(question => question.kind === "placement")).toBe(true);
  });

  it("shows no more than five questions and never asks twice about one item in the same set", () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      task(`stage-${index}`, "2026-10-31T00:00:00Z", { deadline: "2026-11-05" })
    );
    const snapshot = commandCentreSnapshot(workspace(many), WEDNESDAY_MORNING);
    expect(snapshot.questions).toHaveLength(5);
    expect(new Set(snapshot.questions.map(question => question.itemId)).size).toBe(5);
  });

  it("keeps the weekday morning question set closed until 08:00 Adelaide", () => {
    const preOpen = commandCentreSnapshot(
      workspace([task("pre-open-stage-3", "2026-10-31T00:00:00Z", { deadline: "2026-11-05" })]),
      new Date("2026-11-04T07:59:00+10:30")
    );
    const open = commandCentreSnapshot(
      workspace([task("open-stage-3", "2026-10-31T00:00:00Z", { deadline: "2026-11-05" })]),
      WEDNESDAY_MORNING
    );
    expect(preOpen.mode).toBe("weekday-before-morning");
    expect(preOpen.questions).toEqual([]);
    expect(open.mode).toBe("weekday-morning");
    expect(open.questions).toHaveLength(1);
  });

  it("uses only dated Today commitments in the evening and includes a stage-3 placement question when space remains", () => {
    const bookedToday = task("today-booked", "2026-11-04T07:00:00+10:30", {
      title: "Synthetic appointment",
      schedule: fixedSchedule("2026-11-04", "09:00"),
    });
    const undated = task("undated", "2026-11-04T07:00:00+10:30", { title: "Synthetic undated" });
    const tomorrow = task("tomorrow", "2026-11-04T07:00:00+10:30", {
      title: "Synthetic tomorrow",
      schedule: fixedSchedule("2026-11-05", "09:00"),
    });
    const placement = task("placement", "2026-10-31T00:00:00Z", { deadline: "2026-11-05" });
    const result = commandCentreSnapshot(
      workspace([bookedToday, undated, tomorrow, placement]),
      WEDNESDAY_EVENING
    );
    expect(result.mode).toBe("weekday-evening");
    expect(result.todayItems.some(item => item.taskId === "today-booked")).toBe(true);
    expect(result.todayItems.some(item => item.taskId === "undated")).toBe(false);
    expect(result.questions.map(question => question.itemId)).toContain("today-booked");
    expect(result.questions.map(question => question.itemId)).not.toContain("undated");
    expect(result.questions.filter(question => question.kind === "placement").length).toBeGreaterThan(0);
    expect(result.upcomingDays[0].date).toBe("2026-11-05");
    expect(result.upcomingDays.flatMap(day => day.timed).some(item => item.taskId === "tomorrow")).toBe(true);
  });

  it("Friday evening is an evening check-in, and Monday catches up weekend changes", () => {
    const friday = new Date("2026-11-06T17:00:00+10:30");
    const mondayDue = obligation("2026-11-09");
    const fridaySnapshot = commandCentreSnapshot(
      workspace([], { obligations: [mondayDue] }),
      friday
    );
    expect(fridaySnapshot.mode).toBe("weekday-evening");
    expect(fridaySnapshot.upcomingDays.map(day => day.date)).toEqual([
      "2026-11-07",
      "2026-11-08",
      "2026-11-09",
    ]);

    const weekendTask = task("weekend-change", "2026-11-06T05:00:00Z", {
      title: "Synthetic weekend update",
      // Friday UTC is already Saturday in Adelaide; use Adelaide-local day boundaries.
      updatedAt: "2026-11-06T13:30:00Z",
    });
    const mondaySnapshot = commandCentreSnapshot(
      workspace([weekendTask]),
      new Date("2026-11-09T08:00:00+10:30")
    );
    expect(mondaySnapshot.mode).toBe("weekday-morning");
    expect(mondaySnapshot.weekendChanges.some(change => change.itemId === "weekend-change")).toBe(true);
    expect(mondaySnapshot.questions.filter(question => question.itemId === "weekend-change")).toHaveLength(1);
    expect(mondaySnapshot.questions.some(question => question.kind === "weekend-task")).toBe(true);
  });

  it("shows no prompt set on Saturday or Sunday and keeps the Saturday review due flag", () => {
    const taskItem = task("weekend-unplaced", "2026-10-31T00:00:00Z");
    const base = workspace([taskItem]);
    const saturday = commandCentreSnapshot(base, new Date("2026-11-07T08:00:00+10:30"));
    const sunday = commandCentreSnapshot(base, new Date("2026-11-08T08:00:00+10:30"));
    expect(saturday.mode).toBe("saturday");
    expect(saturday.questions).toEqual([]);
    expect(saturday.review.due).toBe(true);
    expect(sunday.mode).toBe("sunday");
    expect(sunday.questions).toEqual([]);
  });

  it("follows Adelaide local time across standard and daylight saving offsets", () => {
    const daylight = commandCentreSnapshot(
      workspace(),
      new Date("2026-01-11T21:30:00Z")
    );
    const standard = commandCentreSnapshot(
      workspace(),
      new Date("2026-07-05T22:30:00Z")
    );
    expect(daylight.today).toBe("2026-01-12");
    expect(daylight.mode).toBe("weekday-morning");
    expect(standard.today).toBe("2026-07-06");
    expect(standard.mode).toBe("weekday-morning");
  });

  it("keeps acknowledgement workspace keys stable through task changes and includes only the five approved references", () => {
    const first = workspace([task("synthetic-a", "2026-11-01T00:00:00Z")]);
    const afterTaskEdit = workspace([task("synthetic-b", "2026-11-01T00:00:00Z")]);
    expect(commandCentreWorkspaceKey(first)).toBe(commandCentreWorkspaceKey(afterTaskEdit));
    expect(COMPASS_LIBRARY_LINKS).toHaveLength(5);
    expect(COMPASS_LIBRARY_LINKS.map(reference => reference.label)).toContain("Projects");
    expect(COMPASS_LIBRARY_LINKS.map(reference => reference.label)).toContain("Pillars");
    expect(COMPASS_LIBRARY_LINKS.map(reference => reference.label)).toContain("Goal Outcomes");
    expect(COMPASS_LIBRARY_LINKS.map(reference => reference.label)).toContain("Compass Library");
  });

  it("finds the newest saved record time for Server & Compass", () => {
    const older = task("older", "2026-11-01T00:00:00Z", { updatedAt: "2026-11-01T00:00:00Z" });
    const newer = task("newer", "2026-11-01T00:00:00Z", { updatedAt: "2026-11-05T03:00:00Z" });
    expect(latestRecordAt(workspace([older, newer]))).toBe("2026-11-05T03:00:00Z");
    expect(latestRecordAt(workspace())).toBeNull();
  });
});
