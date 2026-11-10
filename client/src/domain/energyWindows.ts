import { isTime, timeToMinutes } from "./time";

export const ENERGY_WINDOWS_STORAGE_KEY = "steadier.energy-windows.local.v1";
export const MAX_ENERGY_WINDOWS = 21;
export type EnergyBand = "light" | "steady" | "deep";

export interface EnergyWindow {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  band: EnergyBand;
}

export interface EnergyWindowStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface EnergyWindowReadResult {
  ok: boolean;
  windows: EnergyWindow[];
  error: string | null;
}

export interface EnergyWindowWriteResult {
  ok: boolean;
  windows: EnergyWindow[] | null;
  error: string | null;
}

const BANDS: EnergyBand[] = ["light", "steady", "deep"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateEnergyWindows(value: unknown): EnergyWindow[] {
  if (!isRecord(value)) throw new Error("Energy-window data is not a record.");
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("version") ||
    !keys.includes("windows") ||
    value.version !== 1
  ) {
    throw new Error("Energy-window data has an unsupported format.");
  }
  if (
    !Array.isArray(value.windows) ||
    value.windows.length > MAX_ENERGY_WINDOWS
  ) {
    throw new Error(
      `Keep no more than ${MAX_ENERGY_WINDOWS} weekly planning windows.`
    );
  }
  const ids = new Set<string>();
  const windows = value.windows.map((item, index): EnergyWindow => {
    if (!isRecord(item))
      throw new Error(`Planning window ${index + 1} is malformed.`);
    const expected = ["id", "weekday", "startTime", "endTime", "band"];
    const actual = Object.keys(item);
    if (
      actual.length !== expected.length ||
      actual.some(key => !expected.includes(key))
    ) {
      throw new Error(
        `Planning window ${index + 1} has unknown or missing fields.`
      );
    }
    if (
      typeof item.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(item.id) ||
      ids.has(item.id)
    ) {
      throw new Error(
        `Planning window ${index + 1} has an invalid or duplicate ID.`
      );
    }
    ids.add(item.id);
    if (
      !Number.isInteger(item.weekday) ||
      (item.weekday as number) < 0 ||
      (item.weekday as number) > 6
    ) {
      throw new Error(`Planning window ${index + 1} has an invalid weekday.`);
    }
    if (
      !isTime(item.startTime) ||
      !isTime(item.endTime) ||
      timeToMinutes(item.startTime) >= timeToMinutes(item.endTime)
    ) {
      throw new Error(
        `Planning window ${index + 1} must have a valid start before its end.`
      );
    }
    if (
      typeof item.band !== "string" ||
      !BANDS.includes(item.band as EnergyBand)
    ) {
      throw new Error(
        `Planning window ${index + 1} has an unsupported owner-chosen label.`
      );
    }
    return {
      id: item.id,
      weekday: item.weekday as number,
      startTime: item.startTime,
      endTime: item.endTime,
      band: item.band as EnergyBand,
    };
  });
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      if (overlaps(windows[i], windows[j])) {
        throw new Error("Planning windows on the same weekday cannot overlap.");
      }
    }
  }
  return windows.sort(
    (a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)
  );
}

function overlaps(a: EnergyWindow, b: EnergyWindow): boolean {
  return (
    a.weekday === b.weekday &&
    timeToMinutes(a.startTime) < timeToMinutes(b.endTime) &&
    timeToMinutes(a.endTime) > timeToMinutes(b.startTime)
  );
}

export function readEnergyWindows(
  storage: EnergyWindowStorage | null
): EnergyWindowReadResult {
  if (!storage) {
    return {
      ok: false,
      windows: [],
      error:
        "This browser does not allow local storage; planning windows are unavailable.",
    };
  }
  try {
    const raw = storage.getItem(ENERGY_WINDOWS_STORAGE_KEY);
    if (raw === null) return { ok: true, windows: [], error: null };
    return {
      ok: true,
      windows: validateEnergyWindows(JSON.parse(raw)),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      windows: [],
      error:
        error instanceof Error
          ? `Planning-window data was not changed: ${error.message}`
          : "Planning-window data could not be read and has not been overwritten.",
    };
  }
}

export function writeEnergyWindows(
  storage: EnergyWindowStorage | null,
  windows: EnergyWindow[]
): EnergyWindowWriteResult {
  if (!storage) {
    return {
      ok: false,
      windows: null,
      error: "Local storage is unavailable; planning windows were not saved.",
    };
  }
  try {
    const existing = readEnergyWindows(storage);
    if (!existing.ok) {
      return {
        ok: false,
        windows: null,
        error: `Planning windows were not saved because existing local data is unavailable: ${existing.error ?? "read failed"}`,
      };
    }
    const validated = validateEnergyWindows({ version: 1, windows });
    storage.setItem(
      ENERGY_WINDOWS_STORAGE_KEY,
      JSON.stringify({ version: 1, windows: validated })
    );
    return { ok: true, windows: validated, error: null };
  } catch (error) {
    return {
      ok: false,
      windows: null,
      error:
        error instanceof Error
          ? `Planning windows were not saved: ${error.message}`
          : "Planning windows were not saved. Check browser storage and try again.",
    };
  }
}

export function saveEnergyWindow(
  current: EnergyWindow[],
  proposed: EnergyWindow,
  editingId: string | null
): EnergyWindow[] {
  const target = validateEnergyWindows({ version: 1, windows: [proposed] })[0];
  if (editingId && !current.some(window => window.id === editingId)) {
    throw new Error(
      "That planning window no longer exists. Refresh and try again."
    );
  }
  if (editingId && target.id !== editingId) {
    throw new Error("A planning-window edit must keep its saved identity.");
  }
  if (!editingId && current.some(window => window.id === target.id)) {
    throw new Error("That planning-window ID is already in use.");
  }
  const withoutCurrent = editingId
    ? current.filter(window => window.id !== editingId)
    : current;
  if (!editingId && withoutCurrent.length >= MAX_ENERGY_WINDOWS) {
    throw new Error(
      `Keep no more than ${MAX_ENERGY_WINDOWS} weekly planning windows.`
    );
  }
  if (withoutCurrent.some(window => overlaps(window, target))) {
    throw new Error("That time overlaps another window on the same weekday.");
  }
  return validateEnergyWindows({
    version: 1,
    windows: [...withoutCurrent, target],
  });
}

export function removeEnergyWindow(
  current: EnergyWindow[],
  id: string
): EnergyWindow[] {
  return current.filter(window => window.id !== id);
}
