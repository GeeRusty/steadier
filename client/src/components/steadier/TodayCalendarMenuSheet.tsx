import React, { useEffect, useId, useState } from "react";
import { Flag, Info, Mic, RotateCcw, ShieldCheck, Volume2, X } from "lucide-react";
import type { Appearance } from "../../domain/appearance";
import AppearanceToggle from "./AppearanceToggle";

/** "plain": a page whose explanation sits behind its own info icon (Review due, Weekly Review). */
export type ScreenMenuPage = "today" | "calendar" | "all" | "plain";
export type ScreenMenuKind = "app" | "page";

interface Props {
  kind: ScreenMenuKind;
  page: ScreenMenuPage;
  appearance: Appearance;
  onAppearance: (value: Appearance) => void;
  connectionText: string;
  flagCount: number;
  canUndo: boolean;
  onClose: () => void;
  onFlag: () => void;
  onConnection: () => void;
  onIntention: () => void;
  onReanchor: () => void;
  onBackups: () => void;
  onSpeak: () => void;
  onRead: () => void;
  onUndo: () => void;
}

const ALL_GUIDE =
  "All work is for finding anything. Rows are grouped by project, with the project's Outcome once at the top. Tap the circle to complete a task; tap the row to open it. Grey chips show only what's off normal.";
const CALENDAR_GUIDE =
  "Calendar grids show booked anchors and hard-deadline points. Deadline points don't reserve time. To add a booked anchor, tap an empty time in Day view; flexible windows and date-only deadlines stay untimed. Month previews up to three items per day; tap a date for its full day. Board lists each booking as time · task · status; status shows only when something is off, such as the likely finish when it's 10 or more minutes late (red if it runs into the next booking).";
const TODAY_GUIDE =
  "Use the Today / Overview switch at the top of My life today. Today shows the read-only day timeline above Next thing; edit booked timing in Calendar. Choose one task as your Next thing, then complete it with Done or return it to the pool with Not now.";

export default function TodayCalendarMenuSheet({
  kind,
  page,
  appearance,
  onAppearance,
  connectionText,
  flagCount,
  canUndo,
  onClose,
  onFlag,
  onConnection,
  onIntention,
  onReanchor,
  onBackups,
  onSpeak,
  onRead,
  onUndo,
}: Props) {
  const titleId = useId();
  const [guideOpen, setGuideOpen] = useState(page === "calendar");
  const isApp = kind === "app";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const runAndClose = (action: () => void) => {
    action();
    onClose();
  };
  const guide = page === "today" ? TODAY_GUIDE : page === "all" ? ALL_GUIDE : CALENDAR_GUIDE;

  return (
    <div className={`v2-menu-overlay v2-menu-${kind}`}>
      <button
        type="button"
        className="v2-menu-scrim"
        aria-label={`Close ${isApp ? "App" : "This page"} menu`}
        onClick={onClose}
      />
      <section
        className="v2-menu-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="v2-menu-heading">
          <h2 id={titleId}>{isApp ? "App" : "This page"}</h2>
          <button type="button" className="v2-menu-close" onClick={onClose} aria-label="Close menu">
            <X size={18} aria-hidden="true" /> Close
          </button>
        </header>

        {isApp ? (
          <div className="v2-menu-rows">
            <div className="v2-menu-row v2-menu-theme">
              <span>Theme</span>
              <AppearanceToggle appearance={appearance} onChange={onAppearance} />
            </div>
            <button type="button" className="v2-menu-row" onClick={() => runAndClose(onFlag)}>
              <span>Flag</span>
              {flagCount > 0 && <span className="v2-menu-row-value"><Flag size={15} aria-hidden="true" /> {flagCount}</span>}
            </button>
            {page === "today" ? (
              <button type="button" className="v2-menu-row" onClick={() => runAndClose(onConnection)}>
                <span>Connection</span>
                <span className="v2-menu-row-value">{connectionText}</span>
              </button>
            ) : null}
            {page === "today" ? (
              <>
                <button type="button" className="v2-menu-row" onClick={() => runAndClose(onIntention)}>
                  <span>Say intention</span><Mic size={16} aria-hidden="true" />
                </button>
                <button type="button" className="v2-menu-row" onClick={() => runAndClose(onReanchor)}>
                  <span>Re-anchor</span><RotateCcw size={16} aria-hidden="true" />
                </button>
                <button type="button" className="v2-menu-row" onClick={() => runAndClose(onBackups)}>
                  <span>Backups</span><ShieldCheck size={16} aria-hidden="true" />
                </button>
              </>
            ) : (
              <>
                <button type="button" className="v2-menu-row" onClick={() => runAndClose(onSpeak)}>
                  <span>Speak</span><Mic size={16} aria-hidden="true" />
                </button>
                <button type="button" className="v2-menu-row" onClick={() => runAndClose(onConnection)}>
                  <span>Connection</span><span className="v2-menu-row-value">{connectionText}</span>
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="v2-menu-rows">
            <button type="button" className="v2-menu-row" onClick={onRead}>
              <span>Read aloud</span><Volume2 size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="v2-menu-row"
              onClick={() => runAndClose(onUndo)}
              disabled={!canUndo}
              aria-disabled={!canUndo}
            >
              <span>Undo</span><RotateCcw size={16} aria-hidden="true" />
            </button>
            {page !== "plain" && <button
              type="button"
              className="v2-menu-row"
              aria-expanded={guideOpen}
              onClick={() => setGuideOpen(value => !value)}
            >
              <span>{page === "calendar" ? "How this calendar works" : "How this page works"} <Info size={15} aria-hidden="true" /></span>
              <span className="v2-menu-row-value">{guideOpen ? "Hide" : "Show"}</span>
            </button>}
            {page !== "plain" && guideOpen && (
              <p className="v2-menu-guide" role="note">
                {guide}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export { CALENDAR_GUIDE, TODAY_GUIDE };
