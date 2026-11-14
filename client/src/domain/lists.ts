// Lists: a template (never ticked) and runs (each use, with its own ticks and
// date). Plain text only. Every change returns a new workspace, or the same
// workspace object when nothing changed (callers treat that as "not saved").
import { adelaideDate } from "../../../shared/time";
import type {
  ListItem,
  ListKind,
  ListLink,
  ListRun,
  ListRunExtra,
  ListRunSnapshotItem,
  ListsStore,
  ListTemplate,
  ShoppingList,
  Workspace,
} from "./types";

export const MAX_LIST_TEMPLATES = 100;
export const MAX_LIST_ITEMS = 500;
export const MAX_LIST_ITEMS_TOTAL = 5000;
export const MAX_LIST_SECTIONS = 30;
export const MAX_RUN_EXTRAS = 100;
export const MAX_FINISHED_RUNS_PER_LIST = 50;
export const MAX_LIST_LINKS = 2000;
export const LIST_TITLE_LIMIT = 120;
export const LIST_ITEM_LIMIT = 300;
export const LIST_USE_WHEN_LIMIT = 200;
export const LIST_SECTION_LIMIT = 80;
/** Sections over this many items get a quiet, non-blocking suggestion to split. */
export const SECTION_SUGGEST_SPLIT = 9;
export const LIST_KINDS: readonly ListKind[] = ["read-do", "do-confirm"];
export const LIST_KIND_LABEL: Record<ListKind, string> = {
  "read-do": "Read-Do",
  "do-confirm": "Do-Confirm",
};
/** Shown behind the info icon. */
export const LIST_WORDING_GUIDE =
  "Word each item as the result to check, not the action: “Gas – off”, not “Check gas”. Keep sections to about 5–9 items. Read-Do: read each step, then do it. Do-Confirm: do it from memory, then go down the list and confirm.";

function idToken(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
export const newListId = () => `list-${idToken()}`;
export const newListItemId = () => `list-item-${idToken()}`;
export const newListSectionId = () => `list-section-${idToken()}`;
export const newListRunId = () => `list-run-${idToken()}`;
export const newListLinkId = () => `list-link-${idToken()}`;

const EMPTY: ListsStore = { templates: [], runs: [], links: [] };

export function listsOf(workspace: Workspace): ListsStore {
  return workspace.lists ?? EMPTY;
}

function withLists(workspace: Workspace, lists: ListsStore): Workspace {
  return { ...workspace, lists };
}

function clean(value: string, limit: number): string | null {
  const text = value.replace(/\s+/g, " ").trim();
  return text && text.length <= limit ? text : null;
}

function totalItems(lists: ListsStore): number {
  return lists.templates.reduce((sum, t) => sum + t.items.length, 0);
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase("en-AU") === b.trim().toLocaleLowerCase("en-AU");
}

export function findTemplate(workspace: Workspace, id: string): ListTemplate | null {
  return listsOf(workspace).templates.find(t => t.id === id) ?? null;
}

export function findTemplateByTitle(workspace: Workspace, title: string): ListTemplate | null {
  return listsOf(workspace).templates.find(t => sameText(t.title, title)) ?? null;
}

/** The run in progress for a template, if any (at most one at a time). */
export function openRun(workspace: Workspace, templateId: string): ListRun | null {
  return listsOf(workspace).runs.find(r => r.templateId === templateId && !r.finishedAt) ?? null;
}

export function finishedRuns(workspace: Workspace, templateId: string): ListRun[] {
  return listsOf(workspace)
    .runs.filter(r => r.templateId === templateId && r.finishedAt)
    .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""));
}

function updateTemplate(
  workspace: Workspace,
  templateId: string,
  change: (template: ListTemplate) => ListTemplate | null
): Workspace {
  const lists = listsOf(workspace);
  const current = lists.templates.find(t => t.id === templateId);
  if (!current) return workspace;
  const next = change(current);
  if (!next || next === current) return workspace;
  return withLists(workspace, { ...lists, templates: lists.templates.map(t => (t.id === templateId ? next : t)) });
}

function updateRun(
  workspace: Workspace,
  runId: string,
  change: (run: ListRun) => ListRun | null
): Workspace {
  const lists = listsOf(workspace);
  const current = lists.runs.find(r => r.id === runId);
  if (!current) return workspace;
  const next = change(current);
  if (!next || next === current) return workspace;
  return withLists(workspace, { ...lists, runs: lists.runs.map(r => (r.id === runId ? next : r)) });
}

