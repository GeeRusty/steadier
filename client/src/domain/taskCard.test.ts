import { describe, expect, it } from "vitest";
import { createTask, derivedState } from "./engine";
import { isUnplaced } from "./compass";
import { emptyWorkspace, parseStrictV2Workspace } from "../../../server/steadier/validation";
import {
  bringBackIdea,
  cardDots,
  datedForToday,
  ideaToTask,
  ideas,
  isFaded,
  isSetUp,
  letGoIdea,
  notReadyTasks,
  placeChoices,
  setActionConfirmed,
  setFirstStep,
  setPlace,
  setUpReason,
  titleIsStep,
} from "./taskCard";
import type { Project, Task } from "./types";

const STAMP = "2026-11-11T13:00:00+10:30";

function cardTask(title = "Ring the bank"): Task {
  return { ...createTask({ title, state: "inbox" }), actionConfirmed: false };
}

describe("task card dots", () => {
  it("starts faded with no dots lit, and says what is missing", () => {
    const task = cardTask();
    expect(cardDots(task)).toEqual({ action: false, place: false, step: false });
    expect(isSetUp(task)).toBe(false);
    expect(isFaded(task)).toBe(true);
    expect(setUpReason(task)).toBe("Needs Action, Place and First step.");
  });

  it("turns ready only when Action, Place and First step are all lit", () => {
    let task = cardTask();
    task = setActionConfirmed(task, true, STAMP);
    expect(task.state).toBe("inbox");
    task = setPlace(task, { kind: "catch-all", catchAll: "life-admin" }, STAMP);
    expect(task.state).toBe("inbox");
    expect(setUpReason(task)).toBe("Needs First step.");
    task = setFirstStep(task, "Find the account number", STAMP);
    expect(task.state).toBe("ready");
    expect(isFaded(task)).toBe(false);
    expect(task.compass).toMatchObject({ catchAll: "life-admin", catchAllConfirmed: true, catchAllSince: STAMP });
  });

  it("does not need a date to be ready", () => {
    let task = cardTask();
    task = setPlace(task, { kind: "catch-all", catchAll: "erosion-guard" }, STAMP);
    task = titleIsStep(task, STAMP);
    expect(task.nextAction).toBe("Ring the bank");
    expect(task.actionConfirmed).toBe(true);
    expect(task.deadline).toBeNull();
    expect(task.state).toBe("ready");
  });

  it("goes back to faded when a dot is unlit", () => {
    let task = cardTask();
    task = setPlace(task, { kind: "catch-all", catchAll: "life-admin" }, STAMP);
    task = titleIsStep(task, STAMP);
    expect(task.state).toBe("ready");
    task = setFirstStep(task, "", STAMP);
    expect(task.state).toBe("inbox");
  });

  it("places in a project and clears any catch-all", () => {
    const project = { id: "p1", title: "Ute repairs", purpose: "Keep the ute running", status: "active" } as Project;
    let task = setPlace(cardTask(), { kind: "catch-all", catchAll: "life-admin" }, STAMP);
    task = setPlace(task, { kind: "project", projectId: "p1" }, STAMP, undefined, [project]);
    expect(task.projectId).toBe("p1");
    expect(task.compass.catchAll).toBeNull();
    expect(cardDots(task).place).toBe(true);
  });

  it("a suggested place does not light the dot", () => {
    const task = { ...cardTask(), projectId: "p1", compass: { ...cardTask().compass, projectSuggested: true } };
    expect(cardDots(task).place).toBe(false);
  });

  it("derived state follows the dots even when the stored state says ready", () => {
    const task = { ...cardTask(), state: "ready" as const, nextAction: "Do it" };
    expect(derivedState(task, [task])).toBe("inbox");
  });

  it("keeps older tasks (no actionConfirmed) on the old rule", () => {
    const old = createTask({ title: "Old task", nextAction: "Start it" });
    expect(old.actionConfirmed).toBeUndefined();
    expect(old.state).toBe("ready");
    expect(isSetUp(old)).toBe(true);
    expect(derivedState(old, [old])).toBe("ready");
    const oldInbox = createTask({ title: "Old unclear task" });
    expect(isFaded(oldInbox)).toBe(true);
  });

  it("the first card edit on an older task keeps its Action dot lit", () => {
    const old = createTask({ title: "Old task", nextAction: "Start it" });
    const edited = setPlace(old, { kind: "catch-all", catchAll: "life-admin" }, STAMP);
    expect(edited.actionConfirmed).toBe(true);
    expect(edited.state).toBe("ready");
  });

  it("lists only open faded tasks as Not ready", () => {
    const faded = cardTask("Faded");
    const idea = { ...cardTask("Idea"), state: "someday" as const };
    const done = { ...cardTask("Done"), state: "done" as const };
    const dropped = { ...cardTask("Dropped"), droppedAt: STAMP };
    expect(notReadyTasks([faded, idea, done, dropped]).map(t => t.title)).toEqual(["Faded"]);
  });
});

