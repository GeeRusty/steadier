import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import TaskDetailDoneControl from "./TaskDetailDoneControl";

describe("shared task-detail Done control", () => {
  it("shows a compact, accessible unchecked Done box for an open task", () => {
    const onChange = vi.fn();
    const markup = renderToStaticMarkup(
      <TaskDetailDoneControl
        taskTitle="Synthetic weekend task"
        checked={false}
        onChange={onChange}
      />
    );

    expect(markup).toContain('class="task-pane-done-control"');
    expect(markup).toContain('class="task-pane-done-tick"');
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('aria-label="Mark Synthetic weekend task done"');
    expect(markup).toContain(">Done</span>");
    expect(markup).not.toContain("checked=");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reflects a saved completed task as checked and labels the available reopen action", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailDoneControl
        taskTitle="Synthetic completed task"
        checked
        onChange={() => undefined}
      />
    );

    expect(markup).toContain('aria-label="Unmark Synthetic completed task as done"');
    expect(markup).toContain('checked=""');
    expect(markup).not.toContain('disabled=""');
  });

  it("forwards completion only from an explicit checkbox change", () => {
    const onChange = vi.fn();
    const element = TaskDetailDoneControl({
      taskTitle: "Synthetic open task",
      checked: false,
      onChange,
    });
    const label = element.props.children[0];
    const input = label.props.children[0];

    expect(onChange).not.toHaveBeenCalled();
    input.props.onChange({ currentTarget: { checked: true } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
