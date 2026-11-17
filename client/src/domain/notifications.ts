/**
 * Phone notifications (web push) that reach the owner when Steadier is
 * closed. Kept quiet on purpose: only a booked task's own reminders and
 * "leave by" for a place with a travel time. Nothing else, ever, by default:
 * no Needs attention, Upkeep or review nags (owner, 17 Nov).
 *
 * Shared by the app (settings) and the server (sending).
 */
import { reminderInstants } from "./reminders";
import { placesOf } from "./places";
import { adelaideToInstant, minutesToTime, timeToMinutes, formatTime } from "./time";
import type { NotificationSettings, Task, Workspace } from "./types";

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  taskReminders: true,
  leaveBy: true,
  quietHours: { on: true, from: "22:00", to: "07:00" },
};

/** Saved settings, or the defaults for anything not set. */
export function notificationSettings(workspace: Pick<Workspace, "notifications">): NotificationSettings {
  const saved = workspace.notifications;
  if (!saved) return DEFAULT_NOTIFICATION_SETTINGS;
  return {
    taskReminders: saved.taskReminders,
    leaveBy: saved.leaveBy,
    quietHours: { ...saved.quietHours },
  };
}

export function setNotificationSettings(workspace: Workspace, change: Partial<NotificationSettings>): Workspace {
  const current = notificationSettings(workspace);
  return {
    ...workspace,
    notifications: {
      ...current,
      ...change,
      quietHours: { ...current.quietHours, ...(change.quietHours ?? {}) },
    },
  };
}

/** Whether an Adelaide clock time ("HH:MM") falls in quiet hours. Overnight ranges wrap past midnight. */
export function inQuietHours(settings: NotificationSettings, clock: string): boolean {
  const q = settings.quietHours;
  if (!q.on || q.from === q.to) return false;
  const m = timeToMinutes(clock);
  const from = timeToMinutes(q.from);
  const to = timeToMinutes(q.to);
  return from < to ? m >= from && m < to : m >= from || m < to;
}

export type PushKind = "reminder" | "leave-by";

export interface PushMessage {
  /** Unique per reminder occurrence, so it's sent once. */
  key: string;
  kind: PushKind;
  at: Date;
  title: string;
  body: string;
}

/** "HH:MM" Adelaide wall-clock for an instant. */
function adelaideClockText(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Adelaide",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

/** Leave-by moments for booked, open tasks at a place with a travel time. */
export function leaveByInstants(workspace: Workspace, tasks: Task[] = workspace.tasks): PushMessage[] {
  const places = placesOf(workspace);
  const out: PushMessage[] = [];
  for (const task of tasks) {
    if (task.state === "done" || !task.placeId) continue;
    const s = task.schedule;
    if (!s.date || !s.time || s.flexibleWindow) continue;
    const place = places.find(p => p.id === task.placeId);
    if (!place?.travelMinutes) continue;
    const start = timeToMinutes(s.time);
    const leave = Math.max(0, start - place.travelMinutes);
    const at = adelaideToInstant(s.date, minutesToTime(leave));
    out.push({
      key: `leave:${task.id}:${s.date}:${s.time}:${place.travelMinutes}`,
      kind: "leave-by",
      at,
      title: `Leave by ${formatTime(minutesToTime(leave))}`,
      body: `${task.title} · ${place.name}, ${formatTime(s.time)}`,
    });
  }
  return out;
}

/**
 * What to send now: due in (now - graceMs, now], switched on, and outside
 * quiet hours. A reminder that falls in quiet hours is dropped, not held.
 */
export function pushesDue(workspace: Workspace, now: Date, graceMs = 10 * 60_000): PushMessage[] {
  const settings = notificationSettings(workspace);
  const candidates: PushMessage[] = [];
  if (settings.taskReminders) {
    for (const task of workspace.tasks)
      for (const r of reminderInstants(task))
        candidates.push({ key: `reminder:${r.key}`, kind: "reminder", at: r.at, title: r.title, body: r.body });
  }
  if (settings.leaveBy) candidates.push(...leaveByInstants(workspace));
  return candidates
    .filter(m => {
      const age = now.getTime() - m.at.getTime();
      return age >= 0 && age <= graceMs && !inQuietHours(settings, adelaideClockText(m.at));
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}
