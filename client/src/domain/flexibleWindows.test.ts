import { describe, expect, it } from "vitest";
import { buildCalendar } from "./calendarModel";
import { completeTask, createTask, skipOccurrence, updateTask } from "./engine";
import { planMyDay } from "./planning";
import { reminderInstants } from "./reminders";
import { parseQuickAdd } from "./quickParse";
import {
  describeFlexibleWindow,
  emptyRepeat,
  emptyTaskSchedule,
  flexibleWindowState,
  nextWeekWindow,
  rescheduleOccurrenceSchedule,
  setFlexibleWindowSchedule,
  shiftDays,
  thisWeekendWindow,
  weekStart,
  type FlexibleTimeWindow,
} from "./time";

const TODAY = "2026-10-25"; // Sunday in Australia/Adelaide
const WEEKEND: FlexibleTimeWindow = {
  startDate: "2026-10-24",
  endDate: "2026-10-25",
};

function flexibleTask(repeat = false) {
  const schedule = {
    ...emptyTaskSchedule(),
    flexibleWindow: { ...WEEKEND },
    minutes: 120,
    ...(repeat
      ? {
          repeat: { ...emptyRepeat("weekly"), weekdays: [6] },
          repeatAnchorDate: WEEKEND.startDate,
          repeatOccurrenceDate: WEEKEND.startDate,
          repeatTime: null,
        }
      : {}),
  };
  return createTask(
    {
      id: "weekend-task",
      title: "Mow the lawn",
      nextAction: "Take out the mower",
      schedule,
    },
    TODAY
  );
}

