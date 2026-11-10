export const DAILY_LOG_STORAGE_KEY = "steadier.daily-log.local.v1";
export const MAX_DAILY_LOG_ENTRIES = 5000;
export const MAX_DAILY_LOG_TEXT = 10_000;

export interface DailyLogEntry {
  id: string;
  date: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface DailyLogStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface DailyLogReadResult {
  ok: boolean;
  entries: DailyLogEntry[];
  error: string | null;
}

export interface DailyLogWriteResult {
  ok: boolean;
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day, 12);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

function validInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function parseEntries(value: unknown): DailyLogEntry[] {
  if (!isRecord(value))
    throw new Error("The saved Daily Log is not a valid record.");
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("version") ||
    !keys.includes("entries") ||
    value.version !== 1
  ) {
    throw new Error("The saved Daily Log has an unsupported format.");
  }
  if (
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_DAILY_LOG_ENTRIES
  ) {
    throw new Error("The saved Daily Log exceeds its safe entry limit.");
  }
  const ids = new Set<string>();
  return value.entries.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Daily Log entry ${index + 1} is malformed.`);
    }
    const expected = ["id", "date", "text", "createdAt", "updatedAt"];
    const actual = Object.keys(entry);
    if (
      actual.length !== expected.length ||
      actual.some(key => !expected.includes(key))
    ) {
      throw new Error(
        `Daily Log entry ${index + 1} has unknown or missing fields.`
      );
    }
    if (
      typeof entry.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entry.id) ||
      ids.has(entry.id)
    ) {
      throw new Error(
        `Daily Log entry ${index + 1} has an invalid or duplicate ID.`
      );
    }
    ids.add(entry.id);
    if (!validDate(entry.date)) {
      throw new Error(
        `Daily Log entry ${index + 1} has an invalid Adelaide-local date.`
      );
    }
    if (
      typeof entry.text !== "string" ||
      entry.text.trim().length === 0 ||
      entry.text.length > MAX_DAILY_LOG_TEXT
    ) {
      throw new Error(
        `Daily Log entry ${index + 1} has empty or over-limit text.`
      );
    }
    if (!validInstant(entry.createdAt) || !validInstant(entry.updatedAt)) {
      throw new Error(`Daily Log entry ${index + 1} has an invalid timestamp.`);
    }
    return {
      id: entry.id,
      date: entry.date,
      text: entry.text,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  });
}

export function readDailyLog(
  storage: DailyLogStorage | null
): DailyLogReadResult {
  if (!storage) {
    return {
      ok: false,
      entries: [],
      error:
        "This browser does not allow local storage, so the Daily Log is unavailable.",
    };
  }
  try {
    const raw = storage.getItem(DAILY_LOG_STORAGE_KEY);
    if (raw === null) return { ok: true, entries: [], error: null };
    return {
      ok: true,
      entries: parseEntries(JSON.parse(raw)),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      entries: [],
      error:
        error instanceof Error
          ? `Daily Log was not changed: ${error.message}`
          : "Daily Log could not be read. It has not been overwritten.",
    };
  }
}

export function writeDailyLog(
  storage: DailyLogStorage | null,
  entries: DailyLogEntry[]
): DailyLogWriteResult {
  if (!storage) {
    return {
      ok: false,
      error:
        "This browser does not allow local storage. The entry was not saved.",
    };
  }
  try {
    const validated = parseEntries({ version: 1, entries });
    storage.setItem(
      DAILY_LOG_STORAGE_KEY,
      JSON.stringify({ version: 1, entries: validated })
    );
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Daily Log was not saved: ${error.message}`
          : "Daily Log was not saved. Check browser storage and try again.",
    };
  }
}