// ---------------------------------------------------------------------------
// Templates

export function addTemplate(
  workspace: Workspace,
  id: string,
  title: string,
  at: string,
  kind: ListKind = "do-confirm"
): Workspace {
  const text = clean(title, LIST_TITLE_LIMIT);
  const lists = listsOf(workspace);
  if (!text || lists.templates.length >= MAX_LIST_TEMPLATES || lists.templates.some(t => t.id === id)) return workspace;
  const template: ListTemplate = { id, title: text, kind, useWhen: "", sections: [], items: [], createdAt: at, updatedAt: at };
  return withLists(workspace, { ...lists, templates: [template, ...lists.templates] });
}

export function editTemplate(
  workspace: Workspace,
  templateId: string,
  change: { title?: string; kind?: ListKind; useWhen?: string },
  at: string
): Workspace {
  return updateTemplate(workspace, templateId, t => {
    const title = change.title === undefined ? t.title : clean(change.title, LIST_TITLE_LIMIT);
    if (!title) return null;
    const useWhen = change.useWhen === undefined ? t.useWhen : change.useWhen.replace(/\s+/g, " ").trim().slice(0, LIST_USE_WHEN_LIMIT);
    const kind = change.kind && LIST_KINDS.includes(change.kind) ? change.kind : t.kind;
    if (title === t.title && useWhen === t.useWhen && kind === t.kind) return null;
    return { ...t, title, useWhen, kind, updatedAt: at };
  });
}

/** Removes the list, its runs (history included) and every link to it. */
export function removeTemplate(workspace: Workspace, templateId: string): Workspace {
  const lists = listsOf(workspace);
  if (!lists.templates.some(t => t.id === templateId)) return workspace;
  return withLists(workspace, {
    templates: lists.templates.filter(t => t.id !== templateId),
    runs: lists.runs.filter(r => r.templateId !== templateId),
    links: lists.links.filter(l => l.templateId !== templateId),
  });
}

export function addSection(workspace: Workspace, templateId: string, sectionId: string, title: string, at: string): Workspace {
  const text = clean(title, LIST_SECTION_LIMIT);
  if (!text) return workspace;
  return updateTemplate(workspace, templateId, t =>
    t.sections.length >= MAX_LIST_SECTIONS || t.sections.some(s => s.id === sectionId)
      ? null
      : { ...t, sections: [...t.sections, { id: sectionId, title: text }], updatedAt: at }
  );
}

export function renameSection(workspace: Workspace, templateId: string, sectionId: string, title: string, at: string): Workspace {
  const text = clean(title, LIST_SECTION_LIMIT);
  if (!text) return workspace;
  return updateTemplate(workspace, templateId, t =>
    t.sections.some(s => s.id === sectionId)
      ? { ...t, sections: t.sections.map(s => (s.id === sectionId ? { ...s, title: text } : s)), updatedAt: at }
      : null
  );
}

/** Its items move to the first, unnamed section; nothing is lost. */
export function removeSection(workspace: Workspace, templateId: string, sectionId: string, at: string): Workspace {
  return updateTemplate(workspace, templateId, t =>
    t.sections.some(s => s.id === sectionId)
      ? {
          ...t,
          sections: t.sections.filter(s => s.id !== sectionId),
          items: t.items.map(i => (i.sectionId === sectionId ? { ...i, sectionId: null } : i)),
          updatedAt: at,
        }
      : null
  );
}

export function addItem(
  workspace: Workspace,
  templateId: string,
  itemId: string,
  text: string,
  sectionId: string | null,
  at: string,
  suggested = false
): Workspace {
  const value = clean(text, LIST_ITEM_LIMIT);
  if (!value || totalItems(listsOf(workspace)) >= MAX_LIST_ITEMS_TOTAL) return workspace;
  return updateTemplate(workspace, templateId, t => {
    if (t.items.length >= MAX_LIST_ITEMS || t.items.some(i => i.id === itemId)) return null;
    const section = sectionId && t.sections.some(s => s.id === sectionId) ? sectionId : null;
    const item: ListItem = { id: itemId, text: value, sectionId: section, suggested, createdAt: at, updatedAt: at };
    return { ...t, items: [...t.items, item], updatedAt: at };
  });
}

