import type { View } from "./types";

/**
 * The five bottom tabs (design language: screen jobs). Today and Overview are
 * the two halves of the "attention" view. Backups and Compass live in the menu;
 * Compass is also linked from Overview.
 */
export interface MobileTab {
  key: "today" | "overview" | "all" | "calendar" | "projects";
  view: View;
  todayTab?: "today" | "overview";
  label: string;
}

export const MOBILE_TABS: readonly MobileTab[] = [
  { key: "today", view: "attention", todayTab: "today", label: "Today" },
  { key: "overview", view: "attention", todayTab: "overview", label: "Overview" },
  { key: "all", view: "all", label: "All work" },
  { key: "calendar", view: "calendar", label: "Calendar" },
  { key: "projects", view: "projects", label: "Projects" },
];

export const MOBILE_QUICK_NAV_IDS = ["attention", "all", "calendar", "projects"] as const satisfies readonly View[];
