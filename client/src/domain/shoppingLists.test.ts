import { describe, expect, it } from "vitest";
import { exportBackup, parseBackup, validateWorkspace } from "./transfer";
import {
  addShoppingItem,
  addShoppingList,
  editShoppingItem,
  removeShoppingItem,
  removeShoppingList,
  renameShoppingList,
  setShoppingItemChecked,
} from "./shoppingLists";
import type { Workspace } from "./types";

const STAMP = "2026-10-30T11:00:00+10:30";

function emptyWorkspace(): Workspace {
  return {
    version: 2,
    tasks: [],
    projects: [],
    focus: null,
    intention: null,
    matrixWeights: {
      "direction-timely": 1,
      "direction-sustained": 1,
      "support-timely": 1,
      "support-sustained": 1,
    },
    trial: { startedAt: STAMP, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [],
  };
}

describe("Shopping Lists", () => {
  it("creates, edits, checks, unchecks and removes list items without changing tasks", () => {
    const source = emptyWorkspace();
    const created = addShoppingList(
      source,
      "shopping-list-1",
      "Groceries",
      STAMP
    );
    const withItem = addShoppingItem(
      created,
      "shopping-list-1",
      "item-1",
      "Oat milk",
      STAMP
    );
    const checked = setShoppingItemChecked(
      withItem,
      "shopping-list-1",
      "item-1",
      true,
      STAMP
    );
    const unchecked = setShoppingItemChecked(
      checked,
      "shopping-list-1",
      "item-1",
      false,
      STAMP
    );
    const edited = editShoppingItem(
      unchecked,
      "shopping-list-1",
      "item-1",
      "Oat milk x 2",
      STAMP
    );
    const renamed = renameShoppingList(
      edited,
      "shopping-list-1",
      "Weekly groceries",
      STAMP
    );
    expect(source.shoppingLists).toBeUndefined();
    expect(renamed.tasks).toEqual([]);
    expect(renamed.shoppingLists?.[0]).toMatchObject({
      title: "Weekly groceries",
      items: [{ text: "Oat milk x 2", checked: false }],
    });
    expect(
      removeShoppingItem(renamed, "shopping-list-1", "item-1", STAMP)
        .shoppingLists?.[0].items
    ).toEqual([]);
    expect(
      removeShoppingList(renamed, "shopping-list-1").shoppingLists
    ).toEqual([]);
  });

  it("round-trips through workspace backups and rejects unknown item fields", () => {
    const withList = addShoppingList(
      emptyWorkspace(),
      "shopping-list-1",
      "Groceries",
      STAMP
    );
    const withItem = addShoppingItem(
      withList,
      "shopping-list-1",
      "item-1",
      "Bread",
      STAMP
    );
    expect(parseBackup(exportBackup(withItem))).toEqual(withItem);
    const malformed = {
      ...withItem,
      shoppingLists: [
        {
          ...withItem.shoppingLists![0],
          items: [
            {
              ...withItem.shoppingLists![0].items[0],
              paymentToken: "not allowed",
            },
          ],
        },
      ],
    };
    expect(() => validateWorkspace(malformed)).toThrow();
  });
});
