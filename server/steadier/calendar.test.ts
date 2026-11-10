import { createServer, type Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { Task } from "../../client/src/domain/types";
import {
  CALENDAR_TOKEN_PATTERN,
  createCalendarToken,
  hashCalendarToken,
  rruleFor,
  workspaceCalendarIcs,
  type CalendarFeedRepository,
  type CalendarFeedStatus,
} from "./calendar";
import { registerSteadierRoutes } from "./routes";
import type { SteadierRepository, StoredWorkspace } from "./service";
import { emptyWorkspace } from "./validation";
import {
  emptyProjectCompass,
  emptyTaskCompass,
} from "../../client/src/domain/compass";
import {
  emptyProjectSchedule,
  emptyRepeat,
  emptyTaskSchedule,
} from "../../client/src/domain/time";

function task(id: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    area: "Home",
    nextAction: "Ring Sam, about the quote; then book",
    notes: "PRIVATE NOTE must never appear",
    state: "ready",
    important: false,
    pinned: false,
    deadline: null,
    startDate: null,
    reviewDate: null,
    deferredUntil: null,
    estimate: 15,
    context: "anywhere",
    waitingFor: "",
    dependencies: [],
    checklist: [],
    repeatDays: null,
    createdAt: "2026-10-01T12:00:00",
    updatedAt: "2026-10-01T12:00:00",
    completedAt: null,
    history: [],
    purpose: "",
    role: null,
    pattern: null,
    labelSource: "unclassified",
    projectId: null,
    preparationDate: null,
    preparationSource: "suggested",
    progressEvidence: "",
    schedule: emptyTaskSchedule(),
    compass: emptyTaskCompass(),
    ...extra,
  };
}

function workspace() {
  const ws = emptyWorkspace();
  ws.projects = [
    {
      id: "p1",
      title: "House",
      purpose: "",
      outcome: "",
      role: "support",
      pattern: "timely",
      status: "active",
      milestones: [],
      progress: [],
      createdAt: "2026-10-01T12:00:00",
      updatedAt: "2026-10-01T12:00:00",
      schedule: emptyProjectSchedule(),
      compass: emptyProjectCompass(),
    },
  ];
  ws.tasks = [
    task("t1", {
      deadline: "2026-11-03",
      preparationDate: "2026-10-31",
      reviewDate: "2026-12-31",
      projectId: "p1",
    }),
    task("t2", { deadline: "2026-11-05", state: "done" }),
    task("t3", { deadline: "2026-11-09", preparationDate: "2026-11-09" }),
    task("t4"),
  ];
  return ws;
}

describe("calendar feed output", () => {
  const ics = workspaceCalendarIcs(workspace(), {
    now: new Date("2026-10-25T04:00:00Z"),
  });
  const unfolded = ics.replace(/\r\n /g, "");

  it("is a valid all-day iCalendar with CRLF lines of at most 75 octets", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    for (const line of ics.split("\r\n"))
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(unfolded).toContain("X-WR-TIMEZONE:Australia/Adelaide");
    expect(unfolded).toContain("DTSTART;VALUE=DATE:20261103");
    expect(unfolded).toContain("DTEND;VALUE=DATE:20261104");
  });

  it("includes open tasks' dates, skips done tasks, duplicate prep days and undated tasks", () => {
    const summaries = [...unfolded.matchAll(/^SUMMARY:(.*)$/gm)].map(
      match => match[1]
    );
    expect(summaries).toEqual([
      "Due: Task t1",
      "Prepare: Task t1",
      "Review: Task t1",
      "Due: Task t3",
    ]);
    expect(unfolded).toContain("UID:t1-deadline@steadier");
  });

  it("escapes text, adds alarms, and never includes notes", () => {
    expect(unfolded).toContain(
      "Next step: Ring Sam\\, about the quote\\; then book\\nProject: House"
    );
    expect(unfolded).toContain("Real deadline: 2026-11-03");
    expect(unfolded).toContain("TRIGGER;RELATED=START:-PT15H");
    expect(unfolded).not.toContain("PRIVATE NOTE");
  });

  it("can hide titles and details", () => {
    const hidden = workspaceCalendarIcs(workspace(), {
      hideTitles: true,
    }).replace(/\r\n /g, "");
    expect(hidden).toContain("SUMMARY:Due: Steadier task");
    expect(hidden).not.toContain("Task t1");
    expect(hidden).not.toContain("Ring Sam");
  });

  it("creates unguessable tokens in the expected format", () => {
    const token = createCalendarToken();
    expect(CALENDAR_TOKEN_PATTERN.test(token)).toBe(true);
    expect(token).not.toBe(createCalendarToken());
  });
});

