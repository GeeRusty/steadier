import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Flag,
  GripHorizontal,
  Lock,
  Plus,
  Repeat,
  X,
} from "lucide-react";
import type { Project, Task, Workspace } from "../../domain/types";
import { updateTask } from "../../domain/engine";
import { estimateAnchorFinish } from "../../domain/anchorPlanning";
import {
  buildCalendar,
  countOverlappingTimedItems,
  dateRange,
  type CalendarItem,
} from "../../domain/calendarModel";
import {
  WEEKDAY_SHORT,
  adelaideClock,
  DEFAULT_PLANNING,
  formatCompactDuration,
  formatDuration,
  formatTime,
  minutesToTime,
  rescheduleOccurrenceSchedule,
  shiftDays,
  timeToMinutes,
  weekStart,
  weekdayOf,
} from "../../domain/time";
import {
  friendlyDate,
  parseQuickAdd,
} from "../../domain/quickParse";
import { timingShapeForTask } from "../../domain/timingShape";
import TimingShapeMark from "./TimingShapeMark";
import { CALENDAR_GUIDE } from "./TodayCalendarMenuSheet";
import { isNativeVoiceDraftEvent } from "../../domain/nativeVoice";
import {
  TASK_AUTOSAVE_IDLE_MS,
  autosaveSyncAdvanced,
  buildCalendarDraftTask,
  canAutosaveCalendarDraft,
  isServerConfirmedAutosave,
  taskDraftChanged,
  type PendingTaskAutosave,
  type TaskAutosaveCloudState,
  type TaskAutosaveSaveResult,
} from "../../domain/taskAutosave";

type Mode = "day" | "3day" | "week" | "month";
const PX_PER_MIN = 0.9;
const SNAP = 15;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface Props {
  workspace: Workspace;
  tasks: Task[];
  projects: Project[];
  onMutate: (fn: (w: Workspace) => Workspace) => boolean;
  onAutoSave: (
    task: Task,
    baseline: Task | null,
    triggerWash?: boolean
  ) => TaskAutosaveSaveResult;
  autosaveCloud: TaskAutosaveCloudState;
  onOpenTask: (task: Task) => void;
  onOpenProject?: (projectId: string) => void;
  /** Marks only the current occurrence done (existing completion rules). */
  readOnly: boolean;
  initialMode?: Mode;
  onReadText?: (text: string) => void;
  onRegisterRead?: (reader: () => void) => void;
}

type Drag = {
  taskId: string;
  mode: "move" | "resize";
  pointerId: number;
  x: number;
  y: number;
  start: number;
  minutes: number;
  dayIndex: number;
  dMin: number;
  dDays: number;
  moved: boolean;
};

function snap(minutes: number): number {
  return Math.round(minutes / SNAP) * SNAP;
}

