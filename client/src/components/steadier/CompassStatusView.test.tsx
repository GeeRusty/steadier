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
    expect(html).toContain('aria-label="Status mark shape key"');
    expect(html).toContain("Up arrow — Ahead");
    expect(html).toContain("Line — On track");
    expect(html).toContain("Down arrow — Behind");
    expect(html).toContain("0–6 days since recorded movement is on track; 7 or more days is behind.");
    expect(html).toContain('data-mark-symbol="ahead"');
    expect(html).toContain('data-mark-symbol="on-track"');
    expect(html).toContain('data-mark-symbol="behind"');
    expect(html).toContain('aria-label="Status mark colour key"');
    expect(html).toContain("Colour key");
    expect(html).toContain(
      "Green: active Imperative, or Project and linked Goal Outcome share a direct active Imperative."
    );
    expect(html).toContain(
      "Red: Project has no active confirmed Goal Outcome, or is linked to an active Imperative that does not also link its Goal Outcome."
    );
    expect(html).toContain(
      "Amber: Project has no direct active-Imperative link, or Task has no available Project or owner-confirmed catch-all."
    );
    expect(html).toContain(
      "Blue: Task with owner-confirmed Life Admin catch-all."
    );
    expect(html).toContain(
      "Purple: Task with owner-confirmed Erosion Guard catch-all."
    );
    expect(html).toContain('class="compass-status-key-sample"');
    expect(html).not.toContain("status-mark-surface");
    expect(html).toContain('style="color:#009F55"');
    expect(html).not.toContain('class="timing-shape-color-swatch"');
    expect(html).toContain('class="compass-status-key-arrow"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain(
      "Grey overrides colour for a Project with no purpose, a review date due or overdue, or 14 or more quiet days; Someday and parked items stay uncoloured."
    );
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
    expect(html).toContain("Alignment colour: Red.");
    expect(html).toContain("Alignment colour: Green.");
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

  it("uses the key's semantic colors for every live page mark in both themes", () => {
    const colors = ["green", "red", "amber", "blue", "purple"] as const;
    for (const appearance of ["light", "dark"] as const) {
      const html = renderPage(workspace(), appearance);
      for (const color of colors) {
        expect(html).toContain(
          `style="color:${statusMarkColorHex(color, appearance)}"`
        );
      }
      for (const color of ["green", "red"] as const) {
        expect(html).toContain(
          `data-arrow-color="${statusMarkColorHex(color, appearance)}"`
        );
      }
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
