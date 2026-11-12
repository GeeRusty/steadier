import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTask } from "../../domain/engine";
import { adelaideClock, emptyTaskSchedule, shiftDays } from "../../domain/time";
import TimingShapeMark from "./TimingShapeMark";

const TODAY = adelaideClock().date;
const STAMP = `${TODAY}T09:00:00+10:30`;

function task(extra: Record<string, unknown> = {}) {
  return createTask(
    {
      title: "Synthetic signal task",
      state: "ready",
      preparationDate: null,
      reviewDate: null,
      deadline: null,
      schedule: emptyTaskSchedule(),
      createdAt: STAMP,
      updatedAt: STAMP,
      ...extra,
    },
    TODAY
  );
}

describe("Status signals (the arrows are gone)", () => {
  it("on track shows nothing", () => {
    expect(renderToStaticMarkup(<TimingShapeMark task={task({ deadline: "2099-01-01" })} />)).toBe("");
  });

  it("off normal shows grey chips only: overdue, moved, review due", () => {
    const t = task({
      deadline: shiftDays(TODAY, -2),
      history: [1, 2, 3].map(i => ({ at: STAMP, text: `Rescheduled (${i}).` })),
    });
    const html = renderToStaticMarkup(<TimingShapeMark task={t} />);
    expect(html).toContain(">overdue 2d<");
    expect(html).toContain(">moved 3×<");
    expect(html).not.toContain("tp-chip--red");
    expect(html).not.toContain("<svg class=\"timing-shape-icon\"");
  });

  it("done and Someday show nothing", () => {
    expect(renderToStaticMarkup(<TimingShapeMark task={task({ state: "done", deadline: shiftDays(TODAY, -5) })} />)).toBe("");
    expect(renderToStaticMarkup(<TimingShapeMark task={task({ state: "someday", deadline: shiftDays(TODAY, -5) })} />)).toBe("");
  });
});
