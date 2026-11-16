import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import { emptyProjectCompass } from "./compass";
import { emptyProjectSchedule } from "./time";
import { validateWorkspace } from "./transfer";
import { isSetUp } from "./taskCard";
import {
  captureSessionProject,
  endCaptureSession,
  matchProjects,
  parseCaptureCommand,
  placeInProject,
  sessionTaskCount,
  startCaptureSession,
} from "./captureTo";
import type { Project, Workspace } from "./types";

const AT = "2026-11-16T10:00:00+10:30";

function project(id: string, title: string, status: Project["status"] = "active"): Project {
  return {
    id,
    title,
    purpose: `${title} purpose`,
    outcome: "",
    role: "support",
    pattern: "sustained",
    status,
    milestones: [],
    progress: [],
    createdAt: AT,
    updatedAt: AT,
    schedule: emptyProjectSchedule(),
    compass: emptyProjectCompass(),
  };
}

const PROJECTS = [
  project("p-king", "Kingston shack"),
  project("p-coast", "Coast house"),
  project("p-old", "Kingston fence", "achieved"),
];

function workspace(): Workspace {
  return {
    version: 2,
    tasks: [],
    projects: PROJECTS,
    focus: null,
    intention: null,
    matrixWeights: { "direction-timely": 1, "direction-sustained": 1, "support-timely": 1, "support-sustained": 1 },
    trial: { startedAt: AT, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [],
  };
}

describe("capture to a project: phrases", () => {
  it("one task with a colon, or spoken without one", () => {
    expect(parseCaptureCommand("capture to Kingston: fix the gutter", PROJECTS)).toMatchObject({
      kind: "one",
      project: { id: "p-king" },
      rest: "fix the gutter",
    });
    expect(parseCaptureCommand("capture to kingston fix the gutter", PROJECTS)).toMatchObject({
      kind: "one",
      project: { id: "p-king" },
      rest: "fix the gutter",
    });
    expect(parseCaptureCommand("Capture to Coast house check the roof screws.", PROJECTS)).toMatchObject({
      kind: "one",
      project: { id: "p-coast" },
      rest: "check the roof screws",
    });
  });

  it("the name on its own starts a session; end capture ends it", () => {
    expect(parseCaptureCommand("capture to Kingston", PROJECTS)).toMatchObject({ kind: "start", project: { id: "p-king" } });
    expect(parseCaptureCommand("Capture to Kingston shack.", PROJECTS)).toMatchObject({ kind: "start", project: { id: "p-king" } });
    expect(parseCaptureCommand("end capture", PROJECTS)).toEqual({ kind: "end" });
    expect(parseCaptureCommand("Stop capturing.", PROJECTS)).toEqual({ kind: "end" });
  });

  it("asks when two match, and never guesses a missing project", () => {
    const two = [...PROJECTS, project("p-king2", "Kingston beach")];
    expect(parseCaptureCommand("capture to Kingston", two)).toMatchObject({ kind: "ambiguous" });
    expect(parseCaptureCommand("capture to Kingstn: fix it", PROJECTS)).toMatchObject({ kind: "nomatch", name: "Kingstn" });
    expect(parseCaptureCommand("capture to Narnia", PROJECTS)).toMatchObject({ kind: "nomatch" });
  });

  it("only active projects match, and ordinary tasks aren't commands", () => {
    expect(matchProjects("fence", PROJECTS)).toEqual([]);
    expect(parseCaptureCommand("Capture the garden in photos", PROJECTS)).toBeNull();
    expect(parseCaptureCommand("Fix the gutter", PROJECTS)).toBeNull();
  });
});

describe("capture to a project: sessions", () => {
  it("starts, switches and ends; a session survives the strict check", () => {
    let w = startCaptureSession(workspace(), "p-king", AT);
    expect(captureSessionProject(w)?.id).toBe("p-king");
    expect(validateWorkspace(JSON.parse(JSON.stringify(w))).captureSession).toEqual({ projectId: "p-king", startedAt: AT });
    w = startCaptureSession(w, "p-coast", AT);
    expect(captureSessionProject(w)?.id).toBe("p-coast");
    w = endCaptureSession(w);
    expect(w.captureSession).toBeUndefined();
  });

  it("never starts on an achieved or missing project, and a stored one ends if its project goes", () => {
    expect(startCaptureSession(workspace(), "p-old", AT).captureSession).toBeUndefined();
    const stale = { ...workspace(), captureSession: { projectId: "gone", startedAt: AT } };
    expect(validateWorkspace(JSON.parse(JSON.stringify(stale))).captureSession).toBeUndefined();
  });

  it("fills in Place only: the task stays not-ready, for Sort", () => {
    const task = placeInProject(createTask({ title: "Fix the gutter", state: "inbox" }), PROJECTS[0], true, AT);
    expect(task.projectId).toBe("p-king");
    expect(task.nextAction).toBe("");
    expect(task.history.at(-1)?.text).toBe("Captured to Kingston shack (session)");
    expect(isSetUp({ ...task, actionConfirmed: false })).toBe(false);
  });

  it("counts the tasks a session put in its project", () => {
    let w = startCaptureSession(workspace(), "p-king", "2026-11-16T09:00:00+10:30");
    const a = placeInProject(createTask({ title: "A" }), PROJECTS[0], true, AT);
    const b = placeInProject(createTask({ title: "B" }), PROJECTS[0], false, AT);
    w = { ...w, tasks: [a, b] };
    expect(sessionTaskCount(w)).toBe(1);
  });
});