describe("ideas", () => {
  it("never get orphan flags", () => {
    const idea = createTask({ title: "Trailer hire side business", state: "someday" });
    expect(isUnplaced(idea)).toBe(false);
  });

  it("make it a task, let go and bring back", () => {
    const idea = createTask({ title: "Build a shed", state: "someday" });
    expect(ideas([idea])).toHaveLength(1);

    const task = ideaToTask(idea, STAMP);
    expect(task.state).toBe("inbox");
    expect(task.actionConfirmed).toBe(false);
    expect(isFaded(task)).toBe(true);

    const gone = letGoIdea(idea, STAMP);
    expect(gone.droppedAt).toBe(STAMP);
    expect(ideas([gone])).toHaveLength(0);
    const back = bringBackIdea(gone, STAMP);
    expect(ideas([back])).toHaveLength(1);
  });

  it("round-trips actionConfirmed through strict validation", () => {
    const w = emptyWorkspace();
    w.trial.startedAt = "2026-10-01T00:00:00.000Z";
    w.tasks = [{ ...cardTask(), createdAt: "2026-11-11T02:30:00.000Z", updatedAt: "2026-11-11T02:30:00.000Z", history: [] }];
    const parsed = parseStrictV2Workspace(JSON.parse(JSON.stringify(w)));
    expect(parsed.tasks[0].actionConfirmed).toBe(false);
  });
});

describe("Sort and Today helpers", () => {
  it("offers recent projects first", () => {
    const w = emptyWorkspace();
    const p = (id: string, updatedAt: string) => ({ id, title: id, status: "active", updatedAt }) as Project;
    w.projects = [p("old", "2026-01-01"), p("new", "2026-11-01"), { ...p("done", "2026-11-10"), status: "achieved" } as Project];
    w.tasks = [{ ...createTask({ title: "x" }), projectId: "old", updatedAt: "2026-11-11T00:00:00Z" }];
    const choice = placeChoices(w);
    expect(choice.projects.map(x => x.id)).toEqual(["old", "new"]);
    expect(choice.catchAlls).toEqual(["life-admin", "erosion-guard"]);
  });

  it("dates always win: today or overdue, faded or solid", () => {
    const today = "2026-11-11";
    const a = { ...cardTask("Deadline today"), deadline: today };
    const b = { ...cardTask("Planned yesterday"), schedule: { ...cardTask().schedule, date: "2026-11-10" } };
    const c = { ...cardTask("Prep today"), preparationDate: today };
    const d = { ...cardTask("Next week"), deadline: "2026-11-18" };
    const e = { ...cardTask("Idea"), deadline: today, state: "someday" as const };
    expect(datedForToday([a, b, c, d, e], today).map(t => t.title)).toEqual([
      "Deadline today",
      "Planned yesterday",
      "Prep today",
    ]);
  });
});
