import { emptyProjectCompass, emptyTaskCompass } from "./compass";
import { emptyProjectSchedule, emptyTaskSchedule } from "./time";
import { describe, expect, it } from "vitest";
import { addRecoveryCopy, validateRecoveryCopies } from "./storage";
import {
  createContact,
  deleteContact,
  setContactArchived,
  updateContact,
} from "./people";
import {
  exportBackup,
  exportJSON,
  importTasks,
  parseBackup,
  validateWorkspace,
} from "./transfer";
import type { Project, Task, Workspace } from "./types";

const stamp = "2026-10-24T09:00:00.000Z";

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    area: "Home",
    nextAction: "Take the next physical step.",
    notes: "A retained note.",
    state: "ready",
    important: false,
    pinned: false,
    deadline: null,
    startDate: null,
    reviewDate: "2026-10-31",
    deferredUntil: null,
    estimate: 15,
    context: "anywhere",
    waitingFor: "",
    dependencies: [],
    checklist: [{ id: `${id}-check`, text: "Check this", done: false }],
    repeatDays: null,
    createdAt: stamp,
    updatedAt: stamp,
    completedAt: null,
    history: [{ at: stamp, text: "Created." }],
    purpose: "Keep home working calmly.",
    role: "support",
    pattern: "sustained",
    labelSource: "confirmed",
    projectId: "project-home",
    preparationDate: "2026-10-20",
    preparationSource: "confirmed",
    progressEvidence: "The first physical step was completed.",
    ...patch,
    schedule: patch.schedule ?? emptyTaskSchedule(),
    compass: patch.compass ?? emptyTaskCompass(),
  };
}

function project(id = "project-home"): Project {
  return {
    id,
    title: "Calmer home base",
    purpose: "Support day-to-day life.",
    outcome: "The essential home systems feel held.",
    role: "support",
    pattern: "sustained",
    status: "active",
    milestones: [
      { id: "milestone-one", title: "Choose a first step", done: false },
    ],
    progress: [{ at: stamp, text: "Started with one visible step." }],
    createdAt: stamp,
    updatedAt: stamp,
    schedule: emptyProjectSchedule(),
    compass: emptyProjectCompass(),
  };
}

