import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import { emptyTaskSchedule, emptyRepeat, type TaskSchedule } from "./time";
import {
  applyPlan,
  applyReset,
  logTime,
  missedBlocks,
  planMyDay,
  plannedVsActual,
  resetMyDay,
  weeklyBudgets,
} from "./planning";
import {
  buildCalendar,
  freeGaps,
  layoutLanes,
  type CalendarItem,
} from "./calendarModel";
import type { Project, Task } from "./types";

const TODAY = "2026-10-27"; // Tuesday
function task(
  title: string,
  schedule: Partial<TaskSchedule> = {},
  extra: Partial<Task> = {}
): Task {
  const t = createTask({
    title,
    schedule: { ...emptyTaskSchedule(), ...schedule },
  } as never);
  return { ...t, state: "ready", estimate: 30, ...extra };
}

describe("planning", () => {
  it("keeps self-chosen tasks untimed and never moves Calendar items from Today", () => {
    const recurring = task("Walk", {
      date: TODAY,
      time: "09:00",
      repeat: { ...emptyRepeat("weekly"), weekdays: [2] },
    });
    const plan = applyPlan(
      [recurring],
      [
        {
          taskId: recurring.id,
          title: recurring.title,
          date: "2026-10-28",
          start: 10 * 60,
          minutes: 30,
        },
      ]
    );
    expect(plan[0].schedule).toEqual(recurring.schedule);

    const reset = applyReset(
      [recurring],
      [
        {
          taskId: recurring.id,
          title: recurring.title,
          date: "2026-10-28",
          start: -1,
          minutes: 30,
        },
      ]
    );
    expect(reset[0].schedule).toEqual(recurring.schedule);
  });

  it("does not propose or apply automatic time blocks for ready work", () => {
    const meeting = task("Meeting", {
      date: TODAY,
      time: "10:00",
      minutes: 60,
      fixed: true,
    });
    const a = task("Write report", {}, { pinned: true });
    const b = task("Email Jo", {}, { estimate: 15 });
    const plan = planMyDay([meeting, a, b], TODAY, 9 * 60 + 20, {
      dayStart: "08:00",
      dayEnd: "18:00",
      bufferMinutes: 10,
    });
    expect(plan).toEqual([]);
    const applied = applyPlan([meeting, a, b], plan);
    expect(applied).toEqual([meeting, a, b]);
  });

  it("marks only missed booked anchors and leaves movement to Calendar", () => {
    const legacyTime = task("Gym", { date: TODAY, time: "07:00", minutes: 45 });
    const anchor = task("Dentist", {
      date: TODAY,
      time: "08:00",
      minutes: 30,
      fixed: true,
    });
    const later = task("Call", { date: TODAY, time: "16:00", minutes: 15 });
    const missed = missedBlocks([legacyTime, anchor, later], TODAY, 9 * 60);
    expect(missed.map(t => t.title)).toEqual(["Dentist"]);
    const plan = resetMyDay([legacyTime, anchor, later], TODAY, 9 * 60, {
      dayStart: "08:00",
      dayEnd: "18:00",
      bufferMinutes: 0,
    });
    expect(plan).toEqual([]);
    expect(applyReset([legacyTime, anchor, later], plan)).toEqual([
      legacyTime,
      anchor,
      later,
    ]);
    expect(missedBlocks([legacyTime, anchor, later], TODAY, 9 * 60)).toHaveLength(1);
  });

  it("does not auto-move a missed anchor to tomorrow", () => {
    const slipped = task("Deep work", {
      date: TODAY,
      time: "08:00",
      minutes: 120,
    });
    const plan = resetMyDay([slipped], TODAY, 17 * 60, {
      dayStart: "08:00",
      dayEnd: "18:00",
      bufferMinutes: 0,
    });
    expect(plan).toEqual([]);
  });

  it("tracks weekly budgets and planned vs actual", () => {
    const project = {
      id: "p1",
      title: "Health",
      status: "active",
      schedule: {
        deadline: null,
        reviewDate: null,
        weeklyBudgetMinutes: 120,
        milestoneDates: [],
      },
    } as unknown as Project;
    let walk = task(
      "Walk",
      { date: TODAY, time: "17:00", minutes: 30, fixed: true },
      { projectId: "p1" }
    );
    walk = logTime(walk, "2026-10-26T07:00", 40, "focus");
    walk = logTime(walk, "2026-10-19T07:00", 50, "focus"); // last week
    const [budget] = weeklyBudgets([project], [walk], TODAY);
    expect(budget.spent).toBe(40);
    expect(budget.planned).toBe(30);
    const totals = plannedVsActual([walk], ["2026-10-26", TODAY]);
    expect(totals).toEqual([
      { date: "2026-10-26", planned: 0, actual: 40 },
      { date: TODAY, planned: 30, actual: 0 },
    ]);
  });
});

describe("calendar model", () => {
  it("projects future occurrences and lays out overlaps side by side", () => {
    const weekly = task("Piano", {
      date: TODAY,
      time: "18:00",
      minutes: 30,
      fixed: true,
      repeat: { ...emptyRepeat("weekly"), weekdays: [2, 4] },
    });
    const overlap = task("Dinner", {
      date: TODAY,
      time: "18:15",
      minutes: 45,
      fixed: true,
    });
    const days = buildCalendar(
      [weekly, overlap],
      [],
      ["2026-10-27", "2026-10-28", "2026-10-29"],
      TODAY
    );
    expect(days[0].timed.map(i => i.title).sort()).toEqual(["Dinner", "Piano"]);
    expect(days[0].timed.every(i => i.lanes === 2)).toBe(true);
    expect(days[1].timed).toHaveLength(0);
    expect(days[2].timed[0]).toMatchObject({
      kind: "projected",
      title: "Piano",
      start: 18 * 60,
    });
  });

  it("computes free gaps", () => {
    expect(
      freeGaps(
        [
          { start: 600, end: 660 },
          { start: 650, end: 700 },
        ],
        540,
        720
      )
    ).toEqual([
      { start: 540, end: 600 },
      { start: 700, end: 720 },
    ]);
    const items = [
      { id: "a", start: 0, minutes: 30 },
      { id: "b", start: 60, minutes: 30 },
    ] as CalendarItem[];
    layoutLanes(items);
    expect(items.map(i => i.lanes)).toEqual([1, 1]);
  });
});