export function editItem(
  workspace: Workspace,
  templateId: string,
  itemId: string,
  change: { text?: string; sectionId?: string | null },
  at: string
): Workspace {
  return updateTemplate(workspace, templateId, t => {
    const item = t.items.find(i => i.id === itemId);
    if (!item) return null;
    const text = change.text === undefined ? item.text : clean(change.text, LIST_ITEM_LIMIT);
    if (!text) return null;
    const sectionId =
      change.sectionId === undefined
        ? item.sectionId
        : change.sectionId && t.sections.some(s => s.id === change.sectionId)
          ? change.sectionId
          : null;
    if (text === item.text && sectionId === item.sectionId) return null;
    return { ...t, items: t.items.map(i => (i.id === itemId ? { ...i, text, sectionId, updatedAt: at } : i)), updatedAt: at };
  });
}

/** The owner confirms an item Claude suggested. */
export function confirmItem(workspace: Workspace, templateId: string, itemId: string, at: string): Workspace {
  return updateTemplate(workspace, templateId, t =>
    t.items.some(i => i.id === itemId && i.suggested)
      ? { ...t, items: t.items.map(i => (i.id === itemId ? { ...i, suggested: false, updatedAt: at } : i)), updatedAt: at }
      : null
  );
}

/** Removes the item; an open run loses its tick for it too. */
export function removeItem(workspace: Workspace, templateId: string, itemId: string, at: string): Workspace {
  const next = updateTemplate(workspace, templateId, t =>
    t.items.some(i => i.id === itemId) ? { ...t, items: t.items.filter(i => i.id !== itemId), updatedAt: at } : null
  );
  if (next === workspace) return workspace;
  const run = openRun(next, templateId);
  if (!run || !(itemId in run.ticks)) return next;
  return updateRun(next, run.id, r => {
    const ticks = { ...r.ticks };
    delete ticks[itemId];
    return { ...r, ticks, updatedAt: at };
  });
}

/** "Anything missing?": add to the template unless it is already there. */
export function addMissingToTemplate(workspace: Workspace, templateId: string, itemId: string, text: string, at: string): Workspace {
  const template = findTemplate(workspace, templateId);
  if (!template || template.items.some(i => sameText(i.text, text))) return workspace;
  return addItem(workspace, templateId, itemId, text, null, at);
}

// ---------------------------------------------------------------------------
// Runs

export function startRun(
  workspace: Workspace,
  runId: string,
  templateId: string,
  at: string,
  parent: ListRun["parent"] = null
): Workspace {
  const lists = listsOf(workspace);
  if (!findTemplate(workspace, templateId) || openRun(workspace, templateId) || lists.runs.some(r => r.id === runId)) return workspace;
  const run: ListRun = {
    id: runId,
    templateId,
    date: adelaideDate(new Date(at)),
    startedAt: at,
    finishedAt: null,
    ticks: {},
    extras: [],
    parent,
    snapshot: null,
    updatedAt: at,
  };
  return withLists(workspace, { ...lists, runs: [...lists.runs, run] });
}

/** Untick everything on the current run (same run, same date). */
export function resetRun(workspace: Workspace, runId: string, at: string): Workspace {
  return updateRun(workspace, runId, r => (r.finishedAt || !Object.keys(r.ticks).length ? null : { ...r, ticks: {}, updatedAt: at }));
}

export function tickItem(workspace: Workspace, runId: string, itemId: string, ticked: boolean, at: string): Workspace {
  const run = listsOf(workspace).runs.find(r => r.id === runId);
  if (!run || run.finishedAt) return workspace;
  const template = findTemplate(workspace, run.templateId);
  const known =
    template?.items.some(i => i.id === itemId && !i.suggested) || run.extras.some(e => e.id === itemId && !e.suggested);
  if (!known || ticked === itemId in run.ticks) return workspace;
  return updateRun(workspace, runId, r => {
    const ticks = { ...r.ticks };
    if (ticked) ticks[itemId] = at;
    else delete ticks[itemId];
    return { ...r, ticks, updatedAt: at };
  });
}

/** One-off item on this run only. */
export function addExtra(workspace: Workspace, runId: string, extraId: string, text: string, at: string, suggested = false): Workspace {
  const value = clean(text, LIST_ITEM_LIMIT);
  if (!value) return workspace;
  return updateRun(workspace, runId, r =>
    r.finishedAt || r.extras.length >= MAX_RUN_EXTRAS || r.extras.some(e => e.id === extraId)
      ? null
      : { ...r, extras: [...r.extras, { id: extraId, text: value, suggested, createdAt: at }], updatedAt: at }
  );
}

