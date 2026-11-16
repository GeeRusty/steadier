/**
 * Photos on tasks: prepare on the phone, upload, and wait offline.
 *
 * Location off (the default): the phone redraws the photo on a canvas, which
 * drops every hidden detail (location, camera serial, time) and makes it
 * smaller. The server re-encodes again and checks nothing is left.
 * Location on: the original goes up so the server can keep its details.
 * Photos are never rejected for size: anything over the limit is shrunk.
 */
import { PHOTO_LIMIT_BYTES, PHOTO_MAX_SIDE } from "../domain/photos";

export interface UploadedPhoto {
  hash: string;
  width: number;
  height: number;
  bytes: number;
  originalBytes: number;
  shrunk: boolean;
  locationRemoved: boolean;
}

export class PhotoOffline extends Error {}

export function photoUrl(hash: string, thumb = false): string {
  return `/api/steadier/photos/${hash}${thumb ? ".thumb" : ""}.jpg`;
}

async function canvasShrink(file: Blob): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    return null; // e.g. HEIC in Chrome: the server converts it.
  }
  try {
    for (const side of [PHOTO_MAX_SIDE, 1600, 1280, 1024]) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.84));
      canvas.width = 0;
      canvas.height = 0;
      if (blob && blob.size <= PHOTO_LIMIT_BYTES) return blob;
      if (!blob) return null;
    }
    return null;
  } finally {
    bitmap.close();
  }
}

/** What actually gets sent: the phone's smaller copy when it can make one. */
export async function preparePhoto(file: Blob, keepLocation: boolean): Promise<Blob> {
  if (keepLocation) return file;
  return (await canvasShrink(file)) ?? file;
}

export async function uploadPhoto(file: Blob, keepLocation: boolean, originalBytes = file.size): Promise<UploadedPhoto> {
  const body = await preparePhoto(file, keepLocation);
  let response: Response;
  try {
    response = await fetch(`/api/steadier/photos${keepLocation ? "?location=keep" : ""}`, {
      method: "POST",
      body,
      credentials: "include",
      cache: "no-store",
      headers: { "X-Steadier-Request": "1", "Content-Type": body.type || "application/octet-stream" },
    });
  } catch {
    throw new PhotoOffline("Offline");
  }
  const reply = (await response.json().catch(() => null)) as (UploadedPhoto & { error?: string }) | null;
  if (!response.ok || !reply || reply.error) {
    // Proxy or restart (502–504): try again when back. Anything else is a real error to show.
    if (response.status === 0 || (response.status >= 502 && response.status <= 504)) throw new PhotoOffline(`HTTP ${response.status}`);
    throw new Error(reply?.error ?? "The photo couldn't be saved.");
  }
  return { ...reply, originalBytes: Math.max(originalBytes, reply.originalBytes), shrunk: reply.shrunk || originalBytes > PHOTO_LIMIT_BYTES };
}

/** Undo straight after adding: the server removes it if nothing refers to it. */
export async function discardPhoto(hash: string): Promise<void> {
  try {
    await fetch(`/api/steadier/photos/${hash}`, {
      method: "DELETE",
      credentials: "include",
      headers: { "X-Steadier-Request": "1" },
    });
  } catch {
    /* the 30-day rule cleans it up */
  }
}

/** Tell the server log why a photo didn't attach (no photo contents are sent). */
export function reportPhotoProblem(stage: string, message: string): void {
  try {
    void fetch("/api/steadier/photos-trace", {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json", "X-Steadier-Request": "1" },
      body: JSON.stringify({ stage: stage.slice(0, 60), message: message.slice(0, 200) }),
    }).catch(() => undefined);
  } catch {
    /* never in the way */
  }
}

export function sizeText(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---- Waiting offline (IndexedDB) ----

export interface QueuedPhoto {
  id: string;
  taskId: string;
  label: "before" | "after" | null;
  keepLocation: boolean;
  blob: Blob;
  queuedAt: string;
}

const DB = "steadier-photo-queue";
const STORE = "photos";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function queuePhoto(item: QueuedPhoto): Promise<boolean> {
  try {
    await withStore("readwrite", store => store.put(item));
    return true;
  } catch {
    return false;
  }
}

export async function queuedPhotos(): Promise<QueuedPhoto[]> {
  try {
    return await withStore<QueuedPhoto[]>("readonly", store => store.getAll() as IDBRequest<QueuedPhoto[]>);
  } catch {
    return [];
  }
}

export async function unqueuePhoto(id: string): Promise<void> {
  try {
    await withStore("readwrite", store => store.delete(id));
  } catch {
    /* tried */
  }
}
