import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyProjectCompass } from "../../domain/compass";
import { emptyProjectSchedule } from "../../domain/time";
import { emptyWorkspace } from "../../../../server/steadier/validation";
import LinkCheckView from "./LinkCheckView";

describe("LinkCheckView", () => {
  it("shows both lists with one-tap choices", () => {
    const w = emptyWorkspace();
    w.imperatives = [
      { id: "i1", title: "Keep the home stable", reason: "", status: "active", setOn: "2026-11-01", retiredOn: null, notionUrl: null, decision: null, history: [], createdAt: "2026-11-01T09:00:00", updatedAt: "2026-11-01T09:00:00" },
    ];
    w.projects = [
      { id: "p1", title: "Shed build", purpose: "", outcome: "", role: "direction", pattern: "timely", status: "active", milestones: [], progress: [], createdAt: "2026-11-01T09:00:00", updatedAt: "2026-11-01T09:00:00", schedule: emptyProjectSchedule(), compass: emptyProjectCompass() },
    ];
    const html = renderToStaticMarkup(<LinkCheckView workspace={w} readOnly={false} onMutate={() => true} />);
    expect(html).toContain("Imperatives with no work (1)");
    expect(html).toContain("Imperative projects with no Imperative (1)");
    for (const label of ["Link work", "Not yet", "Step down", "Link to an Imperative", "Make it Support"]) expect(html).toContain(label);
  });

  it("says when everything is linked", () => {
    const html = renderToStaticMarkup(<LinkCheckView workspace={emptyWorkspace()} readOnly={false} onMutate={() => true} />);
    expect(html).toContain("Everything is linked.");
  });
});