export function confirmExtra(workspace: Workspace, runId: string, extraId: string, at: string): Workspace {
  return updateRun(workspace, runId, r =>
    r.extras.some(e => e.id === extraId && e.suggested)
      ? { ...r, extras: r.extras.map(e => (e.id === extraId ? { ...e, suggested: false } : e)), updatedAt: at }
      : null
  );
}

export function removeExtra(workspace: Workspace, runId: string, extraId: string, at: string): Workspace {
  return updateRun(workspace, runId, r => {
    if (r.finishedAt || !r.extras.some(e => e.id === extraId)) return null;
    const ticks = { ...r.ticks };
    delete ticks[extraId];
    return { ...r, extras: r.extras.filter(e => e.id !== extraId), ticks, updatedAt: at };
  });
}

export interface RunRow {
  id: string;
  text: string;
  section: string;
  ticked: boolean;
  extra: boolean;
  suggested: boolean;
}

/** The run as shown: template items in section order (live edits flow in), then this run's extras. */
export function runRows(workspace: Workspace, run: ListRun): RunRow[] {
  if (run.snapshot) return run.snapshot.map(s => ({ ...s, suggested: false }));
  const template = findTemplate(workspace, run.templateId);
  if (!template) return [];
  const sectionTitle = new Map(template.sections.map(s => [s.id, s.title]));
  const order = [null, ...template.sections.map(s => s.id)];
  const rows: RunRow[] = [];
  for (const sectionId of order) {
    for (const item of template.items.filter(i => i.sectionId === sectionId)) {
      rows.push({
        id: item.id,
        text: item.text,
        section: sectionId ? sectionTitle.get(sectionId) ?? "" : "",
        ticked: item.id in run.ticks,
        extra: false,
        suggested: item.suggested,
      });
    }
  }
  for (const extra of run.extras)
    rows.push({ id: extra.id, text: extra.text, section: "Added this run", ticked: extra.id in run.ticks, extra: true, suggested: extra.suggested });
  return rows;
}

/** Ticked of total; suggested items don't count until confirmed. */
export function runProgress(workspace: Workspace, run: ListRun): { done: number; total: number } {
  const rows = runRows(workspace, run).filter(r => !r.suggested);
  return { done: rows.filter(r => r.ticked).length, total: rows.length };
}

/** Close the run: keep its date and a copy of what was ticked. Older history beyond the cap is dropped. */
export function finishRun(workspace: Workspace, runId: string, at: string): Workspace {
  const run = listsOf(workspace).runs.find(r => r.id === runId);
  if (!run || run.finishedAt) return workspace;
  const snapshot: ListRunSnapshotItem[] = runRows(workspace, run)
    .filter(r => !r.suggested)
    .map(({ id, text, section, ticked, extra }) => ({ id, text, section, ticked, extra }));
  const next = updateRun(workspace, runId, r => ({ ...r, finishedAt: at, snapshot, updatedAt: at }));
  const lists = listsOf(next);
  const history = lists.runs
    .filter(r => r.templateId === run.templateId && r.finishedAt)
    .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""));
  if (history.length <= MAX_FINISHED_RUNS_PER_LIST) return next;
  const drop = new Set(history.slice(MAX_FINISHED_RUNS_PER_LIST).map(r => r.id));
  return withLists(next, { ...lists, runs: lists.runs.filter(r => !drop.has(r.id)) });
}

/** "New run": the current run goes into history with its date; a fresh run starts. */
export function newRun(workspace: Workspace, templateId: string, runId: string, at: string): Workspace {
  const current = openRun(workspace, templateId);
  const parent = current?.parent ?? null;
  const closed = current ? finishRun(workspace, current.id, at) : workspace;
  return startRun(closed, runId, templateId, at, parent);
}

/** Extras from a finished run that the template doesn't have yet ("Anything missing?"). */
export function missingCandidates(workspace: Workspace, run: ListRun): string[] {
  const template = findTemplate(workspace, run.templateId);
  if (!template || !run.snapshot) return [];
  return run.snapshot.filter(s => s.extra && !template.items.some(i => sameText(i.text, s.text))).map(s => s.text);
}

// ---------------------------------------------------------------------------
// Links to tasks, projects and notes

export function linksFor(workspace: Workspace, kind: ListLink["target"]["kind"], id: string): ListLink[] {
  return listsOf(workspace).links.filter(l => l.target.kind === kind && l.target.id === id);
}

