import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyProjectCompass } from "../../domain/compass";
import { adelaideClock } from "../../domain/time";
import { emptyProjectSchedule } from "../../domain/time";
import type { Imperative } from "../../domain/compass";
import type { Appearance } from "../../domain/appearance";
import type { Project, Workspace } from "../../domain/types";
import {
  createStatusMarkData,
  statusMarkColorHex,
} from "../../domain/statusMarkColor";
import CompassStatusView, {
  statusMarkLegendReadAloudText,
} from "./CompassStatusView";
import { TaskKindContext } from "./TaskStates";

const today = adelaideClock().date;
const stamp = `${today}T09:00:00+10:30`;

function project(id: string, status: Project["status"] = "active"): Project {
  return {
    id,
    title: `Synthetic ${id}`,
    purpose: "Synthetic purpose",
    outcome: "",
    role: "direction",
    pattern: "timely",
    status,
    milestones: [],
    progress: [],
    createdAt: stamp,
    updatedAt: stamp,
    schedule: emptyProjectSchedule(),
    compass: emptyProjectCompass(),
  };
}

function imperative(
  id: string,
  status: Imperative["status"] = "active"
): Imperative {
  return {
    id,
    title: `Synthetic ${id}`,
    reason: "Synthetic reason",
    status,
    setOn: today,
    retiredOn: status === "retired" ? today : null,
    notionUrl: null,
    decision: null,
    history: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function workspace(): Workspace {
  return {
    version: 2,
    tasks: [],
    projects: [project("red-project"), project("achieved-project", "achieved")],
    focus: null,
    intention: null,
    matrixWeights: {
      "direction-timely": 1,
      "direction-sustained": 1,
      "support-timely": 1,
      "support-sustained": 1,
    },
    trial: {
      startedAt: stamp,
      lastExportAt: null,
      lastReviewAt: null,
    },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [
      imperative("active-imperative"),
      imperative("retired-imperative", "retired"),
    ],
    reviews: [],
    goals: [],
  };
}

function renderPage(value: Workspace, appearance: Appearance = "light") {
  const statusMarkData = {
    ...createStatusMarkData({
      projects: value.projects,
      goals: value.goals,
      imperatives: value.imperatives,
    }),
    lastWeeklyReviewDate: null,
  };
  return renderToStaticMarkup(
    <TaskKindContext.Provider
      value={{ ctx: {} as never, tasks: [], statusMarkData, appearance }}
    >
      <CompassStatusView
        workspace={value}
        onOpenProject={() => {}}
        onOpenImperative={() => {}}
        onRead={() => {}}
      />
    </TaskKindContext.Provider>
  );
}

describe("CompassStatusView", () => {
  it("lists only active records in red/grey/other order with open controls", () => {
    const html = renderPage(workspace());
    const red = html.indexOf('data-sort-group="red"');
    const grey = html.indexOf('data-sort-group="grey"');
    const rest = html.indexOf('data-sort-group="rest"');

    expect(html).toContain("Compass view");
    // The arrow marks and their keys are gone (design language).
    expect(html).not.toContain("data-mark-symbol");
    expect(html).not.toContain("Shape key");
    expect(html).not.toContain("Colour key");
    expect(red).toBeGreaterThanOrEqual(0);
    expect(red).toBeLessThan(grey);
    expect(grey).toBeLessThan(rest);
    expect(html).toContain(
      'aria-label="Open active Project Synthetic red-project"'
    );
    expect(html).toContain(
      'aria-label="Open active Imperative Synthetic active-imperative"'
    );
    expect(html).not.toContain("Synthetic achieved-project");
    expect(html).not.toContain("Synthetic retired-imperative");
    expect(html).toContain('aria-label="Missing its Goal Outcome or Imperative link"');
  });

  it("shows a clear empty state and keeps the user-tapped read-aloud control", () => {
    const empty = workspace();
    empty.projects = empty.projects.map(item => ({
      ...item,
      status: "achieved",
    }));
    empty.imperatives = empty.imperatives.map(item => ({
      ...item,
      status: "retired",
      retiredOn: today,
    }));
    const html = renderPage(empty);

    expect(html).toContain("No active Imperatives or Projects");
    expect(html).toContain("Read aloud");
    expect(html).toContain("No items in this group.");
  });

  it("draws no arrows or colour marks in either theme", () => {
    for (const appearance of ["light", "dark"] as const) {
      const html = renderPage(workspace(), appearance);
      expect(html).not.toContain("data-arrow-color");
      expect(html).not.toContain("timing-shape-mark");
    }
  });

  it("includes both shape and color explanations in the user-tapped read-aloud key", () => {
    const description = statusMarkLegendReadAloudText();
    expect(description).toContain("Shape key.");
    expect(description).toContain("Up arrow — Ahead");
    expect(description).toContain("Without a booked timing commitment, 0–6 days since recorded movement");
    expect(description).toContain("Date and time checks use Adelaide-local time.");
    expect(description).toContain("Colour key.");
    expect(description).toContain("Green:");
    expect(description).toContain("Purple:");
  });
});
