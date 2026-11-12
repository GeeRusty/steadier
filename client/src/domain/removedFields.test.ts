import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import { exportCSV, importTasks, notesWithArea } from "./transfer";
import { emptyWorkspace, parseStrictV2Workspace } from "../../../server/steadier/validation";

/** A saved workspace from before Area and Important were removed. */
function legacySave(tasks: Record<string, unknown>[]) {
  const w = emptyWorkspace();
  w.trial.startedAt = "2026-10-01T00:00:00.000Z";
  return JSON.parse(JSON.stringify({ ...w, tasks }));
}

function oldTask(title: string, area: string, extra: Record<string, unknown> = {}) {
  const t = createTask({ title, notes: "" });
  return {
    ...JSON.parse(JSON.stringify(t)),
    createdAt: "2026-11-01T02:30:00.000Z",
    updatedAt: "2026-11-01T02:30:00.000Z",
    history: [],
    area,
    important: false,
    ...extra,
  };
}

describe("removed fields: Important and Area", () => {
  it("new tasks have neither field", () => {
    const t = createTask({ title: "Fix gate" });
    expect(t).not.toHaveProperty("area");
    expect(t).not.toHaveProperty("important");
  });

  it("old saves still load: a chosen Area moves into the notes, General is skipped", () => {
    const parsed = parseStrictV2Workspace(
      legacySave([
        oldTask("Cut the grass", "Personal"),
        oldTask("Buy milk", "General"),
        oldTask("Comwireit Cleaning", "Business", { notes: "Keys under the mat", state: "done", completedAt: "2026-11-02T02:30:00.000Z" }),
      ])
    );
    const [grass, milk, clean] = parsed.tasks;
    expect(grass.notes).toBe("Area: Personal");
    expect(grass.history.at(-1)!.text).toBe("Area “Personal” moved into the notes (Area was removed).");
    expect(milk.notes).toBe("");
    expect(milk.history).toHaveLength(0);
    expect(clean.notes).toBe("Keys under the mat\nArea: Business");
    for (const t of parsed.tasks) {
      expect(t).not.toHaveProperty("area");
      expect(t).not.toHaveProperty("important");
    }
  });

  it("never adds the Area line twice", () => {
    expect(notesWithArea("Area: Home", "Home")).toBe("Area: Home");
    const once = parseStrictV2Workspace(legacySave([oldTask("Try tones", "Home", { notes: "Area: Home" })]));
    expect(once.tasks[0].notes).toBe("Area: Home");
    expect(once.tasks[0].history).toHaveLength(0);
  });

  it("an old Important=true value is dropped, not an error", () => {
    const parsed = parseStrictV2Workspace(legacySave([oldTask("Old flagged", "General", { important: true })]));
    expect(parsed.tasks[0]).not.toHaveProperty("important");
  });

  it("CSV: new exports drop both columns; old CSV files still import", () => {
    const csv = exportCSV([createTask({ title: "Fix gate" })]);
    const header = csv.split(/\r?\n/)[0];
    expect(header).not.toContain("area");
    expect(header).not.toContain("important");
    expect(importTasks(csv, "csv", [])).toHaveLength(1);

    const cols = header.split(",");
    const row = csv.split(/\r?\n/)[1].split(",");
    const oldCsv = [[...cols, "area", "important"].join(","), [...row, "Home", "false"].join(",")].join("\n");
    const imported = importTasks(oldCsv, "csv", []);
    expect(imported[0].notes).toContain("Area: Home");
    expect(imported[0]).not.toHaveProperty("area");
  });
});
