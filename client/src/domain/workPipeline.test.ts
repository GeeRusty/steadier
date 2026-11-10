import { describe, expect, it } from "vitest";
import { emptyProjectCompass, emptyTaskCompass } from "./compass";
import { createTask } from "./engine";
import { kindContext } from "./todayStates";
import { buildWorkPipeline } from "./workPipeline";
import { emptyProjectSchedule, emptyTaskSchedule } from "./time";
import type { Project, Task, Workspace } from "./types";

const STAMP = "2026-10-30T10:00:00+10:30";
function project(): Project {
  return {
    id: "project-a",
    title: "Home improvements",
    purpose: "Make daily life easier.",
    outcome: "A calm, reliable home.",
    role: "support",
    pattern: "sustained",
    status: "active",
    milestones: [{ id: "m1", title: "Choose materials", done: true }],
    progress: [{ at: STAMP, text: "Measured the space." }],
    createdAt: STAMP,
    updatedAt: STAMP,
    schedule: { ...emptyProjectSchedule(), deadline: "2026-11-15" },
    compass: emptyProjectCompass(),
  };
}
function task(
  id: string,
  projectId: string | null,
  projectSuggested = false
): Task {
  const base = createTask({ title: id });
  return {
    ...base,
    id,
    projectId,
    createdAt: STAMP,
    updatedAt: STAMP,
    completedAt: null,
    history: [{ at: STAMP, text: "Created." }],
    schedule: emptyTaskSchedule(),
    compass: { ...emptyTaskCompass(), projectSuggested },
  };
}
function workspace(tasks: Task[]): Workspace {
  return {
    version: 2,
    tasks,
    projects: [project()],
    focus: null,
    intention: null,
    matrixWeights: {
      "direction-timely": 1,
      "direction-sustained": 1,
      "support-timely": 1,
      "support-sustained": 1,
    },
    trial: { startedAt: STAMP, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [],
  };
}

describe("read-only Work Pipeline", () => {
  it("counts only confirmed Project links and separates pending suggested links", () => {
    const scheduled = {
      ...task("Scheduled repair", "project-a"),
      schedule: {
        ...emptyTaskSchedule(),
        date: "2026-10-31",
        time: "10:00",
        fixed: true,
      },
    };
    const held = task("Held repair", "project-a");
    const suggested = task("Suggested repair", "project-a", true);
    const unlinked = task("Unlinked task", null);
    const data = workspace([scheduled, held, suggested, unlinked]);
    const ctx = kindContext(data, null, "2026-10-30");
    const [row] = buildWorkPipeline(data, ctx);

    expect(row.tasks.map(item => item.task.id)).toEqual([
      "Scheduled repair",
      "Held repair",
    ]);
    expect(row.suggestedTasks.map(item => item.id)).toEqual([
      "Suggested repair",
    ]);
    expect(row.counts).toEqual({ active: 1, suggested: 0, held: 1 });
    expect(row.milestoneProgress).toEqual({ done: 1, total: 1 });
    expect(row.latestProgress?.text).toBe("Measured the space.");
  });

  it("does not create or mutate any project or task records", () => {
    const original = workspace([task("Existing", "project-a")]);
    const before = structuredClone(original);
    buildWorkPipeline(original, kindContext(original, null, "2026-10-30"));
    expect(original).toEqual(before);
  });
});
