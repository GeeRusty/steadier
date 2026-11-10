import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTask } from "../../domain/engine";
import { emptyTaskSchedule } from "../../domain/time";
import type { Place, Task } from "../../domain/types";
import TaskViewPanel from "./TaskViewPanel";

vi.mock("../ui/dialog", async () => {
  const ReactModule = await import("react");
  const Wrapper = ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) => ReactModule.createElement("div", { className }, children);
  return {
    Dialog: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    DialogContent: Wrapper,
    DialogDescription: Wrapper,
    DialogTitle: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
      ReactModule.createElement("h2", { className }, children),
  };
});

const TODAY = "2026-11-09";
const noop = () => false;

function fixtureTask(
  id: string,
  title: string,
  createdAt: string,
  extra: Partial<Task> = {}
): Task {
  return {
    ...createTask({ title }, TODAY),
    id,
    title,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  };
}

function renderPanel(task: Task, tasks: Task[], places: Place[] = []) {
  const actions = {
    onClose: vi.fn(),
    onEdit: vi.fn(),
    onOpenTask: vi.fn(),
    onDone: vi.fn(),
    onReopen: vi.fn(),
    onCompleteSubtask: vi.fn(),
    onConfirmSuggestion: vi.fn(),
    onDismissSuggestion: vi.fn(),
    onConfirmAll: vi.fn(),
    onRead: vi.fn(),
  };
  const html = renderToStaticMarkup(
    <TaskViewPanel
      task={task}
      tasks={tasks}
      places={places}
      today={TODAY}
      projectTitle="Synthetic project"
      {...actions}
    />
  );
  return { html, actions };
}

describe("TaskViewPanel", () => {
  it("shows saved timing and notes, ordered subtasks, and explicit suggested-link actions without writing on open", () => {
    const parent = fixtureTask(
      "synthetic-parent",
      "Synthetic paint task",
      "2026-11-01T08:00:00+10:30",
      {
        state: "ready",
        notes: "Synthetic paint notes.\nKeep the area ventilated.",
        schedule: {
          ...emptyTaskSchedule(),
          date: TODAY,
          time: "08:59",
          minutes: 45,
          fixed: true,
        },
      }
    );
    const suggested = fixtureTask(
      "synthetic-suggested-child",
      "Suggested clean-up step",
      "2026-11-03T08:00:00+10:30",
      { parent: { id: parent.id, suggested: true } }
    );
    const first = fixtureTask(
      "synthetic-first-child",
      "First prep step",
      "2026-11-02T08:00:00+10:30",
      { parent: { id: parent.id, suggested: false } }
    );
    const { html, actions } = renderPanel(parent, [parent, suggested, first]);

    expect(html).toContain("Synthetic paint task");
    expect(html.toLowerCase()).toContain("8:59 am");
    expect(html).toContain("45 min");
    expect(html).toContain("Synthetic paint notes.");
    expect(html).toContain("Keep the area ventilated.");
    expect(html).toContain("No next action yet. Add one small physical step in Edit.");
    expect(html).toContain("task-view-sticky-actions");
    expect(html).toContain('aria-label="Task actions"');
    expect(html.indexOf("First prep step")).toBeLessThan(
      html.indexOf("Suggested clean-up step")
    );
    expect(html).toContain('aria-label="Open subtask First prep step"');
    expect(html).toContain("Suggested");
    expect(html).toContain("Confirm all");
    expect(html).toContain("Confirm");
    expect(html).toContain("Dismiss");
    expect(html).toContain("Edit");
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(actions.onOpenTask).not.toHaveBeenCalled();
    expect(actions.onCompleteSubtask).not.toHaveBeenCalled();
    expect(actions.onConfirmSuggestion).not.toHaveBeenCalled();
    expect(actions.onDismissSuggestion).not.toHaveBeenCalled();
    expect(actions.onConfirmAll).not.toHaveBeenCalled();
    expect(actions.onDone).not.toHaveBeenCalled();
    expect(actions.onReopen).not.toHaveBeenCalled();
  });

  it("shows Maps directions for a saved Place and no map action for an unplaced task", () => {
    const place: Place = {
      id: "synthetic-place",
      name: "Synthetic Bunnings",
      address: "123 Synthetic Road, Adelaide",
      lat: -34.9285,
      lng: 138.6007,
      radius: 150,
    };
    const task = fixtureTask(
      "synthetic-place-task",
      "Buy synthetic screws",
      "2026-11-01T08:00:00+10:30",
      { placeId: place.id }
    );
    const placed = renderPanel(task, [task], [place]);

    expect(placed.html).toContain("123 Synthetic Road, Adelaide");
    expect(placed.html).toContain(
      'aria-label="Open directions to Synthetic Bunnings in Google Maps"'
    );
    expect(placed.html).toContain(
      'href="https://www.google.com/maps/dir/?api=1&amp;destination=-34.9285%2C138.6007"'
    );
    expect(placed.html).toContain('target="_blank"');
    expect(placed.html).toContain('rel="noopener noreferrer"');
    expect(placed.actions.onDone).not.toHaveBeenCalled();

    const unplaced = renderPanel(task, [task]);
    expect(unplaced.html).not.toContain("Open directions to Synthetic Bunnings");
    expect(unplaced.html).not.toContain("task-view-map-link");
  });

  it("reflects a completed task as checked and reopenable, and gives a subtask a parent return link", () => {
    const parent = fixtureTask(
      "synthetic-parent",
      "Synthetic parent",
      "2026-11-01T08:00:00+10:30"
    );
    const completedChild = fixtureTask(
      "synthetic-completed-child",
      "Completed synthetic subtask",
      "2026-11-02T08:00:00+10:30",
      {
        state: "done",
        completedAt: "2026-11-08T13:00:00+10:30",
        parent: { id: parent.id, suggested: false },
      }
    );
    const staleSelectedSnapshot = { ...completedChild, state: "ready" as const, completedAt: null };
    const { html, actions } = renderPanel(staleSelectedSnapshot, [parent, completedChild]);

    expect(html).toContain('aria-label="Back to parent task Synthetic parent"');
    expect(html).toContain('aria-label="Unmark Completed synthetic subtask as done"');
    expect(html).toMatch(/type="checkbox"[^>]*aria-label="Unmark Completed synthetic subtask as done"[^>]*checked=""/);
    expect(html).not.toContain('disabled=""');
    expect(html).toContain("Uncheck Done to reopen this task.");
    expect(html).toContain("Edit");
    expect(actions.onOpenTask).not.toHaveBeenCalled();
    expect(actions.onDone).not.toHaveBeenCalled();
    expect(actions.onReopen).not.toHaveBeenCalled();
  });

  it("labels a fixed date without a clock time as a booked all-day anchor", () => {
    const allDay = fixtureTask(
      "synthetic-all-day-anchor",
      "Synthetic all-day anchor",
      "2026-11-01T08:00:00+10:30",
      {
        schedule: {
          ...emptyTaskSchedule(),
          date: TODAY,
          fixed: true,
        },
      }
    );
    const { html } = renderPanel(allDay, [allDay]);

    expect(html).toContain("Booked all-day");
    expect(html).toContain("no fixed clock time");
    expect(html).not.toContain("Planned · Today");
  });
});
