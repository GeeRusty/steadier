import { describe, expect, it } from "vitest";
import { buildCalendar } from "../../client/src/domain/calendarModel";
import type { Workspace } from "../../client/src/domain/types";
import { emptyWorkspace, parseStrictV2Workspace } from "./validation";
import {
  confirmationSpeech,
  interpretMessage,
  planVoiceProposal,
  proposalFromIntent,
  spokenDate,
  spokenIdea,
  spokenTime,
  todaySpeech,
  whatsNextSpeech,
  type Proposal,
  type VoiceIntent,
} from "./voice";

const TODAY = "2026-11-11";
const NOW = new Date("2026-11-11T02:30:00Z"); // Wednesday 1:00 pm in Adelaide

const intent = (over: Partial<VoiceIntent>): VoiceIntent => ({
  intent: "unclear",
  tasks: [],
  task_id: null,
  new_date: null,
  new_time: null,
  new_minutes: null,
  shopping_list: null,
  shopping_items: [],
  idea_title: null,
  idea_note: null,
  note_text: null,
  note_date: null,
  help_question: null,
  clarify: null,
  ...over,
});

function workspace(): Workspace {
  const w = emptyWorkspace();
  w.trial.startedAt = "2026-10-01T00:00:00.000Z";
  return w;
}

/** A workspace that already holds the given proposal's changes. */
function apply(w: Workspace, p: Proposal, now = NOW): Workspace {
  return parseStrictV2Workspace(planVoiceProposal(w, p, now).workspace);
}

function withTasks(...titles: string[]): Workspace {
  return apply(workspace(), {
    kind: "add_tasks",
    tasks: titles.map(title => ({ title, date: null, time: null, minutes: null, remindMinutesBefore: null })),
  });
}

describe("voice: adding tasks", () => {
  it("turns one spoken task into a proposal and reads it back exactly", () => {
    const outcome = proposalFromIntent(
      intent({
        intent: "add_tasks",
        tasks: [{ title: "Call the mechanic", date: "2026-11-12", time: "10:00", minutes: null, remind_minutes_before: 0 }],
      }),
      null,
      TODAY
    );
    expect(outcome).toEqual({
      proposal: {
        kind: "add_tasks",
        tasks: [{ title: "Call the mechanic", date: "2026-11-12", time: "10:00", minutes: null, remindMinutesBefore: 0 }],
      },
    });
    expect(confirmationSpeech((outcome as { proposal: Proposal }).proposal, TODAY)).toBe(
      "Add Call the mechanic, tomorrow, at 10 am, with a reminder at the time. Save it?"
    );
  });

  it("splits a brain dump into several tasks and reads them all back", () => {
    const outcome = proposalFromIntent(
      intent({
        intent: "add_tasks",
        tasks: [
          { title: "Call mum", date: null, time: null, minutes: null, remind_minutes_before: null },
          { title: "Buy dog food", date: "2026-11-12", time: null, minutes: null, remind_minutes_before: null },
          { title: "Uber shift", date: "2026-11-13", time: "16:00", minutes: 240, remind_minutes_before: 15 },
        ],
      }),
      null,
      TODAY
    ) as { proposal: Proposal };
    expect(confirmationSpeech(outcome.proposal, TODAY)).toBe(
      "I heard 3 things. Call mum. Buy dog food, tomorrow. Uber shift, Friday 13 November, at 4 pm, for 4 hours, with a reminder 15 minutes before. Save all 3?"
    );
    const saved = apply(workspace(), outcome.proposal);
    expect(saved.tasks.map(t => t.title)).toEqual(["Call mum", "Buy dog food", "Uber shift"]);
  });

  it("drops bad values from the model instead of saving them", () => {
    const bad = proposalFromIntent(
      intent({
        intent: "add_tasks",
        tasks: [
          { title: "  ", date: null, time: null, minutes: null, remind_minutes_before: null },
          { title: "Late", date: TODAY, time: "25:00", minutes: null, remind_minutes_before: null },
        ],
      }),
      null,
      TODAY
    );
    expect(bad).toEqual({ problem: "What should I call the task?" });
  });

  it("creates a booked calendar block with its reminder", () => {
    const saved = apply(workspace(), {
      kind: "add_tasks",
      tasks: [{ title: "Uber shift", date: TODAY, time: "16:00", minutes: 240, remindMinutesBefore: 15 }],
    });
    const task = saved.tasks.find(t => t.title === "Uber shift")!;
    expect(task.schedule).toMatchObject({ date: TODAY, time: "16:00", minutes: 240, fixed: true });
    expect(task.schedule.reminders).toEqual([expect.objectContaining({ minutesBefore: 15, anchor: "slot" })]);
    const [day] = buildCalendar(saved.tasks, saved.projects, [TODAY], TODAY, {});
    expect(day.timed.map(i => i.title)).toContain("Uber shift");
    expect(whatsNextSpeech(saved, NOW)).toBe("Next, Uber shift at 4 pm.");
    expect(todaySpeech(saved, NOW)).toBe("Still to come today: Uber shift at 4 pm.");
    // 5:30 pm Adelaide, during the 4-8 pm shift: says what is left.
    expect(whatsNextSpeech(saved, new Date("2026-11-11T07:00:00Z"))).toBe("You're on Uber shift, 2 hours 30 minutes to go.");
  });
});

