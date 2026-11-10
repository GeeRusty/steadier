import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { newGoal } from "../../domain/goals";
import type { Workspace } from "../../domain/types";
import type { VoiceControls } from "../../hooks/useVoice";
import PillarsGoalsView from "./PillarsGoalsView";

const stamp = "2026-11-01T10:00:00+10:30";
const voice = {
  supported: false,
  speechSupported: false,
  listening: false,
  speaking: false,
  transcript: "",
  finalTranscript: "",
  interimTranscript: "",
  error: "",
  start: () => {},
  stop: () => {},
  abort: () => {},
  clear: () => {},
  read: () => {},
  stopSpeaking: () => {},
} satisfies VoiceControls;

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
      voice,
    })
  );
}

describe("Pillars & Goals directory", () => {
  it("groups every goal level and shows status and existing relationships", () => {
    const markup = render();
    expect(markup).toContain("Pillars &amp; Goals");
    expect(markup).toContain("Pillars");
    expect(markup).toContain("Value Goals");
    expect(markup).toContain("Goal Outcomes");
    expect(markup).toContain("Bec");
    expect(markup).toContain("Friends &amp; Family");
    expect(markup).toContain("Retired");
    expect(markup).toContain("Under: Bec, Friends &amp; Family (suggested)");
    expect(markup).toContain("Projects: Plan a visit");
    expect(markup).toContain("Open Compass map");
    expect(markup).toContain("Read aloud");
  });
});
