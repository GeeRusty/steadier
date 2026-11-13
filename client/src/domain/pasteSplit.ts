/**
 * "Paste anything": the owner's checked drafts become ordinary records,
 * exactly as if each had been captured on its own. Nothing here decides for
 * the owner; only ticked drafts are saved.
 */
import { parseCapture } from "./capture";
import { createTask } from "./engine";
import { defaultLeadTimeDays, newObligationDraft, saveObligation } from "./obligations";
import { parseQuickAdd, scheduleFromQuickParse, friendlyDate } from "./quickParse";
import { addShoppingItem, addShoppingList, createShoppingItemId, createShoppingListId } from "./shoppingLists";
import type { DailyLogEntry, Task, Workspace } from "./types";

export type PasteKind = "task" | "idea" | "bill" | "cancel-by" | "note" | "shopping";

export interface PasteDraft {
  kind: PasteKind;
  text: string;
  date: string | null;
  amount: string | null;
  shoppingItems: string[];
}

export const PASTE_KIND_LABEL: Record<PasteKind, string> = {
  task: "Task",
  idea: "Idea",
  bill: "Bill",
  "cancel-by": "Cancel by",
  note: "Note",
  shopping: "Shopping",
};

/** The Split button appears for several lines or long text. */
export function looksLikeSeveralThings(text: string): boolean {
  const lines = text.split(/\n/).map(line => line.trim()).filter(Boolean);
  return lines.length >= 2 || text.trim().length > 160;
}

/** A task built the same way the + box builds one from typed words. */
export function taskFromWords(words: string, today: string, minutes: number, stamp: string): Task {
  const quick = parseQuickAdd(words, today, minutes);
  const parsed = parseCapture(quick.title);
  return createTask({
    ...parsed,
    deadline: quick.deadline ?? parsed.deadline,
    estimate: quick.minutes ?? parsed.estimate,
    schedule: scheduleFromQuickParse(quick),
    state: parsed.state || (parsed.nextAction ? "ready" : "inbox"),
    createdAt: stamp,
    updatedAt: stamp,
    history: [{ at: stamp, text: "Captured from pasted text." }],
  });
}

/** One grey line describing what the draft will become, e.g. "due Fri 14 Nov". */
export function draftWhen(draft: PasteDraft, today: string, minutes: number): string | null {
  if (draft.kind === "task") {
    const quick = parseQuickAdd(draft.text, today, minutes);
    const date = quick.date ?? null;
    if (quick.deadline) return `due ${friendlyDate(quick.deadline, today)}`;
    if (date) return `${friendlyDate(date, today)}${quick.time ? ` ${quick.time}` : ""}`;
    return null;
  }
  if ((draft.kind === "bill" || draft.kind === "cancel-by") && draft.date) {
    return `${draft.kind === "bill" ? "due " : ""}${friendlyDate(draft.date, today)}`;
  }
  if (draft.kind === "shopping") return `${draft.shoppingItems.length} item${draft.shoppingItems.length === 1 ? "" : "s"}`;
  return null;
}

function words(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !["the", "and", "for", "with", "job", "get", "need", "needs"].includes(w))
  );
}

/** A quiet hint only: an open task whose title shares most of the same words. */
export function similarOpenTask(text: string, tasks: Task[]): Task | null {
  const mine = words(text);
  if (mine.size === 0) return null;
  let best: { task: Task; score: number } | null = null;
  for (const task of tasks) {
    if (task.state === "done" || task.droppedAt) continue;
    const theirs = words(task.title);
    if (!theirs.size) continue;
    let shared = 0;
    mine.forEach(w => {
      if (theirs.has(w)) shared += 1;
    });
    const score = shared / Math.min(mine.size, theirs.size);
    if (shared >= 1 && score >= 0.6 && (!best || score > best.score)) best = { task, score };
  }
  return best?.task ?? null;
}

let counter = 0;
const noteId = () =>
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `note-${Date.now().toString(36)}-${(counter += 1)}`;

/** Save the ticked drafts. Bills and cancel-by dates arrive as Obligation drafts. */
export function applyPasteDrafts(
  workspace: Workspace,
  drafts: PasteDraft[],
  today: string,
  minutes: number,
  stamp: string
): Workspace {
  let next = workspace;
  for (const draft of drafts) {
    const text = draft.text.trim();
    if (draft.kind === "task" && text) {
      next = { ...next, tasks: [...next.tasks, taskFromWords(text, today, minutes, stamp)] };
    } else if (draft.kind === "idea" && text) {
      const idea: Task = {
        ...createTask({ title: text, state: "someday", reviewDate: null, createdAt: stamp, updatedAt: stamp }),
        actionConfirmed: false,
        history: [{ at: stamp, text: "Added to the Ideas shelf from pasted text." }],
      };
      next = { ...next, tasks: [...next.tasks, idea] };
    } else if ((draft.kind === "bill" || draft.kind === "cancel-by") && text) {
      const due = draft.date ?? today;
      next = saveObligation(
        next,
        {
          ...newObligationDraft(due, stamp),
          title: text,
          kind: draft.kind,
          dueDate: due,
          cadenceAnchorDate: due,
          leadTimeDays: defaultLeadTimeDays(draft.kind),
          amountDue: draft.amount,
          nextAction: draft.kind === "cancel-by" ? `Decide: keep or cancel ${text}` : "",
        },
        "draft",
        stamp
      );
    } else if (draft.kind === "note" && text) {
      const note: DailyLogEntry = { id: noteId(), date: today, text, createdAt: stamp, updatedAt: stamp };
      next = { ...next, dailyLog: [note, ...(next.dailyLog ?? [])] };
    } else if (draft.kind === "shopping" && draft.shoppingItems.length) {
      const lists = next.shoppingLists ?? [];
      let list = [...lists].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (!list) {
        const id = createShoppingListId();
        next = addShoppingList(next, id, "Shopping", stamp);
        list = (next.shoppingLists ?? []).find(l => l.id === id)!;
      }
      for (const item of draft.shoppingItems) {
        next = addShoppingItem(next, list.id, createShoppingItemId(), item, stamp);
      }
    }
  }
  return next;
}
