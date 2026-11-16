import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createTask } from "../domain/engine";
import { settleCardState } from "../domain/taskCard";
import { placeInProject } from "../domain/captureTo";
import {
  addPhoto,
  keepsPhotoLocation,
  newPhotoId,
  photoTaskTitle,
  removePhoto,
  type PhotoLabel,
  type TaskPhoto,
} from "../domain/photos";
import type { Task, Workspace } from "../domain/types";
import {
  PhotoOffline,
  discardPhoto,
  reportPhotoProblem,
  queuePhoto,
  queuedPhotos,
  unqueuePhoto,
  uploadPhoto,
  type UploadedPhoto,
} from "../lib/photoUpload";
import { adelaideTimestamp } from "../../../shared/time";

export interface PhotoBannerState {
  key: number;
  taskId: string;
  taskTitle: string;
  photoId: string | null;
  hash: string | null;
  label: PhotoLabel | null;
  /** A + photo started this task (Undo removes the task too, if untouched). */
  newTask: boolean;
  historyLength: number;
  offline: boolean;
  shrunkFrom: number | null;
  bytes: number;
  locationRemoved: boolean;
}

const BANNER_MS = 8000;

// Photo references stored on the server but not yet on their task.
const PENDING_KEY = "steadier.photo-refs.v1";
type PendingReference = { taskId: string; photo: TaskPhoto };
function pendingReferences(): PendingReference[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(v => v && typeof v.taskId === "string" && v.photo?.id) : [];
  } catch {
    return [];
  }
}
function rememberPendingReference(taskId: string, photo: TaskPhoto) {
  try {
    const list = pendingReferences().filter(p => p.photo.id !== photo.id);
    window.localStorage.setItem(PENDING_KEY, JSON.stringify([...list, { taskId, photo }].slice(-50)));
  } catch {
    /* storage unavailable */
  }
}
function forgetPendingReference(photoId: string) {
  try {
    const list = pendingReferences();
    if (list.some(p => p.photo.id === photoId))
      window.localStorage.setItem(PENDING_KEY, JSON.stringify(list.filter(p => p.photo.id !== photoId)));
  } catch {
    /* storage unavailable */
  }
}

/** "Leaking downpipe · Kingston" when the task has a project. */
function taskLabel(workspace: Workspace, task: Task): string {
  const project = task.projectId ? workspace.projects.find(p => p.id === task.projectId) : undefined;
  return project ? `${task.title} · ${project.title}` : task.title;
}

function record(uploaded: UploadedPhoto, label: PhotoLabel | null, id = newPhotoId()): TaskPhoto {
  return {
    id,
    hash: uploaded.hash,
    addedAt: adelaideTimestamp(),
    label,
    width: uploaded.width,
    height: uploaded.height,
    bytes: uploaded.bytes,
    markup: [],
  };
}

/**
 * Adding photos: upload (made smaller, location removed unless kept), then
 * save a reference on the task. Offline, the photo waits on this phone and
 * goes up when back online; it is never half-saved.
 */
