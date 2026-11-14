import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Workspace } from "../../domain/types";
import { addAsset, addPlan, addReading, newAsset } from "../../domain/assets";
import { adelaideClock, addDaysToDate } from "./assetsTestClock";
import AssetsView from "./AssetsView";
import UpkeepDueList from "./UpkeepDueList";
import UpkeepLogPrompt from "./UpkeepLogPrompt";
import { linkUpkeepTask, upkeepForTask } from "../../domain/assets";
import { createTask } from "../../domain/engine";

const AT = "2026-11-14T09:00:00+10:30";

function workspace(): Workspace {
  const today = adelaideClock();
  let w: Workspace = {
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
  w = addAsset(w, newAsset("car", "Freelander 2", "vehicle", AT, { condition: "good" }));
  w = addReading(w, "car", { id: "r", date: today, value: 61240, createdAt: AT });
  w = addPlan(w, "car", {
    id: "p",
    name: "Major service",
    everyMonths: 12,
    everyMeter: null,
    startDate: addDaysToDate(today, -360),
    startReading: null,
    listTemplateId: null,
    taskId: null,
    createdAt: AT,
    updatedAt: AT,
  });
  w = addAsset(w, newAsset("shack", "Kingston shack", "place", AT));
  w = addAsset(w, newAsset("hw", "Hot water system", "appliance", AT, { placeId: "shack" }));
  return w;
}

const noop = () => {};

describe("Assets & Upkeep page", () => {
  const html = renderToStaticMarkup(
    <AssetsView workspace={workspace()} readOnly={false} onMutate={() => true} onCreateTask={noop} onOpenTask={noop} onOpenList={noop} onOpenObligations={noop} />
  );

  it("groups by type with singular counts and at most two grey chips", () => {
    expect(html).toContain("Vehicle (1)");
    expect(html).toContain("Place (1)");
    expect(html).toContain("Appliance (1)");
    expect(html).not.toMatch(/1 assets|Vhicle/);
    expect(html).toContain(">Good<");
    expect(html).toContain(">service due<");
    expect(html).toContain("at Kingston shack");
    expect(html).toContain("Holds 1");
  });

  it("shows no forms, Read aloud or Delete until asked", () => {
    expect(html).not.toContain("<input");
    expect(html).not.toMatch(/Read aloud|Delete/);
    expect(html).toContain("+ Asset");
  });

  it("Upkeep due rows offer Create task and Log it done", () => {
    const rows = renderToStaticMarkup(
      <UpkeepDueList workspace={workspace()} today={adelaideClock()} readOnly={false} onCreateTask={noop} onOpenTask={noop} onAct={noop} />
    );
    expect(rows).toContain("Freelander 2 · Major service");
    expect(rows).toContain("Create task");
    expect(rows).toContain("Log it done");
  });

  it("ticking a task made from Upkeep due asks to log it, with today's date and the latest reading", () => {
    const task = { ...createTask({ title: "Freelander 2: Major service" }), id: "task-svc" };
    const w = linkUpkeepTask({ ...workspace(), tasks: [task] }, "car", "service", "p", "task-svc", AT);
    expect(upkeepForTask(w, "task-svc")?.what).toBe("Major service");
    expect(upkeepForTask(w, "task-other")).toBeNull();
    const html = renderToStaticMarkup(<UpkeepLogPrompt workspace={w} taskId="task-svc" today={adelaideClock()} onMutate={() => true} onClose={noop} />);
    expect(html).toContain("Log the service now?");
    expect(html).toContain(`value="${adelaideClock()}"`);
    expect(html).toContain('value="61240"');
    expect(html).toContain("Yes, log it");
    expect(html).toContain("Not now");
    expect(renderToStaticMarkup(<UpkeepLogPrompt workspace={w} taskId="task-other" today={adelaideClock()} onMutate={() => true} onClose={noop} />)).toBe("");
  });
});
