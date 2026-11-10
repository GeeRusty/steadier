import { describe, expect, it } from "vitest";
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  normalizeAppearance,
  persistAppearance,
  readAppearance,
} from "./appearance";

describe("appearance preference", () => {
  it("defaults to light and restores dark from local storage", () => {
    expect(readAppearance(() => null)).toBe("light");
    expect(readAppearance(key => (key === APPEARANCE_STORAGE_KEY ? "dark" : null))).toBe("dark");
    expect(normalizeAppearance("unexpected")).toBe("light");
  });

  it("persists only the selected appearance and tolerates blocked storage", () => {
    let saved: [string, string] | undefined;
    persistAppearance("dark", (key, value) => { saved = [key, value]; });
    expect(saved).toEqual([APPEARANCE_STORAGE_KEY, "dark"]);
    expect(() => persistAppearance("light", () => { throw new Error("blocked"); })).not.toThrow();
    expect(readAppearance(() => { throw new Error("blocked"); })).toBe("light");
  });

  it("applies the theme and native browser color scheme", () => {
    const root = { dataset: {}, style: { colorScheme: "" } } as HTMLElement;
    applyAppearance(root, "dark");
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
  });
});
