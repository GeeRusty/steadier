// Shopping list changes shared by the Claude connector and the voice assistant.
// They reuse the app's own list helpers, so limits and formats match the app.
import {
  addShoppingItem,
  addShoppingList,
  createShoppingItemId,
  createShoppingListId,
  setShoppingItemChecked,
  SHOPPING_ITEM_TEXT_LIMIT,
} from "../../client/src/domain/shoppingLists";
import type { ShoppingList, Workspace } from "../../client/src/domain/types";
import { adelaideTimestamp } from "../../shared/time";
import { ChangeError, type ChangePlan } from "./changes";

export const DEFAULT_SHOPPING_LIST = "Shopping";

function sameTitle(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The list a request means: a named list, else the most recently used one. */
export function findShoppingList(workspace: Workspace, title: string | null): ShoppingList | null {
  const lists = workspace.shoppingLists ?? [];
  if (title && title.trim()) return lists.find(list => sameTitle(list.title, title)) ?? null;
  return [...lists].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

export function presentShoppingLists(workspace: Workspace, includeChecked = false) {
  return (workspace.shoppingLists ?? []).map(list => ({
    listId: list.id,
    title: list.title,
    items: list.items
      .filter(item => includeChecked || !item.checked)
      .map(item => ({ itemId: item.id, text: item.text, checked: item.checked })),
  }));
}

/** Add items to a list, creating the list when it doesn't exist yet. */
export function planAddShoppingItems(
  workspace: Workspace,
  listTitle: string | null,
  items: string[],
  now: Date = new Date()
): ChangePlan<{ listId: string; listTitle: string; added: string[] }> {
  const at = adelaideTimestamp(now);
  const texts = items.map(text => text.trim()).filter(text => text && text.length <= SHOPPING_ITEM_TEXT_LIMIT);
  if (!texts.length) throw new ChangeError("INVALID_CHANGE", "There were no items to add.");

  let next = workspace;
  let list = findShoppingList(next, listTitle);
  if (!list) {
    const id = createShoppingListId();
    next = addShoppingList(next, id, listTitle?.trim() || DEFAULT_SHOPPING_LIST, at);
    list = (next.shoppingLists ?? []).find(candidate => candidate.id === id) ?? null;
    if (!list) throw new ChangeError("INVALID_CHANGE", "A new shopping list couldn't be created.");
  }
  const added: string[] = [];
  for (const text of texts) {
    const before = next;
    next = addShoppingItem(next, list.id, createShoppingItemId(), text, at);
    if (next !== before) added.push(text);
  }
  if (!added.length) throw new ChangeError("INVALID_CHANGE", `The ${list.title} list is full, so nothing was added.`);
  return {
    workspace: next,
    summary: `Added ${added.length} item${added.length === 1 ? "" : "s"} to the ${list.title} list`,
    result: { listId: list.id, listTitle: list.title, added },
  };
}

/** Tick items off (or untick them). */
export function planCheckShoppingItems(
  workspace: Workspace,
  listId: string,
  itemIds: string[],
  checked: boolean,
  now: Date = new Date()
): ChangePlan<{ changed: number }> {
  const at = adelaideTimestamp(now);
  const list = (workspace.shoppingLists ?? []).find(candidate => candidate.id === listId);
  if (!list) throw new ChangeError("NOT_FOUND", "No shopping list with that id.");
  let next = workspace;
  let changed = 0;
  for (const itemId of itemIds) {
    const item = list.items.find(candidate => candidate.id === itemId);
    if (!item || item.checked === checked) continue;
    next = setShoppingItemChecked(next, listId, itemId, checked, at);
    changed += 1;
  }
  if (!changed) throw new ChangeError("INVALID_CHANGE", "Nothing to change: those items were not found or are already set.");
  return {
    workspace: next,
    summary: `${checked ? "Ticked off" : "Unticked"} ${changed} item${changed === 1 ? "" : "s"} on the ${list.title} list`,
    result: { changed },
  };
}
