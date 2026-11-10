import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCalendar } from "./calendarModel";
import { completeTask, createTask } from "./engine";
import {
  adelaideClock,
  emptyRepeat,
  emptyTaskSchedule,
  flexibleCompletionNote,
  flexibleCompletionStatus,
  shiftDays,
  type TaskSchedule,
} from "./time";
import type { Task, Workspace } from "./types";
import CalendarView from "../components/steadier/CalendarView";

afterEach(() => vi.unstubAllGlobals());

// 2026-11-07 is a Saturday, 2026-11-08 a Sunday (Australia/Adelaide dates).
const FRI = "2026-11-06";
const SAT = "2026-11-07";
const SUN = "2026-11-08";
const MON = "2026-11-09";

function windowTask(repeating: boolean, start = SAT, end = SUN): Task {
  const schedule: TaskSchedule = {
    ...emptyTaskSchedule(),
    flexibleWindow: { startDate: start, endDate: end },
    minutes: 120,
    ...(repeating
      ? {
          repeat: { ...emptyRepeat("weekly"), weekdays: [] },
          repeatAnchorDate: start,
          repeatOccurrenceDate: start,
          repeatTime: null,
        }
      : {}),
  };
  return createTask(
    { id: "synthetic-window", title: "Synthetic weekend job", schedule },
    start
  );
}

function openOf(tasks: Task[]): Task[] {
  return tasks.filter(t => t.state !== "done");
}
function doneOf(tasks: Task[]): Task[] {
  return tasks.filter(t => t.state === "done");
}

describe("flexible window completion statuses", () => {
  it("is late only after the last day; the start day never locks or lates it", () => {
    const w = { startDate: SAT, endDate: SUN };
    expect(flexibleCompletionStatus(w, FRI)).toBe("early");
    expect(flexibleCompletionStatus(w, SAT)).toBe("within");
    expect(flexibleCompletionStatus(w, SUN)).toBe("within");
    expect(flexibleCompletionStatus(w, MON)).toBe("late");
  });

  it("describes each outcome in plain words", () => {
    const s = windowTask(false).schedule;
    expect(flexibleCompletionNote(s, SUN)?.text).toContain("within its window");
    expect(flexibleCompletionNote(s, MON)?.text).toContain("Completed late");
    expect(flexibleCompletionNote(s, FRI)?.text).toContain("before its window");
    expect(flexibleCompletionNote({ ...s, flexibleWindow: undefined }, SUN)).toBeNull();
  });
});

describe("Mark done on a flexible recurring window", () => {
  it("completes only this occurrence on the anchor day and creates the next window", () => {
    const result = completeTask([windowTask(true)], "synthetic-window", SAT);
    expect(doneOf(result)).toHaveLength(1);
    expect(openOf(result)).toHaveLength(1);
    const done = doneOf(result)[0];
    expect(done.schedule.completions).toEqual([SAT]);
    expect(done.history.at(-1)?.text).toContain("within its window");
    expect(openOf(result)[0].schedule.flexibleWindow).toEqual({
      startDate: "2026-11-14",
      endDate: "2026-11-15",
    });
    expect(openOf(result)[0].schedule.time).toBeNull();
  });

  it("stays available and on time on the last open day", () => {
    const result = completeTask([windowTask(true)], "synthetic-window", SUN);
    expect(doneOf(result)[0].history.at(-1)?.text).not.toContain("late");
    expect(openOf(result)[0].schedule.flexibleWindow?.startDate).toBe("2026-11-14");
  });

  it("still completes after the window ends and records it as completed late", () => {
    const result = completeTask([windowTask(true)], "synthetic-window", MON);
    expect(doneOf(result)).toHaveLength(1);
    expect(doneOf(result)[0].history.at(-1)?.text).toContain("Completed late");
    expect(doneOf(result)[0].schedule.completions).toEqual([MON]);
    expect(openOf(result)).toHaveLength(1);
    expect(openOf(result)[0].schedule.flexibleWindow?.startDate).toBe("2026-11-14");
  });

  it("can be completed before the window opens without blocking", () => {
    const result = completeTask([windowTask(true)], "synthetic-window", FRI);
    expect(doneOf(result)[0].history.at(-1)?.text).toContain("before its window");
  });

  it("completes a one-off window late without creating a repeat", () => {
    const result = completeTask([windowTask(false)], "synthetic-window", MON);
    expect(result).toHaveLength(1);
    expect(result[0].state).toBe("done");
    expect(result[0].history.at(-1)?.text).toContain("Completed late");
  });

  it("leaves ordinary tasks with the original completion wording", () => {
    const plain = createTask({ id: "plain", title: "Synthetic plain" }, SAT);
    expect(completeTask([plain], "plain", SAT)[0].history.at(-1)?.text).toBe(
      "Completed task."
    );
  });
});

