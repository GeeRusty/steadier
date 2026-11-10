import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Info, Mic, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";
import type { Task, Workspace } from "../../domain/types";
import type { CloudStatus } from "../../../../shared/cloud";
import { backupOverdue, daysSinceBackup } from "../../domain/todayStates";

/** Today's intention as a slim bar. Folds to one line once you scroll. */
export function IntentionBar(p: {
  workspace: Workspace;
  day: string;
  readOnly: boolean;
  onEdit: (listen: boolean) => void;
  onReanchor: () => void;
}) {
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    const onScroll = () => setFolded(window.scrollY > 48);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const intention = p.workspace.intention;
  const isToday = intention?.date === p.day;
  const chosen = isToday
    ? p.workspace.tasks.find(t => t.id === intention?.taskId)
    : undefined;
  const words = isToday ? intention?.text.trim() || chosen?.title || "" : "";
  return (
    <div className={`intention-bar${folded ? " folded" : ""}`}>
      {words ? (
        <button
          className="intention-text"
          onClick={() => p.onEdit(false)}
          aria-label={`Today's intention: ${words}. Tap to change.`}
        >
          <span className="lbl">Today’s intention</span>
          <span className="words">{words}</span>
        </button>
      ) : (
        <div className="intention-empty">
          <button
            className="intention-speak"
            disabled={p.readOnly}
            onClick={() => p.onEdit(true)}
          >
            <Mic size={17} aria-hidden="true" /> Say intention
          </button>
          <button
            className="text-button"
            disabled={p.readOnly}
            onClick={() => p.onEdit(false)}
          >
            Type
          </button>
        </div>
      )}
      <button className="reanchor" onClick={p.onReanchor}>
        <RotateCcw size={15} aria-hidden="true" />
        <span>Re-anchor</span>
      </button>
    </div>
  );
}

/** One tap: today's intention and the next action, large, and spoken. */
export function ReanchorDialog(p: {
  workspace: Workspace;
  day: string;
  nowTask: Task | undefined;
  onClose: () => void;
  onRead: (text: string) => void;
  onSetIntention: () => void;
}) {
  const intention = p.workspace.intention;
  const isToday = intention?.date === p.day;
  const words = isToday ? intention?.text.trim() : "";
  const step = p.nowTask?.nextAction?.trim() || "";
  useEffect(() => {
    const parts = [
      words ? `Today's intention: ${words}.` : "No intention set for today.",
      p.nowTask ? `Now: ${p.nowTask.title}.` : "",
      step ? `Next action: ${step}.` : "",
    ].filter(Boolean);
    p.onRead(parts.join(" "));
    // Spoken once when opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Dialog open onOpenChange={open => !open && p.onClose()}>
      <DialogContent className="reanchor-dialog">
        <DialogTitle className="sr-only">Re-anchor</DialogTitle>
        <DialogDescription className="sr-only">
          Today's intention and your next action.
        </DialogDescription>
        <span className="lbl">Today’s intention</span>
        {words ? (
          <p className="reanchor-words">{words}</p>
        ) : (
          <button className="intention-speak big" onClick={p.onSetIntention}>
            <Mic size={20} aria-hidden="true" /> Say today’s intention
          </button>
        )}
        {p.nowTask && (
          <>
            <span className="lbl">Now</span>
            <p className="reanchor-task">{p.nowTask.title}</p>
            {step && (
              <>
                <span className="lbl">Next action</span>
                <p className="reanchor-step">{step}</p>
              </>
            )}
          </>
        )}
        <button className="now-main" onClick={p.onClose}>
          Back to it <ArrowRight size={20} aria-hidden="true" />
        </button>
      </DialogContent>
    </Dialog>
  );
}

/** The existing intention editor, opened from the bar. */
export function IntentionDialog(p: {
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={open => !open && p.onClose()}>
      <DialogContent className="intention-dialog">
        <DialogTitle className="sr-only">Today’s intention</DialogTitle>
        <DialogDescription className="sr-only">
          Say or type one line for today, then save.
        </DialogDescription>
        {p.children}
      </DialogContent>
    </Dialog>
  );
}

export interface SystemRisk {
  kind: "backup" | "sync" | "storage";
  message: string;
  action: string;
}

/**
 * A genuine data risk: no backup download for 7 days (or ever, once there is
 * data), a failed or conflicting sync, or a browser that refused to store.
 */
export function systemRisk(input: {
  personal: boolean;
  hasData: boolean;
  lastExportAt: string | null | undefined;
  cloudActive: boolean;
  status: CloudStatus;
  storageError: string | null | undefined;
}): SystemRisk | null {
  // In shared mode the hook reports sync problems through storageError too.
  // Check the sync state first so a conflict says "Choose" and opens the
  // Server & Compass chooser, not a misleading browser-storage "Back up".
  if (input.cloudActive && input.status === "conflict")
    return {
      kind: "sync",
      message:
        "Another device or tab changed this workspace. Both versions are kept; choose which to keep.",
      action: "Choose",
    };
  if (input.cloudActive && input.status === "error")
    return {
      kind: "sync",
      message: input.storageError || "Sync failed",
      action: "Fix",
    };
  if (input.storageError)
    return {
      kind: "storage",
      message: input.storageError,
      action: "Back up",
    };
  if (input.personal && input.hasData && backupOverdue(input.lastExportAt)) {
    const days = daysSinceBackup(input.lastExportAt);
    return {
      kind: "backup",
      message:
        days === null
          ? "No backup downloaded yet"
          : `No backup download for ${days} days`,
      action: "Back up",
    };
  }
  return null;
}

/** Small header marker; hidden while a risk banner is showing. */
export function StatusMarker(p: {
  demo: boolean;
  cloudActive: boolean;
  status: CloudStatus;
  pending: boolean;
  onOpen: () => void;
}) {
  const [label, tone] = p.demo
    ? ["Sample", "quiet"]
    : !p.cloudActive
      ? ["On this browser", "quiet"]
      : p.status === "saving" || p.pending
        ? ["Saving", "busy"]
        : p.status === "offline"
          ? ["Offline", "busy"]
          : p.status === "loading"
            ? ["Connecting", "busy"]
            : ["Saved", "ok"];
  return (
    <button
      className={`status-marker tone-${tone}`}
      onClick={p.onOpen}
      aria-label={`Status: ${label}. Open backups and server.`}
    >
      <span className="status-dot" aria-hidden="true" />
      <span className="status-label">{label}</span>
    </button>
  );
}

export function RiskBanner(p: { risk: SystemRisk; onAct: () => void }) {
  return (
    <div className="risk-banner" role="alert">
      <AlertTriangle size={17} aria-hidden="true" />
      <span>{p.risk.message}</span>
      <button onClick={p.onAct}>{p.risk.action}</button>
    </div>
  );
}

/** Philosophy lines live behind an info icon instead of on the page. */
export function TodayInfo() {
  const [open, setOpen] = useState(false);
  return (
    <span className="today-info">
      <button
        className="icon-button small-icon"
        aria-label="About this page"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Info size={17} />
      </button>
      {open && (
        <span className="today-info-pop" role="note">
          You don’t need to do everything. Just the next right thing.
          <br />
          Suggestions are not instructions. Held work returns through review,
          not invented urgency.
        </span>
      )}
    </span>
  );
}
