import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AppearanceToggle from "./AppearanceToggle";

describe("AppearanceToggle", () => {
  it("exposes keyboard-native Light/Dark controls and the active selection", () => {
    const html = renderToStaticMarkup(
      <AppearanceToggle appearance="dark" onChange={() => {}} />
    );
    expect(html).toContain('role="group" aria-label="Appearance"');
    expect(html).toContain('aria-label="Light appearance" aria-pressed="false"');
    expect(html).toContain('aria-label="Dark appearance" aria-pressed="true"');
    expect(html).toContain(">Light</span>");
    expect(html).toContain(">Dark</span>");
  });
});