function workspace(): Workspace {
  const first = task("task-one");
  const second = task("task-two", {
    title: "Follow-on task",
    dependencies: [first.id],
    projectId: null,
    role: null,
    pattern: null,
    labelSource: "unclassified",
    preparationDate: null,
    preparationSource: "suggested",
  });
  first.schedule = {
    date: "2026-10-27",
    time: "15:30",
    minutes: 45,
    fixed: true,
    deadlineTime: "17:00",
    reminders: [
      { id: "r1", minutesBefore: 15, anchor: "slot" },
      { id: "r2", minutesBefore: 1440, anchor: "deadline" },
    ],
    repeat: {
      freq: "monthly",
      interval: 1,
      weekdays: [],
      monthDay: null,
      nthWeekday: { n: 2, weekday: 2 },
      until: "2027-06-30",
      count: null,
    },
    seriesId: "series-1",
    completions: ["2026-09-08"],
    skipped: ["2026-08-11"],
    timeLog: [{ start: "2026-10-20T09:15", minutes: 25, source: "focus" }],
    missedHandled: null,
  };
  second.schedule = { ...emptyTaskSchedule() };
  first.compass = {
    imperativeIds: ["imp-1"],
    catchAll: null,
    catchAllConfirmed: false,
    decision: {
      outcome: "promote",
      at: "2026-10-20T09:00:00",
      by: "owner",
      confirmed: true,
      note: "Weekly review",
    },
    projectSuggested: false,
    imperativesSuggested: true,
    catchAllSince: null,
  };
  second.compass = {
    imperativeIds: [],
    catchAll: "life-admin",
    catchAllConfirmed: false,
    decision: null,
    projectSuggested: false,
    imperativesSuggested: false,
    catchAllSince: "2026-10-20T09:00:00+10:30",
  };
  const proj = project();
  proj.schedule = {
    deadline: "2026-12-20",
    reviewDate: "2026-11-01",
    weeklyBudgetMinutes: 120,
    milestoneDates: [],
  };
  proj.compass = {
    labelsConfirmed: false,
    imperativeIds: ["imp-1"],
    decision: {
      outcome: "sustain",
      at: "2026-10-20T09:00:00",
      by: "claude",
      confirmed: false,
      note: "",
    },
    notionUrl: "https://www.notion.so/Home-move-0123456789abcdef",
  };
  return {
    planning: { dayStart: "07:30", dayEnd: "17:00", bufferMinutes: 5 },
    imperatives: [
      {
        id: "imp-1",
        title: "Keep the family home stable",
        reason: "Lease ends in March",
        status: "active",
        setOn: "2026-10-19",
        retiredOn: null,
        notionUrl: null,
        decision: null,
        history: [
          { at: "2026-10-19T18:00:00", text: "Set in Weekly Reality Review." },
        ],
        createdAt: "2026-10-19T18:00:00",
        updatedAt: "2026-10-19T18:00:00",
      },
    ],
    reviews: [
      {
        id: "rev-1",
        at: "2026-10-19T18:30:00",
        date: "2026-10-19",
        floor: {
          money: { answer: "ok", note: "" },
          action: [{ taskId: "t1", title: "Call agent", answer: "not-yet" }],
          capacity: { answer: "medium", note: "Tired after work" },
        },
        decisions: [
          {
            kind: "imperative",
            id: "imp-1",
            title: "Keep the family home stable",
            outcome: "sustain",
            note: "",
          },
        ],
        imperatives: [{ id: "imp-1", title: "Keep the family home stable" }],
        quietImperatives: [],
        unplacedBefore: 4,
        unplacedAfter: 1,
        notes: "Steady week.",
      },
    ],
    goals: [
      {
        id: "goal-p1",
        level: "pillar",
        title: "Family",
        description: "",
        status: "active",
        parents: [],
        projects: [],
        notionUrl: null,
        history: [{ at: "2026-10-01T09:00:00", text: "Added." }],
        createdAt: "2026-10-01T09:00:00",
        updatedAt: "2026-10-01T09:00:00",
      },
      {
        id: "goal-p2",
        level: "pillar",
        title: "Health",
        description: "",
        status: "active",
        parents: [],
        projects: [],
        notionUrl: null,
        history: [{ at: "2026-10-01T09:00:00", text: "Added." }],
        createdAt: "2026-10-01T09:00:00",
        updatedAt: "2026-10-01T09:00:00",
      },
      {
        id: "goal-v1",
        level: "value-goal",
        title: "A secure home",
        description: "",
        status: "active",
        parents: [
          { id: "goal-p1", confirmed: true },
          { id: "goal-p2", confirmed: false },
        ],
        projects: [],
        notionUrl: null,
        history: [{ at: "2026-10-01T09:00:00", text: "Added." }],
        createdAt: "2026-10-01T09:00:00",
        updatedAt: "2026-10-01T09:00:00",
      },
      {
        id: "goal-o1",
        level: "outcome",
        title: "Settled lease by March",
        description: "",
        status: "active",
        parents: [{ id: "goal-v1", confirmed: true }],
        projects: [{ id: "project-home", confirmed: true }],
        notionUrl: null,
        history: [{ at: "2026-10-01T09:00:00", text: "Added." }],
        createdAt: "2026-10-01T09:00:00",
        updatedAt: "2026-10-01T09:00:00",
      },
    ],
    version: 2,
    tasks: [first, second],
    projects: [proj],
    focus: {
      taskId: first.id,
      duration: 600,
      remaining: 420,
      running: true,
      updatedAt: 1761296400000,
      step: first.nextAction,
    },
    intention: {
      date: "2026-10-24",
      text: "Make one calm, useful move at home.",
      taskId: first.id,
    },
    matrixWeights: {
      "direction-timely": 1,
      "direction-sustained": 3,
      "support-timely": 2,
      "support-sustained": 1,
    },
    trial: { startedAt: stamp, lastExportAt: stamp, lastReviewAt: null },
  };
}

function legacyTask(id = "legacy-task") {
  const full = task(id);
  const {
    schedule: _schedule,
    compass: _compass,
    purpose: _purpose,
    role: _role,
    pattern: _pattern,
    labelSource: _labelSource,
    projectId: _projectId,
    preparationDate: _preparationDate,
    preparationSource: _preparationSource,
    progressEvidence: _progressEvidence,
    ...legacy
  } = full;
  return legacy;
}

