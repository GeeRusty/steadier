import type { Imperative } from "./compass";
import type { FrontOfMindEntry, FrontOfMindItem, FrontOfMindStore, Task, Workspace } from "./types";

/**
 * Front of Mind: what's on the owner's mind that isn't a task yet (ideas,
 * concerns, things being weighed). Replaced the Ideas shelf on 2026-11-14.
 *
 * Owner actions, the same everywhere: Make it a task · Promote to Imperative ·
 * Keep · Let go. Claude may only add (labelled), change wording (kept in
 * History) and suggest Let go (dashed). Nothing here deletes an item.
 */

export const MAX_FRONT_OF_MIND = 1000;
export const FRONT_OF_MIND_TEXT_LIMIT = 500;
export const FRONT_OF_MIND_NOTES_LIMIT = 20000;
export const FRONT_OF_MIND_REASON_LIMIT = 2000;
export const MAX_FRONT_OF_MIND_HISTORY = 200;
/** "quiet Nd" after this many days without being looked at. */
export const QUIET_DAYS = 30;

/** Behind the ⓘ. (The "promise" text from Notion is added once the owner approves its wording.) */
export const FRONT_OF_MIND_INFO = "What's on your mind that isn't a task yet: ideas, concerns, things you're weighing.";
export const FRONT_OF_MIND_INFO_MORE =
  "Add with the + button and choose Idea. Tap an item for Make it a task, Promote to Imperative (decided in the Weekly Review), Keep or Let go. Let go keeps it under Let go, so you can bring it back. Claude can add items, change wording (kept in History) and suggest Let go; only you decide.";

