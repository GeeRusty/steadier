import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTask } from "../../domain/engine";
import { adelaideClock, emptyTaskSchedule } from "../../domain/time";
import TimingShapeMark from "./TimingShapeMark";

const TODAY = adelaideClock().date;
const STAMP = `${TODAY}T09:00:00+10:30`;

describe("TimingShapeMark", () => {
  it("exposes a neutral symbol with an accessible live-status description", () => {
    const task = createTask(
      {
        title: "Synthetic mark task",
        state: "ready",
        preparationDate: null,
        reviewDate: null,
        deadline: "2099-01-01",
        schedule: emptyTaskSchedule(),
        createdAt: STAMP,
        updatedAt: STAMP,
      },
      TODAY
    );
    const html = renderToStaticMarkup(<TimingShapeMark task={task} />);
    expect(html).toContain('role="img"');
    expect(html).toMatch(
      /aria-label="Timing shape: On track\. No booked timing commitment; last recorded movement was \d+ days ago\."/
    );
    expect(html).toContain('data-mark-symbol="on-track"');
    expect(html).toContain('stroke-width="5"');
    expect(html).toContain('data-shape="on-track"');
  });
});