describe("v2 backup and migration", () => {
  it("refuses legacy timestamp data that cannot be safely written as a strict v2 document", () => {
    const invalidLegacy = { ...legacyTask(), createdAt: "not-a-timestamp" };
    expect(() =>
      validateWorkspace({ version: 1, tasks: [invalidLegacy], focus: null })
    ).toThrow();
    expect(() =>
      parseBackup(JSON.stringify({ version: 1, tasks: [invalidLegacy] }))
    ).toThrow();
  });
  it("rejects restored emphasis values that the UI and runtime cannot represent", () => {
    const w = workspace();
    expect(() =>
      validateWorkspace({
        ...w,
        matrixWeights: { ...w.matrixWeights, "support-timely": 0.75 },
      })
    ).toThrow();
    expect(() =>
      validateWorkspace({
        ...w,
        matrixWeights: { ...w.matrixWeights, "support-timely": 4 },
      })
    ).toThrow();
  });

  it("round-trips every workspace field and relationship losslessly", () => {
    const source = workspace();
    expect(parseBackup(exportBackup(source))).toEqual(source);
  });

  it("round-trips flexible windows without rewriting legacy fixed schedules", () => {
    const source = workspace();
    source.tasks[1].schedule = {
      ...emptyTaskSchedule(),
      minutes: 120,
      flexibleWindow: {
        startDate: "2026-10-24",
        endDate: "2026-10-25",
      },
    };
    expect(parseBackup(exportBackup(source))).toEqual(source);

    const legacy = workspace();
    expect(legacy.tasks[0].schedule).not.toHaveProperty("flexibleWindow");
    const restoredLegacy = parseBackup(exportBackup(legacy));
    expect(restoredLegacy).toEqual(legacy);
    expect(restoredLegacy.tasks[0].schedule).not.toHaveProperty(
      "flexibleWindow"
    );
  });

  it("preserves People in full backups and rejects extra contact-channel fields", () => {
    const source = workspace();
    const person = {
      id: "person-one",
      name: "Morgan Lee",
      relationship: "Friend",
      context: "Ask about their garden project.",
      lastContactDate: "2026-10-20",
      nextContactDate: "2026-11-03",
      status: "active" as const,
      createdAt: stamp,
      updatedAt: stamp,
    };
    const withPeople = { ...source, people: [person] };
    expect(parseBackup(exportBackup(withPeople))).toEqual(withPeople);
    expect(() =>
      validateWorkspace({
        ...withPeople,
        people: [{ ...person, email: "morgan@example.com" }],
      })
    ).toThrow();
    expect(() =>
      validateWorkspace({
        ...withPeople,
        people: [{ ...person, lastContactDate: "2026-02-30" }],
      })
    ).toThrow();
  });

  it("round-trips renewal descriptions, accepts legacy date-only records and rejects unsupported details", () => {
    const source = workspace();
    const renewal = {
      id: "renewal-one",
      category: "professional-registration" as const,
      renewalDate: "2027-03-15",
      name: "Work registration",
      purpose: "Required for site access",
      notes: "Renew through the usual portal.\nKeep the receipt.",
      createdAt: stamp,
      updatedAt: stamp,
    };
    const withRenewal = { ...source, credentialRenewals: [renewal] };
    expect(parseBackup(exportBackup(withRenewal))).toEqual(withRenewal);
    const legacyRenewal = {
      id: "renewal-legacy",
      category: "licence" as const,
      renewalDate: "2027-06-01",
      createdAt: stamp,
      updatedAt: stamp,
    };
    const legacyWorkspace = {
      ...source,
      credentialRenewals: [legacyRenewal],
    };
    expect(parseBackup(exportBackup(legacyWorkspace))).toEqual(legacyWorkspace);
    expect(validateWorkspace(source)).toEqual(source);
    expect(() =>
      validateWorkspace({
        ...withRenewal,
        credentialRenewals: [{ ...renewal, accountNumber: "not-allowed" }],
      })
    ).toThrow(/unsupported fields/i);
    expect(() =>
      validateWorkspace({
        ...withRenewal,
        credentialRenewals: [{ ...renewal, password: "not-allowed" }],
      })
    ).toThrow(/unsupported fields/i);
    expect(() =>
      validateWorkspace({
        ...withRenewal,
        credentialRenewals: [{ ...renewal, renewalDate: "2027-02-30" }],
      })
    ).toThrow(/calendar date/i);
  });

  it("keeps People lifecycle actions explicit and independent from tasks", () => {
    const source = workspace();
    const input = {
      name: "Morgan Lee",
      relationship: "Friend",
      context: "Ask about their garden project.",
      lastContactDate: null,
      nextContactDate: "2026-11-03",
    };
    const created = createContact(source, input, "person-one", stamp);
    expect(created.people).toHaveLength(1);
    expect(created.tasks).toEqual(source.tasks);
    const updated = updateContact(
      created,
      "person-one",
      { ...input, nextContactDate: "2026-11-10" },
      "2026-10-25T09:00:00+10:30"
    );
    const archived = setContactArchived(
      updated,
      "person-one",
      true,
      "2026-10-25T09:00:00+10:30"
    );
    expect(archived.people?.[0]).toMatchObject({
      nextContactDate: "2026-11-10",
      status: "archived",
    });
    expect(archived.tasks).toEqual(source.tasks);
    expect(deleteContact(archived, "person-one").people).toEqual([]);
  });

  it("round-trips repeat overrides and accepts the earlier optional metadata shape", () => {
    const source = workspace();
    const changed = {
      ...source,
      tasks: source.tasks.map((item, index) =>
        index === 0
          ? {
              ...item,
              schedule: {
                ...item.schedule,
                repeatAnchorDate: "2026-10-26",
                repeatOccurrenceDate: "2026-10-27",
                repeatTime: "15:30",
              },
            }
          : item
      ),
    };
    const earlierShape = {
      ...changed,
      tasks: changed.tasks.map((item, index) => {
        if (index !== 0) return item;
        const { repeatAnchorDate: _repeatAnchorDate, ...schedule } =
          item.schedule;
        return { ...item, schedule };
      }),
    };
    expect(parseBackup(exportBackup(earlierShape))).toEqual(earlierShape);
    expect(parseBackup(exportBackup(changed))).toEqual(changed);
  });

  it("migrates v1 storage and task-only v1 backups without changing IDs or inventing classifications", () => {
    const saved = validateWorkspace({
      version: 1,
      tasks: [legacyTask()],
      focus: null,
    });
    expect(saved).toMatchObject({
      version: 2,
      tasks: [
        {
          id: "legacy-task",
          purpose: "",
          role: null,
          pattern: null,
          labelSource: "unclassified",
          projectId: null,
          preparationDate: null,
          preparationSource: "suggested",
          progressEvidence: "",
          deadline: null,
        },
      ],
      projects: [],
      intention: null,
    });
    expect(
      parseBackup(
        JSON.stringify({ version: 1, tasks: [legacyTask("task-only")] })
      ).tasks[0].id
    ).toBe("task-only");
  });

  it("rejects malformed v2 records and broken project or dependency links atomically", () => {
    const source = workspace();
    expect(() =>
      parseBackup(JSON.stringify({ ...source, extra: true }))
    ).toThrow(/unknown or missing/i);
    expect(() =>
      validateWorkspace({
        ...source,
        tasks: [
          { ...source.tasks[0], projectId: "absent-project" },
          source.tasks[1],
        ],
      })
    ).toThrow(/missing project/i);
    expect(() =>
      validateWorkspace({
        ...source,
        tasks: [
          { ...source.tasks[0], dependencies: ["absent-task"] },
          source.tasks[1],
        ],
      })
    ).toThrow(/unknown dependency/i);
    expect(() =>
      validateWorkspace({
        ...source,
        matrixWeights: {
          ...source.matrixWeights,
          "support-sustained": Number.NaN,
        },
      })
    ).toThrow(/integer between 1 and 3/i);
  });

  it("clones additive tasks with fresh identities while retaining prerequisite topology", () => {
    const source = workspace();
    const imported = importTasks(exportBackup(source), "json", []);
    expect(imported.map(item => item.id)).not.toEqual(
      source.tasks.map(item => item.id)
    );
    expect(imported[1].dependencies).toEqual([imported[0].id]);
    // Task-only import does not manufacture an external project record.
    expect(imported[0].projectId).toBeNull();

    const withKnownProject = importTasks(
      exportBackup(source),
      "json",
      [],
      [project()]
    );
    expect(withKnownProject[0].projectId).toBe("project-home");

    const taskOnly = importTasks(exportJSON(source.tasks), "json", []);
    expect(taskOnly[0]).toMatchObject({
      purpose: source.tasks[0].purpose,
      role: source.tasks[0].role,
      pattern: source.tasks[0].pattern,
      preparationDate: source.tasks[0].preparationDate,
      progressEvidence: source.tasks[0].progressEvidence,
    });
  });
});

