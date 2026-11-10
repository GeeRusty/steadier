import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import {
  estimateAnchorFinish,
  freeAfterLastAnchorMinutes,
  isTaskAnchor,
  markDropped,
  markStillOn,
  passOverThreshold,
  pastDueDate,
  pastDueTasks,
  poolTasks,
  recordNotNow,
} from "./anchorPlanning";
import { DEFAULT_PLANNING, emptyTaskSchedule } from "./time";

const DAY = "2026-11-05";

function task(
  title: string,
  schedule: ReturnType<typeof emptyTaskSchedule> = emptyTaskSchedule(),
  extra: Record<string, unknown> = {}
) {
  return createTask({ title, estimate: 60, schedule, ...extra }, DAY);
}

describe("anchor planning", () => {
  it("keeps self-chosen scheduled tasks in the pool but hides future booked anchors", () => {
    const selfChosen = task("Choose freely", {
      ...emptyTaskSchedule(),
      date: DAY,
      time: "14:00",
      fixed: false,
    });
    const booked = task("Booked visit", {
      ...emptyTaskSchedule(),
      date: DAY,
      time: "14:00",
      minutes: 60,
      fixed: true,
    });

    expect(isTaskAnchor(selfChosen)).toBe(false);
    expect(isTaskAnchor(booked)).toBe(true);
    expect(poolTasks([selfChosen, booked], DAY, 10 * 60).map(t => t.title)).toEqual([
      "Choose freely",
    ]);
  });

  it("returns an ended booked task to the pool without adding an overdue label or changing it", () => {
    const slipped = task("Earlier booking", {
      ...emptyTaskSchedule(),
      date: DAY,
      time: "08:00",
      minutes: 60,
      fixed: true,
    });
    const pool = poolTasks([slipped], DAY, 10 * 60);

    expect(pool.map(t => t.id)).toEqual([slipped.id]);
    expect(slipped.schedule.date).toBe(DAY);
    expect(slipped.schedule.missedHandled).toBeNull();
  });

  it("keeps future availability out of the pool and returns expired non-anchor dates without a late state", () => {
    const futureWindow = task("Next weekend", {
      ...emptyTaskSchedule(),
      flexibleWindow: { startDate: "2026-11-07", endDate: "2026-11-08" },
    });
    const expiredDate = task(
      "Old self-chosen date",
      { ...emptyTaskSchedule(), date: "2026-11-03", time: "09:00", fixed: false },
      { deadline: "2026-11-03" }
    );

    expect(poolTasks([futureWindow, expiredDate], DAY, 10 * 60).map(t => t.id)).toEqual([
      expiredDate.id,
    ]);
  });

  it("increments pass-overs, resets Still on, and keeps Dropped as a decision", () => {
    const original = task("Tax folder");
    const passed = recordNotNow(
      recordNotNow(
        recordNotNow(original, "2026-11-05T09:00:00+10:30"),
        "2026-11-05T09:01:00+10:30"
      ),
      "2026-11-05T09:02:00+10:30"
    );
    const stillOn = markStillOn(passed, "2026-11-05T09:03:00+10:30");
    const dropped = markDropped(passed, "2026-11-05T10:00:00+10:30");

    expect(passed.passOverCount).toBe(3);
    expect(stillOn.passOverCount).toBe(0);
    expect(dropped.droppedAt).toBe("2026-11-05T10:00:00+10:30");
    expect(dropped.title).toBe(original.title);
    expect(dropped.state).toBe(original.state);
  });

  it("defaults the inline review prompt to three and supports a workspace override", () => {
    expect(passOverThreshold({ planning: DEFAULT_PLANNING })).toBe(3);
    expect(
      passOverThreshold({
        planning: { ...DEFAULT_PLANNING, passOverThreshold: 5 },
      })
    ).toBe(5);
  });

  it("uses a median personal overrun ratio after three completed anchor samples", () => {
    const samples = [90, 120, 30].map((minutes, index) =>
      task(
        `Completed ${index}`,
        {
          ...emptyTaskSchedule(),
          date: `2026-11-0${index + 1}`,
          time: "10:00",
          minutes: 60,
          fixed: true,
          completions: [`2026-11-0${index + 1}`],
          timeLog: [
            {
              start: `2026-11-0${index + 1}T10:00:00+10:30`,
              minutes,
              source: "manual" as const,
            },
          ],
        },
        { state: "done" }
      )
    );
    const current = task("Today's booking", {
      ...emptyTaskSchedule(),
      date: DAY,
      time: "15:00",
      minutes: 60,
      fixed: true,
    });

    expect(estimateAnchorFinish(current, [...samples, current])).toMatchObject({
      plannedEnd: 16 * 60,
      likelyEnd: 16 * 60 + 30,
      samples: 3,
    });
  });

  it("uses the history-learning fallback and reports free capacity numerically", () => {
    const booking = task("Di cleaning", {
      ...emptyTaskSchedule(),
      date: DAY,
      time: "08:15",
      minutes: 420,
      fixed: true,
    });
    expect(estimateAnchorFinish(booking, [booking])).toMatchObject({
      likelyEnd: null,
      samples: 0,
    });
    expect(
      freeAfterLastAnchorMinutes(
        [booking],
        DAY,
        { ...DEFAULT_PLANNING, dayEnd: "18:00" },
        11 * 60 + 5,
        DAY
      )
    ).toBe(165);
  });
});

describe("past due list", () => {
  const sched = (extra: Partial<ReturnType<typeof emptyTaskSchedule>>) => ({
    ...emptyTaskSchedule(),
    ...extra,
  });
  it("lists open items whose planned day, deadline or whole window has passed, oldest first", () => {
    const plannedDay = task("Planned last week", sched({ date: "2026-11-01" }));
    const deadline = task("Deadline passed", emptyTaskSchedule(), {
      deadline: "2026-10-20",
    });
    const closedWindow = task(
      "Closed weekend",
      sched({
        flexibleWindow: { startDate: "2026-11-07", endDate: "2026-11-08" },
      })
    );
    const openWindow = task(
      "Window still open",
      sched({
        flexibleWindow: { startDate: "2026-11-07", endDate: "2026-11-08" },
      })
    );
    const future = task("Future", sched({ date: "2026-11-20" }));
    const undated = task("No date");
    const titles = pastDueTasks(
      [future, plannedDay, undated, deadline, closedWindow],
      "2026-11-09"
    ).map(t => t.title);
    expect(titles).toEqual(["Deadline passed", "Planned last week", "Closed weekend"]);
    // A window is not past while its last day is still today or later.
    expect(pastDueTasks([openWindow], "2026-11-08")).toHaveLength(0);
    expect(pastDueTasks([openWindow], "2026-11-07")).toHaveLength(0);
    expect(pastDueDate(openWindow)).toBe("2026-11-08");
  });
  it("leaves out done and Someday items and never changes the tasks", () => {
    const done = { ...task("Done", sched({ date: "2026-11-01" })), state: "done" as const };
    const someday = { ...task("Parked", sched({ date: "2026-11-01" })), state: "someday" as const };
    const live = task("Live", sched({ date: "2026-11-01" }));
    const before = JSON.stringify([done, someday, live]);
    expect(pastDueTasks([done, someday, live], "2026-11-05").map(t => t.title)).toEqual(["Live"]);
    expect(JSON.stringify([done, someday, live])).toBe(before);
  });
});
