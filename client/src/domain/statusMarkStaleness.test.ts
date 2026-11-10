import { describe, expect, it } from "vitest";
import type { Imperative } from "./compass";
import { emptyProjectCompass } from "./compass";
import { createTask } from "./engine";
import { emptyProjectSchedule, emptyTaskSchedule } from "./time";
import type { Project, Task } from "./types";
import {
  STATUS_MARK_GREY_HEX,
  statusMarkColorAfterReviewFade,
  statusMarkStalenessForImperative,
  statusMarkStalenessForProject,
  statusMarkStalenessForTask,
  visibleStatusMarkColor,
} from "./statusMarkStaleness";

const CLOCK = { date: "2026-11-03", minutes: 600 };

function task(overrides: Partial<Task> = {}): Task {
  return createTask(
    {
      title: "Synthetic Stage 3 task",
      state: "ready",
      reviewDate: null,
      deadline: null,
      startDate: null,
      preparationDate: null,
      schedule: emptyTaskSchedule(),
      history: [],
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
    title: "Synthetic Project",
    purpose: "A synthetic purpose",
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
    title: "Synthetic Imperative",
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

describe("Stage 3 status-mark staleness", () => {
  it("derives 0, 7, 13 and 14+ Adelaide-local days since Weekly Review", () => {
    expect(
      statusMarkStalenessForTask(task(), "2026-11-03", CLOCK).daysSinceReview
    ).toBe(0);
    expect(
      statusMarkStalenessForTask(task(), "2026-10-27", CLOCK).daysSinceReview
    ).toBe(7);
    expect(
      statusMarkStalenessForTask(task(), "2026-10-21", CLOCK).daysSinceReview
    ).toBe(13);
    expect(
      statusMarkStalenessForTask(task(), "2026-10-20", CLOCK).daysSinceReview
    ).toBe(14);
    expect(
      statusMarkStalenessForTask(task(), null, CLOCK).daysSinceReview
    ).toBeNull();
    expect(
      statusMarkStalenessForTask(task(), "2026-11-05", CLOCK).daysSinceReview
    ).toBe(0);
  });

  it("fades a hue progressively and reaches neutral grey at day 14", () => {
    expect(statusMarkColorAfterReviewFade("green", 0)).toBe("#009f55");
    expect(statusMarkColorAfterReviewFade("green", 7)).toBe("#19915c");
    expect(statusMarkColorAfterReviewFade("green", 14)).toBe(
      STATUS_MARK_GREY_HEX
    );
    expect(
      visibleStatusMarkColor("red", {
        grey: true,
        reason: "synthetic grey override",
        quietDays: 0,
        daysSinceReview: 1,
      })
    ).toBe(STATUS_MARK_GREY_HEX);
  });

  it("greys a task at 14 quiet days, not at 13, without mutating it", () => {
    const thirteenDays = task({
      createdAt: "2026-10-21T09:00:00+10:30",
      updatedAt: "2026-10-21T09:00:00+10:30",
    });
    const fourteenDays = task({
      createdAt: "2026-10-20T09:00:00+10:30",
      updatedAt: "2026-10-20T09:00:00+10:30",
    });
    const before = JSON.stringify(fourteenDays);
    expect(statusMarkStalenessForTask(thirteenDays, null, CLOCK)).toMatchObject(
      {
        grey: false,
        quietDays: 13,
      }
    );
    expect(statusMarkStalenessForTask(fourteenDays, null, CLOCK)).toMatchObject(
      {
        grey: true,
        quietDays: 14,
      }
    );
    expect(JSON.stringify(fourteenDays)).toBe(before);
  });

  it("greys a task when its review date is due today or earlier, but not tomorrow", () => {
    expect(
      statusMarkStalenessForTask(
        task({ reviewDate: "2026-11-03" }),
        null,
        CLOCK
      ).grey
    ).toBe(true);
    expect(
      statusMarkStalenessForTask(
        task({ reviewDate: "2026-11-02" }),
        null,
        CLOCK
      ).grey
    ).toBe(true);
    expect(
      statusMarkStalenessForTask(
        task({ reviewDate: "2026-11-04" }),
        null,
        CLOCK
      ).grey
    ).toBe(false);
  });

  it("never greys Someday tasks even when quiet and review dates are old", () => {
    const someday = task({
      state: "someday",
      reviewDate: "2026-10-01",
      createdAt: "2026-09-01T09:00:00+09:30",
      updatedAt: "2026-09-01T09:00:00+09:30",
    });
    expect(
      statusMarkStalenessForTask(someday, "2026-10-01", CLOCK)
    ).toMatchObject({
      grey: false,
      reason: null,
      quietDays: 63,
    });
  });

  it("greys an empty-purpose Project and honors a due Project review date", () => {
    expect(
      statusMarkStalenessForProject(project({ purpose: "  \n " }), null, CLOCK)
    ).toMatchObject({ grey: true, reason: "The Project has no purpose." });

    const due = project({
      schedule: { ...emptyProjectSchedule(), reviewDate: "2026-11-03" },
    });
    expect(statusMarkStalenessForProject(due, null, CLOCK)).toMatchObject({
      grey: true,
      reason: "Project review date 2026-11-03 is due today or has passed.",
    });
    const future = project({
      schedule: { ...emptyProjectSchedule(), reviewDate: "2026-11-04" },
    });
    expect(statusMarkStalenessForProject(future, null, CLOCK).grey).toBe(false);
  });

  it("greys quiet Projects and Imperatives at the same 14-day boundary", () => {
    const quietProject = project({
      createdAt: "2026-10-20T09:00:00+10:30",
      updatedAt: "2026-10-20T09:00:00+10:30",
    });
    const quietImperative = imperative({
      setOn: "2026-10-20",
      createdAt: "2026-10-20T09:00:00+10:30",
      updatedAt: "2026-10-20T09:00:00+10:30",
    });
    expect(
      statusMarkStalenessForProject(quietProject, null, CLOCK)
    ).toMatchObject({
      grey: true,
      quietDays: 14,
    });
    expect(
      statusMarkStalenessForImperative(quietImperative, null, CLOCK)
    ).toMatchObject({
      grey: true,
      quietDays: 14,
    });
  });
});
