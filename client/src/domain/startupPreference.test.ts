import { describe, expect, it } from "vitest";
import { COMPASS_PUBLIC_ORIGIN } from "@shared/compassConnection";
import {
  SHARED_STARTUP_PREFERENCE_KEY,
  chooseStartupPolicy,
  parseStartupPreference,
  readStartupPreference,
  serializeStartupPreference,
  writeStartupPreference,
  type StartupPreferenceStorage,
} from "./startupPreference";

class MemoryStorage implements StartupPreferenceStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("shared startup preference", () => {
  it("uses shared only for an authenticated first visit on the canonical published origin", () => {
    expect(
      chooseStartupPolicy({
        preference: null,
        origin: COMPASS_PUBLIC_ORIGIN,
        sessionOwnerId: 42,
      })
    ).toEqual({ action: "shared", source: "published-default" });
    expect(
      chooseStartupPolicy({
        preference: null,
        origin: "http://localhost:5173",
        sessionOwnerId: 42,
      })
    ).toEqual({ action: "browser" });
  });

  it("keeps a fresh published startup guarded when authentication is unavailable", () => {
    expect(
      chooseStartupPolicy({
        preference: null,
        origin: COMPASS_PUBLIC_ORIGIN,
        sessionOwnerId: null,
      }).action
    ).toBe("blocked");
  });

  it("requires a freshly matching session owner for an explicit shared preference", () => {
    const preference = {
      version: 1 as const,
      mode: "shared" as const,
      userId: 42,
    };
    expect(
      chooseStartupPolicy({
        preference,
        origin: "http://localhost:5173",
        sessionOwnerId: 42,
      })
    ).toEqual({ action: "shared", source: "preference" });
    expect(
      chooseStartupPolicy({
        preference,
        origin: COMPASS_PUBLIC_ORIGIN,
        sessionOwnerId: 99,
      }).action
    ).toBe("blocked");
    expect(
      chooseStartupPolicy({
        preference,
        origin: COMPASS_PUBLIC_ORIGIN,
        sessionOwnerId: null,
      }).action
    ).toBe("blocked");
  });

  it("honours explicit browser and demo choices before published defaults", () => {
    expect(
      chooseStartupPolicy({
        preference: { version: 1, mode: "browser" },
        origin: COMPASS_PUBLIC_ORIGIN,
        sessionOwnerId: 42,
      })
    ).toEqual({ action: "browser" });
    expect(
      chooseStartupPolicy({
        preference: { version: 1, mode: "demo" },
        origin: COMPASS_PUBLIC_ORIGIN,
        sessionOwnerId: 42,
      })
    ).toEqual({ action: "demo" });
  });

  it("rejects malformed, credential-bearing, and unsafe owner values without modifying their bytes", () => {
    const malformed = [
      "not json",
      JSON.stringify({ version: 1, mode: "shared", userId: 0 }),
      JSON.stringify({ version: 1, mode: "shared", userId: 42, token: "nope" }),
      JSON.stringify({ version: 2, mode: "browser" }),
      JSON.stringify({ version: 1, mode: "unknown" }),
    ];
    for (const raw of malformed) expect(parseStartupPreference(raw)).toBeNull();

    const storage = new MemoryStorage();
    storage.setItem(SHARED_STARTUP_PREFERENCE_KEY, malformed[2]);
    expect(readStartupPreference(storage)).toBeNull();
    expect(storage.getItem(SHARED_STARTUP_PREFERENCE_KEY)).toBe(malformed[2]);
  });

  it("is harmless when storage is unavailable and serializes no credentials", () => {
    const unavailable: StartupPreferenceStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStartupPreference(unavailable)).toBeNull();
    expect(
      writeStartupPreference(unavailable, { version: 1, mode: "browser" })
    ).toBe(false);

    const serialized = serializeStartupPreference({
      version: 1,
      mode: "shared",
      userId: 42,
    });
    expect(JSON.parse(serialized)).toEqual({
      version: 1,
      mode: "shared",
      userId: 42,
    });
    expect(serialized).not.toMatch(/token|secret|session|credential/i);
  });
});
