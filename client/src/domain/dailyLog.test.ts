import { describe, expect, it, vi } from "vitest";
import {
  DAILY_LOG_STORAGE_KEY,
  MAX_DAILY_LOG_TEXT,
  readDailyLog,
  writeDailyLog,
  type DailyLogEntry,
  type DailyLogStorage,
} from "./dailyLog";

const entry: DailyLogEntry = {
  id: "entry-1",
  date: "2026-10-30",
  text: "Synthetic note text.",
  createdAt: "2026-10-30T12:00:00+10:30",
  updatedAt: "2026-10-30T12:00:00+10:30",
};

function memoryStorage(raw: string | null = null): DailyLogStorage & {
  value: string | null;
  setItem: ReturnType<typeof vi.fn>;
} {
  const storage = {
    value: raw,
    getItem: vi.fn(() => storage.value),
    setItem: vi.fn((_key: string, value: string) => {
      storage.value = value;
    }),
  };
  return storage;
}

describe("device-local Daily Log", () => {
  it("starts empty without writing to storage", () => {
    const storage = memoryStorage();
    expect(readDailyLog(storage)).toEqual({
      ok: true,
      entries: [],
      error: null,
    });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("round-trips valid bounded entries only under its dedicated local key", () => {
    const storage = memoryStorage();
    expect(writeDailyLog(storage, [entry])).toEqual({ ok: true, error: null });
    expect(storage.setItem).toHaveBeenCalledWith(
      DAILY_LOG_STORAGE_KEY,
      JSON.stringify({ version: 1, entries: [entry] })
    );
    expect(readDailyLog(storage)).toEqual({
      ok: true,
      entries: [entry],
      error: null,
    });
  });

  it("does not overwrite malformed existing local data", () => {
    const storage = memoryStorage("{not-json");
    const result = readDailyLog(storage);
    expect(result.ok).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.error).toContain("not changed");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each([
    { ...entry, date: "2026-02-30" },
    { ...entry, text: "  " },
    { ...entry, text: "x".repeat(MAX_DAILY_LOG_TEXT + 1) },
    { ...entry, id: "bad id" },
    { ...entry, createdAt: "not-a-time" },
    { ...entry, unknown: "field" },
  ])("rejects malformed entries without writing", invalid => {
    const storage = memoryStorage();
    const result = writeDailyLog(storage, [invalid as DailyLogEntry]);
    expect(result.ok).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("rejects duplicate IDs and unsupported top-level fields", () => {
    const storage = memoryStorage(
      JSON.stringify({ version: 1, entries: [entry, entry] })
    );
    expect(readDailyLog(storage).ok).toBe(false);
    const extraField = memoryStorage(
      JSON.stringify({ version: 1, entries: [entry], synced: true })
    );
    expect(readDailyLog(extraField).ok).toBe(false);
  });

  it("reports unavailable or quota-blocked storage without claiming a save", () => {
    expect(writeDailyLog(null, [entry]).ok).toBe(false);
    const blocked: DailyLogStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    const result = writeDailyLog(blocked, [entry]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("quota exceeded");
  });
});
