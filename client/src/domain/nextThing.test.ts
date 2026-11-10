import { describe, expect, it } from "vitest";
import { clearNextThingForTask } from "./nextThing";
import type { Workspace } from "./types";

const base = {
  version: 2,
  tasks: [],
  projects: [],
  focus: null,
  intention: null,
  nextThing: {
    taskId: "synthetic-task",
    when: "After breakfast",
    date: "2026-11-05",
    updatedAt: "2026-11-05T08:00:00+10:30",
  },
  matrixWeights: { urgentImportant: 1, importantNotUrgent: 1, urgentNotImportant: 1, neither: 1 },
  trial: { startedAt: "2026-11-05T08:00:00+10:30", lastExportAt: null, lastReviewAt: null },
  planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
  imperatives: [],
  reviews: [],
  goals: [],
} as unknown as Workspace;

describe("Next Thing pointer cleanup", () => {
  it("clears only the pointer to a task that was removed or completed", () => {
    expect(clearNextThingForTask(base, "synthetic-task").nextThing).toBeNull();
    expect(clearNextThingForTask(base, "another-task").nextThing).toEqual(
      base.nextThing
    );
  });

  it("preserves a workspace that has no selected Next Thing", () => {
    const workspace = { ...base, nextThing: null };
    expect(clearNextThingForTask(workspace, "synthetic-task")).toBe(workspace);
  });
});
