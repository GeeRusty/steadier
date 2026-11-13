import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTask } from "../../domain/engine";
import { emptyProjectCompass } from "../../domain/compass";
import { emptyProjectSchedule } from "../../domain/time";
import type { Project, Task, Workspace } from "../../domain/types";
import LifeView, { ProjectPage } from "./LifeView";

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

function renderPage(project: Project, tasks: Task[] = []) {
  const workspace = syntheticWorkspace(project, tasks);
  return renderToStaticMarkup(
    <ProjectPage
      project={project}
      workspace={workspace}
      readOnly={false}
      outcomeOpen={false}
      onToggleOutcome={vi.fn()}
      onBack={vi.fn()}
      onEdit={vi.fn()}
      onOpenTask={vi.fn()}
      onAddTask={vi.fn()}
      onMutate={() => true}
      updateProject={vi.fn()}
      milestoneDraft=""
      onMilestoneDraft={vi.fn()}
      onAddMilestone={vi.fn()}
      evidenceDraft=""
      onEvidenceDraft={vi.fn()}
      onAddEvidence={vi.fn()}
    />
  );
}

const nextTask = (project: Project) => ({
  ...createTask({ title: "Synthetic next step", state: "ready" }, "2026-11-09"),
  id: "synthetic-next-task",
  title: "Synthetic next step",
  nextAction: "Write the first outline",
  projectId: project.id,
  labelSource: "confirmed" as const,
  updatedAt: stamp,
});

describe("Projects (design language)", () => {
  it("lists compact project rows: title, open count, no labels or explanations", () => {
    const project = syntheticProject();
    const html = renderProjects(project, [nextTask(project)]);
    expect(html).toContain("Synthetic outcome");
    expect(html).toContain("1 open");
    for (const noise of ["Compass makes the choices", "Keep the direction you chose in view", "NEXT STEP", "Can start", "Support ·", "Imperative ·"]) {
      expect(html).not.toContain(noise);
    }
    expect(html).toContain('aria-label="What this page shows"');
  });

  it("project page leads with Next step, then Why, Outcome and Tasks", () => {
    const project = syntheticProject();
    const html = renderPage(project, [nextTask(project)]);
    const at = (text: string) => html.indexOf(text);
    expect(at(">Next step<")).toBeGreaterThan(-1);
    expect(at(">Next step<")).toBeLessThan(at(">Why<"));
    expect(at(">Why<")).toBeLessThan(at(">Outcome<"));
    expect(at(">Outcome<")).toBeLessThan(at(">Tasks"));
    expect(html).toContain('aria-label="Open task Synthetic next step"');
    expect(html).toContain('aria-label="Mark Synthetic next step done"');
    expect(html).not.toMatch(/class="state-tag state-/);
  });

  it("empty fields offer only + Add …, never an explanation", () => {
    const html = renderPage({ ...syntheticProject(), outcome: "", purpose: "" });
    expect(html).toContain("+ Add a step");
    expect(html).toContain("+ Add outcome");
    expect(html).toContain("+ Add purpose");
    expect(html).not.toContain("No active linked task yet");
    expect(html).not.toContain("written yet");
  });
});
