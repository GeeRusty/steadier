import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCalendar } from "./calendarModel";
import { completeTask, createTask } from "./engine";
import {
  adelaideClock,
  describeFlexibleRecurrence,
  emptyRepeat,
  emptyTaskSchedule,
  setFlexibleRecurrenceAnchor,
  shiftDays,
  type TaskSchedule,
} from "./time";
import type { Workspace } from "./types";
import CalendarView from "../components/steadier/CalendarView";

afterEach(() => vi.unstubAllGlobals());

// 2026-11-07 is a Saturday, 2026-11-08 a Sunday (Australia/Adelaide dates).
const SAT = "2026-11-07";
const SUN = "2026-11-08";

function weekendClean(repeating: boolean) {
  const schedule: TaskSchedule = {
    ...emptyTaskSchedule(),
    flexibleWindow: { startDate: SAT, endDate: SUN },
    minutes: 120,
    ...(repeating
      ? {
          repeat: { ...emptyRepeat("weekly"), weekdays: [] },
          repeatAnchorDate: SAT,
          repeatOccurrenceDate: SAT,
          repeatTime: null,
        }
      : {}),
  };
  return createTask({ id: "synthetic-weekend", title: "Synthetic weekend job", schedule }, SAT);
}

const DATES = Array.from({ length: 16 }, (_, i) => shiftDays(SAT, i));

describe("flexible recurring window on the Calendar", () => {
  it("spans Saturday and Sunday as one window and never as a clock block", () => {
    const calendar = buildCalendar([weekendClean(false)], [], DATES, SAT);
    for (const date of [SAT, SUN]) {
      const day = calendar.find(d => d.date === date)!;
      expect(day.timed).toEqual([]);
      expect(day.allDay).toEqual([]);
      expect(day.falldue).toEqual([]);
      expect(day.dateMarkers).toHaveLength(1);
      expect(day.dateMarkers[0]).toMatchObject({
        kind: "window",
        windowStart: SAT,
        windowEnd: SUN,
        fixed: false,
        overdue: false,
        label: "Window · Sat–Sun",
      });
      expect(day.dateMarkers[0].start).toBeUndefined();
      expect(day.dateMarkers[0].minutes).toBeUndefined();
    }
    expect(calendar.find(d => d.date === shiftDays(SUN, 1))!.dateMarkers).toEqual([]);
  });

  it("is not late before, during or on the last day of the window, only after it closes", () => {
    const task = weekendClean(false);
    const overdueOn = (today: string) =>
      buildCalendar([task], [], [SAT, SUN], today)
        .flatMap(day => day.dateMarkers)
        .some(item => item.overdue);
    expect(overdueOn(shiftDays(SAT, -1))).toBe(false); // Friday, early
    expect(overdueOn(SAT)).toBe(false); // opens
    expect(overdueOn(SUN)).toBe(false); // last open day: done Sunday is on time
    expect(overdueOn(shiftDays(SUN, 1))).toBe(true); // Monday: closed
    const closed = buildCalendar([task], [], [SAT, SUN], shiftDays(SUN, 1))[0]
      .dateMarkers[0];
    expect(closed.label).toBe("Window closed · Sat–Sun");
  });

  it("shows each upcoming recurrence on the anchored weekday with no clock time", () => {
    const calendar = buildCalendar([weekendClean(true)], [], DATES, SUN);
    const markerDates = calendar
      .filter(day => day.dateMarkers.length)
      .map(day => day.date);
    expect(markerDates).toEqual([
      SAT,
      SUN,
      "2026-11-14",
      "2026-11-15",
      "2026-11-21",
      "2026-11-22",
    ]);
    const next = calendar.find(d => d.date === "2026-11-14")!;
    expect(next.dateMarkers[0]).toMatchObject({
      kind: "window",
      windowStart: "2026-11-14",
      windowEnd: "2026-11-15",
      windowProjected: true,
      overdue: false,
      label: "Window · Sat–Sun · repeats",
    });
    expect(calendar.flatMap(d => d.timed)).toEqual([]);
    expect(calendar.flatMap(d => d.allDay)).toEqual([]);
  });

  it("hides a completed one-off window", () => {
    const done = { ...weekendClean(false), state: "done" as const };
    const calendar = buildCalendar([done], [], DATES, SUN);
    expect(calendar.flatMap(d => d.dateMarkers)).toEqual([]);
  });
});

describe("flexible recurrence anchor", () => {
  it("moves the window to a chosen anchor day, keeps its length and adds no time", () => {
    const task = weekendClean(true);
    const wed = setFlexibleRecurrenceAnchor(task.schedule, "2026-11-11");
    expect(wed.flexibleWindow).toEqual({ startDate: "2026-11-11", endDate: "2026-11-12" });
    expect(wed.repeatAnchorDate).toBe("2026-11-11");
    expect(wed.repeatOccurrenceDate).toBe("2026-11-11");
    expect(wed.date).toBeNull();
    expect(wed.time).toBeNull();
    expect(wed.fixed).toBe(false);
    expect(wed.minutes).toBe(120);
    expect(describeFlexibleRecurrence(wed)).toContain("No set time");
  });

  it("makes completion create the next window on the anchored weekday", () => {
    const task = weekendClean(true);
    const result = completeTask([task], task.id, SUN);
    const next = result.find(t => t.state !== "done" && t.schedule.flexibleWindow)!;
    expect(next.schedule.flexibleWindow).toEqual({
      startDate: "2026-11-14",
      endDate: "2026-11-15",
    });
    expect(next.schedule.time).toBeNull();
    expect(next.schedule.fixed).toBe(false);
  });

  it("leaves non-repeating or fixed schedules untouched", () => {
    const plain = emptyTaskSchedule();
    expect(setFlexibleRecurrenceAnchor(plain, SAT)).toEqual(plain);
    const single = weekendClean(false).schedule;
    expect(setFlexibleRecurrenceAnchor(single, SAT)).toEqual(single);
    expect(describeFlexibleRecurrence(single)).toBe("");
  });
});

describe("flexible window chip in the Calendar view", () => {
  it("renders a joined, accessible, no-time window across its days", () => {
    vi.stubGlobal("React", React);
    const today = adelaideClock().date;
    const task = createTask({
      id: "ui-window",
      title: "Synthetic window chore",
      schedule: {
        ...emptyTaskSchedule(),
        flexibleWindow: { startDate: today, endDate: shiftDays(today, 1) },
        minutes: 60,
      },
    });
    const workspace = {
      planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
      imperatives: [],
      obligations: [],
      credentialRenewals: [],
      people: [],
    } as unknown as Workspace;
    const markup = renderToStaticMarkup(
      createElement(CalendarView, {
        autosaveCloud: { active: false, status: "local", pending: false, revision: 0, lastSyncedAt: null },
        onAutoSave: task => ({ accepted: true as const, task, serverPending: false, ticket: null }),
        workspace,
        tasks: [task],
        projects: [],
        onMutate: () => true,
        onOpenTask: () => {},
        readOnly: false,
        initialMode: "3day",
      })
    );
    expect(markup).toContain("window-chip");
    expect(markup).toContain("window-first");
    expect(markup).toContain("window-last");
    expect(markup).toContain("no set time, still open");
    expect(markup).toContain("Synthetic window chore");
    expect(markup).not.toContain("time-block");
    expect(markup).not.toContain("window-closed");
  });
});
