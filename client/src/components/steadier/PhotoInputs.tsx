import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";

/**
 * One pair of file inputs (Camera, Gallery) at the root of the app, outside
 * every sheet and dialog. On a phone the camera opens another app; if the
 * sheet that asked for the photo closes or redraws meanwhile, an input inside
 * it would be gone and the photo silently lost. These never go away.
 */
type Request = (source: "camera" | "gallery", onFile: (file: File) => void) => void;

const PhotoRequestContext = createContext<Request | null>(null);

export function usePhotoRequest(): Request | null {
  return useContext(PhotoRequestContext);
}

export function PhotoInputsProvider({ children }: { children: React.ReactNode }) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const pending = useRef<((file: File) => void) | null>(null);
  const request = useCallback<Request>((source, onFile) => {
    pending.current = onFile;
    (source === "camera" ? camera : gallery).current?.click();
  }, []);
  const picked = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    const handler = pending.current;
    pending.current = null;
    if (file && handler) handler(file);
  };
  const value = useMemo(() => request, [request]);
  return (
    <PhotoRequestContext.Provider value={value}>
      {children}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        data-photo-input="camera"
        onChange={e => picked(e.currentTarget)}
      />
      <input
        ref={gallery}
        type="file"
        accept="image/*,.heic,.heif"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        data-photo-input="gallery"
        onChange={e => picked(e.currentTarget)}
      />
    </PhotoRequestContext.Provider>
  );
}
