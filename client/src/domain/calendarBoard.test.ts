import { describe, expect, it } from "vitest";
import type { CalendarDay, CalendarItem } from "./calendarModel";
import { boardRows } from "./calendarBoard";

const DAY = "2026-11-13";
const item = (id: string, start: number, minutes: number, extra: Partial<CalendarItem> = {}): CalendarItem => ({
  id,
  kind: "slot",
  date: DAY,
  title: id,
  start,
  minutes,
  fixed: true,
  ...extra,
});
const day = (timed: CalendarItem[]): CalendarDay => ({ date: DAY, timed, allDay: [], dateMarkers: [], falldue: [], actual: [] });
const ws = { imperatives: [], projects: [] };

describe("Calendar Board", () => {
  it("one line per booking, by time; status only when off normal", () => {
    const rows = boardRows(
      day([item("b", 13 * 60, 60), item("a", 9 * 60, 60), item("gym", 7 * 60, 30, { done: true }), item("rego", 17 * 60, 0, { kind: "deadline" })]),
      [],
      ws,
      DAY,
      12 * 60
    );
    expect(rows.map(r => [r.timeText, r.title, r.status])).toEqual([
      ["7:00", "gym", "Done"],
      ["9:00", "a", "Slipped"],
      ["1:00", "b", null],
      ["5:00", "rego", "Due"],
    ]);
  });

  it("shows Now during a booking that's on time", () => {
    const rows = boardRows(day([item("a", 9 * 60, 60)]), [], ws, DAY, 9 * 60 + 20);
    expect(rows[0].status).toBe("Now");
    expect(rows[0].red).toBe(false);
  });

  it("other days show only Done and Due", () => {
    const rows = boardRows(day([item("a", 9 * 60, 60)]), [], ws, "2026-11-12", 23 * 60);
    expect(rows[0].status).toBeNull();
  });
});
