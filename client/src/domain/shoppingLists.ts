import type { ShoppingList, Workspace } from "./types";

export const MAX_SHOPPING_LISTS = 100;
export const MAX_SHOPPING_ITEMS_PER_LIST = 500;
export const MAX_SHOPPING_ITEMS_TOTAL = 5000;
export const SHOPPING_LIST_TITLE_LIMIT = 120;
export const SHOPPING_ITEM_TEXT_LIMIT = 300;

function idToken(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createShoppingListId(): string {
  return `shopping-list-${idToken()}`;
}

export function createShoppingItemId(): string {
  return `shopping-item-${idToken()}`;
}

function validText(value: string, limit: number): string | null {
  const text = value.trim();
  return text.length > 0 && text.length <= limit ? text : null;
}

function itemsTotal(lists: ShoppingList[]): number {
  return lists.reduce((total, list) => total + list.items.length, 0);
}

export function addShoppingList(
  workspace: Workspace,
  id: string,
  title: string,
  at: string
): Workspace {
  const normalized = validText(title, SHOPPING_LIST_TITLE_LIMIT);
  const lists = workspace.shoppingLists ?? [];
  if (
    !normalized ||
    lists.length >= MAX_SHOPPING_LISTS ||
    lists.some(list => list.id === id)
  ) {
    return workspace;
  }
  return {
    ...workspace,
    shoppingLists: [
      { id, title: normalized, items: [], createdAt: at, updatedAt: at },
      ...lists,
    ],
  };
}

export function renameShoppingList(
  workspace: Workspace,
  listId: string,
  title: string,
  at: string
): Workspace {
  const normalized = validText(title, SHOPPING_LIST_TITLE_LIMIT);
  const lists = workspace.shoppingLists ?? [];
  if (!normalized || !lists.some(list => list.id === listId)) return workspace;
  return {
    ...workspace,
    shoppingLists: lists.map(list =>
      list.id === listId ? { ...list, title: normalized, updatedAt: at } : list
    ),
  };
}

export function addShoppingItem(
  workspace: Workspace,
  listId: string,
  itemId: string,
  text: string,
  at: string
): Workspace {
  const normalized = validText(text, SHOPPING_ITEM_TEXT_LIMIT);
  const lists = workspace.shoppingLists ?? [];
  const list = lists.find(item => item.id === listId);
  if (
    !normalized ||
    !list ||
    list.items.length >= MAX_SHOPPING_ITEMS_PER_LIST ||
    itemsTotal(lists) >= MAX_SHOPPING_ITEMS_TOTAL ||
    lists.some(candidate => candidate.items.some(item => item.id === itemId))
  ) {
    return workspace;
  }
  const newItem = {
    id: itemId,
    text: normalized,
    checked: false,
    createdAt: at,
    updatedAt: at,
  };
  return {
    ...workspace,
    shoppingLists: lists.map(candidate =>
      candidate.id === listId
        ? { ...candidate, items: [...candidate.items, newItem], updatedAt: at }
        : candidate
    ),
  };
}

export function editShoppingItem(
  workspace: Workspace,
  listId: string,
  itemId: string,
  text: string,
  at: string
): Workspace {
  const normalized = validText(text, SHOPPING_ITEM_TEXT_LIMIT);
  const lists = workspace.shoppingLists ?? [];
  if (
    !normalized ||
    !lists.some(
      list => list.id === listId && list.items.some(item => item.id === itemId)
    )
  ) {
    return workspace;
  }
  return {
    ...workspace,
    shoppingLists: lists.map(list =>
      list.id === listId
        ? {
            ...list,
            updatedAt: at,
            items: list.items.map(item =>
              item.id === itemId
                ? { ...item, text: normalized, updatedAt: at }
                : item
            ),
          }
        : list
    ),
  };
}

export function setShoppingItemChecked(
  workspace: Workspace,
  listId: string,
  itemId: string,
  checked: boolean,
  at: string
): Workspace {
  const lists = workspace.shoppingLists ?? [];
  if (
    !lists.some(
      list =>
        list.id === listId &&
        list.items.some(item => item.id === itemId && item.checked !== checked)
    )
  ) {
    return workspace;
  }
  return {
    ...workspace,
    shoppingLists: lists.map(list =>
      list.id === listId
        ? {
            ...list,
            updatedAt: at,
            items: list.items.map(item =>
              item.id === itemId ? { ...item, checked, updatedAt: at } : item
            ),
          }
        : list
    ),
  };
}

export function removeShoppingItem(
  workspace: Workspace,
  listId: string,
  itemId: string,
  at: string
): Workspace {
  const lists = workspace.shoppingLists ?? [];
  if (
    !lists.some(
      list => list.id === listId && list.items.some(item => item.id === itemId)
    )
  ) {
    return workspace;
  }
  return {
    ...workspace,
    shoppingLists: lists.map(list =>
      list.id === listId
        ? {
            ...list,
            updatedAt: at,
            items: list.items.filter(item => item.id !== itemId),
          }
        : list
    ),
  };
}

export function removeShoppingList(
  workspace: Workspace,
  listId: string
): Workspace {
  const lists = workspace.shoppingLists ?? [];
  if (!lists.some(list => list.id === listId)) return workspace;
  return {
    ...workspace,
    shoppingLists: lists.filter(list => list.id !== listId),
  };
}
