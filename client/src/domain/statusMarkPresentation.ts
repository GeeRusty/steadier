const DARK_INK = "#26382F";
const LIGHT_INK = "#FFFFFF";
const STATUS_MARK_SURFACE_TINT = 0.1;

/** Blend a live mark hue lightly into the white card surface. */
export function statusMarkSurfaceBackground(markColor: string): string {
  if (!/^#[\da-f]{6}$/i.test(markColor)) return "#FFFFFF";
  const channels = [1, 3, 5].map(start =>
    Number.parseInt(markColor.slice(start, start + 2), 16)
  );
  return `#${channels
    .map(channel =>
      Math.round(
        channel * STATUS_MARK_SURFACE_TINT +
          255 * (1 - STATUS_MARK_SURFACE_TINT)
      )
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`.toUpperCase();
}

function relativeLuminance(hex: string): number {
  if (!/^#[\da-f]{6}$/i.test(hex)) return 0;
  const channels = [1, 3, 5].map(start => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first: number, second: number): number {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Choose black or white text/arrow ink with the stronger contrast on a card fill. */
export function statusMarkCardInk(fill: string): string {
  const fillLuminance = relativeLuminance(fill);
  const darkContrast = contrastRatio(
    fillLuminance,
    relativeLuminance(DARK_INK)
  );
  const lightContrast = contrastRatio(
    fillLuminance,
    relativeLuminance(LIGHT_INK)
  );
  return lightContrast > darkContrast ? LIGHT_INK : DARK_INK;
}
