import { describe, expect, it } from "vitest";
import {
  ENERGY_WINDOWS_STORAGE_KEY,
  readEnergyWindows,
  removeEnergyWindow,
  saveEnergyWindow,
  validateEnergyWindows,
  writeEnergyWindows,
  type EnergyWindow,
} from "./energyWindows";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

const monday: EnergyWindow = {
  id: "window-1",
  weekday: 1,
  startTime: "09:00",
  endTime: "11:00",
  band: "deep",
};

describe("owner-authored energy planning windows", () => {
  it("creates, sorts, edits and removes explicit planning windows", () => {
    const afternoon = saveEnergyWindow(
      [],
      {
        ...monday,
        id: "window-2",
        startTime: "13:00",
        endTime: "15:00",
        band: "steady",
      },
      null
    );
    const both = saveEnergyWindow(afternoon, monday, null);
    expect(both.map(window => window.id)).toEqual(["window-1", "window-2"]);
    const edited = saveEnergyWindow(
      both,
      { ...monday, endTime: "10:30", band: "light" },
      "window-1"
    );
    expect(edited[0]).toMatchObject({
      id: "window-1",
      endTime: "10:30",
      band: "light",
    });
    expect(removeEnergyWindow(edited, "window-1")).toHaveLength(1);
  });

  it("rejects overlapping windows, invalid time order and duplicate identities", () => {
    const existing = [monday];
    expect(() =>
      saveEnergyWindow(
        existing,
        {
          ...monday,
          id: "window-2",
          startTime: "10:30",
          endTime: "12:00",
        },
        null
      )
    ).toThrow(/overlap/i);
    expect(() =>
      saveEnergyWindow(
        existing,
        {
          ...monday,
          id: "window-2",
          startTime: "12:00",
          endTime: "11:00",
        },
        null
      )
    ).toThrow(/start before its end/i);
    expect(() => saveEnergyWindow(existing, monday, null)).toThrow(
      /already in use/i
    );
  });

  it("strictly validates and round-trips local windows", () => {
    const local = storage();
    const saved = writeEnergyWindows(local, [monday]);
    expect(saved).toMatchObject({ ok: true, windows: [monday] });
    expect(local.values.has(ENERGY_WINDOWS_STORAGE_KEY)).toBe(true);
    expect(readEnergyWindows(local)).toMatchObject({
      ok: true,
      windows: [monday],
    });
    expect(() =>
      validateEnergyWindows({
        version: 1,
        windows: [{ ...monday, password: "x" }],
      })
    ).toThrow(/unknown or missing/i);
  });

  it("preserves malformed data and reports unavailable storage", () => {
    const local = storage({ [ENERGY_WINDOWS_STORAGE_KEY]: "not json" });
    expect(readEnergyWindows(local).ok).toBe(false);
    expect(writeEnergyWindows(local, []).ok).toBe(false);
    expect(local.values.get(ENERGY_WINDOWS_STORAGE_KEY)).toBe("not json");
    expect(readEnergyWindows(null).error).toMatch(/local storage/i);
  });
});
