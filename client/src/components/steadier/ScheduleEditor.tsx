import { useRef, useState } from "react";
import {
  Bell,
  CalendarClock,
  Repeat,
  SkipForward,
  Sparkles,
  X,
} from "lucide-react";
import type { Task } from "../../domain/types";
import {
  WEEKDAY_SHORT,
  adelaideClock,
  describeRepeat,
  emptyRepeat,
  formatDuration,
  formatTime,
  rescheduleOccurrenceSchedule,
  setFlexibleWindowSchedule,
  setFlexibleRecurrenceAnchor,
  describeFlexibleRecurrence,
  shiftDays,
  weekdayOf,
  streak,
  thisWeekendWindow,
  nextWeekWindow,
  describeFlexibleWindow,
  type RepeatFreq,
  type RepeatRule,
  type Reminder,
  type TaskSchedule,
  type FlexibleTimeWindow,
} from "../../domain/time";
import { parseQuickAdd, friendlyDate } from "../../domain/quickParse";

const REMINDER_PRESETS: { label: string; minutes: number }[] = [
  { label: "At the time", minutes: 0 },
  { label: "5 min before", minutes: 5 },
  { label: "15 min before", minutes: 15 },
  { label: "30 min before", minutes: 30 },
  { label: "1 hour before", minutes: 60 },
  { label: "2 hours before", minutes: 120 },
  { label: "1 day before", minutes: 1440 },
  { label: "2 days before", minutes: 2880 },
  { label: "1 week before", minutes: 10080 },
];

export function reminderLabel(r: Reminder): string {
  const preset = REMINDER_PRESETS.find(p => p.minutes === r.minutesBefore);
  const base = preset
    ? preset.label
    : r.minutesBefore % 1440 === 0
      ? `${r.minutesBefore / 1440} days before`
      : r.minutesBefore % 60 === 0
        ? `${r.minutesBefore / 60} hours before`
        : `${r.minutesBefore} min before`;
  return `${base}${r.anchor === "deadline" ? " the deadline" : ""}`;
}

function newId(): string {
  return `rem-${Math.random().toString(36).slice(2, 10)}`;
}

interface Props {
  task: Task;
  onChange: (patch: Partial<Task>) => void;
  onSkip?: () => void;
}

