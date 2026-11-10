import type { View } from "./types";

// Preserve Steadier's existing mobile shortcuts and append Compass for direct access.
export const MOBILE_QUICK_NAV_IDS = [
  "attention",
  "calendar",
  "all",
  "projects",
  "settings",
  "compass-view",
] as const satisfies readonly View[];
