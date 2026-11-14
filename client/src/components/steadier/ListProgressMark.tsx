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
}: {
  workspace: Workspace | undefined;
  kind?: "task" | "project";
  id: string;
  chipCount: number;
}) {
  if (!workspace?.lists) return null;
  const progress = parentProgress(workspace, kind, id);
  if (!progress) return null;
  return chipCount < 2 ? (
    <span className="tp-chip">{progress.label}</span>
  ) : (
    <span className="tp-meta lv-inside">
      {progress.title} · {progress.done} of {progress.total} ticked
    </span>
  );
}

/** Whether a card has list progress to show (so the signals area appears). */
export function hasListProgress(workspace: Workspace | undefined, id: string, kind: "task" | "project" = "task"): boolean {
  return Boolean(workspace?.lists && parentProgress(workspace, kind, id));
}
