import React, { useRef, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, Download, Pencil, Trash2, X } from "lucide-react";
import {
  beforeAfterPair,
  photoLabelText,
  photosOf,
  removePhoto,
  setPhotoLabel,
  setPhotoMarkup,
  type PhotoLabel,
  type TaskPhoto,
} from "../../domain/photos";
import type { Task, Workspace } from "../../domain/types";
import { photoUrl } from "../../lib/photoUpload";
import { adelaideTimestamp } from "../../../../shared/time";
import PhotoMarkup, { MarkupLayer, PhotoLayer, burnMarkup } from "./PhotoMarkup";

/** The two hidden file inputs behind "+ Photo": Camera or Gallery. */
export function PhotoPicker({
  disabled,
  onPick,
  label = "+ Photo",
  className = "tp-btn",
}: {
  disabled?: boolean;
  onPick: (file: File) => void;
  label?: React.ReactNode;
  className?: string;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const picked = (input: HTMLInputElement | null) => {
    const file = input?.files?.[0];
    if (input) input.value = "";
    setOpen(false);
    if (file) onPick(file);
  };
  return (
    <span className="ph-picker">
      <button type="button" className={className} disabled={disabled} aria-expanded={open} onClick={() => setOpen(v => !v)}>
        {label}
      </button>
      {open && (
        <span className="ph-picker-menu" role="group" aria-label="Add a photo from">
          <button type="button" className="tp-btn" onClick={() => camera.current?.click()}>
            <Camera size={16} aria-hidden="true" /> Camera
          </button>
          <button type="button" className="tp-btn" onClick={() => gallery.current?.click()}>
            Gallery
          </button>
        </span>
      )}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={e => picked(e.currentTarget)} />
      <input ref={gallery} type="file" accept="image/*,.heic,.heif" hidden onChange={e => picked(e.currentTarget)} />
    </span>
  );
}

function shortDate(at: string): string {
  const d = new Date(at);
  return Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Adelaide", weekday: "short", day: "numeric", month: "short" }).format(d)
    : "";
}

function PhotoImage({ photo, thumb = false }: { photo: TaskPhoto; thumb?: boolean }) {
  const [gone, setGone] = useState(false);
  if (gone) return <span className="ph-gone">Photo no longer stored</span>;
  return (
    <span className="ph-frame" data-markup-for={thumb ? undefined : photo.id} style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
      <img src={photoUrl(photo.hash, thumb)} alt="" loading="lazy" onError={() => setGone(true)} />
      {!thumb && photo.markup.length > 0 && <MarkupLayer shapes={photo.markup} width={photo.width} height={photo.height} />}
    </span>
  );
}

export function PhotoViewer({
  task,
  startId,
  readOnly,
  onMutate,
  onClose,
}: {
  task: Task;
  startId: string;
  readOnly: boolean;
  onMutate: (change: (w: Workspace) => Workspace) => boolean;
  onClose: () => void;
}) {
  const photos = photosOf(task);
  const [currentId, setCurrentId] = useState(startId);
  const [mode, setMode] = useState<"one" | "pair">("one");
  const [marking, setMarking] = useState(false);
  const [problem, setProblem] = useState("");
  const index = Math.max(0, photos.findIndex(p => p.id === currentId));
  const photo = photos[index];
  const pair = beforeAfterPair(task);
  if (!photo) return null;

  const change = (update: (w: Workspace) => Workspace) => {
    setProblem("");
    if (!onMutate(update)) setProblem("Not saved. Check sync and try again.");
  };
  const setLabel = (label: PhotoLabel | null) => change(w => setPhotoLabel(w, task.id, photo.id, label, adelaideTimestamp()));
  const remove = () => {
    if (!window.confirm("Delete this photo? It's kept in backups for 30 days, then removed.")) return;
    const next = photos[index + 1] ?? photos[index - 1];
    change(w => removePhoto(w, task.id, photo.id, adelaideTimestamp()));
    if (next) setCurrentId(next.id);
    else onClose();
  };
  const download = async () => {
    setProblem("");
    try {
      const blob = await burnMarkup(photo);
      const name = `${task.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 40) || "photo"}${photo.label ? ` ${photoLabelText(photo.label)}` : ""}.jpg`;
      const file = new File([blob], name, { type: "image/jpeg" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: task.title });
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setProblem(error instanceof Error ? error.message : "Couldn't make the copy.");
    }
  };

  if (marking) {
    return (
      <PhotoMarkup
        photo={photo}
        onCancel={() => setMarking(false)}
        onSave={shapes => {
          change(w => setPhotoMarkup(w, task.id, photo.id, shapes, adelaideTimestamp()));
          setMarking(false);
        }}
      />
    );
  }

  return (
    <PhotoLayer label={`Photos of ${task.title}`} onClose={onClose}>
      <div className="ph-vbar">
        <button type="button" className="ph-vbtn" aria-label="Close photos" onClick={onClose}>
          <X size={22} aria-hidden="true" />
        </button>
        <span className="ph-vtitle">{task.title}</span>
        {!readOnly && (
          <button type="button" className="ph-vbtn" aria-label="Delete this photo" onClick={remove}>
            <Trash2 size={20} aria-hidden="true" />
          </button>
        )}
      </div>
      {pair && (
        <div className="ph-seg" role="group" aria-label="Show">
          <button type="button" className={mode === "one" && photo.id === pair.before.id ? "is-on" : ""} onClick={() => { setMode("one"); setCurrentId(pair.before.id); }}>Before</button>
          <button type="button" className={mode === "one" && photo.id === pair.after.id ? "is-on" : ""} onClick={() => { setMode("one"); setCurrentId(pair.after.id); }}>After</button>
          <button type="button" className={mode === "pair" ? "is-on" : ""} onClick={() => setMode("pair")}>Side by side</button>
        </div>
      )}
      {mode === "pair" && pair ? (
        <div className="ph-pair">
          {[pair.before, pair.after].map(p => (
            <figure key={p.id}>
              <PhotoImage photo={p} />
              <figcaption><b>{photoLabelText(p.label)}</b> · {shortDate(p.addedAt)}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <>
          <div className="ph-stage">
            {photos.length > 1 && (
              <button type="button" className="ph-vbtn ph-prev" aria-label="Previous photo" disabled={index === 0} onClick={() => setCurrentId(photos[index - 1].id)}>
                <ChevronLeft size={26} aria-hidden="true" />
              </button>
            )}
            <PhotoImage photo={photo} />
            {photos.length > 1 && (
              <button type="button" className="ph-vbtn ph-next" aria-label="Next photo" disabled={index === photos.length - 1} onClick={() => setCurrentId(photos[index + 1].id)}>
                <ChevronRight size={26} aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="ph-vnote">
            {photos.length > 1 ? `${index + 1} of ${photos.length} · ` : ""}
            Added {shortDate(photo.addedAt)}
          </p>
          <div className="ph-vbody">
            <span className="ph-vnote">This photo is labelled</span>
            <div className="ph-seg" role="group" aria-label="Label this photo">
              {(["before", "after", null] as const).map(value => (
                <button key={String(value)} type="button" disabled={readOnly} aria-pressed={photo.label === value} className={photo.label === value ? "is-on" : ""} onClick={() => setLabel(value)}>
                  {value ? photoLabelText(value) : "No label"}
                </button>
              ))}
            </div>
            <div className="ph-vactions">
              {!readOnly && (
                <button type="button" className="ph-vbtn ph-wide" onClick={() => setMarking(true)}>
                  <Pencil size={18} aria-hidden="true" /> {photo.markup.length ? "Change markup" : "Mark up"}
                </button>
              )}
              <button type="button" className="ph-vbtn ph-wide" onClick={download}>
                <Download size={18} aria-hidden="true" /> Save a copy
              </button>
            </div>
          </div>
        </>
      )}
      {problem && <p className="ph-vnote" role="alert">{problem}</p>}
    </PhotoLayer>
  );
}

/** Photos on the task sheet: under the notes, newest last. */
export default function TaskPhotos({
  task,
  keepLocation,
  readOnly,
  busy,
  onAdd,
  onMutate,
}: {
  task: Task;
  keepLocation: boolean;
  readOnly: boolean;
  busy: boolean;
  onAdd: (file: File) => void;
  onMutate: (change: (w: Workspace) => Workspace) => boolean;
}) {
  const photos = photosOf(task);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="task-view-section ph-section" aria-labelledby="task-view-photos-heading">
      <h3 id="task-view-photos-heading">Photos{photos.length ? ` (${photos.length})` : ""}</h3>
      <div className="ph-grid">
        {photos.map(photo => (
          <button key={photo.id} type="button" className="ph-thumb" aria-label={`Open photo${photo.label ? `, ${photoLabelText(photo.label)}` : ""}${photo.markup.length ? ", marked up" : ""}`} onClick={() => setOpen(photo.id)}>
            <PhotoImage photo={photo} thumb />
            {photo.markup.length > 0 && (
              <span className="ph-mk" aria-hidden="true">
                <Pencil size={13} />
              </span>
            )}
            {photo.label && <span className="ph-lbl">{photoLabelText(photo.label)}</span>}
          </button>
        ))}
        {!readOnly && (
          <PhotoPicker
            disabled={busy}
            onPick={onAdd}
            className="ph-add"
            label={
              <>
                <Camera size={22} aria-hidden="true" />
                {busy ? "Adding…" : "+ Photo"}
              </>
            }
          />
        )}
      </div>
      <p className="task-view-empty ph-location">
        {keepLocation ? "Location on · kept in new photos" : "Location off · removed from these photos"}
        {!readOnly && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              const next = !keepLocation;
              const question = next
                ? "Keep location inside new photos from now on? Photos already saved don't change."
                : "Remove location from new photos from now on? Photos already saved don't change.";
              if (!window.confirm(question)) return;
              onMutate(w => {
                const { keepPhotoLocation: _old, ...rest } = w;
                return next ? { ...rest, keepPhotoLocation: true } : rest;
              });
            }}
          >
            Change
          </button>
        )}
      </p>
      {open && <PhotoViewer task={task} startId={open} readOnly={readOnly} onMutate={onMutate} onClose={() => setOpen(null)} />}
    </section>
  );
}
