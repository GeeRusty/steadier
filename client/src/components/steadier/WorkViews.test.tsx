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
      area=""
      filter={filter}
      onSearch={() => undefined}
      onArea={() => undefined}
      onFilter={() => undefined}
      onOpen={() => undefined}
      onStart={() => undefined}
      onDone={() => undefined}
      onReview={() => undefined}
      onAdd={() => undefined}
    />
  );
}

describe("All Work task-row completion control", () => {
  it("shows a visible Done checkbox on Past due rows", () => {
    const markup = renderWorkViews("pastdue");
    expect(markup).toContain('class="work-row-done-tick"');
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('aria-label="Mark Synthetic workflow task done"');
    expect(markup).toContain(">Done</span>");
    expect(markup).not.toContain("completion-button");
  });

  it("shows the same Done checkbox in the Workflow filter", () => {
    const markup = renderWorkViews("ready");
    expect(markup).toContain('class="work-row-done-tick"');
    expect(markup).toContain('aria-label="Mark Synthetic workflow task done"');
    expect(markup).toContain('aria-label="Open task Synthetic workflow task"');
    expect(markup).toContain("View task details");
    expect(markup).toContain("Use the separate Done tick to complete it.");
    expect(markup).toContain("Filter by workflow");
  });
});
