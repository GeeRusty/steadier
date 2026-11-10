import React, { useSyncExternalStore, type CSSProperties } from "react";
import type { Imperative } from "../../domain/compass";
import type { Project, Task } from "../../domain/types";
import { adelaideClock } from "../../domain/time";
import {
  timingShapeForImperative,
  timingShapeForProject,
  timingShapeForTask,
  type TimingShape,
} from "../../domain/timingShape";
import {
  STATUS_MARK_COLOR_NAME,
  statusMarkColorForImperative,
  statusMarkColorForProject,
  statusMarkColorForTask,
  statusMarkColorHex,
} from "../../domain/statusMarkColor";
import {
  statusMarkColorAfterReviewFade,
  statusMarkGreyHex,
  statusMarkStalenessForImperative,
  statusMarkStalenessForProject,
  statusMarkStalenessForTask,
} from "../../domain/statusMarkStaleness";
import { useStatusMarkAppearance, useStatusMarkData } from "./TaskStates";

export type TimingShapeMarkProps =
  | { task: Task; project?: never; imperative?: never }
  | { project: Project; task?: never; imperative?: never }
  | { imperative: Imperative; task?: never; project?: never };

let currentClock = adelaideClock();
let ticker: number | null = null;
const listeners = new Set<() => void>();

function publishClock() {
  const next = adelaideClock();
  if (next.date === currentClock.date && next.minutes === currentClock.minutes)
    return;
  currentClock = next;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (ticker === null && typeof window !== "undefined")
    ticker = window.setInterval(publishClock, 30_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && ticker !== null && typeof window !== "undefined") {
      window.clearInterval(ticker);
      ticker = null;
    }
  };
}

function getSnapshot() {
  return currentClock;
}

export function useStatusMarkClock() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function TimingShapeIcon({
  shape,
  className = "timing-shape-icon",
}: {
  shape: TimingShape;
  className?: string;
}) {
  const symbolPath =
    shape === "ahead"
      ? "M12 19V5m-7 7 7-7 7 7"
      : shape === "behind"
        ? "M12 5v14m-7-7 7 7 7-7"
        : "M4 12h16";

  return (
    <svg
      className={className}
      data-mark-symbol={shape}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={symbolPath}
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function TimingShapeMark(props: TimingShapeMarkProps) {
  const clock = useStatusMarkClock();
  const markData = useStatusMarkData();
  const appearance = useStatusMarkAppearance();
  const shape = props.task
    ? timingShapeForTask(props.task, clock)
    : props.project
      ? timingShapeForProject(props.project, clock)
      : timingShapeForImperative(props.imperative, clock);
  const colorResult = markData
    ? props.task
      ? statusMarkColorForTask(props.task, markData)
      : props.project
        ? statusMarkColorForProject(props.project, markData)
        : statusMarkColorForImperative(props.imperative)
    : props.imperative
      ? statusMarkColorForImperative(props.imperative)
      : null;
  const color = colorResult?.color ?? null;
  const staleness = props.task
    ? statusMarkStalenessForTask(
        props.task,
        markData?.lastWeeklyReviewDate ?? null,
        clock
      )
    : props.project
      ? statusMarkStalenessForProject(
          props.project,
          markData?.lastWeeklyReviewDate ?? null,
          clock
        )
      : statusMarkStalenessForImperative(
          props.imperative,
          markData?.lastWeeklyReviewDate ?? null,
          clock
        );
  const arrowColor = staleness.grey
    ? statusMarkGreyHex(appearance)
    : color
      ? staleness.daysSinceReview !== null
        ? statusMarkColorAfterReviewFade(color, staleness.daysSinceReview, appearance)
        : statusMarkColorHex(color, appearance)
      : null;
  if (!shape) return null;

  const stalenessDescription = staleness.grey
    ? `Staleness: grey. ${staleness.reason}`
    : color && staleness.daysSinceReview !== null && staleness.daysSinceReview > 0
      ? `The alignment colour is fading; ${staleness.daysSinceReview} day${staleness.daysSinceReview === 1 ? "" : "s"} since the last Weekly Review.`
      : null;
  const description = [
    `Timing shape: ${shape.label}. ${shape.reason}`,
    colorResult
      ? `Alignment colour: ${color ? STATUS_MARK_COLOR_NAME[color] : "none"}. ${colorResult.reason}`
      : null,
    stalenessDescription,
  ].filter(Boolean).join(" ");

  return (
    <span
      className={`timing-shape-mark timing-shape-${shape.shape}${color ? ` timing-shape-color-${color}` : ""}${staleness.grey ? " timing-shape-grey" : ""}`}
      role="img"
      aria-label={description}
      title={description}
      style={arrowColor ? ({ "--status-mark-color": arrowColor } as CSSProperties) : undefined}
      data-shape={shape.shape}
      data-color={color ?? "none"}
      data-appearance={appearance}
      data-arrow-color={arrowColor ?? "none"}
      data-grey={staleness.grey}
      data-fade-days={staleness.daysSinceReview ?? "none"}
    >
      <TimingShapeIcon shape={shape.shape} />
    </span>
  );
}
