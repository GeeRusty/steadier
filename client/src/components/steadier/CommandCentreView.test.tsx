import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTask } from "../../domain/engine";
import type { Imperative } from "../../domain/compass";
import type { Workspace } from "../../domain/types";
import CommandCentreView from "./CommandCentreView";

const createdAt = "2026-11-04T07:00:00+10:30";

function emptyWorkspace(): Workspace {
  return {
    version: 2,
    tasks: [],
    projects: [],
    focus: null,
    intention: null,
    matrixWeights: {
      "direction-timely": 1,
      "direction-sustained": 1,
      "support-timely": 1,
      "support-sustained": 1,
    },
    trial: { startedAt: createdAt, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [],
  };
}

function syntheticTask(
  id: string,
  title: string,
  date: string,
  updatedAt: string,
  state: "ready" | "done" = "ready"
) {
  const base = createTask({ title, state, createdAt, updatedAt }, "2026-11-04");
  return {
    ...base,
    id,
    title,
    state,
    createdAt,
    updatedAt,
    schedule: { ...base.schedule, date, time: "09:00", fixed: true, minutes: 30 },
  };
}

function syntheticImperative(): Imperative {
  return {
    id: "synthetic-imperative-id",
    title: "Synthetic Imperative",
    reason: "Synthetic UI fixture only",
    status: "active",
    setOn: "2026-11-01",
    retiredOn: null,
    notionUrl: null,
    decision: null,
    history: [],
    createdAt: "2026-11-01T09:00:00+10:30",
    updatedAt: "2026-11-01T09:00:00+10:30",
  };
}

function renderCommandCentre(
  workspace: Workspace,
  now: Date
) {
  return {
    html: renderToStaticMarkup(
      <CommandCentreView
        workspace={workspace}
        revision={7}
        readOnly={false}
        lastSyncedAt="2026-11-04T07:30:00+10:30"
        dataSource="Synthetic fixture · no live data"
        now={now}
        onConfirmImperative={vi.fn().mockResolvedValue(true)}
        onOpenTask={vi.fn().mockResolvedValue(true)}
        onCompleteTask={vi.fn().mockResolvedValue(true)}
        onOpenProject={vi.fn().mockResolvedValue(true)}
        onOpenImperative={vi.fn().mockResolvedValue(true)}
        onOpenCalendar={vi.fn()}
        onOpenReview={vi.fn()}
        onOpenObligation={vi.fn()}
        onOpenPeople={vi.fn()}
        onOpenCredentialRenewals={vi.fn()}
      />
    ),
  };
}

describe("Command Centre page", () => {
  it("keeps the approved section order, reference-only links and user-started read-aloud", () => {
    const { html } = renderCommandCentre(
      emptyWorkspace(),
      new Date("2026-11-04T08:00:00+10:30")
    );
    const order = [
      "Active Imperatives",
      "Needs a decision",
      "Today",
      "Coming up",
      "Reference",
    ].map(label => html.indexOf(label));
    expect(order.every(index => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain("Reference links only · no task reads or writes");
    expect(html).toContain("https://app.notion.com/p/56f75cfbbbe54ce697f53a3931440473?pvs=204");
    expect(html).toContain("https://app.notion.com/p/40cdb2c862a181079f55dd63a4a51cac?pvs=204");
    expect(html).toContain("Notion Tasks are not displayed or changed");
    expect(html).not.toContain("Read aloud");
  });

  it("shows dated commitments and a compact Mark done action at the weekday evening check-in", () => {
    const done = syntheticTask("synthetic-done", "Synthetic completed booking", "2026-11-04", "2026-11-04T12:00:00+10:30", "done");
    const moved = syntheticTask("synthetic-moved", "Synthetic moved booking", "2026-11-04", "2026-11-04T12:30:00+10:30");
    const untouched = syntheticTask("synthetic-untouched", "Synthetic untouched booking", "2026-11-04", "2026-11-03T12:00:00+10:30");
    const { html } = renderCommandCentre(
      { ...emptyWorkspace(), tasks: [done, moved, untouched] },
      new Date("2026-11-04T17:00:00+10:30")
    );
    expect(html).toContain("Evening check-in · weekdays at 17:00");
    expect(html).toContain("Mark done");
    expect(html).toContain("Today’s dated tasks: 1 completed · 1 changed today and still open · 1 still open without an update today.");
    expect(html).toContain("Synthetic completed booking");
    expect(html).toContain("Synthetic moved booking");
    expect(html).toContain("Synthetic untouched booking");
  });

  it("keeps weekend pages free of Imperative and task prompts while showing the Saturday review flag", () => {
    const weekend = {
      ...emptyWorkspace(),
      imperatives: [syntheticImperative()],
      tasks: [syntheticTask("synthetic-weekend", "Synthetic weekend task", "2026-11-07", createdAt)],
    };
    const saturday = renderCommandCentre(weekend, new Date("2026-11-07T08:00:00+10:30")).html;
    const sunday = renderCommandCentre(weekend, new Date("2026-11-08T08:00:00+10:30")).html;
    expect(saturday).toContain("Saturday is quiet: no question set");
    expect(saturday).toContain("Weekly Reality Review");
    expect(saturday).not.toContain('aria-label="Confirm Synthetic Imperative remains active"');
    expect(sunday).toContain("Sunday has no prompts");
    expect(sunday).not.toContain('aria-label="Confirm Synthetic Imperative remains active"');
    expect(saturday).toContain("No weekend questions");
  });

  it("shows explicit Confirm and Change actions for Active Imperatives on weekdays", () => {
    const html = renderCommandCentre(
      { ...emptyWorkspace(), imperatives: [syntheticImperative()] },
      new Date("2026-11-04T08:00:00+10:30")
    ).html;
    expect(html).toContain('aria-label="Confirm Synthetic Imperative remains active"');
    expect(html).toContain('aria-label="Change Synthetic Imperative"');
  });

  it("keeps Active Imperatives read-only before the 08:00 check-in opens", () => {
    const html = renderCommandCentre(
      { ...emptyWorkspace(), imperatives: [syntheticImperative()] },
      new Date("2026-11-04T07:59:00+10:30")
    ).html;
    expect(html).toContain("Morning check-in opens today at 08:00");
    expect(html).toContain("Opens at 08:00");
    expect(html).not.toContain('aria-label="Confirm Synthetic Imperative remains active"');
    expect(html).not.toContain('aria-label="Change Synthetic Imperative"');
  });
});
