import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import { emptyTaskSchedule } from "./time";
import {
  isRunnableRoutine,
  runnableRoutines,
  setRoutineChecklistItem,
} from "./routineRunner";
import type { Task } from "./types";

function recurringTask(patch: Partial<Task> = {}): Task {
  const base = createTask({ title: "Water plants" });
  return {
    ...base,
    id: "routine-a",
    schedule: {
      ...emptyTaskSchedule(),
      repeat: {
        freq: "weekly",
        interval: 1,
        weekdays: [1],
        monthDay: null,
        nthWeekday: null,
        until: null,
        count: null,
      },
    },
    checklist: [
      { id: "step-a", text: "Fill the watering can", done: false },
      { id: "step-b", text: "Check the soil", done: false },
    ],
    ...patch,
  };
}

describe("Routine Runner helpers", () => {
  it("includes only open repeating tasks that already have a checklist", () => {
    const repeated = recurringTask();
    const noChecklist = recurringTask({ id: "no-checklist", checklist: [] });
    const noRepeat = recurringTask({
      id: "no-repeat",
      schedule: emptyTaskSchedule(),
    });
    const done = recurringTask({ id: "done", state: "done" });
    expect(
      runnableRoutines([noRepeat, done, repeated, noChecklist]).map(t => t.id)
    ).toEqual([repeated.id]);
    expect(isRunnableRoutine(repeated)).toBe(true);
  });

  it("logs a checklist toggle without completing, rescheduling or creating another task", () => {
    const task = recurringTask();
    const before = [task];
    const next = setRoutineChecklistItem(before, task.id, "step-a", true);
    expect(next).toHaveLength(1);
    expect(next[0].checklist[0].done).toBe(true);
    expect(next[0].state).toBe(task.state);
    expect(next[0].schedule).toEqual(task.schedule);
    expect(next[0].history).toHaveLength(task.history.length + 1);
    expect(setRoutineChecklistItem(next, task.id, "step-a", true)).toBe(next);
  });
});
