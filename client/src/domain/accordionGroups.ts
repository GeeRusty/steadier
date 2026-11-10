export interface AccordionGroup<T> {
  key: string;
  label: string;
  items: T[];
}

/** Group without sorting: group order and item order follow the source list. */
export function groupByStable<T>(
  items: readonly T[],
  getGroup: (item: T) => { key: string; label: string }
): AccordionGroup<T>[] {
  const groups = new Map<string, AccordionGroup<T>>();
  for (const item of items) {
    const identity = getGroup(item);
    const group = groups.get(identity.key);
    if (group) group.items.push(item);
    else groups.set(identity.key, { ...identity, items: [item] });
  }
  return [...groups.values()];
}

export function monthGroup(value: string | null | undefined): {
  key: string;
  label: string;
} {
  const date = value?.slice(0, 10) ?? "";
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!match) return { key: "undated", label: "Undated" };
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return { key: "undated", label: "Undated" };
  const label = new Intl.DateTimeFormat("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 15, 12)));
  return { key: `${match[1]}-${match[2]}`, label };
}