export function addLink(
  workspace: Workspace,
  linkId: string,
  templateId: string,
  target: ListLink["target"],
  mode: ListLink["mode"],
  at: string
): Workspace {
  const lists = listsOf(workspace);
  if (
    !findTemplate(workspace, templateId) ||
    lists.links.length >= MAX_LIST_LINKS ||
    lists.links.some(l => l.id === linkId || (l.templateId === templateId && l.target.kind === target.kind && l.target.id === target.id))
  )
    return workspace;
  const mode2 = target.kind === "note" ? "link" : mode;
  return withLists(workspace, { ...lists, links: [...lists.links, { id: linkId, templateId, target, mode: mode2, createdAt: at }] });
}

export function removeLink(workspace: Workspace, linkId: string): Workspace {
  const lists = listsOf(workspace);
  if (!lists.links.some(l => l.id === linkId)) return workspace;
  return withLists(workspace, { ...lists, links: lists.links.filter(l => l.id !== linkId) });
}

/** The open run started for this parent, if any. */
export function runForParent(workspace: Workspace, kind: "task" | "project", id: string): ListRun | null {
  return listsOf(workspace).runs.find(r => !r.finishedAt && r.parent?.kind === kind && r.parent.id === id) ?? null;
}

/** Attached lists that have no run in progress for this parent yet (used for the "start the list too?" offer). */
export function attachedWithoutRun(workspace: Workspace, kind: "task" | "project", id: string): ListTemplate[] {
  return linksFor(workspace, kind, id)
    .filter(l => l.mode === "attached")
    .map(l => findTemplate(workspace, l.templateId))
    .filter((t): t is ListTemplate => Boolean(t))
    .filter(t => {
      const run = openRun(workspace, t.id);
      return !run || run.parent?.kind !== kind || run.parent.id !== id;
    });
}

/** "Packing 4/9" for a parent card, from its run in progress. */
export function parentProgress(
  workspace: Workspace,
  kind: "task" | "project",
  id: string
): { label: string; title: string; done: number; total: number; runId: string; templateId: string } | null {
  const run = runForParent(workspace, kind, id);
  if (!run) return null;
  const template = findTemplate(workspace, run.templateId);
  if (!template) return null;
  const { done, total } = runProgress(workspace, run);
  return { label: `${template.title} ${done}/${total}`, title: template.title, done, total, runId: run.id, templateId: template.id };
}

/** Section sizes over the suggestion threshold (non-blocking). */
export function sectionsToSplit(template: ListTemplate): { sectionId: string | null; count: number }[] {
  const order = [null, ...template.sections.map(s => s.id)];
  return order
    .map(sectionId => ({ sectionId, count: template.items.filter(i => i.sectionId === sectionId && !i.suggested).length }))
    .filter(s => s.count > SECTION_SUGGEST_SPLIT);
}

/** Read aloud text for a template or run. */
export function listSpeech(workspace: Workspace, templateId: string): string {
  const template = findTemplate(workspace, templateId);
  if (!template) return "";
  const run = openRun(workspace, templateId);
  if (run) {
    const rows = runRows(workspace, run).filter(r => !r.suggested);
    const left = rows.filter(r => !r.ticked);
    return `${template.title}. ${rows.length - left.length} of ${rows.length} done.${left.length ? ` Still to do: ${left.map(r => r.text).join("; ")}.` : ""}`;
  }
  return `${template.title}. ${LIST_KIND_LABEL[template.kind]}.${template.useWhen ? ` Use when ${template.useWhen}.` : ""} ${template.items
    .filter(i => !i.suggested)
    .map(i => i.text)
    .join("; ")}.`;
}

/** Keep links whose task, project or note still exists; drop runs' parents that are gone. */
export function pruneListLinks(workspace: Workspace): Workspace {
  if (!workspace.lists) return workspace;
  const tasks = new Set(workspace.tasks.map(t => t.id));
  const projects = new Set(workspace.projects.map(p => p.id));
  const notes = new Set((workspace.dailyLog ?? []).map(n => n.id));
  const exists = (kind: string, id: string) =>
    kind === "task" ? tasks.has(id) : kind === "project" ? projects.has(id) : notes.has(id);
  const links = workspace.lists.links.filter(l => exists(l.target.kind, l.target.id));
  const runs = workspace.lists.runs.map(r => (r.parent && !exists(r.parent.kind, r.parent.id) ? { ...r, parent: null } : r));
  const changed = links.length !== workspace.lists.links.length || runs.some((r, i) => r !== workspace.lists!.runs[i]);
  return changed ? { ...workspace, lists: { ...workspace.lists, links, runs } } : workspace;
}