export function usePhotoActions({
  getWorkspace,
  mutate,
  allowed,
  describeState,
}: {
  getWorkspace: () => Workspace;
  mutate: (change: (w: Workspace) => Workspace) => boolean;
  allowed: () => boolean;
  /** Sync status for the log when a save is refused, e.g. "loading". */
  describeState?: () => string;
}) {
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [banner, setBanner] = useState<PhotoBannerState | null>(null);
  const timer = useRef<number | null>(null);
  const flushing = useRef(false);

  const showBanner = useCallback((state: Omit<PhotoBannerState, "key">) => {
    if (timer.current) window.clearTimeout(timer.current);
    setBanner({ ...state, key: Date.now() });
    timer.current = window.setTimeout(() => setBanner(null), BANNER_MS);
  }, []);
  const closeBanner = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    setBanner(null);
  }, []);
  /** Keep the banner up while someone is using it (Mark up). */
  const holdBanner = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  /**
   * Put the stored photo on its task. Coming back from the camera, the app
   * refreshes from the server and briefly refuses changes; that refusal is
   * what left the 14:52 photo (16 Nov) off its task. So keep trying for a
   * minute, then keep the reference on this phone and finish it on the next
   * open or sync. Adding the same photo twice is a no-op.
   */
  const saveReference = useCallback(
    async (taskId: string, photo: TaskPhoto, quiet = false): Promise<boolean> => {
      const deadline = Date.now() + 60_000;
      let tries = 0;
      for (;;) {
        tries += 1;
        if (mutate(w => addPhoto(w, taskId, photo, photo.addedAt))) {
          forgetPendingReference(photo.id);
          if (tries > 1) reportPhotoProblem("save-reference", `saved after ${tries} tries (${describeState?.() ?? "state unknown"})`);
          return true;
        }
        if (tries === 1) reportPhotoProblem("save-reference", `refused, retrying (${describeState?.() ?? "state unknown"})`);
        if (Date.now() > deadline) break;
        await new Promise(resolve => window.setTimeout(resolve, 1500));
      }
      rememberPendingReference(taskId, photo);
      reportPhotoProblem("save-reference", `still refused after a minute; kept on the phone (${describeState?.() ?? "state unknown"})`);
      if (!quiet) toast.error("The photo is saved on the server. It will appear on the task once Steadier finishes syncing.");
      return false;
    },
    [describeState, mutate]
  );

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (const pending of pendingReferences()) {
        if (!getWorkspace().tasks.some(t => t.id === pending.taskId)) {
          forgetPendingReference(pending.photo.id);
          continue;
        }
        await saveReference(pending.taskId, pending.photo, true);
      }
      for (const item of await queuedPhotos()) {
        const task = getWorkspace().tasks.find(t => t.id === item.taskId);
        if (!task) {
          await unqueuePhoto(item.id);
          continue;
        }
        try {
          const uploaded = await uploadPhoto(item.blob, item.keepLocation);
          if (await saveReference(item.taskId, record(uploaded, item.label, item.id), true)) {
            await unqueuePhoto(item.id);
            toast.success(`Photo uploaded to “${task.title}”.`);
          }
        } catch (error) {
          if (error instanceof PhotoOffline) return;
          await unqueuePhoto(item.id);
          toast.error(error instanceof Error ? error.message : "A waiting photo couldn't be saved.");
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [getWorkspace, saveReference]);

  useEffect(() => {
    void flush();
    const online = () => void flush();
    const visible = () => {
      if (document.visibilityState === "visible") void flush();
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [flush]);

  /** Add a photo to an existing task (from its sheet or a prompt). */
  const attach = useCallback(
    async (
      taskId: string,
      file: File,
      label: PhotoLabel | null,
      options: { banner?: boolean; newTask?: boolean; task?: Task } = {}
    ) => {
      if (!allowed()) return false;
      const keepLocation = keepsPhotoLocation(getWorkspace());
      // A task made a moment ago (+ Photo) isn't in the rendered copy yet, so
      // the caller hands it over. (Looking it up here alone was the bug that
      // left "Photo job" tasks without their photo, 16 Nov.)
      const task = getWorkspace().tasks.find(t => t.id === taskId) ?? options.task;
      if (!task) {
        toast.error("The photo wasn't added: its task couldn't be found. Try again from the task.");
        reportPhotoProblem("attach", "task not found");
        return false;
      }
      setBusyTaskId(taskId);
      try {
        const uploaded = await uploadPhoto(file, keepLocation);
        const photo = record(uploaded, label);
        if (!(await saveReference(taskId, photo))) return false;
        if (options.banner) {
          showBanner({
            taskId,
            taskTitle: taskLabel(getWorkspace(), task),
            photoId: photo.id,
            hash: photo.hash,
            label,
            newTask: Boolean(options.newTask),
            // The task plus the one "Photo added" line just written.
            historyLength: task.history.length + 1,
            offline: false,
            shrunkFrom: uploaded.shrunk ? uploaded.originalBytes : null,
            bytes: uploaded.bytes,
            locationRemoved: uploaded.locationRemoved,
          });
        } else {
          toast.success(uploaded.shrunk ? "Photo added (made smaller)." : "Photo added.");
        }
        return true;
      } catch (error) {
        if (error instanceof PhotoOffline) {
          const queued = await queuePhoto({ id: newPhotoId(), taskId, label, keepLocation, blob: file, queuedAt: adelaideTimestamp() });
          reportPhotoProblem("upload", `offline or unreachable: ${error.message}`);
          if (!queued) {
            toast.error("You're offline and this phone couldn't hold the photo. Try again when online.");
            return false;
          }
          if (options.banner) {
            showBanner({
              taskId,
              taskTitle: taskLabel(getWorkspace(), task),
              photoId: null,
              hash: null,
              label,
              newTask: Boolean(options.newTask),
              historyLength: task.history.length,
              offline: true,
              shrunkFrom: null,
              bytes: 0,
              locationRemoved: !keepLocation,
            });
          } else toast.success("Photo added · will upload when online.");
          return true;
        }
        const message = error instanceof Error ? error.message : "The photo couldn't be saved.";
        toast.error(message);
        reportPhotoProblem("upload", message);
        return false;
      } finally {
        setBusyTaskId(null);
      }
    },
    [allowed, getWorkspace, saveReference, showBanner]
  );

  /**
   * A photo from +: always a NEW captured task (never the Now task), titled
   * from the words given, else "Photo job". It lands not-ready, for Sort.
   */
  const startPhotoTask = useCallback(
    async (file: File, words: string, place: { projectId: string; session: boolean } | null = null) => {
      if (!allowed()) return false;
      const at = adelaideTimestamp();
      const base = createTask({ title: photoTaskTitle(words), state: "inbox" });
      let started: Task = {
        ...base,
        actionConfirmed: false,
        history: [...base.history, { at, text: "Started from a photo." }],
      };
      // Capture to a project: a session photo's task gets that project as its Place.
      const project = place ? getWorkspace().projects.find(p => p.id === place.projectId && p.status === "active") : undefined;
      if (project && place) started = placeInProject(started, project, place.session, at);
      const task: Task = settleCardState(started);
      if (!mutate(w => ({ ...w, tasks: [...w.tasks, task] }))) {
        toast.error("The task wasn't saved. Check sync and try again.");
        return false;
      }
      return attach(task.id, file, "before", { banner: true, newTask: true, task });
    },
    [allowed, attach, getWorkspace, mutate]
  );

  /** Undo on the banner: remove the photo (and the task it started, if untouched). */
  const undoBanner = useCallback(async () => {
    const current = banner;
    closeBanner();
    if (!current) return;
    if (current.offline) {
      for (const item of await queuedPhotos()) if (item.taskId === current.taskId) await unqueuePhoto(item.id);
    }
    const at = adelaideTimestamp();
    const ok = mutate(w => {
      const task = w.tasks.find(t => t.id === current.taskId);
      if (!task) return w;
      const untouched = current.newTask && task.history.length <= current.historyLength;
      if (untouched) return { ...w, tasks: w.tasks.filter(t => t.id !== current.taskId) };
      return current.photoId ? removePhoto(w, current.taskId, current.photoId, at) : w;
    });
    if (!ok) {
      toast.error("Undo didn't save. Check sync, then delete the photo from the task.");
      return;
    }
    if (current.hash) void discardPhoto(current.hash);
    toast.success(current.newTask ? "Photo and its task removed." : "Photo removed.");
  }, [banner, closeBanner, mutate]);

  return { attach, startPhotoTask, busyTaskId, banner, closeBanner, holdBanner, undoBanner };
}
