import { describe, expect, it } from "vitest";
import { emptyWorkspace } from "../../../server/steadier/validation";
import { completeTask, createTask } from "./engine";
import { emptyRepeat, emptyTaskSchedule } from "./time";
import { clearRepeatReviewDates, REPEAT_REVIEW_CLEARED } from "./repeatReview";
import type { Task } from "./types";

const STAMP = "2026-11-18T18:00:00+10:30";
function repeating(title: string, extra: Partial<Task> = {}): Task {
  const t = createTask({ title, state: "ready", nextAction: title } as Partial<Task> & { title: string });
  return {
    ...t,
    reviewDate: "2026-11-25",
    schedule: { ...emptyTaskSchedule(), date: "2026-11-25", time: "09:00", minutes: 60, fixed: true, repeat: { ...emptyRepeat("weekly"), weekdays: [3] } },
    ...extra,
  };
}

describe("Repeats don't get a Next review", () => {
  it("clears it on open repeats only, with a history line", () => {
    const open = repeating("Di cleaning");
    const done = repeating("Old one", { state: "done" });
    const plain = { ...createTask({ title: "One-off" }), reviewDate: "2026-11-20" };
    const { workspace, cleared } = clearRepeatReviewDates({ ...emptyWorkspace(), tasks: [open, done, plain] }, STAMP);
    expect(cleared.map(t => t.title)).toEqual(["Di cleaning"]);
    const byTitle = (title: string) => workspace.tasks.find(t => t.title === title)!;
    expect(byTitle("Di cleaning").reviewDate).toBeNull();
    expect(byTitle("Di cleaning").history.at(-1)!.text).toBe(REPEAT_REVIEW_CLEARED);
    expect(byTitle("Old one").reviewDate).toBe("2026-11-25");
    expect(byTitle("One-off").reviewDate).toBe("2026-11-20");
  });

  it("finishing a repeat makes the next one with no review date", () => {
    const open = repeating("Di cleaning");
    const ws = { ...emptyWorkspace(), tasks: [open] };
    const after = completeTask(ws.tasks, open.id, "2026-11-25T16:00:00+10:30");
    const next = after.find(t => t.id !== open.id && t.title === "Di cleaning");
    expect(next).toBeDefined();
    expect(next!.reviewDate).toBeNull();
  });
});