function idToken(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
export const newFrontOfMindId = () => `fom-${idToken()}`;

export function frontOfMindOf(workspace: Workspace): FrontOfMindStore {
  return workspace.frontOfMind ?? { items: [] };
}
export function findItem(workspace: Workspace, id: string): FrontOfMindItem | null {
  return frontOfMindOf(workspace).items.find(i => i.id === id) ?? null;
}
const isOpen = (i: FrontOfMindItem) => !i.letGoAt && !i.became;

function daysFrom(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Days since it was last looked at (Kept) or added. */
export function quietDays(item: FrontOfMindItem, today: string): number {
  return daysFrom((item.lookedAt ?? item.createdAt).slice(0, 10), today);
}

/** Open items: Claude's first, then suggested Let go, then newest. No ranking. */
export function openItems(workspace: Workspace): FrontOfMindItem[] {
  const group = (i: FrontOfMindItem) => (i.claudeLabel ? 0 : i.letGoSuggestion ? 1 : 2);
  return frontOfMindOf(workspace)
    .items.filter(isOpen)
    .sort((a, b) => group(a) - group(b) || b.createdAt.localeCompare(a.createdAt));
}
export function letGoItems(workspace: Workspace): FrontOfMindItem[] {
  return frontOfMindOf(workspace)
    .items.filter(i => i.letGoAt && !i.became)
    .sort((a, b) => (b.letGoAt ?? "").localeCompare(a.letGoAt ?? ""));
}
/** Items with an Imperative draft waiting for the Weekly Review. */
export function imperativeDrafts(workspace: Workspace): FrontOfMindItem[] {
  return frontOfMindOf(workspace).items.filter(i => isOpen(i) && i.imperativeDraft);
}

export type Chip = { text: string; dashed: boolean };
/** At most two, only what's off normal. */
export function chipsFor(item: FrontOfMindItem, today: string): Chip[] {
  const chips: Chip[] = [];
  if (item.claudeLabel) chips.push({ text: "added by Claude", dashed: false });
  if (item.letGoSuggestion) chips.push({ text: "suggested: Let go", dashed: true });
  const quiet = quietDays(item, today);
  if (quiet > QUIET_DAYS) chips.push({ text: `quiet ${quiet}d`, dashed: false });
  return chips.slice(0, 2);
}

// ---------------------------------------------------------------------------
// Changes (each returns the same workspace when nothing valid changed)

function withItems(workspace: Workspace, items: FrontOfMindItem[]): Workspace {
  return { ...workspace, frontOfMind: { items } };
}
function withItem(workspace: Workspace, id: string, update: (i: FrontOfMindItem) => FrontOfMindItem | null): Workspace {
  let changed = false;
  const items = frontOfMindOf(workspace).items.map(i => {
    if (i.id !== id) return i;
    const next = update(i);
    if (!next || next === i) return i;
    changed = true;
    return next;
  });
  return changed ? withItems(workspace, items) : workspace;
}
function log(i: FrontOfMindItem, entry: FrontOfMindEntry): FrontOfMindEntry[] {
  return [...i.history, entry].slice(-MAX_FRONT_OF_MIND_HISTORY);
}
const clean = (text: string) => text.replace(/\s+/g, " ").trim();

export function addFrontOfMind(
  workspace: Workspace,
  id: string,
  text: string,
  at: string,
  opts: { by?: "owner" | "claude"; notes?: string; note?: string } = {}
): Workspace {
  const wording = clean(text);
  const items = frontOfMindOf(workspace).items;
  if (!wording || wording.length > FRONT_OF_MIND_TEXT_LIMIT || items.length >= MAX_FRONT_OF_MIND || items.some(i => i.id === id)) return workspace;
  const by = opts.by ?? "owner";
  const item: FrontOfMindItem = {
    id,
    text: wording,
    notes: (opts.notes ?? "").trim().slice(0, FRONT_OF_MIND_NOTES_LIMIT),
    createdAt: at,
    updatedAt: at,
    addedBy: by,
    claudeLabel: by === "claude",
    lookedAt: null,
    letGoAt: null,
    letGoSuggestion: null,
    imperativeDraft: null,
    became: null,
    projectId: null,
    imperativeIds: [],
    history: [{ at, by, text: by === "claude" ? `Added by Claude.${opts.note ? ` ${opts.note}` : ""}` : `Added.${opts.note ? ` ${opts.note}` : ""}` }],
  };
  return withItems(workspace, [...items, item]);
}

/** Change the wording; the earlier wording is kept in History. */
export function editWording(workspace: Workspace, id: string, text: string, at: string, by: "owner" | "claude" = "owner", reason = ""): Workspace {
  const wording = clean(text);
  if (!wording || wording.length > FRONT_OF_MIND_TEXT_LIMIT) return workspace;
  return withItem(workspace, id, i =>
    i.text === wording || i.became
      ? null
      : {
          ...i,
          text: wording,
          updatedAt: at,
          history: log(i, {
            at,
            by,
            text: `${by === "claude" ? "Claude changed the wording" : "Wording changed"}.${reason.trim() ? ` ${reason.trim().slice(0, 300)}` : ""}`,
            was: i.text,
          }),
        }
  );
}

/** Keep: looked at, today. Clears Claude's label and any Let go suggestion. */
export function keepItem(workspace: Workspace, id: string, at: string): Workspace {
  return withItem(workspace, id, i =>
    !isOpen(i)
      ? null
      : {
          ...i,
          lookedAt: at,
          claudeLabel: false,
          letGoSuggestion: null,
          updatedAt: at,
          history: log(i, { at, by: "owner", text: i.letGoSuggestion ? "Kept (Claude's Let go suggestion declined)." : "Kept." }),
        }
  );
}

export function letGo(workspace: Workspace, id: string, at: string): Workspace {
  return withItem(workspace, id, i =>
    !isOpen(i)
      ? null
      : {
          ...i,
          letGoAt: at,
          letGoSuggestion: null,
          claudeLabel: false,
          updatedAt: at,
          history: log(i, { at, by: "owner", text: "Let go (kept under Let go; can be brought back)." }),
        }
  );
}

export function bringBack(workspace: Workspace, id: string, at: string): Workspace {
  return withItem(workspace, id, i =>
    !i.letGoAt || i.became
      ? null
      : { ...i, letGoAt: null, lookedAt: at, updatedAt: at, history: log(i, { at, by: "owner", text: "Brought back." }) }
  );
}

/** Claude may only suggest; the owner decides with Let go or Keep. */
export function suggestLetGo(workspace: Workspace, id: string, reason: string, at: string): Workspace {
  const why = clean(reason).slice(0, FRONT_OF_MIND_REASON_LIMIT);
  return withItem(workspace, id, i =>
    !isOpen(i)
      ? null
      : {
          ...i,
          letGoSuggestion: { at, reason: why },
          updatedAt: at,
          history: log(i, { at, by: "claude", text: `Claude suggested Let go.${why ? ` "${why}"` : ""}` }),
        }
  );
}

/** Promote: a draft on the item only; the Weekly Review's Imperatives step decides. */
export function saveImperativeDraft(workspace: Workspace, id: string, title: string, reason: string, at: string): Workspace {
  const t = clean(title).slice(0, 300);
  if (!t) return workspace;
  return withItem(workspace, id, i =>
    !isOpen(i)
      ? null
      : {
          ...i,
          imperativeDraft: { title: t, reason: reason.trim().slice(0, FRONT_OF_MIND_REASON_LIMIT), at },
          updatedAt: at,
          history: log(i, { at, by: "owner", text: "Imperative draft saved for the Weekly Review." }),
        }
  );
}
export function clearImperativeDraft(workspace: Workspace, id: string, at: string): Workspace {
  return withItem(workspace, id, i =>
    !i.imperativeDraft ? null : { ...i, imperativeDraft: null, updatedAt: at, history: log(i, { at, by: "owner", text: "Imperative draft removed." }) }
  );
}

/** Weekly Review "Add as Imperative": the owner's yes. Creates the Imperative; the item leaves the list. */
export function addImperativeFromItem(workspace: Workspace, id: string, imperativeId: string, today: string, at: string): Workspace {
  const item = findItem(workspace, id);
  if (!item || !isOpen(item) || !item.imperativeDraft) return workspace;
  const imperative: Imperative = {
    id: imperativeId,
    title: item.imperativeDraft.title,
    reason: item.imperativeDraft.reason,
    status: "active",
    setOn: today,
    retiredOn: null,
    notionUrl: null,
    decision: null,
    history: [{ at, text: "Set as an Active Imperative in the Weekly Reality Review, from Front of Mind." }],
    createdAt: at,
    updatedAt: at,
  };
  const next = withItem(workspace, id, i => ({
    ...i,
    became: { kind: "imperative", id: imperativeId, at },
    imperativeDraft: null,
    updatedAt: at,
    history: log(i, { at, by: "owner", text: `Became an Imperative: "${imperative.title}".` }),
  }));
  return { ...next, imperatives: [...next.imperatives, imperative] };
}

/** After the owner saves the task draft: the item leaves the list, with the link kept. */
export function markBecameTask(workspace: Workspace, id: string, taskId: string, at: string): Workspace {
  if (!workspace.tasks.some(t => t.id === taskId)) return workspace;
  return withItem(workspace, id, i =>
    !isOpen(i)
      ? null
      : { ...i, became: { kind: "task", id: taskId, at }, updatedAt: at, history: log(i, { at, by: "owner", text: "Became a task." }) }
  );
}

/** Weekly Review choices, applied when the review is saved. */
export type ReviewChoice = "keep" | "letgo" | "promote";
export function applyReviewChoices(workspace: Workspace, choices: Record<string, ReviewChoice>, at: string): Workspace {
  let w = workspace;
  for (const [id, choice] of Object.entries(choices)) {
    const item = findItem(w, id);
    if (!item || !isOpen(item)) continue;
    if (choice === "keep") w = keepItem(w, id, at);
    else if (choice === "letgo") w = letGo(w, id, at);
    else if (choice === "promote" && !item.imperativeDraft) w = saveImperativeDraft(keepItem(w, id, at), id, item.text, "", at);
    else if (choice === "promote") w = keepItem(w, id, at);
  }
  return w;
}

/** Drop links to removed projects and Imperatives, and became-links to removed tasks stay as history text. */
export function pruneFrontOfMindLinks(workspace: Workspace): Workspace {
  const store = workspace.frontOfMind;
  if (!store?.items.length) return workspace;
  const projectIds = new Set(workspace.projects.map(p => p.id));
  const imperativeIds = new Set(workspace.imperatives.map(i => i.id));
  let changed = false;
  const items = store.items.map(i => {
    const projectId = i.projectId && projectIds.has(i.projectId) ? i.projectId : null;
    const imps = i.imperativeIds.filter(x => imperativeIds.has(x));
    if (projectId === i.projectId && imps.length === i.imperativeIds.length) return i;
    changed = true;
    return { ...i, projectId, imperativeIds: imps };
  });
  return changed ? withItems(workspace, items) : workspace;
}

// ---------------------------------------------------------------------------
// The move from the Ideas shelf (once: only while the workspace has no Front of Mind yet)

/** An idea, not a held task: "someday", not an obligation's held prep task, not a review drop. */
export function isMovableIdea(task: Task): boolean {
  if (task.state !== "someday" || task.obligation) return false;
  return !task.history.some(h => /Dropped to Someday in the Weekly Reality Review/.test(h.text));
}

/** Idea task ids that other records point at; those stay tasks so nothing breaks. */
function referencedTaskIds(workspace: Workspace): Set<string> {
  const ids = new Set<string>();
  for (const t of workspace.tasks) {
    if (t.parent?.id) ids.add(t.parent.id);
    for (const d of t.dependencies ?? []) ids.add(d);
  }
  if (workspace.focus?.taskId) ids.add(workspace.focus.taskId);
  if (workspace.nextThing?.taskId) ids.add(workspace.nextThing.taskId);
  for (const o of workspace.obligations ?? []) if (o.preparationTaskId) ids.add(o.preparationTaskId);
  for (const l of workspace.lists?.links ?? []) if (l.target.kind === "task") ids.add(l.target.id);
  for (const r of workspace.lists?.runs ?? []) if (r.parent?.kind === "task") ids.add(r.parent.id);
  for (const a of workspace.assets ?? []) {
    for (const p of a.plans) if (p.taskId) ids.add(p.taskId);
    for (const r of a.revisits) if (r.taskId) ids.add(r.taskId);
    for (const l of a.logs) if (l.taskId) ids.add(l.taskId);
  }
  return ids;
}

function itemFromIdea(task: Task): FrontOfMindItem {
  const byClaude = /^Claude\b/.test(task.history[0]?.text ?? "");
  const kept = [...task.history].reverse().find(h => /^Idea kept\./.test(h.text));
  const history: FrontOfMindEntry[] = task.history.map(h => ({
    at: h.at,
    by: /^Claude\b/.test(h.text) ? ("claude" as const) : ("owner" as const),
    text: h.text.slice(0, 2000),
  }));
  history.push({ at: task.updatedAt, by: "owner", text: "Moved from the Ideas shelf to Front of Mind." });
  return {
    id: task.id,
    text: clean(task.title).slice(0, FRONT_OF_MIND_TEXT_LIMIT) || "Untitled",
    notes: task.notes.slice(0, FRONT_OF_MIND_NOTES_LIMIT),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    addedBy: byClaude ? "claude" : "owner",
    claudeLabel: byClaude && !kept,
    lookedAt: kept?.at ?? null,
    letGoAt: task.droppedAt ?? null,
    letGoSuggestion: null,
    imperativeDraft: null,
    became: null,
    projectId: task.projectId,
    imperativeIds: [...(task.compass?.imperativeIds ?? [])],
    history: history.slice(-MAX_FRONT_OF_MIND_HISTORY),
  };
}

/**
 * Move ideas off the task list into Front of Mind. Runs only when the
 * workspace has no Front of Mind yet and has at least one "someday" task, so
 * it happens once; afterwards someday tasks stay tasks.
 */
export function moveIdeasToFrontOfMind(workspace: Workspace): Workspace {
  if (workspace.frontOfMind || !workspace.tasks.some(t => t.state === "someday")) return workspace;
  const referenced = referencedTaskIds(workspace);
  const moving = workspace.tasks.filter(t => isMovableIdea(t) && !referenced.has(t.id));
  const ids = new Set(moving.map(t => t.id));
  return {
    ...workspace,
    tasks: workspace.tasks.filter(t => !ids.has(t.id)),
    frontOfMind: { items: moving.map(itemFromIdea) },
  };
}

// ---------------------------------------------------------------------------
// Connector views

/** For read_my_life_context: wording and labels only (no history). */
export function frontOfMindForContext(workspace: Workspace, today: string) {
  return openItems(workspace).map(i => ({
    itemId: i.id,
    wording: i.text,
    labels: chipsFor(i, today).map(c => c.text),
    ...(i.imperativeDraft ? { imperativeDraft: true } : {}),
  }));
}

/** For read_my_life_front_of_mind: everything, including History. */
export function frontOfMindForRead(workspace: Workspace, today: string, includeLetGo: boolean) {
  const present = (i: FrontOfMindItem) => ({
    itemId: i.id,
    wording: i.text,
    notes: i.notes,
    added: i.createdAt,
    addedBy: i.addedBy,
    labels: chipsFor(i, today).map(c => c.text),
    lookedAt: i.lookedAt,
    letGoSuggestion: i.letGoSuggestion,
    imperativeDraft: i.imperativeDraft ? { title: i.imperativeDraft.title } : null,
    history: i.history,
  });
  return {
    items: openItems(workspace).map(present),
    ...(includeLetGo ? { letGo: letGoItems(workspace).map(i => ({ ...present(i), letGoAt: i.letGoAt })) } : {}),
  };
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
function str(v: unknown, max: number, label: string, nonEmpty = false): string {
  if (typeof v !== "string" || v.length > max || (nonEmpty && !v.trim())) bad(`${label} must be ${nonEmpty ? "a non-empty " : "a "}string up to ${max} characters.`);
  return v;
}
function id(v: unknown, label: string): string {
  const s = str(v, 128, label, true);
  if (!ID.test(s)) bad(`${label} is not a valid ID.`);
  return s;
}
function instant(v: unknown, label: string): string {
  if (typeof v !== "string" || v.length > 100 || !/^\d{4}-\d{2}-\d{2}T/.test(v) || !Number.isFinite(Date.parse(v))) bad(`${label} must be a valid timestamp.`);
  return v;
}
function nInstant(v: unknown, label: string): string | null {
  return v === null ? null : instant(v, label);
}
function who(v: unknown, label: string): "owner" | "claude" {
  if (v !== "owner" && v !== "claude") bad(`${label} must be owner or claude.`);
  return v;
}

export function validateFrontOfMind(value: unknown): FrontOfMindStore {
  if (!isRec(value)) bad("frontOfMind is not an object.");
  exact(value, ["items"], "frontOfMind");
  if (!Array.isArray(value.items) || value.items.length > MAX_FRONT_OF_MIND) bad(`frontOfMind may hold at most ${MAX_FRONT_OF_MIND} items.`);
  const ids = new Set<string>();
  const items = value.items.map((raw, index): FrontOfMindItem => {
    const label = `Front of Mind item ${index + 1}`;
    if (!isRec(raw)) bad(`${label} is not an object.`);
    exact(
      raw,
      ["id", "text", "notes", "createdAt", "updatedAt", "addedBy", "claudeLabel", "lookedAt", "letGoAt", "letGoSuggestion", "imperativeDraft", "became", "projectId", "imperativeIds", "history"],
      label
    );
    const itemId = id(raw.id, `${label} id`);
    if (ids.has(itemId)) bad("Front of Mind item IDs must be unique.");
    ids.add(itemId);
    if (typeof raw.claudeLabel !== "boolean") bad(`${label} claudeLabel must be true or false.`);
    let letGoSuggestion: FrontOfMindItem["letGoSuggestion"] = null;
    if (raw.letGoSuggestion !== null) {
      if (!isRec(raw.letGoSuggestion)) bad(`${label} letGoSuggestion is invalid.`);
      exact(raw.letGoSuggestion, ["at", "reason"], `${label} letGoSuggestion`);
      letGoSuggestion = { at: instant(raw.letGoSuggestion.at, `${label} suggestion at`), reason: str(raw.letGoSuggestion.reason, FRONT_OF_MIND_REASON_LIMIT, `${label} suggestion reason`) };
    }
    let imperativeDraft: FrontOfMindItem["imperativeDraft"] = null;
    if (raw.imperativeDraft !== null) {
      if (!isRec(raw.imperativeDraft)) bad(`${label} imperativeDraft is invalid.`);
      exact(raw.imperativeDraft, ["title", "reason", "at"], `${label} imperativeDraft`);
      imperativeDraft = {
        title: str(raw.imperativeDraft.title, 300, `${label} draft title`, true),
        reason: str(raw.imperativeDraft.reason, FRONT_OF_MIND_REASON_LIMIT, `${label} draft reason`),
        at: instant(raw.imperativeDraft.at, `${label} draft at`),
      };
    }
    let became: FrontOfMindItem["became"] = null;
    if (raw.became !== null) {
      if (!isRec(raw.became)) bad(`${label} became is invalid.`);
      exact(raw.became, ["kind", "id", "at"], `${label} became`);
      if (raw.became.kind !== "task" && raw.became.kind !== "imperative") bad(`${label} became kind is invalid.`);
      became = { kind: raw.became.kind, id: id(raw.became.id, `${label} became id`), at: instant(raw.became.at, `${label} became at`) };
    }
    if (!Array.isArray(raw.imperativeIds) || raw.imperativeIds.length > 50) bad(`${label} imperativeIds is invalid.`);
    if (!Array.isArray(raw.history) || raw.history.length > MAX_FRONT_OF_MIND_HISTORY) bad(`${label} history is too long.`);
    return {
      id: itemId,
      text: str(raw.text, FRONT_OF_MIND_TEXT_LIMIT, `${label} text`, true),
      notes: str(raw.notes, FRONT_OF_MIND_NOTES_LIMIT, `${label} notes`),
      createdAt: instant(raw.createdAt, `${label} createdAt`),
      updatedAt: instant(raw.updatedAt, `${label} updatedAt`),
      addedBy: who(raw.addedBy, `${label} addedBy`),
      claudeLabel: raw.claudeLabel,
      lookedAt: nInstant(raw.lookedAt, `${label} lookedAt`),
      letGoAt: nInstant(raw.letGoAt, `${label} letGoAt`),
      letGoSuggestion,
      imperativeDraft,
      became,
      projectId: raw.projectId === null ? null : id(raw.projectId, `${label} projectId`),
      imperativeIds: raw.imperativeIds.map((x, i) => id(x, `${label} imperative ${i + 1}`)),
      history: raw.history.map((h, i) => {
        const hl = `${label} history ${i + 1}`;
        if (!isRec(h)) bad(`${hl} is not an object.`);
        const keys = Object.keys(h);
        exact(h, keys.includes("was") ? ["at", "by", "text", "was"] : ["at", "by", "text"], hl);
        return {
          at: instant(h.at, `${hl} at`),
          by: who(h.by, `${hl} by`),
          text: str(h.text, 2000, `${hl} text`, true),
          ...(keys.includes("was") ? { was: str(h.was, FRONT_OF_MIND_TEXT_LIMIT, `${hl} was`) } : {}),
        };
      }),
    };
  });
  return { items };
}
