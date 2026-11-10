import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import { emptyProjectCompass } from "./compass";
import { emptyProjectSchedule, emptyTaskSchedule } from "./time";
import type { Imperative } from "./compass";
import type { Project, Task } from "./types";
import {
  TIMING_SHAPE_THRESHOLDS,
  taskRescheduleCount,
  timingShapeForImperative,
  timingShapeForProject,
  timingShapeForTask,
} from "./timingShape";

const clock = { date: "2026-11-03", minutes: 600 };

function task(overrides: Partial<Task> = {}): Task {
  return createTask(
    {
      title: "Synthetic timing task",
      state: "ready",
      reviewDate: null,
      deadline: null,
      startDate: null,
      preparationDate: null,
      schedule: emptyTaskSchedule(),
      createdAt: "2026-11-03T09:00:00+10:30",
      updatedAt: "2026-11-03T09:00:00+10:30",
      ...overrides,
    },
    "2026-11-03"
  );
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "synthetic-project",
    title: "Synthetic project",
    purpose: "",
    outcome: "",
    role: "direction",
    pattern: "timely",
    status: "active",
    milestones: [],
    progress: [],
    createdAt: "2026-11-03T09:00:00+10:30",
    updatedAt: "2026-11-03T09:00:00+10:30",
    schedule: emptyProjectSchedule(),
    compass: emptyProjectCompass(),
    ...overrides,
  };
}

function imperative(overrides: Partial<Imperative> = {}): Imperative {
  return {
    id: "synthetic-imperative",
    title: "Synthetic imperative",
    reason: "",
    status: "active",
    setOn: "2026-11-03",
    retiredOn: null,
    notionUrl: null,
    decision: null,
    history: [],
    createdAt: "2026-11-03T09:00:00+10:30",
    updatedAt: "2026-11-03T09:00:00+10:30",
    ...overrides,
  };
}

