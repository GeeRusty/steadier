import { describe, expect, it } from "vitest";
import { createTask, updateTask } from "./engine";
import { taskMatchesExpectedSnapshot } from "./taskAutosave";
import { validateWorkspace } from "./transfer";
import {
  addPhoto,
  beforeAfterPair,
  markAfterPromptAsked,
  photoHashes,
  photoTaskTitle,
  removePhoto,
  setPhotoLabel,
  setPhotoMarkup,
  wantsAfterPhoto,
  type TaskPhoto,
} from "./photos";
import type { Workspace } from "./types";

const AT = "2026-11-16T10:00:00+10:30";

function emptyWorkspace(): Workspace {
  return {
    version: 2,
    tasks: [],
    projects: [],
    focus: null,
    intention: null,
    matrixWeights: { "direction-timely": 1, "direction-sustained": 1, "support-timely": 1, "support-sustained": 1 },
    trial: { startedAt: AT, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [],
  };
}


const hash = (c: string) => c.repeat(64);
const photo = (id: string, label: TaskPhoto["label"], h = "a"): TaskPhoto => ({
  id,
  hash: hash(h),
  addedAt: AT,
  label,
  width: 2048,
  height: 1536,
  bytes: 480_000,
  markup: [],
});

function workspaceWith(): { w: Workspace; id: string } {
  const task = createTask({ title: "Fix dripping kitchen tap" });
  return { w: { ...emptyWorkspace(), tasks: [task] }, id: task.id };
}

describe("photos on tasks", () => {
  it("adds, labels, marks up and deletes a photo, with history lines", () => {
    const { w, id } = workspaceWith();
    let next = addPhoto(w, id, photo("photo-1", "before"), AT);
    next = setPhotoLabel(next, id, "photo-1", "after", AT);
    next = setPhotoMarkup(next, id, "photo-1", [{ kind: "circle", x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.4 }], AT);
    const task = next.tasks[0];
    expect(task.photos?.[0].label).toBe("after");
    expect(task.photos?.[0].markup).toHaveLength(1);
    expect(task.history.map(h => h.text)).toEqual(
      expect.arrayContaining(["Photo added (Before).", "Photo labelled After.", "Photo marked up."])
    );
    const removed = removePhoto(next, id, "photo-1", AT).tasks[0];
    expect(removed.photos).toBeUndefined();
  });

  it("keeps only references in the workspace, and they survive the strict check", () => {
    const { w, id } = workspaceWith();
    const next = addPhoto(w, id, photo("photo-1", "before"), AT);
    const json = JSON.parse(JSON.stringify(next));
    const loaded = validateWorkspace(json);
    expect(loaded.tasks[0].photos?.[0].hash).toBe(hash("a"));
    expect(JSON.stringify(loaded.tasks[0].photos).length).toBeLessThan(400);
  });

  it("rejects a bad fingerprint or unknown photo fields", () => {
    const { w, id } = workspaceWith();
    const bad = JSON.parse(JSON.stringify(addPhoto(w, id, photo("photo-1", null), AT)));
    bad.tasks[0].photos[0].hash = "not-a-hash";
    expect(() => validateWorkspace(bad)).toThrow(/fingerprint/);
    const extra = JSON.parse(JSON.stringify(addPhoto(w, id, photo("photo-1", null), AT)));
    extra.tasks[0].photos[0].data = "base64…";
    expect(() => validateWorkspace(extra)).toThrow();
  });

  it("pairs the earliest Before with the latest After", () => {
    const { w, id } = workspaceWith();
    let next = addPhoto(w, id, photo("b1", "before", "a"), AT);
    next = addPhoto(next, id, photo("b2", "before", "b"), AT);
    next = addPhoto(next, id, photo("a1", "after", "c"), AT);
    next = addPhoto(next, id, photo("a2", "after", "d"), AT);
    const pair = beforeAfterPair(next.tasks[0]);
    expect(pair?.before.id).toBe("b1");
    expect(pair?.after.id).toBe("a2");
  });

  it("asks for an after photo once, only with a Before and no After", () => {
    const { w, id } = workspaceWith();
    expect(wantsAfterPhoto(w.tasks[0])).toBe(false);
    const withBefore = addPhoto(w, id, photo("b1", "before"), AT);
    expect(wantsAfterPhoto(withBefore.tasks[0])).toBe(true);
    const asked = markAfterPromptAsked(withBefore, id, AT);
    expect(wantsAfterPhoto(asked.tasks[0])).toBe(false);
    const withAfter = addPhoto(withBefore, id, photo("a1", "after", "b"), AT);
    expect(wantsAfterPhoto(withAfter.tasks[0])).toBe(false);
  });

  it("collects every fingerprint a workspace refers to", () => {
    const { w, id } = workspaceWith();
    const next = addPhoto(addPhoto(w, id, photo("1", null, "a"), AT), id, photo("2", null, "b"), AT);
    expect([...photoHashes(next)].sort()).toEqual([hash("a"), hash("b")]);
  });

  it("titles a + photo task from the words, else Photo job", () => {
    expect(photoTaskTitle("  leaking downpipe ")).toBe("Leaking downpipe");
    expect(photoTaskTitle("")).toBe("Photo job");
  });

  it("only allows a boolean keepPhotoLocation", () => {
    const w = JSON.parse(JSON.stringify({ ...emptyWorkspace(), keepPhotoLocation: true }));
    expect(validateWorkspace(w).keepPhotoLocation).toBe(true);
    expect(() => validateWorkspace({ ...w, keepPhotoLocation: "yes" })).toThrow();
  });

  it("never lets an older text draft drop a photo added meanwhile", () => {
    const { w, id } = workspaceWith();
    const draft = { ...w.tasks[0], notes: "washer is 1/2 inch" };
    const withPhoto = addPhoto(w, id, photo("photo-1", "before"), AT);
    const saved = updateTask(withPhoto.tasks[0], draft, "Updated task.");
    expect(saved.notes).toBe("washer is 1/2 inch");
    expect(saved.photos?.map(p => p.id)).toEqual(["photo-1"]);
    expect(taskMatchesExpectedSnapshot(withPhoto.tasks[0], w.tasks[0])).toBe(true);
  });
});

