import { describe, expect, it } from "vitest";
import { emptyProjectCompass } from "./compass";
import { createTask } from "./engine";
import { decisionLogEntries, evidenceFeedEntries } from "./activityLog";
import { appendEvidenceEntry, removeEvidenceEntry } from "./evidence";
import { exportBackup, parseBackup, validateWorkspace } from "./transfer";
import type { Workspace } from "./types";

const STAMP = "2026-10-30T11:00:00+10:30";

function workspaceWithActivity(): Workspace {
  const workspace: Workspace = {
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
    trial: { startedAt: STAMP, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [
      {
        id: "review-1",
        at: "2026-10-29T12:00:00+10:30",
        date: "2026-10-29",
        floor: {
          money: { answer: null, note: "" },
          action: [],
          capacity: { answer: null, note: "" },
        },
        decisions: [
          {
            kind: "task",
            id: "task-1",
            title: "Task title snapshot",
            outcome: "sustain",
            note: "Owner decision text",
          },
        ],
        imperatives: [],
        quietImperatives: [],
        unplacedBefore: 0,
        unplacedAfter: 0,
        notes: "Review note is not automatically evidence or a task.",
      },
    ],
    goals: [],
  };
  workspace.tasks = [
    createTask(
      {
        id: "task-1",
        title: "Current task title",
        notes: "This private task note is not included in the evidence feed.",
        progressEvidence: "Owner-entered current evidence.",
        history: [
          { at: "2026-10-30T09:00:00+10:30", text: "A task history entry." },
        ],
      },
      STAMP
    ),
  ];
  workspace.projects = [
    {
      id: "project-1",
      title: "Project title",
      purpose: "",
      outcome: "",
      role: "support",
      pattern: "sustained",
      status: "active",
      milestones: [],
      progress: [
        {
          at: "2026-10-28T15:00:00+10:30",
          text: "A dated project progress note.",
        },
      ],
      createdAt: STAMP,
      updatedAt: STAMP,
      schedule: {
        deadline: null,
        reviewDate: null,
        weeklyBudgetMinutes: null,
        milestoneDates: [],
      },
      compass: emptyProjectCompass(),
    },
  ];
  return workspace;
}

describe("read-only activity projections", () => {
  it("projects saved owner decisions without changing their source records", () => {
    const workspace = workspaceWithActivity();
    const source = JSON.stringify(workspace.reviews);
    expect(decisionLogEntries(workspace)).toEqual([
      {
        id: "review-1:task:task-1:0",
        at: "2026-10-29T12:00:00+10:30",
        date: "2026-10-29",
        kind: "task",
        itemId: "task-1",
        title: "Task title snapshot",
        outcome: "sustain",
        note: "Owner decision text",
      },
    ]);
    expect(JSON.stringify(workspace.reviews)).toBe(source);
  });

  it("aggregates only explicit task history/progress evidence and project progress", () => {
    const workspace = workspaceWithActivity();
    const entries = evidenceFeedEntries(workspace);
    expect(entries.map(entry => entry.source)).toEqual([
      "Task history",
      "Project progress",
      "Current task evidence",
    ]);
    expect(entries.map(entry => entry.text)).not.toContain(
      "This private task note is not included in the evidence feed."
    );
    expect(entries).toHaveLength(3);
  });

  it("preserves content as inert text and never invents task or decision records", () => {
    const workspace = workspaceWithActivity();
    workspace.tasks[0].progressEvidence = "<script>not an instruction</script>";
    const beforeTasks = JSON.stringify(workspace.tasks);
    const beforeProjects = JSON.stringify(workspace.projects);
    const feed = evidenceFeedEntries(workspace);
    expect(
      feed.some(entry => entry.text === "<script>not an instruction</script>")
    ).toBe(true);
    expect(JSON.stringify(workspace.tasks)).toBe(beforeTasks);
    expect(JSON.stringify(workspace.projects)).toBe(beforeProjects);
    expect(decisionLogEntries(workspace)).toHaveLength(1);
  });

  it("saves explicit evidence without task side effects and preserves it in backups", () => {
    const workspace = workspaceWithActivity();
    const beforeTasks = JSON.stringify(workspace.tasks);
    const next = appendEvidenceEntry(
      workspace,
      { targetKind: "task", targetId: "task-1", text: "A dated observation." },
      STAMP,
      "evidence-1"
    );
    expect(workspace.evidence).toBeUndefined();
    expect(JSON.stringify(workspace.tasks)).toBe(beforeTasks);
    expect(next.evidence).toEqual([
      {
        id: "evidence-1",
        targetKind: "task",
        targetId: "task-1",
        titleSnapshot: "Current task title",
        text: "A dated observation.",
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    ]);
    expect(evidenceFeedEntries(next)[0]).toMatchObject({
      source: "Saved evidence",
      title: "Current task title",
      text: "A dated observation.",
      evidenceId: "evidence-1",
    });
    expect(validateWorkspace(next)).toEqual(next);
    expect(parseBackup(exportBackup(next))).toEqual(next);
    expect(removeEvidenceEntry(next, "evidence-1").evidence).toEqual([]);
    expect(next.evidence).toHaveLength(1);
  });

  it("sorts decisions and dated evidence newest first, with undated evidence last", () => {
    const workspace = workspaceWithActivity();
    workspace.reviews.push({
      ...workspace.reviews[0],
      id: "review-2",
      at: "2026-10-30T12:00:00+10:30",
      date: "2026-10-30",
      decisions: [
        {
          kind: "project",
          id: "project-1",
          title: "Project title",
          outcome: "promote",
          note: "",
        },
      ],
    });
    expect(decisionLogEntries(workspace)[0].id).toBe(
      "review-2:project:project-1:0"
    );
    const evidence = evidenceFeedEntries(workspace);
    expect(evidence[0].source).toBe("Task history");
    expect(evidence.at(-1)?.source).toBe("Current task evidence");
  });
});