describe("Stage 1 timing shapes", () => {
  it("treats a flexible window end as availability, not an overdue commitment", () => {
    const flexible = task({
      schedule: {
        ...emptyTaskSchedule(),
        flexibleWindow: { startDate: "2026-11-01", endDate: "2026-11-03" },
      },
    });
    expect(timingShapeForTask(flexible, clock).shape).toBe("on-track");
    expect(
      timingShapeForTask(flexible, { ...clock, date: "2026-11-04" }).shape
    ).toBe("on-track");
  });

  it("uses movement rather than past date or move-count penalties for unbooked work", () => {
    const unbooked = task({
      deadline: "2026-11-01",
      updatedAt: "2026-11-02T09:00:00+10:30",
      history: [
        { at: "2026-10-30T09:00:00+10:30", text: "Rescheduled task timing." },
        { at: "2026-10-31T09:00:00+10:30", text: "Rescheduled task timing." },
        { at: "2026-11-01T09:00:00+10:30", text: "Rescheduled task timing." },
      ],
    });
    const result = timingShapeForTask(unbooked, clock);
    expect(result.shape).toBe("on-track");
    expect(result.reason).toContain("No booked timing commitment");
  });

  it("marks an explicitly booked timed anchor behind once its duration has passed", () => {
    const timed = task({
      estimate: 15,
      schedule: {
        ...emptyTaskSchedule(),
        date: clock.date,
        time: "09:45",
        minutes: 15,
        fixed: true,
      },
    });
    expect(timingShapeForTask(timed, { ...clock, minutes: 599 }).shape).toBe(
      "on-track"
    );
    expect(timingShapeForTask(timed, { ...clock, minutes: 600 }).shape).toBe(
      "behind"
    );
  });

  it("marks a hard deadline behind when its Adelaide due minute arrives", () => {
    const dueAtTen = task({
      deadline: clock.date,
      schedule: { ...emptyTaskSchedule(), deadlineTime: "10:00" },
    });
    expect(timingShapeForTask(dueAtTen, { ...clock, minutes: 599 }).shape).toBe(
      "on-track"
    );
    expect(timingShapeForTask(dueAtTen, { ...clock, minutes: 600 }).shape).toBe(
      "behind"
    );
  });

  it("uses the Adelaide-local day for due dates and early completion", () => {
    const early = task({
      state: "done",
      deadline: "2026-11-04",
      completedAt: "2026-11-02T15:00:00Z",
    });
    expect(timingShapeForTask(early, clock).shape).toBe("ahead");

    const beforeAdelaideMidnight = task({
      deadline: "2026-11-03",
      updatedAt: "2026-11-02T15:00:00Z",
      history: [],
    });
    expect(timingShapeForTask(beforeAdelaideMidnight, clock).shape).toBe(
      "on-track"
    );
  });

  it("marks explicit progress before a future date ahead and a late completion behind", () => {
    const progressed = task({
      deadline: "2026-11-06",
      schedule: {
        ...emptyTaskSchedule(),
        timeLog: [{ start: "2026-11-02T09:00", minutes: 20, source: "manual" }],
      },
    });
    expect(timingShapeForTask(progressed, clock).shape).toBe("ahead");

    const late = task({
      state: "done",
      deadline: "2026-11-01",
      completedAt: "2026-11-02T09:00:00+10:30",
    });
    expect(timingShapeForTask(late, clock).shape).toBe("behind");
  });

  it("applies the three-reschedule threshold without mutating the task", () => {
    const unchanged = task({
      deadline: "2026-11-10",
      schedule: {
        ...emptyTaskSchedule(),
        date: "2026-11-10",
        time: "10:00",
        fixed: true,
      },
      history: [
        { at: "2026-11-01T09:00:00+10:30", text: "Rescheduled task timing." },
        {
          at: "2026-11-02T09:00:00+10:30",
          text: "Missed block moved to 2026-11-03.",
        },
        {
          at: "2026-11-03T09:00:00+10:30",
          text: "Rescheduled for 2026-11-10.",
        },
      ],
    });
    const snapshot = JSON.stringify(unchanged);
    expect(TIMING_SHAPE_THRESHOLDS.rescheduled).toBe(3);
    expect(taskRescheduleCount(unchanged)).toBe(3);
    expect(timingShapeForTask(unchanged, clock).shape).toBe("behind");
    expect(JSON.stringify(unchanged)).toBe(snapshot);
  });

  it("counts legacy reschedules without penalizing unbooked work", () => {
    const legacy = task({
      history: [
        { at: "2026-10-01", text: "Planned for 2026-10-02." },
        { at: "2026-10-02", text: "Planned for 2026-10-03." },
        { at: "2026-10-03", text: "Planned for 2026-10-04." },
        { at: "2026-10-04", text: "Planned for 2026-10-05." },
      ],
    });
    expect(taskRescheduleCount(legacy)).toBe(3);
    expect(timingShapeForTask(legacy, clock).shape).toBe("on-track");

    const skipped = task({
      schedule: {
        ...emptyTaskSchedule(),
        date: "2026-11-03",
        time: "09:00",
        fixed: true,
        skipped: ["2026-10-30", "2026-10-31", "2026-11-01"],
      },
    });
    expect(timingShapeForTask(skipped, clock).shape).toBe("behind");
  });

  it("uses 0–6 and 7+ Adelaide-local quiet days only when no active date exists", () => {
    const sixDays = task({
      createdAt: "2026-10-28T12:00:00+10:30",
      reviewDate: "2026-11-02",
      updatedAt: "2026-10-28T12:00:00+10:30",
    });
    const sevenDays = task({
      createdAt: "2026-10-27T12:00:00+10:30",
      updatedAt: "2026-10-27T12:00:00+10:30",
    });
    expect(timingShapeForTask(sixDays, clock).shape).toBe("on-track");
    expect(timingShapeForTask(sevenDays, clock).shape).toBe("behind");
  });

  it("uses project deadlines, unfinished milestone dates and recorded progress", () => {
    const progressing = project({
      schedule: {
        ...emptyProjectSchedule(),
        deadline: "2026-11-06",
        milestoneDates: [{ id: "m1", date: "2026-11-05" }],
      },
      milestones: [{ id: "m1", title: "Synthetic milestone", done: false }],
      progress: [
        { at: "2026-11-02T09:00:00+10:30", text: "Synthetic progress." },
      ],
    });
    expect(timingShapeForProject(progressing, clock).shape).toBe("ahead");

    const late = project({
      schedule: { ...emptyProjectSchedule(), deadline: "2026-11-02" },
    });
    expect(timingShapeForProject(late, clock).shape).toBe("behind");
  });

  it("uses the last recorded movement for undated projects and imperatives", () => {
    const sixDays = project({
      createdAt: "2026-10-28T12:00:00+10:30",
      updatedAt: "2026-10-28T12:00:00+10:30",
    });
    const sevenDays = imperative({
      setOn: "2026-10-27",
      createdAt: "2026-10-27T12:00:00+10:30",
      updatedAt: "2026-10-27T12:00:00+10:30",
    });
    expect(timingShapeForProject(sixDays, clock).shape).toBe("on-track");
    expect(timingShapeForImperative(sevenDays, clock).shape).toBe("behind");
  });
});