describe("closed unfinished window on the Calendar", () => {
  it("is carried onto today so it can still be ticked, and never as a clock block", () => {
    const today = adelaideClock().date;
    const task = windowTask(false, shiftDays(today, -3), shiftDays(today, -1));
    const days = buildCalendar([task], [], [shiftDays(today, -3), today], today);
    const todayCell = days.find(d => d.date === today)!;
    const carried = todayCell.dateMarkers.filter(i => i.windowCarried);
    expect(carried).toHaveLength(1);
    expect(carried[0].overdue).toBe(true);
    expect(carried[0].label).toContain("Window closed");
    expect(todayCell.timed).toEqual([]);
  });

  it("does not carry an open window", () => {
    const today = adelaideClock().date;
    const task = windowTask(false, today, shiftDays(today, 1));
    const days = buildCalendar([task], [], [today], today);
    expect(days[0].dateMarkers.some(i => i.windowCarried)).toBe(false);
    expect(days[0].dateMarkers.some(i => i.kind === "window")).toBe(true);
  });
});

function renderCalendar(tasks: Task[], readOnly = false): string {
  vi.stubGlobal("React", React);
  const workspace = {
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    obligations: [],
    credentialRenewals: [],
    people: [],
  } as unknown as Workspace;
  return renderToStaticMarkup(
    createElement(CalendarView, {
        autosaveCloud: { active: false, status: "local", pending: false, revision: 0, lastSyncedAt: null },
        onAutoSave: task => ({ accepted: true as const, task, serverPending: false, ticket: null }),
      workspace,
      tasks,
      projects: [],
      onMutate: () => true,
      onOpenTask: () => {},
      readOnly,
      initialMode: "week",
    })
  );
}

describe("Calendar keeps window events compact", () => {
  it("shows no checkbox or Done button anywhere on the grid, open or closed", () => {
    const today = adelaideClock().date;
    for (const task of [
      windowTask(true, today, shiftDays(today, 1)),
      windowTask(false, shiftDays(today, -3), shiftDays(today, -1)),
    ]) {
      for (const ro of [false, true]) {
        const markup = renderCalendar([task], ro);
        expect(markup).not.toContain('type="checkbox"');
        expect(markup).not.toContain("window-done-button");
        expect(markup).not.toContain("Mark done");
      }
    }
  });

  it("still shows the window as a compact tappable label with no clock block", () => {
    const today = adelaideClock().date;
    const markup = renderCalendar([windowTask(true, today, shiftDays(today, 1))]);
    expect(markup).toContain("window-chip");
    expect(markup).toContain("Synthetic weekend job");
    expect(markup).not.toContain("time-block");
  });

  it("repeats are projections and the model offers one current window", () => {
    const today = adelaideClock().date;
    const days = buildCalendar(
      [windowTask(true, today, shiftDays(today, 1))],
      [],
      Array.from({ length: 15 }, (_, i) => shiftDays(today, i)),
      today
    );
    const markers = days.flatMap(d => d.dateMarkers).filter(i => i.kind === "window");
    expect(markers.some(i => i.windowProjected)).toBe(true);
    expect(markers.some(i => !i.windowProjected)).toBe(true);
  });
});
