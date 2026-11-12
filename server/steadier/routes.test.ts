import { createServer, type Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { CompassKeyInfo } from "../../shared/cloud";
import { registerSteadierRoutes } from "./routes";
import type {
  NewStoredWorkspace,
  SteadierRepository,
  StoredCompassKey,
  StoredWorkspace,
} from "./service";
import { emptyWorkspace } from "./validation";

class MemoryRepository implements SteadierRepository {
  readonly workspaces = new Map<number, StoredWorkspace>();
  readonly recoveries: StoredWorkspace[] = [];
  readonly keys = new Map<number, StoredCompassKey>();
  private nextKeyId = 1;

  async readWorkspace(userId: number): Promise<StoredWorkspace | null> {
    return this.workspaces.get(userId) ?? null;
  }

  async listWorkspaceRecoveries(userId: number, limit: number) {
    return this.recoveries
      .filter(copy => copy.userId === userId)
      .slice(-limit)
      .reverse()
      .map((copy, index) => ({
        id: String(index + 1),
        at: copy.updatedAt,
        workspace: copy.workspace,
      }));
  }

  async insertWorkspace(workspace: NewStoredWorkspace): Promise<boolean> {
    if (this.workspaces.has(workspace.userId)) return false;
    this.workspaces.set(workspace.userId, {
      ...workspace,
      updatedAt: workspace.updatedAt.toISOString(),
    });
    return true;
  }

  async updateWorkspace(
    workspace: NewStoredWorkspace & {
      baseRevision: number;
      replacement: boolean;
    }
  ): Promise<boolean> {
    const prior = this.workspaces.get(workspace.userId);
    if (!prior || prior.revision !== workspace.baseRevision) return false;
    if (workspace.replacement) this.recoveries.push(prior);
    this.workspaces.set(workspace.userId, {
      ...workspace,
      updatedAt: workspace.updatedAt.toISOString(),
    });
    return true;
  }

  async listCompassKeys(userId: number): Promise<CompassKeyInfo[]> {
    return [...this.keys.values()]
      .filter(key => key.userId === userId)
      .map(({ userId: _userId, tokenHash: _tokenHash, ...info }) => info);
  }

  async createCompassKey(key: {
    userId: number;
    tokenHash: string;
    label: string;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<CompassKeyInfo> {
    const stored: StoredCompassKey = {
      id: this.nextKeyId++,
      userId: key.userId,
      tokenHash: key.tokenHash,
      label: key.label,
      createdAt: key.createdAt.toISOString(),
      expiresAt: key.expiresAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    };
    this.keys.set(stored.id, stored);
    const { userId: _userId, tokenHash: _tokenHash, ...info } = stored;
    return info;
  }

  async revokeCompassKey(
    userId: number,
    keyId: number,
    revokedAt: Date
  ): Promise<boolean> {
    const stored = this.keys.get(keyId);
    if (!stored || stored.userId !== userId) return false;
    stored.revokedAt = revokedAt.toISOString();
    return true;
  }

  async findCompassKeyByHash(
    tokenHash: string
  ): Promise<StoredCompassKey | null> {
    return (
      [...this.keys.values()].find(key => key.tokenHash === tokenHash) ?? null
    );
  }

  async touchCompassKey(keyId: number, usedAt: Date): Promise<void> {
    const stored = this.keys.get(keyId);
    if (stored) stored.lastUsedAt = usedAt.toISOString();
  }

  async checkSchema(): Promise<void> {
    // An in-memory test double deliberately reports ready.
  }
}

function testWorkspace(title = "Pay bill") {
  const workspace = emptyWorkspace();
  workspace.trial.startedAt = "2026-10-01T00:00:00.000Z";
  workspace.tasks = [
    {
      id: "task-1",
      title,
      nextAction: "Open the invoice",
      notes: "",
      state: "ready",
      pinned: false,
      deadline: "2026-10-30",
      startDate: null,
      reviewDate: "2026-10-25",
      deferredUntil: null,
      estimate: 15,
      context: "computer",
      waitingFor: "",
      dependencies: [],
      checklist: [],
      repeatDays: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      completedAt: null,
      history: [],
      purpose: "Keep household administration current.",
      role: "support",
      pattern: "timely",
      labelSource: "confirmed",
      projectId: null,
      preparationDate: "2026-10-23",
      preparationSource: "suggested",
      progressEvidence: "",
    },
  ];
  return workspace;
}

async function startTestServer(repository: MemoryRepository): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const app = express();
  app.use(express.json());
  registerSteadierRoutes(app, {
    repository,
    authenticateSession: async request => {
      if (request.get("x-test-user") === "cron") {
        return { id: -1, name: "scheduler", isCron: true };
      }
      if (request.get("x-test-user") === "1") return { id: 1, name: "Ada" };
      if (request.get("x-test-user") === "2") return { id: 2, name: "Bea" };
      throw new Error("not signed in");
    },
  });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test address");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        server => new Promise<void>(resolve => server.close(() => resolve()))
      )
  );
});

async function setup() {
  const repository = new MemoryRepository();
  const running = await startTestServer(repository);
  servers.push(running.server);
  return { repository, ...running };
}

