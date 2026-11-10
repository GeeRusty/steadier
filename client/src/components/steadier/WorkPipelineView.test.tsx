import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTask } from "../../domain/engine";
import { emptyTaskSchedule } from "../../domain/time";
import type { Task } from "../../domain/types";
import { WorkPipelineTaskRow } from "./WorkPipelineView";

function task(state: Task["state"]): Task {
  const created = createTask(
    { title: "Synthetic Workflow item", state },
    "2026-10-30"
  );
  return {
    ...created,
    id: "synthetic-workflow-task",
    projectId: "synthetic-project",
    schedule: emptyTaskSchedule(),
  };
}

function renderRow(workState: Task["state"]) {
  return renderToStaticMarkup(
    <WorkPipelineTaskRow
      task={task(workState)}
      status={<span>Active</span>}
      onOpen={() => undefined}
      onDone={() => undefined}
    />
  );
}

describe("Workflow task-row Done control", () => {
  it("shows an unchecked labeled checkbox next to a separately tappable task title", () => {
    const markup = renderRow("ready");
    expect(markup).toContain('class="pipeline-task-done-tick"');
    expect(markup).toContain('aria-label="Mark Synthetic Workflow item done"');
    expect(markup).toContain(">Done</span>");
    expect(markup).toContain('class="pipeline-task-open"');
    expect(markup).toContain('aria-label="Open Synthetic Workflow item"');
    expect(markup).not.toContain("checked=");
  });

  it("shows saved completed tasks checked and disabled", () => {
    const markup = renderRow("done");
    expect(markup).toContain('aria-label="Synthetic Workflow item is done"');
    expect(markup).toContain('checked=""');
    expect(markup).toContain('disabled=""');
  });

  it("forwards completion only after an explicit checkbox change", () => {
    const taskItem = task("ready");
    const onDone = vi.fn();
    const element = WorkPipelineTaskRow({
      task: taskItem,
      status: <span>Active</span>,
      onOpen: () => undefined,
      onDone,
    });
    const children = element.props.children as React.ReactElement[];
    const label = children[0] as React.ReactElement<{
      children: React.ReactElement[];
    }>;
    const input = label.props.children[0] as React.ReactElement<{
      onChange: (event: unknown) => void;
    }>;

    expect(onDone).not.toHaveBeenCalled();
    input.props.onChange({ currentTarget: { checked: true } });
    expect(onDone).toHaveBeenCalledWith("synthetic-workflow-task");
  });
});
