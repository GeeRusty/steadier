/**
 * When each task reminder fires, as real instants (Adelaide wall-clock based).
 * Slot reminders count back from the planned start (9:00 when the day has no
 * time); deadline reminders from the deadline time (9:00 when none).
 */
import type { Task } from "./types";
import { adelaideToInstant, formatTime } from "./time";

export interface DueReminder {
  key: string;
  taskId: string;
  at: Date;
  title: string;
  body: string;
}

export function reminderInstants(task: Task): DueReminder[] {
  if (task.state === "done") return [];
  const s = task.schedule;
  const out: DueReminder[] = [];
  for (const r of s.reminders) {
    if (s.flexibleWindow && r.anchor === "slot") continue;
    const date = r.anchor === "slot" ? s.date : task.deadline;
    if (!date) continue;
    const time = (r.anchor === "slot" ? s.time : s.deadlineTime) ?? "09:00";
    const anchor = adelaideToInstant(date, time);
    const at = new Date(anchor.getTime() - r.minutesBefore * 60_000);
    const when =
      r.anchor === "slot"
        ? s.time
          ? r.minutesBefore === 0
            ? `Now (${formatTime(s.time)})`
            : `Starts at ${formatTime(s.time)}`
          : "Planned for today"
        : `Due ${s.deadlineTime ? formatTime(s.deadlineTime) : ""} ${date}`.replace(
            /\s+/g,
            " "
          );
    out.push({
      key: `${task.id}:${r.id}:${at.toISOString()}`,
      taskId: task.id,
      at,
      title: task.title,
      body: `${when}${task.nextAction ? ` · Next: ${task.nextAction}` : ""}`,
    });
  }
  return out;
}

/** Reminders due in (now - graceMs, now], not yet fired. */
export function dueReminders(
  tasks: Task[],
  now: Date,
  fired: Set<string>,
  graceMs = 10 * 60_000
): DueReminder[] {
  const due: DueReminder[] = [];
  for (const task of tasks) {
    for (const reminder of reminderInstants(task)) {
      const age = now.getTime() - reminder.at.getTime();
      if (age >= 0 && age <= graceMs && !fired.has(reminder.key))
        due.push(reminder);
    }
  }
  return due.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Next upcoming reminder (for a "next reminder" hint). */
export function nextReminder(tasks: Task[], now: Date): DueReminder | null {
  let best: DueReminder | null = null;
  for (const task of tasks) {
    for (const reminder of reminderInstants(task)) {
      if (reminder.at > now && (!best || reminder.at < best.at))
        best = reminder;
    }
  }
  return best;
}
