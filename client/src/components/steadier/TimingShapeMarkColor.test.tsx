import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyProjectCompass, emptyTaskCompass } from "../../domain/compass";
import { createTask } from "../../domain/engine";
import type { Goal } from "../../domain/goals";
import { adelaideClock, emptyProjectSchedule, emptyTaskSchedule } from "../../domain/time";
import type { Imperative } from "../../domain/compass";
import type { Project } from "../../domain/types";
import { createStatusMarkData } from "../../domain/statusMarkColor";
import TimingShapeMark from "./TimingShapeMark";
import { TaskKindContext } from "./TaskStates";

const TODAY = adelaideClock().date;
const STAMP = `${TODAY}T09:00:00+10:30`;

describe("Stage 2 timing mark colour", () => {
  it("adds an accessible colour label while preserving the timing shape", () => {
    const project: Project = {
      id: "project-1",
      title: "Synthetic project",
      purpose: "Synthetic project purpose",
      outcome: "",
      role: "direction",
      pattern: "timely",
      status: "active",
      milestones: [],
      progress: [],
      createdAt: STAMP,
      updatedAt: STAMP,
      schedule: emptyProjectSchedule(),
      compass: { ...emptyProjectCompass(), imperativeIds: ["imperative-1"] },
    };
    const outcome: Goal = {
      id: "outcome-1",
      level: "outcome",
      title: "Synthetic outcome",
      description: "",
      status: "active",
      parents: [],
      projects: [{ id: project.id, confirmed: true }],
      notionUrl: null,
      history: [],
      createdAt: STAMP,
      updatedAt: STAMP,
    };
    const imperative: Imperative = {
      id: "imperative-1",
      title: "Synthetic imperative",
      reason: "",
      status: "active",
      setOn: TODAY,
      retiredOn: null,
      notionUrl: null,
      decision: null,
      history: [],
      createdAt: STAMP,
      updatedAt: STAMP,
      mapLinks: [outcome.id],
    };
    const task = createTask(
      {
        title: "Synthetic color task",
        projectId: project.id,
        state: "ready",
        deadline: "2099-01-01",
        preparationDate: null,
        reviewDate: null,
        schedule: emptyTaskSchedule(),
        createdAt: STAMP,
        updatedAt: STAMP,
      },
      TODAY
    );
    const statusMarkData = createStatusMarkData({
      projects: [project],
      goals: [outcome],
      imperatives: [imperative],
    });
    const html = renderToStaticMarkup(
      <TaskKindContext.Provider
        value={{ ctx: {} as never, tasks: [], statusMarkData, appearance: "light" }}
      >
        <TimingShapeMark task={task} />
      </TaskKindContext.Provider>
    );
    expect(html).toContain('data-shape="on-track"');
    expect(html).toContain('data-color="green"');
    expect(html).toContain("Alignment colour: Green.");
    expect(html).toContain("--status-mark-color:#009F55");
    expect(html).toContain('data-arrow-color="#009F55"');
    expect(html).toContain('data-appearance="light"');
    expect(html).not.toContain("status-mark-surface");
    expect(html).not.toContain("data-badge-shape");
    expect(html).not.toContain("status-mark-fill");
    expect(html).not.toContain("timing-shape-color-swatch");
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain(
      'class="timing-shape-mark timing-shape-on-track timing-shape-color-green"'
    );
    const darkHtml = renderToStaticMarkup(
      <TaskKindContext.Provider
        value={{ ctx: {} as never, tasks: [], statusMarkData, appearance: "dark" }}
      >
        <TimingShapeMark task={task} />
      </TaskKindContext.Provider>
    );
    expect(darkHtml).toContain('data-appearance="dark"');
    expect(darkHtml).toContain('data-arrow-color="#27E39B"');
    expect(darkHtml).not.toContain("status-mark-surface");
  });
});
