import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PagePurposeNote from "./PagePurposeNote";
import { FRONT_OF_MIND_PROMISE } from "../../domain/frontOfMind";

describe("Front of Mind's promise behind the i (owner-approved wording)", () => {
  const html = renderToStaticMarkup(<PagePurposeNote view="ideas" extra={FRONT_OF_MIND_PROMISE} />);

  it("renders headings, the quote, lists and bold as plain text elements", () => {
    expect(html).toContain('<h3 class="page-purpose-h">The Promise</h3>');
    expect(html).toContain("<blockquote");
    expect(html).toContain("<li>Toronto</li>");
    expect(html).toContain("<strong>Consulted</strong>");
  });

  it("has the four approved changes and nothing else from Notion's sorting section", () => {
    expect(html).not.toContain("What Compass Does</h3>");
    expect(html).not.toContain("an action → Todoist");
    expect(html).toContain("live Front of Mind list in Steadier");
    expect(html.match(/Check Front of Mind/g)!.length).toBeGreaterThanOrEqual(1);
    expect(html.match(/<h3[^>]*>Trigger Phrase — “Check Front of Mind”<\/h3>/g)).toHaveLength(1);
    expect(html).toContain("your tasks (due, overdue, scheduled actions), Projects in Steadier");
    expect(html).not.toContain("Todoist (due");
  });

  it("escapes text: no raw HTML can come through", () => {
    const evil = renderToStaticMarkup(<PagePurposeNote view="ideas" extra={["## <img src=x>", "**<b>x</b>**"]} />);
    expect(evil).not.toContain("<img");
    expect(evil).not.toContain("<b>x");
  });
});
