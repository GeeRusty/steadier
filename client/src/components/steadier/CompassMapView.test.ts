import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { newGoal } from "../../domain/goals";
import type { Workspace } from "../../domain/types";
import type { VoiceControls } from "../../hooks/useVoice";
import CompassMapView from "./CompassMapView";

const stamp = "2026-10-25T10:00:00";

function syntheticWorkspace(): Workspace {
  return {
    version: 2,
    tasks: [],
    projects: [],
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
    goals: [
      newGoal("pillar", "Family", stamp),
      newGoal("pillar", "Friends & Social", stamp),
    ],
  };
}

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

function render(): string {
  vi.stubGlobal("React", React);
  return renderToStaticMarkup(
    createElement(CompassMapView, {
      workspace: syntheticWorkspace(),
      onMutate: () => true,
      onOpenGoal: () => {},
      onOpenImperatives: () => {},
      onOpenCompassView: () => {},
      voice,
      readOnly: false,
    })
  );
}

describe("CompassMapView", () => {
  it("keeps the map available without the retired one-off rename action", () => {
    const markup = render();
    expect(markup).toContain("Compass map");
    expect(markup).toContain("Family");
    expect(markup).toContain("Friends &amp; Social");
    expect(markup).not.toContain("Rename both Pillars");
    expect(markup).toContain("Compass view");
  });
});