describe("local recovery-copy format", () => {
  it("keeps one validated v2 recovery snapshot per day and bounds the list to three", () => {
    const source = workspace();
    const first = addRecoveryCopy(
      [],
      source,
      "2026-10-21T09:00:00.000Z",
      "copy-one"
    );
    const sameDay = addRecoveryCopy(
      first,
      source,
      "2026-10-21T16:00:00.000Z",
      "copy-two"
    );
    expect(sameDay).toBe(first);
    const bounded = ["22", "23", "24"].reduce(
      (copies, day) =>
        addRecoveryCopy(
          copies,
          source,
          `2026-10-${day}T09:00:00.000Z`,
          `copy-${day}`
        ),
      first
    );
    expect(bounded).toHaveLength(3);
    expect(bounded.map(copy => copy.at.slice(0, 10))).toEqual([
      "2026-10-24",
      "2026-10-23",
      "2026-10-22",
    ]);
    expect(validateRecoveryCopies(bounded)).toEqual(bounded);
  });

  it("rejects v1, duplicate-day, and malformed local recovery records", () => {
    const source = workspace();
    const copy = {
      id: "copy-one",
      at: stamp,
      workspace: source,
    };
    expect(() =>
      validateRecoveryCopies([
        copy,
        { ...copy, id: "copy-two", at: "2026-10-24T10:00:00.000Z" },
      ])
    ).toThrow(/different days/i);
    expect(() =>
      validateRecoveryCopies([
        { ...copy, workspace: { version: 1, tasks: [], focus: null } },
      ])
    ).toThrow(/version 2/i);
  });
});
