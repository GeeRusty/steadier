import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stampOwnerPlacement } from "../domain/orphans";
import { adelaideTimestamp } from "../../../shared/time";
import { STEADIER_TIME_ZONE } from "../../../shared/time";
import type { CloudRecord, CloudStatus, CloudUser } from "@shared/cloud";
import {
  acknowledgeCloudWrite,
  cloudCacheKey,
  createCloudCache,
  hasRemoteRunningFocus,
  isAccountGuardFailure,
  isCurrentGeneration,
  markCloudCacheSynced,
  makeCloudWrite,
  reconcileFetchedCloudRecord,
  reconcileUncertainCloudWrite,
  sameWorkspace,
  validateCloudCache,
  validateCloudRecoveries,
  validateCloudRecord,
  validateCloudSession,
  visibleCloudWorkspace,
  withCloudRecovery,
  type CloudCache,
  type CloudPending,
} from "../domain/cloudSync";
import {
  legacyWorkspaceKey,
  workspaceKey,
  type RecoveryCopy,
  type WorkspaceKind,
} from "../domain/storage";
import {
  chooseStartupPolicy,
  isCanonicalPublishedOrigin,
  readStartupPreference,
  writeStartupPreference,
  type StartupPreferenceStorage,
} from "../domain/startupPreference";
import { validateWorkspace } from "../domain/transfer";
import type { FocusSession, Scenario, Workspace } from "../domain/types";
import { privateOwnerRequest, privateRequest } from "../lib/cloudApi";
import { useWorkspace } from "./useWorkspace";

const SESSION_PATH = "/api/steadier/session";
const WORKSPACE_PATH = "/api/steadier/workspace";
const RECOVERIES_PATH = "/api/steadier/recoveries";
const NORMAL_WRITE_DEBOUNCE_MS = 750;
const FOCUS_WRITE_DEBOUNCE_MS = 30_000;
const POLL_MS = 15_000;

type Runtime = {
  user: CloudUser | null;
  checking: boolean;
  /** A requested shared opening has not yet been safely resolved or escaped. */
  startupBlocked: boolean;
  startupNotice: string;
  /** The user expressly chose shared personal data in this tab. */
  selected: boolean;
  status: CloudStatus;
  error: string;
  cache: CloudCache | null;
  conflict: CloudRecord | null;
  serverRecoveryCopies: RecoveryCopy[];
};

type QueueOptions = {
  claimFocus?: boolean;
  replacement?: boolean;
  snapshot?: boolean;
  forceSnapshot?: boolean;
  delay?: number;
};