describe("voice: done and move", () => {
  it("marks the matching task done, using the saved title", () => {
    const w = withTasks("Call the mechanic", "Buy milk");
    const id = w.tasks[0].id;
    const outcome = proposalFromIntent(intent({ intent: "mark_done", task_id: id }), w, TODAY) as { proposal: Proposal };
    expect(confirmationSpeech(outcome.proposal, TODAY)).toBe("Mark Call the mechanic as done?");
    const saved = apply(w, outcome.proposal);
    expect(saved.tasks.find(t => t.id === id)!.state).toBe("done");
    expect(saved.tasks.find(t => t.title === "Buy milk")!.state).not.toBe("done");
  });

  it("asks again when the task id doesn't match an open task", () => {
    const w = withTasks("Call the mechanic");
    expect(proposalFromIntent(intent({ intent: "mark_done", task_id: "made-up" }), w, TODAY)).toEqual({
      problem: "I couldn't tell which task you mean. Say its name again?",
    });
  });

  it("moves a task to a new day and time as a booked block", () => {
    const w = withTasks("Make a coffee");
    const id = w.tasks[0].id;
    const outcome = proposalFromIntent(
      intent({ intent: "move_task", task_id: id, new_date: "2026-11-12", new_time: "09:00" }),
      w,
      TODAY
    ) as { proposal: Proposal };
    expect(confirmationSpeech(outcome.proposal, TODAY)).toBe("Move Make a coffee to tomorrow at 9 am?");
    const task = apply(w, outcome.proposal).tasks.find(t => t.id === id)!;
    expect(task.schedule).toMatchObject({ date: "2026-11-12", time: "09:00", fixed: true });
  });

  it("won't move a repeating task by voice", () => {
    const w = withTasks("Bins out");
    w.tasks[0].schedule.repeat = { freq: "weekly", interval: 1, weekdays: [2], monthDay: null, nthWeekday: null, until: null, count: null } as never;
    const outcome = proposalFromIntent(
      intent({ intent: "move_task", task_id: w.tasks[0].id, new_date: "2026-11-12", new_time: null }),
      w,
      TODAY
    );
    expect(outcome).toEqual({ problem: "Bins out repeats, so move it in the app to choose which ones change." });
  });
});

describe("voice: lists", () => {
  it("adds items to a new Shopping list's run, then to the same run next time", () => {
    const first = proposalFromIntent(intent({ intent: "shopping_add", shopping_items: ["eggs", "bread", "milk"] }), workspace(), TODAY) as {
      proposal: Proposal;
    };
    expect(confirmationSpeech(first.proposal, TODAY)).toBe("Add eggs, bread and milk to the Shopping list?");
    const saved = apply(workspace(), first.proposal);
    expect(saved.lists!.templates).toHaveLength(1);
    expect(saved.lists!.runs).toHaveLength(1);
    expect(saved.lists!.runs[0].extras.map(i => i.text)).toEqual(["eggs", "bread", "milk"]);
    // The owner said yes, so these are confirmed, not suggestions.
    expect(saved.lists!.runs[0].extras.every(i => !i.suggested)).toBe(true);

    const second = proposalFromIntent(intent({ intent: "shopping_add", shopping_items: ["cheese"] }), saved, TODAY) as { proposal: Proposal };
    const again = apply(saved, second.proposal);
    expect(again.lists!.templates).toHaveLength(1);
    expect(again.lists!.runs).toHaveLength(1);
    expect(again.lists!.runs[0].extras.map(i => i.text)).toEqual(["eggs", "bread", "milk", "cheese"]);
  });

  it("uses a named list, matching its saved name", () => {
    const w = apply(workspace(), { kind: "shopping_add", listTitle: "Hardware", items: ["screws"] });
    const outcome = proposalFromIntent(intent({ intent: "shopping_add", shopping_list: "hardware", shopping_items: ["glue"] }), w, TODAY) as {
      proposal: Proposal;
    };
    expect(confirmationSpeech(outcome.proposal, TODAY)).toBe("Add glue to the Hardware list?");
  });
});

