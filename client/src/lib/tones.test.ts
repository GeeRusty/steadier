import { describe, expect, it } from "vitest";
import { alwaysOnFocusToneSettings, DEFAULT_TONES } from "./tones";

describe("automatic task timer tone settings", () => {
  it("bypasses the optional tones switch while preserving other device preferences", () => {
    const result = alwaysOnFocusToneSettings({
      ...DEFAULT_TONES,
      enabled: false,
      volume: 0.35,
      vibrate: false,
      speak: false,
    });

    expect(result.enabled).toBe(true);
    expect(result.volume).toBe(0.35);
    expect(result.vibrate).toBe(false);
    expect(result.speak).toBe(false);
    expect("taskChimes" in result).toBe(false);
  });
});
