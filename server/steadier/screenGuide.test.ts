import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { guideSections, screenFor, screenGuideText, screenNames } from "./guide";

const ROOT = path.resolve(__dirname, "../..");
process.env.STEADIER_SCREEN_GUIDE_PATH = path.join(ROOT, "docs/Screen-Guide.md");

/** Labels the app builds from parts (or draws as an icon), so they never appear whole in the source. */
const BUILT_LABELS = new Set([
  "☰", // the menu icon
  "Needs attention (n)", // "Needs attention" + count
  "Free · 2h 15m", // "Free · {length}" on Today's agenda
  "Retired (n)", // "Retired ({count})" on Pillars & Goals
  "Step n of 10", // "Step {n} of {total}"
  "Add Pillar", // "Add {level}"
  "Add Value Goal",
  "Add Goal Outcome",
  "Pillar title", // "{level} title"
  "Value Goal title",
  "Goal Outcome title",
  "Reading (km, optional)", // "Reading ({unit}, optional)"
]);

function appSource(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) out.push(fs.readFileSync(full, "utf8"));
    }
  };
  walk(path.join(ROOT, "client/src"));
  return out.join("\n");
}

describe("screen guide", () => {
  it("names every exact label that is really in the app (so it can't drift)", () => {
    const text = screenGuideText();
    const labels = [...new Set([...text.matchAll(/\*\*(.+?)\*\*/g)].map(m => m[1]))];
    expect(labels.length).toBeGreaterThan(150);
    const src = appSource();
    const missing = labels.filter(l => !BUILT_LABELS.has(l) && !src.includes(l));
    expect(missing).toEqual([]);
  });

  it("has a section for every page in the app menu", () => {
    const text = screenGuideText();
    const home = fs.readFileSync(path.join(ROOT, "client/src/pages/Home.tsx"), "utf8");
    const nav = home.slice(home.indexOf("const nav:"), home.indexOf("];", home.indexOf("const nav:")));
    const retired = ["evidence", "sites"]; // RETIRED_VIEWS in client/src/domain/pageNavigation.ts
    const titles = [...nav.matchAll(/id: "([^"]+)",\s*title: "([^"]+)"/g)]
      .filter(m => !retired.includes(m[1]))
      .map(m => m[2]);
    expect(titles.length).toBeGreaterThan(30);
    const missing = titles.filter(t => !text.includes(`**${t}**`));
    expect(missing).toEqual([]);
  });

  it("covers the owner's walks", () => {
    const walks = guideSections(screenGuideText()).filter(s => s.heading.startsWith("Walk: ")).map(s => s.heading);
    for (const w of [
      "Walk: Do the Weekly Review",
      "Walk: Confirm a suggested link",
      "Walk: Link work to an Imperative",
      "Walk: Not yet",
      "Walk: Make a project Support",
      "Walk: Edit an Imperative's title and reason",
      "Walk: Link an Imperative to a Pillar",
      "Walk: Set an Imperative's decision",
      "Walk: Add a Pillar with its definition",
      "Walk: Add a Value Goal",
      "Walk: Add a Goal Outcome",
      "Walk: Move today's block",
      "Walk: Start a list run, tick, finish",
      "Walk: Log a service",
      "Walk: Enter an odometer reading",
      "Walk: Set a place's Allow to get there time",
      "Walk: Add an idea",
    ])
      expect(walks).toContain(w);
  });

  it("returns one screen with its walks, by name", () => {
    expect(screenNames()).toContain("Screen: Today");
    expect(screenNames()).toContain("Sheet: Task");
    const today = screenFor("Today")!;
    expect(today.startsWith("## Screen: Today")).toBe(true);
    expect(today).toContain("### Walk: Move today's block");
    expect(today).not.toContain("## Screen: Overview");
    expect(screenFor("task")!.startsWith("## Sheet: Task\n")).toBe(true);
    expect(screenFor("screen: weekly review")).toContain("Save review");
    expect(screenFor("nowhere at all")).toBeNull();
  });
});
