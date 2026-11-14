import { describe, expect, it } from "vitest";
import { emptyProjectCompass, emptyTaskCompass } from "./compass";
import { createTask } from "./engine";
import {
  addAsset,
  addLogEntry,
  addPlan,
  addReading,
  addRevisit,
  addMonthsTo,
  costsByYear,
  costsCsv,
  assetsForConnector,
  dueChip,
  linkUpkeepTask,
  newAsset,
  planStatus,
  pruneAssetLinks,
  recordRevisit,
  removeAsset,
  setAssetStatus,
  upkeepDraftTitle,
  upkeepDue,
  validateAssets,
} from "./assets";
import { parseQuickAdd } from "./quickParse";
import { exportBackup, parseBackup, validateWorkspace } from "./transfer";
import { emptyProjectSchedule, emptyTaskSchedule } from "./time";
import type { AssetLogEntry, AssetServicePlan, Project, Workspace } from "./types";

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

const TODAY = "2026-11-14";

function plan(patch: Partial<AssetServicePlan> = {}): AssetServicePlan {
  return {
    id: "plan-major",
    name: "Major service",
    everyMonths: 12,
    everyMeter: 15000,
    startDate: "2025-11-20",
    startReading: 48900,
    listTemplateId: null,
    taskId: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...patch,
  };
}

function entry(patch: Partial<AssetLogEntry> = {}): AssetLogEntry {
  return {
    id: "log-1",
    kind: "note",
    date: "2026-10-02",
    reading: null,
    cost: null,
    by: "",
    notes: "",
    conditionAfter: null,
    planId: null,
    taskId: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...patch,
  };
}

function car(w = workspace()): Workspace {
  let next = addAsset(w, newAsset("asset-car", "Freelander 2", "vehicle", STAMP));
  next = addReading(next, "asset-car", { id: "r1", date: "2026-11-10", value: 61240, createdAt: STAMP });
  return addPlan(next, "asset-car", plan());
}

describe("Freelander 2 migration (the stored record, exact shape)", () => {
  const stored = {
    id: "asset-932be1a6-6c38-4da1-bad1-98efeffb40ba",
    name: "Freelander 2",
    status: "active",
    category: "Vhicle",
    wearLogs: [],
    condition: "good",
    createdAt: "2026-10-31T09:54:44+10:30",
    projectId: "project-home",
    updatedAt: "2026-10-31T09:54:44+10:30",
  };

  it("becomes a Vehicle with condition, project, status and dates kept", () => {
    const [a] = validateAssets([stored]);
    expect(a).toMatchObject({
      id: stored.id,
      name: "Freelander 2",
      type: "vehicle",
      condition: "good",
      status: "active",
      projectId: "project-home",
      meter: "km",
      logs: [],
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    });
  });

  it("loads through a full workspace and saves in the new shape only", () => {
    const loaded = validateWorkspace({ ...workspace(), assets: [stored] });
    expect(loaded.assets?.[0].type).toBe("vehicle");
    expect(loaded.assets?.[0].projectId).toBe("project-home");
    const round = parseBackup(exportBackup(loaded));
    expect(round.assets).toEqual(loaded.assets);
    expect(JSON.stringify(round)).not.toContain("wearLogs");
  });

  it("old wear logs become Note entries; worn → Poor; unknown categories are kept as a note", () => {
    const [a] = validateAssets([
      {
        ...stored,
        category: "Garden things",
        condition: "worn",
        wearLogs: [
          { id: "wear-1", date: "2026-10-30", condition: "unknown", text: "Dusty.", taskId: "task-x", createdAt: STAMP, updatedAt: STAMP },
        ],
      },
    ]);
    expect(a.type).toBe("equipment");
    expect(a.condition).toBe("poor");
    expect(a.logs.find(l => l.id === "wear-1")).toMatchObject({ kind: "note", notes: "Dusty.", conditionAfter: null, taskId: "task-x" });
    expect(a.logs.some(l => l.notes.includes("Garden things"))).toBe(true);
  });
});

