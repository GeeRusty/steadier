import { DEFAULT_PLANNING } from "../../client/src/domain/time";
import { validateWorkspace } from "../../client/src/domain/transfer";
import type { Workspace } from "../../client/src/domain/types";
import type { CloudWrite } from "../../shared/cloud";

const MAX_WORKSPACE_BYTES = 5 * 1024 * 1024;
const MAX_REVISION = 2_147_483_646;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type JsonObject = Record<string, unknown>;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: JsonObject,
  required: readonly string[],
  optional: readonly string[],
  label: string
): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (
    required.some(key => !Object.prototype.hasOwnProperty.call(value, key)) ||
    keys.some(key => !allowed.has(key))
  ) {
    throw new ValidationError(`${label} has missing or unsupported fields.`);
  }
}

function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ValidationError(`${field} must be true or false.`);
  }
  return value;
}

function assertTimeZone(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) {
    throw new ValidationError("timeZone must be a valid IANA time zone.");
  }
  try {
    const normalized = new Intl.DateTimeFormat("en-US", {
      timeZone: value,
    }).resolvedOptions().timeZone;
    if (!normalized) throw new RangeError("No time zone was resolved.");
  } catch {
    throw new ValidationError("timeZone must be a valid IANA time zone.");
  }
  return value;
}

/**
 * The server accepts only version 2 documents. `validateWorkspace` performs the
 * complete exact-shape and relationship validation shared with the client.
 */
export function parseStrictV2Workspace(value: unknown): Workspace {
  if (!isObject(value) || value.version !== 2) {
    throw new ValidationError("workspace must be a strict version 2 document.");
  }

  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    throw new ValidationError("workspace must be JSON serializable.");
  }
  if (bytes > MAX_WORKSPACE_BYTES) {
    throw new ValidationError("workspace exceeds the 5 MB document limit.");
  }

  try {
    return validateWorkspace(value);
  } catch (error) {
    throw new ValidationError(
      error instanceof Error ? error.message : "workspace is invalid."
    );
  }
}

/** Parse the exact CloudWrite wire shape; unsupported fields fail closed. */
export function parseCloudWrite(value: unknown): CloudWrite {
  if (!isObject(value)) {
    throw new ValidationError("request body must be a JSON object.");
  }
  assertExactKeys(
    value,
    ["workspace", "baseRevision", "clientId"],
    ["timeZone", "claimFocus", "replacement"],
    "workspace write"
  );

  const baseRevision = value.baseRevision;
  if (
    typeof baseRevision !== "number" ||
    !Number.isSafeInteger(baseRevision) ||
    baseRevision < 0 ||
    baseRevision > MAX_REVISION
  ) {
    throw new ValidationError("baseRevision must be a non-negative integer.");
  }

  const clientId = value.clientId;
  if (typeof clientId !== "string" || !CLIENT_ID_PATTERN.test(clientId)) {
    throw new ValidationError(
      "clientId must be a portable identifier up to 128 characters."
    );
  }

  const result: CloudWrite = {
    workspace: parseStrictV2Workspace(value.workspace),
    baseRevision,
    clientId,
  };
  if (Object.prototype.hasOwnProperty.call(value, "timeZone")) {
    result.timeZone = assertTimeZone(value.timeZone);
  }
  if (Object.prototype.hasOwnProperty.call(value, "claimFocus")) {
    result.claimFocus = assertBoolean(value.claimFocus, "claimFocus");
  }
  if (Object.prototype.hasOwnProperty.call(value, "replacement")) {
    result.replacement = assertBoolean(value.replacement, "replacement");
  }
  return result;
}

export function assertCompassLabel(value: unknown): string {
  if (value === undefined) return "Compass";
  if (typeof value !== "string") {
    throw new ValidationError("label must be a string.");
  }
  const label = value.trim();
  if (!label || label.length > 100) {
    throw new ValidationError("label must be between 1 and 100 characters.");
  }
  return label;
}

/** A valid empty v2 document, returned only until the first server write. */
export function emptyWorkspace(): Workspace {
  return {
    version: 2,
    tasks: [],
    projects: [],
    focus: null,
    intention: null,
    matrixWeights: {
      "direction-timely": 1,
      "direction-sustained": 1,
      "support-timely": 1,
      "support-sustained": 1,
    },
    trial: {
      // This sentinel is never saved until the user deliberately writes a workspace.
      startedAt: "1970-01-01T00:00:00.000Z",
      lastExportAt: null,
      lastReviewAt: null,
    },
    planning: { ...DEFAULT_PLANNING },
    imperatives: [],
    reviews: [],
    goals: [],
  };
}

export function isSameFocus(
  left: Workspace["focus"],
  right: Workspace["focus"]
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
