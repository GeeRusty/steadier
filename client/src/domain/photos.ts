/**
 * Photos on tasks (owner-approved 2026-11-15).
 *
 * The photo files live once, on the server, outside the workspace. A task only
 * holds a small reference to each one: the file's SHA-256 fingerprint, its
 * size, a Before/After label and the markup as drawing instructions. So the
 * workspace backups saved before every change carry references, never photos.
 * The original file is never changed: markup is drawn over it when shown, and
 * drawn into any copy that is downloaded or shared.
 */
import type { Task, Workspace } from "./types";

export type PhotoLabel = "before" | "after";

/** Coordinates are fractions of the photo's width and height (0–1). */
export type MarkupShape =
  | { kind: "arrow" | "circle"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "pen"; points: number[] }
  | { kind: "text"; x: number; y: number; text: string };

export interface TaskPhoto {
  id: string;
  /** SHA-256 of the stored file, 64 lowercase hex characters. */
  hash: string;
  /** Adelaide timestamp of when it was added. */
  addedAt: string;
  label: PhotoLabel | null;
  width: number;
  height: number;
  bytes: number;
  markup: MarkupShape[];
}

export const MAX_PHOTOS_PER_TASK = 40;
export const MAX_MARKUP_SHAPES = 60;
export const MAX_PEN_POINTS = 600;
export const MAX_MARKUP_TEXT = 80;
/** Photos over this are made smaller, never rejected. */
export const PHOTO_LIMIT_BYTES = 1024 * 1024;
export const PHOTO_MAX_SIDE = 2048;
/** A deleted photo stays in storage and in its backup for this many days. */
export const PHOTO_KEEP_DAYS = 30;
/** Markup has one ink, so red stays for real risk. */
export const MARKUP_INK = "#FFD23F";

export const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function photoLabelText(label: PhotoLabel | null): string {
  return label === "before" ? "Before" : label === "after" ? "After" : "";
}

export function photosOf(task: Pick<Task, "photos"> | undefined): TaskPhoto[] {
  return task?.photos ?? [];
}

export function newPhotoId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `photo-${random}`;
}

function withPhotos(task: Task, photos: TaskPhoto[], at: string, line: string): Task {
  const next: Task = { ...task, updatedAt: at, history: [...task.history, { at, text: line }] };
  if (photos.length) next.photos = photos;
  else delete next.photos;
  return next;
}

function mapTask(workspace: Workspace, taskId: string, change: (task: Task) => Task): Workspace {
  let changed = false;
  const tasks = workspace.tasks.map(task => {
    if (task.id !== taskId) return task;
    const next = change(task);
    if (next !== task) changed = true;
    return next;
  });
  return changed ? { ...workspace, tasks } : workspace;
}

export function addPhoto(workspace: Workspace, taskId: string, photo: TaskPhoto, at: string): Workspace {
  return mapTask(workspace, taskId, task => {
    const photos = photosOf(task);
    if (photos.some(p => p.id === photo.id) || photos.length >= MAX_PHOTOS_PER_TASK) return task;
    const label = photo.label ? ` (${photoLabelText(photo.label)})` : "";
    return withPhotos(task, [...photos, photo], at, `Photo added${label}.`);
  });
}

export function removePhoto(workspace: Workspace, taskId: string, photoId: string, at: string): Workspace {
  return mapTask(workspace, taskId, task => {
    const photos = photosOf(task);
    if (!photos.some(p => p.id === photoId)) return task;
    return withPhotos(task, photos.filter(p => p.id !== photoId), at, "Photo deleted.");
  });
}

export function setPhotoLabel(
  workspace: Workspace,
  taskId: string,
  photoId: string,
  label: PhotoLabel | null,
  at: string
): Workspace {
  return mapTask(workspace, taskId, task => {
    const photos = photosOf(task);
    const photo = photos.find(p => p.id === photoId);
    if (!photo || photo.label === label) return task;
    const text = label ? `Photo labelled ${photoLabelText(label)}.` : "Photo label removed.";
    return withPhotos(task, photos.map(p => (p.id === photoId ? { ...p, label } : p)), at, text);
  });
}

