import { describe, expect, it } from "vitest";
import { groupPageNavigation, PAGE_NAVIGATION_SECTIONS } from "./pageNavigation";
import type { View } from "./types";

const allPageIds: View[] = [
  "attention",
  "command-centre",
  "all",
  "calendar",
  "review",
  "near",
  "imperatives",
  "compass-view",
  "waiting",
  "projects",
  "weekly",
  "progress",
  "matrix",
  "map",
  "compass-directory",
  "time",
  "settings",
  "cloud",
  "sheet",
  "obligations",
  "journal",
  "decisions",
  "evidence",
  "sites",
  "shopping",
  "assets",
  "pipeline",
  "routine",
  "yearWheel",
  "moveEnergy",
  "weather",
  "people",
  "credentialRenewals",
  "invoices",
];

describe("full page navigation groups", () => {
  it("puts daily, work and weekly-review routes first", () => {
    expect(PAGE_NAVIGATION_SECTIONS[0]).toEqual({
      title: "Start here",
      ids: ["attention", "all", "sort", "ideas", "calendar", "review", "weekly", "command-centre"],
    });
    expect(PAGE_NAVIGATION_SECTIONS[1].title).toBe("Imperatives");
  });

  it("keeps every existing page as one direct destination", () => {
    const groups = groupPageNavigation(allPageIds.map(id => ({ id })));
    const groupedIds = groups.flatMap(group => group.items.map(item => item.id));

    expect(new Set(groupedIds).size).toBe(allPageIds.length);
    expect([...groupedIds].sort()).toEqual([...allPageIds].sort());
    expect(groups.map(group => group.title)).toEqual([
      "Start here",
      "Imperatives",
      "Work and follow-ups",
      "Reference and records",
      "Planning tools",
      "Settings and data",
    ]);
  });

  it("keeps a newly added route visible in a final direct-link group", () => {
    const futureRoute = "future-route" as View;
    const groups = groupPageNavigation([
      { id: "attention" },
      { id: futureRoute },
    ]);

    expect(groups.at(-1)).toEqual({
      title: "More pages",
      items: [{ id: futureRoute }],
    });
  });
});
