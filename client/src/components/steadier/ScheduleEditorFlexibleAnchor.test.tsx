import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTask } from "../../domain/engine";
import { emptyRepeat, emptyTaskSchedule } from "../../domain/time";
import ScheduleEditor from "./ScheduleEditor";

afterEach(() => vi.unstubAllGlobals());

function render(repeating: boolean) {
  vi.stubGlobal("React", React);
  const task = createTask({
    id: "synthetic-editor",
    title: "Synthetic weekend job",
    schedule: {
      ...emptyTaskSchedule(),
      flexibleWindow: { startDate: "2026-11-07", endDate: "2026-11-08" },
      minutes: 120,
      ...(repeating
        ? {
            repeat: { ...emptyRepeat("weekly"), weekdays: [] },
            repeatAnchorDate: "2026-11-07",
            repeatOccurrenceDate: "2026-11-07",
            repeatTime: null,
          }
        : {}),
    },
  });
  return renderToStaticMarkup(
    createElement(ScheduleEditor, { task, onChange: () => {} })
  );
}

describe("ScheduleEditor repeating flexible window anchor", () => {
  it("offers a labelled anchor day and end day for a repeating flexible window", () => {
    const markup = render(true);
    expect(markup).toContain("Repeating flexible window anchor");
    expect(markup).toContain("Window opens on");
    expect(markup).toContain("Repeat anchor date (window opens)");
    expect(markup).toContain("Window runs through (inclusive)");
    expect(markup).toContain('value="2026-11-07"');
    expect(markup).toContain('value="2026-11-08"');
    expect(markup).toContain("opens Saturday, closes end of Sunday (2 days)");
    expect(markup).toContain("No set time");
    expect(markup).toContain('aria-pressed="true"');
  });

  it("does not show the anchor control when the flexible window does not repeat", () => {
    expect(render(false)).not.toContain("Repeat anchor date (window opens)");
  });
});