describe("service plans: whichever comes first", () => {
  it("is due 14 days before the date, overdue after it", () => {
    const w = car();
    const a = w.assets![0];
    expect(planStatus(a, a.plans[0], "2026-11-14")).toMatchObject({ nextDate: "2026-11-20", nextMeter: 63900, state: "due" });
    expect(planStatus(a, a.plans[0], "2026-11-17").state).toBe("due");
    expect(planStatus(a, a.plans[0], "2026-11-21").state).toBe("overdue");
    expect(planStatus(a, a.plans[0], "2026-11-05").state).toBe("ok");
    const early = addPlan(addAsset(workspace(), newAsset("a2", "Ute", "vehicle", STAMP)), "a2", plan({ startDate: "2026-10-01", startReading: 0 }));
    expect(planStatus(early.assets![0], early.assets![0].plans[0], TODAY).state).toBe("ok");
  });

  it("is due by meter from 500 km before, using only the last reading entered", () => {
    let w = addAsset(workspace(), newAsset("a2", "Ute", "vehicle", STAMP));
    w = addPlan(w, "a2", plan({ everyMonths: null, startDate: null, startReading: 10000 }));
    w = addReading(w, "a2", { id: "r", date: TODAY, value: 24400, createdAt: STAMP });
    expect(planStatus(w.assets![0], w.assets![0].plans[0], TODAY).state).toBe("ok");
    w = addReading(w, "a2", { id: "r2", date: TODAY, value: 24600, createdAt: STAMP });
    expect(planStatus(w.assets![0], w.assets![0].plans[0], TODAY).state).toBe("due");
    w = addReading(w, "a2", { id: "r3", date: TODAY, value: 25001, createdAt: STAMP });
    expect(planStatus(w.assets![0], w.assets![0].plans[0], TODAY).state).toBe("overdue");
  });

  it("logging the service restarts the count and closes the task link", () => {
    let w = car({ ...workspace(), tasks: [task()] });
    w = linkUpkeepTask(w, "asset-car", "service", "plan-major", "task-filter", STAMP);
    expect(w.assets![0].plans[0].taskId).toBe("task-filter");
    w = addLogEntry(w, "asset-car", entry({ id: "svc", kind: "service", date: TODAY, reading: 61300, planId: "plan-major", cost: 118000, conditionAfter: "good" }));
    const s = planStatus(w.assets![0], w.assets![0].plans[0], TODAY);
    expect(s).toMatchObject({ nextDate: "2027-11-14", nextMeter: 76300, state: "ok" });
    expect(w.assets![0].plans[0].taskId).toBeNull();
  });

  it("clamps months to the end of a short month", () => {
    expect(addMonthsTo("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsTo("2025-12-02", 12)).toBe("2026-12-02");
  });
});

describe("Upkeep due", () => {
  it("lists each due service, revisit and stale reading once; silent otherwise", () => {
    let w = car();
    w = addAsset(w, newAsset("place", "Kingston shack", "place", STAMP));
    w = addRevisit(w, "place", { id: "rv", what: "Roof and gutters", by: "2026-11-25", taskId: null, createdAt: STAMP });
    w = addRevisit(w, "place", { id: "rv-later", what: "Septic", by: "2026-12-30", taskId: null, createdAt: STAMP });
    w = addAsset(w, newAsset("gen", "Generator", "equipment", STAMP, { meter: "h", placeId: "place" }));
    w = addReading(w, "gen", { id: "g1", date: "2026-08-01", value: 212, createdAt: STAMP });
    const due = upkeepDue(w, TODAY);
    expect(due.map(d => [d.assetName, d.what])).toEqual([
      ["Freelander 2", "Major service"],
      ["Kingston shack", "Roof and gutters"],
      ["Generator", "Update reading"],
    ]);
    expect(due[0].detail).toBe("by 20 Nov or 63,900 km (now 61,240 km)");
    // A new reading clears "Update reading".
    w = addReading(w, "gen", { id: "g2", date: TODAY, value: 220, createdAt: STAMP });
    expect(upkeepDue(w, TODAY).some(d => d.what === "Update reading")).toBe(false);
    expect(upkeepDue(workspace(), TODAY)).toEqual([]);
  });

  it("asks for a reading after 60 days, not at 60, and not for places or appliances", () => {
    let w = addAsset(workspace(), newAsset("v", "Van", "vehicle", STAMP));
    expect(upkeepDue(w, TODAY).map(d => d.what)).toEqual(["Update reading"]);
    w = addReading(w, "v", { id: "r", date: "2026-09-15", value: 1, createdAt: STAMP });
    expect(upkeepDue(w, TODAY)).toEqual([]);
    w = addAsset(w, newAsset("hw", "Hot water", "appliance", STAMP));
    expect(upkeepDue(w, "2026-11-15").map(d => d.assetName)).toEqual(["Van"]);
    expect(upkeepDue(setAssetStatus(w, "v", "retired", STAMP), "2026-11-15")).toEqual([]);
  });

  it("recording a revisit logs an Inspection with the condition found", () => {
    let w = addAsset(workspace(), newAsset("place", "Shack", "place", STAMP));
    w = addRevisit(w, "place", { id: "rv", what: "Roof", by: "2026-11-30", taskId: null, createdAt: STAMP });
    w = recordRevisit(w, "place", "rv", entry({ id: "insp", date: TODAY, conditionAfter: "fair", notes: "two loose sheets" }));
    const a = w.assets![0];
    expect(a.revisits).toEqual([]);
    expect(a.condition).toBe("fair");
    expect(a.logs[0]).toMatchObject({ kind: "inspection", notes: "Roof: two loose sheets" });
    expect(dueChip(a, TODAY)).toBeNull();
  });

  it("a card shows at most one due chip", () => {
    let w = car();
    w = addRevisit(w, "asset-car", { id: "rv", what: "Brakes", by: "2026-11-01", taskId: null, createdAt: STAMP });
    expect(dueChip(w.assets![0], TODAY)).toBe("service due");
  });
});

describe("Create task draft title", () => {
  it("writes the year so the date can't roll into next year, and gives an overdue item today", () => {
    expect(upkeepDraftTitle("Freelander 2", { what: "Major service", dueDate: "2026-11-25", overdue: false }, TODAY)).toBe("Freelander 2: Major service by 25 Nov 2026");
    expect(upkeepDraftTitle("Freelander 2", { what: "Major service", dueDate: "2026-11-02", overdue: true }, TODAY)).toBe("Freelander 2: Major service by 14 Nov 2026");
    expect(upkeepDraftTitle("Shack", { what: "Roof", dueDate: null, overdue: false }, TODAY)).toBe("Shack: Roof");
  });

  it("the capture reader turns those titles into the right deadline", () => {
    const due = parseQuickAdd("Freelander 2: Major service by 25 Nov 2026", TODAY, 600);
    expect([due.title, due.deadline]).toEqual(["Freelander 2: Major service", "2026-11-25"]);
    const overdue = parseQuickAdd("Freelander 2: Major service by 14 Nov 2026", TODAY, 600);
    expect(overdue.deadline).toBe(TODAY);
    const nextYear = parseQuickAdd("Car: Rego check by 10 Jan 2027", TODAY, 600);
    expect(nextYear.deadline).toBe("2027-01-10");
  });
});

describe("places, links, costs and the connector", () => {
  it("a place holds assets one level deep; deleting it frees them and unlinks obligations", () => {
    let w = addAsset(workspace(), newAsset("place", "Shack", "place", STAMP));
    w = addAsset(w, newAsset("hw", "Hot water", "appliance", STAMP, { placeId: "place" }));
    expect(addAsset(w, newAsset("p2", "Inner", "place", STAMP, { placeId: "place" }))).toBe(w);
    w = { ...w, obligations: [{ assetId: "place" } as never] };
    const removed = removeAsset(w, "place", STAMP);
    expect(removed.assets!.map(a => [a.id, a.placeId])).toEqual([["hw", null]]);
    expect((removed.obligations![0] as { assetId?: string }).assetId).toBeUndefined();
  });

  it("retiring a place can retire what it holds too", () => {
    let w = addAsset(workspace(), newAsset("place", "Shack", "place", STAMP));
    w = addAsset(w, newAsset("hw", "Hot water", "appliance", STAMP, { placeId: "place" }));
    expect(setAssetStatus(w, "place", "retired", STAMP).assets!.map(a => a.status)).toEqual(["retired", "active"]);
    expect(setAssetStatus(w, "place", "retired", STAMP, true).assets!.map(a => a.status)).toEqual(["retired", "retired"]);
  });

  it("prunes links to removed projects, tasks and places", () => {
    let w = car();
    w = { ...w, assets: w.assets!.map(a => ({ ...a, projectId: "gone", placeId: "gone", plans: a.plans.map(p => ({ ...p, taskId: "gone" })) })) };
    const pruned = pruneAssetLinks(w).assets![0];
    expect([pruned.projectId, pruned.placeId, pruned.plans[0].taskId]).toEqual([null, null, null]);
  });

  it("totals cost per asset per year and exports a formula-safe CSV", () => {
    let w = car();
    w = addLogEntry(w, "asset-car", entry({ id: "a", kind: "repair", cost: 4800, date: "2026-10-02" }));
    w = addLogEntry(w, "asset-car", entry({ id: "b", kind: "service", cost: 113200, date: "2026-03-01" }));
    w = addLogEntry(w, "asset-car", entry({ id: "c", kind: "service", cost: 64000, date: "2025-03-01" }));
    w = addAsset(w, newAsset("x", "=HYPERLINK()", "equipment", STAMP));
    w = addLogEntry(w, "x", entry({ id: "d", cost: 100, date: "2026-01-01" }));
    expect(costsByYear(w).map(r => [r.year, r.assetName, r.cents])).toEqual([
      ["2026", "=HYPERLINK()", 100],
      ["2026", "Freelander 2", 118000],
      ["2025", "Freelander 2", 64000],
    ]);
    const csv = costsCsv(w);
    expect(csv).toContain('"2026","Freelander 2","Vehicle","2","1180.00"');
    expect(csv).toContain(`"'=HYPERLINK()"`);
  });

  it("the connector sees names, dates and states, never costs, prices, serials, documents or notes", () => {
    let w = car();
    w = { ...w, assets: w.assets!.map(a => ({ ...a, serial: "SALFA2BB9AH000001", purchasePrice: 3500000, documents: [{ label: "Manual", url: "https://example.com/m" }] })) };
    w = addLogEntry(w, "asset-car", entry({ id: "a", kind: "repair", cost: 4800, notes: "Private note", by: "Joe's Garage" }));
    const view = JSON.stringify(assetsForConnector(w, TODAY));
    expect(view).toContain("Freelander 2");
    expect(view).toContain("2026-11-20");
    expect(view).toContain('"type":"repair"');
    for (const hidden of ["4800", "3500000", "SALFA2BB9AH000001", "example.com", "Private note", "Joe"]) expect(view).not.toContain(hidden);
  });

  it("rejects unknown fields and bad values", () => {
    const good = car().assets!;
    expect(validateAssets(good)).toEqual(good);
    expect(() => validateAssets([{ ...good[0], extra: 1 }])).toThrow(/unknown/);
    expect(() => validateAssets([{ ...good[0], condition: "worn" }])).toThrow(/condition/);
    expect(() => validateAssets([{ ...good[0], plans: [{ ...good[0].plans[0], everyMonths: null, everyMeter: null }] }])).toThrow(/interval/);
  });
});
