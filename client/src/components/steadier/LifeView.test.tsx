import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTask } from "../../domain/engine";
import { emptyProjectCompass } from "../../domain/compass";
import { emptyProjectSchedule } from "../../domain/time";
import type { Project, Task, Workspace } from "../../domain/types";
import LifeView from "./LifeView";

const stamp = "2026-11-09T09:00:00+10:30";

function syntheticProject(status: Project["status"] = "active"): Project {
  return {
    id: "synthetic-project",
    title: "Synthetic outcome",
    purpose: "Synthetic purpose only",
    outcome: "Synthetic outcome only",
    role: "direction",
    pattern: "sustained",
    status,
    milestones: [],
    progress: [],
    createdAt: stamp,
    updatedAt: stamp,
    schedule: emptyProjectSchedule(),
    compass: emptyProjectCompass(),
  };
}

function syntheticWorkspace(project: Project, tasks: Task[] = []): Workspace {
  return {
    version: 2,
    tasks,
    projects: [project],
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
    goals: [],
  };
}

function renderProjects(project: Project, tasks: Task[] = []) {
  const workspace = syntheticWorkspace(project, tasks);
  return renderToStaticMarkup(
    <LifeView
      view="projects"
      workspace={workspace}
      onMutate={() => true}
      onOpenTask={vi.fn()}
      onAddTask={vi.fn()}
      readOnly={false}
    />
  );
}

describe("Project Outcomes mobile next-step surface", () => {
  it("surfaces an existing linked task, its next action and saved state near the project heading", () => {
    const project = syntheticProject();
    const task = {
      ...createTask({ title: "Synthetic next step", state: "ready" }, "2026-11-09"),
      id: "synthetic-next-task",
      title: "Synthetic next step",
      nextAction: "Write the first outline",
      projectId: project.id,
      labelSource: "confirmed" as const,
      updatedAt: stamp,
    };
    const html = renderProjects(project, [task]);

    expect(html.indexOf("NEXT STEP")).toBeLessThan(html.indexOf("LINKED NEXT TASKS"));
    expect(html).toContain("Synthetic next step");
    expect(html).toContain("Write the first outline");
    expect(html).toContain('aria-label="Open next linked task Synthetic next step"');
    expect(html).toContain("Open next task");
    expect(html).toMatch(/class="state-tag state-[^"]+"/);
  });

  it("offers one Add small task action near the heading when an active outcome has no next step", () => {
    const html = renderProjects(syntheticProject());

    expect(html).toContain("No active linked task yet.");
    expect(html).toContain('aria-label="Add small task to Synthetic outcome"');
    expect(html.match(/> Add small task<\/button>/g)).toHaveLength(1);
    expect(html.indexOf("Add small task")).toBeLessThan(html.indexOf("LINKED NEXT TASKS"));
  });
});
