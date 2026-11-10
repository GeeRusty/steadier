import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AccordionSection from "./AccordionSection";

describe("AccordionSection", () => {
  it("renders a collapsed keyboard control with count and linked hidden region", () => {
    const markup = renderToStaticMarkup(
      <AccordionSection title="Waiting" count={3}>
        <p>Synthetic record</p>
      </AccordionSection>
    );
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("aria-controls=");
    expect(markup).toContain('role="region"');
    expect(markup).toContain('hidden=""');
    expect(markup).toContain("Waiting");
    expect(markup).toContain("3 items");
  });

  it("opens urgent sections and search-matched sections on render", () => {
    const urgent = renderToStaticMarkup(
      <AccordionSection title="Due today" count={1} defaultOpen>
        <p>Synthetic urgent record</p>
      </AccordionSection>
    );
    const matched = renderToStaticMarkup(
      <AccordionSection title="Search result" count={1} revealToken="needle">
        <p>Synthetic match</p>
      </AccordionSection>
    );
    expect(urgent).toContain('aria-expanded="true"');
    expect(matched).toContain('aria-expanded="true"');
    expect(matched).not.toContain('hidden=""');
  });

  it("uses a static count heading for short sections without accordion chrome", () => {
    const markup = renderToStaticMarkup(
      <AccordionSection title="One person" count={1} collapsible={false}>
        <p>Synthetic person record</p>
      </AccordionSection>
    );
    expect(markup).toContain("1 item");
    expect(markup).toContain("Synthetic person record");
    expect(markup).not.toContain("aria-expanded");
    expect(markup).not.toContain("accordion-trigger");
  });

  it("keeps same-titled groups independent when given stable group keys", () => {
    const open = renderToStaticMarkup(
      <AccordionSection
        title="Project"
        count={1}
        persistenceKey="project-a"
        defaultOpen
      >
        <p>Synthetic A</p>
      </AccordionSection>
    );
    const closed = renderToStaticMarkup(
      <AccordionSection title="Project" count={1} persistenceKey="project-b">
        <p>Synthetic B</p>
      </AccordionSection>
    );
    expect(open).toContain('aria-expanded="true"');
    expect(closed).toContain('aria-expanded="false"');
  });

  it("reopens stale-collapsed sections when their content becomes urgent", () => {
    renderToStaticMarkup(
      <AccordionSection title="Due today" count={1} persistenceKey="urgent-a">
        <p>Synthetic due record</p>
      </AccordionSection>
    );
    const urgent = renderToStaticMarkup(
      <AccordionSection
        title="Due today"
        count={1}
        persistenceKey="urgent-a"
        autoOpen
      >
        <p>Synthetic due record</p>
      </AccordionSection>
    );
    expect(urgent).toContain('aria-expanded="true"');
  });
});