describe("voice: wording and context", () => {
  it("speaks times and dates naturally", () => {
    expect(spokenTime("00:30")).toBe("12 30 am");
    expect(spokenTime("12:00")).toBe("12 pm");
    expect(spokenTime("16:45")).toBe("4 45 pm");
    expect(spokenDate(TODAY, TODAY)).toBe("today");
    expect(spokenDate("2026-11-12", TODAY)).toBe("tomorrow");
  });

  it("gives Claude the Adelaide time, open tasks, list names and any draft", () => {
    const w = apply(withTasks("Pick up kids"), { kind: "shopping_add", listTitle: "Groceries", items: ["eggs"] });
    const msg = interpretMessage(
      "make it 5",
      NOW,
      { kind: "add_tasks", tasks: [{ title: "Pick up kids", date: TODAY, time: "15:00", minutes: null, remindMinutesBefore: null }] },
      w
    );
    expect(msg).toContain("Wednesday 2026-11-11, 13:00");
    expect(msg).toContain(`${w.tasks[0].id} | Pick up kids`);
    expect(msg).toContain("Lists: Groceries");
    expect(msg).toContain('"time":"15:00"');
    expect(msg).toContain('They said: "make it 5"');
  });
});

describe("voice: notes", () => {
  it("saves a note to the Daily Log for today", () => {
    const outcome = proposalFromIntent(intent({ intent: "add_note", note_text: "Car is making a rattling noise" }), workspace(), TODAY) as {
      proposal: Proposal;
    };
    expect(confirmationSpeech(outcome.proposal, TODAY)).toBe("Save a note: Car is making a rattling noise. Save it?");
    const saved = apply(workspace(), outcome.proposal);
    expect(saved.dailyLog).toEqual([expect.objectContaining({ date: TODAY, text: "Car is making a rattling noise" })]);
    expect(saved.tasks).toHaveLength(0);
  });

  it("says the day when the note is about another day", () => {
    const outcome = proposalFromIntent(
      intent({ intent: "add_note", note_text: "Plumber is coming", note_date: "2026-11-12" }),
      workspace(),
      TODAY
    ) as { proposal: Proposal };
    expect(confirmationSpeech(outcome.proposal, TODAY)).toBe("Save a note for tomorrow: Plumber is coming. Save it?");
  });
});

describe("voice: ideas", () => {
  it("puts a spoken idea on Front of Mind after the read-back, as the owner's", () => {
    const outcome = proposalFromIntent(
      intent({ intent: "add_idea", idea_title: "Trailer hire side business", idea_note: "check council rules" }),
      workspace(),
      TODAY
    ) as { proposal: Proposal };
    expect(confirmationSpeech(outcome.proposal, TODAY)).toBe("Add to Front of Mind: Trailer hire side business. Save it?");
    const saved = apply(workspace(), outcome.proposal);
    expect(saved.tasks).toHaveLength(0);
    expect(saved.frontOfMind!.items[0]).toMatchObject({
      text: "Trailer hire side business",
      notes: "check council rules",
      addedBy: "owner",
      claudeLabel: false,
    });
    expect(saved.frontOfMind!.items[0].history.at(-1)!.text).toContain("By voice.");
  });

  it("asks when the idea is empty", () => {
    expect(proposalFromIntent(intent({ intent: "add_idea", idea_title: "  " }), workspace(), TODAY)).toEqual({ problem: "What's the idea?" });
  });

  it("always treats a sentence starting with Idea as an idea", () => {
    expect(spokenIdea("Idea: build a shed")).toBe("build a shed");
    expect(spokenIdea("idea, trailer hire side business.")).toBe("trailer hire side business");
    expect(spokenIdea("an idea learn welding")).toBe("learn welding");
    expect(spokenIdea("ideally call Sam tomorrow")).toBeNull();
    expect(spokenIdea("call Sam about the idea")).toBeNull();
  });
});
