import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTask } from "../../domain/engine";
import { emptyTaskSchedule } from "../../domain/time";
import WorkViews from "./WorkViews";

vi.mock("./TimeChips", () => ({ default: () => null }));

function renderWorkViews(filter: string) {
  const task = createTask(
    {
      title: "Synthetic workflow task",
      state: "ready",
      schedule: { ...emptyTaskSchedule(), date: "2020-01-01" },
      createdAt: "2020-01-01T09:00:00+10:30",
      updatedAt: "2020-01-01T09:00:00+10:30",
    },
    "2020-01-01"
  );
  return renderToStaticMarkup(
    <WorkViews
      view="all"
      tasks={[task]}
      projects={[]}
      search=""
      filter={filter}
      onSearch={() => undefined}
      onFilter={() => undefined}
      onOpen={() => undefined}
      onStart={() => undefined}
      onDone={() => undefined}
      onReview={() => undefined}
      onAdd={() => undefined}
    />
  );
}

describe("All Work rows (design language)", () => {
  it("has a large round Done circle on Past due rows", () => {
    const markup = renderWorkViews("pastdue");
    expect(markup).toContain('class="wr-tick"');
    expect(markup).toContain('class="wr-circle"');
    expect(markup).toContain('aria-label="Mark Synthetic workflow task done"');
    expect(markup).not.toContain('type="checkbox"');
  });

  it("is silent for normal: no Can start, No deadline, Unclassified or explanations", () => {
    const markup = renderWorkViews("ready");
    expect(markup).toContain('aria-label="Open task Synthetic workflow task"');
    // The filter menu still names states; the rows must not.
    const rows = markup.replace(/<select[\s\S]*?<\/select>/g, "");
    for (const noise of ["Can start", "No deadline", "Unclassified", "View task details", "The whole picture"]) {
      expect(rows).not.toContain(noise);
    }
    expect(markup).toContain('aria-label="What this page shows"');
    expect(markup).toContain("Filter by workflow");
  });

  it("groups unplaced work under No project, sub-grouped", () => {
    const markup = renderWorkViews("");
    expect(markup).toContain("No project");
    expect(markup).not.toContain("No linked Project");
    expect(markup).toContain('class="wr-subgroup">Not placed<');
  });

  it("shows a project's Outcome once, in the group, not on each row", () => {
    const project = {
      id: "p1",
      title: "Van",
      purpose: "",
      outcome: "Van ready for work",
      role: "support",
      pattern: "timely",
      status: "active",
      milestones: [],
      progress: [],
      createdAt: "2020-01-01T09:00:00+10:30",
      updatedAt: "2020-01-01T09:00:00+10:30",
      schedule: { deadline: null, reviewDate: null, weeklyBudgetMinutes: null, milestoneDates: [] },
      compass: { imperativeIds: [], goalIds: [] },
    } as never;
    const tasks = [1, 2].map(i =>
      createTask({ title: `Van task ${i}`, state: "ready", projectId: "p1" } as never, "2020-01-01")
    );
    const markup = renderToStaticMarkup(
      <WorkViews
        view="all"
        tasks={tasks}
        projects={[project]}
        search=""
        filter=""
        onSearch={() => undefined}
        onFilter={() => undefined}
        onOpen={() => undefined}
        onStart={() => undefined}
        onDone={() => undefined}
        onReview={() => undefined}
        onAdd={() => undefined}
      />
    );
    expect(markup.split("Van ready for work").length - 1).toBe(1);
  });
});
