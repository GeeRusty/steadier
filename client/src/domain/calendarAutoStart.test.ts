import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import {
  calendarFocusStartDecision,
  dueCalendarFocusStarts,
} from "./calendarAutoStart";
import { emptyRepeat, emptyTaskSchedule } from "./time";
import type { Task } from "./types";

const TODAY = "2026-11-02";

function task(extra: Partial<Task> = {}): Task {
  return createTask(
    {
      title: "Prepare the garden",
      createdAt: `${TODAY}T08:00:00`,
      estimate: 45,
      schedule: {
        ...emptyTaskSchedule(),
        date: TODAY,
        time: "09:00",
        minutes: 45,
        fixed: true,
      },
      ...extra,
    },
    TODAY
  );
}

describe("automatic Calendar focus starts", () => {
  it("restarts a paused or expired same-task timer without replacing other focus", () => {
    expect(calendarFocusStartDecision("scheduled", null, false, true, true)).toBe(
      "start"
    );
    expect(
      calendarFocusStartDecision(
        "scheduled",
        { taskId: "scheduled", remaining: 400, running: true },
        false,
        true,
        true
      )
    ).toBe("already-active");
    expect(
      calendarFocusStartDecision(
        "scheduled",
        { taskId: "scheduled", remaining: 400, running: false },
        false,
        true,
        true
      )
    ).toBe("start");
    expect(
      calendarFocusStartDecision(
        "scheduled",
        { taskId: "scheduled", remaining: 0, running: false },
        false,
        true,
        true
      )
    ).toBe("start");
    expect(
      calendarFocusStartDecision(
        "scheduled",
        { taskId: "other", remaining: 400, running: false },
        false,
        true,
        true
      )
    ).toBe("wait-for-current-focus");
    expect(
      calendarFocusStartDecision("scheduled", null, true, true, true)
    ).toBe("wait-for-remote-focus");
    expect(
      calendarFocusStartDecision("scheduled", null, false, true, false)
    ).toBe("task-not-ready");
    expect(
      calendarFocusStartDecision("scheduled", null, false, false, true)
    ).toBe("focus-unavailable");
  });

  it("selects an open booked timer at its Adelaide start and within the 15-minute catch-up window", () => {
    const booked = task();
    const atStart = dueCalendarFocusStarts([booked], [], TODAY, 9 * 60);
    const caughtUp = dueCalendarFocusStarts([booked], [], TODAY, 9 * 60 + 15);

    expect(atStart).toHaveLength(1);
    expect(atStart[0]).toMatchObject({
      taskId: booked.id,
      date: TODAY,
      start: 9 * 60,
      durationMinutes: 45,
      kind: "slot",
    });
    expect(caughtUp[0]?.taskId).toBe(booked.id);
    expect(dueCalendarFocusStarts([booked], [], TODAY, 9 * 60 + 16)).toEqual(
      []
    );
  });

  it("ignores completed, date-only, flexible-window, and already-handled items", () => {
    const done = task({ state: "done", completedAt: `${TODAY}T08:59:00` });
    const dateOnly = task({
      schedule: {
        ...emptyTaskSchedule(),
        date: TODAY,
        time: null,
        fixed: true,
      },
    });
    const flexible = task({
      schedule: {
        ...emptyTaskSchedule(),
        date: null,
        time: null,
        fixed: false,
        flexibleWindow: { startDate: TODAY, endDate: "2026-11-03" },
      },
    });
    const booked = task();
    const candidate = dueCalendarFocusStarts([booked], [], TODAY, 9 * 60)[0];

    expect(
      dueCalendarFocusStarts([done, dateOnly, flexible], [], TODAY, 9 * 60)
    ).toEqual([]);
    expect(
      dueCalendarFocusStarts(
        [booked],
        [],
        TODAY,
        9 * 60,
        new Set([candidate.key])
      )
    ).toEqual([]);
  });

  it("recognizes the current projected occurrence of a weekly booked task", () => {
    const recurring = task({
      schedule: {
        ...emptyTaskSchedule(),
        date: "2026-10-26",
        time: "09:00",
        minutes: 60,
        fixed: true,
        repeat: emptyRepeat("weekly"),
        repeatAnchorDate: "2026-10-26",
      },
    });

    expect(
      dueCalendarFocusStarts([recurring], [], TODAY, 9 * 60)[0]
    ).toMatchObject({
      taskId: recurring.id,
      date: TODAY,
      start: 9 * 60,
      durationMinutes: 60,
      kind: "projected",
    });
  });
});
