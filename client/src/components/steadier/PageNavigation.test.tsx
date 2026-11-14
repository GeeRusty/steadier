import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CircleDot } from "lucide-react";
import PageNavigation from "./PageNavigation";
import type { PageNavigationItem } from "./PageNavigation";
import type { View } from "../../domain/types";

const items: PageNavigationItem[] = [
  { id: "attention", title: "My life today", Icon: CircleDot },
  { id: "all", title: "All work", Icon: CircleDot },
  { id: "calendar", title: "Calendar", Icon: CircleDot },
  { id: "review", title: "Review due / unplaced", Icon: CircleDot },
  { id: "weekly", title: "Weekly Reality Review", Icon: CircleDot },
  { id: "map", title: "Compass map", Icon: CircleDot },
  { id: "settings", title: "Backups & trial", Icon: CircleDot },
];

describe("PageNavigation", () => {
  it("renders clear section headings and direct page buttons", () => {
    const markup = renderToStaticMarkup(
      createElement(PageNavigation, {
        items,
        active: "attention" as View,
        outstandingCount: 4,
        reviewCount: 2,
        onNavigate: vi.fn(),
        onSpeakTask: vi.fn(),
      })
    );

    expect(markup).toContain("Start here");
    expect(markup).toContain("Imperatives");
    expect(markup).toContain("Settings and data");
    expect(markup).toContain('aria-label="My Life menu content"');
    expect(markup).toContain("sidebar-navigation-scroll");
    for (const item of items)
      expect(markup).toContain(item.title.replaceAll("&", "&amp;"));
    expect(markup).toContain('aria-label="All Steadier pages"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="2 items ready for review">2</span>');
    expect(markup).not.toContain("aria-expanded");
    const primary = ["My life today", "All work", "Calendar", "Review due / unplaced", "Weekly Reality Review"];
    expect(primary.map(label => markup.indexOf(label))).toEqual(
      [...primary.map(label => markup.indexOf(label))].sort((a, b) => a - b)
    );
  });

  it("keeps voice opt-in and makes draft confirmation explicit", () => {
    const markup = renderToStaticMarkup(
      createElement(PageNavigation, {
        items,
        active: "attention" as View,
        outstandingCount: 0,
        reviewCount: 0,
        onNavigate: vi.fn(),
        onSpeakTask: vi.fn(),
      })
    );

    expect(markup).toContain("Speak a task");
    expect(markup).toContain("voice starts only after this tap");
    expect(markup).toContain("Voice is opt-in");
    expect(markup).toContain("Review the draft and save it yourself");
    expect(markup).not.toContain("nav-review-count");
    expect(markup).toMatch(/sidebar-navigation-scroll[\s\S]*sidebar-voice-action[\s\S]*sidebar-navigation/);
  });
});
