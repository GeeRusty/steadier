import { describe, expect, it } from "vitest";
import { MOBILE_QUICK_NAV_IDS, MOBILE_TABS } from "./mobileQuickNavigation";

describe("mobile quick navigation", () => {
  it("has five tabs: Today, Overview, All work, Calendar, Projects", () => {
    expect(MOBILE_TABS.map(t => t.label)).toEqual(["Today", "Overview", "All work", "Calendar", "Projects"]);
    expect(MOBILE_QUICK_NAV_IDS).toEqual(["attention", "all", "calendar", "projects"]);
  });
});