class MemoryCalendar implements CalendarFeedRepository {
  rows: Array<{
    id: number;
    userId: number;
    tokenHash: string;
    hideTitles: boolean;
    revoked: boolean;
  }> = [];
  async readActiveFeed(userId: number): Promise<CalendarFeedStatus> {
    const row = this.rows.find(r => r.userId === userId && !r.revoked);
    return {
      active: !!row,
      hideTitles: row?.hideTitles ?? false,
      createdAt: null,
      lastFetchedAt: null,
    };
  }
  async replaceFeed(userId: number, tokenHash: string, hideTitles: boolean) {
    for (const row of this.rows) if (row.userId === userId) row.revoked = true;
    this.rows.push({
      id: this.rows.length + 1,
      userId,
      tokenHash,
      hideTitles,
      revoked: false,
    });
  }
  async revokeFeed(userId: number) {
    for (const row of this.rows) if (row.userId === userId) row.revoked = true;
    return true;
  }
  async findActiveFeedByHash(tokenHash: string) {
    const row = this.rows.find(r => r.tokenHash === tokenHash && !r.revoked);
    return row
      ? { id: row.id, userId: row.userId, hideTitles: row.hideTitles }
      : null;
  }
  async touchFeed() {}
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(s => new Promise<void>(resolve => s.close(() => resolve())))
  );
});

