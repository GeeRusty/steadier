import { describe, expect, it } from "vitest";
import { attention, completeTask, createTask, derivedState } from "./engine";
import { validateWorkspace } from "./transfer";

const now = "2026-10-24";
const make = () =>
  createTask(
    { title: "Repair trailer", nextAction: "Ask for the replacement part" },
    now
  );

describe("integration defect regressions", () => {
  it("defers blocked reviews without hiding real commitments or inventory state", () => {
    const task = {
      ...make(),
      dependencies: ["missing"],
      reviewDate: now,
      deadline: now,
      deferredUntil: "2026-10-25",
    };
    const result = attention([task], { now });
    expect(derivedState(task, [task], now)).toBe("blocked");
    expect(result.items).toHaveLength(0);
    expect(result.reviewDue).toHaveLength(0);
    expect(result.commitments).toHaveLength(1);
    expect(attention([task], { now: "2026-10-25" }).items[0].kind).toBe(
      "review"
    );
  });

  it("keeps a named blocker non-actionable and releases dependency-only blocks", () => {
    const task = {
      ...make(),
      state: "blocked" as const,
      waitingFor: "Need access to the shed",
      reviewDate: now,
    };
    expect(derivedState(task, [task], now)).toBe("blocked");
    expect(attention([task], { now }).items[0].kind).toBe("review");
    const prerequisite = {
      ...make(),
      id: "measurements",
      state: "done" as const,
    };
    const dependent = {
      ...make(),
      state: "blocked" as const,
      dependencies: [prerequisite.id],
    };
    expect(derivedState(dependent, [prerequisite, dependent], now)).toBe(
      "ready"
    );
  });

  it("keeps undated recurrence unavailable until its next occurrence", () => {
    const task = {
      ...make(),
      important: true,
      pinned: true,
      repeatDays: 30,
      startDate: null,
      deadline: null,
    };
    const tasks = completeTask([task], task.id, now);
    expect(tasks[1].startDate).toBe("2026-11-23");
    expect(attention(tasks, { now }).items).toHaveLength(0);
  });

  it("validates saved tasks and focus without changing their IDs", () => {
    const task = make();
    const workspace = { version: 1, tasks: [task], focus: null };
    expect(validateWorkspace(workspace).tasks[0].id).toBe(task.id);
    expect(() =>
      validateWorkspace({
        ...workspace,
        tasks: [{ ...task, state: "garbage" }],
      })
    ).toThrow();
    expect(() =>
      validateWorkspace({
        ...workspace,
        tasks: [{ ...task, reviewDate: "2026-02-31" }],
      })
    ).toThrow();
    expect(() =>
      validateWorkspace({ ...workspace, focus: { taskId: task.id } })
    ).toThrow();
    expect(() =>
      validateWorkspace({
        ...workspace,
        focus: {
          taskId: task.id,
          duration: 600,
          remaining: 601,
          updatedAt: 0,
          running: true,
          step: "Begin",
        },
      })
    ).toThrow();
    expect(() =>
      validateWorkspace({
        ...workspace,
        tasks: [{ ...task, dependencies: ["absent"] }],
      })
    ).toThrow();
  });

  it("allows a completed task to keep a focus timer only with explicit continuation", () => {
    const task = make();
    const workspace = validateWorkspace({ version: 1, tasks: [task], focus: null });
    const session = {
      taskId: task.id,
      duration: 3600,
      remaining: 1800,
      updatedAt: 0,
      running: true,
      step: "Review notes",
    };
    const completed = {
      ...task,
      state: "done" as const,
      completedAt: new Date(0).toISOString(),
    };

    expect(
      validateWorkspace({ ...workspace, focus: session }).focus?.continueAfterDone
    ).toBeUndefined();
    expect(() =>
      validateWorkspace({ ...workspace, tasks: [completed], focus: session })
    ).toThrow();
    expect(
      validateWorkspace({
        ...workspace,
        tasks: [completed],
        focus: { ...session, continueAfterDone: true },
      }).focus
    ).toMatchObject({ taskId: task.id, continueAfterDone: true });
  });
});
