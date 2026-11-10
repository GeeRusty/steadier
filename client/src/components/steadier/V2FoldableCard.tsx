import React, { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function foldPreferenceKey(key: string): string {
  return `steadier.ui.v2.fold.${key}`;
}

export function readFoldPreference(
  key: string,
  defaultOpen: boolean,
  storage?: StorageLike
): boolean {
  try {
    const target = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
    const value = target?.getItem(foldPreferenceKey(key));
    if (value === "open") return true;
    if (value === "closed") return false;
  } catch {
    // A blocked local store should not prevent the card from being usable.
  }
  return defaultOpen;
}

function writeFoldPreference(key: string, open: boolean): void {
  try {
    window.localStorage.setItem(foldPreferenceKey(key), open ? "open" : "closed");
  } catch {
    // Keep the in-memory fold state even when the WebView blocks local storage.
  }
}

export default function V2FoldableCard({
  title,
  count,
  storageKey,
  defaultOpen,
  className = "",
  children,
}: {
  title: string;
  count?: string | number;
  storageKey: string;
  defaultOpen: boolean;
  className?: string;
  children: ReactNode;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(() => readFoldPreference(storageKey, defaultOpen));
  const toggle = () => {
    const next = !open;
    setOpen(next);
    writeFoldPreference(storageKey, next);
  };

  return (
    <section className={`v2-fold-card ${className}`.trim()}>
      <button
        type="button"
        className="v2-fold-header"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <span className="v2-fold-title">{title}</span>
        {count !== undefined && (
          <>
            <span className="v2-fold-separator" aria-hidden="true">·</span>
            <span className="v2-fold-count">{count}</span>
          </>
        )}
        <span className="v2-fold-action">{open ? "Hide" : "Show"}</span>
        {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
      </button>
      <div id={panelId} className="v2-fold-panel" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