function monthTitle(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export default function CalendarView({
  workspace,
  tasks,
  projects,
  onMutate,
  onAutoSave,
  autosaveCloud,
  onOpenTask,
  onOpenProject,
  readOnly,
  initialMode,
  onReadText,
  onRegisterRead,
}: Props) {
  const [clock, setClock] = useState(() => adelaideClock());
  useEffect(() => {
    const id = window.setInterval(() => setClock(adelaideClock()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const today = clock.date;
  const narrow = typeof window !== "undefined" && window.innerWidth < 760;
  const [mode, setMode] = useState<Mode>(initialMode ?? (narrow ? "day" : "week"));
  const [anchor, setAnchor] = useState(today);
  const [draft, setDraft] = useState<{
    date: string;
    start: number | null;
    parseDate: string;
    parseMinutes: number;
    task: Task | null;
  } | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftSaveState, setDraftSaveState] = useState<
    "idle" | "saving" | "saved" | "not-saved"
  >("idle");
  const [draftSaveDetail, setDraftSaveDetail] = useState("");
  const draftBaselineRef = useRef<Task | null>(null);
  const draftTicketRef = useRef<PendingTaskAutosave | null>(null);
  const draftVoicePendingRef = useRef(false);
  const onAutoSaveRef = useRef(onAutoSave);
  onAutoSaveRef.current = onAutoSave;
  const [note, setNote] = useState("");
  const [drag, setDrag] = useState<Drag | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);

  const dates = useMemo(() => {
    if (mode === "day") return [anchor];
    if (mode === "3day") return dateRange(anchor, 3);
    if (mode === "week") return dateRange(weekStart(anchor), 7);
    const [y, m] = anchor.split("-").map(Number);
    const first = `${y}-${String(m).padStart(2, "0")}-01`;
    return dateRange(weekStart(first), 42);
  }, [mode, anchor]);
  const days = useMemo(
    () =>
      buildCalendar(tasks, projects, dates, today, {
        obligations: workspace.obligations ?? [],
        credentialRenewals: workspace.credentialRenewals ?? [],
        people: workspace.people ?? [],
      }),
    [tasks, projects, dates, today, workspace.obligations, workspace.credentialRenewals, workspace.people]
  );
  const dueTasks = useMemo(() => {
    if (mode === "month") return [];
    const visibleDates = new Set(dates);
    return tasks
      .filter(task => task.state !== "done" && !!task.deadline && visibleDates.has(task.deadline))
      .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
  }, [tasks, dates, mode]);
  const overlapDays =
    mode === "month"
      ? days.filter(day => day.date.startsWith(anchor.slice(0, 7)))
      : days;
  const overlapCount = overlapDays.reduce(
    (count, day) => count + countOverlappingTimedItems(day.timed),
    0
  );
  const draftParsedForButton = draft
    ? parseQuickAdd(draftText, draft.parseDate, draft.parseMinutes)
    : null;
  const draftCandidateForButton =
    draft && draftBaselineRef.current && draftParsedForButton
      ? buildCalendarDraftTask(draftBaselineRef.current, draftParsedForButton, {
          date: draft.date,
          start: draft.start,
        })
      : null;
  const draftMatchesSavedTask = Boolean(
    draftBaselineRef.current &&
      draftCandidateForButton &&
      !taskDraftChanged(draftCandidateForButton, draftBaselineRef.current)
  );
  const taskById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const planning = workspace.planning ?? DEFAULT_PLANNING;
  const activeImperatives = (workspace.imperatives ?? []).filter(
    imperative => imperative.status === "active"
  );
  function freeCapacityForDay(day: (typeof days)[number]): number {
    const dayStart = timeToMinutes(planning.dayStart);
    const dayEnd = timeToMinutes(planning.dayEnd);
    if (day.allDay.some(item => item.fixed)) return 0;
    let occupiedUntil =
      day.date === today ? Math.max(dayStart, clock.minutes) : dayStart;
    for (const item of day.timed) {
      if (!item.fixed || item.kind === "deadline") continue;
      const task = item.taskId ? taskById.get(item.taskId) : undefined;
      const estimate = task ? estimateAnchorFinish(task, tasks) : null;
      const plannedEnd = (item.start ?? 0) + (item.minutes ?? 0);
      const likelyEnd =
        estimate?.overrunRatio !== null && estimate?.overrunRatio !== undefined
          ? Math.max(
              plannedEnd,
              Math.ceil((item.start ?? 0) + (item.minutes ?? 0) * estimate.overrunRatio)
            )
          : plannedEnd;
      occupiedUntil = Math.max(
        occupiedUntil,
        likelyEnd
      );
    }
    return Math.max(0, dayEnd - occupiedUntil);
  }

  function dayFreeBlock(day: (typeof days)[number]) {
    const dayStart = timeToMinutes(planning.dayStart);
    const dayEnd = timeToMinutes(planning.dayEnd);
    if (day.allDay.some(item => item.fixed)) return null;
    const anchors = day.timed
      .filter(item => item.fixed && item.kind !== "deadline")
      .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    const last = anchors[anchors.length - 1];
    if (!last) {
      return {
        start: dayStart,
        minutes: Math.max(0, dayEnd - dayStart),
        label: `Free · ${formatCompactDuration(Math.max(0, dayEnd - dayStart))}`,
        detail: "No booked anchors are on the clock today.",
      };
    }
    const task = last.taskId ? taskById.get(last.taskId) : undefined;
    const estimate = task ? estimateAnchorFinish(task, tasks) : null;
    const plannedEnd = (last.start ?? 0) + (last.minutes ?? 0);
    const likelyEnd = Math.max(dayStart, estimate?.likelyEnd ?? plannedEnd);
    const minutes = Math.max(0, dayEnd - likelyEnd);
    const history = estimate
      ? estimate.samples >= 3
        ? `using ${estimate.samples} of your completed anchor samples`
        : `${estimate.samples}/3 owner-history samples so far`
      : "using its scheduled end";
    return {
      start: likelyEnd,
      minutes,
      label: `Free · ${formatCompactDuration(minutes)}`,
      detail: `Free after ${last.title}'s ${estimate?.samples && estimate.samples >= 3 ? "likely" : "scheduled"} finish, ${history}.`,
    };
  }

  const allTimed = days.flatMap(d => d.timed);
  const dayStartHour = Math.floor(timeToMinutes(planning.dayStart) / 60);
  const dayEndHour = Math.ceil(timeToMinutes(planning.dayEnd) / 60);
  const startHour = mode === "day"
    ? dayStartHour
    : Math.min(6, ...allTimed.map(i => Math.floor(i.start! / 60)));
  const endHour = mode === "day"
    ? dayEndHour
    : Math.max(23, ...allTimed.map(i => Math.ceil((i.start! + i.minutes!) / 60)));
  const pxPerMinute = mode === "day" ? 50 / 60 : PX_PER_MIN;
  const hours = Array.from(
    { length: endHour - startHour + 1 },
    (_, i) => startHour + i
  );
  const height = (endHour - startHour + (mode === "day" ? 0 : 1)) * 60 * pxPerMinute;

  useEffect(() => {
    if (mode === "month" || !scrollRef.current) return;
    if (mode === "day") {
      scrollRef.current.scrollTop = 0;
      return;
    }
    const target = dates.includes(today)
      ? Math.max(startHour * 60, clock.minutes - 90)
      : 7 * 60;
    scrollRef.current.scrollTop = (target - startHour * 60) * pxPerMinute;
    // Only when the visible range changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, dates[0]]);

  function step(direction: -1 | 1) {
    if (mode === "day") setAnchor(shiftDays(anchor, direction));
    else if (mode === "3day") setAnchor(shiftDays(anchor, 3 * direction));
    else if (mode === "week") setAnchor(shiftDays(anchor, 7 * direction));
    else {
      const [y, m] = anchor.split("-").map(Number);
      const next = new Date(Date.UTC(y, m - 1 + direction, 1, 12));
      setAnchor(next.toISOString().slice(0, 10));
    }
  }

  function schedule(
    task: Task,
    date: string,
    start: number | null,
    minutes?: number,
    verb = "Planned"
  ) {
    if (readOnly || task.schedule.fixed !== true) return;
    const time =
      start === null
        ? null
        : minutesToTime(Math.max(0, Math.min(24 * 60 - SNAP, start)));
    const label = `${friendlyDate(date, today)}${time ? ` ${formatTime(time)}` : ""}`;
    const movedExistingSlot =
      Boolean(
        task.schedule.date || task.schedule.time || task.schedule.flexibleWindow
      ) &&
      (task.schedule.date !== date ||
        task.schedule.time !== time ||
        Boolean(task.schedule.flexibleWindow));
    const auditVerb = movedExistingSlot ? "Rescheduled" : verb;
    const ok = onMutate(w => ({
      ...w,
      tasks: w.tasks.map(t =>
        t.id === task.id
          ? updateTask(
              t,
              {
                schedule: {
                  ...rescheduleOccurrenceSchedule(
                    t.schedule,
                    { date, time },
                    t.deadline ?? t.startDate
                  ),
                  minutes: minutes ?? t.schedule.minutes,
                  missedHandled: null,
                },
              },
              `${auditVerb} for ${label}.`
            )
          : t
      ),
    }));
    setNote(
      ok
        ? `${task.title}: ${label}`
        : "That change was not saved. Check sync and try again."
    );
  }

  function minuteFromEvent(clientY: number, column: HTMLElement): number {
    const rect = column.getBoundingClientRect();
    return (
      Math.floor(((clientY - rect.top) / pxPerMinute + startHour * 60) / SNAP) *
      SNAP
    );
  }

  function onColumnClick(
    date: string,
    event: React.MouseEvent<HTMLDivElement>
  ) {
    if (readOnly || event.target !== event.currentTarget) return;
    if (
      draft &&
      draftText.trim() &&
      draftSaveState !== "saved" &&
      !window.confirm(
        "Replace this Calendar draft? Any text not marked Saved will remain unsaved."
      )
    )
      return;
    const start = minuteFromEvent(event.clientY, event.currentTarget);
    draftBaselineRef.current = null;
    draftTicketRef.current = null;
    draftVoicePendingRef.current = false;
    setDraft({
      date,
      start,
      parseDate: today,
      parseMinutes: clock.minutes,
      task: null,
    });
    setDraftText("");
    setDraftSaveState("idle");
    setDraftSaveDetail("");
    setNote("");
  }

  function onDrop(
    date: string,
    event: DragEvent<HTMLDivElement>,
    timed: boolean
  ) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/steadier-task");
    const task = taskById.get(id);
    if (!task) return;
    schedule(
      task,
      date,
      timed ? minuteFromEvent(event.clientY, event.currentTarget) : null
    );
  }

  function commitCalendarDraft(
    task: Task,
    baseline: Task | null,
    triggerWash = true
  ): boolean {
    const result = onAutoSaveRef.current(task, baseline, triggerWash);
    if (!result.accepted) {
      setDraftSaveState("not-saved");
      setDraftSaveDetail(result.message);
      setNote(result.message);
      return false;
    }
    draftBaselineRef.current = result.task;
    draftTicketRef.current = result.ticket;
    draftVoicePendingRef.current = false;
    setDraft(current => (current ? { ...current, task: result.task } : current));
    setDraftSaveState(result.serverPending ? "saving" : "saved");
    setDraftSaveDetail(
      result.serverPending
        ? "Waiting for Steadier to confirm this save."
        : autosaveCloud.active &&
            autosaveCloud.status === "synced" &&
            !autosaveCloud.pending
          ? "Saved to Steadier."
          : "Saved on this device; no shared server is connected."
    );
    setNote("");
    return true;
  }

  function addDraft() {
    if (!draft || !draftText.trim()) return;
    const parsed = parseQuickAdd(
      draftText,
      draft.parseDate,
      draft.parseMinutes
    );
    if (!canAutosaveCalendarDraft(parsed.title, Boolean(parsed.flexibleWindow))) {
      if (parsed.flexibleWindow) {
        const message =
          "Flexible work stays untimed. Add it from Capture, not the Calendar time grid.";
        setNote(message);
        setDraftSaveState("not-saved");
        setDraftSaveDetail(message);
      } else {
        setNote("Enter a meaningful task title before saving this Calendar draft.");
      }
      return;
    }
    const baseline = draftBaselineRef.current;
    const candidate = buildCalendarDraftTask(baseline, parsed, {
      date: draft.date,
      start: draft.start,
    });
    if (!candidate) return;
    if (baseline && !taskDraftChanged(candidate, baseline)) {
      onOpenTask(baseline);
      return;
    }
    commitCalendarDraft(candidate, baseline, !draftVoicePendingRef.current);
  }

  function flushCalendarDraft() {
    if (!draft || !draftText.trim() || draftVoicePendingRef.current || readOnly)
      return;
    const parsed = parseQuickAdd(
      draftText,
      draft.parseDate,
      draft.parseMinutes
    );
    if (!canAutosaveCalendarDraft(parsed.title, Boolean(parsed.flexibleWindow)))
      return;
    const baseline = draftBaselineRef.current;
    const candidate = buildCalendarDraftTask(baseline, parsed, {
      date: draft.date,
      start: draft.start,
    });
    if (!candidate || (baseline && !taskDraftChanged(candidate, baseline)))
      return;
    commitCalendarDraft(candidate, baseline, true);
  }

  useEffect(() => {
    if (!draft) return;
    if (readOnly) {
      setDraftSaveState("not-saved");
      setDraftSaveDetail(
        "This workspace is read-only or still recovering. The Calendar draft has not been saved."
      );
      return;
    }
    if (draftVoicePendingRef.current) {
      setDraftSaveState("not-saved");
      setDraftSaveDetail(
        "Voice text is an editable draft. Review it, then tap Add anchor; it will not autosave."
      );
      return;
    }
    const parsed = parseQuickAdd(
      draftText,
      draft.parseDate,
      draft.parseMinutes
    );
    if (!canAutosaveCalendarDraft(parsed.title, Boolean(parsed.flexibleWindow))) {
      if (parsed.flexibleWindow) {
        const message =
          "Flexible work stays untimed. Add it from Capture, not the Calendar time grid.";
        setNote(message);
        setDraftSaveState("not-saved");
        setDraftSaveDetail(message);
      } else if (draftBaselineRef.current) {
        setDraftSaveState("not-saved");
        setDraftSaveDetail(
          "A meaningful non-empty title is required. The previous saved task is unchanged."
        );
      } else {
        setDraftSaveState("idle");
        setDraftSaveDetail("");
      }
      return;
    }
    const baseline = draftBaselineRef.current;
    const candidate = buildCalendarDraftTask(baseline, parsed, {
      date: draft.date,
      start: draft.start,
    });
    if (!candidate || (baseline && !taskDraftChanged(candidate, baseline)))
      return;
    setDraftSaveState("saving");
    setDraftSaveDetail("Waiting for the 800 ms pause before saving.");
    const timeout = window.setTimeout(() => {
      commitCalendarDraft(candidate, baseline, true);
    }, TASK_AUTOSAVE_IDLE_MS);
    return () => window.clearTimeout(timeout);
  }, [draft, draftText, readOnly]);

  useEffect(() => {
    const ticket = draftTicketRef.current;
    if (!ticket) return;
    if (autosaveCloud.status === "conflict") {
      setDraftSaveState("not-saved");
      setDraftSaveDetail(
        "Sync conflict. This Calendar draft is preserved; resolve the conflict before retrying."
      );
      return;
    }
    if (autosaveCloud.status === "offline" || autosaveCloud.status === "error") {
      setDraftSaveState("not-saved");
      setDraftSaveDetail(
        "Not saved to the server yet. Your Calendar draft is preserved; check sync and retry."
      );
      return;
    }
    const currentTask = tasks.find(item => item.id === ticket.task.id);
    if (isServerConfirmedAutosave(ticket, autosaveCloud, currentTask)) {
      draftTicketRef.current = null;
      setDraftSaveState("saved");
      setDraftSaveDetail("Saved to Steadier.");
      return;
    }
    if (autosaveSyncAdvanced(ticket, autosaveCloud)) {
      draftTicketRef.current = null;
      setDraftSaveState("not-saved");
      setDraftSaveDetail(
        "The server has a different task version. Your Calendar draft is preserved and was not overwritten."
      );
    }
  }, [
    autosaveCloud.lastSyncedAt,
    autosaveCloud.pending,
    autosaveCloud.revision,
    autosaveCloud.status,
    tasks,
  ]);

  // ---- Pointer drag (move / resize) ---------------------------------------
  function beginDrag(
    event: ReactPointerEvent,
    item: CalendarItem,
    dayIndex: number,
    mode: Drag["mode"]
  ) {
    if (readOnly || item.kind !== "slot" || item.done) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDrag({
      taskId: item.taskId!,
      mode,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: item.start!,
      minutes: item.minutes!,
      dayIndex,
      dMin: 0,
      dDays: 0,
      moved: false,
    });
  }
  function moveDrag(event: ReactPointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dy = event.clientY - drag.y;
    const dx = event.clientX - drag.x;
    const grid = gridRef.current;
    const colWidth = grid
      ? grid.getBoundingClientRect().width / dates.length
      : 1;
    const moved = drag.moved || Math.abs(dy) > 6 || Math.abs(dx) > 6;
    setDrag({
      ...drag,
      moved,
      dMin: snap(dy / pxPerMinute),
      dDays:
        drag.mode === "move"
          ? Math.max(
              -drag.dayIndex,
              Math.min(
                dates.length - 1 - drag.dayIndex,
                Math.round(dx / colWidth)
              )
            )
          : 0,
    });
  }
  function endDrag(event: ReactPointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const task = taskById.get(drag.taskId);
    const current = drag;
    setDrag(null);
    if (!task) return;
    if (!current.moved) {
      onOpenTask(task);
      return;
    }
    if (current.mode === "move") {
      schedule(
        task,
        dates[current.dayIndex + current.dDays],
        current.start + current.dMin,
        undefined,
        "Moved"
      );
    } else {
      const minutes = Math.max(SNAP, current.minutes + current.dMin);
      schedule(
        task,
        dates[current.dayIndex],
        current.start,
        minutes,
        "Resized"
      );
    }
  }

  const title =
    mode === "month"
      ? monthTitle(anchor)
      : dates.length === 1
        ? `${friendlyDate(dates[0], today)} · ${dates[0].split("-").reverse().join("/")}`
        : `${friendlyDate(dates[0], today)} – ${friendlyDate(dates[dates.length - 1], today)}`;
  const toolbarDate = mode === "day"
    ? new Intl.DateTimeFormat("en-AU", {
        timeZone: "Australia/Adelaide",
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(new Date(`${anchor}T12:00:00Z`)).replace(",", "")
    : title;

  function calendarReadText(): string {
    const visible = days.map(day => {
      const anchors = day.timed.filter(item => item.fixed && item.kind !== "deadline");
      const free = mode === "day" ? dayFreeBlock(day) : null;
      const points = day.dateMarkers
        .filter(
          item =>
            item.kind === "deadline" ||
            item.kind === "planned-date" ||
            item.kind === "window"
        )
        .map(item => `${item.label}: ${item.title}`);
      return `${friendlyDate(day.date, today)}: ${anchors.length
        ? anchors.map(item => `${item.title} at ${formatTime(minutesToTime(item.start ?? 0))}`).join(", ")
        : "no booked anchors"}${free ? `. ${free.label}. ${free.detail}` : ""}${points.length ? `. Date markers, not booked: ${points.join(", ")}` : ""}.`;
    });
    return `${CALENDAR_GUIDE} ${title}. ${visible.join(" ")}`;
  }

  useEffect(() => {
    onRegisterRead?.(() => onReadText?.(calendarReadText()));
  }, [onRegisterRead, onReadText, mode, title, days, tasks, planning, taskById]);

  function timeRangeLabel(item: CalendarItem): string {
    const start = item.start ?? 0;
    if (item.kind === "deadline")
      return `Hard deadline at ${mode === "day" ? minutesToTime(start) : formatTime(minutesToTime(start))}`;
    const minutes = item.minutes ?? 0;
    const end = start + minutes;
    if (mode === "day")
      return `${minutesToTime(start)}–${minutesToTime(end % (24 * 60))} · booked`;
    const endTime = formatTime(minutesToTime(end % (24 * 60)));
    return `${formatTime(minutesToTime(start))}–${endTime}${end >= 24 * 60 ? " +1 day" : ""} · ${formatDuration(minutes)}`;
  }

  function blockStyle(item: CalendarItem) {
    let start = item.start!;
    let minutes = item.minutes!;
    let shiftCols = 0;
    if (
      drag &&
      drag.taskId === item.taskId &&
      item.kind === "slot" &&
      drag.moved
    ) {
      if (drag.mode === "move") {
        start = Math.max(0, start + drag.dMin);
        shiftCols = drag.dDays;
      } else minutes = Math.max(SNAP, minutes + drag.dMin);
    }
    const lanes = item.lanes ?? 1;
    const lane = item.lane ?? 0;
    return {
      top: (start - startHour * 60) * pxPerMinute,
      height: Math.max(18, minutes * pxPerMinute - 2),
      left: `calc(${(lane / lanes) * 100}% + ${mode === "day" ? 8 : 2}px + ${shiftCols * 100}%)`,
      width: `calc(${100 / lanes}% - ${mode === "day" ? 8 : 4}px)`,
      zIndex: drag?.taskId === item.taskId ? 5 : 2,
    } as const;
  }

  function openItem(item: CalendarItem) {
    const task = item.taskId ? taskById.get(item.taskId) : undefined;
    if (task) onOpenTask(task);
    else if (item.projectId) onOpenProject?.(item.projectId);
  }

  return (
    <section className={`calendar-view${mode === "day" ? " v2-calendar-day" : ""}`} aria-label="Calendar">
      <div className="calendar-toolbar v2-calendar-toolbar" aria-label={`Calendar controls for ${title}`}>
        <div className="calendar-controls v2-calendar-controls">
          <button
            className="icon-button"
            onClick={() => step(-1)}
            aria-label="Previous date range"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="button secondary small-button v2-calendar-today"
            onClick={() => setAnchor(today)}
          >
            Today
          </button>
          <button
            className="icon-button"
            onClick={() => step(1)}
            aria-label="Next date range"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <span className="v2-calendar-current-date" aria-live="polite">{toolbarDate}</span>
        <div className="segmented v2-calendar-segmented" role="group" aria-label="Calendar range">
            {(["day", "3day", "week", "month"] as Mode[]).map(m => (
              <button
                key={m}
                className={mode === m ? "on" : ""}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {m === "day"
                  ? "Day"
                  : m === "3day"
                    ? "3d"
                    : m === "week"
                      ? "Week"
                      : "Month"}
              </button>
            ))}
        </div>
      </div>
      <p className="calendar-anchor-cue" role="note">
        {mode === "month"
          ? "This month view previews up to three items per day. Tap a date or +N more for its full day; to add a booked anchor, open Day and tap an empty time."
          : "To add a booked anchor, tap an empty time. Flexible windows and date-only deadlines stay untimed."}
      </p>
      {mode !== "month" && dueTasks.length > 0 && (
        <div className="v2-calendar-due-row" aria-label="Hard deadlines">
          <span className="v2-calendar-due-label">DUE</span>
          <div className="v2-calendar-due-chips">
            {dueTasks.map(task => (
              <button
                key={task.id}
                type="button"
                className="v2-calendar-due-chip"
                onClick={() => onOpenTask(task)}
                aria-label={`Hard deadline: ${task.title}, ${friendlyDate(task.deadline!, today)}`}
              >
                {mode === "day" ? `( ${task.title} )` : `( ${WEEKDAY_SHORT[weekdayOf(task.deadline!)]} · ${task.title} )`}
              </button>
            ))}
          </div>
        </div>
      )}
      {mode === "week" && (
        <section className="calendar-week-summary" aria-label="Week overview">
          <div>
            <h2>What matters this week</h2>
            {activeImperatives.length ? (
              <ul className="week-imperatives">
                {activeImperatives.map(imperative => (
                  <li key={imperative.id}>{imperative.title}</li>
                ))}
              </ul>
            ) : (
              <p className="small muted">No active Imperatives yet.</p>
            )}
          </div>
          <p className="small muted">Free capacity is shown under each day.</p>
        </section>
      )}
      {(note || overlapCount > 0) && (
        <p className="small muted calendar-note" role="status">
          {note && <span>{note}</span>}
          {overlapCount > 0 && (
            <span className="calendar-overlap-summary">
              {overlapCount} overlapping time-block pair
              {overlapCount === 1 ? "" : "s"} in this view. Review the times below;
              no schedule change was made.
            </span>
          )}
        </p>
      )}
      {draft && (
        <form
          className="calendar-draft"
          onSubmit={e => {
            e.preventDefault();
            addDraft();
          }}
        >
          <span className="small">
            New booked anchor on {friendlyDate(draft.date, today)}
            {draft.start !== null
              ? ` at ${formatTime(minutesToTime(draft.start))}`
              : ""}
          </span>
          <input
            autoFocus
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            onBlur={flushCalendarDraft}
            onInputCapture={event => {
              if (!isNativeVoiceDraftEvent(event.nativeEvent)) return;
              draftVoicePendingRef.current = true;
              setDraftSaveState("not-saved");
              setDraftSaveDetail(
                "Native voice text is an editable draft. Review it, then tap Add anchor to save; it will not autosave."
              );
            }}
            placeholder="What? (you can add “for 45 min”, “every Tue”, “remind me 10 min before”)"
            aria-label="New task title"
            maxLength={300}
          />
          <button
            className="button primary"
            onMouseDown={event => event.preventDefault()}
            disabled={
              readOnly ||
              !draftText.trim() ||
              !canAutosaveCalendarDraft(
                draftParsedForButton?.title ?? "",
                Boolean(draftParsedForButton?.flexibleWindow)
              )
            }
          >
            {draftMatchesSavedTask ? (
              <>
                <Check size={15} /> Open task
              </>
            ) : draftBaselineRef.current ? (
              <>
                <Check size={15} /> Save changes
              </>
            ) : (
              <>
                <Plus size={15} /> Add anchor
              </>
            )}
          </button>
          {draftSaveState !== "idle" && (
            <div
              className={`task-autosave-status calendar-autosave-status is-${draftSaveState}`}
              role="status"
              aria-live="polite"
            >
              <strong>
                {draftSaveState === "saving"
                  ? "Saving…"
                  : draftSaveState === "saved"
                    ? "Saved"
                    : "Not saved"}
              </strong>
              {draftSaveDetail && <span>{draftSaveDetail}</span>}
            </div>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="Cancel"
            onMouseDown={event => event.preventDefault()}
            onClick={() => {
              if (
                draftText.trim() &&
                draftSaveState !== "saved" &&
                !window.confirm(
                  "Close this Calendar draft? Anything not confirmed by Steadier will remain unsaved."
                )
              )
                return;
              draftBaselineRef.current = null;
              draftTicketRef.current = null;
              draftVoicePendingRef.current = false;
              setDraft(null);
              setDraftText("");
              setDraftSaveState("idle");
              setDraftSaveDetail("");
            }}
          >
            <X size={16} />
          </button>
        </form>
      )}

      {mode === "month" ? (
        <div className="month-grid" role="grid" aria-label={monthTitle(anchor)}>
          {WEEKDAY_SHORT.slice(1)
            .concat(WEEKDAY_SHORT[0])
            .map(d => (
              <div key={d} className="month-head" role="columnheader">
                {d}
              </div>
            ))}
          {days.map(day => {
            const inMonth = day.date.slice(0, 7) === anchor.slice(0, 7);
            const items = [
              ...day.falldue,
              ...day.allDay.filter(item => item.majorAnchor === true),
              ...day.timed
                .filter(item => item.fixed === true && item.majorAnchor === true)
                .sort((a, b) => a.start! - b.start!),
            ];
            return (
              <div
                key={day.date}
                role="gridcell"
                className={`month-cell${inMonth ? "" : " outside"}${day.date === today ? " today" : ""}`}
                onClick={() => {
                  setAnchor(day.date);
                  setMode("day");
                }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => onDrop(day.date, e, false)}
              >
                <button
                  type="button"
                  className="month-day-open"
                  aria-label={`Open ${friendlyDate(day.date, today)} in Day view`}
                  onClick={event => {
                    event.stopPropagation();
                    setAnchor(day.date);
                    setMode("day");
                  }}
                >
                  {Number(day.date.slice(8))}
                </button>
                {items.slice(0, 3).map(item => {
                  return (
                    <span
                      key={item.id}
                      className={`month-item kind-${item.kind}${item.done ? " done" : ""}${item.overdue && item.kind !== "deadline" && item.kind !== "project-deadline" ? " overdue" : ""}${item.majorAnchor ? " major-anchor" : ""}`}
                      title={item.label}
                    >
                      {item.start !== undefined
                        ? `${formatTime(minutesToTime(item.start))} `
                        : item.label
                          ? `${item.label}: `
                          : ""}
                      {item.taskId ? (
                        <button
                          type="button"
                          className="month-anchor-open"
                          onClick={event => {
                            event.stopPropagation();
                            openItem(item);
                          }}
                        >
                          {item.title}
                        </button>
                      ) : (
                        item.title
                      )}
                    </span>
                  );
                })}
                {items.length > 3 && (
                  <button
                    type="button"
                    className="month-more"
                    aria-label={`Show ${items.length - 3} more item${items.length - 3 === 1 ? "" : "s"} for ${friendlyDate(day.date, today)} in Day view`}
                    onClick={event => {
                      event.stopPropagation();
                      setAnchor(day.date);
                      setMode("day");
                    }}
                  >
                    +{items.length - 3} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={`timeline-wrap${mode === "day" ? " v2-day-grid-wrap" : ""}`}>
          <div
            className={`timeline-head${mode === "day" ? " v2-day-grid-head" : ""}`}
            style={{
              gridTemplateColumns: `${mode === "day" ? 36 : 52}px repeat(${dates.length}, minmax(0, 1fr))`,
            }}
          >
            <span />
            {days.map(day => (
              <div
                key={day.date}
                className={`timeline-day-head${day.date === today ? " today" : ""}`}
                onDragOver={e => e.preventDefault()}
                onDrop={e => onDrop(day.date, e, false)}
              >
                <button
                  className="text-button day-head-button"
                  onClick={e => {
                    e.stopPropagation();
                    setAnchor(day.date);
                    setMode("day");
                  }}
                >
                  {WEEKDAY_SHORT[weekdayOf(day.date)]}{" "}
                  {Number(day.date.slice(8))}
                </button>
                {mode === "week" && (
                  <span className="week-capacity">
                    Free {formatDuration(freeCapacityForDay(day))}
                  </span>
                )}
                <div className="allday-list">
                  {day.dateMarkers
                    .filter(item => mode !== "day" || item.kind !== "deadline")
                    .map(item => (
                    <button
                      type="button"
                      className={`allday-item calendar-date-marker kind-${item.kind}${
                        item.kind === "window"
                          ? ` window-chip${item.date === item.windowStart || item.windowCarried ? " window-first" : ""}${item.date === item.windowEnd || item.windowCarried ? " window-last" : ""}${item.windowProjected ? " window-projected" : ""}${item.overdue ? " window-closed" : ""}`
                          : ""
                      }`}
                      onClick={event => {
                        event.stopPropagation();
                        openItem(item);
                      }}
                      title={`${item.label}: ${item.title}`}
                      aria-label={
                        item.kind === "window"
                          ? `${item.label}: ${item.title}; flexible window from ${item.windowStart} to ${item.windowEnd}, no set time${item.overdue ? ", window has closed" : ", still open"}`
                          : `${item.label}: ${item.title}; date marker, not booked time`
                      }
                    >
                      <span className="calendar-date-marker-label">{item.label}</span>
                      <span>{item.title}</span>
                    </button>
                  ))}
                  {day.allDay.map(item => {
                    const sourceTask = item.taskId
                      ? taskById.get(item.taskId)
                      : undefined;
                    return (
                      <button
                        key={item.id}
                        className={`allday-item kind-${item.kind}${item.done ? " done" : ""}${item.overdue && item.kind !== "deadline" && item.kind !== "project-deadline" ? " overdue" : ""}`}
                        onClick={e => {
                          e.stopPropagation();
                          openItem(item);
                        }}
                        title={item.label}
                        aria-label={
                          sourceTask
                            ? `${item.title}, timing shape ${timingShapeForTask(sourceTask, clock).label}. ${timingShapeForTask(sourceTask, clock).reason}`
                            : undefined
                        }
                      >
                        {item.kind === "deadline" ? (
                          <Flag size={11} />
                        ) : null}
                        {item.kind === "projected" ? (
                          <Repeat size={11} />
                        ) : null}
                        {item.kind === "deadline" && item.label
                          ? `${item.label}: `
                          : ""}
                        {sourceTask && (
                          <TimingShapeMark task={sourceTask} />
                        )}{" "}
                        {item.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className={`timeline-scroll${mode === "day" ? " v2-day-scroll" : ""}`} ref={scrollRef}>
            <div
              className={`timeline-body${mode === "day" ? " v2-day-grid-body" : ""}`}
              style={{
                gridTemplateColumns: `${mode === "day" ? 36 : 52}px repeat(${dates.length}, minmax(0, 1fr))`,
                height,
              }}
            >
              <div className="hour-labels">
                {hours.map(h => (
                  <span
                    key={h}
                    style={{
                      top: mode === "day" && h === endHour
                        ? Math.max(0, height - 16)
                        : (h - startHour) * 60 * pxPerMinute,
                    }}
                  >
                    {mode === "day" ? minutesToTime(h * 60) : formatTime(minutesToTime(h * 60))}
                  </span>
                ))}
              </div>
              <div
                className="timeline-columns"
                ref={gridRef}
                style={{
                  gridColumn: `2 / span ${dates.length}`,
                  gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))`,
                }}
              >
                {days.map((day, dayIndex) => (
                  <div
                    key={day.date}
                    className={`timeline-column${day.date === today ? " today" : ""}${mode === "day" ? " v2-day-column" : ""}`}
                    style={{ height }}
                    onClick={e => onColumnClick(day.date, e)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => onDrop(day.date, e, true)}
                    aria-label={`${friendlyDate(day.date, today)} timeline`}
                  >
                    {hours.map(h => (
                      <span
                        key={h}
                        className="hour-line"
                        style={{
                          top: mode === "day" && h === endHour
                            ? Math.max(0, height - 1)
                            : (h - startHour) * 60 * pxPerMinute,
                        }}
                        aria-hidden
                      />
                    ))}
                    {mode === "day" && day.date === anchor && (() => {
                      const free = dayFreeBlock(day);
                      if (!free || free.minutes * pxPerMinute <= 12) return null;
                      return (
                        <div
                          className="v2-free-block"
                          style={{
                            top: (free.start - startHour * 60) * pxPerMinute + 6,
                            height: free.minutes * pxPerMinute - 12,
                          }}
                          title={free.detail}
                          aria-label={`${free.label}. ${free.detail}`}
                          role="note"
                        >
                          <span>{free.label}</span>
                        </div>
                      );
                    })()}
                    {day.date === today && (mode !== "day" || (clock.minutes >= startHour * 60 && clock.minutes <= endHour * 60)) && (
                      <span
                        className={`now-line${mode === "day" ? " v2-now-line" : ""}`}
                        style={{
                          top: (clock.minutes - startHour * 60) * pxPerMinute,
                        }}
                        aria-label="Now"
                      >{mode === "day" && <i aria-hidden="true" />}</span>
                    )}
                    {day.timed.map(item => {
                      const sourceTask = item.taskId
                        ? tasks.find(task => task.id === item.taskId)
                        : undefined;
                      if (item.kind === "deadline") {
                        const deadlineTime = mode === "day"
                          ? minutesToTime(item.start ?? 0)
                          : formatTime(minutesToTime(item.start ?? 0));
                        return (
                          <div
                            key={item.id}
                            className="calendar-deadline-point"
                            style={blockStyle(item)}
                            role="button"
                            tabIndex={0}
                            aria-label={`${item.title}, hard deadline point at ${deadlineTime}`}
                            title={`${item.title}, hard deadline at ${deadlineTime}`}
                            onClick={event => {
                              event.stopPropagation();
                              openItem(item);
                            }}
                            onKeyDown={event => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openItem(item);
                              }
                            }}
                          >
                            <span className="calendar-deadline-pin" aria-hidden="true" />
                            <span className="calendar-deadline-text">
                              {deadlineTime} · Hard deadline · {item.title}
                            </span>
                          </div>
                        );
                      }
                      const shapeLabel = sourceTask
                        ? `, timing ${timingShapeForTask(sourceTask, clock).label.toLowerCase()}`
                        : "";
                      return (
                        <div
                          key={item.id}
                          className={`time-block kind-${item.kind}${item.done ? " done" : ""}${item.fixed ? " fixed" : ""}${item.overdue ? " overdue" : ""}${(item.lanes ?? 1) > 1 ? " overlap" : ""}`}
                          style={blockStyle(item)}
                          role="button"
                          tabIndex={0}
                          aria-label={`${item.title}, ${timeRangeLabel(item)}${(item.lanes ?? 1) > 1 ? ", overlaps another timed block" : ""}${shapeLabel}${item.kind === "projected" ? ", upcoming repeat" : ""}`}
                          title={`${item.title}, ${timeRangeLabel(item)}`}
                          onPointerDown={e =>
                            beginDrag(e, item, dayIndex, "move")
                          }
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag}
                          onPointerCancel={() => setDrag(null)}
                          onClick={e => {
                            e.stopPropagation();
                            if (item.kind !== "slot" || readOnly || item.done)
                              openItem(item);
                          }}
                          onKeyDown={e => {
                            if (e.key === "Enter") openItem(item);
                          }}
                        >
                          <span className="block-time">
                            <span className="block-time-label">{timeRangeLabel(item)}</span>
                            {item.fixed && (
                              <Lock size={10} aria-label="fixed" />
                            )}
                            {item.repeating && (
                              <Repeat size={10} aria-label="repeats" />
                            )}
                            {(item.lanes ?? 1) > 1 && (
                              <span
                                className="block-overlap-indicator"
                                aria-hidden="true"
                                title="Overlaps another timed block"
                              >
                                !
                              </span>
                            )}
                          </span>
                          <span className="block-title">
                            {sourceTask && (
                              <TimingShapeMark task={sourceTask} />
                            )}{" "}
                            {item.title}
                          </span>
                          {item.kind === "slot" && !item.done && !readOnly && (
                            <span
                              className="resize-handle"
                              aria-hidden
                              onPointerDown={e =>
                                beginDrag(e, item, dayIndex, "resize")
                              }
                              onPointerMove={e => {
                                e.stopPropagation();
                                moveDrag(e);
                              }}
                              onPointerUp={e => {
                                e.stopPropagation();
                                endDrag(e);
                              }}
                            >
                              <GripHorizontal size={12} />
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

    </section>
  );
}
