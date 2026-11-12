import { describe, expect, it } from "vitest";
import { emptyWorkspace } from "../../../server/steadier/validation";
import { createTask } from "./engine";
import { emptyTaskSchedule } from "./time";
import {
  keepGoing,
  removePrerequisites,
  slippedAgainUntouched,
  taskChips,
  todayPlan,
  todayTaskIds,
} from "./todayPlan";
import type { Task, Workspace } from "./types";

const DAY = "2026-11-12";
const STAMP = "2026-11-12T10:00:00+10:30";

function booked(title: string, time: string | null, minutes = 60, extra: Partial<Task> = {}): Task {
  const t = createTask({ title, state: "ready", nextAction: "Do it", actionConfirmed: true } as Partial<Task> & { title: string });
  return {
    ...t,
    schedule: { ...emptyTaskSchedule(), date: DAY, time, minutes, fixed: time !== null },
    ...extra,
  };
}

function ws(tasks: Task[], extra: Partial<Workspace> = {}): Workspace {
  const w = emptyWorkspace();
  return { ...w, tasks, ...extra };
}

const at = (h: number, m = 0) => h * 60 + m;

describe("Today: Now · Next · Later, by time only", () => {
  const a = booked("Gutter clean", "09:30", 90);
  const b = booked("Ring council", "11:30", 30);
  const c = booked("Pick up trailer", "13:00", 30);
  const d = booked("Site meeting", "15:30", 60);
  const dated = { ...booked("Car rego", null), deadline: DAY };
  const undated = createTask({ title: "Someday-ish thing", state: "ready" });

  it("Now is the running block; Next the next booking; Later the rest; undated never shows", () => {
    const plan = todayPlan(ws([d, c, dated, a, b, undated]), [d, c, dated, a, b, undated], DAY, at(10, 24));
    expect(plan.now?.task.title).toBe("Gutter clean");
    expect(plan.now?.mode).toBe("block");
    expect(plan.next?.task.title).toBe("Ring council");
    expect(plan.later.map(r => r.task.title)).toEqual(["Pick up trailer", "Site meeting", "Car rego"]);
    const ids = todayTaskIds(plan);
    expect(ids.has(undated.id)).toBe(false);
    // One thing, once.
    expect(ids.size).toBe(5);
  });

  it("Next is your chosen Next thing when set", () => {
    const pick = createTask({ title: "Chosen thing", state: "ready", nextAction: "Open it" });
    const plan = todayPlan(
      ws([a, b, pick], { nextThing: { taskId: pick.id, when: "after smoko", date: DAY, updatedAt: STAMP } }),
      [a, b, pick],
      DAY,
      at(10)
    );
    expect(plan.now?.task.id).toBe(a.id);
    expect(plan.next?.task.id).toBe(pick.id);
    expect(plan.next?.when).toBe("after smoko");
    expect(plan.later.map(r => r.task.id)).toContain(b.id);
  });

  it("with nothing booked now, Now is the chosen Next thing with Start", () => {
    const pick = createTask({ title: "Chosen thing", state: "ready", nextAction: "Open it" });
    const plan = todayPlan(
      ws([b, pick], { nextThing: { taskId: pick.id, when: "", date: DAY, updatedAt: STAMP } }),
      [b, pick],
      DAY,
      at(8)
    );
    expect(plan.now).toMatchObject({ mode: "next" });
    expect(plan.now?.task.id).toBe(pick.id);
    expect(plan.next?.task.id).toBe(b.id);
  });

  it("with nothing running or chosen, Now is the next booking, 'up next in X min'", () => {
    const plan = todayPlan(ws([b, c]), [b, c], DAY, at(11, 18));
    expect(plan.now).toMatchObject({ mode: "upnext", minutesUntil: 12 });
    expect(plan.now?.task.id).toBe(b.id);
    expect(plan.next?.task.id).toBe(c.id);
  });

  it("a block past its finish is slipped, not Now", () => {
    const plan = todayPlan(ws([a, b]), [a, b], DAY, at(11, 10));
    expect(plan.now).toMatchObject({ mode: "upnext" });
    expect(plan.now?.task.id).toBe(b.id);
    expect(plan.slipped.map(r => r.task.id)).toEqual([a.id]);
    expect(plan.slipped[0].chips.map(c => c.text)).toContain("slipped");
    expect(plan.slipped[0].again).toBe(false);
  });
});

describe("Slip choices", () => {
  it("Keep going stretches today's block and records it; a second slip is 'again'", () => {
    const a = booked("Gutter clean", "09:30", 90);
    const kept = keepGoing(a, DAY, at(11, 10), at(11, 0), `${DAY}T11:10:00+10:30`);
    expect(kept.schedule.minutes).toBe(at(11, 25) - at(9, 30));
    expect(kept.history.at(-1)!.text).toMatch(/^Slipped: kept going — block now ends 11:25/);
    // Still running at 11:20.
    expect(todayPlan(ws([kept]), [kept], DAY, at(11, 20)).now?.task.id).toBe(a.id);
    // Slips again at 11:40.
    const later = todayPlan(ws([kept]), [kept], DAY, at(11, 40));
    expect(later.slipped[0].again).toBe(true);
    expect(slippedAgainUntouched([kept], null, DAY, at(11, 40)).map(t => t.id)).toEqual([a.id]);
    // Touching it afterwards takes it off the review list.
    const touched = { ...kept, history: [...kept.history, { at: STAMP, text: "Rescheduled to tomorrow." }] };
    expect(slippedAgainUntouched([touched], null, DAY, at(11, 40))).toEqual([]);
  });

  it("Remove prerequisite only removes the unfinished links you chose", () => {
    const pre = createTask({ title: "Buy downpipe", state: "ready" });
    const a = booked("Fit downpipe", "14:00", 60, { dependencies: [pre.id] });
    const plan = todayPlan(ws([a, pre]), [a, pre], DAY, at(9));
    const row = [plan.now, plan.next, ...plan.later].find(r => r?.task.id === a.id)!;
    expect(row.blockedBy.map(t => t.title)).toEqual(["Buy downpipe"]);
    const freed = removePrerequisites(a, [pre.id], ["Buy downpipe"], STAMP);
    expect(freed.dependencies).toEqual([]);
    expect(freed.history.at(-1)!.text).toBe("Prerequisite removed: Buy downpipe.");
  });
});

describe("Chips: only what's off normal, max two, grey unless it clashes", () => {
  it("on track shows nothing", () => {
    const a = booked("Gutter clean", "09:30", 60);
    expect(taskChips(a, { day: DAY, minute: at(9), lastReviewDate: null })).toEqual([]);
  });

  it("moved 3× and overdue are grey; at most two", () => {
    const t = {
      ...booked("Old job", null),
      deadline: "2026-11-10",
      reviewDate: "2026-11-11",
      history: [1, 2, 3].map(i => ({ at: STAMP, text: `Rescheduled (${i}).` })),
    };
    const chips = taskChips(t, { day: DAY, minute: at(9), lastReviewDate: null });
    expect(chips.map(c => c.text)).toEqual(["overdue 2d", "moved 3×"]);
    expect(chips.every(c => !c.red)).toBe(true);
  });

  it("a block that runs into the next fixed booking clashes in red", () => {
    const a = booked("Long one", "13:00", 150);
    const b = booked("Meeting", "15:00", 60);
    const plan = todayPlan(ws([a, b]), [a, b], DAY, at(9));
    const row = [plan.now, plan.next, ...plan.later].find(r => r?.task.id === a.id)!;
    expect(row.chips[0]).toEqual({ kind: "clash", text: "clashes 3:00", red: true });
  });
});
