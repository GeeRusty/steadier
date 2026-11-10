import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newGoal } from "../../domain/goals";
import type { Project, Workspace } from "../../domain/types";
import { PillarStrip } from "./PillarStrip";

const TODAY = "2026-10-26";
const RECENT = "2026-10-25T09:00:00+10:30";

afterEach(() => vi.unstubAllGlobals());

function project(id: string, updatedAt: string): Project {
  return {
    id,
    title: id,
    status: "active",
    compass: { imperativeIds: [] },
    updatedAt,
  } as unknown as Project;
}

function goal(id: string, level: "pillar" | "value-goal" | "outcome", title: string, stamp: string) {
  return { ...newGoal(level, title, stamp), id };
}

function workspaceWithThreeHealthStates(): Workspace {
  const greenPillar = goal("pillar-green", "pillar", "Green Pillar", "2026-10-10T09:00:00+10:30");
  const greenValue = { ...goal("value-green", "value-goal", "Green Value", RECENT), parents: [{ id: greenPillar.id, confirmed: true }] };
  const greenOutcome = { ...goal("outcome-green", "outcome", "Green Outcome", RECENT), parents: [{ id: greenValue.id, confirmed: true }], projects: [{ id: "project-green", confirmed: true }] };

  const amberPillar = goal("pillar-amber", "pillar", "Amber Pillar", TODAY);

  const redPillar = goal("pillar-red", "pillar", "Red Pillar", "2026-09-01T09:00:00+09:30");
  const redValue = { ...goal("value-red", "value-goal", "Red Value", "2026-09-01T09:00:00+09:30"), parents: [{ id: redPillar.id, confirmed: true }] };
  const redOutcome = { ...goal("outcome-red", "outcome", "Red Outcome", "2026-09-01T09:00:00+09:30"), parents: [{ id: redValue.id, confirmed: true }], projects: [{ id: "project-red", confirmed: true }] };

  return {
    version: 2,
    tasks: [],
    projects: [project("project-green", RECENT), project("project-red", "2026-08-01T09:00:00+09:30")],
    goals: [greenPillar, greenValue, greenOutcome, amberPillar, redPillar, redValue, redOutcome],
    imperatives: [],
    reviews: [],
    focus: null,
    intention: null,
    planning: { dayStart: "07:00", dayEnd: "18:00", bufferMinutes: 10 },
    matrixWeights: { "direction-timely": 1, "direction-sustained": 1, "support-timely": 1, "support-sustained": 1 },
    trial: { startedAt: RECENT, lastExportAt: null, lastReviewAt: null },
  } as unknown as Workspace;
}

describe("Today V2 Pillar health indicators", () => {
  it("keeps the green check and exposes distinct green, amber and red cues", () => {
    vi.stubGlobal("React", React);
    const html = renderToStaticMarkup(
      createElement(PillarStrip, {
        workspace: workspaceWithThreeHealthStates(),
        today: TODAY,
        todayV2: true,
        readOnly: false,
        onOpenGoal: () => undefined,
        onAddPillar: () => undefined,
        onOpenMap: () => undefined,
      })
    );

    expect(html).toContain('class="pillar-health-indicator green"');
    expect(html).toContain('class="pillar-health-indicator amber"');
    expect(html).toContain('class="pillar-health-indicator red"');
    expect(html).toContain('aria-label="Green Pillar: set, steady. Open this Pillar."');
    expect(html).toMatch(/aria-label="Amber Pillar: set, needs a look\./);
    expect(html).toMatch(/aria-label="Red Pillar: set, gone quiet\./);
    expect(html).toContain("v2-unset");
  });
});
