import React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TodayCalendarMenuSheet, { CALENDAR_GUIDE } from "./TodayCalendarMenuSheet";
import V2FoldableCard, { foldPreferenceKey, readFoldPreference } from "./V2FoldableCard";

function menu(kind: "app" | "page", page: "today" | "calendar") {
  return renderToStaticMarkup(
    createElement(TodayCalendarMenuSheet, {
      kind,
      page,
      appearance: "dark",
      onAppearance: () => undefined,
      connectionText: "Connected · synced 11:58",
      flagCount: 2,
      canUndo: false,
      onClose: () => undefined,
      onFlag: () => undefined,
      onConnection: () => undefined,
      onIntention: () => undefined,
      onReanchor: () => undefined,
      onBackups: () => undefined,
      onSpeak: () => undefined,
      onRead: () => undefined,
      onUndo: () => undefined,
    })
  );
}

describe("Today and Calendar V2 menus", () => {
  it("keeps the Today app actions and accessible dialog semantics", () => {
    const html = menu("app", "today");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    for (const label of ["Theme", "Flag", "Connection", "Say intention", "Re-anchor", "Backups"]) {
      expect(html).toContain(label);
    }
  });

  it("keeps Calendar's app-level voice and connection actions", () => {
    const html = menu("app", "calendar");
    for (const label of ["Theme", "Flag", "Speak", "Connection"]) expect(html).toContain(label);
    expect(html).not.toContain("Say intention");
  });

  it("keeps read aloud, Undo, and expandable guide in This page without hiding the view switch there", () => {
    const html = menu("page", "today");
    for (const label of ["Read aloud", "Undo", "How this page works"]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("Today / Overview");
    expect(html).toContain('aria-expanded="false"');
  });

  it("exposes Calendar's read-aloud and guide paragraph in This page", () => {
    const html = menu("page", "calendar");
    expect(html).toContain("Read aloud");
    expect(html).toContain("How this calendar works");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Calendar grids show booked anchors and hard-deadline points.");
    expect(CALENDAR_GUIDE).toContain("Deadline points don't reserve time");
  });
});

describe("V2 fold-card preferences", () => {
  it("reads persisted open/closed choices without touching workspace data", () => {
    const values = new Map<string, string>([[foldPreferenceKey("anchors"), "closed"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(readFoldPreference("anchors", true, storage)).toBe(false);
    expect(readFoldPreference("pool", true, storage)).toBe(true);
    values.set(foldPreferenceKey("anchors"), "open");
    expect(readFoldPreference("anchors", false, storage)).toBe(true);
  });

  it("renders keyboard-operable expanded/collapsed semantics and a live count", () => {
    const html = renderToStaticMarkup(
      createElement(V2FoldableCard, {
        title: "Anchors",
        count: "2 booked",
        storageKey: "anchors",
        defaultOpen: true,
        children: createElement("p", null, "Synthetic content"),
      })
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("2 booked");
    expect(html).toContain("Synthetic content");
  });

  it("keeps the controlled panel target present while a card is collapsed", () => {
    const html = renderToStaticMarkup(
      createElement(V2FoldableCard, {
        title: "Pillars",
        count: "2 of 8 set",
        storageKey: "pillars-closed",
        defaultOpen: false,
        children: createElement("p", null, "Synthetic Pillar chips"),
      })
    );
    const control = html.match(/aria-controls="([^"]+)"/);
    expect(html).toContain('aria-expanded="false"');
    expect(control?.[1]).toBeTruthy();
    expect(html).toContain(`id="${control?.[1]}"`);
    expect(html).toContain('hidden=""');
  });
});
