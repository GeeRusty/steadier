import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newGoal } from "../../domain/goals";
import type { Workspace } from "../../domain/types";
import type { VoiceControls } from "../../hooks/useVoice";
import MapItemPage from "./MapItemPage";

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
    goals: [newGoal("pillar", "Family", stamp)],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("MapItemPage owner-confirmed editing", () => {
  it("does not write on open and offers the Android editable-draft handoff", () => {
    const workspace = syntheticWorkspace();
    const goal = workspace.goals[0]!;
    const mutate = vi.fn((_change: (current: Workspace) => Workspace) => true);
    vi.stubGlobal("React", React);
    vi.stubGlobal("window", {
      location: { protocol: "https:" },
      ReactNativeWebView: { postMessage: vi.fn() },
    });

    const markup = renderToStaticMarkup(
      createElement(MapItemPage, {
        workspace,
        goalId: goal.id,
        onMutate: mutate,
        onOpenGoal: () => {},
        onOpenProject: () => {},
        onOpenImperatives: () => {},
        onBack: () => {},
        backLabel: "Pillars & Goals",
        voice,
        readOnly: false,
      })
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(markup).toContain("Pillars &amp; Goals");
    expect(markup).toContain("Save changes");
    expect(markup).toContain("Focus title for app Voice");
    expect(markup).toContain("Use the app’s opt-in Tools/Voice panel");
  });
});
