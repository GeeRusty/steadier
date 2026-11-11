import path from "node:path";
import { describe, expect, it } from "vitest";
import { guideFor, guideSections, guideText, renderGuideHtml } from "./guide";

describe("user guide", () => {
  process.env.STEADIER_GUIDE_PATH = path.resolve(__dirname, "../../docs/User-Guide.md");

  it("loads and covers every area in the app menu", () => {
    const text = guideText();
    expect(text.length).toBeGreaterThan(2000);
    const headings = guideSections(text).map(s => s.heading);
    for (const area of ["My life today", "Calendar", "All work", "Shopping Lists", "Notes / Daily Log", "Backups & trial", "Server & Compass"]) {
      expect(headings).toContain(area);
    }
  });

  it("narrows to matching sections for a topic", () => {
    const part = guideFor("Calendar");
    expect(part).toContain("## ");
    expect(part.length).toBeLessThan(guideText().length);
    expect(guideFor("")).toBe(guideText());
  });

  it("renders safe HTML with a contents list", () => {
    const { body, toc } = renderGuideHtml("# Title\n\n## Part <one>\n\nSome **bold** text.\n\n- a\n- b");
    expect(body).toContain('<h2 id="part-one">Part &lt;one&gt;</h2>');
    expect(body).toContain("<strong>bold</strong>");
    expect(body).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(toc).toContain('href="#part-one"');
  });
});
