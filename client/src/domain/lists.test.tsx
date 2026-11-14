import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import { exportBackup, parseBackup, validateWorkspace } from "./transfer";
import type { Workspace } from "./types";
import {
  addExtra,
  addItem,
  addLink,
  addMissingToTemplate,
  addSection,
  addTemplate,
  attachedWithoutRun,
  editItem,
  finishedRuns,
  finishRun,
  missingCandidates,
  newRun,
  openRun,
  parentProgress,
  removeItem,
  resetRun,
  runProgress,
  runRows,
  sectionsToSplit,
  startRun,
  tickItem,
} from "./lists";
import ListProgressMark from "../components/steadier/ListProgressMark";

const AT = "2026-11-14T09:00:00+10:30";
const LATER = "2026-11-14T10:00:00+10:30";
const NEXT_WEEK = "2026-11-21T09:00:00+10:30";

function base(): Workspace {
  return {
    version: 2,
    tasks: [],
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

/** "Leaving the shack": three items, two in an Inside section. */
function shack(): Workspace {
  let w = addTemplate(base(), "list-shack", "Leaving the shack", AT, "read-do");
  w = addSection(w, "list-shack", "sec-inside", "Inside", AT);
  w = addItem(w, "list-shack", "item-gas", "Gas – off", "sec-inside", AT);
  w = addItem(w, "list-shack", "item-windows", "Windows – latched", "sec-inside", AT);
  w = addItem(w, "list-shack", "item-water", "Water – off", null, AT);
  return w;
}

describe("Lists: template and runs", () => {
  it("never ticks the template; a run has its own ticks and date", () => {
    let w = startRun(shack(), "run-1", "list-shack", AT);
    w = tickItem(w, "run-1", "item-gas", true, LATER);
    expect(runProgress(w, openRun(w, "list-shack")!)).toEqual({ done: 1, total: 3 });
    expect(openRun(w, "list-shack")!.date).toBe("2026-11-14");
    expect(JSON.stringify(w.lists!.templates)).not.toMatch(/tick/i);
    // Only one run in progress per list.
    expect(startRun(w, "run-2", "list-shack", AT)).toBe(w);
  });

  it("Reset unticks the same run; New run keeps the old one in history with its date", () => {
    let w = startRun(shack(), "run-1", "list-shack", AT);
    w = tickItem(w, "run-1", "item-gas", true, LATER);
    const reset = resetRun(w, "run-1", LATER);
    expect(openRun(reset, "list-shack")!.id).toBe("run-1");
    expect(runProgress(reset, openRun(reset, "list-shack")!).done).toBe(0);

    const next = newRun(w, "list-shack", "run-2", NEXT_WEEK);
    expect(openRun(next, "list-shack")!.id).toBe("run-2");
    const history = finishedRuns(next, "list-shack");
    expect(history.map(r => r.date)).toEqual(["2026-11-14"]);
    expect(history[0].snapshot!.find(s => s.id === "item-gas")!.ticked).toBe(true);
  });

  it("template edits flow into the open run without losing ticks already made", () => {
    let w = startRun(shack(), "run-1", "list-shack", AT);
    w = tickItem(w, "run-1", "item-gas", true, LATER);
    w = editItem(w, "list-shack", "item-gas", { text: "Gas – off at the bottle" }, LATER);
    w = addItem(w, "list-shack", "item-bins", "Bins – out", null, LATER);
    const rows = runRows(w, openRun(w, "list-shack")!);
    expect(rows.find(r => r.id === "item-gas")).toMatchObject({ text: "Gas – off at the bottle", ticked: true });
    expect(rows.some(r => r.id === "item-bins" && !r.ticked)).toBe(true);
    // Removing an item drops its tick too.
    w = removeItem(w, "list-shack", "item-gas", LATER);
    expect(openRun(w, "list-shack")!.ticks).toEqual({});
  });

  it("a finished run keeps what it looked like even when the template changes later", () => {
    let w = startRun(shack(), "run-1", "list-shack", AT);
    w = tickItem(w, "run-1", "item-water", true, LATER);
    w = finishRun(w, "run-1", LATER);
    w = editItem(w, "list-shack", "item-water", { text: "Water – off at the meter" }, NEXT_WEEK);
    const run = finishedRuns(w, "list-shack")[0];
    expect(runRows(w, run).find(r => r.id === "item-water")).toMatchObject({ text: "Water – off", ticked: true });
    expect(run.finishedAt).toBe(LATER);
  });

  it("Anything missing? offers this run's one-off items and adds them to the template in one tap", () => {
    let w = startRun(shack(), "run-1", "list-shack", AT);
    w = addExtra(w, "run-1", "extra-esky", "Esky – ice in", AT);
    w = finishRun(w, "run-1", LATER);
    const run = finishedRuns(w, "list-shack")[0];
    expect(missingCandidates(w, run)).toEqual(["Esky – ice in"]);
    w = addMissingToTemplate(w, "list-shack", "item-esky", "Esky – ice in", LATER);
    expect(w.lists!.templates[0].items.at(-1)!.text).toBe("Esky – ice in");
    expect(missingCandidates(w, run)).toEqual([]);
    // Already there: no duplicate.
    expect(addMissingToTemplate(w, "list-shack", "item-esky-2", "esky – ice in", LATER)).toBe(w);
  });

  it("suggested items are dashed: not counted and can't be ticked until confirmed", () => {
    let w = startRun(shack(), "run-1", "list-shack", AT);
    w = addExtra(w, "run-1", "extra-claude", "Torch – charged", AT, true);
    expect(runProgress(w, openRun(w, "list-shack")!).total).toBe(3);
    expect(tickItem(w, "run-1", "extra-claude", true, LATER)).toBe(w);
  });

  it("flags a section over 9 items, without blocking more", () => {
    let w = addTemplate(base(), "list-big", "Big", AT);
    for (let i = 0; i < 11; i += 1) w = addItem(w, "list-big", `item-${i}`, `Thing ${i} – done`, null, AT);
    expect(w.lists!.templates[0].items).toHaveLength(11);
    expect(sectionsToSplit(w.lists!.templates[0])).toEqual([{ sectionId: null, count: 11 }]);
  });
});

describe("Lists: attached to a task", () => {
  function withTask(): Workspace {
    const task = { ...createTask({ title: "Drive to Kingston" }, "2026-11-14"), id: "task-drive" };
    let w = { ...shack(), tasks: [task] };
    w = addLink(w, "link-1", "list-shack", { kind: "task", id: "task-drive" }, "attached", AT);
    return w;
  }

  it("offers a run when there isn't one for the task, and shows progress on the card", () => {
    let w = withTask();
    expect(attachedWithoutRun(w, "task", "task-drive").map(t => t.title)).toEqual(["Leaving the shack"]);
    w = startRun(w, "run-1", "list-shack", AT, { kind: "task", id: "task-drive" });
    w = tickItem(w, "run-1", "item-gas", true, LATER);
    expect(attachedWithoutRun(w, "task", "task-drive")).toEqual([]);
    expect(parentProgress(w, "task", "task-drive")!.label).toBe("Leaving the shack 1/3");
  });

  it("is a chip when the card has room, and a line inside the card when it already has two chips", () => {
    let w = withTask();
    w = startRun(w, "run-1", "list-shack", AT, { kind: "task", id: "task-drive" });
    const roomy = renderToStaticMarkup(<ListProgressMark workspace={w} id="task-drive" chipCount={1} />);
    expect(roomy).toContain('class="tp-chip"');
    expect(roomy).toContain("Leaving the shack 0/3");
    const full = renderToStaticMarkup(<ListProgressMark workspace={w} id="task-drive" chipCount={2} />);
    expect(full).not.toContain("tp-chip");
    expect(full).toContain("Leaving the shack · 0 of 3 ticked");
  });

  it("drops links to a task that no longer exists when loading", () => {
    const w = { ...withTask(), tasks: [] };
    expect(validateWorkspace(JSON.parse(JSON.stringify(w))).lists!.links).toEqual([]);
  });
});

describe("Lists: saving and older saves", () => {
  it("round-trips through backups and rejects unknown fields", () => {
    let w = startRun(shack(), "run-1", "list-shack", AT);
    w = tickItem(w, "run-1", "item-gas", true, LATER);
    const restored = parseBackup(exportBackup(w));
    expect(restored.lists).toEqual(w.lists);
    const broken = JSON.parse(JSON.stringify(w));
    broken.lists.templates[0].items[0].checked = true;
    expect(() => validateWorkspace(broken)).toThrow(/unknown or missing fields/);
  });

  it("turns Shopping Lists into templates, and ticks into a run in progress, losing nothing", () => {
    const old = {
      ...base(),
      shoppingLists: [
        {
          id: "shopping-list-1",
          title: "Groceries",
          items: [
            { id: "shopping-item-1", text: "Milk", checked: true, createdAt: AT, updatedAt: LATER },
            { id: "shopping-item-2", text: "Bread", checked: false, createdAt: AT, updatedAt: AT },
          ],
          createdAt: AT,
          updatedAt: LATER,
        },
      ],
    };
    const w = validateWorkspace(JSON.parse(JSON.stringify(old)));
    expect((w as unknown as Record<string, unknown>).shoppingLists).toBeUndefined();
    expect(w.lists!.templates[0]).toMatchObject({ id: "shopping-list-1", title: "Groceries", kind: "do-confirm" });
    expect(w.lists!.templates[0].items.map(i => i.text)).toEqual(["Milk", "Bread"]);
    const run = openRun(w, "shopping-list-1")!;
    expect(Object.keys(run.ticks)).toEqual(["shopping-item-1"]);
    expect(runProgress(w, run)).toEqual({ done: 1, total: 2 });
    // Converting again gives the same result (stable ids, no "today").
    expect(validateWorkspace(JSON.parse(JSON.stringify(old)))).toEqual(w);
  });
});
