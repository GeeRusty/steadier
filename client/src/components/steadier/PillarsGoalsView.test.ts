import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { newGoal } from "../../domain/goals";
import type { Workspace } from "../../domain/types";
import PillarsGoalsView from "./PillarsGoalsView";

const stamp = "2026-11-01T10:00:00+10:30";

function syntheticWorkspace(): Workspace {
  const bec = newGoal("pillar", "Bec", stamp);
  const friends = {
    ...newGoal("pillar", "Friends & Family", stamp),
    status: "retired" as const,
  };
  const valueGoal = newGoal("value-goal", "Stay connected", stamp, {
    parents: [
      { id: bec.id, confirmed: true },
      { id: friends.id, confirmed: false },
    ],
  });
  const outcome = {
    ...newGoal("outcome", "Regular shared time", stamp, {
      parents: [{ id: valueGoal.id, confirmed: true }],
    }),
    projects: [{ id: "project-visit", confirmed: true }],
  };
  return {
    version: 2,
    tasks: [],
    projects: [
      {
        id: "project-visit",
        title: "Plan a visit",
        status: "active",
        updatedAt: stamp,
      } as Workspace["projects"][number],
    ],
    focus: null,
    intention: null,
    matrixWeights: {
      "direction-timely": 1,
      "direction-sustained": 1,
      "support-timely": 1,
      "support-sustained": 1,
    },
    trial: { startedAt: stamp, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [bec, friends, valueGoal, outcome],
  };
}

function render(): string {
  vi.stubGlobal("React", React);
  return renderToStaticMarkup(
    createElement(PillarsGoalsView, {
      workspace: syntheticWorkspace(),
      onOpenGoal: () => {},
      onOpenMap: () => {},
      onMutate: () => true,
      readOnly: false,
    })
  );
}

describe("Pillars & Goals page", () => {
  it("shows one card per active Pillar with its definition prompt, summary and chips; retired folded away", () => {
    const html = render();
    expect(html).toContain('aria-label="Bec"');
    expect(html).toContain("+ Add definition");
    expect(html).toContain("1 Value Goal · 1 Outcome · 1 project");
    expect(html).toContain(">no definition<");
    // Retired Pillars aren't cards; they sit behind "Retired (1)".
    expect(html).not.toContain('aria-label="Friends &amp; Family"');
    expect(html).toContain("Retired (1)");
    // No counts in a header, no dashed "+ Add".
    expect(html).not.toMatch(/\d+ active/);
    expect(html).not.toContain("dashed");
  });
});
