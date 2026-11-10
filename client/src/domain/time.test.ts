import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quickParse";
import {
  emptyRepeat,
  nextOccurrence,
  occurrencesBetween,
  describeRepeat,
  focusPlanForTask,
  formatCompactDuration,
  rescheduleOccurrenceSchedule,
} from "./time";
import { completeTask, createTask, skipOccurrence } from "./engine";

// Sunday 25 October 2026
const TODAY = "2026-10-25";

describe("focus plan for a task", () => {
  it("uses the scheduled slot length and allows its timer to outlive completion", () => {
    const task = createTask({ title: "Call the supplier", nextAction: "Call" }, TODAY);
    const scheduled = {
      ...task,
      estimate: 20,
      schedule: {
        ...task.schedule,
        date: TODAY,
        time: "15:00",
        minutes: 45,
      },
    };
    expect(focusPlanForTask(scheduled)).toEqual({
      durationMinutes: 45,
      continueAfterDone: true,
    });
  });

  it("uses a recurring series time and duration when the current instance has no time field", () => {
    const task = createTask({ title: "Weekly clean", nextAction: "Start" }, TODAY);
    const recurring = {
      ...task,
      estimate: 20,
      schedule: {
        ...task.schedule,
        date: null,
        time: null,
        repeat: emptyRepeat("weekly"),
        repeatAnchorDate: TODAY,
        repeatOccurrenceDate: TODAY,
        repeatTime: "09:00",
        fixed: true,
        minutes: 45,
      },
    };

    expect(focusPlanForTask(recurring)).toEqual({
      durationMinutes: 45,
      continueAfterDone: true,
    });
  });

  it("uses the estimate for a scheduled task without an explicit slot length", () => {
    const task = createTask({ title: "Write report", nextAction: "Open draft" }, TODAY);
    expect(
      focusPlanForTask({
        ...task,
        estimate: 35,
        schedule: { ...task.schedule, date: TODAY },
      })
    ).toMatchObject({ durationMinutes: 35, continueAfterDone: true });
  });

  it("keeps the ordinary 10-minute focus start for unscheduled work", () => {
    const task = createTask({ title: "Tidy desk", nextAction: "Clear one corner" }, TODAY);
    expect(focusPlanForTask(task)).toEqual({
      durationMinutes: 10,
      continueAfterDone: false,
    });
  });
});

describe("compact duration labels", () => {
  it("formats screen capacity as compact hours and minutes", () => {
    expect(formatCompactDuration(165)).toBe("2h 45m");
    expect(formatCompactDuration(60)).toBe("1h");
    expect(formatCompactDuration(15)).toBe("15m");
    expect(formatCompactDuration(-5)).toBe("0m");
  });
});