// ---------------------------------------------------------------------------
// Older saves: Shopping Lists become templates; any ticks become an open run.

export function listsFromShoppingLists(old: ShoppingList[]): ListsStore {
  const templates: ListTemplate[] = [];
  const runs: ListRun[] = [];
  for (const list of old) {
    templates.push({
      id: list.id,
      title: list.title,
      kind: "do-confirm",
      useWhen: "",
      sections: [],
      items: list.items.map(item => ({
        id: item.id,
        text: item.text,
        sectionId: null,
        suggested: false,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    });
    const ticked = list.items.filter(item => item.checked);
    if (ticked.length) {
      runs.push({
        id: `run-${list.id}`.slice(0, 128),
        templateId: list.id,
        date: adelaideDate(new Date(list.updatedAt)),
        startedAt: list.updatedAt,
        finishedAt: null,
        ticks: Object.fromEntries(ticked.map(item => [item.id, item.updatedAt])),
        extras: [],
        parent: null,
        snapshot: null,
        updatedAt: list.updatedAt,
      });
    }
  }
  return { templates, runs, links: [] };
}

// ---------------------------------------------------------------------------
// Validation (strict, like the rest of the workspace)

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function bad(message: string): never {
  throw new Error(message);
}
function exact(value: Rec, keys: string[], label: string) {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(k => !keys.includes(k))) bad(`${label} has unknown or missing fields.`);
}
function str(value: Rec, key: string, max: number, label: string, nonEmpty = false): string {
  const v = value[key];
  if (typeof v !== "string" || v.length > max || (nonEmpty && !v.trim())) bad(`${label} ${key} must be ${nonEmpty ? "a non-empty " : "a "}string up to ${max} characters.`);
  return v;
}
function id(value: Rec, key: string, label: string): string {
  const v = str(value, key, 128, label, true);
  if (!ID.test(v)) bad(`${label} ${key} is not a valid ID.`);
  return v;
}
function instant(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 100 || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) bad(`${label} must be a valid timestamp.`);
  return value;
}
function bool(value: Rec, key: string, label: string): boolean {
  if (typeof value[key] !== "boolean") bad(`${label} ${key} must be true or false.`);
  return value[key] as boolean;
}

export function validateLists(value: unknown): ListsStore {
  if (!isRec(value)) bad("lists is not an object.");
  exact(value, ["templates", "runs", "links"], "lists");
  const { templates: rawTemplates, runs: rawRuns, links: rawLinks } = value;
  if (!Array.isArray(rawTemplates) || rawTemplates.length > MAX_LIST_TEMPLATES) bad(`lists may hold at most ${MAX_LIST_TEMPLATES} lists.`);
  const templateIds = new Set<string>();
  const itemIds = new Set<string>();
  let total = 0;
  const templates: ListTemplate[] = rawTemplates.map((raw, index) => {
    const label = `list ${index + 1}`;
    if (!isRec(raw)) bad(`${label} is not an object.`);
    exact(raw, ["id", "title", "kind", "useWhen", "sections", "items", "createdAt", "updatedAt"], label);
    const tid = id(raw, "id", label);
    if (templateIds.has(tid)) bad("list IDs must be unique.");
    templateIds.add(tid);
    if (!LIST_KINDS.includes(raw.kind as ListKind)) bad(`${label} kind must be read-do or do-confirm.`);
    if (!Array.isArray(raw.sections) || raw.sections.length > MAX_LIST_SECTIONS) bad(`${label} has too many sections.`);
    const sectionIds = new Set<string>();
    const sections = raw.sections.map((s, i) => {
      const sl = `${label} section ${i + 1}`;
      if (!isRec(s)) bad(`${sl} is not an object.`);
      exact(s, ["id", "title"], sl);
      const sid = id(s, "id", sl);
      if (sectionIds.has(sid)) bad(`${label} section IDs must be unique.`);
      sectionIds.add(sid);
      return { id: sid, title: str(s, "title", LIST_SECTION_LIMIT, sl, true) };
    });
    if (!Array.isArray(raw.items) || raw.items.length > MAX_LIST_ITEMS) bad(`${label} has more than ${MAX_LIST_ITEMS} items.`);
    total += raw.items.length;
    if (total > MAX_LIST_ITEMS_TOTAL) bad(`lists may hold at most ${MAX_LIST_ITEMS_TOTAL} items in total.`);
    const items = raw.items.map((it, i) => {
      const il = `${label} item ${i + 1}`;
      if (!isRec(it)) bad(`${il} is not an object.`);
      exact(it, ["id", "text", "sectionId", "suggested", "createdAt", "updatedAt"], il);
      const iid = id(it, "id", il);
      if (itemIds.has(iid)) bad("list item IDs must be unique.");
      itemIds.add(iid);
      const sectionId = it.sectionId === null ? null : id(it, "sectionId", il);
      if (sectionId && !sectionIds.has(sectionId)) bad(`${il} refers to a missing section.`);
      return {
        id: iid,
        text: str(it, "text", LIST_ITEM_LIMIT, il, true),
        sectionId,
        suggested: bool(it, "suggested", il),
        createdAt: instant(it.createdAt, `${il} createdAt`),
        updatedAt: instant(it.updatedAt, `${il} updatedAt`),
      };
    });
    return {
      id: tid,
      title: str(raw, "title", LIST_TITLE_LIMIT, label, true),
      kind: raw.kind as ListKind,
      useWhen: str(raw, "useWhen", LIST_USE_WHEN_LIMIT, label),
      sections,
      items,
      createdAt: instant(raw.createdAt, `${label} createdAt`),
      updatedAt: instant(raw.updatedAt, `${label} updatedAt`),
    };
  });

  if (!Array.isArray(rawRuns) || rawRuns.length > MAX_LIST_TEMPLATES * (MAX_FINISHED_RUNS_PER_LIST + 1)) bad("lists has too many runs.");
  const runIds = new Set<string>();
  const openFor = new Set<string>();
  const runs: ListRun[] = rawRuns.map((raw, index) => {
    const label = `list run ${index + 1}`;
    if (!isRec(raw)) bad(`${label} is not an object.`);
    exact(raw, ["id", "templateId", "date", "startedAt", "finishedAt", "ticks", "extras", "parent", "snapshot", "updatedAt"], label);
    const rid = id(raw, "id", label);
    if (runIds.has(rid)) bad("list run IDs must be unique.");
    runIds.add(rid);
    const templateId = id(raw, "templateId", label);
    if (!templateIds.has(templateId)) bad(`${label} refers to a missing list.`);
    const date = str(raw, "date", 10, label, true);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) bad(`${label} date must be YYYY-MM-DD.`);
    const finishedAt = raw.finishedAt === null ? null : instant(raw.finishedAt, `${label} finishedAt`);
    if (!finishedAt) {
      if (openFor.has(templateId)) bad(`${label}: a list can have only one run in progress.`);
      openFor.add(templateId);
    }
    if (!isRec(raw.ticks) || Object.keys(raw.ticks).length > MAX_LIST_ITEMS + MAX_RUN_EXTRAS) bad(`${label} ticks are not valid.`);
    const ticks: Record<string, string> = {};
    for (const [key, at] of Object.entries(raw.ticks)) {
      if (!ID.test(key)) bad(`${label} has an invalid tick.`);
      ticks[key] = instant(at, `${label} tick`);
    }
    if (!Array.isArray(raw.extras) || raw.extras.length > MAX_RUN_EXTRAS) bad(`${label} has too many added items.`);
    const extras: ListRunExtra[] = raw.extras.map((e, i) => {
      const el = `${label} added item ${i + 1}`;
      if (!isRec(e)) bad(`${el} is not an object.`);
      exact(e, ["id", "text", "suggested", "createdAt"], el);
      return { id: id(e, "id", el), text: str(e, "text", LIST_ITEM_LIMIT, el, true), suggested: bool(e, "suggested", el), createdAt: instant(e.createdAt, `${el} createdAt`) };
    });
    let parent: ListRun["parent"] = null;
    if (raw.parent !== null) {
      if (!isRec(raw.parent)) bad(`${label} parent is not valid.`);
      exact(raw.parent, ["kind", "id"], `${label} parent`);
      if (raw.parent.kind !== "task" && raw.parent.kind !== "project") bad(`${label} parent kind is not valid.`);
      parent = { kind: raw.parent.kind, id: id(raw.parent, "id", `${label} parent`) };
    }
    let snapshot: ListRunSnapshotItem[] | null = null;
    if (raw.snapshot !== null) {
      if (!Array.isArray(raw.snapshot) || raw.snapshot.length > MAX_LIST_ITEMS + MAX_RUN_EXTRAS) bad(`${label} snapshot is not valid.`);
      snapshot = raw.snapshot.map((s, i) => {
        const sl = `${label} snapshot item ${i + 1}`;
        if (!isRec(s)) bad(`${sl} is not an object.`);
        exact(s, ["id", "text", "section", "ticked", "extra"], sl);
        return {
          id: id(s, "id", sl),
          text: str(s, "text", LIST_ITEM_LIMIT, sl, true),
          section: str(s, "section", LIST_SECTION_LIMIT, sl),
          ticked: bool(s, "ticked", sl),
          extra: bool(s, "extra", sl),
        };
      });
    }
    return {
      id: rid,
      templateId,
      date,
      startedAt: instant(raw.startedAt, `${label} startedAt`),
      finishedAt,
      ticks,
      extras,
      parent,
      snapshot,
      updatedAt: instant(raw.updatedAt, `${label} updatedAt`),
    };
  });

  if (!Array.isArray(rawLinks) || rawLinks.length > MAX_LIST_LINKS) bad(`lists may hold at most ${MAX_LIST_LINKS} links.`);
  const linkIds = new Set<string>();
  const links: ListLink[] = rawLinks.map((raw, index) => {
    const label = `list link ${index + 1}`;
    if (!isRec(raw)) bad(`${label} is not an object.`);
    exact(raw, ["id", "templateId", "target", "mode", "createdAt"], label);
    const lid = id(raw, "id", label);
    if (linkIds.has(lid)) bad("list link IDs must be unique.");
    linkIds.add(lid);
    const templateId = id(raw, "templateId", label);
    if (!templateIds.has(templateId)) bad(`${label} refers to a missing list.`);
    if (!isRec(raw.target)) bad(`${label} target is not valid.`);
    exact(raw.target, ["kind", "id"], `${label} target`);
    const kind = raw.target.kind;
    if (kind !== "task" && kind !== "project" && kind !== "note") bad(`${label} target kind is not valid.`);
    if (raw.mode !== "attached" && raw.mode !== "link") bad(`${label} mode must be attached or link.`);
    if (kind === "note" && raw.mode !== "link") bad(`${label}: notes can only link to a list.`);
    return { id: lid, templateId, target: { kind, id: id(raw.target, "id", `${label} target`) }, mode: raw.mode, createdAt: instant(raw.createdAt, `${label} createdAt`) };
  });
  return { templates, runs, links };
}

