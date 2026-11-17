import { describe, expect, it } from "vitest";
import { emptyWorkspace } from "../../../server/steadier/validation";
import { createTask } from "./engine";
import { adelaideToInstant, emptyTaskSchedule } from "./time";
import { validateWorkspace } from "./transfer";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  inQuietHours,
  leaveByInstants,
  notificationSettings,
  pushesDue,
  setNotificationSettings,
} from "./notifications";
import type { Task, Workspace } from "./types";

const DAY = "2026-11-18";

function booked(time: string, extra: Partial<Task> = {}, reminders = [{ id: "r1", anchor: "slot" as const, minutesBefore: 15 }]): Task {
  const t = createTask({ title: "Site meeting", state: "ready" } as Partial<Task> & { title: string });
  return { ...t, schedule: { ...emptyTaskSchedule(), date: DAY, time, minutes: 60, fixed: true, reminders }, ...extra } as Task;
}
function ws(tasks: Task[], extra: Partial<Workspace> = {}): Workspace {
  return { ...emptyWorkspace(), tasks, ...extra };
}
const place = { id: "pl", name: "Site", address: "", lat: -34.9, lng: 138.6, radius: 150, travelMinutes: 25 };

describe("phone notifications", () => {
  it("defaults to both kinds on with quiet hours 22:00–07:00", () => {
    expect(notificationSettings(ws([]))).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it("knows quiet hours, including ranges past midnight", () => {
    const s = DEFAULT_NOTIFICATION_SETTINGS;
    expect(inQuietHours(s, "23:30")).toBe(true);
    expect(inQuietHours(s, "06:59")).toBe(true);
    expect(inQuietHours(s, "07:00")).toBe(false);
    expect(inQuietHours(s, "12:00")).toBe(false);
    const day = { ...s, quietHours: { on: true, from: "12:00", to: "13:00" } };
    expect(inQuietHours(day, "12:30")).toBe(true);
    expect(inQuietHours({ ...s, quietHours: { ...s.quietHours, on: false } }, "23:30")).toBe(false);
  });

  it("sends a task's own reminder once it's due, and leave by for a place with a travel time", () => {
    const t = booked("11:00", { placeId: "pl" });
    const w = ws([t], { places: [place] });
    const at = (hhmm: string) => adelaideToInstant(DAY, hhmm);
    expect(pushesDue(w, at("10:30"))).toEqual([]);
    const leave = pushesDue(w, at("10:36"));
    expect(leave.map(m => m.kind)).toEqual(["leave-by"]);
    expect(leave[0].title).toMatch(/^Leave by 10:35\s?am$/);
    const reminder = pushesDue(w, at("10:46"));
    expect(reminder.map(m => m.kind)).toEqual(["reminder"]);
    // Past the 10-minute grace: not sent late.
    expect(pushesDue(w, at("11:20"))).toEqual([]);
  });

  it("sends nothing for a switched-off kind, a place with no travel time, or a done task", () => {
    const t = booked("11:00", { placeId: "pl" });
    const off = setNotificationSettings(ws([t], { places: [place] }), { leaveBy: false, taskReminders: false });
    expect(pushesDue(off, adelaideToInstant(DAY, "10:46"))).toEqual([]);
    expect(leaveByInstants(ws([t], { places: [{ ...place, travelMinutes: undefined }] }))).toEqual([]);
    expect(pushesDue(ws([{ ...t, state: "done" } as Task], { places: [place] }), adelaideToInstant(DAY, "10:46"))).toEqual([]);
  });

  it("drops a reminder that falls in quiet hours", () => {
    const t = booked("06:30");
    expect(pushesDue(ws([t]), adelaideToInstant(DAY, "06:16"))).toEqual([]);
  });

  it("saves and loads the settings with the workspace", () => {
    const w = setNotificationSettings(ws([]), { leaveBy: false, quietHours: { on: true, from: "21:30", to: "06:45" } });
    const loaded = validateWorkspace(JSON.parse(JSON.stringify(w)));
    expect(loaded.notifications).toEqual({ taskReminders: true, leaveBy: false, quietHours: { on: true, from: "21:30", to: "06:45" } });
    expect(() => validateWorkspace(JSON.parse(JSON.stringify({ ...w, notifications: { ...w.notifications, quietHours: { on: true, from: "25:00", to: "06:00" } } })))).toThrow();
  });
});
