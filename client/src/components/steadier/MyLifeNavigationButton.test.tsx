import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MyLifeNavigationButton from "./MyLifeNavigationButton";
import { MOBILE_QUICK_NAV_IDS } from "../../domain/mobileQuickNavigation";

describe("My Life slide-out navigation", () => {
  it("provides an explicit, expanded-state-aware My Life control", () => {
    const closed = renderToStaticMarkup(
      createElement(MyLifeNavigationButton, { expanded: false, onToggle: () => undefined })
    );
    expect(closed).toContain("My Life");
    expect(closed).toContain('aria-label="Open My Life navigation"');
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain('aria-controls="my-life-navigation"');

    const open = renderToStaticMarkup(
      createElement(MyLifeNavigationButton, { expanded: true, onToggle: () => undefined })
    );
    expect(open).toContain('aria-label="Close My Life navigation"');
    expect(open).toContain('aria-expanded="true"');
  });

  it("preserves the six horizontal quick links as one-tap destinations", () => {
    expect(MOBILE_QUICK_NAV_IDS).toEqual([
      "attention",
      "calendar",
      "all",
      "projects",
      "settings",
      "compass-view",
    ]);
  });
});
