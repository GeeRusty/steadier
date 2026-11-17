import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Workspace } from "../../domain/types";
import type { Imperative } from "../../domain/compass";
import ImperativesView, { IMPERATIVES_INFO } from "./ImperativesView";

const T = "2026-10-27T09:00:00+10:30";

function imperative(id: string, title: string, extra: Partial<Imperative> = {}): Imperative {
  return {
    id,
    title,
    reason: "Lease ends in March",
    status: "active",
    notionUrl: null,
    setOn: "2026-10-27",
    retiredOn: null,
    decision: null,
    history: [],
    createdAt: T,
    updatedAt: T,
    ...extra,
  };
}

function workspace(): Workspace {
  return {
    version: 2,
    tasks: [],
    projects: [],
    focus: null,
    intention: null,
    matrixWeights: { "direction-timely": 1, "direction-sustained": 1, "support-timely": 1, "support-sustained": 1 },
    trial: { startedAt: T, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [imperative("i1", "Keep the home stable"), imperative("i2", "Old aim", { status: "retired", retiredOn: "2026-11-01" })],
    reviews: [],
    goals: [
      {
        id: "p1",
        level: "pillar",
        title: "Physical Environment",
        description: "",
        status: "active",
        parents: [],
        projects: [],
        history: [],
        createdAt: T,
        updatedAt: T,
      } as never,
    ],
  };
}

const render = (w: Workspace, readOnly = false) =>
  renderToStaticMarkup(
    <ImperativesView workspace={w} readOnly={readOnly} onMutate={() => true} onOpenTask={() => {}} />
  );

describe("Imperatives page", () => {
  it("writes dates like the header, not 2026-10-27", () => {
    const html = render(workspace());
    expect(html).toContain("Set 27 Oct");
    expect(html).not.toContain("2026-10-27");
  });

  it("keeps the link picker, Add form and Retired list folded until asked", () => {
    const html = render(workspace());
    expect(html).toContain("+ Link");
    expect(html).not.toContain("<select");
    expect(html).toContain("+ Add an Imperative");
    expect(html).not.toContain("What I cannot ignore");
    expect(html).toContain("Retired (1)");
    expect(html).not.toContain("Old aim");
  });

  it("has no Read aloud or explanation on the page (they are in the menu and behind the i)", () => {
    const html = render(workspace());
    expect(html).not.toContain("Read aloud");
    expect(html).not.toContain("cannot responsibly ignore");
    expect(IMPERATIVES_INFO).toContain("cannot responsibly ignore");
  });

  it("makes Retire a different button from Edit, which asks first", () => {
    const html = render(workspace());
    expect(html).toContain('class="tp-btn">Edit');
    expect(html).toContain('class="imp-retire">Retire…');
  });

  it("shows a direct map link with its own Unlink button", () => {
    const w = workspace();
    w.imperatives[0] = { ...w.imperatives[0], mapLinks: ["p1"] } as Imperative;
    const html = render(w);
    expect(html).toContain("Pillar “Physical Environment”</button>");
    expect(html).toContain('class="imp-unlink">Unlink');
  });
});
