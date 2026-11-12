import type { View } from "./types";

/** Static headings only: every destination remains a direct, one-tap link. */
export const PAGE_NAVIGATION_SECTIONS: readonly {
  title: string;
  ids: readonly View[];
}[] = [
  {
    title: "Start here",
    ids: ["attention", "all", "sort", "ideas", "calendar", "review", "weekly", "command-centre"],
  },
  {
    title: "Imperatives",
    ids: [
      "imperatives",
      "linkcheck",
      "compass-view",
      "projects",
      "map",
      "compass-directory",
      "matrix",
      "time",
    ],
  },
  {
    title: "Work and follow-ups",
    ids: ["waiting", "pipeline", "obligations", "people", "near", "progress"],
  },
  {
    title: "Reference and records",
    ids: [
      "journal",
      "decisions",
      "evidence",
      "sites",
      "shopping",
      "assets",
      "credentialRenewals",
      "invoices",
    ],
  },
  {
    title: "Planning tools",
    ids: ["routine", "yearWheel", "moveEnergy", "weather"],
  },
  {
    title: "Settings and data",
    ids: ["settings", "cloud", "sheet"],
  },
];

export interface PageNavigationGroup<T> {
  title: string;
  items: T[];
}

/**
 * Arrange existing menu entries into readable groups, preserving all unknown
 * future entries in a final group instead of silently hiding a new route.
 */
export function groupPageNavigation<T extends { id: View }>(
  items: readonly T[]
): PageNavigationGroup<T>[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const used = new Set<View>();
  const groups = PAGE_NAVIGATION_SECTIONS.map(section => {
    const sectionItems = section.ids.flatMap(id => {
      const item = byId.get(id);
      if (!item || used.has(id)) return [];
      used.add(id);
      return [item];
    });
    return { title: section.title, items: sectionItems };
  }).filter(group => group.items.length > 0);

  const additionalItems = items.filter(item => !used.has(item.id));
  if (additionalItems.length)
    groups.push({ title: "More pages", items: additionalItems });

  return groups;
}
