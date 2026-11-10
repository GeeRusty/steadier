import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import { emptyTaskSchedule } from "./time";
import {
  catchAllWatch,
  orphanInfo,
  orphanReport,
  recurringLifeAdmin,
  stampOwnerPlacement,
} from "./orphans";
import { isUnplaced } from "./compass";
import type { Task } from "./types";

// Captured 9:00 am Adelaide (ACDT, +10:30) on 1 Oct 2026.
const CAPTURED = "2026-10-01T09:00:00+10:30";
const at = (hours: number) =>
  new Date(Date.parse(CAPTURED) + hours * 3_600_000);

function task(extra: Partial<Task> = {}): Task {
  const t = createTask({ title: "Pay rego" }, "2026-10-01");
  return { ...t, createdAt: CAPTURED, updatedAt: CAPTURED, ...extra };
}

describe("orphan protection", () => {
  it("escalates by age since capture: 0, then 1 at 8h, 2 at 24h, 3 at 3 days", () => {
    expect(orphanInfo(task(), at(7)).stage).toBe(0);
    expect(orphanInfo(task(), at(9)).stage).toBe(1);
    expect(orphanInfo(task(), at(25)).stage).toBe(2);
    expect(orphanInfo(task(), at(73)).stage).toBe(3);
  });

  it("works out the true stage after the app was closed for days", () => {
    // Nothing is stored: opening 5 days later shows Stage 3 straight away.
    const info = orphanInfo(task(), at(24 * 5));
    expect(info.stage).toBe(3);
    expect(Math.round(info.ageHours)).toBe(120);
  });

  it("skips urgent tasks straight to Stage 2 (deadline, fixed time, reminder)", () => {
    const timed = task({
      schedule: { ...emptyTaskSchedule(), date: "2026-10-09", time: "10:00" },
    });
    expect(orphanInfo(timed, at(1)).stage).toBe(2);
    expect(orphanInfo(timed, at(1)).urgent).toBe("has a fixed time");
    const reminded = task({
      schedule: {
        ...emptyTaskSchedule(),
        reminders: [{ id: "r1", minutesBefore: 30 } as never],
      },
    });
    expect(orphanInfo(reminded, at(1)).stage).toBe(2);
    expect(orphanInfo(task({ deadline: "2026-10-20" }), at(1)).stage).toBe(2);
  });

  it("marks a task due within 2 days as overdue for placement at once", () => {
    const soon = orphanInfo(task({ deadline: "2026-10-02" }), at(1));
    expect(soon.stage).toBe(3);
    expect(soon.urgent).toBe("due within 2 days");
  });

  it("counts suggested placements as unplaced until confirmed", () => {
    const suggested = task({
      projectId: "p1",
      compass: { ...task().compass, projectSuggested: true },
    });
    expect(isUnplaced(suggested)).toBe(true);
    expect(orphanInfo(suggested, at(1)).pending).toBe("project");
    const filed = task({
      compass: {
        ...task().compass,
        catchAll: "life-admin",
        catchAllConfirmed: true,
      },
    });
    expect(isUnplaced(filed)).toBe(false);
  });

  it("lists most overdue first, then oldest", () => {
    const a = task({ id: "a", createdAt: "2026-10-03T08:00:00+10:30" });
    const b = task({ id: "b" });
    const c = task({ id: "c", deadline: "2026-10-04" });
    const report = orphanReport([a, b, c], at(60));
    expect(report.items.map(i => i.task.id)).toEqual(["c", "b", "a"]);
    expect(report.overdue).toBe(1);
  });

  it("makes the owner's own project or Imperative link confirmed and records filed time", () => {
    const before = task({
      projectId: "p1",
      compass: { ...task().compass, projectSuggested: true },
    });
    const afterProject = { ...before, projectId: "p2" };
    const [owned] = stampOwnerPlacement(
      [before],
      [afterProject],
      "2026-10-05T10:00:00+10:30"
    );
    expect(owned.compass.projectSuggested).toBe(false);
    const filed = {
      ...before,
      compass: {
        ...before.compass,
        catchAll: "life-admin" as const,
        catchAllConfirmed: true,
      },
    };
    const [stamped] = stampOwnerPlacement(
      [before],
      [filed],
      "2026-10-05T10:00:00+10:30"
    );
    expect(stamped.compass.catchAllSince).toBe("2026-10-05T10:00:00+10:30");
    // Unrelated edits leave the record untouched.
    const same = [task()];
    expect(stampOwnerPlacement(same, same, "x")).toBe(same);
  });

  it("flags Life Admin open more than 14 days from when it was filed", () => {
    const old = task({
      compass: {
        ...task().compass,
        catchAll: "life-admin",
        catchAllConfirmed: true,
        catchAllSince: "2026-10-01T09:00:00+10:30",
      },
    });
    const recent = task({
      id: "new",
      compass: {
        ...task().compass,
        catchAll: "life-admin",
        catchAllConfirmed: true,
        catchAllSince: "2026-10-14T09:00:00+10:30",
      },
    });
    const watch = catchAllWatch([old, recent], at(24 * 16));
    expect(watch.lifeAdminOpen).toBe(2);
    expect(watch.stale.map(s => s.task.id)).toEqual([old.id]);
  });

  it("suggests a project when the same kind of job keeps landing in Life Admin", () => {
    const la = (id: string, title: string) =>
      task({
        id,
        title,
        compass: {
          ...task().compass,
          catchAll: "life-admin",
          catchAllConfirmed: true,
        },
      });
    const groups = recurringLifeAdmin(
      [
        la("1", "Pay council rates"),
        la("2", "Pay water rates"),
        la("3", "Rates notice: pay"),
        la("4", "Buy milk"),
      ],
      at(24)
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].tasks).toHaveLength(3);
  });
});
