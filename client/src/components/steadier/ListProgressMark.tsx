import React from "react";
import type { Workspace } from "../../domain/types";
import { parentProgress } from "../../domain/lists";

/**
 * A card's list run in progress. A grey chip when the card has room (fewer
 * than two chips); otherwise a quiet line inside the card, so it never
 * displaces "review due", "moved" or any other status chip.
 */
export default function ListProgressMark({
  workspace,
  kind = "task",
  id,
  chipCount,
  onOpenList,
}: {
  workspace: Workspace | undefined;
  kind?: "task" | "project";
  id: string;
  chipCount: number;
  /** Tapping the progress opens that list directly (not the card's sheet). */
  onOpenList?: (templateId: string) => void;
}) {
  if (!workspace?.lists) return null;
  const progress = parentProgress(workspace, kind, id);
  if (!progress) return null;
  const className = chipCount < 2 ? "tp-chip" : "tp-meta lv-inside";
  const text = chipCount < 2 ? progress.label : `${progress.title} · ${progress.done} of ${progress.total} ticked`;
  if (!onOpenList) return <span className={className}>{text}</span>;
  // The mark sits inside the card's own button, so it is a span with a
  // button role (a nested <button> is invalid) and stops the card opening.
  const open = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onOpenList(progress.templateId);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      className={`${className} lv-open`}
      aria-label={`Open list ${progress.title}, ${progress.done} of ${progress.total} ticked`}
      onClick={open}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") open(e);
      }}
    >
      {text}
    </span>
  );
}

/** Whether a card has list progress to show (so the signals area appears). */
export function hasListProgress(workspace: Workspace | undefined, id: string, kind: "task" | "project" = "task"): boolean {
  return Boolean(workspace?.lists && parentProgress(workspace, kind, id));
}
