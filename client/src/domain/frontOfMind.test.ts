import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import { exportBackup, parseBackup, validateWorkspace } from "./transfer";
import {
  addFrontOfMind,
  addImperativeFromItem,
  applyReviewChoices,
  bringBack,
  chipsFor,
  editWording,
  keepItem,
  letGo,
  letGoItems,
  markBecameTask,
  moveIdeasToFrontOfMind,
  openItems,
  saveImperativeDraft,
  suggestLetGo,
  validateFrontOfMind,
} from "./frontOfMind";
import type { Task, Workspace } from "./types";

const AT = "2026-11-14T09:00:00+10:30";
const TODAY = "2026-11-14";

function ws(tasks: Task[] = []): Workspace {
  return {
    version: 2,
    tasks,
    projects: [],
    focus: null,
    intention: null,
    matrixWeights: { "direction-timely": 1, "direction-sustained": 1, "support-timely": 1, "support-sustained": 1 },
    trial: { startedAt: AT, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [],
  };
}
const idea = (id: string, extra: Partial<Task> = {}): Task => ({
  ...createTask({ title: `Idea ${id}`, state: "someday", reviewDate: null }),
  id,
  createdAt: "2026-11-12T10:00:00+10:30",
  ...extra,
});

describe("the move from the Ideas shelf (the live shape: 2 on the shelf, 2 let go)", () => {
  const before = ws([
    idea("a", { history: [{ at: "2026-11-12T10:00:00+10:30", text: "Claude: Added to the Ideas shelf." }, { at: "2026-11-12T11:00:00+10:30", text: "Idea kept." }], droppedAt: "2026-11-13T09:00:00+10:30" }),
    idea("b", { history: [{ at: "2026-11-12T10:00:00+10:30", text: "Idea kept." }, { at: "2026-11-12T12:00:00+10:30", text: "Idea let go (archived, recoverable)." }], droppedAt: "2026-11-12T12:00:00+10:30" }),
    idea("c", { history: [] }),
    idea("d", { title: "Weekend trailer hire for builders", history: [{ at: AT, text: "Autosaved captured task details." }] }),
    // Not ideas: a review drop and an ordinary task stay tasks.
    idea("e", { history: [{ at: AT, text: "Dropped to Someday in the Weekly Reality Review (kept, not deleted)." }] }),
    { ...createTask({ title: "Ordinary task" }), id: "f" },
  ]);
  const after = validateWorkspace(before);

  it("moves 4 ideas: 2 into Front of Mind, 2 under Let go; others stay tasks", () => {
    expect(after.tasks.map(t => t.id).sort()).toEqual(["e", "f"]);
    expect(openItems(after).map(i => i.id).sort()).toEqual(["c", "d"]);
    expect(letGoItems(after).map(i => i.id).sort()).toEqual(["a", "b"]);
  });

  it("keeps wording, date added and history, and who added it", () => {
    const d = after.frontOfMind!.items.find(i => i.id === "d")!;
    expect(d.text).toBe("Weekend trailer hire for builders");
    expect(d.createdAt).toBe("2026-11-12T10:00:00+10:30");
    expect(d.history.map(h => h.text)).toEqual(["Autosaved captured task details.", "Moved from the Ideas shelf to Front of Mind."]);
    const a = after.frontOfMind!.items.find(i => i.id === "a")!;
    expect(a).toMatchObject({ addedBy: "claude", claudeLabel: false, lookedAt: "2026-11-12T11:00:00+10:30", letGoAt: "2026-11-13T09:00:00+10:30" });
  });

  it("happens once: later someday tasks stay tasks, and it round-trips", () => {
    const later = validateWorkspace({ ...after, tasks: [...after.tasks, idea("g")] });
    expect(later.tasks.map(t => t.id)).toContain("g");
    expect(parseBackup(exportBackup(after))).toEqual(after);
  });

  it("leaves an idea that something else points at as a task", () => {
    const pointed = { ...ws([idea("x"), { ...createTask({ title: "Sub" }), id: "y", parent: { id: "x", suggested: false } }]) };
    expect(moveIdeasToFrontOfMind(pointed).tasks.map(t => t.id)).toEqual(["x", "y"]);
  });

  it("does nothing for a workspace with no someday tasks", () => {
    const plain = ws([{ ...createTask({ title: "Ordinary" }), id: "f" }]);
    expect(validateWorkspace(plain).frontOfMind).toBeUndefined();
  });
});

describe("owner actions and Claude's limits", () => {
  const base = addFrontOfMind(ws(), "i1", "Toronto one day", AT);
  const claude = addFrontOfMind(base, "i2", "Paul Weller UK tour", AT, { by: "claude" });

  it("Claude's items are labelled until Keep; Keep marks looked at", () => {
    expect(chipsFor(claude.frontOfMind!.items[1], TODAY).map(c => c.text)).toEqual(["added by Claude"]);
    expect(openItems(claude)[0].id).toBe("i2");
    const kept = keepItem(claude, "i2", "2026-11-15T09:00:00+10:30");
    expect(kept.frontOfMind!.items[1]).toMatchObject({ claudeLabel: false, lookedAt: "2026-11-15T09:00:00+10:30" });
  });

  it("wording changes keep the earlier wording", () => {
    const edited = editWording(base, "i1", "Toronto and Montreal", AT, "claude");
    expect(edited.frontOfMind!.items[0].history.at(-1)).toMatchObject({ by: "claude", was: "Toronto one day" });
  });

  it("a Let go suggestion is dashed and changes nothing until the owner acts", () => {
    const s = suggestLetGo(base, "i1", "Trip cancelled", AT);
    expect(chipsFor(s.frontOfMind!.items[0], TODAY)).toEqual([{ text: "suggested: Let go", dashed: true }]);
    expect(s.frontOfMind!.items[0].letGoAt).toBeNull();
    const gone = letGo(s, "i1", AT);
    expect(openItems(gone)).toEqual([]);
    expect(openItems(bringBack(gone, "i1", AT)).map(i => i.id)).toEqual(["i1"]);
  });

  it("quiet after 30 days; at most two chips", () => {
    const old = addFrontOfMind(ws(), "o", "Buy land", "2026-09-01T09:00:00+10:30", { by: "claude" });
    const s = suggestLetGo(old, "o", "x", AT);
    expect(chipsFor(s.frontOfMind!.items[0], TODAY).map(c => c.text)).toEqual(["added by Claude", "suggested: Let go"]);
    expect(chipsFor(old.frontOfMind!.items[0], "2026-10-01").map(c => c.text)).toEqual(["added by Claude"]);
    expect(chipsFor(old.frontOfMind!.items[0], "2026-10-02").map(c => c.text)).toEqual(["added by Claude", "quiet 31d"]);
  });

  it("Promote is a draft only; Imperatives change only on Add as Imperative", () => {
    const drafted = saveImperativeDraft(base, "i1", "Visit Toronto", "", AT);
    expect(drafted.imperatives).toEqual([]);
    const added = addImperativeFromItem(drafted, "i1", "imp-1", TODAY, AT);
    expect(added.imperatives.map(i => [i.id, i.title, i.status])).toEqual([["imp-1", "Visit Toronto", "active"]]);
    expect(openItems(added)).toEqual([]);
    expect(added.frontOfMind!.items[0].became).toMatchObject({ kind: "imperative", id: "imp-1" });
  });

  it("Make it a task: the item leaves the list only once the task exists", () => {
    expect(markBecameTask(base, "i1", "t-missing", AT)).toBe(base);
    const withTask = { ...base, tasks: [{ ...createTask({ title: "Toronto one day" }), id: "t1" }] };
    const done = markBecameTask(withTask, "i1", "t1", AT);
    expect(openItems(done)).toEqual([]);
    expect(done.frontOfMind!.items[0].history.at(-1)!.text).toBe("Became a task.");
  });

  it("review choices apply together on save", () => {
    const two = addFrontOfMind(base, "i3", "AI workshop", AT);
    const next = applyReviewChoices(two, { i1: "letgo", i3: "promote" }, AT);
    expect(letGoItems(next).map(i => i.id)).toEqual(["i1"]);
    expect(next.frontOfMind!.items.find(i => i.id === "i3")!.imperativeDraft?.title).toBe("AI workshop");
  });

  it("validation is strict", () => {
    expect(validateFrontOfMind(claude.frontOfMind)).toEqual(claude.frontOfMind);
    expect(() => validateFrontOfMind({ items: [{ ...claude.frontOfMind!.items[0], extra: 1 }] })).toThrow(/unknown/);
  });
});
