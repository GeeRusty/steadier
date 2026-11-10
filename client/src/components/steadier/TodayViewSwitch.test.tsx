import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TodayViewSwitch from "./TodayViewSwitch";

function render(value: "today" | "overview") {
  return renderToStaticMarkup(
    <TodayViewSwitch value={value} onChange={() => undefined} />
  );
}

describe("TodayViewSwitch", () => {
  it("exposes Today and Overview as visible pressed-state buttons in one labelled group", () => {
    const html = render("today");
    expect(html).toContain('role="group" aria-label="Today or Overview"');
    expect(html).toContain(">Today</button>");
    expect(html).toContain(">Overview</button>");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Today/);
  });

  it("marks Overview selected when the user chooses the overview page", () => {
    const html = render("overview");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Overview/);
  });
});
