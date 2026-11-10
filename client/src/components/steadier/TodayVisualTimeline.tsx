import React, { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Repeat, Volume2 } from "lucide-react";
import type { CSSProperties } from "react";
import type { Project, Task } from "../../domain/types";
import {
  adelaideClock,
  DEFAULT_PLANNING,
  formatCompactDuration,
  formatDuration,
  formatTime,
  minutesToTime,
  type PlanningSettings,
} from "../../domain/time";
import { estimateAnchorFinish } from "../../domain/anchorPlanning";
import {
  buildTodayVisualTimelineModel,
  type TodayVisualTimelineModel,
} from "../../domain/todayVisualTimeline";
import type { CalendarItem, CalendarItemKind } from "../../domain/calendarModel";
import TimingShapeMark from "./TimingShapeMark";

const MIN_STRIP_WIDTH = 720;
const PX_PER_HOUR = 56;
const LANE_HEIGHT = 32;

interface Props {
  tasks: Task[];
  projects: Project[];
  planning?: PlanningSettings;
  compact?: boolean;
  syncStatus?: "local" | "loading" | "synced" | "saving" | "offline" | "conflict" | "error";
  lastSyncedAt?: string | null;
  pendingSync?: boolean;
  online?: boolean;
  onCalendar?: () => void;
  onOpenTask?: (task: Task) => void;
  onRead?: (text: string) => void;
}

