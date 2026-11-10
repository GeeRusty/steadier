import React, { createContext, useContext } from "react";
import { CircleDot, Clock3 } from "lucide-react";
import {
  KIND_LABEL,
  heldReason,
  taskKind,
  type KindContext,
  type TaskKind,
} from "../../domain/todayStates";
import type { Task } from "../../domain/types";
import type { StatusMarkData } from "../../domain/statusMarkColor";
import type { Appearance } from "../../domain/appearance";

interface KindValue {
  ctx: KindContext;
  tasks: Task[];
  statusMarkData: StatusMarkData;
  appearance: Appearance;
}

/** Supplied once by Home so every card shows the same four states. */
export const TaskKindContext = createContext<KindValue | null>(null);

export function useStatusMarkData(): StatusMarkData | null {
  return useContext(TaskKindContext)?.statusMarkData ?? null;
}

export function useStatusMarkAppearance(): Appearance {
  return useContext(TaskKindContext)?.appearance ?? "light";
}

export function useTaskKind(task: Task): TaskKind | null {
  const value = useContext(TaskKindContext);
  return value ? taskKind(task, value.ctx) : null;
}

/** "kind-scheduled" etc., for card outlines. Empty when unknown or done. */
export function useKindClass(task: Task): string {
  const kind = useTaskKind(task);
  return kind ? ` kind-${kind}` : "";
}

/**
 * The state badge: filled (Scheduled), outlined with a dot (Chosen),
 * dashed (Suggested), flat grey with a reason tag (Held).
 */
export function StateMark({
  task,
  hideScheduled = false,
}: {
  task: Task;
  hideScheduled?: boolean;
}) {
  const value = useContext(TaskKindContext);
  if (!value) return null;
  const kind = taskKind(task, value.ctx);
  if (!kind || (hideScheduled && kind === "scheduled")) return null;
  const reason = kind === "held" ? heldReason(task, value.tasks) : null;
  return (
    <>
      <span className={`state-mark mark-${kind}`}>
        {kind === "scheduled" ? (
          <Clock3 size={11} aria-hidden="true" />
        ) : kind === "chosen" ? (
          <CircleDot size={11} aria-hidden="true" />
        ) : null}
        {KIND_LABEL[kind]}
      </span>
      {reason && <span className="reason-tag">{reason}</span>}
    </>
  );
}
