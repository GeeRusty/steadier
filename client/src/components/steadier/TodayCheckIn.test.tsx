import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTask } from "../../domain/engine";
import type { Task, Workspace } from "../../domain/types";
import TodayCheckIn from "./TodayCheckIn";
import TodayPlanView from "./TodayPlanView";

function task(id: string, createdAt: string, patch: Partial<Task> = {}): Task {
  const base = createTask({ title: `Synthetic ${id}` }, createdAt.slice(0, 10));
  return { ...base, ...patch, id, title: patch.title ?? `Synthetic ${id}`, state: patch.state ?? "ready", createdAt, updatedAt: createdAt };
}

function workspace(tasks: Task[] = []): Workspace {
  return {
    version: 2,
    tasks,
    projects: [],
    focus: null,
    intention: null,
    matrixWeights: { "direction-timely": 1, "direction-sustained": 1, "support-timely": 1, "support-sustained": 1 },
    trial: { startedAt: "2026-10-01T09:00:00+10:30", lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [],
  };
}

// Overdue for placement and dated: the morning check-in asks about it.
const stageThree = task("stage-3", "2026-10-31T00:00:00Z", { title: "Deliver gas heater to Andy", deadline: "2026-11-05" });
const handlers = { onOpenTask: () => true, onCompleteTask: () => true, onOpenProject: () => true, onOpenImperative: () => true };

function render(now: Date, tasks = [stageThree]) {
  return renderToStaticMarkup(
    <TodayCheckIn workspace={workspace(tasks)} revision={1} readOnly={false} now={now} {...handlers} />
  );
}

describe("Today check-in line", () => {
  it("is one line with the first question and no count", () => {
    const html = render(new Date("2026-11-04T08:00:00+10:30"));
    expect(html).toContain('class="tp-checkin-line"');
    expect(html).toContain("Check-in");
    expect(html).toContain("Where should “Deliver gas heater to Andy” live?");
    expect(html).not.toMatch(/\d+ questions?/);
  });

  it("is silent when no question is set: before 08:00, at weekends, or nothing to ask", () => {
    expect(render(new Date("2026-11-04T07:30:00+10:30"))).toBe("");
    expect(render(new Date("2026-11-07T09:00:00+10:30"))).toBe("");
    expect(render(new Date("2026-11-08T09:00:00+10:30"))).toBe("");
    expect(render(new Date("2026-11-04T08:00:00+10:30"), [])).toBe("");
  });

  it("sits above Now, so Now stays on the first screen", () => {
    const html = renderToStaticMarkup(
      <TodayPlanView
        workspace={workspace()}
        tasks={[]}
        readOnly={false}
        attentionCount={0}
        checkIn={<p className="checkin-slot">line</p>}
        onAttention={() => {}}
        onOverview={() => {}}
        onDone={() => true}
        onFinishedEarly={() => true}
        onStart={() => {}}
        onOpenFocus={() => {}}
        onOpen={() => {}}
        onMove={() => {}}
        onDrop={() => true}
        onMutate={() => true}
        onChoose={() => true}
      />
    );
    expect(html.indexOf("checkin-slot")).toBeGreaterThan(-1);
    expect(html.indexOf("checkin-slot")).toBeLessThan(html.indexOf(">Now<"));
  });
});
