import { addDays, today, daysUntil } from "./engine";
import type { Context, Task } from "./types";

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function nextWeekday(day: string, weekday: number): string {
  const reference = new Date(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
    12
  );
  const distance = (weekday - reference.getDay() + 7) % 7;
  return addDays(day, distance);
}

function cleanTitle(value: string): string {
  return value
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, "")
    .trim();
}

/**
 * Turn a short capture into a reviewable draft. Recognition is intentionally
 * narrow: casual phrases such as "call tomorrow" stay in the title unless the
 * person explicitly says due/by, so a capture never gains a made-up deadline.
 */
export function parseCapture(
  text: string,
  now?: string
): Partial<Task> & { title: string } {
  const day = now ?? today();
  const original = text.trim();
  let remainder = original;
  const parsed: Partial<Task> = { deadline: null };

  for (const role of ["direction", "support"] as const) {
    const tag = new RegExp(`#${role}\\b`, "gi");
    if (tag.test(remainder)) {
      parsed.role = role;
      remainder = remainder.replace(tag, " ");
    }
  }
  for (const pattern of ["timely", "sustained"] as const) {
    const tag = new RegExp(`#${pattern}\\b`, "gi");
    if (tag.test(remainder)) {
      parsed.pattern = pattern;
      remainder = remainder.replace(tag, " ");
    }
  }
  if (parsed.role && parsed.pattern) parsed.labelSource = "confirmed";

  // These tags set only the Context now (Area was removed).
  const tagRules: Array<{ tag: RegExp; context: Context }> = [
    { tag: /#home\b/gi, context: "home" },
    { tag: /#vehicles?\b/gi, context: "out" },
    { tag: /#business\b/gi, context: "computer" },
    { tag: /#personal\b/gi, context: "anywhere" },
  ];
  for (const rule of tagRules) {
    if (rule.tag.test(remainder)) {
      parsed.context = rule.context;
      remainder = remainder.replace(rule.tag, " ");
    }
  }

  // Natural language context is deliberately limited to the exact phrase.
  if (/\bin\s+(?:the\s+)?home\b/i.test(remainder)) {
    parsed.context = "home";
  }

  const nextMatch = /(?:^|\s)next:\s*([\s\S]+)$/i.exec(remainder);
  if (nextMatch) {
    const nextAction = cleanTitle(nextMatch[1]);
    if (nextAction) parsed.nextAction = nextAction;
    remainder = remainder.slice(0, nextMatch.index).trim();
  }

  const dateMatch =
    /\b(?:due|by)\s+(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d{4}-\d{2}-\d{2})\b/i.exec(
      remainder
    );
  if (dateMatch) {
    const value = dateMatch[1].toLowerCase();
    if (value === "today") parsed.deadline = day;
    else if (value === "tomorrow") parsed.deadline = addDays(day, 1);
    else if (value in WEEKDAYS)
      parsed.deadline = nextWeekday(day, WEEKDAYS[value]);
    else {
      try {
        daysUntil(value, day);
        parsed.deadline = value;
      } catch {
        parsed.deadline = null;
      }
    }
    if (parsed.deadline)
      remainder = `${remainder.slice(0, dateMatch.index)} ${remainder.slice(dateMatch.index + dateMatch[0].length)}`;
  }

  const estimateMatch = /\b(\d{1,4})\s*(?:minutes?|mins?|min|m)\b/i.exec(
    remainder
  );
  if (estimateMatch) {
    const estimate = Number(estimateMatch[1]);
    if (estimate > 0 && estimate <= 1440) parsed.estimate = estimate;
    remainder = `${remainder.slice(0, estimateMatch.index)} ${remainder.slice(estimateMatch.index + estimateMatch[0].length)}`;
  }


  // Only call it waiting when a person/reason was captured. A bare "waiting"
  // remains title text rather than changing task workflow without context.
  const waitingMatch = /\bwaiting\s+(?:for|on)\s+([^,.;]+)(?=$|[,.;])/i.exec(
    remainder
  );
  if (waitingMatch) {
    const waitingFor = cleanTitle(waitingMatch[1]);
    if (waitingFor) {
      parsed.state = "waiting";
      parsed.waitingFor = waitingFor;
      remainder = `${remainder.slice(0, waitingMatch.index)} ${remainder.slice(
        waitingMatch.index + waitingMatch[0].length
      )}`;
    }
  }

  return {
    ...parsed,
    // If a capture was solely syntax, retain its original text rather than
    // manufacturing a generic title and losing what was typed.
    title: cleanTitle(remainder) || original,
  };
}

/**
 * Insert a captured task once, then replace that same draft during autosave.
 * A background save must not duplicate a task or reset its original history.
 */
export function upsertCapturedTask(tasks: Task[], draft: Task): Task[] {
  const existing = tasks.find(task => task.id === draft.id);
  if (!existing) return [draft, ...tasks];

  const updated = {
    ...draft,
    createdAt: existing.createdAt,
    history: existing.history,
  };
  if (JSON.stringify(existing) === JSON.stringify(updated)) return tasks;
  return tasks.map(task => (task.id === draft.id ? updated : task));
}

/** Flush a pending typed capture when a WebView is backgrounded or navigated away. */
export function installCaptureDraftFlush(
  documentTarget: EventTarget & { visibilityState: DocumentVisibilityState },
  windowTarget: EventTarget,
  flush: () => unknown
): () => void {
  const onVisibilityChange = () => {
    if (documentTarget.visibilityState === "hidden") flush();
  };
  const onPageHide = () => flush();

  documentTarget.addEventListener("visibilitychange", onVisibilityChange);
  windowTarget.addEventListener("pagehide", onPageHide);
  return () => {
    documentTarget.removeEventListener("visibilitychange", onVisibilityChange);
    windowTarget.removeEventListener("pagehide", onPageHide);
  };
}
