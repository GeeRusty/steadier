import { createContext, useContext, useMemo, useState } from "react";
import { CircleDot, Flag, Volume2, X } from "lucide-react";
import type { Task, Workspace, Place } from "../../domain/types";
import {
  bannerTasks,
  dismissBanner,
  formatAge,
  orphanInfo,
  orphanReport,
  orphanSentence,
  STAGE_LABEL,
} from "../../domain/orphans";
import { isUnplaced } from "../../domain/compass";
import { useNow } from "../../hooks/useNow";
import { UnplacedPanel } from "./CompassPanels";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";

type Mutate = (fn: (w: Workspace) => Workspace) => boolean | void;

/** "4 unplaced · 1 overdue". Hidden when every task has a home. */
export function OrphanPill({
  workspace,
  onOpen,
  compact = false,
}: {
  workspace: Workspace;
  onOpen: () => void;
  compact?: boolean;
}) {
  const now = useNow();
  const report = useMemo(
    () => orphanReport(workspace.tasks, now),
    [workspace.tasks, now]
  );
  if (!report.count) return null;
  const level = report.overdue ? 3 : report.flagged ? 2 : 1;
  return (
    <button
      className={`orphan-pill level-${level}${compact ? " compact" : ""}`}
      onClick={onOpen}
      aria-label={`${orphanSentence(report)} Open the list.`}
    >
      {level >= 2 ? (
        <Flag size={14} aria-hidden />
      ) : (
        <CircleDot size={14} aria-hidden />
      )}
      <span>
        {report.count} unplaced
        {report.overdue ? ` · ${report.overdue} overdue` : ""}
      </span>
    </button>
  );
}

/**
 * Stage 2 notice: shown on the first open after a task reaches 24 hours (or
 * at once for urgent ones), at most once a day per device. Not a pop-up.
 */
export function OrphanBanner({
  workspace,
  onOpen,
  onRead,
}: {
  workspace: Workspace;
  onOpen: () => void;
  onRead: (text: string) => void;
}) {
  const now = useNow();
  const [hidden, setHidden] = useState(false);
  const report = useMemo(
    () => orphanReport(workspace.tasks, now),
    [workspace.tasks, now]
  );
  const fresh = useMemo(() => bannerTasks(report, now), [report, now]);
  if (hidden || !fresh.length) return null;
  const sentence = `${fresh.length} task${fresh.length === 1 ? " needs" : "s need"} a home: ${fresh
    .slice(0, 4)
    .map(i => i.task.title)
    .join("; ")}${fresh.length > 4 ? ", and more" : ""}.`;
  const close = () => {
    dismissBanner(report, now);
    setHidden(true);
  };
  return (
    <section
      className="orphan-banner"
      role="status"
      aria-label="Unplaced tasks"
    >
      <Flag size={18} aria-hidden />
      <p>
        <strong>
          {fresh.length} task{fresh.length === 1 ? " needs" : "s need"} a home
        </strong>
        <span className="small">
          {" "}
          {fresh
            .slice(0, 3)
            .map(i => i.task.title)
            .join(" · ")}
          {fresh.length > 3 ? " …" : ""}
        </span>
      </p>
      <div className="orphan-banner-actions">
        <button
          className="button primary small-button"
          onClick={() => {
            close();
            onOpen();
          }}
        >
          Place now
        </button>
        <button
          className="text-button"
          onClick={() => onRead(sentence)}
          aria-label="Read aloud"
        >
          <Volume2 size={15} />
        </button>
        <button
          className="text-button"
          onClick={close}
          aria-label="Later today"
        >
          <X size={15} /> Later
        </button>
      </div>
    </section>
  );
}

/** The list, opened from the counter on any page. */
export function OrphanSheet({
  open,
  onClose,
  workspace,
  onMutate,
  onOpenTask,
  onRead,
  readOnly,
}: {
  open: boolean;
  onClose: () => void;
  workspace: Workspace;
  onMutate: Mutate;
  onOpenTask: (task: Task) => void;
  onRead: (text: string) => void;
  readOnly: boolean;
}) {
  if (!open) return null;
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="orphan-sheet">
        <DialogTitle className="dialog-heading">
          Give each task a home
        </DialogTitle>
        <DialogDescription>
          One tap each. Nothing is filed for you.
        </DialogDescription>
        <UnplacedPanel
          workspace={workspace}
          onMutate={onMutate}
          onOpenTask={task => {
            onClose();
            onOpenTask(task);
          }}
          onRead={onRead}
          readOnly={readOnly}
          limit={40}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Small marker on a task card: a quiet dot at Stage 1, a flag from Stage 2. */
/** The full task list, so marks can see a subtask's parent placement. */
export const TaskListContext = createContext<Task[] | undefined>(undefined);
/** Saved places, for "at …" badges on task cards (v2.7). */
export const PlacesContext = createContext<Place[]>([]);
export function OrphanMark({ task, tasks }: { task: Task; tasks?: Task[] }) {
  const all = useContext(TaskListContext);
  if (!isUnplaced(task, tasks ?? all)) return null;
  const info = orphanInfo(task);
  if (info.stage === 0) return null;
  const label = `${STAGE_LABEL[info.stage]} · ${formatAge(info.ageHours)}${info.urgent ? ` · ${info.urgent}` : ""}`;
  return (
    <span className={`orphan-mark stage-${info.stage}`} title={label}>
      {info.stage === 1 ? (
        <CircleDot size={12} aria-hidden />
      ) : (
        <Flag size={12} aria-hidden />
      )}
      {info.stage >= 2 && (
        <span>
          {info.stage === 3 ? "Overdue for placement" : "Needs a home"}
        </span>
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}
