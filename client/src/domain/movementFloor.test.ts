import { describe, expect, it } from "vitest";
import {
  adjustMovementCount,
  correctMovementCount,
  emptyMovementFloor,
  movementCountFor,
  movementHistory,
  readMovementFloor,
  withDailyFloor,
  writeMovementFloor,
  MOVE_FLOOR_STORAGE_KEY,
} from "./movementFloor";
import { shiftDays } from "./time";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

const today = "2026-10-30";
const instant = "2026-10-30T09:15:00+10:30";

describe("manual movement floor", () => {
  it("starts with no floor and an empty local history", () => {
    expect(readMovementFloor(storage(), today)).toEqual({
      ok: true,
      state: emptyMovementFloor(),
      error: null,
    });
  });

  it("adds and undoes a manually confirmed movement break without going below zero", () => {
    const added = adjustMovementCount(
      emptyMovementFloor(),
      today,
      1,
      instant,
      today
    );
    const undone = adjustMovementCount(added, today, -1, instant, today);
    const stillZero = adjustMovementCount(undone, today, -1, instant, today);
    expect(movementCountFor(added, today)).toBe(1);
    expect(movementCountFor(undone, today)).toBe(0);
    expect(stillZero.days).toEqual([]);
  });

  it("allows explicit correction and retains only the last 90 Adelaide-local dates when saved", () => {
    const oldest = shiftDays(today, -89);
    const expired = shiftDays(today, -90);
    const draft = {
      version: 1 as const,
      dailyFloor: 3,
      days: [
        { date: expired, count: 1, updatedAt: instant },
        { date: oldest, count: 2, updatedAt: instant },
        { date: today, count: 4, updatedAt: instant },
      ],
    };
    const local = storage({
      [MOVE_FLOOR_STORAGE_KEY]: JSON.stringify(draft),
    });
    const loaded = readMovementFloor(local, today);
    expect(loaded.ok).toBe(true);
    expect(loaded.state.days.map(item => item.date)).toEqual([oldest, today]);
    const saved = writeMovementFloor(local, loaded.state, today);
    expect(saved.ok).toBe(true);
    expect(saved.state?.days.map(item => item.date)).toEqual([oldest, today]);
    expect(saved.state?.dailyFloor).toBe(3);
    expect(local.values.has(MOVE_FLOOR_STORAGE_KEY)).toBe(true);
    expect(
      movementHistory(saved.state!, today, 2).map(item => item.count)
    ).toEqual([4, 0]);
    expect(
      correctMovementCount(saved.state!, today, 1, instant, today).days.at(-1)
        ?.count
    ).toBe(1);
  });

  it("rejects future dates, out-of-window corrections, invalid counts and floors", () => {
    expect(() =>
      adjustMovementCount(
        emptyMovementFloor(),
        shiftDays(today, 1),
        1,
        instant,
        today
      )
    ).toThrow();
    expect(() =>
      correctMovementCount(
        emptyMovementFloor(),
        shiftDays(today, -90),
        1,
        instant,
        today
      )
    ).toThrow();
    expect(() =>
      correctMovementCount(emptyMovementFloor(), today, 101, instant, today)
    ).toThrow();
    expect(() => withDailyFloor(emptyMovementFloor(), 21)).toThrow();
  });

  it("preserves malformed local data rather than overwriting it", () => {
    const local = storage({ [MOVE_FLOOR_STORAGE_KEY]: "{not json" });
    const read = readMovementFloor(local, today);
    expect(read.ok).toBe(false);
    expect(read.error).toMatch(/not changed/i);
    expect(writeMovementFloor(local, emptyMovementFloor(), today).ok).toBe(
      false
    );
    expect(local.values.get(MOVE_FLOOR_STORAGE_KEY)).toBe("{not json");
  });

  it("reports storage failures without claiming a save", () => {
    const failing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(readMovementFloor(failing, today).ok).toBe(true);
    expect(
      writeMovementFloor(failing, emptyMovementFloor(), today)
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("quota"),
    });
  });
});