/** "When": planned slot, deadline time, reminders and repeat for one task. */
export default function ScheduleEditor({ task, onChange, onSkip }: Props) {
  const s = task.schedule;
  const convertingWindowToFixedRef = useRef(false);
  const set = (patch: Partial<TaskSchedule>) => {
    const schedule = { ...s, ...patch };
    if (
      s.repeat &&
      ("date" in patch || "time" in patch) &&
      !("flexibleWindow" in patch)
    ) {
      const changes: Partial<Pick<TaskSchedule, "date" | "time">> = {};
      if ("date" in patch) changes.date = patch.date;
      if ("time" in patch) changes.time = patch.time;
      const instance = rescheduleOccurrenceSchedule(
        s,
        changes,
        task.deadline ?? task.startDate
      );
      schedule.repeatAnchorDate = instance.repeatAnchorDate;
      schedule.repeatOccurrenceDate = instance.repeatOccurrenceDate;
      schedule.repeatTime = instance.repeatTime;
    }
    if (convertingWindowToFixedRef.current && "time" in patch && patch.time) {
      schedule.repeatTime = patch.time;
      convertingWindowToFixedRef.current = false;
    }
    onChange({ schedule });
  };
  const [phrase, setPhrase] = useState("");
  const [phraseNote, setPhraseNote] = useState("");
  const [reminderChoice, setReminderChoice] = useState("15");
  const today = adelaideClock().date;
  const rule = s.repeat;
  const setRule = (patch: Partial<RepeatRule>) => {
    const nextRule = { ...(rule ?? emptyRepeat()), ...patch };
    const fallbackDate =
      s.flexibleWindow?.startDate ?? task.deadline ?? task.startDate ?? null;
    set({
      repeat: nextRule,
      repeatAnchorDate: s.repeatAnchorDate ?? s.date ?? fallbackDate,
      repeatOccurrenceDate: s.repeatOccurrenceDate ?? s.date ?? fallbackDate,
      repeatTime: s.repeatTime !== undefined ? s.repeatTime : s.time,
    });
  };

  const chooseWindow = (window: FlexibleTimeWindow) => {
    convertingWindowToFixedRef.current = false;
    onChange({
      schedule: setFlexibleWindowSchedule(
        s,
        window,
        task.deadline ?? task.startDate
      ),
    });
  };
  const chooseFixedTiming = () => {
    if (!s.flexibleWindow) return;
    convertingWindowToFixedRef.current = !!s.repeat;
    const schedule = {
      ...s,
      date: s.flexibleWindow.startDate,
      time: null,
      fixed: false,
    };
    delete schedule.flexibleWindow;
    onChange({ schedule });
  };
  const sameWindow = (
    left: FlexibleTimeWindow | undefined,
    right: FlexibleTimeWindow
  ) => left?.startDate === right.startDate && left?.endDate === right.endDate;

  function applyPhrase() {
    const clock = adelaideClock();
    const r = parseQuickAdd(phrase, clock.date, clock.minutes);
    if (!r.understood.length) {
      setPhraseNote(
        "I couldn't find a date, time or repeat in that. Try e.g. “Fri 2pm for 1 hour every week”."
      );
      return;
    }
    if (r.time && !s.fixed && !r.fixed && !r.flexibleWindow) {
      setPhraseNote(
        "Choose Booked anchor first if this is a real commitment. Otherwise keep it as an untimed task."
      );
      return;
    }
    const patch: Partial<Task> = {};
    const schedule: TaskSchedule = { ...s };
    if (r.flexibleWindow) {
      convertingWindowToFixedRef.current = false;
      schedule.flexibleWindow = r.flexibleWindow;
      schedule.date = null;
      schedule.time = null;
      schedule.fixed = false;
      schedule.reminders = s.reminders.filter(
        reminder => reminder.anchor === "deadline"
      );
      if (r.minutes !== null) schedule.minutes = r.minutes;
    } else {
      if (r.date || r.time) delete schedule.flexibleWindow;
      if (r.date) schedule.date = r.date;
      if (r.time) schedule.time = r.time;
      if (r.minutes !== null) schedule.minutes = r.minutes;
    }
    if (r.repeat) {
      schedule.repeat = r.repeat;
      const fallbackDate =
        r.flexibleWindow?.startDate ??
        s.flexibleWindow?.startDate ??
        task.deadline ??
        task.startDate ??
        null;
      const hadRepeat = !!s.repeat;
      const anchorDate = hadRepeat
        ? (s.repeatAnchorDate ??
          s.repeatOccurrenceDate ??
          s.flexibleWindow?.startDate ??
          s.date ??
          fallbackDate)
        : (r.flexibleWindow?.startDate ?? schedule.date ?? fallbackDate);
      const occurrenceDate = hadRepeat
        ? (s.repeatOccurrenceDate ?? s.date ?? fallbackDate)
        : (r.flexibleWindow?.startDate ?? schedule.date ?? fallbackDate);
      schedule.repeatAnchorDate = schedule.repeatAnchorDate ?? anchorDate;
      schedule.repeatOccurrenceDate = r.flexibleWindow
        ? r.flexibleWindow.startDate
        : (schedule.repeatOccurrenceDate ?? occurrenceDate);
      schedule.repeatTime = r.flexibleWindow
        ? null
        : r.time || !hadRepeat
          ? schedule.time
          : s.repeatTime !== undefined
            ? s.repeatTime
            : s.time;
    } else if (s.repeat && r.flexibleWindow) {
      schedule.repeatAnchorDate =
        s.repeatAnchorDate ??
        s.repeatOccurrenceDate ??
        s.flexibleWindow?.startDate ??
        s.date ??
        task.deadline ??
        task.startDate ??
        r.flexibleWindow.startDate;
      schedule.repeatOccurrenceDate = r.flexibleWindow.startDate;
      schedule.repeatTime = null;
    } else if (s.repeat && (r.date || r.time)) {
      const changes: Partial<Pick<TaskSchedule, "date" | "time">> = {};
      if (r.date) changes.date = schedule.date;
      if (r.time) changes.time = schedule.time;
      const instance = rescheduleOccurrenceSchedule(
        s,
        changes,
        task.deadline ?? task.startDate
      );
      schedule.repeatAnchorDate = instance.repeatAnchorDate;
      schedule.repeatOccurrenceDate = instance.repeatOccurrenceDate;
      schedule.repeatTime = instance.repeatTime;
    }
    if (convertingWindowToFixedRef.current && r.time) {
      schedule.repeatTime = r.time;
      convertingWindowToFixedRef.current = false;
    }
    if (r.deadlineTime) schedule.deadlineTime = r.deadlineTime;
    if (r.fixed) schedule.fixed = true;
    const parsedReminders = r.reminders.filter(
      reminder => !r.flexibleWindow || reminder.anchor === "deadline"
    );
    if (parsedReminders.length) {
      schedule.reminders = [
        ...s.reminders,
        ...parsedReminders.map(x => ({ id: newId(), ...x })),
      ].slice(0, 10);
    }
    if (r.deadline) patch.deadline = r.deadline;
    onChange({ ...patch, schedule });
    setPhraseNote(`Set: ${r.understood.join(" · ")}`);
    setPhrase("");
  }

  const anchorAvailable = { slot: !!s.date, deadline: !!task.deadline };
  const visibleReminders = s.flexibleWindow
    ? s.reminders.filter(reminder => reminder.anchor === "deadline")
    : s.reminders;
  const canAddReminder = s.flexibleWindow
    ? anchorAvailable.deadline
    : anchorAvailable.slot || anchorAvailable.deadline;
  function addReminder() {
    const minutes = Number(reminderChoice);
    const anchor: Reminder["anchor"] =
      anchorAvailable.slot || !anchorAvailable.deadline ? "slot" : "deadline";
    if (
      s.reminders.some(r => r.minutesBefore === minutes && r.anchor === anchor)
    )
      return;
    set({
      reminders: [
        ...s.reminders,
        { id: newId(), minutesBefore: minutes, anchor },
      ].slice(0, 10),
    });
  }

  const freq: RepeatFreq | "none" = rule ? rule.freq : "none";
  const monthlyMode = rule?.nthWeekday
    ? "nth"
    : rule?.monthDay === -1
      ? "last"
      : "date";
  const planned = s.flexibleWindow
    ? describeFlexibleWindow(s.flexibleWindow, today)
    : s.date
      ? `${friendlyDate(s.date, today)}${s.time ? `, ${formatTime(s.time)}` : ""}${
          s.time
            ? ` for ${formatDuration(s.minutes ?? task.estimate ?? 15)}`
            : ""
        }`
      : "Not planned";
  const seriesStreak = streak(s);
  const seriesExhausted =
    !!rule &&
    ((rule.count !== null &&
      s.completions.length + s.skipped.length >= rule.count) ||
      (!s.date &&
        !!s.repeatOccurrenceDate &&
        s.skipped.includes(s.repeatOccurrenceDate)));

  return (
    <section className="schedule-editor" aria-labelledby="when-title">
      <h3 id="when-title">
        <CalendarClock size={18} /> When
        <span className="schedule-summary">{planned}</span>
      </h3>

      <div className="quick-when">
        <label className="field">
          Type when (optional)
          <div className="quick-when-row">
            <input
              value={phrase}
              onChange={e => setPhrase(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyPhrase();
                }
              }}
              placeholder="e.g. tomorrow 3pm for 30 min every Tue"
              aria-label="Type when in plain words"
            />
            <button
              type="button"
              className="button secondary"
              onClick={applyPhrase}
              disabled={!phrase.trim()}
            >
              <Sparkles size={15} /> Set
            </button>
          </div>
        </label>
        {phraseNote && (
          <p className="small muted" role="status">
            {phraseNote}
          </p>
        )}
      </div>

      {rule && (
        <p className="small muted">
          Change the day or time above to reschedule only this occurrence. The
          repeat pattern and usual time stay unchanged; edit the Repeat settings
          below to change future occurrences. Save changes to confirm.
        </p>
      )}
      <div className="timing-mode">
        <span className="field-label" id="timing-mode-label">
          Change timing
        </span>
        <div
          className="segmented"
          role="group"
          aria-labelledby="timing-mode-label"
        >
          <button
            type="button"
            className={!s.flexibleWindow ? "on" : ""}
            aria-pressed={!s.flexibleWindow}
            onClick={chooseFixedTiming}
          >
            Fixed date/time
          </button>
          <button
            type="button"
            className={s.flexibleWindow ? "on" : ""}
            aria-pressed={!!s.flexibleWindow}
            onClick={() =>
              chooseWindow(
                s.flexibleWindow ?? {
                  startDate: s.date ?? today,
                  endDate: s.date ?? today,
                }
              )
            }
          >
            Flexible time window
          </button>
        </div>
      </div>

      {s.flexibleWindow ? (
        <div className="flex-window-editor">
          <div
            className="flex-window-presets"
            role="group"
            aria-label="Flexible window presets"
          >
            {[
              { label: "Today", value: { startDate: today, endDate: today } },
              { label: "This weekend", value: thisWeekendWindow(today) },
              { label: "Next week", value: nextWeekWindow(today) },
            ].map(preset => (
              <button
                type="button"
                key={preset.label}
                className={`button small-button ${sameWindow(s.flexibleWindow, preset.value) ? "primary" : "secondary"}`}
                aria-pressed={sameWindow(s.flexibleWindow, preset.value)}
                onClick={() => chooseWindow(preset.value)}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              className={`button small-button ${
                sameWindow(s.flexibleWindow, thisWeekendWindow(today)) ||
                sameWindow(s.flexibleWindow, nextWeekWindow(today)) ||
                sameWindow(s.flexibleWindow, {
                  startDate: today,
                  endDate: today,
                })
                  ? "secondary"
                  : "primary"
              }`}
              aria-pressed={
                !sameWindow(s.flexibleWindow, thisWeekendWindow(today)) &&
                !sameWindow(s.flexibleWindow, nextWeekWindow(today)) &&
                !sameWindow(s.flexibleWindow, {
                  startDate: today,
                  endDate: today,
                })
              }
              onClick={() =>
                chooseWindow(
                  s.flexibleWindow ?? { startDate: today, endDate: today }
                )
              }
            >
              Custom dates
            </button>
          </div>
          <div className="schedule-grid">
            <label className="field">
              Window starts (inclusive)
              <input
                type="date"
                value={s.flexibleWindow.startDate}
                max={s.flexibleWindow.endDate}
                onChange={e =>
                  chooseWindow({
                    ...s.flexibleWindow!,
                    startDate: e.target.value || today,
                  })
                }
              />
            </label>
            <label className="field">
              Window ends (inclusive)
              <input
                type="date"
                value={s.flexibleWindow.endDate}
                min={s.flexibleWindow.startDate}
                onChange={e =>
                  chooseWindow({
                    ...s.flexibleWindow!,
                    endDate: e.target.value || s.flexibleWindow!.startDate,
                  })
                }
              />
            </label>
            <label className="field">
              Estimated effort (min, optional)
              <input
                type="number"
                min={1}
                max={1440}
                step={5}
                value={s.minutes ?? ""}
                onChange={e =>
                  set({
                    minutes: e.target.value
                      ? Math.max(1, Math.min(1440, Number(e.target.value)))
                      : null,
                  })
                }
              />
            </label>
          </div>
          <p className="small muted">
            This removes the fixed time; the task stays available through the
            end of the window.
          </p>
          <p className="small muted">
            No time-of-day or slot reminder/alert is generated for this window.
            A reminder explicitly attached to a separate hard deadline remains
            tied to that deadline.
          </p>
        </div>
      ) : (
        <>
          <div className="schedule-grid">
            <label className="field">
              {rule ? "This occurrence day" : "Planned day"}
              <input
                type="date"
                value={s.date ?? ""}
                onChange={e => set({ date: e.target.value || null })}
              />
            </label>
            <label className="field">
              {rule ? "This occurrence time" : "Start time"}
              <input
              type="time"
              step={300}
              value={s.time ?? ""}
              disabled={!s.date || !s.fixed}
              onChange={e => set({ time: e.target.value || null })}
              />
            </label>
            <label className="field">
              Length (min)
              <input
                type="number"
                min={5}
                max={1440}
                step={5}
                value={s.minutes ?? ""}
                placeholder={String(task.estimate || 15)}
                onChange={e =>
                  set({
                    minutes: e.target.value
                      ? Math.max(1, Math.min(1440, Number(e.target.value)))
                      : null,
                  })
                }
              />
            </label>
            <label className="field">
              Deadline time
              <input
                type="time"
                step={300}
                value={s.deadlineTime ?? ""}
                disabled={!task.deadline}
                title={task.deadline ? "" : "Set a real deadline first"}
                onChange={e => set({ deadlineTime: e.target.value || null })}
              />
            </label>
          </div>
          <label className="check-line tone-toggle">
            <input
              type="checkbox"
              checked={s.fixed === true}
              onChange={e => set({ fixed: e.target.checked })}
            />
            <span>
              Booked anchor
              <small className="muted">
                {" "}— explicitly show this commitment on the clock/calendar. The planner will never book a task by itself.
              </small>
            </span>
          </label>
          {s.fixed === true && (
            <label className="check-line tone-toggle">
              <input
                type="checkbox"
                checked={s.majorAnchor === true}
                onChange={e => set({ majorAnchor: e.target.checked })}
              />
              <span>
                Major anchor
                <small className="muted">
                  {" "}— show this booked item in Month
                </small>
              </span>
            </label>
          )}
          {!s.fixed && (s.date || s.time) && (
            <p className="small muted">
              This date/time is not a calendar booking until you select Booked anchor.
            </p>
          )}
          {(s.date || s.time) && (
            <button
              type="button"
              className="text-button"
              onClick={() =>
                set({ date: null, time: null, minutes: null, fixed: false })
              }
            >
              Clear the planned slot
            </button>
          )}
        </>
      )}

      <div className="schedule-block">
        <h4>
          <Bell size={16} /> Reminders
        </h4>
        {s.flexibleWindow ? (
          <p className="small muted">
            The window dates create no reminders or alarms. Explicit reminders for a separate hard deadline remain attached to that deadline.
          </p>
        ) : (
          s.reminders.length === 0 && (
            <p className="small muted">No reminders.</p>
          )
        )}
        <ul className="chip-list">
          {visibleReminders.map(r => (
              <li key={r.id} className="chip">
                {reminderLabel(r)}
                {anchorAvailable.slot && anchorAvailable.deadline && (
                  <button
                    type="button"
                    className="chip-switch"
                    onClick={() =>
                      set({
                        reminders: s.reminders.map(x =>
                          x.id === r.id
                            ? {
                                ...x,
                                anchor:
                                  x.anchor === "slot" ? "deadline" : "slot",
                              }
                            : x
                        ),
                      })
                    }
                    aria-label={`Anchor to ${r.anchor === "slot" ? "deadline" : "planned time"}`}
                  >
                    {r.anchor === "slot" ? "→ deadline" : "→ planned"}
                  </button>
                )}
                <button
                  type="button"
                  className="chip-remove"
                  aria-label={`Remove reminder ${reminderLabel(r)}`}
                  onClick={() =>
                    set({ reminders: s.reminders.filter(x => x.id !== r.id) })
                  }
                >
                  <X size={13} />
                </button>
              </li>
            ))}
        </ul>
        {canAddReminder && (
          <div className="quick-when-row">
            <select
              value={reminderChoice}
              onChange={e => setReminderChoice(e.target.value)}
              aria-label={s.flexibleWindow ? "Hard deadline reminder time" : "Reminder time"}
            >
              {REMINDER_PRESETS.map(p => (
                <option key={p.minutes} value={p.minutes}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button secondary"
              onClick={addReminder}
              disabled={!canAddReminder}
            >
              {s.flexibleWindow ? "Add deadline reminder" : "Add reminder"}
            </button>
          </div>
        )}
        {!s.flexibleWindow &&
          !anchorAvailable.slot &&
          !anchorAvailable.deadline && (
            <p className="small muted">Plan a day or set a deadline first.</p>
          )}
        {!s.flexibleWindow && s.reminders.length > 0 && (
          <p className="small muted">
            Reminders ring in Steadier while it's open, and on your phone
            through the Google Calendar link (Settings → Calendar alarms).
          </p>
        )}
        {s.flexibleWindow && !anchorAvailable.deadline && (
          <p className="small muted">
            Set a separate hard deadline to add an explicit deadline reminder.
          </p>
        )}
      </div>

      <div className="schedule-block">
        <h4>
          <Repeat size={16} /> Repeat
          <span className="schedule-summary">{describeRepeat(rule)}</span>
        </h4>
        <div className="schedule-grid">
          <label className="field">
            Repeats
            <select
              value={freq}
              onChange={e => {
                const value = e.target.value as RepeatFreq | "none";
                if (value === "none")
                  set({
                    repeat: null,
                    repeatAnchorDate: null,
                    repeatOccurrenceDate: null,
                    repeatTime: null,
                  });
                else {
                  const fallbackDate = task.deadline ?? task.startDate ?? null;
                  set({
                    repeat: {
                      ...emptyRepeat(value),
                      interval: value === "after" ? 7 : 1,
                    },
                    repeatAnchorDate:
                      s.repeatAnchorDate ?? s.date ?? fallbackDate,
                    repeatOccurrenceDate:
                      s.repeatOccurrenceDate ?? s.date ?? fallbackDate,
                    repeatTime:
                      s.repeatTime !== undefined ? s.repeatTime : s.time,
                  });
                }
              }}
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="after">Days after I finish</option>
            </select>
          </label>
          {rule && (
            <label className="field">
              {rule.freq === "after" ? "Days after done" : "Every"}
              <input
                type="number"
                min={1}
                max={366}
                value={rule.interval}
                onChange={e =>
                  setRule({
                    interval: Math.max(
                      1,
                      Math.min(366, Number(e.target.value) || 1)
                    ),
                  })
                }
              />
            </label>
          )}
        </div>
        {rule?.freq === "weekly" && (
          <div
            className="weekday-picker"
            role="group"
            aria-label="Repeat on days"
          >
            {WEEKDAY_SHORT.map((label, day) => {
              const on = rule.weekdays.includes(day);
              return (
                <button
                  type="button"
                  key={label}
                  className={on ? "weekday on" : "weekday"}
                  aria-pressed={on}
                  onClick={() =>
                    setRule({
                      weekdays: on
                        ? rule.weekdays.filter(d => d !== day)
                        : [...rule.weekdays, day].sort(),
                    })
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        {rule && s.flexibleWindow && rule.freq !== "after" && (
          <div
            className="flex-anchor"
            role="group"
            aria-label="Repeating flexible window anchor"
          >
            <p className="small muted">
              Anchor: the day each repeat of the window opens. It never has a
              clock time.
            </p>
            <div
              className="weekday-picker"
              role="group"
              aria-label="Window opens on"
            >
              {WEEKDAY_SHORT.map((label, day) => {
                const anchorDate =
                  s.repeatAnchorDate ?? s.flexibleWindow!.startDate;
                const on = weekdayOf(anchorDate) === day;
                return (
                  <button
                    type="button"
                    key={label}
                    className={on ? "weekday on" : "weekday"}
                    aria-pressed={on}
                    onClick={() => {
                      const offset = (day - weekdayOf(today) + 7) % 7;
                      onChange({
                        schedule: setFlexibleRecurrenceAnchor(
                          s,
                          shiftDays(today, offset)
                        ),
                      });
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="schedule-grid">
              <label className="field">
                Repeat anchor date (window opens)
                <input
                  type="date"
                  value={s.repeatAnchorDate ?? s.flexibleWindow.startDate}
                  onChange={e => {
                    if (!e.target.value) return;
                    onChange({
                      schedule: setFlexibleRecurrenceAnchor(s, e.target.value),
                    });
                  }}
                />
              </label>
              <label className="field">
                Window runs through (inclusive)
                <input
                  type="date"
                  value={s.flexibleWindow.endDate}
                  min={s.flexibleWindow.startDate}
                  onChange={e =>
                    chooseWindow({
                      ...s.flexibleWindow!,
                      endDate: e.target.value || s.flexibleWindow!.startDate,
                    })
                  }
                />
              </label>
            </div>
            <p className="small muted" role="status">
              {describeFlexibleRecurrence(s)}
            </p>
          </div>
        )}
        {rule?.freq === "monthly" && (
          <div className="schedule-grid">
            <label className="field">
              On
              <select
                value={monthlyMode}
                onChange={e => {
                  const mode = e.target.value;
                  const ref = s.date ?? task.deadline ?? today;
                  const [, , d] = ref.split("-").map(Number);
                  const weekday = new Date(`${ref}T12:00:00Z`).getUTCDay();
                  if (mode === "nth")
                    setRule({
                      nthWeekday: { n: Math.min(4, Math.ceil(d / 7)), weekday },
                      monthDay: null,
                    });
                  else if (mode === "last")
                    setRule({ monthDay: -1, nthWeekday: null });
                  else setRule({ monthDay: d, nthWeekday: null });
                }}
              >
                <option value="date">The same date</option>
                <option value="nth">A weekday (e.g. 2nd Tue)</option>
                <option value="last">The last day</option>
              </select>
            </label>
            {monthlyMode === "date" && (
              <label className="field">
                Day of month
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={rule.monthDay ?? ""}
                  placeholder="planned day"
                  onChange={e =>
                    setRule({
                      monthDay: e.target.value
                        ? Math.max(1, Math.min(31, Number(e.target.value)))
                        : null,
                    })
                  }
                />
              </label>
            )}
            {monthlyMode === "nth" && rule.nthWeekday && (
              <>
                <label className="field">
                  Which
                  <select
                    value={rule.nthWeekday.n}
                    onChange={e =>
                      setRule({
                        nthWeekday: {
                          ...rule.nthWeekday!,
                          n: Number(e.target.value),
                        },
                      })
                    }
                  >
                    <option value={1}>1st</option>
                    <option value={2}>2nd</option>
                    <option value={3}>3rd</option>
                    <option value={4}>4th</option>
                    <option value={-1}>Last</option>
                  </select>
                </label>
                <label className="field">
                  Day
                  <select
                    value={rule.nthWeekday.weekday}
                    onChange={e =>
                      setRule({
                        nthWeekday: {
                          ...rule.nthWeekday!,
                          weekday: Number(e.target.value),
                        },
                      })
                    }
                  >
                    {WEEKDAY_SHORT.map((label, day) => (
                      <option key={label} value={day}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
        )}
        {rule && (
          <div className="schedule-grid">
            <label className="field">
              Ends on (optional)
              <input
                type="date"
                value={rule.until ?? ""}
                onChange={e => setRule({ until: e.target.value || null })}
              />
            </label>
            <label className="field">
              Maximum occurrences (optional)
              <input
                type="number"
                min={1}
                max={10000}
                value={rule.count ?? ""}
                placeholder="no limit"
                onChange={e =>
                  setRule({
                    count: e.target.value
                      ? Math.max(1, Number(e.target.value))
                      : null,
                  })
                }
              />
            </label>
          </div>
        )}
        {rule && (
          <p className="small muted">
            {s.flexibleWindow
              ? "Only this window is active. The next instance is created when you complete this one."
              : seriesExhausted
                ? "This repeat series has no future occurrences."
                : rule.freq === "after"
                  ? "The next one is planned when you finish this one."
                  : "When you finish (or skip) this one, the next one is created on the pattern, never in the past."}
            {s.completions.length > 0 &&
              ` Done ${s.completions.length} time${s.completions.length === 1 ? "" : "s"}${
                seriesStreak > 1 ? ` · ${seriesStreak} in a row` : ""
              }.`}
          </p>
        )}
        {rule?.until && rule.count !== null && (
          <p className="small muted">
            Both limits apply; the repeat stops at whichever comes first.
          </p>
        )}
        {rule && onSkip && rule.freq !== "after" && !seriesExhausted && (
          <button type="button" className="text-button" onClick={onSkip}>
            <SkipForward size={15} />
            {rule.freq === "weekly"
              ? "Skip this week's instance"
              : "Skip this occurrence"}{" "}
            (keeps the series going)
          </button>
        )}
      </div>
    </section>
  );
}
