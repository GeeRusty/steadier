import { describe, expect, it } from "vitest";
import { hasOwnPlacement, isUnplaced } from "./compass";
import { completeTask } from "./engine";
import { newGoal } from "./goals";
import {
  markObligationPaid,
  newObligationDraft,
  nextObligationDueDate,
  preparationDateFor,
  saveObligation,
} from "./obligations";
import { exportBackup, parseBackup, validateWorkspace } from "./transfer";
import type { Obligation, Workspace } from "./types";

const STAMP = "2026-10-30T11:00:00+10:30";
const DAY = "2026-10-30";

function workspace(): Workspace {
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
    trial: { startedAt: STAMP, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [
      {
        ...newGoal("pillar", "Home", STAMP),
        id: "pillar-home",
      },
    ],
    obligations: [],
  };
}

function draft(patch: Partial<Obligation> = {}): Obligation {
  return {
    ...newObligationDraft(DAY, STAMP, "obligation-insurance"),
    title: "Car insurance renewal",
    kind: "insurance",
    dueDate: "2026-11-20",
    leadTimeDays: 7,
    cadenceAnchorDate: "2026-11-20",
    link: { kind: "pillar", id: "pillar-home" },
    nextAction: "Check the renewal notice and cover.",
    ...patch,
  };
}

describe("obligations and preparation lead time", () => {
  it("creates one actionable prep task at due date minus the configured lead time", () => {
    const result = saveObligation(
      workspace(),
      draft(),
      "active",
      STAMP,
      () => "prep-first"
    );
    const obligation = result.obligations!.find(
      item => item.id === "obligation-insurance"
    )!;
    const task = result.tasks.find(
      item => item.id === obligation.preparationTaskId
    )!;

    expect(preparationDateFor(obligation)).toBe("2026-11-13");
    expect(task.deadline).toBe("2026-11-13");
    expect(task.startDate).toBe("2026-11-13");
    expect(task.schedule.date).toBe("2026-11-13");
    expect(task.schedule.repeat).toBeNull();
    expect(task.obligation).toEqual({
      obligationId: obligation.id,
      occurrenceDueDate: "2026-11-20",
      link: { kind: "pillar", id: "pillar-home" },
      active: true,
    });
    expect(hasOwnPlacement(task)).toBe(true);
    expect(isUnplaced(task, result.tasks)).toBe(false);
    expect(task.deadline).not.toBe(obligation.dueDate);
  });

  it("is idempotent and moves the existing task when the due date or lead time changes", () => {
    const first = saveObligation(
      workspace(),
      draft(),
      "active",
      STAMP,
      () => "prep-stable"
    );
    const saved = first.obligations![0];
    const same = saveObligation(
      first,
      saved,
      "active",
      STAMP,
      () => "should-not-be-used"
    );
    expect(same.tasks).toBe(first.tasks);
    expect(same.tasks).toHaveLength(1);

    const edited = {
      ...saved,
      dueDate: "2026-12-20",
      cadenceAnchorDate: "2026-12-20",
      leadTimeDays: 10,
    };
    const moved = saveObligation(
      first,
      edited,
      "active",
      "2026-10-31T09:00:00+10:30"
    );
    expect(moved.tasks).toHaveLength(1);
    expect(moved.tasks[0].id).toBe("prep-stable");
    expect(moved.tasks[0].deadline).toBe("2026-12-10");
    expect(moved.tasks[0].obligation?.occurrenceDueDate).toBe("2026-12-20");
  });

  it("does not treat completing preparation as payment or create a next occurrence", () => {
    const active = saveObligation(
      workspace(),
      draft({ cadence: "monthly", cadenceAnchorDate: "2026-11-20" }),
      "active",
      STAMP,
      () => "prep-monthly"
    );
    const completedTasks = completeTask(
      active.tasks,
      "prep-monthly",
      "2026-11-13"
    );
    expect(completedTasks).toHaveLength(1);
    expect(completedTasks[0].state).toBe("done");
    expect(active.obligations![0].status).toBe("active");
    expect(active.obligations![0].dueDate).toBe("2026-11-20");
    expect(active.obligations![0].lastPaidOn).toBeNull();
  });

  it("advances only after explicit paid confirmation and preserves month-end cadence", () => {
    const active = saveObligation(
      workspace(),
      draft({
        dueDate: "2026-10-31",
        cadence: "monthly",
        cadenceAnchorDate: "2026-10-31",
        leadTimeDays: 5,
      }),
      "active",
      STAMP,
      () => "prep-october"
    );
    const obligation = active.obligations![0];
    expect(nextObligationDueDate(obligation)).toBe("2026-11-30");
    expect(
      nextObligationDueDate(
        draft({
          dueDate: "2026-10-30",
          cadence: "weekly",
          cadenceAnchorDate: "2026-10-30",
        })
      )
    ).toBe("2026-11-06");

    const firstPaid = markObligationPaid(
      active,
      obligation.id,
      "2026-10-31",
      "2026-10-31",
      STAMP,
      () => "prep-november"
    );
    expect(firstPaid.obligations![0].status).toBe("active");
    expect(firstPaid.obligations![0].dueDate).toBe("2026-11-30");
    expect(firstPaid.obligations![0].lastPaidDueDate).toBe("2026-10-31");
    expect(firstPaid.tasks).toHaveLength(2);
    expect(firstPaid.tasks[0].state).toBe("someday");
    expect(firstPaid.tasks[1].id).toBe("prep-november");
    expect(firstPaid.tasks[1].deadline).toBe("2026-11-25");
    expect(nextObligationDueDate(firstPaid.obligations![0])).toBe("2026-12-31");

    const duplicateConfirmation = markObligationPaid(
      firstPaid,
      obligation.id,
      "2026-10-31",
      "2026-10-31",
      STAMP,
      () => "should-not-be-used"
    );
    expect(duplicateConfirmation).toBe(firstPaid);
  });

  it("requires an owner-confirmed Pillar or Imperative link before activation", () => {
    const unlinked = { ...draft(), link: null };
    expect(() =>
      saveObligation(workspace(), unlinked, "active", STAMP)
    ).toThrow(/Pillar or Imperative/);
    const validDraft = saveObligation(workspace(), unlinked, "draft", STAMP);
    expect(validDraft.obligations).toHaveLength(1);
    expect(validDraft.tasks).toHaveLength(0);
  });

  it("defaults historical workspace data to an empty collection and round-trips active records in full backups", () => {
    const current = saveObligation(
      workspace(),
      draft({
        referenceUrl: "https://provider.example/renewal",
        amountDue: "$280",
      }),
      "active",
      STAMP,
      () => "prep-roundtrip"
    );
    const withoutCollection = { ...workspace() };
    delete withoutCollection.obligations;
    expect(validateWorkspace(withoutCollection).obligations ?? []).toEqual([]);

    const restored = parseBackup(exportBackup(current));
    expect(restored.obligations).toEqual(current.obligations);
    expect(restored.tasks).toEqual(current.tasks);
  });
});