describe("flexible time windows", () => {
  it("uses inclusive Adelaide-local presets and labels without DST day drift", () => {
    expect(thisWeekendWindow(TODAY)).toEqual(WEEKEND);
    expect(nextWeekWindow(TODAY)).toEqual({
      startDate: "2026-10-26",
      endDate: "2026-11-01",
    });
    expect(describeFlexibleWindow(WEEKEND, TODAY)).toBe("This weekend");
    expect(flexibleWindowState(WEEKEND, "2026-10-23")).toBe("upcoming");
    expect(flexibleWindowState(WEEKEND, "2026-10-24")).toBe("active");
    expect(flexibleWindowState(WEEKEND, "2026-10-25")).toBe("closes-today");
    expect(flexibleWindowState(WEEKEND, "2026-10-26")).toBe("expired");

    // Adelaide's daylight-saving transition is 4 October 2026; calendar dates
    // remain stable because range arithmetic is date-only, not elapsed-hours.
    expect(shiftDays("2026-10-03", 1)).toBe("2026-10-04");
    expect(weekStart("2026-10-04")).toBe("2026-09-28");
    expect(flexibleTask().state).not.toBe("done");
  });

  it("parses editable window phrases and effort, while clock times stay fixed", () => {
    expect(
      parseQuickAdd("Mow the lawn 2 hours — do this weekend", TODAY)
    ).toMatchObject({
      title: "Mow the lawn",
      date: null,
      time: null,
      minutes: 120,
      flexibleWindow: WEEKEND,
    });
    expect(parseQuickAdd("Call the bank available today", TODAY)).toMatchObject(
      {
        flexibleWindow: { startDate: TODAY, endDate: TODAY },
        date: null,
        time: null,
      }
    );
    expect(
      parseQuickAdd("Review the budget next week", TODAY).flexibleWindow
    ).toEqual(nextWeekWindow(TODAY));

    const recurring = parseQuickAdd("Mow the lawn every weekend", TODAY);
    expect(recurring.flexibleWindow).toEqual(WEEKEND);
    expect(recurring.date).toBeNull();
    expect(recurring.time).toBeNull();
    expect(recurring.repeat).toMatchObject({ freq: "weekly", weekdays: [6] });

    expect(parseQuickAdd("Dentist Saturday 10am", TODAY)).toMatchObject({
      date: "2026-10-31",
      time: "10:00",
      flexibleWindow: null,
    });
  });

  it("converts the same existing task and preserves its content and true deadline", () => {
    const source = createTask(
      {
        id: "existing-fixed-task",
        title: "Call the supplier",
        state: "waiting",
        nextAction: "Ask for the revised quote",
        waitingFor: "Supplier response",
        notes: "Do not lose this task context.",
        projectId: "project-one",
        deadline: "2026-11-02",
        estimate: 60,
        schedule: {
          ...emptyTaskSchedule(),
          date: "2026-10-26",
          time: "14:00",
          minutes: 120,
          fixed: true,
          deadlineTime: "17:00",
          reminders: [
            { id: "slot-reminder", minutesBefore: 15, anchor: "slot" },
            {
              id: "deadline-reminder",
              minutesBefore: 1440,
              anchor: "deadline",
            },
          ],
        },
      },
      TODAY
    );
    const convertedSchedule = setFlexibleWindowSchedule(
      source.schedule,
      WEEKEND,
      source.deadline
    );
    const saved = updateTask(
      source,
      { schedule: convertedSchedule },
      "Changed timing to a flexible window."
    );

    expect(saved).toMatchObject({
      id: source.id,
      title: source.title,
      state: "waiting",
      nextAction: source.nextAction,
      waitingFor: source.waitingFor,
      notes: source.notes,
      projectId: source.projectId,
      deadline: "2026-11-02",
      estimate: 60,
    });
    expect(saved.createdAt).toBe(source.createdAt);
    expect(saved.schedule).toMatchObject({
      date: null,
      time: null,
      fixed: false,
      minutes: 120,
      deadlineTime: "17:00",
      flexibleWindow: WEEKEND,
      reminders: [
        { id: "deadline-reminder", minutesBefore: 1440, anchor: "deadline" },
      ],
    });
    expect(saved.history.at(-1)?.text).toBe(
      "Changed timing to a flexible window."
    );

    const explicitlyTimed = rescheduleOccurrenceSchedule(saved.schedule, {
      date: WEEKEND.startDate,
      time: "10:00",
    });
    expect(explicitlyTimed).not.toHaveProperty("flexibleWindow");
    expect(explicitlyTimed).toMatchObject({
      date: WEEKEND.startDate,
      time: "10:00",
    });
  });

  it("keeps an explicitly chosen time for the next single recurrence after window conversion", () => {
    const windowTask = flexibleTask(true);
    const fixedSchedule = rescheduleOccurrenceSchedule(
      windowTask.schedule,
      { date: WEEKEND.startDate, time: "10:00" },
      TODAY
    );
    expect(fixedSchedule).not.toHaveProperty("flexibleWindow");
    expect(fixedSchedule.repeatTime).toBe("10:00");

    const timedTask = updateTask(
      windowTask,
      { schedule: fixedSchedule },
      "Placed this occurrence at 10 am."
    );
    const completed = completeTask([timedTask], timedTask.id, TODAY);
    expect(completed).toHaveLength(2);
    expect(completed[1].schedule).toMatchObject({
      date: "2026-10-31",
      time: "10:00",
      repeatTime: "10:00",
    });
    expect(completed[1].schedule).not.toHaveProperty("flexibleWindow");
  });

  it("keeps a weekend task open through Sunday and creates only one next window", () => {
    const task = flexibleTask(true);
    expect(
      flexibleWindowState(task.schedule.flexibleWindow!, "2026-10-25")
    ).toBe("closes-today");
    expect(task.state).toBe("ready");

    const completed = completeTask([task], task.id, "2026-10-25");
    expect(completed).toHaveLength(2);
    expect(completed[0].state).toBe("done");
    expect(completed[1].schedule).toMatchObject({
      date: null,
      time: null,
      repeatAnchorDate: WEEKEND.startDate,
      repeatOccurrenceDate: "2026-10-31",
      flexibleWindow: { startDate: "2026-10-31", endDate: "2026-11-01" },
    });

    const skipped = skipOccurrence(task, "2026-10-25");
    expect(skipped).toMatchObject({
      id: task.id,
      state: "ready",
      schedule: {
        date: null,
        time: null,
        skipped: [WEEKEND.startDate],
        flexibleWindow: { startDate: "2026-10-31", endDate: "2026-11-01" },
      },
    });
  });

  it("keeps flexible windows off every calendar grid without projecting them", () => {
    const task = flexibleTask(true);
    const calendar = buildCalendar(
      [task],
      [],
      ["2026-10-24", "2026-10-25", "2026-10-31"],
      TODAY
    );
    expect(calendar[0].timed).toEqual([]);
    expect(calendar[0].allDay).toEqual([]);
    expect(calendar[1].timed).toEqual([]);
    expect(calendar[1].allDay).toEqual([]);
    expect(calendar[2].timed).toEqual([]);
    expect(calendar[2].allDay).toEqual([]);
  });

  it("does not auto-place a flexible window or alert for its slot", () => {
    const task = flexibleTask();
    expect(planMyDay([task], TODAY, 8 * 60)).toEqual([]);
    expect(
      reminderInstants({
        ...task,
        deadline: "2026-10-30",
        schedule: {
          ...task.schedule,
          deadlineTime: "17:00",
          reminders: [
            { id: "slot", minutesBefore: 15, anchor: "slot" },
            { id: "deadline", minutesBefore: 30, anchor: "deadline" },
          ],
        },
      })
    ).toHaveLength(1);
  });
});