function syncDescription(
  status: Props["syncStatus"],
  lastSyncedAt: string | null,
  pendingSync: boolean,
  online: boolean
): string {
  const last = lastSyncedAt && Number.isFinite(Date.parse(lastSyncedAt))
    ? new Intl.DateTimeFormat("en-AU", {
        timeZone: "Australia/Adelaide",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(lastSyncedAt))
    : null;
  if (status === "local") return "Local only · saved on this device, not synced to a server.";
  if (status === "conflict") return `Sync conflict · changes need review${last ? `; last confirmed sync ${last}` : ""}.`;
  if (status === "error") return `Sync unavailable${last ? ` · last confirmed sync ${last}` : " · no confirmed sync yet"}.`;
  if (status === "offline" || !online) return `Offline${last ? ` · last confirmed sync ${last}` : " · no confirmed sync yet"}${pendingSync ? " · changes waiting to sync" : ""}.`;
  if (status === "loading") return `Checking shared workspace${last ? ` · last confirmed sync ${last}` : ""}…`;
  if (status === "saving" || pendingSync) return `Saving to shared workspace${last ? ` · last confirmed sync ${last}` : ""}…`;
  return `Shared workspace synced${last ? ` · ${last}` : ""}.`;
}

function kindLabel(kind: CalendarItemKind): string {
  switch (kind) {
    case "slot":
      return "Booked anchor";
    case "projected":
      return "Repeating booked anchor";
    case "allday":
      return "All-day booked anchor";
    case "window":
      return "Flexible work";
    case "deadline":
      return "Hard deadline time";
    case "planned-date":
      return "Planned date · not booked";
    case "project-deadline":
      return "Project deadline";
    case "project-review":
      return "Project review";
    case "milestone":
      return "Milestone";
    case "obligation":
      return "Bill or obligation";
    case "credential-renewal":
      return "Credential renewal";
    case "birthday":
      return "Birthday";
  }
}

function agendaStateLabel(task: Task): string {
  switch (task.state) {
    case "done": return "Done";
    case "waiting": return "Waiting";
    case "blocked": return "Blocked";
    case "someday": return "Someday";
    case "inbox": return "Inbox";
    default: return "Active";
  }
}

function atMinute(minute: number): string {
  return minute >= 24 * 60 ? "midnight" : formatTime(minutesToTime(minute));
}

function itemAriaLabel(item: CalendarItem): string {
  const details = [kindLabel(item.kind), item.title];
  if (item.kind === "deadline" && item.start !== undefined) {
    details.push(`${formatTime(minutesToTime(item.start))}, deadline point`);
  } else if (item.start !== undefined && item.minutes !== undefined) {
    details.push(
      `${formatTime(minutesToTime(item.start))}, ${formatDuration(item.minutes)}`
    );
    if ((item.lanes ?? 1) > 1) details.push("overlaps another booked anchor");
  }
  if (item.label) details.push(item.label);
  if (item.done) details.push("completed");
  if (item.repeating) details.push("repeating");
  if (item.fixed && item.kind !== "deadline") details.push("booked anchor");
  return details.join(". ");
}

function spokenTimeline(model: TodayVisualTimelineModel, nowMinutes: number): string {
  const timedAnchors = model.day.timed.filter(
    item => item.fixed && item.kind !== "deadline"
  );
  const deadlinePoints = model.day.timed.filter(
    item => item.kind === "deadline"
  );
  const parts = [
    `Today's timeline runs from ${atMinute(model.startHour * 60)} to ${atMinute(model.endHour * 60)}. Timed bars open task details; timing edits are made in Calendar.`,
  ];
  if (timedAnchors.length) {
    parts.push(
      `Booked anchors: ${timedAnchors
        .map(item =>
          `${item.title} at ${formatTime(minutesToTime(item.start ?? 0))} for ${formatDuration(item.minutes ?? 0)}`
        )
        .join("; ")}.`
    );
  } else {
    parts.push("There are no timed booked anchors.");
  }
  if (deadlinePoints.length) {
    parts.push(
      `Informational hard-deadline points, not booked time: ${deadlinePoints
        .map(item => `${item.title} at ${formatTime(minutesToTime(item.start ?? 0))}`)
        .join("; ")}.`
    );
  }
  if (model.day.allDay.length) {
    parts.push(
      `All-day booked anchors: ${model.day.allDay
        .map(item => item.title)
        .join("; ")}.`
    );
  }
  parts.push(`${model.freeAfterLabel}: ${formatDuration(model.freeAfterMinutes)}.`);
  if (model.overrunSamples < 3) parts.push("Overrun learns from your history.");
  if (model.overlapCount)
    parts.push(
      `${model.overlapCount} booked-anchor pair${model.overlapCount === 1 ? " overlaps" : "s overlap"}.`
    );
  parts.push(`The current Adelaide-local time is ${atMinute(nowMinutes)}.`);
  return parts.join(" ");
}

export default function TodayVisualTimeline({
  tasks,
  projects,
  planning = DEFAULT_PLANNING,
  compact = false,
  syncStatus = "local",
  lastSyncedAt = null,
  pendingSync = false,
  online = true,
  onCalendar = () => undefined,
  onOpenTask,
  onRead,
}: Props) {
  const [clock, setClock] = useState(() => adelaideClock());
  const [compactWidth, setCompactWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(adelaideClock()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const model = useMemo(
    () =>
      buildTodayVisualTimelineModel(
        tasks,
        projects,
        clock.date,
        clock.minutes,
        planning
      ),
    [tasks, projects, clock.date, clock.minutes, planning]
  );
  const tasksById = useMemo(
    () => new Map(tasks.map(task => [task.id, task])),
    [tasks]
  );
  const startMinute = model.startHour * 60;
  const endMinute = model.endHour * 60;
  const rangeMinutes = Math.max(60, endMinute - startMinute);
  const stripWidth = Math.max(MIN_STRIP_WIDTH, rangeMinutes * (PX_PER_HOUR / 60));
  const pxPerMinute = stripWidth / rangeMinutes;
  const maxLane = model.day.timed.reduce(
    (max, item) => Math.max(max, item.lane ?? 0),
    0
  );
  const trackHeight = Math.max(54, 18 + (maxLane + 1) * LANE_HEIGHT);
  const nowText = formatTime(minutesToTime(clock.minutes));
  const nowLeft = (clock.minutes - startMinute) * pxPerMinute;
  const bookedCount = model.day.timed.filter(
    item => item.fixed && item.kind !== "deadline"
  ).length +
    model.day.allDay.filter(item => item.fixed).length;
  const deadlinePointCount = model.day.timed.filter(
    item => item.kind === "deadline"
  ).length;
  const agendaItems = [...model.day.allDay, ...model.day.timed]
    .filter(item => item.fixed && item.kind !== "deadline" && !!item.taskId)
    .sort((left, right) => (left.start ?? -1) - (right.start ?? -1));
  const hourMarks = Array.from(
    { length: model.endHour - model.startHour + 1 },
    (_, index) => model.startHour + index
  );

  useEffect(() => {
    if (!compact) return;
    const element = scrollRef.current;
    if (!element) return;
    const updateWidth = () => setCompactWidth(element.clientWidth || 300);
    updateWidth();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateWidth);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [compact]);

  const compactStart = model.planningStart;
  const compactEnd = model.planningEnd;
  const compactRange = Math.max(60, compactEnd - compactStart);
  const compactPxPerMinute = (compactWidth || 300) / compactRange;
  const compactAnchors = model.day.timed
    .filter(
      item =>
        item.fixed &&
        item.kind !== "deadline" &&
        item.start !== undefined &&
        (item.start ?? 0) + (item.minutes ?? 0) > compactStart &&
        (item.start ?? 0) < compactEnd
    )
    .sort((left, right) => (left.start ?? 0) - (right.start ?? 0));
  const currentAnchor = compactAnchors.find(item => {
    const start = item.start ?? 0;
    const plannedFinish = start + (item.minutes ?? 0);
    const likelyFinish = model.anchorFinishes.find(finish => finish.itemId === item.id)?.likelyEnd;
    const finish = Math.max(plannedFinish, likelyFinish ?? plannedFinish);
    return clock.minutes >= start && clock.minutes < finish;
  });
  const upcomingAnchor = compactAnchors.find(item => (item.start ?? 0) > clock.minutes);
  const focusAnchor = currentAnchor ?? upcomingAnchor;
  const focusFinish = focusAnchor
    ? model.anchorFinishes.find(item => item.itemId === focusAnchor.id)
    : undefined;
  const focusPlannedEnd = focusAnchor
    ? (focusAnchor.start ?? 0) + (focusAnchor.minutes ?? 0)
    : 0;
  const focusLikelyEnd = focusFinish?.likelyEnd ?? focusPlannedEnd;
  const freeAfterLast = compactAnchors[compactAnchors.length - 1];
  const lastFinish = freeAfterLast
    ? model.anchorFinishes.find(item => item.itemId === freeAfterLast.id)?.likelyEnd ??
      (freeAfterLast.start ?? 0) + (freeAfterLast.minutes ?? 0)
    : Math.max(compactStart, clock.minutes);
  const hasAllDayAnchor = model.day.allDay.some(item => item.fixed);
  const freeAfterMinutes = hasAllDayAnchor
    ? 0
    : Math.max(0, compactEnd - lastFinish);
  const compactBookedCount = compactAnchors.length + model.day.allDay.filter(item => item.fixed).length;
  const compactNowLeft = Math.max(
    0,
    Math.min(compactWidth || 300, (clock.minutes - compactStart) * compactPxPerMinute)
  );

  useEffect(() => {
    if (compact) return;
    const element = scrollRef.current;
    if (!element) return;
    const left = Math.max(0, nowLeft - 120);
    element.scrollLeft = Math.min(left, element.scrollWidth - element.clientWidth);
  }, [compact, clock.date, model.startHour, model.endHour, nowLeft]);

  if (compact) {
    const focusRange = focusAnchor
      ? `${minutesToTime(focusAnchor.start ?? 0)}–${minutesToTime(focusPlannedEnd)}`
      : "";
    const remaining = currentAnchor
      ? `${formatCompactDuration(Math.max(0, focusLikelyEnd - clock.minutes))} left`
      : upcomingAnchor
        ? `starts in ${formatCompactDuration(Math.max(0, (upcomingAnchor.start ?? 0) - clock.minutes))}`
        : "";
    const focusText = focusAnchor
      ? `${focusRange}${remaining ? ` · ${remaining}` : ""}`
      : "";
    const freeLabel = hasAllDayAnchor
      ? "Free after all-day anchor"
      : freeAfterLast
        ? `Free after ${freeAfterLast.title}`
        : "Free today";

    return (
      <section className="today-visual today-visual-compact" aria-label="Booked anchors for today">
        <div className="v2-anchor-current">
          <h3>{focusAnchor?.title ?? (compactAnchors.length ? "No upcoming booked anchor" : "No booked anchors today")}</h3>
          {focusText && <p className="v2-anchor-current-time">{focusText}</p>}
        </div>
        <div
          ref={scrollRef}
          className="today-visual-scroll v2-anchor-scroll"
          role="group"
              aria-label={`Booked-anchor strip from ${minutesToTime(compactStart)} to ${minutesToTime(compactEnd)}`}
        >
          <div className="v2-anchor-strip" style={{ width: compactWidth || "100%" }}>
            <div className="v2-anchor-track" style={{ width: compactWidth || "100%" }}>
              {compactAnchors.map(item => {
                const start = item.start ?? 0;
                const finish = start + (item.minutes ?? 0);
                const left = Math.max(0, (start - compactStart) * compactPxPerMinute);
                const right = Math.min(compactWidth || 300, (finish - compactStart) * compactPxPerMinute);
                const label = `${item.title}, booked ${formatTime(minutesToTime(start))} to ${formatTime(minutesToTime(finish))}`;
                const style = { left, width: Math.max(2, right - left) };
                const task = item.taskId ? tasksById.get(item.taskId) : undefined;
                return task && onOpenTask ? (
                  <button
                    key={item.id}
                    type="button"
                    className="v2-anchor-bar"
                    style={style}
                    aria-label={`Open ${label}`}
                    title={`${item.title} · booked anchor · tap to view`}
                    onClick={() => onOpenTask(task)}
                  />
                ) : (
                  <span
                    key={item.id}
                    className="v2-anchor-bar"
                    style={style}
                    role="img"
                    aria-label={label}
                    title={`${item.title} · booked anchor`}
                  />
                );
              })}
              {clock.date === model.day.date && clock.minutes >= compactStart && clock.minutes <= compactEnd && (
                  <span className="v2-anchor-now" style={{ left: compactNowLeft }} aria-label={`Now · ${formatTime(minutesToTime(clock.minutes))}`} />
              )}
            </div>
            <div className="v2-anchor-time-labels">
              <span className="edge-start">{minutesToTime(compactStart).slice(0, 2)}</span>
              <span className="edge-end">{minutesToTime(compactEnd).slice(0, 2)}</span>
            </div>
          </div>
        </div>
        <p className="v2-anchor-free">
          <span>{freeLabel}:</span> <strong>{formatCompactDuration(freeAfterMinutes)}</strong>
        </p>
        <span className="sr-only">{compactBookedCount} booked anchor{compactBookedCount === 1 ? "" : "s"} today.</span>
      </section>
    );
  }

  return (
    <section className="today-visual" aria-labelledby="today-visual-title">
      <div className="today-visual-heading">
        <div>
          <div className="eyebrow">TODAY AT A GLANCE</div>
          <h2 id="today-visual-title">Today timeline</h2>
          <p className="small muted today-visual-summary">
            Now · {nowText} · {bookedCount} booked · {deadlinePointCount} deadline point{deadlinePointCount === 1 ? "" : "s"} · {model.freeAfterLabel}: {formatDuration(model.freeAfterMinutes)}
          </p>
          {model.overrunSamples < 3 && (
            <p className="small muted today-visual-estimate-note">
              Overrun learns from your history.
            </p>
          )}
        </div>
        <div className="today-visual-actions">
          {onRead && (
            <button
              type="button"
              className="text-button"
              onClick={() => onRead(spokenTimeline(model, clock.minutes))}
              aria-label="Read today's timeline aloud"
            >
              <Volume2 size={15} /> Read aloud
            </button>
          )}
          <button
            type="button"
            className="button secondary small-button"
            onClick={onCalendar}
            aria-label="Open Calendar"
          >
            <CalendarDays size={15} /> Calendar
          </button>
        </div>
      </div>

      <p className="small muted today-visual-readonly">
        Tap a task bar to view its details and subtasks. This timeline is read-only: edit timing in Calendar. Deadline points do not reserve time. Swipe sideways to inspect the day.
      </p>
      <p className="small today-sync-status" role="status" aria-live="polite">
        {syncDescription(syncStatus, lastSyncedAt, pendingSync, online)}
      </p>

      {model.day.allDay.length > 0 && (
        <div className="today-visual-allday" aria-label="All-day booked anchors" role="list">
          {model.day.allDay.map(item => {
            const task = item.taskId ? tasksById.get(item.taskId) : undefined;
            const content = (
              <>
                <span className="today-visual-chip-kind">All day</span>
                <span className="today-visual-chip-title">{item.title}</span>
                {item.repeating && <span className="today-visual-repeat">Repeats</span>}
              </>
            );
            const className = `today-visual-chip kind-${item.kind}${item.done ? " done" : ""}`;
            return task && onOpenTask ? (
              <button
                key={item.id}
                type="button"
                role="listitem"
                className={`${className} is-openable`}
                aria-label={`Open ${itemAriaLabel(item)}`}
                title={`${itemAriaLabel(item)} · tap to view`}
                onClick={() => onOpenTask(task)}
              >
                {content}
              </button>
            ) : (
              <article
                key={item.id}
                role="listitem"
                className={className}
                aria-label={itemAriaLabel(item)}
                title={itemAriaLabel(item)}
              >
                {content}
              </article>
            );
          })}
        </div>
      )}

      {agendaItems.length > 0 && (
        <section className="today-visual-agenda" aria-labelledby="today-visual-agenda-title">
          <h3 id="today-visual-agenda-title">Today's booked tasks</h3>
          <div className="today-visual-agenda-list" role="list">
            {agendaItems.map(item => {
              const task = item.taskId ? tasksById.get(item.taskId) : undefined;
              if (!task) return null;
              const when = item.start === undefined
                ? "All day"
                : `Start ${formatTime(minutesToTime(item.start))}`;
              const duration = item.minutes ? formatDuration(item.minutes) : null;
              const status = agendaStateLabel(task);
              const label = `Open ${item.title}, ${when}${duration ? `, ${duration}` : ""}, ${status}`;
              const content = (
                <>
                  <span className="today-visual-agenda-when">{when}</span>
                  <span className="today-visual-agenda-copy">
                    <strong>{item.title}</strong>
                    <span>{[duration, item.repeating ? "Repeats" : null].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className={`today-visual-agenda-state state-${task.state}`}>{status}</span>
                </>
              );
              return onOpenTask ? (
                <button
                  key={item.id}
                  type="button"
                  role="listitem"
                  className={`today-visual-agenda-item${task.state === "done" ? " is-done" : ""}`}
                  aria-label={label}
                  onClick={() => onOpenTask(task)}
                >
                  {content}
                </button>
              ) : (
                <div
                  key={item.id}
                  role="listitem"
                  className={`today-visual-agenda-item${task.state === "done" ? " is-done" : ""}`}
                >
                  {content}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {model.overlapCount > 0 && (
        <p className="today-visual-overlap" role="status">
          {model.overlapCount} overlapping booked-anchor pair{model.overlapCount === 1 ? "" : "s"}; review times in Calendar.
        </p>
      )}

      <div
        ref={scrollRef}
        className="today-visual-scroll"
        aria-label={`Read-only schedule of booked anchors and deadline points from ${atMinute(startMinute)} to ${atMinute(endMinute)}; task bars open a view`}
        role="group"
      >
        <div
          className="today-visual-strip"
          style={{ width: stripWidth, minHeight: trackHeight + 30 } as CSSProperties}
        >
          <div className="today-visual-hours" style={{ width: stripWidth }} aria-hidden="true">
            {hourMarks.map(hour => (
              <span
                key={hour}
                style={{ left: (hour * 60 - startMinute) * pxPerMinute }}
              >
                {atMinute(hour * 60)}
              </span>
            ))}
          </div>
          <div
            className="today-visual-track"
            style={{ width: stripWidth, height: trackHeight }}
            role="list"
            aria-label="Today's booked anchors and deadline points"
          >
            {hourMarks.map(hour => (
              <span
                key={`tick-${hour}`}
                className="today-visual-hour-tick"
                style={{ left: (hour * 60 - startMinute) * pxPerMinute }}
                aria-hidden="true"
              />
            ))}
            {model.day.timed.map(item => {
              const start = item.start ?? 0;
              const duration = item.minutes ?? 0;
              const task = item.taskId ? tasksById.get(item.taskId) : undefined;
              const lane = item.lane ?? 0;
              const finishStats = task ? estimateAnchorFinish(task, tasks) : null;
              const finishRecord = model.anchorFinishes.find(
                finish => finish.itemId === item.id
              );
              const plannedEnd = start + duration;
              const likelyEnd = finishRecord?.likelyEnd ?? plannedEnd;
              const overrunWidth = Math.max(0, likelyEnd - plannedEnd) * pxPerMinute;
              const marker = item.kind === "deadline";
              const left = (start - startMinute) * pxPerMinute;
              const width = marker
                ? 10
                : Math.max(34, duration * pxPerMinute - 3);
              const current =
                !item.done && !marker && clock.minutes >= start && clock.minutes < plannedEnd;
              const progress = item.done
                ? 100
                : current
                  ? Math.max(0, Math.min(100, ((clock.minutes - start) / Math.max(1, duration)) * 100))
                  : 0;
              const itemStyle = {
                left,
                top: 8 + lane * LANE_HEIGHT,
                width,
              } as CSSProperties;
              return (
                <React.Fragment key={item.id}>
                  {overrunWidth > 0 && (
                    <span
                      className="today-visual-overrun-estimate"
                      style={{
                        left: left + duration * pxPerMinute,
                        top: 8 + lane * LANE_HEIGHT,
                        width: overrunWidth,
                      }}
                      role="img"
                      aria-label={`Likely finish extension of ${formatDuration(likelyEnd - plannedEnd)} based on your completed booked-anchor history`}
                      title={`Likely finish: ${formatTime(minutesToTime(likelyEnd))}`}
                    />
                  )}
                  <article
                    role="listitem"
                    className={`today-visual-item kind-${item.kind}${item.done ? " done" : ""}${item.fixed ? " fixed" : ""}${(item.lanes ?? 1) > 1 ? " overlap" : ""}${current ? " current" : ""}`}
                    style={itemStyle}
                    aria-label={itemAriaLabel(item)}
                    title={itemAriaLabel(item)}
                  >
                    <span
                      className="today-visual-progress"
                      style={{ width: `${progress}%` }}
                      aria-hidden="true"
                    />
                    <span className="today-visual-item-content">
                      {task && <TimingShapeMark task={task} />}
                      <span className="today-visual-item-time">
                        {!marker && "Start "}{formatTime(minutesToTime(start))}
                        {!marker && ` · ${formatDuration(duration)}`}
                      </span>
                      <span className="today-visual-item-title">{item.title}</span>
                      {item.fixed && <CalendarDays className="today-visual-meta-icon" size={12} aria-hidden="true" />}
                      {item.repeating && <Repeat className="today-visual-meta-icon" size={11} aria-hidden="true" />}
                      {finishStats && finishStats.samples >= 3 && likelyEnd > plannedEnd && (
                        <span className="sr-only">
                          Likely finish {formatTime(minutesToTime(likelyEnd))}
                        </span>
                      )}
                    </span>
                    {task && onOpenTask && (
                      <button
                        type="button"
                        className="today-visual-item-open"
                        aria-label={`Open ${itemAriaLabel(item)}`}
                        title={`${itemAriaLabel(item)} · tap to view`}
                        onClick={() => onOpenTask(task)}
                      />
                    )}
                  </article>
                </React.Fragment>
              );
            })}
            {clock.minutes >= startMinute && clock.minutes <= endMinute && (
              <span
                className="today-visual-now"
                style={{ left: nowLeft, height: trackHeight }}
                aria-label={`Now, ${nowText}`}
              >
                <span>Now</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="today-visual-legend" aria-label="Timeline key">
        <span>Solid block: booked anchor</span>
        <span>Dashed extension: likely finish based on your history</span>
        <span>Red line: now</span>
      </div>
    </section>
  );
}