describe("quick add parser", () => {
  it("parses the headline example", () => {
    const r = parseQuickAdd(
      "call Sam tomorrow 3pm for 30 min every Tuesday remind me 15 min before",
      TODAY
    );
    expect(r.title).toBe("call Sam");
    expect(r.time).toBe("15:00");
    expect(r.minutes).toBe(30);
    expect(r.repeat).toMatchObject({
      freq: "weekly",
      interval: 1,
      weekdays: [2],
    });
    expect(r.reminders).toEqual([{ minutesBefore: 15, anchor: "slot" }]);
    expect(r.date).toBe("2026-10-26");
    expect(r.understood).toContain("Every Tue");
  });

  it("handles dates, deadlines and times", () => {
    expect(
      parseQuickAdd("dentist next Tuesday at 9:30am", TODAY)
    ).toMatchObject({
      title: "dentist",
      date: "2026-10-27",
      time: "09:30",
      fixed: true,
    });
    expect(parseQuickAdd("pay rego by 12/11", TODAY)).toMatchObject({
      title: "pay rego",
      deadline: "2026-11-12",
    });
    expect(parseQuickAdd("submit report due Friday 5pm", TODAY)).toMatchObject({
      title: "submit report",
      deadline: "2026-10-30",
      deadlineTime: "17:00",
    });
    expect(parseQuickAdd("book flights 3 Dec", TODAY).date).toBe("2026-12-03");
    expect(parseQuickAdd("renew passport in 2 weeks", TODAY).date).toBe(
      "2026-11-08"
    );
    expect(parseQuickAdd("review budget tonight", TODAY)).toMatchObject({
      date: TODAY,
      time: "19:00",
    });
    expect(parseQuickAdd("stretch at 5", TODAY).time).toBe("17:00");
    expect(
      parseQuickAdd("remind me 1 hour before: call mum 4pm", TODAY).reminders
    ).toEqual([{ minutesBefore: 60, anchor: "slot" }]);
    expect(parseQuickAdd("gym 6:15am for 1 hour", TODAY)).toMatchObject({
      time: "06:15",
      minutes: 60,
    });
    expect(parseQuickAdd("deep work 1h30", TODAY).minutes).toBe(90);
  });

  it("handles repeat phrases", () => {
    expect(
      parseQuickAdd("bins every Monday and Thursday", TODAY).repeat
    ).toMatchObject({ freq: "weekly", weekdays: [1, 4] });
    expect(
      parseQuickAdd("standup every weekday 9am", TODAY).repeat?.weekdays
    ).toEqual([1, 2, 3, 4, 5]);
    expect(
      parseQuickAdd("water plants every 3 days", TODAY).repeat
    ).toMatchObject({ freq: "daily", interval: 3 });
    expect(
      parseQuickAdd("haircut 5 weeks after done", TODAY).repeat
    ).toMatchObject({ freq: "after", interval: 35 });
    expect(
      parseQuickAdd("rent on the 15th of every month", TODAY).repeat
    ).toMatchObject({ freq: "monthly", monthDay: 15 });
    expect(
      parseQuickAdd("team review every 2nd Tuesday", TODAY).repeat
    ).toMatchObject({
      freq: "monthly",
      nthWeekday: { n: 2, weekday: 2 },
    });
    expect(
      parseQuickAdd("invoice last day of the month", TODAY).repeat
    ).toMatchObject({ monthDay: -1 });
    expect(parseQuickAdd("mow lawn fortnightly", TODAY).repeat).toMatchObject({
      freq: "weekly",
      interval: 2,
    });
    expect(
      parseQuickAdd("physio every week until 20 Dec", TODAY).repeat?.until
    ).toBe("2026-12-20");
    const first = parseQuickAdd("bins every Monday and Thursday", TODAY);
    expect(first.date).toBe("2026-10-26");
  });

  it("leaves ordinary words alone", () => {
    expect(
      parseQuickAdd("Ask Monday's group about the March plan", TODAY).title
    ).toContain("group");
    expect(parseQuickAdd("Fix the leaking kitchen tap", TODAY)).toMatchObject({
      title: "Fix the leaking kitchen tap",
      date: null,
      time: null,
      repeat: null,
    });
  });
});

