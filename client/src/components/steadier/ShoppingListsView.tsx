import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import {
  Check,
  ListPlus,
  Mic,
  Pencil,
  Plus,
  Save,
  ShoppingCart,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { adelaideTimestamp } from "../../../../shared/time";
import {
  addShoppingItem,
  addShoppingList,
  createShoppingItemId,
  createShoppingListId,
  editShoppingItem,
  MAX_SHOPPING_ITEMS_PER_LIST,
  MAX_SHOPPING_ITEMS_TOTAL,
  MAX_SHOPPING_LISTS,
  removeShoppingItem,
  removeShoppingList,
  renameShoppingList,
  setShoppingItemChecked,
  SHOPPING_ITEM_TEXT_LIMIT,
  SHOPPING_LIST_TITLE_LIMIT,
} from "../../domain/shoppingLists";
import type { ShoppingList, Workspace } from "../../domain/types";
import type { VoiceControls } from "../../hooks/useVoice";
import { groupByStable } from "../../domain/accordionGroups";
import AccordionSection from "./AccordionSection";

interface Props {
  workspace: Workspace;
  readOnly: boolean;
  voice: VoiceControls;
  onMutate: (update: (workspace: Workspace) => Workspace) => boolean;
}

type PendingDelete =
  | { kind: "list"; listId: string; title: string }
  | { kind: "item"; listId: string; itemId: string; title: string };

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Adelaide",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function ShoppingListsView({
  workspace,
  readOnly,
  voice,
  onMutate,
}: Props) {
  const lists = workspace.shoppingLists ?? [];
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [newListTitle, setNewListTitle] = useState("");
  const [listTitleDraft, setListTitleDraft] = useState("");
  const [itemDraft, setItemDraft] = useState("");
  const [dictating, setDictating] = useState(false);
  const [draftSource, setDraftSource] = useState<"typed" | "voice">("typed");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemDraft, setEditingItemDraft] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null
  );
  const [statusMessage, setStatusMessage] = useState("");

  const selectedList =
    lists.find(list => list.id === selectedListId) ?? lists[0] ?? null;

  useEffect(() => {
    if (selectedList?.id !== selectedListId) {
      setSelectedListId(selectedList?.id ?? null);
    }
  }, [selectedList?.id, selectedListId]);

  useEffect(() => {
    setListTitleDraft(selectedList?.title ?? "");
    setEditingItemId(null);
    setEditingItemDraft("");
    setItemSearch("");
  }, [selectedList?.id, selectedList?.title]);

  useEffect(() => {
    voice.abort();
    voice.clear();
    setItemDraft("");
    setDictating(false);
    setDraftSource("typed");
  }, [selectedList?.id, voice.abort, voice.clear]);

  useEffect(() => {
    if (dictating && voice.transcript) setItemDraft(voice.transcript);
  }, [dictating, voice.transcript]);

  useEffect(
    () => () => {
      voice.abort();
      voice.clear();
      voice.stopSpeaking();
    },
    [voice.abort, voice.clear, voice.stopSpeaking]
  );

  const totalItems = useMemo(
    () => lists.reduce((sum, list) => sum + list.items.length, 0),
    [lists]
  );
  const sortedItems = useMemo(
    () =>
      selectedList
        ? [...selectedList.items].sort(
            (left, right) =>
              Number(left.checked) - Number(right.checked) ||
              left.createdAt.localeCompare(right.createdAt)
          )
        : [],
    [selectedList]
  );
  const visibleItems = useMemo(() => {
    const needle = itemSearch.trim().toLocaleLowerCase("en-AU");
    return sortedItems.filter(
      item => !needle || item.text.toLocaleLowerCase("en-AU").includes(needle)
    );
  }, [sortedItems, itemSearch]);
  const itemGroups = groupByStable(visibleItems, item => ({
    key: item.checked ? "checked" : "unchecked",
    label: item.checked ? "Checked" : "To get",
  }));
  const transcriptPending =
    dictating &&
    (voice.listening ||
      Boolean(voice.interimTranscript.trim()) ||
      !voice.finalTranscript.trim() ||
      voice.finalTranscript.trim() !== itemDraft.trim());

  const mutate = (update: (workspace: Workspace) => Workspace): boolean => {
    if (readOnly || !onMutate(update)) {
      setStatusMessage(
        "Not saved. Check shared sync or recovery status, then try again."
      );
      return false;
    }
    return true;
  };

  const createList = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = newListTitle.trim();
    if (
      !title ||
      title.length > SHOPPING_LIST_TITLE_LIMIT ||
      lists.length >= MAX_SHOPPING_LISTS
    )
      return;
    const id = createShoppingListId();
    if (
      mutate(workspaceValue =>
        addShoppingList(workspaceValue, id, title, adelaideTimestamp())
      )
    ) {
      setSelectedListId(id);
      setNewListTitle("");
      setStatusMessage("List created.");
    }
  };

  const renameList = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedList) return;
    const title = listTitleDraft.trim();
    if (!title || title.length > SHOPPING_LIST_TITLE_LIMIT) return;
    if (
      mutate(workspaceValue =>
        renameShoppingList(
          workspaceValue,
          selectedList.id,
          title,
          adelaideTimestamp()
        )
      )
    ) {
      setStatusMessage("List name saved.");
    }
  };

  const addItem = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !selectedList ||
      !itemDraft.trim() ||
      transcriptPending ||
      voice.listening
    )
      return;
    if (itemDraft.trim().length > SHOPPING_ITEM_TEXT_LIMIT) return;
    if (
      selectedList.items.length >= MAX_SHOPPING_ITEMS_PER_LIST ||
      totalItems >= MAX_SHOPPING_ITEMS_TOTAL
    ) {
      setStatusMessage("This list has reached its item limit.");
      return;
    }
    const id = createShoppingItemId();
    if (
      mutate(workspaceValue =>
        addShoppingItem(
          workspaceValue,
          selectedList.id,
          id,
          itemDraft,
          adelaideTimestamp()
        )
      )
    ) {
      setItemDraft("");
      setDictating(false);
      setDraftSource("typed");
      voice.clear();
      setStatusMessage("Item added.");
    }
  };

  const beginDictation = () => {
    voice.clear();
    setDraftSource("voice");
    setDictating(true);
    voice.start();
  };

  const changeItemDraft = (value: string) => {
    if (dictating) voice.abort();
    setDictating(false);
    setDraftSource("typed");
    setItemDraft(value);
  };

  const saveItemEdit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedList || !editingItemId || !editingItemDraft.trim()) return;
    if (editingItemDraft.trim().length > SHOPPING_ITEM_TEXT_LIMIT) return;
    if (
      mutate(workspaceValue =>
        editShoppingItem(
          workspaceValue,
          selectedList.id,
          editingItemId,
          editingItemDraft,
          adelaideTimestamp()
        )
      )
    ) {
      setEditingItemId(null);
      setEditingItemDraft("");
      setStatusMessage("Item updated.");
    }
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const accepted =
      pendingDelete.kind === "list"
        ? mutate(workspaceValue =>
            removeShoppingList(workspaceValue, pendingDelete.listId)
          )
        : mutate(workspaceValue =>
            removeShoppingItem(
              workspaceValue,
              pendingDelete.listId,
              pendingDelete.itemId,
              adelaideTimestamp()
            )
          );
    if (accepted) {
      if (
        pendingDelete.kind === "list" &&
        selectedListId === pendingDelete.listId
      ) {
        setSelectedListId(null);
      }
      setStatusMessage(
        pendingDelete.kind === "list" ? "List removed." : "Item removed."
      );
    }
    setPendingDelete(null);
  };

  const toggleChecked = (itemId: string, checked: boolean) => {
    if (!selectedList) return;
    if (
      mutate(workspaceValue =>
        setShoppingItemChecked(
          workspaceValue,
          selectedList.id,
          itemId,
          checked,
          adelaideTimestamp()
        )
      )
    ) {
      setStatusMessage(checked ? "Item checked." : "Item unchecked.");
    }
  };

  const canAddItem =
    !readOnly &&
    Boolean(selectedList) &&
    itemDraft.trim().length > 0 &&
    itemDraft.trim().length <= SHOPPING_ITEM_TEXT_LIMIT &&
    !transcriptPending &&
    !voice.listening &&
    Boolean(
      selectedList && selectedList.items.length < MAX_SHOPPING_ITEMS_PER_LIST
    ) &&
    totalItems < MAX_SHOPPING_ITEMS_TOTAL;

  return (
    <section className="shopping-view" aria-labelledby="shopping-title">
      <header className="page-heading">
        <div>
          <p className="eyebrow">PRACTICAL · OWNER-MAINTAINED</p>
          <h1 id="shopping-title">Shopping Lists</h1>
          <p className="muted">
            Keep simple lists. Checking an item does not complete a task.
          </p>
        </div>
        <span className="shopping-count">
          {totalItems} / {MAX_SHOPPING_ITEMS_TOTAL} items
        </span>
      </header>

      <p className="notice shopping-safety">
        Lists sync with your Steadier workspace and its backups, but are not
        included in Claude or ChatGPT context. Plain text only: no prices,
        purchases, receipts, item sharing or store integrations. Voice is
        optional and never adds an item until you confirm Add item.
      </p>

      <div className="shopping-layout">
        <aside className="shopping-sidebar" aria-label="Shopping lists">
          <form className="shopping-new-list" onSubmit={createList}>
            <label className="field">
              <span>New list</span>
              <input
                value={newListTitle}
                onChange={event => setNewListTitle(event.target.value)}
                maxLength={SHOPPING_LIST_TITLE_LIMIT}
                placeholder="For example, groceries"
                disabled={readOnly || lists.length >= MAX_SHOPPING_LISTS}
              />
            </label>
            <button
              className="button primary"
              type="submit"
              disabled={
                readOnly ||
                !newListTitle.trim() ||
                lists.length >= MAX_SHOPPING_LISTS
              }
            >
              <ListPlus size={15} /> Create list
            </button>
          </form>
          <div className="shopping-list-nav">
            {lists.map(list => (
              <div
                className={`shopping-list-nav-row ${selectedList?.id === list.id ? "active" : ""}`}
                key={list.id}
              >
                <button
                  type="button"
                  className="shopping-list-select"
                  onClick={() => setSelectedListId(list.id)}
                  aria-current={
                    selectedList?.id === list.id ? "page" : undefined
                  }
                >
                  <span>{list.title}</span>
                  <span className="small muted">
                    {list.items.filter(item => !item.checked).length} left
                  </span>
                </button>
                {!readOnly && (
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Remove ${list.title}`}
                    onClick={() =>
                      setPendingDelete({
                        kind: "list",
                        listId: list.id,
                        title: list.title,
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
            {lists.length === 0 && (
              <p className="small muted">Create a list to begin.</p>
            )}
          </div>
        </aside>

        <section
          className="shopping-items-panel"
          aria-label={
            selectedList ? `${selectedList.title} items` : "List items"
          }
        >
          {selectedList ? (
            <>
              {!readOnly && (
                <form className="shopping-rename" onSubmit={renameList}>
                  <label className="field">
                    <span>List name</span>
                    <input
                      value={listTitleDraft}
                      onChange={event => setListTitleDraft(event.target.value)}
                      maxLength={SHOPPING_LIST_TITLE_LIMIT}
                    />
                  </label>
                  <button
                    className="button"
                    type="submit"
                    disabled={
                      !listTitleDraft.trim() ||
                      listTitleDraft.trim() === selectedList.title
                    }
                  >
                    <Save size={14} /> Save name
                  </button>
                </form>
              )}
              <div className="shopping-list-heading">
                <div>
                  <p className="eyebrow">
                    {selectedList.items.filter(item => !item.checked).length} TO
                    GET ·{" "}
                    {selectedList.items.filter(item => item.checked).length}{" "}
                    CHECKED
                  </p>
                  <h2>{selectedList.title}</h2>
                </div>
                <time dateTime={selectedList.updatedAt}>
                  Updated {shortDate(selectedList.updatedAt)}
                </time>
              </div>

              {!readOnly && (
                <form className="shopping-add-item" onSubmit={addItem}>
                  <label className="field">
                    <span>Add an item</span>
                    <input
                      value={itemDraft}
                      onChange={event => changeItemDraft(event.target.value)}
                      maxLength={SHOPPING_ITEM_TEXT_LIMIT}
                      placeholder="For example, oat milk"
                      disabled={
                        selectedList.items.length >=
                          MAX_SHOPPING_ITEMS_PER_LIST ||
                        totalItems >= MAX_SHOPPING_ITEMS_TOTAL
                      }
                    />
                  </label>
                  <div className="shopping-add-actions">
                    <button
                      type="button"
                      className="button"
                      onClick={beginDictation}
                      disabled={
                        !voice.supported ||
                        voice.listening ||
                        readOnly ||
                        !selectedList
                      }
                    >
                      <Mic size={14} /> Dictate item
                    </button>
                    {voice.listening && dictating && (
                      <button
                        type="button"
                        className="button"
                        onClick={voice.stop}
                      >
                        <Square size={13} /> Stop
                      </button>
                    )}
                    <button
                      className="button primary"
                      type="submit"
                      disabled={!canAddItem}
                    >
                      <Plus size={14} /> Add item
                    </button>
                  </div>
                  <p className="small muted">
                    Recognised words remain editable. Nothing is added until you
                    press Add item.
                  </p>
                  {voice.error && (
                    <p className="form-error" role="alert">
                      {voice.error}
                    </p>
                  )}
                  {draftSource === "voice" && transcriptPending && (
                    <p className="small" role="status">
                      Waiting for the final voice transcript…
                    </p>
                  )}
                </form>
              )}

              {sortedItems.length > 0 && (
                <label className="field accordion-search shopping-item-search">
                  <span>Search this list</span>
                  <input
                    type="search"
                    value={itemSearch}
                    onChange={event => setItemSearch(event.target.value)}
                    placeholder="Find an item"
                  />
                </label>
              )}
              {visibleItems.length ? (
                <div className="accordion-group-list shopping-item-groups">
                  {itemGroups.map(group => (
                    <AccordionSection
                      key={group.key}
                      persistenceKey={group.key}
                      title={group.label}
                      count={group.items.length}
                      collapsible={visibleItems.length > 5}
                      defaultOpen={group.key === "unchecked"}
                      revealToken={
                        itemSearch && group.items.length ? itemSearch : ""
                      }
                      className="shopping-item-group"
                    >
                <ul className="shopping-item-list">
                        {group.items.map(item => (
                    <li
                      className={`shopping-item ${item.checked ? "checked" : ""}`}
                      key={item.id}
                    >
                      {editingItemId === item.id ? (
                        <form
                          className="shopping-item-edit"
                          onSubmit={saveItemEdit}
                        >
                          <label
                            className="visually-hidden"
                            htmlFor={`edit-${item.id}`}
                          >
                            Edit {item.text}
                          </label>
                          <input
                            id={`edit-${item.id}`}
                            value={editingItemDraft}
                            maxLength={SHOPPING_ITEM_TEXT_LIMIT}
                            onChange={event =>
                              setEditingItemDraft(event.target.value)
                            }
                          />
                          <button
                            className="icon-button"
                            type="submit"
                            aria-label="Save item"
                            disabled={!editingItemDraft.trim()}
                          >
                            <Save size={15} />
                          </button>
                          <button
                            className="icon-button"
                            type="button"
                            aria-label="Cancel edit"
                            onClick={() => {
                              setEditingItemId(null);
                              setEditingItemDraft("");
                            }}
                          >
                            <X size={15} />
                          </button>
                        </form>
                      ) : (
                        <>
                          <label className="shopping-item-check">
                            <input
                              type="checkbox"
                              checked={item.checked}
                              disabled={readOnly}
                              onChange={event =>
                                      toggleChecked(
                                        item.id,
                                        event.target.checked
                                      )
                              }
                            />
                            <span
                              className="shopping-item-mark"
                              aria-hidden="true"
                            >
                              {item.checked ? <Check size={14} /> : null}
                            </span>
                            <span className="shopping-item-text">
                              {item.text}
                            </span>
                          </label>
                          <time
                            className="small muted"
                            dateTime={item.updatedAt}
                          >
                            {shortDate(item.updatedAt)}
                          </time>
                          {!readOnly && (
                            <div className="shopping-item-actions">
                              <button
                                className="icon-button"
                                type="button"
                                aria-label={`Edit ${item.text}`}
                                onClick={() => {
                                  setEditingItemId(item.id);
                                  setEditingItemDraft(item.text);
                                }}
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                className="icon-button"
                                type="button"
                                aria-label={`Remove ${item.text}`}
                                onClick={() =>
                                  setPendingDelete({
                                    kind: "item",
                                    listId: selectedList.id,
                                    itemId: item.id,
                                    title: item.text,
                                  })
                                }
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                    </AccordionSection>
                  ))}
                </div>
              ) : (
                <div className="empty-state shopping-empty">
                  <ShoppingCart size={28} />
                  <h2>
                    {itemSearch
                      ? "No items match this search"
                      : "This list is empty"}
                  </h2>
                  <p>
                    {itemSearch
                      ? "Try another word or clear the search."
                      : "Add an item when you are ready. It will not become a task."}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state shopping-empty">
              <ShoppingCart size={28} />
              <h2>No list selected</h2>
              <p>
                Create a list on the left. Your existing tasks remain separate.
              </p>
            </div>
          )}
          {statusMessage && (
            <p className="small" role="status">
              {statusMessage}
            </p>
          )}
        </section>
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={open => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.kind === "list"
                ? "Remove this shopping list?"
                : "Remove this item?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === "list"
                ? `“${pendingDelete.title}” and its items will be removed from this shared workspace.`
                : `“${pendingDelete?.title ?? "This item"}” will be removed from the list.`}{" "}
              This cannot be undone here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={event => {
                event.preventDefault();
                confirmDelete();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
