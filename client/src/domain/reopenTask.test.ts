import { describe, expect, it } from "vitest";
import { completeTask, createTask, reopenTaskOccurrence } from "./engine";
import { emptyRepeat } from "./time";

const TODAY = "2026-11-09";

describe("reopenTaskOccurrence", () => {
  it("reopens only the selected completed task and preserves its history and content", () => {
    const task = createTask(
      {
        title: "Synthetic completed job",
        nextAction: "Do the first small step",
        notes: "Synthetic note",
        createdAt: `${TODAY}T08:00:00+10:30`,
      },
      TODAY
    );
    const other = createTask(
      { title: "Synthetic unrelated task", createdAt: `${TODAY}T08:01:00+10:30` },
      TODAY
    );
    const completed = {
      ...task,
      state: "done" as const,
      completedAt: `${TODAY}T09:00:00+10:30`,
      history: [
        ...task.history,
        { at: `${TODAY}T09:00:00+10:30`, text: "Completed task." },
      ],
    };
    const before = [completed, other];

    const after = reopenTaskOccurrence(before, completed.id);
    const reopened = after.find(item => item.id === completed.id)!;

    expect(reopened.state).toBe("ready");
    expect(reopened.completedAt).toBeNull();
    expect(reopened.title).toBe(completed.title);
    expect(reopened.notes).toBe(completed.notes);
    expect(reopened.history.some(entry => entry.text === "Completed task.")).toBe(true);
    expect(reopened.history.at(-1)?.text).toBe("Reopened completed task.");
    expect(after.find(item => item.id === other.id)).toBe(other);
    expect(completed.state).toBe("done");
  });

  it("keeps a future repeat scheduled and prevents a duplicate when the current occurrence is completed again", () => {
    const task = createTask(
      {
        title: "Synthetic recurring job",
        nextAction: "Do one step",
        createdAt: `${TODAY}T08:00:00+10:30`,
      },
      TODAY
    );
    const recurring = {
      ...task,
      schedule: {
        ...task.schedule,
        date: TODAY,
        repeat: emptyRepeat("weekly"),
        repeatAnchorDate: TODAY,
        repeatOccurrenceDate: TODAY,
      },
    };

    const completed = completeTask([recurring], recurring.id, TODAY);
    const next = completed.find(item => item.id !== recurring.id)!;
    const reopened = reopenTaskOccurrence(completed, recurring.id);
    expect(reopened.find(item => item.id === next.id)).toBe(next);
    expect(reopened.find(item => item.id === recurring.id)?.state).toBe("ready");

    const completedAgain = completeTask(reopened, recurring.id, TODAY);
    expect(
      completedAgain.filter(
        item =>
          item.id !== recurring.id &&
          item.schedule.seriesId === recurring.id &&
          item.schedule.repeatOccurrenceDate === next.schedule.repeatOccurrenceDate
      )
    ).toHaveLength(1);
  });

  it("leaves missing and already-open task IDs unchanged", () => {
    const open = createTask({ title: "Synthetic open job" }, TODAY);
    const tasks = [open];
    expect(reopenTaskOccurrence(tasks, "missing")).toBe(tasks);
    expect(reopenTaskOccurrence(tasks, open.id)).toBe(tasks);
  });
});