describe("calendar feed route", () => {
  it("serves the owner's feed only for an active link", async () => {
    const stored: StoredWorkspace = {
      userId: 7,
      workspace: workspace(),
      revision: 2,
      updatedAt: "2026-10-24T00:00:00.000Z",
      timeZone: "Australia/Adelaide",
      focusOwnerClientId: null,
    };
    const repository = {
      readWorkspace: async (userId: number) => (userId === 7 ? stored : null),
    } as unknown as SteadierRepository;
    const calendar = new MemoryCalendar();
    const oldToken = createCalendarToken();
    const token = createCalendarToken();
    await calendar.replaceFeed(7, hashCalendarToken(oldToken), false);
    await calendar.replaceFeed(7, hashCalendarToken(token), false);

    const app = express();
    app.use(express.json());
    registerSteadierRoutes(app, {
      repository,
      changes: {} as never,
      calendar,
      authenticateSession: async () => {
        throw new Error("no session");
      },
    });
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    const base = `http://127.0.0.1:${address.port}`;

    const ok = await fetch(`${base}/api/calendar/${token}/steadier.ics`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/calendar");
    expect(await ok.text()).toContain("SUMMARY:Due: Task t1");

    expect(
      (await fetch(`${base}/api/calendar/${oldToken}/steadier.ics`)).status
    ).toBe(404);
    expect(
      (await fetch(`${base}/api/calendar/not-a-token/steadier.ics`)).status
    ).toBe(404);

    await calendar.revokeFeed(7);
    expect(
      (await fetch(`${base}/api/calendar/${token}/steadier.ics`)).status
    ).toBe(404);
  });
});

describe("calendar feed time slots and reminders", () => {
  const ws = emptyWorkspace();
  ws.projects = [
    {
      id: "p9",
      title: "Garden",
      purpose: "",
      outcome: "",
      role: "direction",
      pattern: "timely",
      status: "active",
      milestones: [{ id: "m1", title: "Beds dug", done: false }],
      progress: [],
      createdAt: "2026-10-01T12:00:00",
      updatedAt: "2026-10-01T12:00:00",
      compass: emptyProjectCompass(),
      schedule: {
        deadline: "2026-12-01",
        reviewDate: null,
        weeklyBudgetMinutes: 120,
        milestoneDates: [{ id: "m1", date: "2026-11-15" }],
      },
    },
  ];
  ws.tasks = [
    task("s1", {
      title: "Call Sam",
      deadline: "2026-10-30",
      schedule: {
        ...emptyTaskSchedule(),
        date: "2026-10-27",
        time: "15:00",
        minutes: 30,
        deadlineTime: "17:00",
        repeat: { ...emptyRepeat("weekly"), weekdays: [2, 4] },
        reminders: [
          { id: "a", minutesBefore: 15, anchor: "slot" },
          { id: "b", minutesBefore: 60, anchor: "deadline" },
        ],
      },
    }),
  ];
  const ics = workspaceCalendarIcs(ws, {
    now: new Date("2026-10-25T04:00:00Z"),
  });
  const unfolded = ics.replace(/\r\n /g, "");

  it("emits a timed, repeating planned slot in Adelaide time", () => {
    expect(unfolded).toContain("BEGIN:VTIMEZONE\r\nTZID:Australia/Adelaide");
    expect(unfolded).toContain("UID:s1-slot@steadier");
    expect(unfolded).toContain(
      "DTSTART;TZID=Australia/Adelaide:20261027T150000"
    );
    expect(unfolded).toContain("DURATION:PT30M");
    expect(unfolded).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU,TH");
    expect(unfolded).toContain("TRIGGER;RELATED=START:-PT15M");
  });

  it("emits reminders as their own timed entries for Google Calendar", () => {
    expect(unfolded).toContain("UID:s1-rem-a@steadier");
    expect(unfolded).toContain(
      "DTSTART;TZID=Australia/Adelaide:20261027T144500"
    );
    expect(unfolded).toContain("SUMMARY:⏰ Call Sam (at 3 pm)");
    // Deadline reminder: 1 h before 5 pm on 30 Oct (ACDT, UTC+10:30) = 05:30Z.
    expect(unfolded).toContain("UID:s1-rem-b@steadier");
    expect(unfolded).toContain(
      "DTSTART;TZID=Australia/Adelaide:20261030T160000"
    );
  });

  it("adds always-on 15-minute and hourly timer alerts to the existing feed", () => {
    const short = task("short", {
      title: "Skeeti Paint cleaning",
      estimate: 45,
      schedule: {
        ...emptyTaskSchedule(),
        date: "2026-10-27",
        time: "08:59",
        minutes: 45,
        fixed: true,
      },
    });
    const long = task("long", {
      title: "Deep work",
      estimate: 120,
      schedule: {
        ...emptyTaskSchedule(),
        date: "2026-10-27",
        time: "10:00",
        minutes: 120,
        fixed: true,
      },
    });
    const flexible = task("flexible", {
      schedule: {
        ...emptyTaskSchedule(),
        flexibleWindow: {
          startDate: "2026-10-27",
          endDate: "2026-10-28",
        },
      },
    });
    const syntheticWorkspace = emptyWorkspace();
    syntheticWorkspace.tasks = [short, long, flexible];
    const feed = workspaceCalendarIcs(syntheticWorkspace, {
      now: new Date("2026-10-25T04:00:00Z"),
    }).replace(/\r\n /g, "");

    expect(feed).toContain("UID:short-rem-auto-focus-15@steadier");
    expect(feed).toContain("DTSTART;TZID=Australia/Adelaide:20261027T091400");
    expect(feed).toContain("UID:short-rem-auto-focus-30@steadier");
    expect(feed).toContain("DTSTART;TZID=Australia/Adelaide:20261027T092900");
    expect(feed).toContain("UID:short-rem-auto-focus-end@steadier");
    expect(feed).toContain("DTSTART;TZID=Australia/Adelaide:20261027T094400");
    expect(feed).not.toContain("short-rem-auto-focus-45@steadier");
    expect(feed).toContain("UID:long-rem-auto-focus-60@steadier");
    expect(feed).toContain("DTSTART;TZID=Australia/Adelaide:20261027T110000");
    expect(feed).toContain("UID:long-rem-auto-focus-end@steadier");
    expect(feed).toContain("DTSTART;TZID=Australia/Adelaide:20261027T120000");
    expect(feed).not.toContain("flexible-rem-focus-");
    expect(feed).not.toContain("PRIVATE NOTE");

    const hidden = workspaceCalendarIcs(
      { ...syntheticWorkspace, tasks: [short] },
      { hideTitles: true, now: new Date("2026-10-25T04:00:00Z") }
    ).replace(/\r\n /g, "");
    expect(hidden).toContain(
      "SUMMARY:⏰ Steadier task (timer check-in 15 minutes into the block)"
    );
    expect(hidden).not.toContain("Skeeti Paint cleaning");
  });

  it("keeps recurring interval alerts when the timer crosses midnight", () => {
    const overnight = task("overnight", {
      title: "Weekly late task",
      estimate: 45,
      schedule: {
        ...emptyTaskSchedule(),
        date: "2026-10-25",
        time: "23:30",
        minutes: 45,
        fixed: true,
        repeat: { ...emptyRepeat("weekly"), weekdays: [0] },
        repeatAnchorDate: "2026-10-25",
      },
    });
    const syntheticWorkspace = emptyWorkspace();
    syntheticWorkspace.tasks = [overnight];
    const feed = workspaceCalendarIcs(syntheticWorkspace, {
      now: new Date("2026-10-24T04:00:00Z"),
    }).replace(/\r\n /g, "");

    expect(feed).toContain("UID:overnight-rem-auto-focus-15@steadier");
    expect(feed).toContain("DTSTART;TZID=Australia/Adelaide:20261025T234500");
    expect(feed).toContain("UID:overnight-rem-auto-focus-30@steadier");
    expect(feed).toContain("DTSTART;TZID=Australia/Adelaide:20261026T000000");
    expect(feed).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
    expect(feed).toContain("UID:overnight-rem-auto-focus-end@steadier");
    expect(feed).toContain("DTSTART;TZID=Australia/Adelaide:20261026T001500");
  });

  it("uses RDATE occurrences when a cross-day monthly alert cannot use one shifted rule", () => {
    const monthly = task("month-end", {
      title: "Month-end review",
      estimate: 120,
      schedule: {
        ...emptyTaskSchedule(),
        date: "2026-01-30",
        time: "23:30",
        minutes: 120,
        fixed: true,
        repeat: { ...emptyRepeat("monthly"), monthDay: 30 },
        repeatAnchorDate: "2026-01-30",
      },
    });
    const syntheticWorkspace = emptyWorkspace();
    syntheticWorkspace.tasks = [monthly];
    const feed = workspaceCalendarIcs(syntheticWorkspace, {
      now: new Date("2026-01-29T04:00:00Z"),
    }).replace(/\r\n /g, "");

    expect(feed).toContain("UID:month-end-rem-auto-focus-60@steadier");
    expect(feed).toContain("DTSTART:20260130T140000Z");
    expect(feed).toContain("RDATE:20260228T140000Z");
  });

  it("preserves exact recurring alert instants across Adelaide daylight saving", () => {
    const dst = task("dst", {
      title: "Sunday DST task",
      estimate: 120,
      schedule: {
        ...emptyTaskSchedule(),
        date: "2026-09-27",
        time: "01:30",
        minutes: 120,
        fixed: true,
        repeat: { ...emptyRepeat("weekly"), weekdays: [0] },
        repeatAnchorDate: "2026-09-27",
      },
    });
    const syntheticWorkspace = emptyWorkspace();
    syntheticWorkspace.tasks = [dst];
    const feed = workspaceCalendarIcs(syntheticWorkspace, {
      now: new Date("2026-09-26T04:00:00Z"),
    }).replace(/\r\n /g, "");
    const events = feed
      .split("BEGIN:VEVENT\r\n")
      .slice(1)
      .map(event => event.split("\r\nEND:VEVENT")[0]);
    const checkIn = events.find(event =>
      event.includes("UID:dst-rem-auto-focus-60@steadier")
    );

    expect(checkIn).toContain("DTSTART:20260926T170000Z");
    expect(checkIn).toContain("RDATE:20261003T170000Z");
    expect(checkIn).toContain("RDATE:20261010T160000Z");
    expect(checkIn).not.toContain("RRULE:");
  });

  it("uses a timed deadline instead of the all-day entry", () => {
    expect(unfolded).toContain("SUMMARY:Due 5 pm: Call Sam");
    expect(unfolded).not.toContain("UID:s1-deadline@steadier");
  });

  it("includes project deadlines and dated open milestones", () => {
    expect(unfolded).toContain("SUMMARY:Project due: Garden");
    expect(unfolded).toContain("SUMMARY:Milestone: Beds dug (Garden)");
    expect(unfolded).toContain("DTSTART;VALUE=DATE:20261115");
  });

  it("hides titles when asked", () => {
    const hidden = workspaceCalendarIcs(ws, { hideTitles: true }).replace(
      /\r\n /g,
      ""
    );
    expect(hidden).not.toContain("Call Sam");
    expect(hidden).not.toContain("Garden");
    expect(hidden).not.toContain("Beds dug");
  });

  it("keeps a rescheduled occurrence separate from the recurring feed series", () => {
    const movedWorkspace = {
      ...ws,
      tasks: ws.tasks.map(item =>
        item.id === "s1"
          ? {
              ...item,
              schedule: {
                ...item.schedule,
                date: "2026-10-29",
                time: "18:00",
                repeat: { ...item.schedule.repeat!, count: 2 },
                fixed: true,
                seriesId: "series-s1",
                repeatAnchorDate: "2026-10-26",
                repeatOccurrenceDate: "2026-10-27",
                repeatTime: "15:00",
              },
            }
          : item
      ),
    };
    const feed = workspaceCalendarIcs(movedWorkspace, {
      now: new Date("2026-10-25T04:00:00Z"),
    }).replace(/\r\n /g, "");
    const events = feed
      .split("BEGIN:VEVENT\r\n")
      .slice(1)
      .map(event => event.split("\r\nEND:VEVENT")[0]);
    const event = (uid: string) =>
      events.find(item => item.includes(`UID:${uid}`)) ?? "";

    const seriesSlot = event("series-s1-slot@steadier");
    expect(seriesSlot).toContain(
      "DTSTART;TZID=Australia/Adelaide:20261027T150000"
    );
    expect(seriesSlot).toContain(
      "RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261103T235959Z"
    );
    expect(seriesSlot).not.toContain("COUNT=");
    expect(seriesSlot).toContain(
      "EXDATE;TZID=Australia/Adelaide:20261027T150000"
    );
    expect(seriesSlot).toContain(
      "EXDATE;TZID=Australia/Adelaide:20261029T150000"
    );

    const movedSlot = event("s1-slot-instance@steadier");
    expect(movedSlot).toContain(
      "DTSTART;TZID=Australia/Adelaide:20261029T180000"
    );
    expect(movedSlot).not.toContain("RRULE:");

    const seriesReminder = event("series-s1-rem-a@steadier");
    expect(seriesReminder).toContain(
      "DTSTART;TZID=Australia/Adelaide:20261027T144500"
    );
    expect(seriesReminder).toContain(
      "EXDATE;TZID=Australia/Adelaide:20261027T144500"
    );
    expect(seriesReminder).toContain(
      "EXDATE;TZID=Australia/Adelaide:20261029T144500"
    );
    const movedReminder = event("s1-rem-a-instance@steadier");
    expect(movedReminder).toContain(
      "DTSTART;TZID=Australia/Adelaide:20261029T174500"
    );
    expect(movedReminder).not.toContain("RRULE:");

    const seriesFocusReminder = event("series-s1-rem-auto-focus-15@steadier");
    expect(seriesFocusReminder).toContain(
      "DTSTART;TZID=Australia/Adelaide:20261027T151500"
    );
    expect(seriesFocusReminder).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU,TH");
    expect(seriesFocusReminder).toContain(
      "EXDATE;TZID=Australia/Adelaide:20261027T151500"
    );
    expect(seriesFocusReminder).toContain(
      "EXDATE;TZID=Australia/Adelaide:20261029T151500"
    );
    const movedFocusReminder = event("s1-rem-auto-focus-15-instance@steadier");
    expect(movedFocusReminder).toContain(
      "DTSTART;TZID=Australia/Adelaide:20261029T181500"
    );
    expect(movedFocusReminder).not.toContain("RRULE:");
  });

  it("keeps future calendar series after the current occurrence is unscheduled", () => {
    const unscheduledWorkspace = {
      ...ws,
      tasks: ws.tasks.map(item =>
        item.id === "s1"
          ? {
              ...item,
              schedule: {
                ...item.schedule,
                date: null,
                seriesId: "series-s1",
                repeatAnchorDate: "2026-10-26",
                repeatOccurrenceDate: "2026-10-27",
                repeatTime: "15:00",
              },
            }
          : item
      ),
    };
    const feed = workspaceCalendarIcs(unscheduledWorkspace, {
      now: new Date("2026-10-25T04:00:00Z"),
    }).replace(/\r\n /g, "");
    const events = feed
      .split("BEGIN:VEVENT\r\n")
      .slice(1)
      .map(event => event.split("\r\nEND:VEVENT")[0]);
    const seriesSlot = events.find(item =>
      item.includes("UID:series-s1-slot@steadier")
    );
    expect(seriesSlot).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU,TH");
    expect(seriesSlot).toContain(
      "EXDATE;TZID=Australia/Adelaide:20261027T150000"
    );
    expect(
      events.some(item => item.includes("UID:s1-slot-instance@steadier"))
    ).toBe(false);
    const seriesReminder = events.find(item =>
      item.includes("UID:series-s1-rem-a@steadier")
    );
    expect(seriesReminder).toContain(
      "EXDATE;TZID=Australia/Adelaide:20261027T144500"
    );
    expect(
      events.some(item => item.includes("UID:s1-rem-a-instance@steadier"))
    ).toBe(false);
  });

  it("exports a flexible window as transparent all-day dates without slot alarms or future repeats", () => {
    const flexibleTask = task("window-task", {
      title: "Mow the lawn",
      schedule: {
        ...emptyTaskSchedule(),
        minutes: 120,
        flexibleWindow: {
          startDate: "2026-10-24",
          endDate: "2026-10-25",
        },
        repeat: { ...emptyRepeat("weekly"), weekdays: [6] },
        repeatAnchorDate: "2026-10-24",
        repeatOccurrenceDate: "2026-10-24",
        repeatTime: null,
        reminders: [{ id: "window-slot", minutesBefore: 15, anchor: "slot" }],
      },
    });
    const feed = workspaceCalendarIcs(
      { ...ws, tasks: [...ws.tasks, flexibleTask] },
      { now: new Date("2026-10-25T04:00:00Z") }
    ).replace(/\r\n /g, "");
    const events = feed
      .split("BEGIN:VEVENT\r\n")
      .slice(1)
      .map(event => event.split("\r\nEND:VEVENT")[0]);
    const windowEvent =
      events.find(event => event.includes("UID:window-task-window@steadier")) ??
      "";

    expect(windowEvent).toContain("DTSTART;VALUE=DATE:20261024");
    expect(windowEvent).toContain("DTEND;VALUE=DATE:20261026");
    expect(windowEvent).toContain("SUMMARY:Mow the lawn (flexible window)");
    expect(windowEvent).toContain("TRANSP:TRANSPARENT");
    expect(windowEvent).toContain("no time is reserved");
    expect(windowEvent).not.toContain("DURATION:");
    expect(windowEvent).not.toContain("RRULE:");
    expect(windowEvent).not.toContain("VALARM");
    expect(
      events.some(event => event.includes("UID:window-task-slot@steadier"))
    ).toBe(false);
    expect(
      events.some(event =>
        event.includes("UID:window-task-rem-window-slot@steadier")
      )
    ).toBe(false);
  });
});

describe("calendar recurrence end bounds", () => {
  it("uses the count boundary when it comes before the end date", () => {
    const rule = {
      ...emptyRepeat("weekly"),
      weekdays: [1],
      count: 3,
      until: "2026-12-31",
    };
    expect(rruleFor(rule, "2026-10-26")).toBe(
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261109T235959Z"
    );
  });

  it("uses the end date when it comes before the count boundary", () => {
    const rule = {
      ...emptyRepeat("weekly"),
      weekdays: [1],
      count: 10,
      until: "2026-11-03",
    };
    expect(rruleFor(rule, "2026-10-26")).toBe(
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261103T235959Z"
    );
  });
});
