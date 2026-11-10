import { COMPASS_PUBLIC_ORIGIN } from "@shared/compassConnection";

/** A deliberately separate key; existing local workspaces and cloud caches are never read or rewritten here. */
export const SHARED_STARTUP_PREFERENCE_KEY = "steadier.startup.v1";

export type StartupPreference =
  | { version: 1; mode: "shared"; userId: number }
  | { version: 1; mode: "browser" }
  | { version: 1; mode: "demo" };

export interface StartupPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type StartupPolicy =
  | { action: "shared"; source: "preference" | "published-default" }
  | { action: "browser" }
  | { action: "demo" }
  | { action: "blocked"; notice: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function validOwnerId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Accept only the exact versioned shapes below. In particular, this document has
 * no place for sessions, tokens, names, or arbitrary future fields.
 */
export function parseStartupPreference(
  raw: string | null
): StartupPreference | null {
  if (!raw || raw.length > 200) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      typeof value.mode !== "string"
    ) {
      return null;
    }
    if (
      value.mode === "shared" &&
      validOwnerId(value.userId) &&
      hasOnlyKeys(value, ["version", "mode", "userId"])
    ) {
      return { version: 1, mode: "shared", userId: value.userId };
    }
    if (
      (value.mode === "browser" || value.mode === "demo") &&
      hasOnlyKeys(value, ["version", "mode"])
    ) {
      return { version: 1, mode: value.mode };
    }
  } catch {
    // Existing malformed bytes are intentionally left untouched.
  }
  return null;
}

export function serializeStartupPreference(
  preference: StartupPreference
): string {
  return JSON.stringify(preference);
}

/** Storage failure is deliberately indistinguishable from no preference to callers. */
export function readStartupPreference(
  storage: StartupPreferenceStorage | null | undefined
): StartupPreference | null {
  if (!storage) return null;
  try {
    return parseStartupPreference(
      storage.getItem(SHARED_STARTUP_PREFERENCE_KEY)
    );
  } catch {
    return null;
  }
}

/** Returns false rather than touching any other browser key when storage is unavailable. */
export function writeStartupPreference(
  storage: StartupPreferenceStorage | null | undefined,
  preference: StartupPreference
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      SHARED_STARTUP_PREFERENCE_KEY,
      serializeStartupPreference(preference)
    );
    return true;
  } catch {
    return false;
  }
}

export function isCanonicalPublishedOrigin(
  origin: string | null | undefined
): boolean {
  return origin === COMPASS_PUBLIC_ORIGIN;
}

/**
 * This policy chooses only a startup route. A stored owner ID is never treated
 * as authentication: the hook still performs a fresh session and workspace GET.
 */
export function chooseStartupPolicy(input: {
  preference: StartupPreference | null;
  origin: string | null | undefined;
  sessionOwnerId: number | null;
}): StartupPolicy {
  const { preference, origin, sessionOwnerId } = input;
  if (preference?.mode === "browser") return { action: "browser" };
  if (preference?.mode === "demo") return { action: "demo" };
  if (preference?.mode === "shared") {
    if (!validOwnerId(sessionOwnerId)) {
      return {
        action: "blocked",
        notice:
          "Your selected shared personal space needs a current Manus sign-in before it can be opened.",
      };
    }
    if (sessionOwnerId !== preference.userId) {
      return {
        action: "blocked",
        notice:
          "This browser selected a shared personal space for a different account. Connect deliberately for the current account, or use this browser or sample space instead.",
      };
    }
    return { action: "shared", source: "preference" };
  }
  if (isCanonicalPublishedOrigin(origin)) {
    if (validOwnerId(sessionOwnerId)) {
      return { action: "shared", source: "published-default" };
    }
    return {
      action: "blocked",
      notice:
        "Sign in with Manus to open your shared personal space, or deliberately choose the original browser space or sample lab.",
    };
  }
  return { action: "browser" };
}
