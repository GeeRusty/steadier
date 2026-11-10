import { describe, expect, it, vi } from "vitest";
import { createTask } from "./engine";
import { installCaptureDraftFlush, upsertCapturedTask } from "./capture";
import { DEFAULT_PLANNING, type TaskSchedule } from "./time";
import { parseQuickAdd, scheduleFromQuickParse } from "./quickParse";
import { validateWorkspace } from "./transfer";
import type { Task, Workspace } from "./types";

const STAMP = "2026-11-02T08:00:00+10:30";

function validationWorkspace(task: Task): Workspace {
  return {
    version: 2,
    tasks: [task],
    projects: [],
    focus: null,
    intention: null,
    matrixWeights: {
      "direction-timely": 1,
      "direction-sustained": 1,
      "support-timely": 1,
      "support-sustained": 1,
    },
    trial: { startedAt: STAMP, lastExportAt: null, lastReviewAt: null },
    planning: { ...DEFAULT_PLANNING },
    imperatives: [],
    reviews: [],
    goals: [],
    obligations: [],
  };
}

describe("captured task autosave", () => {
  it("keeps one task when a title draft is saved and then updated", () => {
    const initial = createTask(
      { id: "capture-test-1", title: "Call Sam" },
      "2026-10-27"
    );
    const inserted = upsertCapturedTask([], initial);
    const updated = upsertCapturedTask(inserted, {
      ...initial,
      title: "Call Sam tomorrow",
      updatedAt: "2026-10-28T08:00:00+10:30",
      createdAt: "2026-10-28T08:00:00+10:30",
      history: [{ at: "2026-10-28T08:00:00+10:30", text: "Draft edit" }],
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      id: initial.id,
      title: "Call Sam tomorrow",
      createdAt: initial.createdAt,
      history: initial.history,
    });
  });

  it("leaves an identical autosaved draft untouched", () => {
    const task = createTask({ id: "capture-test-2", title: "Pay the bill" });
    const tasks = [task];

    expect(upsertCapturedTask(tasks, task)).toBe(tasks);
  });

  it("omits an absent flexible window so a typed draft passes workspace validation", () => {
    const parsed = parseQuickAdd("Prepare the shed", "2026-11-02", 540);
    const schedule = scheduleFromQuickParse(parsed);
    const task = createTask(
      { id: "capture-fixed-window-shape", title: parsed.title, schedule },
      STAMP
    );
    const malformedSchedule = {
      ...schedule,
      flexibleWindow: undefined,
    } as TaskSchedule;

    expect(Object.hasOwn(schedule, "flexibleWindow")).toBe(false);
    expect(() => validateWorkspace(validationWorkspace(task))).not.toThrow();
    expect(() =>
      validateWorkspace(
        validationWorkspace({ ...task, schedule: malformedSchedule })
      )
    ).toThrow(/flexible window must be an object/);
  });

  it("keeps a real flexible window valid in a captured task schedule", () => {
    const parsed = parseQuickAdd(
      "Repair the fence this weekend",
      "2026-11-02",
      540
    );
    const schedule = scheduleFromQuickParse(parsed);
    const task = createTask(
      { id: "capture-flexible-window-shape", title: parsed.title, schedule },
      STAMP
    );

    expect(schedule.flexibleWindow).toBeDefined();
    expect(() => validateWorkspace(validationWorkspace(task))).not.toThrow();
  });

  it("flushes a pending draft when the WebView is hidden or page is leaving", () => {
    const documentTarget = Object.assign(new EventTarget(), {
      visibilityState: "visible" as DocumentVisibilityState,
    });
    const windowTarget = new EventTarget();
    const flush = vi.fn();
    const cleanup = installCaptureDraftFlush(
      documentTarget,
      windowTarget,
      flush
    );

    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(flush).not.toHaveBeenCalled();

    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(flush).toHaveBeenCalledTimes(1);

    windowTarget.dispatchEvent(new Event("pagehide"));
    expect(flush).toHaveBeenCalledTimes(2);

    cleanup();
    windowTarget.dispatchEvent(new Event("pagehide"));
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
