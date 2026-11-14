import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTask } from "../../domain/engine";
import type { Project, Task, Workspace } from "../../domain/types";
import TaskCard from "./TaskCard";
import { DatedTodayCard, SortView } from "./SetupViews";

const TODAY = "2026-11-11";
const project = { id: "p1", title: "Ute repairs", status: "active", updatedAt: "2026-11-01" } as Project;

function ws(tasks: Task[]): Workspace {
  return { tasks, projects: [project] } as unknown as Workspace;
}
const faded = (): Task => ({ ...createTask({ title: "Ring the bank", state: "inbox" }), actionConfirmed: false });
const solid = (): Task => ({
  ...createTask({ title: "Call the mechanic", nextAction: "Find the number", state: "ready" }),
  actionConfirmed: true,
  compass: { ...createTask({ title: "x" }).compass, catchAll: "life-admin", catchAllConfirmed: true },
});

describe("TaskCard", () => {
  it("shows a faded card with every dot to do and one-tap choices", () => {
    const task = faded();
    const html = renderToStaticMarkup(<TaskCard task={task} workspace={ws([task])} today={TODAY} onApply={() => true} />);
    expect(html).toContain("is-faded");
    expect(html).toContain("Not ready · Needs Action, Place and First step.");
    expect(html).toContain("It&#x27;s an action");
    expect(html).toContain("Ute repairs");
    expect(html).toContain("Life Admin");
    expect(html).toContain("Erosion Guard");
    expect(html).toContain("Title is the step");
    expect(html).toContain("No date");
    expect(html).toContain("0 of 3 set");
  });

  it("shows a solid card once all three dots are lit", () => {
    const task = solid();
    const html = renderToStaticMarkup(<TaskCard task={task} workspace={ws([task])} today={TODAY} onApply={() => true} more={<p>Notes here</p>} />);
    expect(html).toContain("is-solid");
    expect(html).toContain(">Ready<");
    expect(html).toContain("3 of 3 set");
    expect(html).toContain("<summary>More</summary>");
    expect(html).not.toContain("<details class=\"task-card-more\" open");
  });
});

describe("Sort, Ideas and Today", () => {
  it("Sort shows the first faded card and Skip / Done", () => {
    const html = renderToStaticMarkup(
      <SortView workspace={ws([faded(), solid()])} today={TODAY} readOnly={false} onApply={() => true} onFinish={() => {}} />
    );
    expect(html).toContain("1 of 1");
    expect(html).toContain("Ring the bank");
    expect(html).not.toContain("Call the mechanic");
    expect(html).toContain("Skip");
    expect(html).toContain("Done");
  });

  it("Sort says when there is nothing to sort", () => {
    const html = renderToStaticMarkup(<SortView workspace={ws([solid()])} today={TODAY} readOnly={false} onApply={() => true} onFinish={() => {}} />);
    expect(html).toContain("Nothing to sort");
  });

  it("dated tasks always show on Today, with Set up on faded ones", () => {
    const a = { ...faded(), deadline: TODAY };
    const b = { ...solid(), schedule: { ...solid().schedule, date: "2026-11-10" } };
    const html = renderToStaticMarkup(<DatedTodayCard tasks={[a, b]} today={TODAY} onOpen={() => {}} />);
    expect(html).toContain("Dated for today or overdue (2)");
    expect(html).toContain("Deadline today");
    expect(html).toContain("(overdue)");
    expect(html.match(/Set up/g)).toHaveLength(1);
  });
});
