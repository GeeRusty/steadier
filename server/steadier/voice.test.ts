import { describe, expect, it } from "vitest";
import {
  confirmationSpeech,
  interpretMessage,
  proposalFromIntent,
  spokenDate,
  spokenTime,
  type VoiceIntent,
} from "./voice";

const base: VoiceIntent = {
  intent: "add_task",
  title: "Call the mechanic",
  date: "2026-11-12",
  time: "10:00",
  minutes: null,
  remind_minutes_before: 0,
  clarify: null,
};

describe("voice assistant", () => {
  it("turns a valid intent into a proposal", () => {
    expect(proposalFromIntent(base)).toEqual({
      kind: "add_task",
      title: "Call the mechanic",
      date: "2026-11-12",
      time: "10:00",
      minutes: null,
      remindMinutesBefore: 0,
    });
  });

  it("rejects bad values from the model instead of saving them", () => {
    expect(proposalFromIntent({ ...base, title: "  " })).toBeNull();
    expect(proposalFromIntent({ ...base, time: "25:00" })).toBeNull();
    expect(proposalFromIntent({ ...base, date: "next friday" })).toBeNull();
    expect(proposalFromIntent({ ...base, minutes: 2 })).toBeNull();
  });

  it("fills in today when only a time was said", () => {
    const p = proposalFromIntent({ ...base, date: null });
    expect(p?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("reads back exactly what will be saved", () => {
    const today = "2026-11-11";
    expect(confirmationSpeech(proposalFromIntent(base)!, today)).toBe(
      "Add Call the mechanic, tomorrow, at 10 am, with a reminder at the time. Save it?"
    );
    expect(
      confirmationSpeech(
        { kind: "add_task", title: "Uber shift", date: "2026-11-13", time: "16:00", minutes: 240, remindMinutesBefore: 15 },
        today
      )
    ).toBe("Add Uber shift, Friday 13 November, at 4 pm, for 4 hours, with a reminder 15 minutes before. Save it?");
    expect(
      confirmationSpeech(
        { kind: "add_task", title: "Buy milk", date: null, time: null, minutes: null, remindMinutesBefore: null },
        today
      )
    ).toBe("Add Buy milk. Save it?");
  });

  it("speaks times and dates naturally", () => {
    expect(spokenTime("00:30")).toBe("12 30 am");
    expect(spokenTime("12:00")).toBe("12 pm");
    expect(spokenTime("16:45")).toBe("4 45 pm");
    expect(spokenDate("2026-11-11", "2026-11-11")).toBe("today");
    expect(spokenDate("2026-11-12", "2026-11-11")).toBe("tomorrow");
  });

  it("gives Claude the Adelaide date, time and any draft", () => {
    const msg = interpretMessage("make it 5", new Date("2026-11-11T02:30:00Z"), {
      kind: "add_task", title: "Pick up kids", date: "2026-11-11", time: "15:00", minutes: null, remindMinutesBefore: null,
    });
    expect(msg).toContain("Wednesday 2026-11-11, 13:00");
    expect(msg).toContain('"time":"15:00"');
    expect(msg).toContain('They said: "make it 5"');
  });
});

import { buildCalendar } from "../../client/src/domain/calendarModel";
import { parseStrictV2Workspace, emptyWorkspace } from "./validation";
import { planVoiceTask, todaySpeech, whatsNextSpeech } from "./voice";

describe("saving a voice task", () => {
  const now = new Date("2026-11-11T02:30:00Z"); // 1:00 pm in Adelaide
  const workspace = () => {
    const w = emptyWorkspace();
    w.trial.startedAt = "2026-10-01T00:00:00.000Z";
    return w;
  };

  it("creates a booked calendar block with its reminder, as a valid workspace", () => {
    const planned = planVoiceTask(
      workspace(),
      { kind: "add_task", title: "Uber shift", date: "2026-11-11", time: "16:00", minutes: 240, remindMinutesBefore: 15 },
      now
    );
    const saved = parseStrictV2Workspace(planned.workspace);
    const task = saved.tasks.find(t => t.title === "Uber shift")!;
    expect(task.schedule).toMatchObject({ date: "2026-11-11", time: "16:00", minutes: 240, fixed: true });
    expect(task.schedule.reminders).toEqual([expect.objectContaining({ minutesBefore: 15, anchor: "slot" })]);
    const [day] = buildCalendar(saved.tasks, saved.projects, ["2026-11-11"], "2026-11-11", {});
    expect(day.timed.map(i => i.title)).toContain("Uber shift");
    expect(whatsNextSpeech(saved, now)).toBe("Next, Uber shift at 4 pm.");
    expect(todaySpeech(saved, now)).toBe("Still to come today: Uber shift at 4 pm.");
    // 5:30 pm Adelaide, during the 4-8 pm shift: says what is left.
    expect(whatsNextSpeech(saved, new Date("2026-11-11T07:00:00Z"))).toBe("You're on Uber shift, 2 hours 30 minutes to go.");
  });

  it("keeps an untimed task off the calendar", () => {
    const planned = planVoiceTask(
      workspace(),
      { kind: "add_task", title: "Buy milk", date: null, time: null, minutes: null, remindMinutesBefore: null },
      now
    );
    const task = parseStrictV2Workspace(planned.workspace).tasks.find(t => t.title === "Buy milk")!;
    expect(task.schedule.fixed).toBe(false);
    expect(task.schedule.time).toBeNull();
  });
});
