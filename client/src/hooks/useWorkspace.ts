import { DEFAULT_PLANNING } from "../domain/time";
import { useCallback, useEffect, useRef, useState } from "react";
import { today } from "../domain/engine";
import { makeSampleProjects } from "../domain/life";
import { makeSampleTasks } from "../domain/samples";
import { moveIdeasToFrontOfMind } from "../domain/frontOfMind";
import {
  addRecoveryCopy,
  corruptCopyKey,
  legacyWorkspaceKey,
  preferredWorkspaceKey,
  recoveryKey,
  validateRecoveryCopies,
  workspaceKey,
} from "../domain/storage";
import type { RecoveryCopy, WorkspaceKind } from "../domain/storage";
import { validateWorkspace } from "../domain/transfer";
import type {
  FocusSession,
  MatrixWeights,
  Scenario,
  Workspace,
} from "../domain/types";

export type WorkspaceStoreKind = WorkspaceKind;

interface LoadResult {
  workspace: Workspace;
  recoveryCopies: RecoveryCopy[];
  error: string;
  blocked: boolean;
  corruptRaw: string | null;
  corruptSourceKey: string | null;
  needsV2Write: boolean;
}

const INITIAL_SCENARIO: Scenario = "twohundred";
const EMPTY_WEIGHTS: MatrixWeights = {
  "direction-timely": 1,
  "direction-sustained": 1,
  "support-timely": 1,
  "support-sustained": 1,
};

function nowIso(): string {
  return new Date().toISOString();
}

