import { describe, expect, it } from "vitest";
import { buildCalendar, countOverlappingTimedItems } from "./calendarModel";
import { createTask } from "./engine";
import {
  emptyRepeat,
  emptyTaskSchedule,
  rescheduleOccurrenceSchedule,
} from "./time";
import type { Project } from "./types";

const DATE = "2026-11-05";

describe("calendar recurrence projections", () => {
  it("shows a moved occurrence at its new date without shifting the series pattern", () => {
    const task = createTask(
      {
        title: "Take recycling out",
        schedule: {
          ...createTask({ title: "template" }).schedule,
          date: "2026-10-26",
          time: "09:00",
          fixed: true,
          majorAnchor: true,
          repeat: { ...emptyRepeat("weekly"), weekdays: [1] },
        },
      },
      "2026-10-20"
    );
    const moved = {
      ...task,
      schedule: rescheduleOccurrenceSchedule(task.schedule, {
        date: "2026-11-10",
        time: "11:00",
      }),
    };
    const dates = [
      "2026-10-26",
      "2026-11-02",
      "2026-11-09",
      "2026-11-10",
      "2026-11-16",
    ];
    const calendar = buildCalendar([moved], [], dates, "2026-10-25");

    expect(calendar.find(day => day.date === "2026-10-26")?.timed).toEqual([]);
    expect(
      calendar.find(day => day.date === "2026-11-02")?.timed
    ).toMatchObject([{ kind: "projected", start: 540, majorAnchor: true }]);
    expect(
      calendar.find(day => day.date === "2026-11-09")?.timed
    ).toMatchObject([{ kind: "projected", start: 540, majorAnchor: true }]);
    expect(
      calendar.find(day => day.date === "2026-11-10")?.timed
    ).toMatchObject([{ kind: "slot", start: 660 }]);
    expect(
      calendar.find(day => day.date === "2026-11-16")?.timed
    ).toMatchObject([{ kind: "projected", start: 540, majorAnchor: true }]);
  });

  it("does not project beyond a finite repeat count", () => {
    const task = createTask(
      {
        title: "Two-week task",
        schedule: {
          ...createTask({ title: "template" }).schedule,
          date: "2026-10-26",
          time: "09:00",
          fixed: true,
          repeat: { ...emptyRepeat("weekly"), weekdays: [1], count: 2 },
        },
      },
      "2026-10-20"
    );
    const calendar = buildCalendar(
      [task],
      [],
      ["2026-10-26", "2026-11-02", "2026-11-09"],
      "2026-10-25"
    );

    expect(
      calendar.find(day => day.date === "2026-11-02")?.timed
    ).toMatchObject([{ kind: "projected" }]);
    expect(calendar.find(day => day.date === "2026-11-09")?.timed).toEqual([]);
  });

  it("keeps future instances visible when this occurrence has no calendar date", () => {
    const task = createTask(
      {
        title: "Weekly planning",
        schedule: {
          ...createTask({ title: "template" }).schedule,
          date: "2026-10-26",
          time: "09:00",
          fixed: true,
          repeat: { ...emptyRepeat("weekly"), weekdays: [1] },
        },
      },
      "2026-10-20"
    );
    const unscheduled = {
      ...task,
      schedule: rescheduleOccurrenceSchedule(task.schedule, {
        date: null,
        time: null,
      }),
    };
    const calendar = buildCalendar(
      [unscheduled],
      [],
      ["2026-10-26", "2026-11-02"],
      "2026-10-25"
    );

    expect(calendar.find(day => day.date === "2026-10-26")?.timed).toEqual([]);
    expect(
      calendar.find(day => day.date === "2026-11-02")?.timed
    ).toMatchObject([{ kind: "projected", start: 540 }]);
  });

  it("does not draw a duplicate projection when a move lands on another repeat day", () => {
    const task = createTask(
      {
        title: "Morning check-in",
        schedule: {
          ...createTask({ title: "template" }).schedule,
          date: "2026-10-26",
          time: "09:00",
          fixed: true,
          repeat: { ...emptyRepeat("weekly"), weekdays: [1, 2] },
        },
      },
      "2026-10-20"
    );
    const moved = {
      ...task,
      schedule: rescheduleOccurrenceSchedule(task.schedule, {
        date: "2026-10-27",
        time: "11:00",
      }),
    };
    const calendar = buildCalendar(
      [moved],
      [],
      ["2026-10-26", "2026-10-27", "2026-11-02"],
      "2026-10-25"
    );

    expect(
      calendar.find(day => day.date === "2026-10-27")?.timed
    ).toMatchObject([{ kind: "slot", start: 660 }]);
  });

  it("keeps flexible windows off the calendar grid and never treats a hybrid as booked", () => {
    const task = createTask({
      title: "Weekend task",
      schedule: {
        ...emptyTaskSchedule(),
        minutes: 120,
        flexibleWindow: {
          startDate: "2026-11-07",
          endDate: "2026-11-08",
        },
      },
    });
    const dates = ["2026-11-07", "2026-11-08"];
    const calendar = buildCalendar([task], [], dates, "2026-11-01");

    for (const date of dates) {
      const day = calendar.find(entry => entry.date === date)!;
      expect(day.allDay).toEqual([]);
      expect(day.timed).toEqual([]);
    }

    const hybrid = {
      ...task,
      schedule: { ...task.schedule, date: dates[0], time: "09:00" },
    };
    const hybridCalendar = buildCalendar([hybrid], [], dates, "2026-11-01");
    expect(hybridCalendar[0].allDay).toEqual([]);
    expect(hybridCalendar[0].timed).toEqual([]);
  });

  it("shows ordinary self-chosen dates nowhere on the grid but keeps a real deadline time as a point marker", () => {
    const selfChosen = createTask({
      title: "Self-chosen date",
      deadline: DATE,
      schedule: {
        ...emptyTaskSchedule(),
        date: DATE,
        time: "10:00",
        fixed: false,
      },
    });
    const hardDeadline = createTask({
      title: "Court filing",
      deadline: DATE,
      schedule: { ...emptyTaskSchedule(), deadlineTime: "16:30" },
    });
    const day = buildCalendar(
      [selfChosen, hardDeadline],
      [],
      [DATE],
      "2026-11-04"
    )[0];

    expect(day.allDay).toEqual([]);
    expect(day.dateMarkers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "planned-date",
          title: "Self-chosen date",
          fixed: false,
          label: "Planned date · not booked",
        }),
      expect.objectContaining({
        kind: "deadline",
        title: "Self-chosen date",
        fixed: false,
        label: "Hard deadline",
      }),
      ])
    );
    expect(day.timed).toMatchObject([
      { kind: "deadline", title: "Court filing", start: 990, minutes: 0, fixed: false },
    ]);
    expect(day.timed[0].lanes).toBe(1);
    expect(countOverlappingTimedItems(day.timed)).toBe(0);
  });

  it("keeps active project dates visible as informational markers outside booked time", () => {
    const project = {
      id: "project-1",
      title: "Synthetic project",
      status: "active",
      milestones: [
        { id: "milestone-1", title: "Synthetic milestone", done: false },
        { id: "milestone-done", title: "Finished milestone", done: true },
      ],
      schedule: {
        deadline: DATE,
        reviewDate: DATE,
        weeklyBudgetMinutes: null,
        milestoneDates: [
          { id: "milestone-1", date: DATE },
          { id: "milestone-done", date: DATE },
        ],
      },
    } as unknown as Project;
    const day = buildCalendar([], [project], [DATE], "2026-11-04")[0];

    expect(day.timed).toEqual([]);
    expect(day.allDay).toEqual([]);
    expect(day.dateMarkers).toMatchObject([
      { kind: "project-deadline", label: "Project deadline", fixed: false },
      { kind: "milestone", label: "Milestone", fixed: false },
      { kind: "project-review", label: "Project review", fixed: false },
    ]);
    expect(day.dateMarkers).toHaveLength(3);
  });

  it("projects non-booked recurring tasks as date-only markers, never clock blocks", () => {
    const task = createTask({
      title: "Synthetic unbooked repeating task",
      schedule: {
        ...emptyTaskSchedule(),
        date: DATE,
        time: "10:00",
        fixed: false,
        repeat: { ...emptyRepeat("weekly"), weekdays: [4] },
        repeatAnchorDate: DATE,
        repeatOccurrenceDate: DATE,
      },
    });
    const followingWeek = "2026-11-12";
    const days = buildCalendar(
      [task],
      [],
      [DATE, followingWeek],
      "2026-11-04"
    );

    expect(days.map(day => day.timed)).toEqual([[], []]);
    expect(days.map(day => day.allDay)).toEqual([[], []]);
    expect(days.map(day => day.dateMarkers.map(item => item.label))).toEqual([
      ["Not booked · repeats"],
      ["Not booked · repeats"],
    ]);
  });

  it("counts overlapping timed pairs but not adjacent blocks", () => {
    const blocks = [
      { id: "a", kind: "slot" as const, date: DATE, title: "A", start: 540, minutes: 60 },
      { id: "b", kind: "slot" as const, date: DATE, title: "B", start: 570, minutes: 30 },
      { id: "c", kind: "slot" as const, date: DATE, title: "C", start: 600, minutes: 30 },
    ];

    expect(countOverlappingTimedItems(blocks)).toBe(1);
    expect(
      countOverlappingTimedItems([
        { ...blocks[0], start: 540, minutes: 60 },
        { ...blocks[1], start: 600, minutes: 30 },
      ])
    ).toBe(0);
  });
});
