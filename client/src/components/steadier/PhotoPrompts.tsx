import React, { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { photoLabelText, photosOf, type TaskPhoto } from "../../domain/photos";
import type { Task } from "../../domain/types";
import { photoUrl, sizeText } from "../../lib/photoUpload";
import type { PhotoBannerState } from "../../hooks/usePhotoActions";
import { usePhotoRequest } from "./PhotoInputs";

/**
 * The capture banner: plain grey and white, under the header, 8 seconds or
 * until tapped away. No red, no tick animation.
 */
export function PhotoBanner({
  banner,
  onMarkUp,
  onOpen,
  onUndo,
  onClose,
}: {
  banner: PhotoBannerState;
  onMarkUp: () => void;
  onOpen: () => void;
  onUndo: () => void;
  onClose: () => void;
}) {
  return (
    <div className="ph-banner" role="status" aria-live="polite">
      <div className="ph-banner-row">
        {banner.hash ? (
          <img className="ph-banner-thumb" src={photoUrl(banner.hash, true)} alt="" />
        ) : (
          <span className="ph-banner-thumb ph-banner-wait" aria-hidden="true">
            <Camera size={18} />
          </span>
        )}
        <span className="ph-banner-text">
          <b>
            {banner.offline ? "Photo added · will upload when online" : `Photo added${banner.label ? ` · ${photoLabelText(banner.label)}` : ""}`}
          </b>
          <span className="ph-banner-meta">{banner.taskTitle}</span>
        </span>
        <button type="button" className="ph-banner-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {(banner.shrunkFrom || banner.locationRemoved) && (
        <span className="ph-banner-meta">
          {[
            banner.shrunkFrom ? `Made smaller: ${sizeText(banner.shrunkFrom)} → ${sizeText(banner.bytes)}` : null,
            banner.locationRemoved ? "location removed" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      )}
      <div className="ph-banner-actions">
        {banner.photoId && (
          <button type="button" className="ph-banner-link" onClick={onMarkUp}>
            Mark up
          </button>
        )}
        <button type="button" className="ph-banner-link" onClick={onOpen}>
          Open
        </button>
        <button type="button" className="ph-banner-link" onClick={onUndo}>
          Undo
        </button>
      </div>
    </div>
  );
}

function Thumb({ photo, label }: { photo: TaskPhoto; label?: string }) {
  return (
    <span className="ph-slot">
      <img src={photoUrl(photo.hash, true)} alt="" />
      {label && <span className="ph-lbl">{label}</span>}
    </span>
  );
}

/** A picked-but-not-yet-saved photo, shown from the phone's own copy. */
export function LocalPreview({ file, label }: { file: File; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return (
    <span className="ph-slot">
      {url && <img src={url} alt="" />}
      <span className="ph-lbl">{label}</span>
    </span>
  );
}

/** Camera / gallery for a single slot (root inputs when available). */
export function SlotInputs({ onPick, children }: { onPick: (file: File) => void; children: (open: { camera: () => void; gallery: () => void }) => React.ReactNode }) {
  const request = usePhotoRequest();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const picked = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    if (file) onPick(file);
  };
  const open = (source: "camera" | "gallery") =>
    request ? request(source, onPick) : (source === "camera" ? camera : gallery).current?.click();
  return (
    <>
      {children({ camera: () => open("camera"), gallery: () => open("gallery") })}
      {!request && (
        <>
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={e => picked(e.currentTarget)} />
          <input ref={gallery} type="file" accept="image/*,.heic,.heif" hidden onChange={e => picked(e.currentTarget)} />
        </>
      )}
    </>
  );
}

/**
 * "Add an after photo?" Only for a ticked task with a Before and no After;
 * asked once. The task is already done; Not now changes nothing.
 */
export function AfterPhotoPrompt({
  task,
  onPick,
  onClose,
}: {
  task: Task;
  onPick: (file: File) => void;
  onClose: () => void;
}) {
  const before = photosOf(task).find(p => p.label === "before");
  return (
    <div className="uk-overlay">
      <button type="button" className="uk-scrim" aria-label="Not now" onClick={onClose} />
      <section className="uk-prompt" role="dialog" aria-modal="true" aria-labelledby="after-photo-title">
        <SlotInputs
          onPick={file => {
            onPick(file);
            onClose();
          }}
        >
          {open => (
            <div className="lv-form">
              <h2 id="after-photo-title" className="lv-subheading">
                Add an after photo?
              </h2>
              <span className="lv-meta">{task.title} · done</span>
              <span className="ph-slots">
                {before && <Thumb photo={before} label={`Before`} />}
                <button type="button" className="ph-slot ph-slot-add" onClick={open.camera}>
                  <Camera size={22} aria-hidden="true" />
                  After
                </button>
              </span>
              <span className="lv-row-actions">
                <button type="button" className="tp-btn tp-btn-primary" onClick={open.camera}>
                  Take after photo
                </button>
                <button type="button" className="tp-btn" onClick={onClose}>
                  Not now
                </button>
              </span>
              <button type="button" className="text-button ph-gallery-link" onClick={open.gallery}>
                Choose from gallery
              </button>
            </div>
          )}
        </SlotInputs>
      </section>
    </div>
  );
}

export { Thumb as PhotoThumb };
