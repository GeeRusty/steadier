import { describe, expect, it } from "vitest";
import { STATUS_MARK_COLOR_HEX } from "./statusMarkColor";
import { statusMarkColorAfterReviewFade } from "./statusMarkStaleness";
import {
  statusMarkCardInk,
  statusMarkSurfaceBackground,
} from "./statusMarkPresentation";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(start => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("Status Mark full-card foreground contrast", () => {
  it("uses distinct subtle full-card tints instead of separate color squares", () => {
    const surfaces = Object.keys(STATUS_MARK_COLOR_HEX).map(color =>
      statusMarkSurfaceBackground(
        STATUS_MARK_COLOR_HEX[color as keyof typeof STATUS_MARK_COLOR_HEX]
      )
    );
    expect(statusMarkSurfaceBackground("#009F55")).toBe("#E6F5EE");
    expect(new Set(surfaces).size).toBe(5);
    expect(surfaces).not.toContain("#FFFFFF");
  });

  it("keeps card text at 4.5:1 and the side arrow at 3:1 across every fade day", () => {
    for (const color of Object.keys(STATUS_MARK_COLOR_HEX) as Array<
      keyof typeof STATUS_MARK_COLOR_HEX
    >) {
      for (let daysSinceReview = 0; daysSinceReview <= 14; daysSinceReview++) {
        const arrow = statusMarkColorAfterReviewFade(color, daysSinceReview);
        const surface = statusMarkSurfaceBackground(arrow);
        const ink = statusMarkCardInk(surface);
        expect(contrastRatio(surface, ink)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(surface, arrow)).toBeGreaterThanOrEqual(3);
        expect(surface).not.toBe(arrow);
      }
    }
  });
});
