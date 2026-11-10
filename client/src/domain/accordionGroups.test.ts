import { describe, expect, it } from "vitest";
import { groupByStable, monthGroup } from "./accordionGroups";

describe("accordion grouping", () => {
  it("preserves first group order and item order without mutating its input", () => {
    const items = [
      { id: "a", group: "Pillar 1" },
      { id: "b", group: "Pillar 2" },
      { id: "c", group: "Pillar 1" },
    ];
    const groups = groupByStable(items, item => ({
      key: item.group,
      label: item.group,
    }));
    expect(
      groups.map(group => [group.label, group.items.map(item => item.id)])
    ).toEqual([
      ["Pillar 1", ["a", "c"]],
      ["Pillar 2", ["b"]],
    ]);
    expect(items.map(item => item.id)).toEqual(["a", "b", "c"]);
  });

  it("formats date months and safely groups missing or invalid dates", () => {
    expect(monthGroup("2026-11-02T14:00:00+10:30")).toEqual({
      key: "2026-11",
      label: "November 2026",
    });
    expect(monthGroup(null)).toEqual({ key: "undated", label: "Undated" });
    expect(monthGroup("not-a-date")).toEqual({
      key: "undated",
      label: "Undated",
    });
  });
});
