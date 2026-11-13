import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTask } from "../../domain/engine";
import {
  adelaideClock,
  emptyTaskSchedule,
  shiftDays,
  weekStart,
} from "../../domain/time";
import type { Workspace } from "../../domain/types";
import CalendarView from "./CalendarView";

afterEach(() => vi.unstubAllGlobals());

describe("CalendarView anchor-only grids", () => {
  it("keeps a non-booked task visible by date without restoring its clock time", () => {
    vi.stubGlobal("React", React);
    const today = adelaideClock().date;
    const task = createTask({
      title: "Synthetic existing unbooked task",
      schedule: {
        ...emptyTaskSchedule(),
        date: today,
        time: "09:00",
        minutes: 45,
        fixed: false,
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
        initialMode: "day",
      })
    );

    expect(markup).toContain("calendar-date-marker");
    expect(markup).toContain("Planned date · not booked");
    // Explanations live in the page menu's "How this calendar works" now.
    expect(markup).not.toContain("To add a booked anchor, tap an empty time.");
    expect(markup).toContain("Synthetic existing unbooked task");
    expect(markup).not.toContain("Synthetic existing unbooked task · 09:00");
    expect(markup).toContain('style="top:50px">09:00</span>');
    expect(markup).not.toContain("time-block");
  });

  it("shows date-only hard deadlines outside clock blocks", () => {
    vi.stubGlobal("React", React);
    const today = adelaideClock().date;
    const task = createTask({
      title: "Synthetic date-only deadline",
      deadline: today,
      schedule: emptyTaskSchedule(),
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
        initialMode: "day",
      })
    );

    expect(markup).toContain('class="v2-calendar-current-date"');
    expect(markup).toContain("Hard deadline");
    expect(markup).toContain("Synthetic date-only deadline");
    expect(markup).not.toContain('calendar-date-marker kind-deadline');
    expect(markup).not.toContain("time-block");
  });

  it("shows flexible tasks as no-clock window chips without placement actions", () => {
    vi.stubGlobal("React", React);
    const today = adelaideClock().date;
    const startDate = shiftDays(weekStart(today), 5);
    const endDate = shiftDays(startDate, 1);
    const task = createTask({
      title: "Synthetic weekend window",
      schedule: {
        ...emptyTaskSchedule(),
        minutes: 120,
        flexibleWindow: { startDate, endDate },
      },
    });
    const workspace = {
      planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
      imperatives: [],
      obligations: [],
      credentialRenewals: [],
      people: [],
    } as unknown as Workspace;
    const element = createElement(CalendarView, {
        autosaveCloud: { active: false, status: "local", pending: false, revision: 0, lastSyncedAt: null },
        onAutoSave: task => ({ accepted: true as const, task, serverPending: false, ticket: null }),
      workspace,
      tasks: [task],
      projects: [],
      onMutate: () => true,
      onOpenTask: () => {},
      readOnly: false,
      initialMode: "week",
    });
    const markup = renderToStaticMarkup(element);

    // Flexible windows are visible as date-only chips, never as clock events.
    expect(markup).toContain("Synthetic weekend window");
    expect(markup).toContain("window-chip");
    expect(markup).not.toContain("time-block");
    expect(markup).not.toContain("window-all-day-row");
    expect(markup).not.toContain("Place at a time");
    expect(markup).toContain('aria-label="Calendar range"');
    expect(markup).toContain(">Day</button>");
    expect(markup).toContain(">3d</button>");
    expect(markup).toContain(">Week</button>");
    expect(markup).toContain(">Month</button>");
  });

  it("shows Day capacity and renders timed deadlines as non-duration points", () => {
    vi.stubGlobal("React", React);
    const today = adelaideClock().date;
    const task = createTask({
      title: "Synthetic appointment",
      deadline: today,
      schedule: {
        ...emptyTaskSchedule(),
        date: today,
        time: "09:00",
        minutes: 60,
        fixed: true,
        deadlineTime: "16:30",
      },
    });
    const workspace = {
      planning: { dayStart: "07:00", dayEnd: "18:00", bufferMinutes: 10 },
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
        initialMode: "day",
      })
    );

    expect(markup).toContain("v2-calendar-due-row");
    expect(markup).toContain("Synthetic appointment");
    expect(markup).toContain("v2-free-block");
    expect(markup).toContain("calendar-deadline-point");
    expect(markup).toContain("hard deadline point at 16:30");
    // Equal hour rows plus room for the last label (was 550px with a squashed last row).
    expect(markup).toContain("height:570px");
    expect(markup).toContain("left:calc(0% + 8px + 0%);width:calc(100% - 8px)");
    expect(markup).toContain(">07:00</span>");
    expect(markup).toContain(">18:00</span>");
    expect(markup).toContain('style="top:100px">09:00</span>');
    expect(markup).toContain("Free ·");
    expect(markup).not.toContain("16:30–16:30");
    expect(markup).not.toContain("0 min");
  });

  it("does not show a hard-deadline point in Month even if its task has a major flag", () => {
    vi.stubGlobal("React", React);
    const today = adelaideClock().date;
    const majorAnchor = createTask({
      title: "Synthetic major booked anchor",
      schedule: {
        ...emptyTaskSchedule(),
        date: today,
        time: "09:00",
        minutes: 60,
        fixed: true,
        majorAnchor: true,
      },
    });
    const deadlinePoint = createTask({
      title: "Synthetic major-flagged deadline point",
      deadline: today,
      schedule: { ...emptyTaskSchedule(), deadlineTime: "16:30", majorAnchor: true },
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
        tasks: [majorAnchor, deadlinePoint],
        projects: [],
        onMutate: () => true,
        onOpenTask: () => {},
        readOnly: false,
        initialMode: "month",
      })
    );

    expect(markup).toContain("Synthetic major booked anchor");
    expect(markup).not.toContain("Synthetic major-flagged deadline point");
  });

  it("explains the Month preview limit and provides a keyboard-accessible full-day overflow action", () => {
    vi.stubGlobal("React", React);
    const today = adelaideClock().date;
    const tasks = ["One", "Two", "Three", "Four"].map(title =>
      createTask({
        title: `Synthetic major anchor ${title}`,
        schedule: {
          ...emptyTaskSchedule(),
          date: today,
          time: "09:00",
          fixed: true,
          majorAnchor: true,
        },
      })
    );
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
        tasks,
        projects: [],
        onMutate: () => true,
        onOpenTask: () => {},
        readOnly: false,
        initialMode: "month",
      })
    );

    expect(markup).not.toContain("This month view previews up to three items per day.");
    expect(markup).toMatch(/class="month-day-open"[^>]*aria-label="Open .+ in Day view"/);
    expect(markup).toContain(">+1 more</button>");
    expect(markup).toMatch(/aria-label="Show 1 more item for .+ in Day view"/);
  });
});