type OriginalPersonal = {
  workspace: Workspace | null;
  protected: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function recoveryId(): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return `cloud-recovery-${crypto.randomUUID()}`;
    }
  } catch {
    // A time/random fallback is still only an opaque local recovery identifier.
  }
  return `cloud-recovery-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

function clientId(): string {
  const key = "steadier.cloud.client.v1";
  try {
    const existing = sessionStorage.getItem(key);
    if (existing && existing.length <= 200) return existing;
    const created =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? `steadier-${crypto.randomUUID()}`
        : `steadier-${Date.now().toString(36)}-${Math.random()
            .toString(36)
            .slice(2, 14)}`;
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    // Session storage can be unavailable in a locked-down embedded browser.
    // Keep a tab-local ID for this mounted instance rather than using identity.
    return `steadier-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 14)}`;
  }
}

function browserTimeZone(): string {
  // Steadier's calendar is always Adelaide's, even if this device reports UTC.
  return STEADIER_TIME_ZONE;
}

function writeTimeZone(server: CloudRecord): string {
  // The empty server placeholder is UTC, not a saved user preference. The
  // first actual browser save must establish the browser's real timezone.
  return server.revision === 0 && server.updatedAt === null
    ? browserTimeZone()
    : server.timeZone;
}

function visibleDocument(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState === "visible"
  );
}

function browserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

function startupStorage(): StartupPreferenceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function startupOrigin(): string | null {
  try {
    return typeof window === "undefined" ? null : window.location.origin;
  } catch {
    return null;
  }
}

function isCompassConsentPage(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("compass_oauth")
    );
  } catch {
    return false;
  }
}

function responseMessage(status: number, value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "string") return record.error;
  }
  if (status === 401 || status === 403) {
    return "Sign in to access your shared records.";
  }
  return "The private server could not confirm that change. Retry when connected.";
}

async function responseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

class CloudResponseError extends Error {
  constructor(
    readonly status: number,
    readonly value: unknown
  ) {
    super(responseMessage(status, value));
  }
}

function isAccountGuardError(error: unknown): boolean {
  return (
    error instanceof CloudResponseError &&
    isAccountGuardFailure(error.status, error.value)
  );
}

function sameFocus(
  left: FocusSession | null,
  right: FocusSession | null
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function getSession(): Promise<CloudUser> {
  const response = await privateRequest(SESSION_PATH);
  const value = await responseJson(response);
  if (!response.ok) throw new Error(responseMessage(response.status, value));
  return validateCloudSession(value).user;
}

async function getServerWorkspace(owner: number): Promise<CloudRecord> {
  const response = await privateOwnerRequest(owner, WORKSPACE_PATH);
  const value = await responseJson(response);
  if (!response.ok) throw new CloudResponseError(response.status, value);
  return validateCloudRecord(value);
}

async function getServerRecoveries(owner: number): Promise<RecoveryCopy[]> {
  const response = await privateOwnerRequest(owner, RECOVERIES_PATH);
  const value = await responseJson(response);
  if (!response.ok) throw new CloudResponseError(response.status, value);
  return validateCloudRecoveries(value);
}

function isLikelyNetworkError(error: unknown): boolean {
  return !browserOnline() || error instanceof TypeError;
}

function parseConflict(value: unknown): CloudRecord {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !(
      (value as Record<string, unknown>).code === "CONFLICT" ||
      (value as Record<string, unknown>).code === "FOCUS_OWNERSHIP"
    )
  ) {
    throw new Error("The server returned an invalid conflict response.");
  }
  return validateCloudRecord((value as Record<string, unknown>).record);
}

function readCache(user: CloudUser): {
  cache: CloudCache | null;
  error: string;
} {
  try {
    const raw = localStorage.getItem(cloudCacheKey(user.id));
    if (raw === null) return { cache: null, error: "" };
    return { cache: validateCloudCache(JSON.parse(raw), user.id), error: "" };
  } catch {
    // Do not overwrite bytes that could contain the only recoverable pending copy.
    return {
      cache: null,
      error:
        "The account-scoped shared-data recovery cache could not be read. It was not overwritten; export or clear it only after checking its contents.",
    };
  }
}

function writeCache(cache: CloudCache): string | null {
  try {
    localStorage.setItem(cloudCacheKey(cache.userId), JSON.stringify(cache));
    return null;
  } catch {
    return "Shared changes could not be kept in this browser recovery cache. Nothing further was sent; free browser storage or download a backup before retrying.";
  }
}

/** Read only original local-personal keys. This never reads the cloud cache. */
function readOriginalPersonal(): OriginalPersonal {
  try {
    const v2 = localStorage.getItem(workspaceKey("personal"));
    if (v2 !== null) {
      const parsed: unknown = JSON.parse(v2);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        (parsed as { version?: unknown }).version !== 2
      ) {
        return { workspace: null, protected: true };
      }
      return { workspace: validateWorkspace(parsed), protected: false };
    }
    const v1 = localStorage.getItem(legacyWorkspaceKey("personal"));
    if (v1 !== null) {
      const parsed: unknown = JSON.parse(v1);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        (parsed as { version?: unknown }).version !== 1
      ) {
        return { workspace: null, protected: true };
      }
      return { workspace: validateWorkspace(parsed), protected: false };
    }
    return { workspace: null, protected: false };
  } catch {
    return { workspace: null, protected: true };
  }
}

function emptyServerCollection(record: CloudRecord): boolean {
  return (
    record.workspace.tasks.length === 0 &&
    record.workspace.projects.length === 0
  );
}

function sameCloudRecord(left: CloudRecord, right: CloudRecord): boolean {
  return (
    left.revision === right.revision &&
    left.updatedAt === right.updatedAt &&
    left.timeZone === right.timeZone &&
    left.focusOwnerClientId === right.focusOwnerClientId &&
    sameWorkspace(left.workspace, right.workspace)
  );
}

/**
 * Opt-in shared personal workspace wrapper. It intentionally delegates all
 * demo and disconnected personal behavior to useWorkspace, so the original
 * browser-local documents and their raw/corrupt protections are never used as
 * a cloud cache or overwritten by a server response.
 */
export function useSharedWorkspace() {
  const local = useWorkspace();
  const [runtime, setRuntime] = useState<Runtime>(() => {
    const preference = readStartupPreference(startupStorage());
    const startupBlocked =
      preference?.mode === "shared" ||
      (preference === null && isCanonicalPublishedOrigin(startupOrigin()));
    return {
      user: null,
      checking: startupBlocked,
      startupBlocked,
      startupNotice: startupBlocked
        ? "Checking whether your shared personal space can be opened…"
        : "",
      selected: false,
      status: startupBlocked ? "loading" : "local",
      error: "",
      cache: null,
      conflict: null,
      serverRecoveryCopies: [],
    };
  });
  const runtimeRef = useRef(runtime);
  const [publicGeneration, setPublicGeneration] = useState(0);
  const publicGenerationRef = useRef(0);
  const transportGenerationRef = useRef(0);
  const startupRequestRef = useRef(0);
  const kindRef = useRef<WorkspaceKind>(local.kind);
  const clientIdRef = useRef<string | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const flushDeadlineRef = useRef(0);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const flushRef = useRef<() => Promise<boolean>>(async () => false);
  const scheduleFlushRef = useRef<(delay: number) => void>(() => {});

  kindRef.current = local.kind;
  if (!clientIdRef.current) clientIdRef.current = clientId();

  const commitRuntime = useCallback((next: Runtime) => {
    runtimeRef.current = next;
    setRuntime(next);
  }, []);
  const bumpPublicGeneration = useCallback(() => {
    publicGenerationRef.current += 1;
    setPublicGeneration(publicGenerationRef.current);
  }, []);
  const invalidateTransport = useCallback(() => {
    transportGenerationRef.current += 1;
    return transportGenerationRef.current;
  }, []);
  const currentTransport = useCallback((captured: number, userId?: number) => {
    const current = runtimeRef.current;
    return (
      isCurrentGeneration(captured, transportGenerationRef.current) &&
      (!userId ||
        (current.selected &&
          current.user?.id === userId &&
          current.cache?.userId === userId))
    );
  }, []);

  const originalPersonal = useMemo(
    () => readOriginalPersonal(),
    // Local personal writes/recovery restore have a generation or workspace change.
    [local.kind, local.workspace, local.generation]
  );
  const cloudActive =
    !runtime.startupBlocked &&
    runtime.selected &&
    local.kind === "personal" &&
    runtime.cache !== null;
  const cloudStatus: CloudStatus = runtime.selected ? runtime.status : "local";
  const cloudWorkspace = runtime.cache
    ? visibleCloudWorkspace(runtime.cache)
    : null;
  const visibleWorkspace =
    cloudActive && cloudWorkspace ? cloudWorkspace : local.workspace;
  const cloudRecoveryCopies = useMemo(() => {
    const seen = new Set<string>();
    return [
      ...runtime.serverRecoveryCopies,
      ...(runtime.cache?.recoveryCopies ?? []),
    ]
      .sort((left, right) => right.at.localeCompare(left.at))
      .filter(copy => {
        if (seen.has(copy.id)) return false;
        seen.add(copy.id);
        return true;
      })
      .slice(0, 3);
  }, [runtime.cache?.recoveryCopies, runtime.serverRecoveryCopies]);
  const sharedReadOnly =
    cloudActive &&
    (cloudStatus === "loading" ||
      cloudStatus === "error" ||
      cloudStatus === "conflict");
  const readOnly =
    runtime.startupBlocked || (cloudActive ? sharedReadOnly : local.readOnly);

  const persistAndCommit = useCallback(
    (next: Runtime): boolean => {
      if (next.cache) {
        const error = writeCache(next.cache);
        if (error) {
          commitRuntime({
            ...runtimeRef.current,
            status: "error",
            error,
          });
          return false;
        }
      }
      commitRuntime(next);
      return true;
    },
    [commitRuntime]
  );

  const reportCloudError = useCallback(
    (message: string, status: CloudStatus = "error") => {
      const current = runtimeRef.current;
      commitRuntime({ ...current, status, error: message });
    },
    [commitRuntime]
  );

  const invalidateAccountBinding = useCallback(() => {
    // Keep the prior owner-scoped cache and its pending bytes intact. They can
    // only be recovered after an explicit reconnect as that owner.
    invalidateTransport();
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
      flushDeadlineRef.current = 0;
    }
    const current = runtimeRef.current;
    commitRuntime({
      ...current,
      user: null,
      checking: false,
      startupBlocked: true,
      startupNotice:
        "Shared personal data is unavailable until you reconnect deliberately or choose this browser or a sample space.",
      selected: false,
      status: "error",
      error:
        "This browser account changed or could not be verified. Shared writes stopped; reconnect deliberately to the current account.",
      cache: null,
      conflict: null,
      serverRecoveryCopies: [],
    });
    bumpPublicGeneration();
  }, [bumpPublicGeneration, commitRuntime, invalidateTransport]);

  const isActiveCloudMode = useCallback((): boolean => {
    const current = runtimeRef.current;
    return (
      !current.startupBlocked &&
      current.selected &&
      current.cache !== null &&
      kindRef.current === "personal"
    );
  }, []);

  const refreshServerRecoveries = useCallback(
    async (captured: number, userId: number): Promise<void> => {
      try {
        const copies = await getServerRecoveries(userId);
        if (!currentTransport(captured, userId)) return;
        const current = runtimeRef.current;
        commitRuntime({ ...current, serverRecoveryCopies: copies });
      } catch (error) {
        if (currentTransport(captured, userId) && isAccountGuardError(error)) {
          invalidateAccountBinding();
        }
        // Recoveries are additive safety evidence. A temporary failure must not
        // discard a usable workspace or incorrectly mark a confirmed save bad.
      }
    },
    [commitRuntime, currentTransport, invalidateAccountBinding]
  );

  const resolveUncertainWrite = useCallback(
    async (
      sent: CloudPending,
      captured: number,
      userId: number
    ): Promise<boolean> => {
      try {
        const fetched = await getServerWorkspace(userId);
        if (!currentTransport(captured, userId)) return false;
        const current = runtimeRef.current;
        if (!current.cache) return false;
        const reconciliation = reconcileUncertainCloudWrite(
          current.cache,
          sent,
          fetched
        );
        if (reconciliation.kind === "conflict") {
          persistAndCommit({
            ...current,
            cache: reconciliation.cache,
            status: "conflict",
            conflict: reconciliation.conflict,
            error:
              "The server changed while this request was uncertain. Both versions are preserved; choose which version to keep.",
          });
          return false;
        }
        const checkedCache = markCloudCacheSynced(
          reconciliation.cache,
          adelaideTimestamp()
        );
        const pending = checkedCache.pending !== null;
        if (
          !persistAndCommit({
            ...current,
            cache: checkedCache,
            status: pending ? "offline" : "synced",
            conflict: null,
            error: pending
              ? "Saved in this browser, but the server has not confirmed receipt yet."
              : "",
          })
        ) {
          return false;
        }
        if (reconciliation.kind === "acknowledged") {
          // This only replaces an exact sent snapshot, never a later local edit.
          if (!pending) bumpPublicGeneration();
          return true;
        }
        return false;
      } catch (error) {
        if (!currentTransport(captured, userId)) return false;
        if (isAccountGuardError(error)) {
          invalidateAccountBinding();
          return false;
        }
        reportCloudError(
          isLikelyNetworkError(error)
            ? "Saved in this browser, but the server has not confirmed receipt yet."
            : error instanceof Error
              ? error.message
              : "The server result could not be checked.",
          isLikelyNetworkError(error) ? "offline" : "error"
        );
        return false;
      }
    },
    [
      bumpPublicGeneration,
      currentTransport,
      invalidateAccountBinding,
      persistAndCommit,
      reportCloudError,
    ]
  );

  const flushCloud = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) return inFlightRef.current;
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
      flushDeadlineRef.current = 0;
    }
    const start = async (): Promise<boolean> => {
      const current = runtimeRef.current;
      const cache = current.cache;
      if (
        current.startupBlocked ||
        !current.selected ||
        !current.user ||
        !cache ||
        kindRef.current !== "personal"
      ) {
        return false;
      }
      if (!visibleDocument()) return false;
      if (!cache.pending) return true;
      if (!browserOnline()) {
        commitRuntime({
          ...current,
          status: "offline",
          error: "Saved in this browser and waiting for a network connection.",
        });
        return false;
      }
      const captured = transportGenerationRef.current;
      const userId = current.user.id;
      const sent = cache.pending;
      commitRuntime({ ...current, status: "saving", error: "" });
      try {
        const response = await privateOwnerRequest(userId, WORKSPACE_PATH, {
          method: "PUT",
          body: JSON.stringify(
            makeCloudWrite(
              sent,
              clientIdRef.current!,
              writeTimeZone(cache.server)
            )
          ),
        });
        const value = await responseJson(response);
        if (!currentTransport(captured, userId)) return false;
        const latest = runtimeRef.current;
        if (!latest.cache) return false;
        if (isAccountGuardFailure(response.status, value)) {
          invalidateAccountBinding();
          return false;
        }
        if (response.status === 409) {
          const conflict = parseConflict(value);
          persistAndCommit({
            ...latest,
            cache: { ...latest.cache, server: conflict },
            status: "conflict",
            conflict,
            error:
              "Another device or tab changed this workspace. Both versions are preserved; choose which version to keep.",
          });
          return false;
        }
        if (!response.ok) {
          return resolveUncertainWrite(sent, captured, userId);
        }
        const acknowledgement = validateCloudRecord(value);
        const applied = acknowledgeCloudWrite(
          latest.cache,
          sent,
          acknowledgement
        );
        if (!applied.acknowledged) {
          return persistAndCommit({
            ...latest,
            cache: applied.cache,
            status: "conflict",
            conflict: applied.conflict,
            error:
              "The server acknowledgement did not match this saved revision. Both versions are preserved; choose which version to keep.",
          });
        }
        const checkedCache = markCloudCacheSynced(
          applied.cache,
          adelaideTimestamp()
        );
        if (
          !persistAndCommit({
            ...latest,
            cache: checkedCache,
            status: checkedCache.pending ? "saving" : "synced",
            conflict: null,
            error: "",
          })
        ) {
          return false;
        }
        // A newer edit was made during this request. Its complete snapshot was
        // rebased above and is sent after this acknowledgement, not overwritten.
        if (checkedCache.pending) scheduleFlushRef.current(0);
        if (!checkedCache.pending) {
          void refreshServerRecoveries(captured, userId);
        }
        return true;
      } catch (error) {
        if (!currentTransport(captured, userId)) return false;
        return resolveUncertainWrite(sent, captured, userId);
      }
    };
    const promise = start();
    inFlightRef.current = promise;
    void promise.finally(() => {
      if (inFlightRef.current === promise) inFlightRef.current = null;
    });
    return promise;
  }, [
    commitRuntime,
    currentTransport,
    invalidateAccountBinding,
    persistAndCommit,
    refreshServerRecoveries,
    resolveUncertainWrite,
  ]);
  flushRef.current = flushCloud;

  const scheduleFlush = useCallback((delay: number) => {
    const current = runtimeRef.current;
    if (!current.selected || !current.cache?.pending || !visibleDocument())
      return;
    const due = Date.now() + Math.max(0, delay);
    if (
      flushTimerRef.current !== null &&
      flushDeadlineRef.current > 0 &&
      flushDeadlineRef.current <= due
    ) {
      return;
    }
    if (flushTimerRef.current !== null)
      window.clearTimeout(flushTimerRef.current);
    flushDeadlineRef.current = due;
    flushTimerRef.current = window.setTimeout(
      () => {
        flushTimerRef.current = null;
        flushDeadlineRef.current = 0;
        void flushRef.current();
      },
      Math.max(0, due - Date.now())
    );
  }, []);
  scheduleFlushRef.current = scheduleFlush;

  const queueCloudWorkspace = useCallback(
    (candidate: Workspace, options: QueueOptions = {}): boolean => {
      const current = runtimeRef.current;
      const cache = current.cache;
      if (current.startupBlocked || !isActiveCloudMode() || !cache)
        return false;
      if (
        current.status === "loading" ||
        current.status === "error" ||
        current.status === "conflict"
      ) {
        return false;
      }
      let next: Workspace;
      try {
        next = validateWorkspace(candidate);
      } catch {
        reportCloudError(
          "This change was not saved because it did not form a valid workspace."
        );
        return false;
      }
      const visible = visibleCloudWorkspace(cache);
      if (
        hasRemoteRunningFocus(cache.server, clientIdRef.current!) &&
        !sameFocus(next.focus, cache.server.workspace.focus)
      ) {
        reportCloudError(
          "Another device owns the running focus session. Take focus here before changing or ending it.",
          "saving"
        );
        return false;
      }
      if (
        sameWorkspace(next, visible) &&
        !options.claimFocus &&
        !options.replacement
      ) {
        return true;
      }
      let nextCache = cache;
      try {
        if (options.snapshot) {
          nextCache = withCloudRecovery(
            nextCache,
            visible,
            nowIso(),
            recoveryId(),
            options.forceSnapshot
          );
        }
      } catch {
        reportCloudError(
          "A local shared-workspace recovery copy could not be prepared, so the change was cancelled."
        );
        return false;
      }
      const prior = nextCache.pending;
      nextCache = {
        ...nextCache,
        pending: {
          workspace: next,
          baseRevision: nextCache.server.revision,
          claimFocus: Boolean(options.claimFocus || prior?.claimFocus),
          replacement: Boolean(options.replacement || prior?.replacement),
          queuedAt: nowIso(),
        },
      };
      const status: CloudStatus = browserOnline() ? "saving" : "offline";
      if (
        !persistAndCommit({
          ...current,
          cache: nextCache,
          status,
          conflict: null,
          error:
            status === "offline"
              ? "Saved in this browser and waiting for a network connection."
              : "",
        })
      ) {
        return false;
      }
      scheduleFlush(options.delay ?? NORMAL_WRITE_DEBOUNCE_MS);
      return true;
    },
    [isActiveCloudMode, persistAndCommit, reportCloudError, scheduleFlush]
  );

  const refreshServer = useCallback(async (): Promise<boolean> => {
    // A GET interleaved with a PUT can observe the sent snapshot before its
    // response. Let the serialized PUT acknowledgement rebase later edits.
    if (inFlightRef.current) return false;
    const current = runtimeRef.current;
    if (
      current.startupBlocked ||
      !current.selected ||
      !current.user ||
      !current.cache ||
      kindRef.current !== "personal"
    ) {
      return false;
    }
    const captured = transportGenerationRef.current;
    const userId = current.user.id;
    try {
      const fetched = await getServerWorkspace(userId);
      if (!currentTransport(captured, userId)) return false;
      const latest = runtimeRef.current;
      if (!latest.cache) return false;
      const previousServer = latest.cache.server;
      const reconciliation = reconcileFetchedCloudRecord(latest.cache, fetched);
      if (reconciliation.kind === "conflict") {
        return persistAndCommit({
          ...latest,
          cache: reconciliation.cache,
          status: "conflict",
          conflict: reconciliation.conflict,
          error:
            "The server changed while this browser had pending work. Both versions are preserved; choose which version to keep.",
        });
      }
      const checkedCache = markCloudCacheSynced(
        reconciliation.cache,
        adelaideTimestamp()
      );
      const pending = checkedCache.pending !== null;
      const status: CloudStatus = pending ? "saving" : "synced";
      if (
        !persistAndCommit({
          ...latest,
          cache: checkedCache,
          status,
          conflict: null,
          error: "",
        })
      ) {
        return false;
      }
      if (
        (reconciliation.kind === "adopt" ||
          reconciliation.kind === "acknowledged") &&
        !sameCloudRecord(previousServer, checkedCache.server)
      ) {
        bumpPublicGeneration();
      }
      if (pending) scheduleFlush(0);
      void refreshServerRecoveries(captured, userId);
      return true;
    } catch (error) {
      if (!currentTransport(captured, userId)) return false;
      if (isAccountGuardError(error)) {
        invalidateAccountBinding();
        return false;
      }
      reportCloudError(
        error instanceof Error
          ? error.message
          : "The server could not be refreshed.",
        isLikelyNetworkError(error) ? "offline" : "error"
      );
      return false;
    }
  }, [
    bumpPublicGeneration,
    currentTransport,
    invalidateAccountBinding,
    persistAndCommit,
    refreshServerRecoveries,
    reportCloudError,
    scheduleFlush,
  ]);

  const checkSession = useCallback(async (): Promise<boolean> => {
    const captured = transportGenerationRef.current;
    const before = runtimeRef.current;
    commitRuntime({
      ...before,
      checking: true,
      error: before.selected ? before.error : "",
    });
    try {
      const user = await getSession();
      if (!isCurrentGeneration(captured, transportGenerationRef.current))
        return false;
      const latest = runtimeRef.current;
      commitRuntime({ ...latest, user, checking: false });
      return true;
    } catch (error) {
      if (!isCurrentGeneration(captured, transportGenerationRef.current))
        return false;
      const latest = runtimeRef.current;
      commitRuntime({
        ...latest,
        user: null,
        checking: false,
        status: latest.selected ? "error" : "local",
        error:
          error instanceof Error
            ? error.message
            : "Shared sign-in could not be checked.",
      });
      return false;
    }
  }, [commitRuntime]);

  const connect = useCallback(
    async (expectedOwnerId?: number): Promise<boolean> => {
      const captured = invalidateTransport();
      const before = runtimeRef.current;
      const keepStartupBlocked = before.startupBlocked;
      commitRuntime({
        ...before,
        user: null,
        checking: true,
        selected: false,
        status: "loading",
        error: "",
        cache: null,
        conflict: null,
        serverRecoveryCopies: [],
        startupBlocked: keepStartupBlocked,
        startupNotice: keepStartupBlocked
          ? "Opening your selected shared personal space…"
          : "",
      });
      let verifiedUser: CloudUser | null = null;
      try {
        // Authentication is checked afresh at the deliberate connect action.
        const user = await getSession();
        if (!isCurrentGeneration(captured, transportGenerationRef.current))
          return false;
        if (expectedOwnerId !== undefined && user.id !== expectedOwnerId) {
          invalidateAccountBinding();
          return false;
        }
        verifiedUser = user;
        const server = await getServerWorkspace(user.id);
        if (!isCurrentGeneration(captured, transportGenerationRef.current))
          return false;
        const recovered = readCache(user);
        if (recovered.error) {
          commitRuntime({
            ...runtimeRef.current,
            user,
            checking: false,
            selected: false,
            status: "error",
            error: recovered.error,
            cache: null,
            conflict: null,
            serverRecoveryCopies: [],
            startupBlocked: keepStartupBlocked,
            startupNotice: keepStartupBlocked
              ? "The selected shared personal space could not be opened. Retry, sign in, or choose this browser or a sample space."
              : "",
          });
          return false;
        }
        let cache = recovered.cache ?? createCloudCache(user, server);
        let conflict: CloudRecord | null = null;
        let status: CloudStatus = "synced";
        let error = "";
        if (recovered.cache) {
          const reconciliation = reconcileFetchedCloudRecord(cache, server);
          cache = reconciliation.cache;
          if (reconciliation.kind === "conflict") {
            conflict = reconciliation.conflict;
            status = "conflict";
            error =
              "The server and this browser recovery cache differ. Both versions are preserved; choose which version to keep.";
          } else if (cache.pending) {
            status = browserOnline() ? "saving" : "offline";
            if (status === "offline") {
              error =
                "Saved in this browser and waiting for a network connection.";
            }
          }
        }
        if (status !== "conflict") {
          cache = markCloudCacheSynced(cache, adelaideTimestamp());
        }
        if (
          !persistAndCommit({
            user,
            checking: false,
            startupBlocked: false,
            startupNotice: "",
            selected: true,
            status,
            error,
            cache,
            conflict,
            serverRecoveryCopies: [],
          })
        ) {
          const failed = runtimeRef.current;
          if (failed.startupBlocked) {
            commitRuntime({
              ...failed,
              startupNotice:
                "The selected shared personal space could not be opened safely in this browser. Retry, sign in, or choose this browser or a sample space.",
            });
          }
          return false;
        }
        if (!isCurrentGeneration(captured, transportGenerationRef.current))
          return false;
        // The owner ID is a routing preference only. It is written after both
        // fresh session and server workspace validation have succeeded.
        writeStartupPreference(startupStorage(), {
          version: 1,
          mode: "shared",
          userId: user.id,
        });
        // The local hook still holds the original personal workspace under its
        // own keys; switching only changes which validated document is rendered.
        kindRef.current = "personal";
        local.switchKind("personal");
        bumpPublicGeneration();
        void refreshServerRecoveries(captured, user.id);
        if (cache.pending && !conflict) scheduleFlush(0);
        return true;
      } catch (error) {
        if (!isCurrentGeneration(captured, transportGenerationRef.current))
          return false;
        if (isAccountGuardError(error)) {
          invalidateAccountBinding();
          return false;
        }
        commitRuntime({
          ...runtimeRef.current,
          user: verifiedUser,
          checking: false,
          selected: false,
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Shared sign-in could not be completed.",
          cache: null,
          conflict: null,
          serverRecoveryCopies: [],
          startupBlocked:
            keepStartupBlocked || runtimeRef.current.startupBlocked,
          startupNotice:
            keepStartupBlocked || runtimeRef.current.startupBlocked
              ? "The selected shared personal space could not be opened. Retry, sign in, or choose this browser or a sample space."
              : "",
        });
        return false;
      }
    },
    [
      bumpPublicGeneration,
      commitRuntime,
      invalidateAccountBinding,
      invalidateTransport,
      local.switchKind,
      persistAndCommit,
      refreshServerRecoveries,
      scheduleFlush,
    ]
  );

  const disconnect = useCallback(() => {
    invalidateTransport();
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
      flushDeadlineRef.current = 0;
    }
    const current = runtimeRef.current;
    writeStartupPreference(startupStorage(), { version: 1, mode: "browser" });
    commitRuntime({
      ...current,
      checking: false,
      startupBlocked: false,
      startupNotice: "",
      selected: false,
      status: "local",
      error: "",
      cache: null,
      conflict: null,
      serverRecoveryCopies: [],
    });
    kindRef.current = "personal";
    local.switchKind("personal");
    bumpPublicGeneration();
  }, [
    bumpPublicGeneration,
    commitRuntime,
    invalidateTransport,
    local.switchKind,
  ]);

  const retry = useCallback(async (): Promise<boolean> => {
    if (runtimeRef.current.startupBlocked) return connect();
    if (isActiveCloudMode()) return refreshServer();
    return checkSession();
  }, [checkSession, connect, isActiveCloudMode, refreshServer]);

  const mutate = useCallback(
    (
      rawChange: (current: Workspace) => Workspace,
      onAcceptedWorkspace?: (workspace: Workspace) => void
    ): boolean => {
      // Use one timestamp for both validation and commit so the optional result
      // callback receives the exact workspace snapshot that was accepted.
      const stamp = adelaideTimestamp();
      // The owner's own placements are never "suggested"; filed time recorded.
      const change = (current: Workspace): Workspace => {
        const next = rawChange(current);
        if (next === current) return next;
        const tasks = stampOwnerPlacement(
          current.tasks,
          next.tasks,
          stamp
        );
        return tasks === next.tasks ? next : { ...next, tasks };
      };
      if (runtimeRef.current.startupBlocked) return false;
      if (!isActiveCloudMode()) {
        let next: Workspace;
        try {
          next = validateWorkspace(change(local.workspace));
        } catch {
          return local.mutate(change);
        }
        const accepted = local.mutate(() => next);
        if (accepted) onAcceptedWorkspace?.(next);
        return accepted;
      }
      if (readOnly) return false;
      const cache = runtimeRef.current.cache;
      if (!cache) return false;
      const current = visibleCloudWorkspace(cache);
      let next: Workspace;
      try {
        next = validateWorkspace(change(current));
      } catch {
        reportCloudError(
          "This change was not saved because it did not form a valid workspace."
        );
        return false;
      }
      // Editing a task must not quietly pause or erase a running focus owned in
      // another tab/device. The owner has to take focus here explicitly first.
      if (
        hasRemoteRunningFocus(cache.server, clientIdRef.current!) &&
        !sameFocus(next.focus, current.focus)
      ) {
        reportCloudError(
          "Another device owns the running focus session. Take focus here before changing or ending it.",
          "saving"
        );
        return false;
      }
      const accepted = queueCloudWorkspace(next, { snapshot: true });
      if (accepted) {
        // The previous snapshot only becomes undoable after it was safely cached.
        cloudPreviousRef.current = current;
        setCloudPrevious(current);
        onAcceptedWorkspace?.(next);
      }
      return accepted;
    },
    [isActiveCloudMode, local, queueCloudWorkspace, readOnly, reportCloudError]
  );

  const [cloudPrevious, setCloudPrevious] = useState<Workspace | null>(null);
  const cloudPreviousRef = useRef<Workspace | null>(null);

  const undo = useCallback((): boolean => {
    if (runtimeRef.current.startupBlocked) return false;
    if (!isActiveCloudMode()) {
      const accepted = local.undo();
      if (accepted) bumpPublicGeneration();
      return accepted;
    }
    if (readOnly || !cloudPreviousRef.current) return false;
    const cache = runtimeRef.current.cache;
    if (!cache) return false;
    const current = visibleCloudWorkspace(cache);
    const previous = cloudPreviousRef.current;
    if (
      hasRemoteRunningFocus(cache.server, clientIdRef.current!) &&
      !sameFocus(previous.focus, current.focus)
    ) {
      reportCloudError(
        "Another device owns the running focus session. Take focus here before changing or ending it.",
        "saving"
      );
      return false;
    }
    const accepted = queueCloudWorkspace(previous);
    if (accepted) {
      cloudPreviousRef.current = null;
      setCloudPrevious(null);
      bumpPublicGeneration();
    }
    return accepted;
  }, [
    bumpPublicGeneration,
    isActiveCloudMode,
    local,
    queueCloudWorkspace,
    readOnly,
    reportCloudError,
  ]);

  const saveFocus = useCallback(
    (focus: FocusSession | null, expectedGeneration?: number): boolean => {
      if (runtimeRef.current.startupBlocked) return false;
      if (
        expectedGeneration !== undefined &&
        expectedGeneration !== publicGenerationRef.current
      ) {
        return false;
      }
      if (!isActiveCloudMode()) return local.saveFocus(focus);
      if (readOnly) return false;
      const cache = runtimeRef.current.cache;
      if (!cache) return false;
      const current = visibleCloudWorkspace(cache);
      let next: Workspace;
      try {
        next = validateWorkspace({ ...current, focus });
      } catch {
        reportCloudError(
          "Focus could not be saved because its task is no longer available."
        );
        return false;
      }
      const startsOrResumes = Boolean(
        focus?.running &&
          (!current.focus?.running || current.focus.taskId !== focus.taskId)
      );
      if (
        hasRemoteRunningFocus(cache.server, clientIdRef.current!) &&
        !sameFocus(focus, current.focus)
      ) {
        reportCloudError(
          "Another device owns the running focus session. Take focus here before changing or ending it.",
          "saving"
        );
        return false;
      }
      const stopping = Boolean(current.focus?.running && !focus?.running);
      return queueCloudWorkspace(next, {
        claimFocus: startsOrResumes,
        delay: startsOrResumes || stopping ? 0 : FOCUS_WRITE_DEBOUNCE_MS,
      });
    },
    [isActiveCloudMode, local, queueCloudWorkspace, readOnly, reportCloudError]
  );

  const markExported = useCallback((): boolean => {
    if (runtimeRef.current.startupBlocked) return false;
    if (!isActiveCloudMode()) return local.markExported();
    return mutate(workspace => ({
      ...workspace,
      trial: { ...workspace.trial, lastExportAt: nowIso() },
    }));
  }, [isActiveCloudMode, local, mutate]);

  const markReviewed = useCallback((): boolean => {
    if (runtimeRef.current.startupBlocked) return false;
    if (!isActiveCloudMode()) return local.markReviewed();
    return mutate(workspace => ({
      ...workspace,
      trial: { ...workspace.trial, lastReviewAt: nowIso() },
    }));
  }, [isActiveCloudMode, local, mutate]);

  /**
   * The original synchronous local API cannot honestly claim cloud replacement
   * success. Parent UI calls cloud.restoreBackup() when cloud.active instead.
   */
  const restoreBackup = useCallback(
    (candidate: Workspace): boolean => {
      if (runtimeRef.current.startupBlocked) return false;
      if (!isActiveCloudMode()) {
        const accepted = local.restoreBackup(candidate);
        if (accepted) bumpPublicGeneration();
        return accepted;
      }
      // Validate eagerly so an invalid supplied document never appears accepted.
      try {
        validateWorkspace(candidate);
      } catch {
        reportCloudError(
          "The checked backup was not valid, so nothing was replaced.",
          "saving"
        );
      }
      return false;
    },
    [bumpPublicGeneration, isActiveCloudMode, local, reportCloudError]
  );

  const restoreCloudBackup = useCallback(
    async (candidate: Workspace): Promise<boolean> => {
      if (!isActiveCloudMode() || readOnly) return false;
      let restored: Workspace;
      try {
        restored = validateWorkspace(candidate);
      } catch {
        reportCloudError(
          "The checked backup was not valid, so nothing was replaced.",
          "saving"
        );
        return false;
      }
      const before = runtimeRef.current;
      if (!before.user || !before.cache) return false;
      const captured = transportGenerationRef.current;
      const userId = before.user.id;
      commitRuntime({
        ...before,
        status: "loading",
        error: "",
        conflict: null,
      });
      try {
        const latestServer = await getServerWorkspace(userId);
        if (!currentTransport(captured, userId)) return false;
        if (
          hasRemoteRunningFocus(latestServer, clientIdRef.current!) &&
          !sameFocus(restored.focus, latestServer.workspace.focus)
        ) {
          reportCloudError(
            "Another device owns the running focus session. Take focus here before changing or ending it.",
            "saving"
          );
          return false;
        }
        const current = runtimeRef.current;
        if (!current.cache) return false;
        let cache = withCloudRecovery(
          { ...current.cache, server: latestServer },
          visibleCloudWorkspace(current.cache),
          nowIso(),
          recoveryId(),
          true
        );
        cache = {
          ...cache,
          pending: {
            workspace: restored,
            baseRevision: latestServer.revision,
            claimFocus: false,
            replacement: true,
            queuedAt: nowIso(),
          },
        };
        if (
          !persistAndCommit({
            ...current,
            cache,
            status: "saving",
            error: "",
            conflict: null,
          })
        ) {
          return false;
        }
        const accepted = await flushRef.current();
        if (accepted) bumpPublicGeneration();
        return accepted;
      } catch (error) {
        if (!currentTransport(captured, userId)) return false;
        if (isAccountGuardError(error)) {
          invalidateAccountBinding();
          return false;
        }
        reportCloudError(
          error instanceof Error
            ? error.message
            : "The backup could not be replaced.",
          isLikelyNetworkError(error) ? "offline" : "error"
        );
        return false;
      }
    },
    [
      bumpPublicGeneration,
      currentTransport,
      invalidateAccountBinding,
      isActiveCloudMode,
      persistAndCommit,
      readOnly,
      reportCloudError,
    ]
  );

  const useServerVersion = useCallback(async (): Promise<boolean> => {
    if (!isActiveCloudMode()) return false;
    const before = runtimeRef.current;
    if (!before.user || !before.cache) return false;
    const captured = transportGenerationRef.current;
    const userId = before.user.id;
    commitRuntime({ ...before, status: "loading", error: "", conflict: null });
    try {
      const latestServer = await getServerWorkspace(userId);
      if (!currentTransport(captured, userId)) return false;
      const current = runtimeRef.current;
      if (!current.cache) return false;
      const cache = withCloudRecovery(
        { ...current.cache, server: latestServer, pending: null },
        visibleCloudWorkspace(current.cache),
        nowIso(),
        recoveryId(),
        true
      );
      if (
        !persistAndCommit({
          ...current,
          cache,
          status: "synced",
          conflict: null,
          error: "",
        })
      ) {
        return false;
      }
      cloudPreviousRef.current = null;
      setCloudPrevious(null);
      bumpPublicGeneration();
      return true;
    } catch (error) {
      if (!currentTransport(captured, userId)) return false;
      if (isAccountGuardError(error)) {
        invalidateAccountBinding();
        return false;
      }
      reportCloudError(
        error instanceof Error
          ? error.message
          : "The server version could not be loaded.",
        isLikelyNetworkError(error) ? "offline" : "error"
      );
      return false;
    }
  }, [
    bumpPublicGeneration,
    currentTransport,
    invalidateAccountBinding,
    isActiveCloudMode,
    persistAndCommit,
    reportCloudError,
  ]);

  const keepLocalVersion = useCallback(async (): Promise<boolean> => {
    if (!isActiveCloudMode() || readOnly) return false;
    const before = runtimeRef.current;
    if (!before.user || !before.cache) return false;
    const localVersion = visibleCloudWorkspace(before.cache);
    const captured = transportGenerationRef.current;
    const userId = before.user.id;
    commitRuntime({ ...before, status: "loading", error: "", conflict: null });
    try {
      const latestServer = await getServerWorkspace(userId);
      if (!currentTransport(captured, userId)) return false;
      if (
        hasRemoteRunningFocus(latestServer, clientIdRef.current!) &&
        !sameFocus(localVersion.focus, latestServer.workspace.focus)
      ) {
        reportCloudError(
          "Another device owns the running focus session. Take focus here before changing or ending it.",
          "saving"
        );
        return false;
      }
      const current = runtimeRef.current;
      if (!current.cache) return false;
      let cache = withCloudRecovery(
        { ...current.cache, server: latestServer },
        visibleCloudWorkspace(current.cache),
        nowIso(),
        recoveryId(),
        true
      );
      cache = {
        ...cache,
        pending: {
          workspace: localVersion,
          baseRevision: latestServer.revision,
          claimFocus: false,
          replacement: true,
          queuedAt: nowIso(),
        },
      };
      if (
        !persistAndCommit({
          ...current,
          cache,
          status: "saving",
          conflict: null,
          error: "",
        })
      ) {
        return false;
      }
      const accepted = await flushRef.current();
      if (accepted) bumpPublicGeneration();
      return accepted;
    } catch (error) {
      if (!currentTransport(captured, userId)) return false;
      if (isAccountGuardError(error)) {
        invalidateAccountBinding();
        return false;
      }
      reportCloudError(
        error instanceof Error
          ? error.message
          : "The local version could not be sent.",
        isLikelyNetworkError(error) ? "offline" : "error"
      );
      return false;
    }
  }, [
    bumpPublicGeneration,
    currentTransport,
    invalidateAccountBinding,
    isActiveCloudMode,
    persistAndCommit,
    readOnly,
    reportCloudError,
  ]);

  const transferLocalPersonal = useCallback(async (): Promise<boolean> => {
    if (!isActiveCloudMode() || readOnly) return false;
    const original = readOriginalPersonal();
    if (original.protected || !original.workspace) {
      reportCloudError(
        "Original local personal data could not be validated, so it was not transferred. It remains untouched in this browser.",
        "saving"
      );
      return false;
    }
    const before = runtimeRef.current;
    if (!before.user || !before.cache) return false;
    const captured = transportGenerationRef.current;
    const userId = before.user.id;
    commitRuntime({ ...before, status: "loading", error: "", conflict: null });
    try {
      const latestServer = await getServerWorkspace(userId);
      if (!currentTransport(captured, userId)) return false;
      if (!emptyServerCollection(latestServer)) {
        reportCloudError(
          "Transfer is available only while the checked server workspace has no tasks or projects. Nothing local was uploaded.",
          "saving"
        );
        return false;
      }
      const current = runtimeRef.current;
      if (!current.cache) return false;
      const cache: CloudCache = {
        ...current.cache,
        server: latestServer,
        pending: {
          workspace: original.workspace,
          baseRevision: latestServer.revision,
          claimFocus: false,
          replacement: false,
          queuedAt: nowIso(),
        },
      };
      if (
        !persistAndCommit({
          ...current,
          cache,
          status: "saving",
          conflict: null,
          error: "",
        })
      ) {
        return false;
      }
      const accepted = await flushRef.current();
      if (accepted) bumpPublicGeneration();
      return accepted;
    } catch (error) {
      if (!currentTransport(captured, userId)) return false;
      if (isAccountGuardError(error)) {
        invalidateAccountBinding();
        return false;
      }
      reportCloudError(
        error instanceof Error
          ? error.message
          : "The local personal workspace could not be transferred.",
        isLikelyNetworkError(error) ? "offline" : "error"
      );
      return false;
    }
  }, [
    bumpPublicGeneration,
    currentTransport,
    invalidateAccountBinding,
    isActiveCloudMode,
    persistAndCommit,
    readOnly,
    reportCloudError,
  ]);

  const takeFocusHere = useCallback((): boolean => {
    if (!isActiveCloudMode() || readOnly) return false;
    const cache = runtimeRef.current.cache;
    if (!cache || !hasRemoteRunningFocus(cache.server, clientIdRef.current!))
      return false;
    const focus = cache ? visibleCloudWorkspace(cache).focus : null;
    if (!focus?.running) return false;
    return queueCloudWorkspace(visibleCloudWorkspace(cache), {
      claimFocus: true,
      delay: 0,
    });
  }, [isActiveCloudMode, queueCloudWorkspace, readOnly]);

  const switchKind = useCallback(
    (nextKind: WorkspaceKind) => {
      const current = runtimeRef.current;
      const returnToConnectedShared =
        nextKind === "personal" &&
        current.selected &&
        current.cache !== null &&
        !current.startupBlocked;
      invalidateTransport();
      if (nextKind === "demo") {
        writeStartupPreference(startupStorage(), { version: 1, mode: "demo" });
      } else if (!returnToConnectedShared) {
        writeStartupPreference(startupStorage(), {
          version: 1,
          mode: "browser",
        });
      }
      commitRuntime({
        ...current,
        checking: false,
        startupBlocked: false,
        startupNotice: "",
        status: returnToConnectedShared ? current.status : "local",
        error: returnToConnectedShared ? current.error : "",
        conflict: returnToConnectedShared ? current.conflict : null,
      });
      kindRef.current = nextKind;
      local.switchKind(nextKind);
      bumpPublicGeneration();
      if (returnToConnectedShared) {
        // Demo selection intentionally overwrote the startup preference. A
        // deliberate return earns shared startup again only through connect's
        // fresh session + workspace validation, never from a cached owner ID.
        void connect();
      }
    },
    [bumpPublicGeneration, connect, invalidateTransport, local.switchKind]
  );

  const loadDemo = useCallback(
    (scenario: Scenario): boolean => {
      if (runtimeRef.current.startupBlocked || kindRef.current !== "demo")
        return false;
      return local.loadDemo(scenario);
    },
    [local]
  );

  // Startup session discovery never trusts the preference as authentication. It
  // only opens shared data after a second fresh session plus workspace request.
  useEffect(() => {
    let alive = true;
    const request = ++startupRequestRef.current;
    const preference = readStartupPreference(startupStorage());
    if (isCompassConsentPage()) {
      // Consent has first priority: discover only the signed-in account and do
      // not select shared data, switch workspaces, or resume pending writes.
      void checkSession();
      return () => {
        alive = false;
        if (startupRequestRef.current === request) {
          startupRequestRef.current += 1;
          invalidateTransport();
        }
      };
    }
    const discover = async () => {
      const captured = transportGenerationRef.current;
      const before = runtimeRef.current;
      commitRuntime({ ...before, checking: true, error: "" });
      try {
        const user = await getSession();
        if (
          !alive ||
          request !== startupRequestRef.current ||
          !isCurrentGeneration(captured, transportGenerationRef.current)
        ) {
          return;
        }
        const policy = chooseStartupPolicy({
          preference,
          origin: startupOrigin(),
          sessionOwnerId: user.id,
        });
        if (policy.action === "shared") {
          commitRuntime({
            ...runtimeRef.current,
            user,
            checking: true,
            selected: false,
            status: "loading",
            error: "",
            cache: null,
            conflict: null,
            serverRecoveryCopies: [],
            startupBlocked: true,
            startupNotice: "Opening your selected shared personal space…",
          });
          void connect(user.id);
          return;
        }
        if (policy.action === "blocked") {
          commitRuntime({
            ...runtimeRef.current,
            user,
            checking: false,
            selected: false,
            status: "error",
            error: policy.notice,
            cache: null,
            conflict: null,
            serverRecoveryCopies: [],
            startupBlocked: true,
            startupNotice: policy.notice,
          });
          return;
        }
        if (policy.action === "demo") {
          commitRuntime({
            ...runtimeRef.current,
            user,
            checking: false,
            selected: false,
            status: "local",
            error: "",
            cache: null,
            conflict: null,
            serverRecoveryCopies: [],
            startupBlocked: false,
            startupNotice: "",
          });
          kindRef.current = "demo";
          local.switchKind("demo");
          return;
        }
        commitRuntime({
          ...runtimeRef.current,
          user,
          checking: false,
          selected: false,
          status: "local",
          error: "",
          cache: null,
          conflict: null,
          serverRecoveryCopies: [],
          startupBlocked: false,
          startupNotice: "",
        });
        // An explicit browser preference means the original browser-personal
        // collection, while an absent preference leaves Preview's local choice.
        if (preference?.mode === "browser") {
          kindRef.current = "personal";
          local.switchKind("personal");
        }
      } catch (error) {
        if (
          !alive ||
          request !== startupRequestRef.current ||
          !isCurrentGeneration(captured, transportGenerationRef.current)
        ) {
          return;
        }
        const policy = chooseStartupPolicy({
          preference,
          origin: startupOrigin(),
          sessionOwnerId: null,
        });
        const blocked = policy.action === "blocked";
        commitRuntime({
          ...runtimeRef.current,
          user: null,
          checking: false,
          selected: false,
          status: blocked ? "error" : "local",
          error: blocked
            ? error instanceof Error
              ? error.message
              : "Shared sign-in could not be checked."
            : "",
          cache: null,
          conflict: null,
          serverRecoveryCopies: [],
          startupBlocked: blocked,
          startupNotice: blocked ? policy.notice : "",
        });
      }
    };
    void discover();
    return () => {
      alive = false;
      if (startupRequestRef.current === request) {
        startupRequestRef.current += 1;
        invalidateTransport();
      }
    };
  }, [
    checkSession,
    commitRuntime,
    connect,
    invalidateTransport,
    local.switchKind,
  ]);

  // Polling exists only while this tab is both connected to cloud personal data
  // and visible. Returning online/visible immediately refreshes the checked
  // record; no detached/background service is created.
  useEffect(() => {
    if (!cloudActive) return;
    const refreshIfVisible = () => {
      if (visibleDocument()) void refreshServer();
    };
    const onVisibility = () => refreshIfVisible();
    const onOnline = () => refreshIfVisible();
    const poll = window.setInterval(refreshIfVisible, POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [cloudActive, refreshServer]);

  useEffect(
    () => () => {
      if (flushTimerRef.current !== null)
        window.clearTimeout(flushTimerRef.current);
    },
    []
  );

  const remoteFocus =
    cloudActive &&
    runtime.cache !== null &&
    hasRemoteRunningFocus(runtime.cache.server, clientIdRef.current!);
  const canTickFocus =
    !runtime.startupBlocked &&
    (!cloudActive ||
      Boolean(
        !readOnly &&
          runtime.cache?.server.workspace.focus?.running &&
          runtime.cache?.server.focusOwnerClientId === clientIdRef.current &&
          !runtime.cache?.pending?.claimFocus
      ));

  return {
    // Original useWorkspace structural API.
    kind: local.kind,
    generation: publicGeneration,
    workspace: visibleWorkspace,
    storageError: cloudActive ? runtime.error : local.storageError,
    mutate,
    undo,
    canUndo: cloudActive ? cloudPrevious !== null : local.canUndo,
    switchKind,
    loadDemo,
    saveFocus,
    readOnly,
    recoveryCopies: cloudActive ? cloudRecoveryCopies : local.recoveryCopies,
    corruptRaw: local.corruptRaw,
    corruptStorageKey: local.corruptStorageKey,
    markExported,
    markReviewed,
    restoreBackup,

    // Shared-workspace additions consumed by the parent cloud UI.
    canTickFocus,
    cloud: {
      user: runtime.user,
      checking: runtime.checking,
      startupBlocked: runtime.startupBlocked,
      startupNotice: runtime.startupNotice,
      active: cloudActive,
      status: cloudStatus,
      error: runtime.error,
      lastSyncedAt: runtime.cache?.lastSyncedAt ?? null,
      revision: runtime.cache?.server.revision ?? 0,
      pending: Boolean(runtime.cache?.pending),
      focusTransferPending: Boolean(runtime.cache?.pending?.claimFocus),
      conflict: runtime.conflict,
      remoteFocus,
      localPersonal: originalPersonal.workspace,
      localPersonalProtected:
        originalPersonal.protected ||
        (local.kind === "personal" && local.readOnly),
      connect,
      disconnect,
      retry,
      useServerVersion,
      keepLocalVersion,
      transferLocalPersonal,
      takeFocusHere,
      restoreBackup: restoreCloudBackup,
    },
  };
}
