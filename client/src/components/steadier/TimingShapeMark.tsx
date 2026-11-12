import React, { useSyncExternalStore } from "react";
import { Unlink } from "lucide-react";
import { taskChips } from "../../domain/todayPlan";
import { effectiveTaskRole } from "../../domain/linkCheck";
import { daysBetween } from "../../domain/time";
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

export type TimingShapeMarkProps = (
  | { task: Task; project?: never; imperative?: never }
  | { project: Project; task?: never; imperative?: never }
  | { imperative: Imperative; task?: never; project?: never }
) & {
  /** The row already shows the green left bar. */
  noGreen?: boolean;
};

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

/**
 * Status signals (docs/design-language.md). The old shape-and-colour arrows
 * are gone; meaning is mapped to the card signals:
 * on track → nothing · behind → overdue · moved 3+ → moved N× · quiet → quiet Nd
 * · review due → review due · green → green bar · red link gap → broken-link
 * icon · Life Admin / Erosion Guard → a text label. Chips are grey.
 */
export default function TimingShapeMark(props: TimingShapeMarkProps) {
  const clock = useStatusMarkClock();
  const markData = useStatusMarkData();
  const lastReview = markData?.lastWeeklyReviewDate ?? null;
  const chips: string[] = [];
  let green = false;
  let broken = false;
  let label: string | null = null;

  if (props.task) {
    const task = props.task;
    if (task.state === "done" || task.state === "someday") return null;
    chips.push(...taskChips(task, { day: clock.date, minute: clock.minutes, lastReviewDate: lastReview }).map(c => c.text));
    if (markData) {
      const color = statusMarkColorForTask(task, markData).color;
      broken = !!task.projectId && color === "red";
      green = effectiveTaskRole(task, { projects: markData.projects, imperatives: markData.imperatives }) === "direction";
      label = color === "blue" ? "Life Admin" : color === "purple" ? "Erosion Guard" : null;
    }
  } else if (props.project) {
    const project = props.project;
    if (project.status !== "active") return null;
    const deadline = project.schedule?.deadline;
    if (deadline && deadline < clock.date) chips.push(`overdue ${daysBetween(deadline, clock.date)}d`);
    const stale = statusMarkStalenessForProject(project, lastReview, clock);
    if (project.schedule?.reviewDate && project.schedule.reviewDate <= clock.date) chips.push("review due");
    else if (stale.quietDays !== null && stale.quietDays >= 7) chips.push(`quiet ${stale.quietDays}d`);
    if (markData) {
      const color = statusMarkColorForProject(project, markData).color;
      broken = color === "red";
      green = color === "green";
    }
  } else if (props.imperative) {
    const stale = statusMarkStalenessForImperative(props.imperative, lastReview, clock);
    if (stale.quietDays !== null && stale.quietDays >= 7) chips.push(`quiet ${stale.quietDays}d`);
  }

  if (props.noGreen) green = false;
  const shown = chips.slice(0, 2);
  if (!shown.length && !green && !broken && !label) return null;
  const description = [
    green ? "Serves an Imperative." : null,
    broken ? "Missing its Goal Outcome or Imperative link." : null,
    label,
    ...shown,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="status-signals" title={description}>
      {green && <span className="sig-green" role="img" aria-label="Serves an Imperative" />}
      {shown.map(text => (
        <span key={text} className="tp-chip sig-chip">
          {text}
        </span>
      ))}
      {broken && <Unlink size={15} className="sig-broken" role="img" aria-label="Missing its Goal Outcome or Imperative link" />}
      {label && <span className="sig-label">{label}</span>}
    </span>
  );
}
