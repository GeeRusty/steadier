import { describe, expect, it } from "vitest";
import type { CompassKeyInfo } from "../../shared/cloud";
import {
  saveWorkspace,
  type SteadierRepository,
  type StoredCompassKey,
  type StoredWorkspace,
} from "./service";
import { emptyWorkspace } from "./validation";

describe("saveWorkspace", () => {
  it("acknowledges the exact CAS candidate when another revision commits before a legacy reread", async () => {
    const userId = 1;
    const initialWorkspace = emptyWorkspace();
    const savedWorkspace = emptyWorkspace();
    savedWorkspace.trial.lastReviewAt = "2026-10-24T00:00:00.000Z";
    const interveningWorkspace = emptyWorkspace();
    interveningWorkspace.trial.lastReviewAt = "2026-10-25T00:00:00.000Z";

    let stored: StoredWorkspace | null = {
      userId,
      workspace: initialWorkspace,
      revision: 4,
      updatedAt: "2026-10-20T00:00:00.000Z",
      timeZone: "UTC",
      focusOwnerClientId: null,
    };
    let reads = 0;
    let interleaveNextSuccessfulWrite = true;

    const repository: SteadierRepository = {
      async readWorkspace(requestedUserId) {
        expect(requestedUserId).toBe(userId);
        reads += 1;
        return stored;
      },
      async listWorkspaceRecoveries() {
        return [];
      },
      async insertWorkspace() {
        return false;
      },
      async updateWorkspace(candidate) {
        if (!stored || candidate.baseRevision !== stored.revision) return false;
        stored = {
          ...candidate,
          updatedAt: candidate.updatedAt.toISOString(),
        };

        // This is the revision an old implementation's post-success reread could
        // incorrectly return as the acknowledgement for the candidate above.
        if (interleaveNextSuccessfulWrite) {
          interleaveNextSuccessfulWrite = false;
          stored = {
            userId,
            workspace: interveningWorkspace,
            revision: 6,
            updatedAt: "2026-10-24T00:00:01.000Z",
            timeZone: "Pacific/Auckland",
            focusOwnerClientId: "other-device",
          };
        }
        return true;
      },
      async listCompassKeys(): Promise<CompassKeyInfo[]> {
        return [];
      },
      async createCompassKey() {
        throw new Error("not used by this test");
      },
      async revokeCompassKey() {
        return false;
      },
      async findCompassKeyByHash(): Promise<StoredCompassKey | null> {
        return null;
      },
      async touchCompassKey() {
        // Not used by this test.
      },
      async checkSchema() {
        // Not used by this test.
      },
    };

    const savedAt = new Date("2026-10-24T00:00:00.000Z");
    const acknowledgement = await saveWorkspace(
      repository,
      userId,
      {
        workspace: savedWorkspace,
        baseRevision: 4,
        clientId: "laptop",
        timeZone: "Australia/Adelaide",
      },
      savedAt
    );

    expect(acknowledgement).toEqual({
      workspace: savedWorkspace,
      revision: 5,
      updatedAt: savedAt.toISOString(),
      timeZone: "Australia/Adelaide",
      focusOwnerClientId: null,
    });
    // The sole read is the base-revision check; a successful CAS must not reread.
    expect(reads).toBe(1);

    // A later local snapshot that retained the original acknowledgement's base
    // must visibly conflict with the intervening remote document, never rebase.
    await expect(
      saveWorkspace(repository, userId, {
        workspace: savedWorkspace,
        baseRevision: acknowledgement.revision,
        clientId: "laptop",
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      record: {
        workspace: interveningWorkspace,
        revision: 6,
        updatedAt: "2026-10-24T00:00:01.000Z",
        timeZone: "Australia/Adelaide",
        focusOwnerClientId: "other-device",
      },
    });
  });
});