const signedInHeaders = { "x-test-user": "1", "x-steadier-owner": "1" };
const writeHeaders = {
  ...signedInHeaders,
  "x-steadier-request": "1",
  "content-type": "application/json",
};

describe("Steadier private server routes", () => {
  it("requires a real signed-in numeric user and returns a valid empty record", async () => {
    const { baseUrl } = await setup();
    const unauthenticated = await fetch(`${baseUrl}/api/steadier/workspace`);
    expect(unauthenticated.status).toBe(401);

    const cron = await fetch(`${baseUrl}/api/steadier/session`, {
      headers: { "x-test-user": "cron" },
    });
    expect(cron.status).toBe(403);

    const response = await fetch(`${baseUrl}/api/steadier/workspace`, {
      headers: signedInHeaders,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    const record = await response.json();
    expect(record).toMatchObject({
      revision: 0,
      updatedAt: null,
      timeZone: "Australia/Adelaide",
    });
    expect(record.workspace).toMatchObject({
      version: 2,
      tasks: [],
      projects: [],
    });
  });

  it("requires a matching expected account for private reads and writes", async () => {
    const { baseUrl, repository } = await setup();
    const body = JSON.stringify({
      workspace: testWorkspace(),
      baseRevision: 0,
      clientId: "laptop",
    });

    // Session discovery is deliberately exempt so a client can learn its first owner id.
    const session = await fetch(`${baseUrl}/api/steadier/session`, {
      headers: { "x-test-user": "1" },
    });
    expect(session.status).toBe(200);

    const missingRead = await fetch(`${baseUrl}/api/steadier/workspace`, {
      headers: { "x-test-user": "1" },
    });
    expect(missingRead.status).toBe(403);
    expect((await missingRead.json()).code).toBe("ACCOUNT_BINDING_REQUIRED");

    // Simulates a cookie changed to account 2 while the client still expects account 1.
    const mismatchRead = await fetch(`${baseUrl}/api/steadier/workspace`, {
      headers: { "x-test-user": "2", "x-steadier-owner": "1" },
    });
    expect(mismatchRead.status).toBe(403);
    expect(await mismatchRead.json()).toEqual({
      code: "ACCOUNT_CHANGED",
      message:
        "The signed-in account differs from this request's expected account.",
    });

    const missingWrite = await fetch(`${baseUrl}/api/steadier/workspace`, {
      method: "PUT",
      headers: {
        "x-test-user": "1",
        "x-steadier-request": "1",
        "content-type": "application/json",
      },
      body,
    });
    expect(missingWrite.status).toBe(403);
    expect((await missingWrite.json()).code).toBe("ACCOUNT_BINDING_REQUIRED");

    const mismatchWrite = await fetch(`${baseUrl}/api/steadier/workspace`, {
      method: "PUT",
      headers: {
        "x-test-user": "2",
        "x-steadier-owner": "1",
        "x-steadier-request": "1",
        "content-type": "application/json",
      },
      body,
    });
    expect(mismatchWrite.status).toBe(403);
    expect((await mismatchWrite.json()).code).toBe("ACCOUNT_CHANGED");
    expect(repository.workspaces.size).toBe(0);
  });

  it("guards writes, applies CAS, preserves focus ownership, and snapshots explicit replacement", async () => {
    const { baseUrl, repository } = await setup();
    const workspace = testWorkspace();
    workspace.focus = {
      taskId: "task-1",
      remaining: 600,
      duration: 900,
      running: true,
      updatedAt: 1_790_000_000_000,
      step: "Open the invoice",
    };

    const unguarded = await fetch(`${baseUrl}/api/steadier/workspace`, {
      method: "PUT",
      headers: { ...signedInHeaders, "content-type": "application/json" },
      body: JSON.stringify({ workspace, baseRevision: 0, clientId: "laptop" }),
    });
    expect(unguarded.status).toBe(403);

    const first = await fetch(`${baseUrl}/api/steadier/workspace`, {
      method: "PUT",
      headers: writeHeaders,
      body: JSON.stringify({
        workspace,
        baseRevision: 0,
        clientId: "laptop",
        timeZone: "Australia/Adelaide",
        claimFocus: true,
      }),
    });
    expect(first.status).toBe(200);
    expect((await first.json()).focusOwnerClientId).toBe("laptop");

    const stale = await fetch(`${baseUrl}/api/steadier/workspace`, {
      method: "PUT",
      headers: writeHeaders,
      body: JSON.stringify({ workspace, baseRevision: 0, clientId: "phone" }),
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("CONFLICT");

    const changedFocus = structuredClone(workspace);
    changedFocus.focus!.remaining = 590;
    const ownership = await fetch(`${baseUrl}/api/steadier/workspace`, {
      method: "PUT",
      headers: writeHeaders,
      body: JSON.stringify({
        workspace: changedFocus,
        baseRevision: 1,
        clientId: "phone",
      }),
    });
    expect(ownership.status).toBe(409);
    expect((await ownership.json()).code).toBe("FOCUS_OWNERSHIP");

    const clearedFocus = structuredClone(workspace);
    clearedFocus.focus = null;
    const foreignClear = await fetch(`${baseUrl}/api/steadier/workspace`, {
      method: "PUT",
      headers: writeHeaders,
      body: JSON.stringify({
        workspace: clearedFocus,
        baseRevision: 1,
        clientId: "phone",
      }),
    });
    expect(foreignClear.status).toBe(409);
    expect((await foreignClear.json()).code).toBe("FOCUS_OWNERSHIP");

    const pausedFocus = structuredClone(workspace);
    pausedFocus.focus!.running = false;
    const foreignPause = await fetch(`${baseUrl}/api/steadier/workspace`, {
      method: "PUT",
      headers: writeHeaders,
      body: JSON.stringify({
        workspace: pausedFocus,
        baseRevision: 1,
        clientId: "phone",
      }),
    });
    expect(foreignPause.status).toBe(409);
    expect((await foreignPause.json()).code).toBe("FOCUS_OWNERSHIP");

    const unchangedFocus = structuredClone(workspace);
    unchangedFocus.tasks[0].notes = "A safe unrelated edit.";
    const second = await fetch(`${baseUrl}/api/steadier/workspace`, {
      method: "PUT",
      headers: writeHeaders,
      body: JSON.stringify({
        workspace: unchangedFocus,
        baseRevision: 1,
        clientId: "phone",
        replacement: true,
      }),
    });
    expect(second.status).toBe(200);
    expect((await second.json()).focusOwnerClientId).toBe("laptop");
    expect(repository.recoveries).toHaveLength(1);
    expect(repository.recoveries[0].revision).toBe(1);

    const recoveries = await fetch(`${baseUrl}/api/steadier/recoveries`, {
      headers: signedInHeaders,
    });
    expect(recoveries.status).toBe(200);
    const recoveryBody = await recoveries.json();
    expect(recoveryBody.copies).toHaveLength(1);
    expect(recoveryBody.copies[0]).toMatchObject({
      id: "1",
      workspace: { version: 2, tasks: [{ id: "task-1", notes: "" }] },
    });

    const claimedPause = structuredClone(unchangedFocus);
    claimedPause.focus!.running = false;
    const claimed = await fetch(`${baseUrl}/api/steadier/workspace`, {
      method: "PUT",
      headers: writeHeaders,
      body: JSON.stringify({
        workspace: claimedPause,
        baseRevision: 2,
        clientId: "phone",
        claimFocus: true,
      }),
    });
    expect(claimed.status).toBe(200);
    expect((await claimed.json()).focusOwnerClientId).toBeNull();
  });

  it("exposes full formula-safe CSV to session users and only opaque bearer keys to Compass", async () => {
    const { baseUrl } = await setup();
    const workspace = testWorkspace(
      '=IMPORTXML("https://not-a-formula.example")'
    );
    const stored = await fetch(`${baseUrl}/api/steadier/workspace`, {
      method: "PUT",
      headers: writeHeaders,
      body: JSON.stringify({ workspace, baseRevision: 0, clientId: "laptop" }),
    });
    expect(stored.status).toBe(200);

    const keyResponse = await fetch(`${baseUrl}/api/steadier/compass-keys`, {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({ label: "My Compass" }),
    });
    expect(keyResponse.status).toBe(201);
    const key = await keyResponse.json();
    expect(key.token).toMatch(/^stdr_/);
    expect(key.info.label).toBe("My Compass");

    const sessionProjection = await fetch(`${baseUrl}/api/steadier/sheet`, {
      headers: signedInHeaders,
    });
    expect(sessionProjection.status).toBe(200);
    expect(sessionProjection.headers.get("content-type")).toContain(
      "application/json"
    );
    expect((await sessionProjection.json()).workspace.tasks).toHaveLength(1);

    const sessionCsv = await fetch(`${baseUrl}/api/steadier/sheet.csv`, {
      headers: signedInHeaders,
    });
    expect(sessionCsv.status).toBe(200);
    expect(sessionCsv.headers.get("content-type")).toContain("text/csv");
    expect(await sessionCsv.text()).toContain("'=IMPORTXML");

    const sessionPretendingToBeCompass = await fetch(
      `${baseUrl}/api/compass/context`,
      {
        headers: { ...signedInHeaders, authorization: "Bearer session-token" },
      }
    );
    expect(sessionPretendingToBeCompass.status).toBe(401);

    const context = await fetch(`${baseUrl}/api/compass/context`, {
      headers: { authorization: `Bearer ${key.token}` },
    });
    expect(context.status).toBe(200);
    const body = await context.json();
    expect(body.workspace.tasks).toHaveLength(1);
    expect(body.derived.tasks).toHaveLength(1);
    expect(body.freshness.warning).toContain("unsynced");

    const compassCsv = await fetch(`${baseUrl}/api/compass/sheet.csv`, {
      headers: { authorization: `Bearer ${key.token}` },
    });
    expect(compassCsv.status).toBe(200);
    expect(await compassCsv.text()).toContain("'=IMPORTXML");
  });
});
