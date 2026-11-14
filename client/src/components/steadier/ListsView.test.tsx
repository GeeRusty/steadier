import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Workspace } from "../../domain/types";
import { addItem, addTemplate, startRun, tickItem } from "../../domain/lists";
import ListsView from "./ListsView";

const AT = "2026-11-14T09:00:00+10:30";

function workspace(): Workspace {
  let w: Workspace = {
    version: 2,
    tasks: [],
    projects: [],
    focus: null,
    intention: null,
    matrixWeights: { "direction-timely": 1, "direction-sustained": 1, "support-timely": 1, "support-sustained": 1 },
    trial: { startedAt: AT, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [],
  };
  w = addTemplate(w, "list-pack", "Kingston packing", AT);
  w = addItem(w, "list-pack", "i1", "Torch – charged", null, AT);
  w = addItem(w, "list-pack", "i2", "Gas bottle – full", null, AT);
  w = startRun(w, "run-1", "list-pack", AT);
  w = tickItem(w, "run-1", "i1", true, AT);
  w = addTemplate(w, "list-shack", "Leaving the shack", AT, "read-do");
  return w;
}

describe("Lists page", () => {
  const html = renderToStaticMarkup(<ListsView workspace={workspace()} readOnly={false} onMutate={() => true} />);

  it("shows the list of lists first: in use with progress, then ready", () => {
    expect(html).toContain("In use (1)");
    expect(html).toContain("Kingston packing");
    expect(html).toContain("1/2");
    expect(html).toContain("Ready (1)");
    expect(html).toContain("Read-Do · never used");
  });

  it("shows no forms, item counters, item dates or Read aloud until asked", () => {
    expect(html).not.toContain("<input");
    expect(html).not.toContain("5000");
    expect(html).not.toMatch(/Read aloud/);
    expect(html).toContain("+ List");
  });
});
