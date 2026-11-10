import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Lock,
  RotateCcw,
  Sparkles,
  Volume2,
  Wand2,
} from "lucide-react";
import type { Project, Task, Workspace } from "../../domain/types";
import {
  adelaideClock,
  DEFAULT_PLANNING,
  formatDuration,
  formatTime,
  flexibleWindowState,
  isTime,
  minutesToTime,
  slotMinutes,
  timeToMinutes,
  type PlanningSettings,
} from "../../domain/time";
import {
  applyPlan,
  applyReset,
  dismissMissed,
  missedBlocks,
  planMyDay,
  remainingLoad,
  resetMyDay,
  weeklyBudgets,
  type PlannedBlock,
} from "../../domain/planning";
import { freeGaps } from "../../domain/calendarModel";
import TimeChips from "./TimeChips";
import TimingShapeMark from "./TimingShapeMark";

interface Props {
  workspace: Workspace;
  tasks: Task[];
  projects: Project[];
  onMutate: (fn: (w: Workspace) => Workspace) => boolean;
  onOpenTask: (task: Task) => void;
  onCalendar: () => void;
  readOnly: boolean;
  onRead?: (text: string) => void;
}

export default function TodayTimeline({
  workspace,
  tasks,
  projects,
  onMutate,
  onOpenTask,
  onCalendar,
  readOnly,
  onRead,
}: Props) {
  const [clock, setClock] = useState(() => adelaideClock());
  useEffect(() => {
    const id = window.setInterval(() => setClock(adelaideClock()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const today = clock.date;
  const now = clock.minutes;
  const settings: PlanningSettings = workspace.planning ?? DEFAULT_PLANNING;
  const [proposal, setProposal] = useState<PlannedBlock[] | null>(null);
  const [message, setMessage] = useState("");
  const [editHours, setEditHours] = useState(false);
  const [hours, setHours] = useState(settings);

  const timed = useMemo(
    () =>
      tasks
        .filter(t => t.schedule.date === today && t.schedule.time)
        .sort((a, b) => a.schedule.time!.localeCompare(b.schedule.time!)),
    [tasks, today]
  );
  const anyTime = tasks.filter(
    t => t.schedule.date === today && !t.schedule.time && t.state !== "done"
  );
  const flexibleTasks = tasks.filter(t => {
    const window = t.schedule.flexibleWindow;
    return (
      !!window &&
      t.state !== "done" &&
      ["active", "closes-today"].includes(flexibleWindowState(window, today))
    );
  });
  const explicitWindowEffort = flexibleTasks.reduce(
    (sum, task) => sum + (task.schedule.minutes ?? 0),
    0
  );
  const missed = useMemo(
    () => missedBlocks(tasks, today, now),
    [tasks, today, now]
  );
  const budgets = useMemo(
    () => weeklyBudgets(projects, tasks, today),
    [projects, tasks, today]
  );
  const load = remainingLoad(tasks, today, now);
  const dayEnd = timeToMinutes(settings.dayEnd);
  const busy = timed
    .filter(t => t.state !== "done")
    .map(t => ({
      start: timeToMinutes(t.schedule.time!),
      end: timeToMinutes(t.schedule.time!) + slotMinutes(t),
    }));
  const free = freeGaps(
    busy,
    Math.max(now, timeToMinutes(settings.dayStart)),
    dayEnd
  ).reduce((sum, g) => sum + g.end - g.start, 0);
  const next = timed.find(
    t => t.state !== "done" && timeToMinutes(t.schedule.time!) >= now
  );
  const current = timed.find(t => {
    const start = timeToMinutes(t.schedule.time!);
    return t.state !== "done" && start <= now && start + slotMinutes(t) > now;
  });

  function commit(fn: (w: Workspace) => Workspace, ok: string) {
    if (readOnly) return;
    const accepted = onMutate(fn);
    setMessage(accepted ? ok : "That was not saved. Check sync and try again.");
    return accepted;
  }

  function plan() {
    const blocks = planMyDay(tasks, today, now, settings);
    setProposal(blocks);
    setMessage(
      blocks.length
        ? ""
        : "No free time left today that fits your ready work. Try tomorrow in the calendar."
    );
  }

  function reset() {
    const blocks = resetMyDay(tasks, today, now, settings);
    const moved = blocks.length;
    commit(
      w => ({ ...w, tasks: applyReset(w.tasks, blocks) }),
      `${moved} block${moved === 1 ? "" : "s"} moved to the next free time. Nothing was lost.`
    );
  }

  function leaveMissed() {
    const ids = new Set(missed.map(t => t.id));
    commit(
      w => ({
        ...w,
        tasks: w.tasks.map(t => (ids.has(t.id) ? dismissMissed(t) : t)),
      }),
      "Left as they were."
    );
  }

  function saveHours() {
    if (
      !isTime(hours.dayStart) ||
      !isTime(hours.dayEnd) ||
      hours.dayEnd <= hours.dayStart
    ) {
      setMessage("End of day must be after the start.");
      return;
    }
    if (
      commit(
        w => ({
          ...w,
          planning: {
            ...hours,
            bufferMinutes: Math.max(0, Math.min(60, hours.bufferMinutes)),
          },
        }),
        "Planning hours saved."
      )
    )
      setEditHours(false);
  }

  function spokenDay(): string {
    const parts: string[] = [];
    if (current) parts.push(`Now: ${current.title}.`);
    const ahead = timed.filter(
      t => t.state !== "done" && timeToMinutes(t.schedule.time!) > now
    );
    if (ahead.length) {
      parts.push(
        `Still to come: ${ahead.map(t => `${t.title} at ${formatTime(t.schedule.time)}`).join("; ")}.`
      );
    } else if (!current) parts.push("Nothing else is timed today.");
    if (anyTime.length)
      parts.push(`Any time today: ${anyTime.map(t => t.title).join("; ")}.`);
    if (missed.length)
      parts.push(
        `${missed.length} planned block${missed.length === 1 ? "" : "s"} slipped by. You can reset your day.`
      );
    parts.push(
      `${formatDuration(free)} free until ${formatTime(settings.dayEnd)}.`
    );
    return parts.join(" ");
  }

  const nowIndex = timed.findIndex(t => timeToMinutes(t.schedule.time!) >= now);

  return (
    <section className="today-timeline" aria-labelledby="today-time-title">
      <div className="section-heading">
        <div>
          <div className="eyebrow">TODAY'S TIME</div>
          <h2 id="today-time-title">
            {current
              ? `Now: ${current.title}`
              : next
                ? `Next: ${next.title} at ${formatTime(next.schedule.time)}`
                : timed.length
                  ? "Nothing else timed today"
                  : "No times planned yet"}
          </h2>
        </div>
        <div className="missed-actions">
          {onRead && (
            <button
              className="text-button"
              onClick={() => onRead(spokenDay())}
              aria-label="Read my day aloud"
            >
              <Volume2 size={15} /> Read aloud
            </button>
          )}
          <button className="text-button" onClick={onCalendar}>
            <CalendarDays size={15} /> Calendar
          </button>
        </div>
      </div>
      <p className="small muted">
        {formatDuration(load)} planned ahead · {formatDuration(free)} free until{" "}
        {formatTime(settings.dayEnd)}
        {next && !current
          ? ` · starts in ${formatDuration(timeToMinutes(next.schedule.time!) - now)}`
          : ""}
      </p>

      {missed.length > 0 && !readOnly && (
        <div className="missed-banner" role="status">
          <span>
            {missed.length === 1
              ? `“${missed[0].title}” slipped by.`
              : `${missed.length} planned blocks slipped by.`}{" "}
            That happens.
          </span>
          <div className="missed-actions">
            <button className="button primary small-button" onClick={reset}>
              <RotateCcw size={14} /> Reset my day
            </button>
            <button className="text-button" onClick={leaveMissed}>
              Leave them
            </button>
          </div>
        </div>
      )}

      {timed.length > 0 && (
        <ol className="today-slots">
          {timed.map((task, index) => {
            const start = timeToMinutes(task.schedule.time!);
            const end = start + slotMinutes(task);
            return (
              <li
                key={task.id}
                className={`${task.state === "done" ? "done" : ""}${end <= now && task.state !== "done" ? " past" : ""}`}
              >
                {index === nowIndex && (
                  <span className="today-now" aria-label="Now" />
                )}
                <button className="today-slot" onClick={() => onOpenTask(task)}>
                  <span className="today-slot-time">
                    {formatTime(task.schedule.time)}–
                    {formatTime(minutesToTime(end))}
                    {task.schedule.fixed && (
                      <Lock size={11} aria-label="fixed" />
                    )}
                  </span>
                  <span className="today-slot-title">
                    <TimingShapeMark task={task} /> {task.title}
                  </span>
                </button>
              </li>
            );
          })}
          {nowIndex === -1 && (
            <li className="today-now-end">
              <span className="today-now" aria-label="Now" />
            </li>
          )}
        </ol>
      )}
      {anyTime.length > 0 && (
        <p className="small">
          <strong>Any time today:</strong>{" "}
          {anyTime.map(t => t.title).join(" · ")}
        </p>
      )}
      {flexibleTasks.length > 0 && (
        <section
          className="today-flex-windows"
          aria-label="Flexible windows active today"
        >
          <div className="today-flex-heading">
            <strong>Flexible windows</strong>
            <span className="small muted">
              {flexibleTasks.length} open
              {explicitWindowEffort
                ? ` · ${formatDuration(explicitWindowEffort)} explicit effort`
                : " · no effort estimate entered"}
            </span>
          </div>
          <ul>
            {flexibleTasks.map(task => (
              <li key={task.id}>
                <button
                  type="button"
                  className="today-flex-task"
                  onClick={() => onOpenTask(task)}
                >
                  <strong>{task.title}</strong>
                  <TimeChips task={task} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {proposal && proposal.length > 0 && (
        <div className="plan-proposal">
          <strong>Suggested for the rest of today</strong>
          <ul>
            {proposal.map(block => (
              <li key={block.taskId}>
                {formatTime(minutesToTime(block.start))} · {block.title} (
                {formatDuration(block.minutes)})
              </li>
            ))}
          </ul>
          <div className="missed-actions">
            <button
              className="button primary small-button"
              onClick={() => {
                const blocks = proposal;
                if (
                  commit(
                    w => ({ ...w, tasks: applyPlan(w.tasks, blocks) }),
                    `${blocks.length} blocks planned. Drag them in the calendar to adjust.`
                  )
                )
                  setProposal(null);
              }}
            >
              <Sparkles size={14} /> Use this plan
            </button>
            <button className="text-button" onClick={() => setProposal(null)}>
              Not now
            </button>
          </div>
        </div>
      )}

      {!readOnly && !proposal && (
        <div className="missed-actions">
          <button className="button secondary small-button" onClick={plan}>
            <Wand2 size={14} /> Plan my day
          </button>
          <button className="text-button" onClick={() => setEditHours(v => !v)}>
            Hours {formatTime(settings.dayStart)}–{formatTime(settings.dayEnd)}
          </button>
        </div>
      )}
      {editHours && (
        <div className="schedule-grid plan-hours">
          <label className="field">
            Day starts
            <input
              type="time"
              value={hours.dayStart}
              onChange={e => setHours({ ...hours, dayStart: e.target.value })}
            />
          </label>
          <label className="field">
            Day ends
            <input
              type="time"
              value={hours.dayEnd}
              onChange={e => setHours({ ...hours, dayEnd: e.target.value })}
            />
          </label>
          <label className="field">
            Gap between blocks (min)
            <input
              type="number"
              min={0}
              max={60}
              step={5}
              value={hours.bufferMinutes}
              onChange={e =>
                setHours({
                  ...hours,
                  bufferMinutes: Number(e.target.value) || 0,
                })
              }
            />
          </label>
          <button className="button primary small-button" onClick={saveHours}>
            Save hours
          </button>
        </div>
      )}

      {budgets.length > 0 && (
        <div className="budget-list" aria-label="Weekly time budgets">
          {budgets.map(b => {
            const pct = Math.min(100, Math.round((b.spent / b.budget) * 100));
            const plannedPct = Math.min(
              100 - pct,
              Math.round((b.planned / b.budget) * 100)
            );
            return (
              <div key={b.projectId} className="budget-row">
                <span className="small">
                  {b.title}: {formatDuration(b.spent)} of{" "}
                  {formatDuration(b.budget)} this week
                  {b.planned ? ` · ${formatDuration(b.planned)} planned` : ""}
                </span>
                <span className="budget-bar" aria-hidden>
                  <span className="budget-spent" style={{ width: `${pct}%` }} />
                  <span
                    className="budget-planned"
                    style={{ width: `${plannedPct}%` }}
                  />
                </span>
              </div>
            );
          })}
        </div>
      )}
      {message && (
        <p className="small muted" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
