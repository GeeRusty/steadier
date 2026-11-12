import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PAGE_NAVIGATION_SECTIONS } from "../../domain/pageNavigation";
import type { View } from "../../domain/types";
import PagePurposeNote, {
  PAGE_PURPOSE_CORE_VIEWS,
  SPECIALIST_PAGE_PURPOSES,
} from "./PagePurposeNote";

function render(view: View) {
  return renderToStaticMarkup(<PagePurposeNote view={view} />);
}

describe("PagePurposeNote", () => {
  it("provides concise guidance for every specialist destination in the grouped menu", () => {
    const menuViews = PAGE_NAVIGATION_SECTIONS.flatMap(section => section.ids);
    const expected = menuViews
      .filter(view => !PAGE_PURPOSE_CORE_VIEWS.includes(view as (typeof PAGE_PURPOSE_CORE_VIEWS)[number]))
      .slice()
      .sort();
    expect(Object.keys(SPECIALIST_PAGE_PURPOSES).sort()).toEqual(expected);
    for (const view of expected) {
      const html = render(view);
      expect(html).toContain('role="note" aria-label="What this page is for"');
      expect(html).toContain("What this page is for:");
      // Concise: the note text itself stays short (the markup now includes the info icon).
      expect(SPECIALIST_PAGE_PURPOSES[view]!.length).toBeLessThan(200);
      expect(html).toContain('<details class="page-purpose">');
    }
  });

  it("leaves the core Today, All work, Calendar and Weekly pages free of duplicate guidance", () => {
    for (const view of PAGE_PURPOSE_CORE_VIEWS) expect(render(view)).toBe("");
  });

  it("surfaces important local-only and credential safety boundaries", () => {
    expect(render("journal")).toContain("included in backups");
    expect(render("moveEnergy")).toContain("outside sync and backup");
    expect(render("weather")).toContain("not backed up");
    expect(render("credentialRenewals")).toContain("do not store secret values");
  });
});
