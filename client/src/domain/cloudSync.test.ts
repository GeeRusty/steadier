import { describe, expect, it } from "vitest";
import {
  acknowledgeCloudWrite,
  createCloudCache,
  hasRemoteRunningFocus,
  isAccountGuardFailure,
  isCurrentGeneration,
  isExpectedCloudAcknowledgement,
  markCloudCacheSynced,
  makeCloudWrite,
  reconcileFetchedCloudRecord,
  reconcileUncertainCloudWrite,
  serializeCloudWrite,
  validateCloudCache,
  validateCloudRecoveries,
  validateCloudRecord,
  type CloudPending,
} from "./cloudSync";
import { createTask } from "./engine";
import type { Workspace } from "./types";

const stamp = "2026-10-24T09:00:00.000Z";
const user = { id: 71, name: "A private person" };

function workspace(title = "Keep a small promise"): Workspace {
  const task = createTask({ title, nextAction: "Do one visible step" }, "2026-10-24");
  return {
    version: 2,
    tasks: [task],
    projects: [],
    focus: null,
    intention: null,
    matrixWeights: {
      "direction-timely": 1,
      "direction-sustained": 1,
      "support-timely": 1,
      "support-sustained": 1,
    },
    trial: { startedAt: stamp, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [],
  };
}

function record(
  source = workspace(),
  revision = 4,
  focusOwnerClientId: string | null = null
) {
  return {
    workspace: source,
    revision,
    updatedAt: stamp,
    timeZone: "Australia/Adelaide",
    focusOwnerClientId,
  };
}

function pending(
  source = workspace("Local edit"),
  baseRevision = 4,
  extra: Partial<CloudPending> = {}
): CloudPending {
  return {
    workspace: source,
    baseRevision,
    claimFocus: false,
    replacement: false,
    queuedAt: stamp,
    ...extra,
  };
}

describe("cloud shared-workspace synchronization", () => {
  it("serializes a validated complete CAS snapshot without unrelated fields", () => {
    const localVersion = workspace("Local version");
    const write = makeCloudWrite(
      pending(localVersion, 8, {
        claimFocus: true,
        replacement: true,
      }),
      "steadier-tab-one",
      "UTC"
    );
    expect(write).toMatchObject({
      baseRevision: 8,
      clientId: "steadier-tab-one",
      claimFocus: true,
      replacement: true,
      timeZone: "UTC",
    });
    expect(JSON.parse(serializeCloudWrite(pending(localVersion, 8), "tab"))).toEqual({
      workspace: localVersion,
      baseRevision: 8,
      clientId: "tab",
    });
  });

  it("does not replace a newer local cache edit with an older acknowledgement", () => {
    const base = record(workspace("Base"), 4);
    const sent = pending(workspace("Sent"), 4);
    const newer = pending(workspace("Newer"), 4);
    const cache = { ...createCloudCache(user, base), pending: newer };
    const applied = acknowledgeCloudWrite(cache, sent, record(sent.workspace, 5));
    expect(applied.replaceVisibleWorkspace).toBe(false);
    expect(applied.cache.server.revision).toBe(5);
    expect(applied.cache.pending).toMatchObject({
      workspace: newer.workspace,
      baseRevision: 5,
    });
  });

  it("keeps pending work visible when a PUT acknowledgement is not its exact candidate", () => {
    const base = record(workspace("Base"), 4);
    const sent = pending(workspace("Sent"), 4);
    const newer = pending(workspace("Newer"), 4);
    const cache = { ...createCloudCache(user, base), pending: newer };
    const mismatched = record(workspace("Other device"), 6);
    const applied = acknowledgeCloudWrite(cache, sent, mismatched);
    expect(isExpectedCloudAcknowledgement(sent, mismatched)).toBe(false);
    expect(applied.acknowledged).toBe(false);
    expect(applied.conflict).toEqual(mismatched);
    expect(applied.cache.pending).toEqual(newer);
    expect(applied.cache.server).toEqual(mismatched);
  });

  it("confirms an uncertain sent snapshot only when GET exactly matches it", () => {
    const base = record(workspace("Base"), 4);
    const sent = pending(workspace("Sent"), 4);
    const cache = { ...createCloudCache(user, base), pending: sent };
    const confirmed = reconcileUncertainCloudWrite(cache, sent, record(sent.workspace, 5));
    expect(confirmed.kind).toBe("acknowledged");
    if (confirmed.kind === "acknowledged") {
      expect(confirmed.cache.pending).toBeNull();
      expect(confirmed.cache.server.revision).toBe(5);
    }

    const changedElsewhere = reconcileUncertainCloudWrite(
      cache,
      sent,
      record(workspace("Other device"), 5)
    );
    expect(changedElsewhere.kind).toBe("conflict");
    if (changedElsewhere.kind === "conflict") {
      expect(changedElsewhere.cache.pending?.workspace).toEqual(sent.workspace);
      expect(changedElsewhere.conflict.workspace.tasks[0].title).toBe("Other device");
    }
  });

  it("keeps a pending edit when the fetched record is its exact known base", () => {
    const base = record(workspace("Base"), 4);
    const localPending = pending(workspace("Queued locally"), 4);
    const cache = { ...createCloudCache(user, base), pending: localPending };
    const reconciled = reconcileFetchedCloudRecord(cache, base);
    expect(reconciled.kind).toBe("pending");
    expect(reconciled.cache.pending?.workspace).toEqual(localPending.workspace);
  });

  it("uses a visible conflict rather than selecting a winner for divergent documents", () => {
    const base = record(workspace("Base"), 4);
    const localPending = pending(workspace("Offline local"), 4);
    const cache = { ...createCloudCache(user, base), pending: localPending };
    const reconciled = reconcileFetchedCloudRecord(
      cache,
      record(workspace("Remote device"), 5, "remote-tab")
    );
    expect(reconciled.kind).toBe("conflict");
    if (reconciled.kind === "conflict") {
      expect(reconciled.cache.pending?.workspace.tasks[0].title).toBe("Offline local");
      expect(reconciled.conflict.focusOwnerClientId).toBe("remote-tab");
    }
  });

  it("rejects cache account mismatches and malformed cloud records before use", () => {
    const cache = createCloudCache(user, record());
    expect(() => validateCloudCache({ ...cache, userId: 72 }, user.id)).toThrow(
      /another account/
    );
    expect(() =>
      validateCloudRecord({ ...record(), revision: -1 })
    ).toThrow(/revision/);
  });

  it("accepts legacy caches without sync metadata and records a checked local time", () => {
    const current = createCloudCache(user, record());
    const legacy = { ...current } as Record<string, unknown>;
    delete legacy.lastSyncedAt;
    const restored = validateCloudCache(legacy, user.id);
    expect(restored.lastSyncedAt).toBeUndefined();
    expect(markCloudCacheSynced(restored, stamp).lastSyncedAt).toBe(stamp);
    expect(() => markCloudCacheSynced(restored, "not-a-date")).toThrow(/sync time/);
  });

  it("validates bounded server recoveries independently from browser recovery cache", () => {
    const copies = validateCloudRecoveries({
      copies: [
        { id: "server-recovery-one", at: stamp, workspace: workspace("Server copy") },
      ],
    });
    expect(copies).toHaveLength(1);
    expect(copies[0].workspace.tasks[0].title).toBe("Server copy");
    expect(() => validateCloudRecoveries({ copies: [{ id: "x", at: "not-a-date", workspace: workspace() }] })).toThrow();
  });

  it("uses exact account/mode generation equality to reject stale callbacks", () => {
    expect(isCurrentGeneration(6, 6)).toBe(true);
    expect(isCurrentGeneration(6, 7)).toBe(false);
    expect(isCurrentGeneration(6.5, 6.5)).toBe(false);
  });

  it("recognizes account-binding failures without treating ordinary forbidden responses as a switch", () => {
    expect(isAccountGuardFailure(401, null)).toBe(true);
    expect(isAccountGuardFailure(403, { code: "ACCOUNT_CHANGED" })).toBe(true);
    expect(isAccountGuardFailure(403, { code: "UNAUTHORIZED" })).toBe(true);
    expect(isAccountGuardFailure(403, { code: "ACCOUNT_BINDING_REQUIRED" })).toBe(true);
    expect(isAccountGuardFailure(403, { code: "FORBIDDEN" })).toBe(false);
  });

  it("reports remote focus only for another client's acknowledged running server focus", () => {
    const running = workspace("Running remotely");
    running.focus = {
      taskId: running.tasks[0].id,
      step: "Continue",
      remaining: 300,
      duration: 600,
      running: true,
      updatedAt: Date.now(),
    };
    expect(hasRemoteRunningFocus(record(running, 4, "other-tab"), "this-tab")).toBe(true);
    expect(hasRemoteRunningFocus(record(running, 4, "this-tab"), "this-tab")).toBe(false);
    running.focus.running = false;
    expect(hasRemoteRunningFocus(record(running, 4, "other-tab"), "this-tab")).toBe(false);
  });
});
