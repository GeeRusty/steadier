import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTask } from "../../domain/engine";
import { adelaideClock, DEFAULT_PLANNING, emptyTaskSchedule } from "../../domain/time";
import TodayVisualTimeline from "./TodayVisualTimeline";

describe("TodayVisualTimeline", () => {
  it("renders one empty-anchor message, configured endpoints, and a compact capacity value", () => {
    const html = renderToStaticMarkup(
      <TodayVisualTimeline
        tasks={[]}
        projects={[]}
        planning={{ ...DEFAULT_PLANNING, dayStart: "07:00", dayEnd: "18:00" }}
        compact
      />
    );

    expect(html.match(/No booked anchors today/g)).toHaveLength(1);
    expect(html).toContain("class=\"edge-start\">07</span>");
    expect(html).toContain("class=\"edge-end\">18</span>");
    expect(html).toMatch(/Free today:<\/span> <strong>\d+(?:h \d+m|h|m)<\/strong>/);
    expect(html).not.toContain("v2-anchor-current-time");
    expect(html).not.toContain('<span aria-hidden="true"></span>');
  });

  it("renders only explicitly booked anchors and clearly reports offline sync state", () => {
    const today = adelaideClock().date;
    const task = createTask(
      {
        title: "Synthetic booked anchor",
        state: "ready",
        deadline: today,
        schedule: {
          ...emptyTaskSchedule(),
          date: today,
          time: "10:00",
          minutes: 45,
          fixed: true,
          deadlineTime: "10:15",
        },
      },
      today
    );
    const unbooked = createTask(
      {
        title: "Synthetic untimed pool task",
        state: "ready",
        schedule: {
          ...emptyTaskSchedule(),
          date: today,
          time: "11:00",
          minutes: 45,
          fixed: false,
        },
      },
      today
    );

    const html = renderToStaticMarkup(
      <TodayVisualTimeline
        tasks={[task, unbooked]}
        projects={[]}
        planning={DEFAULT_PLANNING}
        syncStatus="offline"
        lastSyncedAt="2026-11-05T06:58:00+10:30"
        pendingSync
        online={false}
        onCalendar={() => undefined}
        onOpenTask={() => undefined}
        onRead={() => undefined}
      />
    );

    expect(html).toContain('<h2 id="today-visual-title">Today timeline</h2>');
    expect(html).toContain("Tap a task bar to view its details and subtasks");
    expect(html).toContain("This timeline is read-only: edit timing in Calendar");
    expect(html).toContain("Swipe sideways to inspect the day");
    expect(html).toContain("Synthetic booked anchor");
    expect(html).toContain('aria-label="Open Booked anchor. Synthetic booked anchor');
    expect(html).toContain("Start 10 am");
    expect(html).toContain('id="today-visual-agenda-title">Today&#x27;s booked tasks</h3>');
    expect(html).toContain('aria-label="Open Synthetic booked anchor, Start 10 am');
    expect(html).toContain('class="today-visual-agenda-state state-ready">Active</span>');
    expect(html).not.toContain('today-visual-agenda-item is-done');
    expect(html).toContain("1 booked");
    expect(html).toContain("deadline point");
    expect(html).not.toContain("Synthetic untimed pool task");
    expect(html).toContain('aria-label="Open Calendar"');
    expect(html).toContain('aria-label="Read today&#x27;s timeline aloud"');
    expect(html).toContain("Offline · last confirmed sync");
    expect(html).toContain("changes waiting to sync");
    expect(html.match(/<button\b/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain('aria-label="fixed"');
    expect(html).not.toContain("draggable=");
  });
});
