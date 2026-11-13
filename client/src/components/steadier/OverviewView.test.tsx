import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyWorkspace } from "../../../../server/steadier/validation";
import OverviewView, { type AttentionItem } from "./OverviewView";

const noop = () => undefined;

function render(attention: AttentionItem[]) {
  const w = emptyWorkspace();
  return renderToStaticMarkup(
    <OverviewView
      workspace={w}
      tasks={[]}
      attention={attention}
      nextThing={<p>Next thing card</p>}
      claudeRequests={null}
      held={[{ key: "held", label: "Held", value: "15", onOpen: noop }]}
      why={[{ key: "compass", label: "Compass", value: "4 Imperatives", onOpen: noop }]}
      onCalendar={noop}
      onOpenProject={noop}
      onAllProjects={noop}
    />
  );
}

describe("Overview (see)", () => {
  it("Needs attention total is the sum of its rows; zero rows are hidden", () => {
    const html = render([
      { key: "review", label: "Review due", count: 13, onOpen: noop },
      { key: "linkcheck", label: "Link check", count: 8, onOpen: noop },
      { key: "weekly", label: "Weekly review", count: 1, onOpen: noop },
      { key: "sort", label: "Sort (not set up)", count: 0, onOpen: noop },
    ]);
    expect(html).toContain("Needs attention (22)");
    expect(html).toContain("Review due");
    expect(html).not.toContain("Sort (not set up)");
  });

  it("is quiet when nothing needs attention, and has no explanation text until the info icon", () => {
    const html = render([{ key: "review", label: "Review due", count: 0, onOpen: noop }]);
    expect(html).toContain("Needs attention (0)");
    expect(html).toContain("Nothing needs attention.");
    expect(html).toContain('aria-label="What Overview shows"');
    expect(html).not.toContain("Overview is for seeing");
    expect(html).toContain("Next thing card");
    expect(html).toContain("Held");
    expect(html).toContain("Compass");
  });
});
