import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Clock3, Flame, Repeat } from "lucide-react";
import type { Project, Task, Workspace } from "../../domain/types";
import TimingShapeMark from "./TimingShapeMark";
import { repeatRuleOf } from "../../domain/engine";
import { dateRange } from "../../domain/calendarModel";
import {
  adelaideClock,
  describeRepeat,
  formatDuration,
  minutesToTime,
  shiftDays,
  streak,
  WEEKDAY_SHORT,
  weekdayOf,
  weekStart,
} from "../../domain/time";
import { passOverThreshold } from "../../domain/anchorPlanning";
import {
  logTime,
  minutesLogged,
  plannedVsActual,
  weeklyBudgets,
} from "../../domain/planning";
import { friendlyDate } from "../../domain/quickParse";

interface Props {
  tasks: Task[];
  projects: Project[];
  workspace: Workspace;
  onMutate: (fn: (w: Workspace) => Workspace) => boolean;
  onOpenTask: (task: Task) => void;
  readOnly: boolean;
}

export default function TimeReview({
  tasks,
  projects,
  workspace,
  onMutate,
  onOpenTask,
  readOnly,
}: Props) {
  const clock = adelaideClock();
  const today = clock.date;
  const [anchor, setAnchor] = useState(weekStart(today));
  const dates = useMemo(() => dateRange(anchor, 7), [anchor]);
  const totals = useMemo(() => plannedVsActual(tasks, dates), [tasks, dates]);
  const max = Math.max(60, ...totals.map(d => Math.max(d.planned, d.actual)));
  const sumPlanned = totals.reduce((s, d) => s + d.planned, 0);
  const sumActual = totals.reduce((s, d) => s + d.actual, 0);
  const budgets =
    anchor === weekStart(today) ? weeklyBudgets(projects, tasks, today) : [];
  const habits = tasks.filter(t => t.state !== "done" && repeatRuleOf(t));
  const topTime = tasks
    .map(t => ({ task: t, minutes: minutesLogged(t, dates[0], dates[6]) }))
    .filter(x => x.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 8);

  const [logTask, setLogTask] = useState("");
  const [logMinutes, setLogMinutes] = useState(30);
  const [logDate, setLogDate] = useState(today);
  const [note, setNote] = useState("");
  const open = tasks
    .filter(t => t.state !== "done")
    .sort((a, b) => a.title.localeCompare(b.title));

  function addLog() {
    if (!logTask || logMinutes < 1) return;
    const start = `${logDate}T${logDate === today ? minutesToTime(Math.max(0, clock.minutes - logMinutes)) : "12:00"}`;
    const ok = onMutate(w => ({
      ...w,
      tasks: w.tasks.map(t =>
        t.id === logTask
          ? logTime(t, start, Math.min(720, logMinutes), "manual")
          : t
      ),
    }));
    setNote(
      ok ? "Time logged." : "That was not saved. Check sync and try again."
    );
  }

  return (
    <section className="time-review" aria-labelledby="time-review-title">
      <div className="calendar-toolbar">
        <h1 id="time-review-title">
          <Clock3 size={22} /> Time & plans
        </h1>
        <div className="calendar-controls">
          <button
            className="icon-button"
            aria-label="Previous week"
            onClick={() => setAnchor(shiftDays(anchor, -7))}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="button secondary small-button"
            onClick={() => setAnchor(weekStart(today))}
          >
            This week
          </button>
          <button
            className="icon-button"
            aria-label="Next week"
            onClick={() => setAnchor(shiftDays(anchor, 7))}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <p className="muted">
        Week of{" "}
        {new Date(`${anchor}T12:00:00`).toLocaleDateString("en-AU", {
          day: "numeric",
          month: "short",
          timeZone: "Australia/Adelaide",
        })}
        : {formatDuration(sumPlanned)} planned, {formatDuration(sumActual)}{" "}
        actually focused. This is a mirror, not a score; plans are guesses and
        that is fine.
      </p>

      <div className="settings-section pass-over-settings">
        <h2>Task pool check-in</h2>
        <label className="field" htmlFor="pass-over-threshold">
          Ask “Still on, or dropped?” after
          <select
            id="pass-over-threshold"
            value={passOverThreshold(workspace)}
            disabled={readOnly}
            onChange={event => {
              const value = Number(event.target.value);
              const saved = onMutate(current => ({
                ...current,
                planning: {
                  ...current.planning,
                  passOverThreshold: value,
                },
              }));
              setNote(
                saved
                  ? `Check-in set after ${value} Not now choices.`
                  : "The check-in setting was not saved. Check sync and try again."
              );
            }}
          >
            {Array.from({ length: 10 }, (_, index) => index + 1).map(value => (
              <option key={value} value={value}>
                {value} Not now choices
              </option>
            ))}
          </select>
          <span className="small muted">
            “Still on” resets the count. “Dropped” keeps the task and records your decision; it never deletes it.
          </span>
        </label>
      </div>

      <div
        className="pva-chart"
        role="table"
        aria-label="Planned versus actual time by day"
      >
        {totals.map(d => (
          <div
            key={d.date}
            className={`pva-day${d.date === today ? " today" : ""}`}
            role="row"
          >
            <span className="pva-label" role="rowheader">
              {WEEKDAY_SHORT[weekdayOf(d.date)]} {Number(d.date.slice(8))}
            </span>
            <span className="pva-bars" role="cell">
              <span
                className="pva-bar planned"
                style={{ width: `${(d.planned / max) * 100}%` }}
                title={`Planned ${formatDuration(d.planned)}`}
              />
              <span
                className="pva-bar actual"
                style={{ width: `${(d.actual / max) * 100}%` }}
                title={`Actual ${formatDuration(d.actual)}`}
              />
            </span>
            <span className="pva-values small muted" role="cell">
              {formatDuration(d.planned)} / {formatDuration(d.actual)}
            </span>
          </div>
        ))}
        <p className="small muted pva-legend">
          <span className="pva-swatch planned" /> planned{" "}
          <span className="pva-swatch actual" /> focused (from the focus timer
          and logged time)
        </p>
      </div>

      {budgets.length > 0 && (
        <div className="settings-section">
          <h2>Weekly time budgets</h2>
          {budgets.map(b => (
            <div key={b.projectId} className="budget-row">
              <span>
                <strong>{b.title}</strong>: {formatDuration(b.spent)} of{" "}
                {formatDuration(b.budget)}
                {b.planned
                  ? ` · ${formatDuration(b.planned)} still planned`
                  : ""}
                {b.spent >= b.budget ? " · budget met" : ""}
              </span>
              <span className="budget-bar" aria-hidden>
                <span
                  className="budget-spent"
                  style={{
                    width: `${Math.min(100, (b.spent / b.budget) * 100)}%`,
                  }}
                />
                <span
                  className="budget-planned"
                  style={{
                    width: `${Math.min(100 - Math.min(100, (b.spent / b.budget) * 100), (b.planned / b.budget) * 100)}%`,
                  }}
                />
              </span>
            </div>
          ))}
        </div>
      )}

      {habits.length > 0 && (
        <div className="settings-section">
          <h2>
            <Repeat size={18} /> Repeating
          </h2>
          <ul className="habit-list">
            {habits.map(t => {
              const s = streak(t.schedule);
              const done = t.schedule.completions.filter(
                d => d >= dates[0] && d <= dates[6]
              ).length;
              return (
                <li key={t.id}>
                  <button className="text-button" onClick={() => onOpenTask(t)}>
                    <TimingShapeMark task={t} /> {t.title}
                  </button>
                  <span className="small muted">
                    {describeRepeat(repeatRuleOf(t))} · {done} this week
                    {t.schedule.date
                      ? ` · next ${friendlyDate(t.schedule.date, today)}`
                      : ""}
                  </span>
                  {s > 1 && (
                    <span className="time-chip">
                      <Flame size={12} aria-hidden /> {s} in a row
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="settings-section">
        <h2>Where the time went</h2>
        {topTime.length === 0 ? (
          <p className="small muted">
            No focused time recorded this week yet. The focus timer records it
            automatically.
          </p>
        ) : (
          <ul className="habit-list">
            {topTime.map(({ task, minutes }) => (
              <li key={task.id}>
                <button
                  className="text-button"
                  onClick={() => onOpenTask(task)}
                >
                  <TimingShapeMark task={task} /> {task.title}
                </button>
                <span className="small muted">{formatDuration(minutes)}</span>
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <form
            className="schedule-grid log-time"
            onSubmit={e => {
              e.preventDefault();
              addLog();
            }}
          >
            <label className="field">
              Log time for
              <select
                value={logTask}
                onChange={e => setLogTask(e.target.value)}
                aria-label="Task to log time for"
              >
                <option value="">Choose a task…</option>
                {open.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Minutes
              <input
                type="number"
                min={1}
                max={720}
                value={logMinutes}
                onChange={e => setLogMinutes(Number(e.target.value) || 0)}
              />
            </label>
            <label className="field">
              Day
              <input
                type="date"
                value={logDate}
                max={today}
                onChange={e => setLogDate(e.target.value || today)}
              />
            </label>
            <button
              className="button secondary small-button"
              disabled={!logTask}
            >
              Log time
            </button>
          </form>
        )}
        {note && (
          <p className="small muted" role="status">
            {note}
          </p>
        )}
      </div>
    </section>
  );
}
