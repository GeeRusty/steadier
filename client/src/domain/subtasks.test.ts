import { describe, expect, it } from "vitest";
import { createTask, completeTask, attention } from "./engine";
import { emptyRepeat, emptyTaskSchedule } from "./time";
import { isUnplaced, confirmPlacement } from "./compass";
import { validateWorkspace } from "./transfer";
import {
  MAX_SUBTASK_DEPTH,
  addSubtask,
  childrenOf,
  completeTaskTree,
  descendantsOf,
  nestRows,
  openSubtasks,
  parentProblem,
  removeTaskAndReleaseChildren,
  releaseSubtasks,
  setTaskParent,
  subtaskProgress,
} from "./subtasks";
import type { Task } from "./types";

const NOW = "2026-10-20";
function base(title: string, extra: Partial<Task> = {}): Task {
  return createTask(
    {
      title,
      nextAction: `Do ${title}`,
      createdAt: `${NOW}T09:00:00`,
      ...extra,
    },
    NOW
  );
}
function add(tasks: Task[], parentId: string, title: string) {
  const r = addSubtask(tasks, parentId, title, { now: NOW });
  expect(r.error).toBeNull();
  return { tasks: r.tasks, task: r.task! };
}

describe("subtasks", () => {
  it("adds a confirmed subtask that inherits the parent's project", () => {
    const parent = base("Move house", { projectId: "p1" });
    const { tasks, task } = add([parent], parent.id, "Book removalist");
    expect(task.parent).toEqual({ id: parent.id, suggested: false });
    expect(task.projectId).toBe("p1");
    expect(childrenOf(tasks, parent.id).map(t => t.id)).toEqual([task.id]);
    expect(subtaskProgress(tasks, parent.id)).toEqual({ done: 0, total: 1 });
    // The parent record is not rewritten.
    expect(tasks[0]).toBe(parent);
  });

  it("allows four levels and refuses a fifth", () => {
    let tasks: Task[] = [base("Top")];
    let parentId = tasks[0].id;
    for (let level = 1; level <= MAX_SUBTASK_DEPTH; level++) {
      const r = add(tasks, parentId, `Level ${level}`);
      tasks = r.tasks;
      parentId = r.task.id;
    }
    const tooDeep = addSubtask(tasks, parentId, "Level 5", { now: NOW });
    expect(tooDeep.error).toMatch(/4 levels/);
  });

  it("refuses circles and self-parenting", () => {
    const a = base("A");
    let { tasks, task: b } = add([a], a.id, "B");
    ({ tasks } = add(tasks, b.id, "C"));
    expect(parentProblem(tasks, a.id, a.id)).toMatch(/own subtask/);
    expect(parentProblem(tasks, a.id, b.id)).toMatch(/circle/);
    const moved = setTaskParent(tasks, a.id, b.id, { now: NOW });
    expect(moved.error).toMatch(/circle/);
    expect(moved.tasks).toBe(tasks);
  });

  it("keeps a connector link suggested and never downgrades a confirmed one", () => {
    const a = base("A");
    const b = base("B");
    const suggested = setTaskParent([a, b], b.id, a.id, {
      suggested: true,
      now: NOW,
    });
    expect(suggested.tasks[1].parent).toEqual({ id: a.id, suggested: true });
    const confirmed = setTaskParent([a, b], b.id, a.id, { now: NOW }).tasks;
    const again = setTaskParent(confirmed, b.id, a.id, {
      suggested: true,
      now: NOW,
    });
    expect(again.tasks[1].parent?.suggested).toBe(false);
    // Confirm-all on a task also confirms its parent link.
    expect(confirmPlacement(suggested.tasks[1]).parent?.suggested).toBe(false);
  });

  it("counts a subtask as placed only through a confirmed parent", () => {
    const parent = base("Taxes", { projectId: "p1" });
    const { tasks, task } = add([parent], parent.id, "Find receipts");
    const loose = { ...task, projectId: null };
    const all = [parent, loose];
    expect(isUnplaced(loose)).toBe(true); // without the list, no inheritance
    expect(isUnplaced(loose, all)).toBe(false);
    const suggested = { ...loose, parent: { id: parent.id, suggested: true } };
    expect(isUnplaced(suggested, [parent, suggested])).toBe(true);
    expect(tasks.length).toBe(2);
  });

  it("finishes a parent with or without its open subtasks", () => {
    const parent = base("Clean garage");
    let { tasks, task: one } = add([parent], parent.id, "Sweep");
    ({ tasks } = add(tasks, one.id, "Find broom"));
    const keep = completeTaskTree(tasks, parent.id, false, NOW);
    expect(keep.find(t => t.id === parent.id)?.state).toBe("done");
    expect(openSubtasks(keep, parent.id).length).toBe(2);
    const all = completeTaskTree(tasks, parent.id, true, NOW);
    expect(openSubtasks(all, parent.id).length).toBe(0);
    expect(all.length).toBe(tasks.length);
  });

  it("gives a repeating parent's next occurrence fresh subtasks and carries open ones", () => {
    const parent = base("Weekly reset", {
      schedule: {
        ...emptyTaskSchedule(),
        date: "2026-10-21",
        repeatAnchorDate: "2026-10-20",
        repeatOccurrenceDate: "2026-10-20",
        repeat: {
          freq: "weekly",
          interval: 1,
          weekdays: [],
          monthDay: null,
          nthWeekday: null,
          until: null,
          count: null,
        },
      },
    } as Partial<Task>);
    let { tasks, task: laundry } = add([parent], parent.id, "Laundry");
    laundry = {
      ...laundry,
      state: "done",
      completedAt: `${NOW}T12:00:00`,
      deadline: "2026-10-22",
      schedule: {
        ...laundry.schedule,
        date: NOW,
        time: "10:00",
        repeat: { ...emptyRepeat("weekly"), weekdays: [2] },
        repeatAnchorDate: NOW,
        repeatOccurrenceDate: NOW,
        repeatTime: "10:00",
      },
    };
    tasks = tasks.map(task => (task.id === laundry.id ? laundry : task));
    let { tasks: t2, task: bins } = add(tasks, parent.id, "Bins out");
    tasks = t2; // laundry is already done; bins remain open
    const after = completeTaskTree(tasks, parent.id, false, NOW);
    const next = after.find(
      t =>
        t.id !== parent.id && t.title === "Weekly reset" && t.state !== "done"
    )!;
    expect(next).toBeTruthy();
    const kids = childrenOf(after, next.id);
    expect(kids.map(k => k.title).sort()).toEqual(["Bins out", "Laundry"]);
    const freshLaundry = kids.find(k => k.title === "Laundry")!;
    expect(freshLaundry.id).not.toBe(laundry.id);
    expect(freshLaundry.state).not.toBe("done");
    expect(freshLaundry.startDate).toBe(next.startDate);
    expect(freshLaundry.deadline).toBe("2026-10-29");
    expect(freshLaundry.schedule).toMatchObject({
      date: "2026-10-27",
      time: "10:00",
      repeatAnchorDate: NOW,
      repeatOccurrenceDate: "2026-10-27",
      repeatTime: "10:00",
    });
    // The open subtask moved across rather than being copied.
    expect(kids.find(k => k.title === "Bins out")!.id).toBe(bins.id);
    // The finished laundry stays in history under the finished occurrence.
    expect(after.find(t => t.id === laundry.id)?.state).toBe("done");
  });

  it("moves subtasks up a level when their parent is removed", () => {
    const top = base("Top");
    let { tasks, task: mid } = add([top], top.id, "Mid");
    let leaf: Task;
    ({ tasks, task: leaf } = add(tasks, mid.id, "Leaf"));
    const without = releaseSubtasks(
      tasks.filter(t => t.id !== mid.id),
      mid,
      { now: NOW }
    );
    expect(without.find(t => t.id === leaf.id)?.parent?.id).toBe(top.id);
    const noTop = releaseSubtasks(
      without.filter(t => t.id !== top.id),
      top,
      { now: NOW }
    );
    expect(noTop.find(t => t.id === leaf.id)?.parent).toBeUndefined();
  });

  it("removes only the selected task, promotes its children, and clears prerequisite links", () => {
    const top = base("Top");
    let { tasks, task: middle } = add([top], top.id, "Middle");
    let leaf: Task;
    ({ tasks, task: leaf } = add(tasks, middle.id, "Leaf"));
    const dependent = base("Dependent", { dependencies: [middle.id] });
    const stamp = "2026-10-20T12:00:00+10:30";

    const removed = removeTaskAndReleaseChildren(
      [...tasks, dependent],
      middle.id,
      stamp
    );

    expect(removed.removed?.id).toBe(middle.id);
    expect(removed.tasks.some(task => task.id === middle.id)).toBe(false);
    expect(removed.tasks.find(task => task.id === leaf.id)?.parent?.id).toBe(
      top.id
    );
    expect(
      removed.tasks.find(task => task.id === dependent.id)?.dependencies
    ).toEqual([]);
    expect(
      removed.tasks
        .find(task => task.id === dependent.id)
        ?.history.at(-1)?.text
    ).toContain("prerequisite link cleared");
  });

  it("nests rows under parents, names parents of loose subtasks, and collapses", () => {
    const a = base("A");
    let { tasks, task: b } = add([a], a.id, "B");
    ({ tasks } = add(tasks, b.id, "C"));
    const rows = nestRows(tasks, tasks, new Set());
    expect(rows.map(r => [r.task.title, r.depth])).toEqual([
      ["A", 0],
      ["B", 1],
      ["C", 2],
    ]);
    const filtered = nestRows(
      tasks.filter(t => t.title !== "A"),
      tasks,
      new Set()
    );
    expect(filtered[0].parentTitle).toBe("A");
    const collapsed = nestRows(tasks, tasks, new Set([a.id]));
    expect(collapsed.map(r => r.task.title)).toEqual(["A"]);
  });

  it("survives a damaged loop without hanging", () => {
    const a = { ...base("A"), parent: { id: "b", suggested: false } };
    const b = { ...base("B"), id: "b", parent: { id: a.id, suggested: false } };
    expect(descendantsOf([a, b], a.id).length).toBe(1);
    expect(nestRows([a, b], [a, b], new Set()).length).toBe(2);
  });

  it("recommends the subtask, not a parent that still has open subtasks", () => {
    const parent = base("Plan trip");
    const { tasks } = add([parent], parent.id, "Book flights");
    const ids = attention(tasks, { now: NOW }).items.map(i => i.task.id);
    expect(ids).not.toContain(parent.id);
  });

  it("saves and loads subtask links; old records stay unchanged", () => {
    const parent = base("P");
    const { tasks } = add([parent], parent.id, "S");
    const workspace = validateWorkspace(
      JSON.parse(JSON.stringify(sampleWorkspace(tasks)))
    );
    expect(workspace.tasks[1].parent).toEqual({
      id: parent.id,
      suggested: false,
    });
    expect("parent" in workspace.tasks[0]).toBe(false);
    const bad = sampleWorkspace(tasks) as unknown as {
      tasks: Record<string, unknown>[];
    };
    bad.tasks[1].parent = { id: parent.id, suggested: false, extra: 1 };
    expect(() => validateWorkspace(JSON.parse(JSON.stringify(bad)))).toThrow();
  });
});

function sampleWorkspace(tasks: Task[]) {
  return { version: 1, tasks, focus: null };
}
