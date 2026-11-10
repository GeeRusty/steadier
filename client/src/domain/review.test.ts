import { describe, expect, it } from "vitest";
import { completeTask, createTask } from "./engine";
import {
  applyReview,
  describeReview,
  emptyFloor,
  latestWeeklyReviewDate,
  reviewStatus,
  reviewsField,
  unconfirmedCommitments,
  type WeeklyReview,
} from "./review";
import type { Imperative } from "./compass";
import type { Task, Workspace } from "./types";

const TODAY = "2026-10-25";
function task(title: string, patch: Partial<Task> = {}): Task {
  const t = createTask({ title }, "2026-10-10");
  return {
    ...t,
    ...patch,
    schedule: { ...t.schedule, ...(patch.schedule ?? {}) },
  };
}
function imp(id: string): Imperative {
  return {
    id,
    title: `Imp ${id}`,
    reason: "",
    status: "active",
    setOn: "2026-10-01",
    retiredOn: null,
    notionUrl: null,
    decision: null,
    history: [],
    createdAt: "2026-10-01T09:00:00",
    updatedAt: "2026-10-01T09:00:00",
  };
}
function ws(tasks: Task[], extra: Partial<Workspace> = {}): Workspace {
  return {
    version: 2,
    tasks,
    projects: [],
    focus: null,
    intention: null,
    matrixWeights: {
      "direction-timely": 1,
      "direction-sustained": 1,
      "support-timely": 1,
      "support-sustained": 1,
    },
    trial: {
      startedAt: "2026-10-01T09:00:00",
      lastExportAt: null,
      lastReviewAt: null,
    },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [],
    ...extra,
  };
}
function review(patch: Partial<WeeklyReview> = {}): WeeklyReview {
  return {
    id: "rev-1",
    at: "2026-10-25T18:00:00",
    date: TODAY,
    floor: emptyFloor(),
    decisions: [],
    imperatives: [],
    quietImperatives: [],
    unplacedBefore: 0,
    unplacedAfter: 0,
    notes: "",
    ...patch,
  };
}

describe("Weekly Reality Review", () => {
  it("asks about passed planned days, passed deadlines and long waits, not future or done work", () => {
    const past = task("Planned last week", {
      schedule: { date: "2026-10-20" } as Task["schedule"],
    });
    const overdue = task("Overdue", { deadline: "2026-10-22" });
    const future = task("Next week", { deadline: "2026-11-01" });
    const done = task("Finished", { deadline: "2026-10-20", state: "done" });
    const waiting = task("Waiting on Sam", {
      state: "waiting",
      updatedAt: "2026-10-12T10:00:00",
    });
    const ids = unconfirmedCommitments(
      [past, overdue, future, done, waiting],
      TODAY
    ).map(t => t.title);
    expect(ids.sort()).toEqual([
      "Overdue",
      "Planned last week",
      "Waiting on Sam",
    ]);
  });
  it("is due after 7 days, or when never done, and reports drift", () => {
    expect(reviewStatus(ws([task("a")]), TODAY).due).toBe(true);
    const recent = ws([task("a")], {
      reviews: [review({ date: "2026-10-22" })],
    });
    expect(reviewStatus(recent, TODAY)).toMatchObject({
      due: false,
      daysSince: 3,
    });
    const old = ws([task("a")], {
      reviews: [review({ date: "2026-10-17" })],
      imperatives: [imp("x")],
    });
    const s = reviewStatus(old, TODAY);
    expect(s).toMatchObject({ due: true, daysSince: 8, unplaced: 1 });
    expect(s.quiet.map(q => q.id)).toEqual(["x"]);
  });
  it("shares the latest saved review day and falls back to the legacy timestamp", () => {
    const empty = ws([task("a")]);
    expect(latestWeeklyReviewDate(empty)).toBeNull();

    const legacy = ws([], {
      trial: {
        startedAt: "2026-10-01T09:00:00",
        lastExportAt: null,
        lastReviewAt: "2026-10-20T18:00:00",
      },
    });
    expect(latestWeeklyReviewDate(legacy)).toBe("2026-10-20");

    const saved = ws([], {
      reviews: [review({ date: "2026-10-22" })],
      trial: {
        startedAt: "2026-10-01T09:00:00",
        lastExportAt: null,
        lastReviewAt: "2026-10-20T18:00:00",
      },
    });
    expect(latestWeeklyReviewDate(saved)).toBe("2026-10-22");
  });
  it("applies only the owner's answers: done completes, drop keeps under Someday, not-yet is noted", () => {
    const a = task("Call agent"),
      b = task("Old idea"),
      c = task("Book service");
    const w = ws([a, b, c], { imperatives: [imp("x"), imp("y")] });
    const r = review({
      floor: {
        ...emptyFloor(),
        action: [
          { taskId: a.id, title: a.title, answer: "done" },
          { taskId: b.id, title: b.title, answer: "drop" },
          { taskId: c.id, title: c.title, answer: "not-yet" },
        ],
      },
      decisions: [
        {
          kind: "imperative",
          id: "y",
          title: "Imp y",
          outcome: "retire",
          note: "Lease sorted",
        },
      ],
    });
    const out = applyReview(w, r, (tasks, id) => completeTask(tasks, id));
    const get = (id: string) => out.tasks.find(t => t.id === id)!;
    expect(get(a.id).state).toBe("done");
    expect(get(b.id).state).toBe("someday");
    expect(out.tasks).toHaveLength(3);
    expect(get(c.id).state).toBe(c.state);
    expect(get(c.id).history.at(-1)!.text).toMatch(/Not done yet/);
    const y = out.imperatives.find(i => i.id === "y")!;
    expect(y).toMatchObject({
      status: "retired",
      retiredOn: TODAY,
      decision: { outcome: "retire", by: "owner", confirmed: true },
    });
    expect(out.imperatives.find(i => i.id === "x")!.status).toBe("active");
    expect(out.reviews).toHaveLength(1);
    expect(out.trial.lastReviewAt).toBe(r.at);
  });
  it("validates stored reviews strictly and summarises them plainly", () => {
    const r = review({
      floor: {
        money: { answer: "ok", note: "" },
        action: [{ taskId: "t1", title: "x", answer: "done" }],
        capacity: { answer: "low", note: "" },
      },
      unplacedBefore: 5,
      unplacedAfter: 2,
    });
    expect(reviewsField([r])).toEqual([r]);
    expect(() => reviewsField([{ ...r, extra: 1 }])).toThrow();
    expect(() =>
      reviewsField([
        { ...r, floor: { ...r.floor, money: { answer: "maybe", note: "" } } },
      ])
    ).toThrow();
    expect(describeReview(r)).toBe(
      "2026-10-25: Money OK; 1 commitments checked (1 done, 0 not yet, 0 dropped); capacity low. 0 Imperatives held, 0 decisions recorded. Unplaced 5 → 2."
    );
  });
});
