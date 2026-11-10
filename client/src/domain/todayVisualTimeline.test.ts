import { describe, expect, it } from "vitest";
import { emptyProjectCompass } from "./compass";
import { createTask } from "./engine";
import { buildTodayVisualTimelineModel } from "./todayVisualTimeline";
import {
  DEFAULT_PLANNING,
  emptyProjectSchedule,
  emptyTaskSchedule,
} from "./time";
import type { Project } from "./types";

const DATE = "2026-11-05";

function projectFixture(): Project {
  return {
    id: "synthetic-project",
    title: "Synthetic launch",
    purpose: "Synthetic purpose",
    outcome: "Synthetic outcome",
    role: "direction",
    pattern: "timely",
    status: "active",
    milestones: [{ id: "draft", title: "Prepare draft", done: false }],
    progress: [],
    createdAt: `${DATE}T08:00:00+10:30`,
    updatedAt: `${DATE}T08:00:00+10:30`,
    schedule: {
      ...emptyProjectSchedule(),
      deadline: DATE,
      reviewDate: DATE,
      milestoneDates: [{ id: "draft", date: DATE }],
    },
    compass: emptyProjectCompass(),
  };
}

describe("Today visual timeline model", () => {
  it("keeps the booked start at 08:59 when the synthetic Now marker is 07:14", () => {
    const task = createTask(
      {
        title: "Synthetic 08:59 cleaning",
        state: "ready",
        schedule: {
          ...emptyTaskSchedule(),
          date: DATE,
          time: "08:59",
          minutes: 45,
          fixed: true,
        },
      },
      DATE
    );

    const model = buildTodayVisualTimelineModel(
      [task],
      [],
      DATE,
      7 * 60 + 14
    );
    const booked = model.day.timed.find(item => item.kind === "slot");

    expect(booked).toMatchObject({
      title: "Synthetic 08:59 cleaning",
      start: 8 * 60 + 59,
      minutes: 45,
      done: false,
      fixed: true,
    });
  });

  it("shows booked anchors only and keeps date-only work and actual logs out of the clock strip", () => {
    const timed = createTask(
      {
        title: "Synthetic appointment",
        state: "ready",
        deadline: DATE,
        schedule: {
          ...emptyTaskSchedule(),
          date: DATE,
          time: "09:00",
          minutes: 60,
          fixed: true,
          deadlineTime: "09:30",
          timeLog: [
            { start: `${DATE}T08:15`, minutes: 20, source: "manual" },
          ],
        },
      },
      DATE
    );
    const anytime = createTask(
      {
        title: "Synthetic any-time task",
        state: "ready",
        schedule: { ...emptyTaskSchedule(), date: DATE },
      },
      DATE
    );
    const flexible = createTask(
      {
        title: "Synthetic flexible task",
        state: "ready",
        schedule: {
          ...emptyTaskSchedule(),
          flexibleWindow: { startDate: DATE, endDate: DATE },
        },
      },
      DATE
    );

    const model = buildTodayVisualTimelineModel(
      [timed, anytime, flexible],
      [projectFixture()],
      DATE,
      7 * 60 + 15,
      DEFAULT_PLANNING
    );

    expect(model.day.timed).toMatchObject([
      { kind: "slot", title: "Synthetic appointment", start: 540, minutes: 60 },
      { kind: "deadline", title: "Synthetic appointment", start: 570, minutes: 0 },
    ]);
    expect(model.day.allDay).toEqual([]);
    expect(model.day.actual).toMatchObject([
      { title: "Synthetic appointment", start: `${DATE}T08:15`, minutes: 20 },
    ]);
    expect(model.startHour).toBe(7);
    expect(model.endHour).toBe(18);
    expect(model.overlapCount).toBe(0);
    expect(model.freeAfterMinutes).toBe(480);
    expect(model.freeAfterLabel).toBe("Free after Synthetic appointment");
  });

  it("extends the timeline for late blocks, counts overlap pairs and treats completed blocks as released time", () => {
    const first = createTask(
      {
        title: "Synthetic late block A",
        state: "ready",
        schedule: {
          ...emptyTaskSchedule(),
          date: DATE,
          time: "19:15",
          minutes: 30,
          fixed: true,
        },
      },
      DATE
    );
    const second = createTask(
      {
        title: "Synthetic late block B",
        state: "ready",
        schedule: {
          ...emptyTaskSchedule(),
          date: DATE,
          time: "19:30",
          minutes: 30,
          fixed: true,
        },
      },
      DATE
    );
    const completed = createTask(
      {
        title: "Synthetic completed block",
        state: "done",
        schedule: {
          ...emptyTaskSchedule(),
          date: DATE,
          time: "16:00",
          minutes: 30,
          fixed: true,
        },
      },
      DATE
    );

    const model = buildTodayVisualTimelineModel(
      [first, second, completed],
      [],
      DATE,
      15 * 60
    );

    expect(model.day.timed).toHaveLength(3);
    expect(model.endHour).toBe(20);
    expect(model.overlapCount).toBe(1);
    expect(model.freeAfterMinutes).toBe(0);
  });
});
