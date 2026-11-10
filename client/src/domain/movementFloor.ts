import { isDate, shiftDays } from "./time";

export const MOVE_FLOOR_STORAGE_KEY = "steadier.move-floor.local.v1";
export const MOVE_HISTORY_DAYS = 90;
const MAX_READ_MOVEMENT_DAYS = 1000;
export const MAX_DAILY_MOVEMENT_BREAKS = 100;
export const MAX_DAILY_FLOOR = 20;

export interface MovementDay {
  date: string;
  count: number;
  updatedAt: string;
}

export interface MovementFloorState {
  version: 1;
  dailyFloor: number | null;
  days: MovementDay[];
}

export interface MovementStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface MovementReadResult {
  ok: boolean;
  state: MovementFloorState;
  error: string | null;
}

export interface MovementWriteResult {
  ok: boolean;
  state: MovementFloorState | null;
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function emptyMovementFloor(): MovementFloorState {
  return { version: 1, dailyFloor: null, days: [] };
}

function parseState(value: unknown, today: string): MovementFloorState {
  if (!isRecord(value)) throw new Error("Saved movement data is not a record.");
  const keys = Object.keys(value);
  if (
    keys.length !== 3 ||
    !keys.includes("version") ||
    !keys.includes("dailyFloor") ||
    !keys.includes("days") ||
    value.version !== 1
  ) {
    throw new Error("Saved movement data has an unsupported format.");
  }
  const floor = value.dailyFloor;
  if (
    floor !== null &&
    (!Number.isInteger(floor) ||
      (floor as number) < 1 ||
      (floor as number) > MAX_DAILY_FLOOR)
  ) {
    throw new Error(
      `The personal daily floor must be between 1 and ${MAX_DAILY_FLOOR}, or unset.`
    );
  }
  if (
    !Array.isArray(value.days) ||
    value.days.length > MAX_READ_MOVEMENT_DAYS
  ) {
    throw new Error("Saved movement history exceeds the safe read limit.");
  }
  const ids = new Set<string>();
  const oldest = shiftDays(today, -(MOVE_HISTORY_DAYS - 1));
  const days = value.days.map((item, index): MovementDay => {
    if (!isRecord(item))
      throw new Error(`Movement day ${index + 1} is malformed.`);
    const expected = ["date", "count", "updatedAt"];
    const actual = Object.keys(item);
    if (
      actual.length !== expected.length ||
      actual.some(key => !expected.includes(key))
    ) {
      throw new Error(
        `Movement day ${index + 1} has unknown or missing fields.`
      );
    }
    if (
      typeof item.date !== "string" ||
      !isDate(item.date) ||
      item.date > today ||
      ids.has(item.date)
    ) {
      throw new Error(
        `Movement day ${index + 1} has an invalid or duplicate Adelaide date.`
      );
    }
    ids.add(item.date);
    if (
      !Number.isInteger(item.count) ||
      (item.count as number) < 0 ||
      (item.count as number) > MAX_DAILY_MOVEMENT_BREAKS
    ) {
      throw new Error(
        `Movement day ${index + 1} has a count outside the safe limit.`
      );
    }
    if (!validInstant(item.updatedAt)) {
      throw new Error(`Movement day ${index + 1} has an invalid timestamp.`);
    }
    return {
      date: item.date,
      count: item.count as number,
      updatedAt: item.updatedAt,
    };
  });
  return {
    version: 1,
    dailyFloor: floor as number | null,
    days: days
      .filter(item => item.date >= oldest)
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function readMovementFloor(
  storage: MovementStorage | null,
  today: string
): MovementReadResult {
  if (!isDate(today)) {
    return {
      ok: false,
      state: emptyMovementFloor(),
      error: "Today's Adelaide date is invalid.",
    };
  }
  if (!storage) {
    return {
      ok: false,
      state: emptyMovementFloor(),
      error:
        "This browser does not allow local storage; the Move Counter is unavailable.",
    };
  }
  try {
    const raw = storage.getItem(MOVE_FLOOR_STORAGE_KEY);
    if (raw === null)
      return { ok: true, state: emptyMovementFloor(), error: null };
    return { ok: true, state: parseState(JSON.parse(raw), today), error: null };
  } catch (error) {
    return {
      ok: false,
      state: emptyMovementFloor(),
      error:
        error instanceof Error
          ? `Movement data was not changed: ${error.message}`
          : "Movement data could not be read and has not been overwritten.",
    };
  }
}

export function writeMovementFloor(
  storage: MovementStorage | null,
  state: MovementFloorState,
  today: string
): MovementWriteResult {
  if (!storage) {
    return {
      ok: false,
      state: null,
      error: "Local storage is unavailable; movement data was not saved.",
    };
  }
  try {
    const existing = readMovementFloor(storage, today);
    if (!existing.ok) {
      return {
        ok: false,
        state: null,
        error: `Movement data was not saved because existing local data is unavailable: ${existing.error ?? "read failed"}`,
      };
    }
    const validated = parseState(state, today);
    storage.setItem(MOVE_FLOOR_STORAGE_KEY, JSON.stringify(validated));
    return { ok: true, state: validated, error: null };
  } catch (error) {
    return {
      ok: false,
      state: null,
      error:
        error instanceof Error
          ? `Movement data was not saved: ${error.message}`
          : "Movement data was not saved. Check browser storage and try again.",
    };
  }
}

export function movementCountFor(
  state: MovementFloorState,
  date: string
): number {
  return state.days.find(item => item.date === date)?.count ?? 0;
}

export function movementHistory(
  state: MovementFloorState,
  today: string,
  days = 7
): MovementDay[] {
  const count = Math.max(1, Math.min(MOVE_HISTORY_DAYS, Math.floor(days)));
  return Array.from({ length: count }, (_, index) => {
    const date = shiftDays(today, -index);
    const saved = state.days.find(item => item.date === date);
    return saved ?? { date, count: 0, updatedAt: "" };
  });
}

function assertCountDate(date: string, today: string): void {
  const oldest = shiftDays(today, -(MOVE_HISTORY_DAYS - 1));
  if (!isDate(date) || date < oldest || date > today) {
    throw new Error(
      "Movement counts can only be edited within the last 90 Adelaide-local days."
    );
  }
}

export function correctMovementCount(
  state: MovementFloorState,
  date: string,
  count: number,
  updatedAt: string,
  today: string
): MovementFloorState {
  assertCountDate(date, today);
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    count > MAX_DAILY_MOVEMENT_BREAKS ||
    !validInstant(updatedAt)
  ) {
    throw new Error(
      `Count must be a whole number from 0 to ${MAX_DAILY_MOVEMENT_BREAKS}.`
    );
  }
  const days = state.days.filter(item => item.date !== date);
  if (count > 0) days.push({ date, count, updatedAt });
  return {
    ...state,
    days: days.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function adjustMovementCount(
  state: MovementFloorState,
  date: string,
  delta: -1 | 1,
  updatedAt: string,
  today: string
): MovementFloorState {
  assertCountDate(date, today);
  const next = movementCountFor(state, date) + delta;
  return correctMovementCount(
    state,
    date,
    Math.max(0, Math.min(MAX_DAILY_MOVEMENT_BREAKS, next)),
    updatedAt,
    today
  );
}

export function withDailyFloor(
  state: MovementFloorState,
  floor: number | null
): MovementFloorState {
  if (
    floor !== null &&
    (!Number.isInteger(floor) || floor < 1 || floor > MAX_DAILY_FLOOR)
  ) {
    throw new Error(
      `Set the personal floor to 1–${MAX_DAILY_FLOOR}, or leave it unset.`
    );
  }
  return { ...state, dailyFloor: floor };
}
