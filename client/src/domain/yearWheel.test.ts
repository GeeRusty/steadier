import { describe, expect, it } from "vitest";
import { emptyProjectCompass, emptyTaskCompass } from "./compass";
import { createTask } from "./engine";
import { kindContext } from "./todayStates";
import { emptyProjectSchedule, emptyTaskSchedule } from "./time";
import { yearWheelEvents } from "./yearWheel";
import type { Project, Task, Workspace } from "./types";

const STAMP = "2026-10-30T09:00:00+10:30";
function workspace(): Workspace {
  const task: Task = {
    ...createTask({ title: "Book inspection" }, STAMP),
    id: "task-a",
    projectId: "project-a",
    deadline: "2026-11-08",
    preparationDate: "2026-11-01",
    preparationSource: "confirmed",
    createdAt: STAMP,
    updatedAt: STAMP,
    completedAt: null,
    history: [{ at: STAMP, text: "Created." }],
    schedule: {
      ...emptyTaskSchedule(),
      date: "2026-11-02",
      repeat: {
        freq: "weekly",
        interval: 1,
        weekdays: [1],
        monthDay: null,
        nthWeekday: null,
        until: null,
        count: null,
      },
    },
    compass: emptyTaskCompass(),
  };
  const project: Project = {
    id: "project-a",
    title: "Home project",
    purpose: "Keep the home reliable.",
    outcome: "Inspection completed.",
    role: "support",
    pattern: "sustained",
    status: "active",
    milestones: [{ id: "m1", title: "Book inspection", done: false }],
    progress: [{ at: STAMP, text: "Quote received." }],
    createdAt: STAMP,
    updatedAt: STAMP,
    schedule: {
      ...emptyProjectSchedule(),
      deadline: "2026-12-01",
      milestoneDates: [{ id: "m1", date: "2026-11-05" }],
    },
    compass: emptyProjectCompass(),
  };
  return {
    version: 2,
    tasks: [task],
    projects: [project],
    focus: null,
    intention: null,
    matrixWeights: {
      "direction-timely": 1,
      "direction-sustained": 1,
      "support-timely": 1,
      "support-sustained": 1,
    },
    trial: { startedAt: STAMP, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [
      {
        id: "review-a",
        at: STAMP,
        date: "2026-10-30",
        floor: {
          money: { answer: null, note: "" },
          action: [],
          capacity: { answer: null, note: "" },
        },
        decisions: [],
        imperatives: [],
        quietImperatives: [],
        unplacedBefore: 0,
        unplacedAfter: 0,
        notes: "",
      },
    ],
    goals: [],
    obligations: [
      {
        id: "obligation-a",
        title: "Insurance renewal",
        kind: "insurance",
        dueDate: "2026-11-20",
        leadTimeDays: 14,
        cadence: "yearly",
        cadenceAnchorDate: "2026-11-20",
        link: null,
        status: "active",
        amountDue: null,
        nextAction: "Compare policies",
        referenceUrl: null,
        lastPaidOn: null,
        lastPaidDueDate: null,
        preparationTaskId: null,
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    ],
    evidence: [
      {
        id: "evidence-a",
        targetKind: "task",
        targetId: "task-a",
        titleSnapshot: "Inspection evidence",
        text: "Quote received.",
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    ],
  };
}

describe("read-only Year Wheel", () => {
  it("separates due, planned, preparation and project dates without projecting repeats", () => {
    const data = workspace();
    const events = yearWheelEvents(
      data,
      2026,
      kindContext(data, null, "2026-10-30")
    );
    const taskEvents = events.filter(event => event.source === "task");
    expect(
      taskEvents.map(event => [event.date, event.category])
    ).toContainEqual(["2026-11-02", "task-planned"]);
    expect(
      taskEvents.map(event => [event.date, event.category])
    ).toContainEqual(["2026-11-01", "task-preparation-date"]);
    expect(
      taskEvents.map(event => [event.date, event.category])
    ).toContainEqual(["2026-11-08", "task-deadline"]);
    expect(events.some(event => event.date === "2026-11-09")).toBe(false);
    expect(
      events.find(event => event.category === "obligation-due")?.date
    ).toBe("2026-11-20");
    expect(
      events.find(event => event.category === "project-deadline")?.date
    ).toBe("2026-12-01");
    expect(events.some(event => event.category === "weekly-review")).toBe(true);
    expect(events.some(event => event.category === "evidence-evidence-a")).toBe(
      true
    );
  });

  it("returns no events for malformed years and never mutates the workspace", () => {
    const data = workspace();
    const before = structuredClone(data);
    expect(
      yearWheelEvents(data, 1899, kindContext(data, null, "2026-10-30"))
    ).toEqual([]);
    yearWheelEvents(data, 2026, kindContext(data, null, "2026-10-30"));
    expect(data).toEqual(before);
  });
});