export function setPhotoMarkup(
  workspace: Workspace,
  taskId: string,
  photoId: string,
  markup: MarkupShape[],
  at: string
): Workspace {
  return mapTask(workspace, taskId, task => {
    const photos = photosOf(task);
    const photo = photos.find(p => p.id === photoId);
    if (!photo) return task;
    if (JSON.stringify(photo.markup) === JSON.stringify(markup)) return task;
    const clean = markup.slice(0, MAX_MARKUP_SHAPES).map(roundShape);
    const text = clean.length ? "Photo marked up." : "Photo markup removed.";
    return withPhotos(task, photos.map(p => (p.id === photoId ? { ...p, markup: clean } : p)), at, text);
  });
}

const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;

function roundShape(shape: MarkupShape): MarkupShape {
  if (shape.kind === "pen") return { kind: "pen", points: shape.points.slice(0, MAX_PEN_POINTS * 2).map(round) };
  if (shape.kind === "text") return { kind: "text", x: round(shape.x), y: round(shape.y), text: shape.text.slice(0, MAX_MARKUP_TEXT) };
  return { kind: shape.kind, x1: round(shape.x1), y1: round(shape.y1), x2: round(shape.x2), y2: round(shape.y2) };
}

/**
 * The pair shown Side by side: the earliest Before and the latest After.
 * Null unless the task has both.
 */
export function beforeAfterPair(task: Pick<Task, "photos">): { before: TaskPhoto; after: TaskPhoto } | null {
  const photos = photosOf(task);
  const before = photos.find(p => p.label === "before");
  const after = [...photos].reverse().find(p => p.label === "after");
  return before && after ? { before, after } : null;
}

export const AFTER_PROMPT_LINE = "Asked for an after photo.";

/** History lines written by photo changes (so text drafts don't see them as conflicts). */
export function isPhotoHistoryLine(text: string): boolean {
  return /^Photo (added|deleted|labelled|label removed|marked up|markup removed)\b/.test(text) || text === AFTER_PROMPT_LINE;
}

/**
 * "Add an after photo?" asks once, when a task with a Before and no After is
 * ticked. Tasks without photos never ask.
 */
export function wantsAfterPhoto(task: Task | undefined): boolean {
  if (!task) return false;
  const photos = photosOf(task);
  return (
    photos.some(p => p.label === "before") &&
    !photos.some(p => p.label === "after") &&
    !task.history.some(entry => entry.text === AFTER_PROMPT_LINE)
  );
}

export function markAfterPromptAsked(workspace: Workspace, taskId: string, at: string): Workspace {
  return mapTask(workspace, taskId, task =>
    task.history.some(entry => entry.text === AFTER_PROMPT_LINE)
      ? task
      : { ...task, history: [...task.history, { at, text: AFTER_PROMPT_LINE }] }
  );
}

/** Every photo fingerprint a workspace refers to. */
export function photoHashes(workspace: Pick<Workspace, "tasks">): Set<string> {
  const hashes = new Set<string>();
  for (const task of workspace.tasks) for (const photo of photosOf(task)) hashes.add(photo.hash);
  return hashes;
}

/**
 * Title for a task started from a + photo: the words said or typed before
 * tapping Photo, else "Photo job". It lands not-ready, for Sort.
 */
export function photoTaskTitle(words = ""): string {
  const clean = words.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!clean) return "Photo job";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function keepsPhotoLocation(workspace: Pick<Workspace, "keepPhotoLocation">): boolean {
  return workspace.keepPhotoLocation === true;
}

// ---- Validation (shared by the app and the server) ----

type Fail = (message: string) => never;
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

