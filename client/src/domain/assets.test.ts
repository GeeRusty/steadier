import { describe, expect, it } from "vitest";
import { emptyProjectCompass, emptyTaskCompass } from "./compass";
import { createTask } from "./engine";
import {
  addAssetRecord,
  addAssetWearLog,
  linkAssetWearLogTask,
  pruneAssetLinks,
  removeAssetRecord,
  removeAssetWearLog,
  updateAssetWearLog,
} from "./assets";
import { exportBackup, parseBackup, validateWorkspace } from "./transfer";
import { emptyProjectSchedule, emptyTaskSchedule } from "./time";
import type { Asset, AssetWearLog, Project, Workspace } from "./types";

const STAMP = "2026-10-30T11:00:00+10:30";

function project(): Project {
  return {
    id: "project-home",
    title: "Home care",
    purpose: "Support a calm home.",
    outcome: "Home systems remain reliable.",
    role: "support",
    pattern: "sustained",
    status: "active",
    milestones: [],
    progress: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    schedule: emptyProjectSchedule(),
    compass: emptyProjectCompass(),
  };
}

function task() {
  return {
    ...createTask({ title: "Inspect vacuum filter" }),
    id: "task-filter",
    createdAt: STAMP,
    updatedAt: STAMP,
    completedAt: null,
    history: [{ at: STAMP, text: "Created." }],
    schedule: emptyTaskSchedule(),
    compass: emptyTaskCompass(),
  };
}

function workspace(): Workspace {
  return {
    version: 2,
    tasks: [],
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

function asset(patch: Partial<Asset> = {}): Asset {
  return {
    id: "asset-vacuum",
    name: "Vacuum",
    category: "Appliance",
    condition: "good",
    status: "active",
    projectId: "project-home",
    wearLogs: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    ...patch,
  };
}

function wearLog(patch: Partial<AssetWearLog> = {}): AssetWearLog {
  return {
    id: "wear-filter",
    date: "2026-10-30",
    condition: "fair",
    text: "The filter looks dusty.",
    taskId: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...patch,
  };
}

describe("physical Asset and Wear Log records", () => {
  it("adds and updates dated condition notes without changing task completion", () => {
    const taskRecord = task();
    const initial = { ...workspace(), tasks: [taskRecord] };
    const withAsset = addAssetRecord(initial, asset());
    const withLog = addAssetWearLog(withAsset, "asset-vacuum", wearLog());

    expect(withLog.assets?.[0].condition).toBe("fair");
    expect(withLog.tasks[0]).toEqual(taskRecord);
    expect(withLog.assets?.[0].wearLogs).toHaveLength(1);

    const edited = updateAssetWearLog(
      withLog,
      "asset-vacuum",
      "wear-filter",
      {
        date: "2026-10-31",
        condition: "needs-attention",
        text: "Replace the filter soon.",
      },
      "2026-10-31T10:00:00+10:30"
    );
    expect(edited.assets?.[0].condition).toBe("needs-attention");
    expect(edited.assets?.[0].wearLogs[0].text).toBe(
      "Replace the filter soon."
    );
    expect(edited.tasks[0].state).toBe(taskRecord.state);
  });

  it("stores one explicit task link per wear-log occurrence without closing the source", () => {
    const taskRecord = task();
    const withLog = addAssetWearLog(
      addAssetRecord({ ...workspace(), tasks: [taskRecord] }, asset()),
      "asset-vacuum",
      wearLog()
    );
    const linked = linkAssetWearLogTask(
      withLog,
      "asset-vacuum",
      "wear-filter",
      taskRecord.id,
      STAMP
    );
    const secondTask = { ...taskRecord, id: "task-second" };

    expect(linked.assets?.[0].wearLogs[0].taskId).toBe(taskRecord.id);
    const alreadyLinkedWorkspace = {
      ...linked,
      tasks: [...linked.tasks, secondTask],
    };
    expect(
      linkAssetWearLogTask(
        alreadyLinkedWorkspace,
        "asset-vacuum",
        "wear-filter",
        secondTask.id,
        STAMP
      )
    ).toEqual(alreadyLinkedWorkspace);
    expect(linked.assets?.[0].status).toBe("active");
    expect(linked.assets?.[0].wearLogs).toHaveLength(1);

    const withoutTask = validateWorkspace({ ...linked, tasks: [] });
    expect(withoutTask.assets?.[0].wearLogs[0].taskId).toBeNull();
  });

  it("prunes a missing Project link and keeps explicitly confirmed Tasks when an Asset is removed", () => {
    const taskRecord = task();
    const initial = addAssetRecord(
      { ...workspace(), tasks: [taskRecord] },
      asset()
    );
    const withoutProject = validateWorkspace({ ...initial, projects: [] });
    expect(withoutProject.assets?.[0].projectId).toBeNull();

    const removed = removeAssetRecord(initial, "asset-vacuum");
    expect(removed.assets).toEqual([]);
    expect(removed.tasks).toEqual([taskRecord]);
  });

  it("keeps a linked task when its dated Wear Log is explicitly removed", () => {
    const taskRecord = task();
    const withLog = addAssetWearLog(
      addAssetRecord({ ...workspace(), tasks: [taskRecord] }, asset()),
      "asset-vacuum",
      wearLog({ taskId: taskRecord.id })
    );
    const removed = removeAssetWearLog(
      withLog,
      "asset-vacuum",
      "wear-filter",
      STAMP
    );
    expect(removed.assets?.[0].wearLogs).toEqual([]);
    expect(removed.tasks).toEqual([taskRecord]);
  });

  it("round-trips strict Asset fields through validated workspace backup and restore", () => {
    const source = addAssetWearLog(
      addAssetRecord(workspace(), asset()),
      "asset-vacuum",
      wearLog()
    );
    expect(parseBackup(exportBackup(source))).toEqual(source);
    expect(() =>
      validateWorkspace({
        ...source,
        assets: [asset({ condition: "unsafe" as Asset["condition"] })],
      })
    ).toThrow(/condition/i);
    expect(() =>
      validateWorkspace({
        ...source,
        assets: [asset({ wearLogs: [wearLog({ date: "not-a-date" })] })],
      })
    ).toThrow(/date/i);
  });

  it("clears a stale task link without changing owner-entered log text", () => {
    const source = addAssetWearLog(
      addAssetRecord(workspace(), asset()),
      "asset-vacuum",
      wearLog({ taskId: "task-removed" })
    );
    const pruned = pruneAssetLinks(source);
    expect(pruned.assets?.[0].wearLogs[0].taskId).toBeNull();
    expect(pruned.assets?.[0].wearLogs[0].text).toBe("The filter looks dusty.");
  });
});