describe("repeat rules", () => {
  it("computes weekly, monthly and yearly occurrences", () => {
    const weekly = { ...emptyRepeat("weekly"), weekdays: [1, 4] };
    expect(nextOccurrence(weekly, "2026-10-26", "2026-10-26")).toBe(
      "2026-10-29"
    );
    expect(nextOccurrence(weekly, "2026-10-29", "2026-10-26")).toBe(
      "2026-11-02"
    );
    const fortnightly = { ...emptyRepeat("weekly"), interval: 2 };
    expect(nextOccurrence(fortnightly, "2026-10-26", "2026-10-26")).toBe(
      "2026-11-09"
    );
    const second = {
      ...emptyRepeat("monthly"),
      nthWeekday: { n: 2, weekday: 2 },
    };
    expect(nextOccurrence(second, "2026-10-13", "2026-10-13")).toBe(
      "2026-11-10"
    );
    const lastDay = { ...emptyRepeat("monthly"), monthDay: -1 };
    expect(nextOccurrence(lastDay, "2027-01-31", "2027-01-31")).toBe(
      "2027-02-28"
    );
    const day31 = { ...emptyRepeat("monthly"), monthDay: 31 };
    expect(nextOccurrence(day31, "2026-10-31", "2026-10-31")).toBe(
      "2026-11-30"
    );
    expect(
      nextOccurrence(emptyRepeat("yearly"), "2026-10-25", "2024-02-29")
    ).toBe("2027-02-28");
    const until = { ...emptyRepeat("daily"), until: "2026-10-26" };
    expect(nextOccurrence(until, "2026-10-26")).toBeNull();
    expect(
      occurrencesBetween(weekly, "2026-10-26", "2026-10-26", "2026-11-08")
    ).toEqual(["2026-10-26", "2026-10-29", "2026-11-02", "2026-11-05"]);
    expect(describeRepeat(second)).toBe("Every month on the 2nd Tuesday");
  });

  it("creates the next occurrence on the calendar pattern and carries the series", () => {
    const task = createTask(
      {
        title: "Bins",
        nextAction: "Wheel bins out",
        schedule: {
          ...createTask({ title: "x" }).schedule,
          date: "2026-10-26",
          time: "19:00",
          repeat: { ...emptyRepeat("weekly"), weekdays: [1, 4] },
          reminders: [{ id: "r", minutesBefore: 30, anchor: "slot" }],
        },
      },
      "2026-10-20"
    );
    const after = completeTask([task], task.id, "2026-10-26");
    expect(after).toHaveLength(2);
    const next = after[1];
    expect(next.schedule).toMatchObject({
      date: "2026-10-29",
      time: "19:00",
      seriesId: task.id,
      completions: ["2026-10-26"],
    });
    expect(next.schedule.reminders).toHaveLength(1);
    // Completing late never schedules into the past.
    const late = completeTask([next], next.id, "2026-11-04");
    expect(late[1].schedule.date).toBe("2026-11-05");
    expect(late[1].schedule.completions).toEqual(["2026-10-26", "2026-11-04"]);
  });

  it("stops after the count and can skip one occurrence", () => {
    const task = createTask(
      {
        title: "Course",
        schedule: {
          ...createTask({ title: "x" }).schedule,
          date: "2026-10-26",
          repeat: { ...emptyRepeat("weekly"), count: 1 },
        },
      },
      "2026-10-20"
    );
    expect(completeTask([task], task.id, "2026-10-26")).toHaveLength(1);
    const weekly = createTask(
      {
        title: "Weekly call",
        deadline: "2026-10-27",
        schedule: {
          ...createTask({ title: "x" }).schedule,
          date: "2026-10-26",
          repeat: emptyRepeat("weekly"),
        },
      },
      "2026-10-20"
    );
    const skipped = skipOccurrence(weekly, "2026-10-25");
    expect(skipped?.schedule.date).toBe("2026-11-02");
    expect(skipped?.deadline).toBe("2026-11-03");
    expect(skipped?.schedule.skipped).toEqual(["2026-10-26"]);
  });

  it("keeps legacy repeat-every-N-days behaviour", () => {
    const task = createTask({ title: "Water", repeatDays: 3 }, "2026-10-20");
    expect(task.schedule.repeat).toMatchObject({ freq: "after", interval: 3 });
    const after = completeTask([task], task.id, "2026-10-25");
    expect(after[1].startDate).toBe("2026-10-28");
  });
});


