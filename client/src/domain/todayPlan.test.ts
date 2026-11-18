import { describe, expect, it } from "vitest";
import { emptyWorkspace } from "../../../server/steadier/validation";
import { createTask } from "./engine";
import { emptyTaskSchedule } from "./time";
import {
  captureAtText,
  keepGoing,
  removePrerequisites,
  slippedAgainUntouched,
  taskChips,
  todayPlan,
  todayTaskIds,
  type TodayPlan,
  type TodayRow,
} from "./todayPlan";
import { parseQuickAdd } from "./quickParse";
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

/** Every row Today shows, once each. */
function rows(plan: TodayPlan): TodayRow[] {
  const all: TodayRow[] = [
    ...plan.now,
    ...(plan.next ? [plan.next] : []),
    ...plan.anyTime,
    ...plan.agenda.flatMap(e => (e.kind === "item" ? [e.row] : [])),
  ];
  return [...new Map(all.map(r => [r.task.id, r])).values()];
}
const kinds = (plan: TodayPlan) =>
  plan.agenda.map(e => (e.kind === "item" ? e.row.task.title : e.kind === "free" ? `free ${e.end - e.start}` : e.kind === "soon" ? `soon ${e.minutesUntil}` : "now"));

describe("Today timeline: Now, Next thing, Any time today, agenda", () => {
  const a = booked("Gutter clean", "09:30", 90);
  const b = booked("Ring council", "11:30", 30);
  const c = booked("Pick up trailer", "13:00", 30);
  const d = booked("Site meeting", "15:30", 60);
  const dated = { ...booked("Car rego", null), deadline: DAY };
  const untimed = booked("Water the pots", null);
  const undated = createTask({ title: "Someday-ish thing", state: "ready" });
  const all = [d, c, dated, a, b, untimed, undated];

  it("Now is only the running block; the agenda is in time order with the now line, Free gaps and 'in X min'", () => {
    const plan = todayPlan(ws(all), all, DAY, at(10, 24));
    expect(plan.now.map(r => [r.task.title, r.mode])).toEqual([["Gutter clean", "block"]]);
    expect(plan.next).toBeNull();
    expect(plan.anyTime.map(r => r.task.title)).toEqual(["Car rego", "Water the pots"]);
    // The now line sits just after the running block.
    expect(kinds(plan)).toEqual(["Gutter clean", "now", "soon 66", "Ring council", "Pick up trailer", "free 120", "Site meeting"]);
    const running = plan.agenda.find(e => e.kind === "item" && e.row.task.id === a.id);
    expect(running).toMatchObject({ nowAt: 54 / 90, past: false });
    const ids = todayTaskIds(plan);
    expect(ids.has(undated.id)).toBe(false);
    expect(ids.size).toBe(6);
  });

  it("nothing running: no Now at all, and the red line sits between bookings", () => {
    const plan = todayPlan(ws(all), all, DAY, at(12, 10));
    expect(plan.now).toEqual([]);
    expect(kinds(plan)).toEqual(["Gutter clean", "Ring council", "now", "soon 50", "Pick up trailer", "free 120", "Site meeting"]);
  });

  it("a gap that holds now counts from now, and only shows over an hour", () => {
    const plan = todayPlan(ws([b, d]), [b, d], DAY, at(14, 0));
    expect(kinds(plan)).toEqual(["Ring council", "now", "free 90", "soon 90", "Site meeting"]);
    const short = todayPlan(ws([b, d]), [b, d], DAY, at(14, 45));
    expect(kinds(short)).toEqual(["Ring council", "now", "soon 45", "Site meeting"]);
  });

  it("before the first booking, the free time from now shows; after the last, nothing", () => {
    expect(kinds(todayPlan(ws([d]), [d], DAY, at(8)))).toEqual(["now", "free 450", "soon 450", "Site meeting"]);
    expect(kinds(todayPlan(ws([d]), [d], DAY, at(18)))).toEqual(["Site meeting", "now"]);
  });

  it("past items fade; done ones stay on the agenda with a filled circle", () => {
    const doneA = { ...a, state: "done" as const };
    const plan = todayPlan(ws([doneA, d]), [doneA, d], DAY, at(12));
    const item = plan.agenda.find(e => e.kind === "item" && e.row.task.id === a.id);
    expect(item).toMatchObject({ done: true, past: true, slipped: false });
    expect(todayTaskIds(plan).has(a.id)).toBe(false);
  });

  it("Next thing is only your choice, labelled with its when; the next booking never fills it", () => {
    const pick = createTask({ title: "Chosen thing", state: "ready", nextAction: "Open it" });
    const plan = todayPlan(
      ws([a, b, pick], { nextThing: { taskId: pick.id, when: "after smoko", date: DAY, updatedAt: STAMP } }),
      [a, b, pick],
      DAY,
      at(10)
    );
    expect(plan.now.map(r => r.task.id)).toEqual([a.id]);
    expect(plan.next).toMatchObject({ when: "after smoko", runningNow: false });
    expect(plan.next?.task.id).toBe(pick.id);
    expect(todayPlan(ws([a, b]), [a, b], DAY, at(8)).next).toBeNull();
  });

  it("a booking and a running focus on a different task both show, each labelled", () => {
    const other = createTask({ title: "Call the bank", state: "ready", nextAction: "Ring" });
    const focus = { taskId: other.id, remaining: 600, duration: 1500, running: true, updatedAt: 0, step: "" };
    const plan = todayPlan(ws([a, other], { focus }), [a, other], DAY, at(10));
    expect(plan.now.map(r => [r.task.title, r.mode])).toEqual([
      ["Gutter clean", "block"],
      ["Call the bank", "focus"],
    ]);
    expect(plan.now[1].focusRunning).toBe(true);
    // Focus on the same task as the booking: one card, marked focus running.
    const same = todayPlan(ws([a], { focus: { ...focus, taskId: a.id } }), [a], DAY, at(10));
    expect(same.now).toHaveLength(1);
    expect(same.now[0]).toMatchObject({ mode: "block", focusRunning: true });
  });

  it("a block past its finish is slipped in the agenda (never faded), not Now", () => {
    const plan = todayPlan(ws([a, b]), [a, b], DAY, at(11, 10));
    expect(plan.now).toEqual([]);
    expect(plan.slipped.map(r => r.task.id)).toEqual([a.id]);
    expect(plan.slipped[0].chips.map(c => c.text)).toContain("slipped");
    expect(plan.slipped[0].again).toBe(false);
    const item = plan.agenda.find(e => e.kind === "item" && e.row.task.id === a.id);
    expect(item).toMatchObject({ slipped: true, past: false });
  });

  it("the week strip runs Monday to Sunday and counts only booked time", () => {
    const thu = { ...booked("Friday job", "10:00", 120), schedule: { ...emptyTaskSchedule(), date: "2026-11-13", time: "10:00", minutes: 120, fixed: true } };
    const plan = todayPlan(ws([a, dated, untimed, thu]), [a, dated, untimed, thu], DAY, at(9));
    expect(plan.week.map(d => d.weekday)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(plan.week[0].date).toBe("2026-11-09");
    expect(plan.week.find(d => d.today)?.date).toBe(DAY);
    expect(plan.week.map(d => d.bookedMinutes)).toEqual([0, 0, 0, 90, 120, 0, 0]);
  });

  it("+ Add on a Free row starts capture at that time, rounded up to 5 minutes", () => {
    expect(captureAtText(at(16, 38))).toBe("today at 4:40pm ");
    expect(captureAtText(at(9, 0))).toBe("today at 9:00am ");
    expect(captureAtText(at(12, 1))).toBe("today at 12:05pm ");
    const parsed = parseQuickAdd(`${captureAtText(at(16, 38))}Call Bev`, DAY, at(16, 38));
    expect(parsed.title).toBe("Call Bev");
    expect(parsed.date).toBe(DAY);
    expect(parsed.time).toBe("16:40");
  });
});

describe("Slip choices", () => {
  it("Keep going stretches today's block and records it; a second slip is 'again'", () => {
    const a = booked("Gutter clean", "09:30", 90);
    const kept = keepGoing(a, DAY, at(11, 10), at(11, 0), `${DAY}T11:10:00+10:30`);
    expect(kept.schedule.minutes).toBe(at(11, 25) - at(9, 30));
    expect(kept.history.at(-1)!.text).toMatch(/^Slipped: kept going — block now ends 11:25/);
    // Still running at 11:20.
    expect(todayPlan(ws([kept]), [kept], DAY, at(11, 20)).now[0]?.task.id).toBe(a.id);
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
    const row = rows(plan).find(r => r.task.id === a.id)!;
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

  it("Leave by shows on a row at a place with a travel allowance, only while it's still ahead", () => {
    const place = { id: "pl", name: "Site", address: "", lat: -34.9, lng: 138.6, radius: 150, travelMinutes: 25 };
    const a = booked("Site meeting", "11:00", 60, { placeId: "pl" });
    const b = booked("Ring council", "13:00", 30, { placeId: "other" });
    const w = ws([a, b], { places: [place] });
    const shown = (m: number) => rows(todayPlan(w, [a, b], DAY, m));
    expect(shown(at(9)).find(r => r.task.id === a.id)!.leaveBy).toBe(at(10, 35));
    expect(shown(at(9)).find(r => r.task.id === b.id)!.leaveBy).toBeNull();
    expect(shown(at(11, 30)).find(r => r.task.id === a.id)?.leaveBy ?? null).toBeNull();
    // The "in X min" row carries the leave by too.
    const soon = todayPlan(w, [a, b], DAY, at(9)).agenda.find(e => e.kind === "soon");
    expect(soon).toMatchObject({ kind: "soon", minutesUntil: 120 });
    expect(soon && soon.kind === "soon" && soon.row.leaveBy).toBe(at(10, 35));
  });

  it("lateness and earliness show only at 10 minutes or more, as on the Calendar Board", () => {
    const a = booked("Gutter clean", "09:30", 60);
    const ctx = { day: DAY, minute: at(9), lastReviewDate: null };
    expect(taskChips(a, ctx, { lateBy: 9 })).toEqual([]);
    expect(taskChips(a, ctx, { earlyBy: 9 })).toEqual([]);
    expect(taskChips(a, ctx, { lateBy: 10 }).map(c => c.text)).toEqual(["⏱ +10m"]);
    expect(taskChips(a, ctx, { earlyBy: 12 }).map(c => c.text)).toEqual(["⏱ −12m"]);
  });

  it("a block that runs into the next fixed booking clashes in red", () => {
    const a = booked("Long one", "13:00", 150);
    const b = booked("Meeting", "15:00", 60);
    const plan = todayPlan(ws([a, b]), [a, b], DAY, at(9));
    const row = rows(plan).find(r => r.task.id === a.id)!;
    expect(row.chips[0]).toEqual({ kind: "clash", text: "clashes 3:00", red: true });
  });
});