function recoveryId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `recovery-${globalThis.crypto.randomUUID()}`;
  }
  return `recovery-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function freshWorkspace(
  kind: WorkspaceKind,
  scenario = INITIAL_SCENARIO
): Workspace {
  const day = today();
  const sample =
    kind === "demo"
      ? makeSampleProjects(makeSampleTasks(scenario, day), day)
      : { tasks: [], projects: [] };
  // Sample ideas start on Front of Mind, as a saved workspace's would.
  return moveIdeasToFrontOfMind({
    version: 2,
    tasks: sample.tasks,
    projects: sample.projects,
    focus: null,
    intention: null,
    matrixWeights: { ...EMPTY_WEIGHTS },
    trial: { startedAt: nowIso(), lastExportAt: null, lastReviewAt: null },
    planning: { ...DEFAULT_PLANNING },
    imperatives: [],
    reviews: [],
    goals: [],
    obligations: [],
  });
}

function preferred(): WorkspaceKind {
  try {
    return localStorage.getItem(preferredWorkspaceKey) === "personal"
      ? "personal"
      : "demo";
  } catch {
    return "demo";
  }
}

function parseRecovery(kind: WorkspaceKind): {
  copies: RecoveryCopy[];
  error: string;
} {
  try {
    const raw = localStorage.getItem(recoveryKey(kind));
    if (!raw) return { copies: [], error: "" };
    return { copies: validateRecoveryCopies(JSON.parse(raw)), error: "" };
  } catch {
    // A bad recovery list must never make a readable primary workspace unusable.
    return {
      copies: [],
      error:
        "Local recovery copies could not be read. Your current workspace is unchanged; export a full backup now.",
    };
  }
}

function protectedLoad(
  kind: WorkspaceKind,
  raw: string,
  sourceKey: string,
  recoveryCopies: RecoveryCopy[],
  recoveryError: string
): LoadResult {
  return {
    workspace: freshWorkspace(kind),
    recoveryCopies,
    error:
      recoveryError ||
      "Saved data could not be read. It has not been overwritten. Export the raw saved data or restore a checked backup before continuing.",
    blocked: true,
    corruptRaw: raw,
    corruptSourceKey: sourceKey,
    needsV2Write: false,
  };
}

function load(kind: WorkspaceKind): LoadResult {
  const recovery = parseRecovery(kind);
  let v2Raw: string | null;
  try {
    v2Raw = localStorage.getItem(workspaceKey(kind));
  } catch {
    return {
      workspace: freshWorkspace(kind),
      recoveryCopies: recovery.copies,
      error:
        "Browser storage is unavailable. Changes can only stay in memory; export a backup before closing.",
      blocked: false,
      corruptRaw: null,
      corruptSourceKey: null,
      needsV2Write: false,
    };
  }

  if (v2Raw !== null) {
    try {
      const parsed: unknown = JSON.parse(v2Raw);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed) ||
        (parsed as { version?: unknown }).version !== 2
      ) {
        throw new Error("v2 workspace has an unknown version");
      }
      return {
        workspace: validateWorkspace(parsed),
        recoveryCopies: recovery.copies,
        error: recovery.error,
        blocked: false,
        corruptRaw: null,
        corruptSourceKey: null,
        needsV2Write: false,
      };
    } catch {
      return protectedLoad(
        kind,
        v2Raw,
        workspaceKey(kind),
        recovery.copies,
        recovery.error
      );
    }
  }

  // Keep a v1 key immutable. A valid v1 workspace is copied into v2 after the
  // hook mounts; invalid bytes stay where they are and put this kind in read-only.
  let v1Raw: string | null;
  try {
    v1Raw = localStorage.getItem(legacyWorkspaceKey(kind));
  } catch {
    v1Raw = null;
  }
  if (v1Raw !== null) {
    try {
      const parsed: unknown = JSON.parse(v1Raw);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed) ||
        (parsed as { version?: unknown }).version !== 1
      ) {
        throw new Error("v1 workspace has an unknown version");
      }
      return {
        workspace: validateWorkspace(parsed),
        recoveryCopies: recovery.copies,
        error: recovery.error,
        blocked: false,
        corruptRaw: null,
        corruptSourceKey: null,
        needsV2Write: true,
      };
    } catch {
      return protectedLoad(
        kind,
        v1Raw,
        legacyWorkspaceKey(kind),
        recovery.copies,
        recovery.error
      );
    }
  }

  return {
    workspace: freshWorkspace(kind),
    recoveryCopies: recovery.copies,
    error: recovery.error,
    blocked: false,
    corruptRaw: null,
    corruptSourceKey: null,
    needsV2Write: true,
  };
}

function storageFailure(): string {
  return "Changes are in memory only: browser storage is unavailable or full. Download a full backup before closing.";
}

/**
 * Browser-local v2 workspaces. Recovery snapshots are deliberately separate
 * from ordinary focus writes: a timer tick should preserve focus but not create
 * a growing set of full-workspace copies.
 */
export function useWorkspace() {
  const [kind, setKind] = useState<WorkspaceKind>(preferred);
  const initial = useRef<LoadResult | null>(null);
  if (!initial.current) initial.current = load(kind);

  const [workspace, setWorkspace] = useState<Workspace>(
    initial.current.workspace
  );
  const [recoveryCopies, setRecoveryCopies] = useState<RecoveryCopy[]>(
    initial.current.recoveryCopies
  );
  const [storageError, setStorageError] = useState(initial.current.error);
  const [readOnly, setReadOnly] = useState(initial.current.blocked);
  const [corruptRaw, setCorruptRaw] = useState<string | null>(
    initial.current.corruptRaw
  );
  const [previous, setPrevious] = useState<Workspace | null>(null);
  const [generation, setGeneration] = useState(0);
  const generationRef = useRef(0);

  const workspaceRef = useRef(workspace);
  const recoveryRef = useRef(recoveryCopies);
  const kindRef = useRef(kind);
  const blockedRef = useRef(readOnly);
  const corruptRawRef = useRef(initial.current.corruptRaw);
  const corruptSourceKeyRef = useRef(initial.current.corruptSourceKey);
  const initialWriteRef = useRef(initial.current.needsV2Write);

  const writeWorkspace = useCallback(
    (targetKind: WorkspaceKind, next: Workspace): string | null => {
      try {
        localStorage.setItem(workspaceKey(targetKind), JSON.stringify(next));
        return null;
      } catch {
        return storageFailure();
      }
    },
    []
  );

  const writeRecoveryCopies = useCallback(
    (targetKind: WorkspaceKind, copies: RecoveryCopy[]): string | null => {
      try {
        localStorage.setItem(recoveryKey(targetKind), JSON.stringify(copies));
        return null;
      } catch {
        return "Your current change may be saved, but a local recovery copy could not be made. Download a full backup now.";
      }
    },
    []
  );

  const reportStorage = useCallback((message: string | null) => {
    setStorageError(message ?? "");
  }, []);

  const setCurrentWorkspace = useCallback((next: Workspace) => {
    workspaceRef.current = next;
    setWorkspace(next);
  }, []);

  const snapshotCurrent = useCallback(
    (force = false): string | null => {
      if (blockedRef.current) return "";
      const at = nowIso();
      const nextCopies = addRecoveryCopy(
        recoveryRef.current,
        workspaceRef.current,
        at,
        recoveryId(),
        force
      );
      if (nextCopies === recoveryRef.current) return null;
      const writeError = writeRecoveryCopies(kindRef.current, nextCopies);
      if (writeError) return writeError;
      recoveryRef.current = nextCopies;
      setRecoveryCopies(nextCopies);
      return null;
    },
    [writeRecoveryCopies]
  );

  // A migration/new workspace write happens only after rendering and only to v2;
  // the original v1 key is never updated or removed.
  useEffect(() => {
    if (!initialWriteRef.current || blockedRef.current) return;
    initialWriteRef.current = false;
    reportStorage(writeWorkspace(kindRef.current, workspaceRef.current));
  }, [reportStorage, writeWorkspace]);

  const mutate = useCallback(
    (change: (current: Workspace) => Workspace): boolean => {
      if (blockedRef.current) return false;
      const current = workspaceRef.current;
      let next: Workspace;
      try {
        next = validateWorkspace(change(current));
      } catch {
        setStorageError(
          "This change was not saved because it did not form a valid workspace."
        );
        return false;
      }

      // Capture the pre-change workspace once per day. Failure is visible, but
      // does not pretend that a recovery copy exists when only the main write did.
      const snapshotError = snapshotCurrent();
      setPrevious(current);
      setCurrentWorkspace(next);
      const writeError = writeWorkspace(kindRef.current, next);
      reportStorage(writeError ?? snapshotError);
      return writeError === null;
    },
    [reportStorage, setCurrentWorkspace, snapshotCurrent, writeWorkspace]
  );

  const undo = useCallback(() => {
    if (blockedRef.current || !previous) return false;
    const restored = validateWorkspace(previous);
    const writeError = writeWorkspace(kindRef.current, restored);
    if (writeError) {
      reportStorage(writeError);
      return false;
    }
    generationRef.current += 1;
    setGeneration(generationRef.current);
    setCurrentWorkspace(restored);
    setPrevious(null);
    reportStorage(null);
    return true;
  }, [previous, reportStorage, setCurrentWorkspace, writeWorkspace]);

  const saveFocus = useCallback(
    (focus: FocusSession | null, expectedGeneration?: number): boolean => {
      if (
        blockedRef.current ||
        (expectedGeneration !== undefined &&
          expectedGeneration !== generationRef.current)
      )
        return false;
      try {
        const next = validateWorkspace({ ...workspaceRef.current, focus });
        setCurrentWorkspace(next);
        const writeError = writeWorkspace(kindRef.current, next);
        reportStorage(writeError);
        return writeError === null;
      } catch {
        setStorageError(
          "Focus could not be saved because its task is no longer available."
        );
        return false;
      }
    },
    [reportStorage, setCurrentWorkspace, writeWorkspace]
  );

  const updateTrial = useCallback(
    (key: "lastExportAt" | "lastReviewAt"): boolean => {
      if (blockedRef.current) return false;
      const next = validateWorkspace({
        ...workspaceRef.current,
        trial: { ...workspaceRef.current.trial, [key]: nowIso() },
      });
      setCurrentWorkspace(next);
      const writeError = writeWorkspace(kindRef.current, next);
      reportStorage(writeError);
      return writeError === null;
    },
    [reportStorage, setCurrentWorkspace, writeWorkspace]
  );

  const markExported = useCallback(
    () => updateTrial("lastExportAt"),
    [updateTrial]
  );
  const markReviewed = useCallback(
    () => updateTrial("lastReviewAt"),
    [updateTrial]
  );

  const restoreBackup = useCallback(
    (candidate: Workspace): boolean => {
      let restored: Workspace;
      try {
        restored = validateWorkspace(candidate);
      } catch {
        setStorageError(
          "The checked backup was not valid, so nothing was replaced."
        );
        return false;
      }

      // A corrupt primary record is never overwritten until its raw bytes have
      // been retained under a separate key. This enables an explicit raw export
      // even after a successful restore.
      if (blockedRef.current && corruptRawRef.current !== null) {
        try {
          localStorage.setItem(
            corruptCopyKey(kindRef.current, nowIso()),
            corruptRawRef.current
          );
        } catch {
          setStorageError(
            "The original unreadable data could not be preserved, so restore was cancelled. Export the raw data if possible and free browser storage first."
          );
          return false;
        }
      } else if (!blockedRef.current) {
        // Deliberate replacement gets an exact pre-restore recovery copy even
        // when one was already captured earlier today.
        const snapshotError = snapshotCurrent(true);
        if (snapshotError) {
          setStorageError(
            "A pre-restore recovery copy could not be saved, so restore was cancelled. Download a full backup or free browser storage first."
          );
          return false;
        }
      }

      const writeError = writeWorkspace(kindRef.current, restored);
      if (writeError) {
        reportStorage(writeError);
        return false;
      }
      generationRef.current += 1;
      setGeneration(generationRef.current);
      blockedRef.current = false;
      corruptRawRef.current = null;
      corruptSourceKeyRef.current = null;
      setReadOnly(false);
      setCorruptRaw(null);
      setPrevious(null);
      setCurrentWorkspace(restored);
      reportStorage(null);
      return true;
    },
    [reportStorage, setCurrentWorkspace, snapshotCurrent, writeWorkspace]
  );

  const switchKind = useCallback((nextKind: WorkspaceKind) => {
    if (nextKind === kindRef.current) return;
    const loaded = load(nextKind);
    generationRef.current += 1;
    setGeneration(generationRef.current);
    kindRef.current = nextKind;
    blockedRef.current = loaded.blocked;
    corruptRawRef.current = loaded.corruptRaw;
    corruptSourceKeyRef.current = loaded.corruptSourceKey;
    initialWriteRef.current = loaded.needsV2Write;
    workspaceRef.current = loaded.workspace;
    recoveryRef.current = loaded.recoveryCopies;
    setKind(nextKind);
    setWorkspace(loaded.workspace);
    setRecoveryCopies(loaded.recoveryCopies);
    setStorageError(loaded.error);
    setReadOnly(loaded.blocked);
    setCorruptRaw(loaded.corruptRaw);
    setPrevious(null);

    // Switching is a user choice, so preserve it even when the selected v2
    // document was already present. A failed preferred-key write is surfaced.
    try {
      localStorage.setItem(preferredWorkspaceKey, nextKind);
    } catch {
      setStorageError(storageFailure());
    }
  }, []);

  // Perform a deferred v1 migration/new-workspace write after a workspace switch.
  useEffect(() => {
    if (!initialWriteRef.current || blockedRef.current) return;
    initialWriteRef.current = false;
    reportStorage(writeWorkspace(kind, workspaceRef.current));
  }, [kind, reportStorage, writeWorkspace]);

  const loadDemo = useCallback(
    (scenario: Scenario) => {
      // Scenario controls can never replace personal work or protected bytes.
      if (kindRef.current !== "demo" || blockedRef.current) return false;
      return mutate(() => freshWorkspace("demo", scenario));
    },
    [mutate]
  );

  return {
    kind,
    generation,
    workspace,
    storageError,
    mutate,
    undo,
    canUndo: !!previous,
    switchKind,
    loadDemo,
    saveFocus,
    readOnly,
    recoveryCopies,
    corruptRaw,
    corruptStorageKey: corruptSourceKeyRef.current,
    markExported,
    markReviewed,
    restoreBackup,
  };
}