describe("recurring occurrence rescheduling", () => {
  it("moves one weekly instance and restores the series time next time", () => {
    const task = createTask(
      {
        title: "Weekly bins",
        schedule: {
          ...createTask({ title: "x" }).schedule,
          date: "2026-10-26",
          time: "19:00",
          repeat: { ...emptyRepeat("weekly"), weekdays: [1] },
        },
      },
      TODAY
    );
    const moved = {
      ...task,
      schedule: rescheduleOccurrenceSchedule(task.schedule, {
        date: "2026-10-27",
        time: "20:30",
      }),
    };
    expect(moved.schedule).toMatchObject({
      date: "2026-10-27",
      time: "20:30",
      repeatAnchorDate: "2026-10-26",
      repeatOccurrenceDate: "2026-10-26",
      repeatTime: "19:00",
    });

    const completed = completeTask([moved], task.id, "2026-10-27")[1];
    expect(completed.schedule).toMatchObject({
      date: "2026-11-02",
      time: "19:00",
      repeatAnchorDate: "2026-10-26",
      repeatOccurrenceDate: "2026-11-02",
      repeatTime: "19:00",
    });

    const skipped = skipOccurrence(moved, "2026-10-27");
    expect(skipped?.schedule).toMatchObject({
      date: "2026-11-02",
      time: "19:00",
      repeatOccurrenceDate: "2026-11-02",
      skipped: ["2026-10-26"],
    });
  });

  it("keeps the next pattern date when a future occurrence is moved later", () => {
    const task = createTask(
      {
        title: "Weekly bins",
        schedule: {
          ...createTask({ title: "x" }).schedule,
          date: "2026-10-26",
          time: "19:00",
          repeat: { ...emptyRepeat("weekly"), weekdays: [1] },
        },
      },
      TODAY
    );
    const moved = {
      ...task,
      schedule: rescheduleOccurrenceSchedule(task.schedule, {
        date: "2026-11-10",
        time: "20:30",
      }),
    };

    const next = completeTask([moved], task.id, "2026-10-26")[1];
    expect(next.schedule).toMatchObject({
      date: "2026-11-02",
      time: "19:00",
      repeatAnchorDate: "2026-10-26",
      repeatOccurrenceDate: "2026-11-02",
    });
  });

  it("uses the original occurrence date when a moved legacy series has no anchor", () => {
    const task = createTask(
      {
        title: "Fortnightly collection",
        schedule: {
          ...createTask({ title: "x" }).schedule,
          date: "2026-11-03",
          time: "18:00",
          repeat: {
            ...emptyRepeat("weekly"),
            interval: 2,
            weekdays: [1, 4],
          },
          repeatAnchorDate: null,
          repeatOccurrenceDate: "2026-10-26",
          repeatTime: "09:00",
        },
      },
      TODAY
    );

    const adjusted = rescheduleOccurrenceSchedule(task.schedule, {
      date: "2026-11-04",
    });
    expect(adjusted.repeatAnchorDate).toBe("2026-10-26");

    const completed = completeTask([task], task.id, "2026-10-27")[1];
    expect(completed.schedule).toMatchObject({
      date: "2026-10-29",
      time: "09:00",
      repeatAnchorDate: "2026-10-26",
      repeatOccurrenceDate: "2026-10-29",
    });

    const skipped = skipOccurrence(task, "2026-10-27");
    expect(skipped?.schedule).toMatchObject({
      date: "2026-10-29",
      repeatAnchorDate: "2026-10-26",
      repeatOccurrenceDate: "2026-10-29",
      skipped: ["2026-10-26"],
    });
  });

  it("keeps a stable two-week anchor and shifts each deadline by the occurrence interval", () => {
    const task = createTask(
      {
        title: "Fortnightly invoice",
        deadline: "2026-10-27",
        schedule: {
          ...createTask({ title: "x" }).schedule,
          date: "2026-10-26",
          repeat: {
            ...emptyRepeat("weekly"),
            interval: 2,
            weekdays: [1],
          },
        },
      },
      TODAY
    );

    const first = completeTask([task], task.id, "2026-10-26")[1];
    expect(first).toMatchObject({ deadline: "2026-11-10" });
    expect(first.schedule).toMatchObject({
      date: "2026-11-09",
      repeatAnchorDate: "2026-10-26",
      repeatOccurrenceDate: "2026-11-09",
    });

    const second = completeTask([first], first.id, "2026-11-09")[1];
    expect(second).toMatchObject({ deadline: "2026-11-24" });
    expect(second.schedule).toMatchObject({
      date: "2026-11-23",
      repeatAnchorDate: "2026-10-26",
      repeatOccurrenceDate: "2026-11-23",
    });
  });
});