function exactKeys(value: Rec, keys: string[], label: string, fail: Fail) {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(k => !keys.includes(k))) fail(`${label} has unknown or missing fields.`);
}

function fraction(value: unknown, label: string, fail: Fail): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) fail(`${label} must be from 0 to 1.`);
  return value as number;
}

function shapeField(value: unknown, label: string, fail: Fail): MarkupShape {
  if (!isRec(value)) fail(`${label} is not an object.`);
  const v = value as Rec;
  if (v.kind === "arrow" || v.kind === "circle") {
    exactKeys(v, ["kind", "x1", "y1", "x2", "y2"], label, fail);
    return {
      kind: v.kind,
      x1: fraction(v.x1, label, fail),
      y1: fraction(v.y1, label, fail),
      x2: fraction(v.x2, label, fail),
      y2: fraction(v.y2, label, fail),
    };
  }
  if (v.kind === "pen") {
    exactKeys(v, ["kind", "points"], label, fail);
    if (!Array.isArray(v.points) || v.points.length % 2 !== 0 || v.points.length > MAX_PEN_POINTS * 2)
      fail(`${label} points must be pairs, at most ${MAX_PEN_POINTS}.`);
    return { kind: "pen", points: (v.points as unknown[]).map(p => fraction(p, label, fail)) };
  }
  if (v.kind === "text") {
    exactKeys(v, ["kind", "x", "y", "text"], label, fail);
    if (typeof v.text !== "string" || !v.text.trim() || v.text.length > MAX_MARKUP_TEXT)
      fail(`${label} text must be 1 to ${MAX_MARKUP_TEXT} characters.`);
    return { kind: "text", x: fraction(v.x, label, fail), y: fraction(v.y, label, fail), text: v.text as string };
  }
  return fail(`${label} has an unknown kind.`);
}

const PHOTO_KEYS = ["id", "hash", "addedAt", "label", "width", "height", "bytes", "markup"];

export function validatePhotos(value: unknown, label: string, fail: Fail): TaskPhoto[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PHOTOS_PER_TASK)
    fail(`${label} photos must be a list of 1 to ${MAX_PHOTOS_PER_TASK}.`);
  const ids = new Set<string>();
  return (value as unknown[]).map((entry, index) => {
    const name = `${label} photo ${index + 1}`;
    if (!isRec(entry)) fail(`${name} is not an object.`);
    const v = entry as Rec;
    exactKeys(v, PHOTO_KEYS, name, fail);
    if (typeof v.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v.id)) fail(`${name} id is not valid.`);
    if (ids.has(v.id as string)) fail(`${label} photo IDs must be unique.`);
    ids.add(v.id as string);
    if (typeof v.hash !== "string" || !HASH_PATTERN.test(v.hash)) fail(`${name} fingerprint is not valid.`);
    if (typeof v.addedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(v.addedAt) || !Number.isFinite(Date.parse(v.addedAt)))
      fail(`${name} addedAt must be a timestamp.`);
    if (v.label !== null && v.label !== "before" && v.label !== "after") fail(`${name} label must be before, after or null.`);
    for (const key of ["width", "height"] as const) {
      const n = v[key];
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 20000) fail(`${name} ${key} is not valid.`);
    }
    if (typeof v.bytes !== "number" || !Number.isInteger(v.bytes) || v.bytes < 1 || v.bytes > 20 * 1024 * 1024)
      fail(`${name} size is not valid.`);
    if (!Array.isArray(v.markup) || v.markup.length > MAX_MARKUP_SHAPES) fail(`${name} markup is not valid.`);
    return {
      id: v.id as string,
      hash: v.hash as string,
      addedAt: v.addedAt as string,
      label: v.label as PhotoLabel | null,
      width: v.width as number,
      height: v.height as number,
      bytes: v.bytes as number,
      markup: (v.markup as unknown[]).map((shape, i) => shapeField(shape, `${name} markup ${i + 1}`, fail)),
    };
  });
}