// ---------------------------------------------------------------------------
// Adding from voice, Paste anything and Claude: items go on the list's run in
// progress (a run starts if none is open). Voice and paste are owner-confirmed
// before this is called; Claude's items arrive suggested (dashed) instead.

export const DEFAULT_LIST_TITLE = "Shopping";

/** The list a request means: a named list, else the most recently used one. */
export function listForRequest(workspace: Workspace, title: string | null): ListTemplate | null {
  const lists = listsOf(workspace);
  if (title && title.trim()) return findTemplateByTitle(workspace, title);
  const recent = (t: ListTemplate) => {
    const runs = lists.runs.filter(r => r.templateId === t.id).map(r => r.updatedAt);
    return [t.updatedAt, ...runs].sort().at(-1) ?? "";
  };
  return [...lists.templates].sort((a, b) => recent(b).localeCompare(recent(a)))[0] ?? null;
}

export function addItemsToRun(
  workspace: Workspace,
  title: string | null,
  items: string[],
  at: string,
  options: { suggested?: boolean; createList?: boolean; templateId?: string } = {}
): { workspace: Workspace; template: ListTemplate | null; runId: string | null; added: string[] } {
  let next = workspace;
  let template = options.templateId ? findTemplate(next, options.templateId) : listForRequest(next, title);
  if (!template && options.createList !== false) {
    const id = newListId();
    next = addTemplate(next, id, title?.trim() || DEFAULT_LIST_TITLE, at);
    template = findTemplate(next, id);
  }
  if (!template) return { workspace, template: null, runId: null, added: [] };
  let run = openRun(next, template.id);
  if (!run) {
    const runId = newListRunId();
    next = startRun(next, runId, template.id, at);
    run = openRun(next, template.id);
  }
  if (!run) return { workspace, template, runId: null, added: [] };
  const added: string[] = [];
  for (const text of items) {
    const before = next;
    next = addExtra(next, run.id, newListItemId(), text, at, options.suggested ?? false);
    if (next !== before) added.push(text.replace(/\s+/g, " ").trim());
  }
  return added.length ? { workspace: next, template, runId: run.id, added } : { workspace, template, runId: run.id, added };
}
