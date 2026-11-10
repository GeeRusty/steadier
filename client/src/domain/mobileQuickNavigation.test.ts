import { describe, expect, it } from "vitest";
import { MOBILE_QUICK_NAV_IDS } from "./mobileQuickNavigation";

describe("mobile quick navigation", () => {
  it("keeps existing shortcuts in order and adds direct Compass access", () => {
    expect(MOBILE_QUICK_NAV_IDS).toEqual([
      "attention",
      "calendar",
      "all",
      "projects",
      "settings",
      "compass-view",
    ]);
  });
});
