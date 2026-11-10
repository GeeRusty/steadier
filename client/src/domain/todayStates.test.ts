import { describe, expect, it } from "vitest";
import { createTask } from "./engine";
import { validateWorkspace } from "./transfer";
import {
  backupOverdue,
  countLabel,
  heldReason,
  kindContext,
  kindCounts,
  needsClarify,
  suggestionSource,
  taskKind,
} from "./todayStates";
import type { Task, Workspace } from "./types";

const DAY = "2026-10-27";
function task(title: string, extra: Partial<Task> = {}): Task {
  return createTask({ title, createdAt: `${DAY}T09:00:00`, ...extra }, DAY);
}
function base(tasks: Task[], extra: Partial<Workspace> = {}): Workspace {
  return { ...validateWorkspace({ version: 1, tasks, focus: null }), ...extra };
}
function timed(t: Task, time = "10:00"): Task {
  return {
    ...t,
    schedule: { ...t.schedule, date: DAY, time, minutes: 30, fixed: true },
  };
}

describe("four task states (first match wins)", () => {
  it("orders Scheduled → Chosen → Suggested → Held", () => {
    const a = timed(task("Timed and chosen", { nextAction: "Call" }));
    const b = task("Chosen", { nextAction: "Write" });
    const c = task("Suggested", { nextAction: "Read" });
    const d = task("Everything else", { nextAction: "File" });
    const w = base([a, b, c, d], {
      intention: { date: DAY, text: "Steady", taskId: b.id },
    });
    // a is also the intention-free focus task: time still wins.
    const ctx = kindContext(
      { ...w, focus: null },
      {
        items: [{ task: c, kind: "action", reason: "", score: 0 }],
      } as never,
      DAY
    );
    ctx.chosenIds.add(a.id);
    expect(taskKind(a, ctx)).toBe("scheduled");
    expect(taskKind(b, ctx)).toBe("chosen");
    expect(taskKind(c, ctx)).toBe("suggested");
    expect(taskKind(d, ctx)).toBe("held");
    expect(taskKind({ ...d, state: "done" }, ctx)).toBeNull();
  });

  it("only today's intention makes a task Chosen", () => {
    const b = task("Yesterday's pick", { nextAction: "x" });
    const w = base([b], {
      intention: { date: "2026-10-26", text: "Old", taskId: b.id },
    });
    expect(taskKind(b, kindContext(w, null, DAY))).toBe("held");
  });

  it("treats only booked anchors as Scheduled and today's Next thing as Chosen", () => {
    const booked = timed(task("Booked", { nextAction: "Attend" }));
    const unbooked = task("Date recorded, not booked", {
      nextAction: "Start when ready",
      schedule: { ...task("temporary").schedule, date: DAY, time: "10:00" },
    });
    const w = base([booked, unbooked], {
      nextThing: {
        taskId: unbooked.id,
        when: "After breakfast",
        date: DAY,
        updatedAt: `${DAY}T09:00:00+10:30`,
      },
    });
    const ctx = kindContext(w, null, DAY);
    expect(taskKind(booked, ctx)).toBe("scheduled");
    expect(taskKind(unbooked, ctx)).toBe("chosen");
    expect(heldReason({ ...unbooked, id: "not-selected" }, [booked, unbooked])).not.toBe("Scheduled");
  });

  it("a home awaiting Confirm makes the task Suggested", () => {
    const t = task("Filed by Claude", { nextAction: "x" });
    const pending: Task = {
      ...t,
      projectId: "p1",
      compass: { ...t.compass, projectSuggested: true },
      history: [
        ...t.history,
        { at: `${DAY}T09:05:00`, text: "Claude: created task" },
      ],
    };
    const ctx = kindContext({ ...base([]), tasks: [pending] }, null, DAY);
    expect(taskKind(pending, ctx)).toBe("suggested");
    expect(suggestionSource(pending)).toBe("Claude");
    expect(
      suggestionSource({
        ...pending,
        history: [{ at: `${DAY}T09:06:00`, text: "ChatGPT: updated task" }],
      })
    ).toBe("ChatGPT");
    expect(suggestionSource(t)).toBe("Steadier");
  });

  it("counts active = scheduled + chosen, and held", () => {
    const a = timed(task("A", { nextAction: "x" }));
    const b = task("B", { nextAction: "x" });
    const c = task("C", { nextAction: "x" });
    const w = base([a, b, c], {
      intention: { date: DAY, text: "", taskId: b.id },
    });
    const counts = kindCounts(w.tasks, kindContext(w, null, DAY));
    expect(counts).toEqual({ active: 2, suggested: 0, held: 1 });
    expect(countLabel(counts)).toBe("2 active · 1 held");
  });

  it("existing statuses stay, shown as a reason tag on held cards", () => {
    const someday = task("Maybe", { nextAction: "x", state: "someday" });
    const waiting = task("Reply", {
      nextAction: "x",
      state: "waiting",
      waitingFor: "Bob",
    });
    const inbox = task("Unclear");
    const all = [someday, waiting, inbox];
    expect(heldReason(someday, all)).toBe("Someday");
    expect(heldReason(waiting, all)).toBe("Waiting");
    expect(heldReason(inbox, all)).toBe("No next action");
  });
});

describe("backup overdue and clarify prompt", () => {
  const now = new Date("2026-10-27T01:00:00Z");
  it("is overdue when never downloaded or 7+ days ago", () => {
    expect(backupOverdue(null, now)).toBe(true);
    expect(backupOverdue("2026-10-25T10:00:00+10:30", now)).toBe(false);
    expect(backupOverdue("2026-10-19T10:00:00+10:30", now)).toBe(true);
  });
  it("asks to clarify only when no next action is set and not dismissed", () => {
    const t = task("Vague");
    expect(needsClarify(t, new Set())).toBe(true);
    expect(needsClarify(t, new Set([t.id]))).toBe(false);
    expect(needsClarify({ ...t, nextAction: "Ring" }, new Set())).toBe(false);
  });
});
