import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthServerInfo,
} from "@modelcontextprotocol/client";
import {
  COMPASS_MCP_URL,
  COMPASS_OAUTH_ISSUER,
  COMPASS_OFFLINE_SCOPE,
  COMPASS_PUBLIC_ORIGIN,
  COMPASS_READ_SCOPE,
  COMPASS_READ_WRITE_SCOPE,
} from "../../shared/compassConnection";
import type { CompassKeyInfo } from "../../shared/cloud";
import { registerCompassOAuthRoutes } from "./compassOAuth";
import type {
  CompassOAuthClient,
  CompassOAuthRepository,
  NewCompassAuthorizationCode,
  NewCompassConsentRequest,
  NewCompassOAuthClient,
  StoredCompassAuthorizationCode,
  StoredCompassConsentRequest,
} from "./oauthRepository";
import {
  hashCompassToken,
  type NewStoredWorkspace,
  type SteadierRepository,
  type StoredCompassKey,
  type StoredWorkspace,
} from "./service";
import { emptyWorkspace } from "./validation";

class MemoryRepository implements SteadierRepository, CompassOAuthRepository {
  readonly workspaces = new Map<number, StoredWorkspace>();
  readonly keys = new Map<number, StoredCompassKey>();
  readonly clients = new Map<string, CompassOAuthClient>();
  readonly consents = new Map<string, StoredCompassConsentRequest>();
  readonly codes = new Map<string, StoredCompassAuthorizationCode>();
  workspaceWrites = 0;
  private nextKeyId = 1;

  constructor() {
    const workspace = emptyWorkspace();
    // Counts are deliberately non-zero to cover the exact consent-view contract.
    workspace.tasks = [{ id: "task-1" }] as typeof workspace.tasks;
    workspace.projects = [{ id: "project-1" }] as typeof workspace.projects;
    this.workspaces.set(1, {
      userId: 1,
      workspace,
      revision: 4,
      updatedAt: "2026-10-24T00:00:00.000Z",
      timeZone: "Australia/Adelaide",
      focusOwnerClientId: null,
    });
  }

  async readWorkspace(userId: number): Promise<StoredWorkspace | null> {
    return this.workspaces.get(userId) ?? null;
  }

  async listWorkspaceRecoveries() {
    return [];
  }

  async insertWorkspace(workspace: NewStoredWorkspace): Promise<boolean> {
    this.workspaceWrites += 1;
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
    this.workspaceWrites += 1;
    const prior = this.workspaces.get(workspace.userId);
    if (!prior || prior.revision !== workspace.baseRevision) return false;
    this.workspaces.set(workspace.userId, {
      ...workspace,
      updatedAt: workspace.updatedAt.toISOString(),
    });
    return true;
  }

  async listCompassKeys(userId: number): Promise<CompassKeyInfo[]> {
    return [...this.keys.values()]
      .filter(key => key.userId === userId)
      .map(
        ({
          userId: _userId,
          tokenHash: _tokenHash,
          refreshTokenHash: _refreshTokenHash,
          refreshExpiresAt: _refreshExpiresAt,
          oauthClientId: _oauthClientId,
          ...key
        }) => ({ ...key })
      );
  }

  async createCompassKey(
    key: Parameters<SteadierRepository["createCompassKey"]>[0]
  ): Promise<CompassKeyInfo> {
    const stored: StoredCompassKey = {
      id: this.nextKeyId++,
      userId: key.userId,
      tokenHash: key.tokenHash,
      label: key.label,
      createdAt: key.createdAt.toISOString(),
      expiresAt: key.expiresAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      scope: key.scope ?? "steadier:read",
      refreshTokenHash: key.refreshTokenHash ?? null,
      refreshExpiresAt: key.refreshExpiresAt?.toISOString() ?? null,
      oauthClientId: key.oauthClientId ?? null,
      ...(key.connectorActor ? { connectorActor: key.connectorActor } : {}),
    };
    this.keys.set(stored.id, stored);
    const {
      userId: _userId,
      tokenHash: _tokenHash,
      refreshTokenHash: _refreshTokenHash,
      refreshExpiresAt: _refreshExpiresAt,
      oauthClientId: _oauthClientId,
      ...info
    } = stored;
    return info;
  }

  async revokeCompassKey(
    userId: number,
    keyId: number,
    revokedAt: Date
  ): Promise<boolean> {
    const key = this.keys.get(keyId);
    if (!key || key.userId !== userId) return false;
    key.revokedAt = revokedAt.toISOString();
    return true;
  }

  async findCompassKeyByHash(
    tokenHash: string
  ): Promise<StoredCompassKey | null> {
    return (
      [...this.keys.values()].find(key => key.tokenHash === tokenHash) ?? null
    );
  }

  async findCompassKeyByRefreshHash(
    tokenHash: string
  ): Promise<StoredCompassKey | null> {
    return (
      [...this.keys.values()].find(key => key.refreshTokenHash === tokenHash) ??
      null
    );
  }

  async rotateCompassOAuthKey(input: {
    userId: number;
    keyId: number;
    clientId: string;
    priorRefreshHash: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    scope: string;
    expiresAt: Date;
    refreshExpiresAt: Date;
    rotatedAt: Date;
  }): Promise<boolean> {
    const key = this.keys.get(input.keyId);
    if (
      !key ||
      key.userId !== input.userId ||
      key.oauthClientId !== input.clientId ||
      key.refreshTokenHash !== input.priorRefreshHash ||
      key.revokedAt !== null ||
      !key.refreshExpiresAt ||
      Date.parse(key.refreshExpiresAt) <= input.rotatedAt.getTime()
    ) {
      return false;
    }
    key.tokenHash = input.accessTokenHash;
    key.refreshTokenHash = input.refreshTokenHash;
    key.expiresAt = input.expiresAt.toISOString();
    key.refreshExpiresAt = input.refreshExpiresAt.toISOString();
    key.scope = input.scope;
    key.lastUsedAt = input.rotatedAt.toISOString();
    return true;
  }

  async touchCompassKey(keyId: number, usedAt: Date): Promise<void> {
    const key = this.keys.get(keyId);
    if (key) key.lastUsedAt = usedAt.toISOString();
  }

  async checkSchema(): Promise<void> {
    // Test repository has no database schema.
  }

  async createClient(
    client: NewCompassOAuthClient
  ): Promise<CompassOAuthClient> {
    const stored: CompassOAuthClient = {
      ...client,
      redirectUris: [...client.redirectUris],
      createdAt: client.createdAt.toISOString(),
    };
    this.clients.set(stored.clientId, stored);
    return { ...stored, redirectUris: [...stored.redirectUris] };
  }

  async findClient(clientId: string): Promise<CompassOAuthClient | null> {
    const client = this.clients.get(clientId);
    return client
      ? { ...client, redirectUris: [...client.redirectUris] }
      : null;
  }

  async createConsentRequest(
    request: NewCompassConsentRequest
  ): Promise<StoredCompassConsentRequest> {
    const stored: StoredCompassConsentRequest = {
      ...request,
      ownerId: null,
      status: "pending",
      createdAt: request.createdAt.toISOString(),
      expiresAt: request.expiresAt.toISOString(),
      decidedAt: null,
    };
    this.consents.set(stored.id, stored);
    return { ...stored };
  }

  async claimConsentRequest(
    id: string,
    ownerId: number,
    now: Date
  ): Promise<StoredCompassConsentRequest | null> {
    const consent = this.consents.get(id);
    if (
      !consent ||
      consent.status !== "pending" ||
      Date.parse(consent.expiresAt) <= now.getTime() ||
      (consent.ownerId !== null && consent.ownerId !== ownerId)
    ) {
      return null;
    }
    consent.ownerId = ownerId;
    return { ...consent };
  }

  async decideConsentRequest(input: {
    id: string;
    ownerId: number;
    approve: boolean;
    authorizationCode?: NewCompassAuthorizationCode;
    now: Date;
  }): Promise<boolean> {
    const consent = this.consents.get(input.id);
    if (
      !consent ||
      consent.status !== "pending" ||
      consent.ownerId !== input.ownerId ||
      Date.parse(consent.expiresAt) <= input.now.getTime()
    ) {
      return false;
    }
    if (input.approve && !input.authorizationCode) return false;
    consent.status = input.approve ? "approved" : "denied";
    consent.decidedAt = input.now.toISOString();
    if (input.authorizationCode) {
      const code: StoredCompassAuthorizationCode = {
        ...input.authorizationCode,
        issuedAt: input.authorizationCode.issuedAt.toISOString(),
        expiresAt: input.authorizationCode.expiresAt.toISOString(),
        redeemedAt: null,
      };
      this.codes.set(code.codeHash, code);
    }
    return true;
  }

  async findAuthorizationCode(
    codeHash: string
  ): Promise<StoredCompassAuthorizationCode | null> {
    const code = this.codes.get(codeHash);
    return code ? { ...code } : null;
  }

  async consumeAuthorizationCode(input: {
    codeHash: string;
    clientId: string;
    redirectUri: string;
    resource: string;
    now: Date;
  }): Promise<boolean> {
    const code = this.codes.get(input.codeHash);
    if (
      !code ||
      code.redeemedAt !== null ||
      Date.parse(code.expiresAt) <= input.now.getTime() ||
      code.clientId !== input.clientId ||
      code.redirectUri !== input.redirectUri ||
      code.resource !== input.resource
    ) {
      return false;
    }
    code.redeemedAt = input.now.toISOString();
    return true;
  }
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

async function setup(): Promise<{
  repository: MemoryRepository;
  baseUrl: string;
}> {
  const repository = new MemoryRepository();
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  registerCompassOAuthRoutes(app, {
    repository,
    oauthRepository: repository,
    authenticateSession: async request => {
      if (request.get("x-test-user") === "1") return { id: 1, name: "Ada" };
      if (request.get("x-test-user") === "2") return { id: 2, name: "Bea" };
      throw new Error("not signed in");
    },
  });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port.");
  return { repository, baseUrl: `http://127.0.0.1:${address.port}` };
}

const ownerOneHeaders = { "x-test-user": "1", "x-steadier-owner": "1" };
const ownerTwoHeaders = { "x-test-user": "2", "x-steadier-owner": "2" };
const decisionHeaders = {
  ...ownerOneHeaders,
  "x-steadier-request": "1",
  "content-type": "application/json",
};

function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

async function registerClient(
  baseUrl: string,
  options: {
    clientName?: string;
    redirectUri?: string;
    grantTypes?: string[];
    scope?: string;
  } = {}
): Promise<{ clientId: string; redirectUri: string }> {
  const redirectUri =
    options.redirectUri ?? "https://claude.ai/oauth/callback?source=steadier";
  const response = await fetch(`${baseUrl}/api/compass/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: options.clientName ?? "Claude Desktop",
      redirect_uris: [redirectUri],
      grant_types: options.grantTypes ?? ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: options.scope ?? COMPASS_READ_SCOPE,
    }),
  });
  expect(response.status).toBe(201);
  const body = await response.json();
  return { clientId: body.client_id, redirectUri };
}

async function startAuthorization(
  baseUrl: string,
  client: { clientId: string; redirectUri: string },
  options: {
    verifier?: string;
    state?: string;
    resource?: string;
    scope?: string;
  } = {}
): Promise<{ ticket: string; verifier: string }> {
  const verifier = options.verifier ?? "v".repeat(64);
  const authorize = new URL(`${baseUrl}/api/compass/oauth/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", client.clientId);
  authorize.searchParams.set("redirect_uri", client.redirectUri);
  authorize.searchParams.set("scope", options.scope ?? COMPASS_READ_SCOPE);
  authorize.searchParams.set("resource", options.resource ?? COMPASS_MCP_URL);
  authorize.searchParams.set("state", options.state ?? "client-state");
  authorize.searchParams.set("code_challenge", challengeFor(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  const response = await fetch(authorize, { redirect: "manual" });
  expect(response.status).toBe(302);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const location = response.headers.get("location");
  expect(location).toMatch(
    new RegExp(
      `^${COMPASS_PUBLIC_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\?compass_oauth=`
    )
  );
  const ticket = new URL(location!).searchParams.get("compass_oauth");
  expect(ticket).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
  return { ticket: ticket!, verifier };
}

async function approve(
  baseUrl: string,
  ticket: string,
  access: "read" | "write" = "read",
  connectorActor: "claude" | "chatgpt" | "connector" = "connector"
): Promise<{ code: string; state: string | null }> {
  const response = await fetch(
    `${baseUrl}/api/compass/oauth/requests/${ticket}/decision`,
    {
      method: "POST",
      headers: decisionHeaders,
      body: JSON.stringify({ approve: true, access, connectorActor }),
    }
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  const redirect = new URL(body.redirectUrl);
  return {
    code: redirect.searchParams.get("code")!,
    state: redirect.searchParams.get("state"),
  };
}

async function issueCode(
  baseUrl: string,
  client: { clientId: string; redirectUri: string },
  verifier = "v".repeat(64),
  connectorActor: "claude" | "chatgpt" | "connector" = "claude"
): Promise<{ code: string; verifier: string }> {
  const authorization = await startAuthorization(baseUrl, client, { verifier });
  const approved = await approve(
    baseUrl,
    authorization.ticket,
    "read",
    connectorActor
  );
  return { code: approved.code, verifier };
}

async function redeem(
  baseUrl: string,
  values: Record<string, string>
): Promise<Response> {
  return fetch(`${baseUrl}/api/compass/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values).toString(),
  });
}

describe("Compass OAuth", () => {
  it("publishes standard metadata, accepts usable public DCR, and rejects unsafe redirects", async () => {
    const { baseUrl, repository } = await setup();
    const protectedMetadata = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource/api/compass/mcp`
    );
    expect(protectedMetadata.status).toBe(200);
    expect(protectedMetadata.headers.get("cache-control")).toContain("public");
    expect(await protectedMetadata.json()).toEqual({
      resource: COMPASS_MCP_URL,
      authorization_servers: [COMPASS_OAUTH_ISSUER],
      bearer_methods_supported: ["header"],
      scopes_supported: [
        COMPASS_READ_SCOPE,
        "steadier:write",
        "offline_access",
      ],
    });

    const asMetadata = await fetch(
      `${baseUrl}/.well-known/oauth-authorization-server/api/compass/oauth`
    );
    expect(await asMetadata.json()).toMatchObject({
      issuer: COMPASS_OAUTH_ISSUER,
      authorization_endpoint: `${COMPASS_OAUTH_ISSUER}/authorize`,
      token_endpoint: `${COMPASS_OAUTH_ISSUER}/token`,
      registration_endpoint: `${COMPASS_OAUTH_ISSUER}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: false,
    });

    const client = await registerClient(baseUrl);
    expect(client.clientId).toMatch(/^stdr_oauth_/);
    expect(repository.clients).toHaveLength(1);

    for (const redirectUri of [
      "http://localhost/callback",
      "https://client.example/callback#fragment",
      "https://user:pass@client.example/callback",
    ]) {
      const response = await fetch(`${baseUrl}/api/compass/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Unsafe client",
          redirect_uris: [redirectUri],
        }),
      });
      expect(response.status).toBe(400);
    }

    const invalidRedirect = new URL(`${baseUrl}/api/compass/oauth/authorize`);
    invalidRedirect.search = new URLSearchParams({
      response_type: "code",
      client_id: client.clientId,
      redirect_uri: "https://claude.ai/another-callback",
      code_challenge: challengeFor("v".repeat(64)),
      code_challenge_method: "S256",
    }).toString();
    const invalidAuthorization = await fetch(invalidRedirect, {
      redirect: "manual",
    });
    expect(invalidAuthorization.status).toBe(400);
    expect(repository.consents).toHaveLength(0);
  });

  it("registers ChatGPT's code-plus-refresh grant and defaults only an omitted optional name", async () => {
    const { baseUrl, repository } = await setup();
    const response = await fetch(`${baseUrl}/api/compass/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["https://chatgpt.com/api/mcp/auth_callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      client_name: "Unnamed OAuth client",
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
      scope: "steadier:read steadier:write offline_access",
    });
    expect(repository.keys.size).toBe(0);
    expect(repository.consents.size).toBe(0);
    expect(repository.workspaceWrites).toBe(0);
    const metadata = await fetch(
      `${baseUrl}/.well-known/oauth-authorization-server/api/compass/oauth`
    );
    expect((await metadata.json()).grant_types_supported).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
  });

  it("issues ChatGPT offline access only after consent and rotates refresh credentials once, bound to client and revocation", async () => {
    const { baseUrl, repository } = await setup();
    const requestedScope = `${COMPASS_READ_WRITE_SCOPE} ${COMPASS_OFFLINE_SCOPE}`;
    const chatgpt = await registerClient(baseUrl, {
      clientName: "ChatGPT",
      redirectUri: "https://chatgpt.com/oauth/callback",
      grantTypes: ["authorization_code", "refresh_token"],
      scope: requestedScope,
    });
    const authorization = await startAuthorization(baseUrl, chatgpt, {
      scope: requestedScope,
    });
    const consentResponse = await fetch(
      `${baseUrl}/api/compass/oauth/requests/${authorization.ticket}`,
      { headers: ownerOneHeaders }
    );
    expect(await consentResponse.json()).toMatchObject({
      connectorActor: "connector",
      offlineAccess: true,
      requestedScope: COMPASS_READ_WRITE_SCOPE,
    });

    const approved = await approve(
      baseUrl,
      authorization.ticket,
      "write",
      "chatgpt"
    );
    const initialResponse = await redeem(baseUrl, {
      grant_type: "authorization_code",
      client_id: chatgpt.clientId,
      code: approved.code,
      redirect_uri: chatgpt.redirectUri,
      code_verifier: authorization.verifier,
      resource: COMPASS_MCP_URL,
    });
    expect(initialResponse.status).toBe(200);
    const initial = await initialResponse.json();
    expect(initial).toMatchObject({
      token_type: "Bearer",
      scope: `${COMPASS_READ_WRITE_SCOPE} ${COMPASS_OFFLINE_SCOPE}`,
    });
    expect(initial.access_token).toMatch(/^stdr_/);
    expect(initial.refresh_token).toMatch(/^stdr_rt_/);
    const key = [...repository.keys.values()][0]!;
    expect(key.connectorActor).toBe("chatgpt");
    expect(key.oauthClientId).toBe(chatgpt.clientId);
    expect(key.refreshTokenHash).toBe(hashCompassToken(initial.refresh_token));

    const otherClient = await registerClient(baseUrl, {
      clientName: "Other app",
      redirectUri: "https://chatgpt.com/other-callback",
      grantTypes: ["authorization_code", "refresh_token"],
      scope: requestedScope,
    });
    const crossClient = await redeem(baseUrl, {
      grant_type: "refresh_token",
      client_id: otherClient.clientId,
      refresh_token: initial.refresh_token,
      resource: COMPASS_MCP_URL,
    });
    expect(crossClient.status).toBe(400);

    const rotatedResponse = await redeem(baseUrl, {
      grant_type: "refresh_token",
      client_id: chatgpt.clientId,
      refresh_token: initial.refresh_token,
      scope: COMPASS_OFFLINE_SCOPE,
      resource: COMPASS_MCP_URL,
    });
    expect(rotatedResponse.status).toBe(200);
    const rotated = await rotatedResponse.json();
    expect(rotated.access_token).not.toBe(initial.access_token);
    expect(rotated.refresh_token).not.toBe(initial.refresh_token);
    expect(rotated.scope).toBe(requestedScope);

    const replay = await redeem(baseUrl, {
      grant_type: "refresh_token",
      client_id: chatgpt.clientId,
      refresh_token: initial.refresh_token,
      resource: COMPASS_MCP_URL,
    });
    expect(replay.status).toBe(400);

    await repository.revokeCompassKey(1, key.id, new Date());
    const revoked = await redeem(baseUrl, {
      grant_type: "refresh_token",
      client_id: chatgpt.clientId,
      refresh_token: rotated.refresh_token,
      resource: COMPASS_MCP_URL,
    });
    expect(revoked.status).toBe(400);
  });

  it("still rejects unsupported grants, supplied invalid names, secret-client methods and extra scopes", async () => {
    const { baseUrl, repository } = await setup();
    for (const overrides of [
      { grant_types: ["refresh_token"] },
      { grant_types: ["client_credentials"] },
      { grant_types: ["authorization_code", "client_credentials"] },
      { grant_types: ["authorization_code", "authorization_code"] },
      { client_name: "" },
      { client_name: null },
      { token_endpoint_auth_method: "client_secret_post" },
      { scope: "steadier:read steadier:admin" },
      { scope: "openid" },
    ]) {
      const response = await fetch(`${baseUrl}/api/compass/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Public test client",
          redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          ...overrides,
        }),
      });
      expect(response.status).toBe(400);
    }
    expect(repository.clients.size).toBe(0);
    expect(repository.keys.size).toBe(0);
    expect(repository.workspaceWrites).toBe(0);
  });

  it("passes strict SDK discovery for root fallback and the unchanged canonical issuer", async () => {
    const { baseUrl, repository } = await setup();
    const trace: string[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      );
      expect(url.origin).toBe(COMPASS_PUBLIC_ORIGIN);
      trace.push(url.pathname);
      return fetch(`${baseUrl}${url.pathname}${url.search}`, init);
    };
    const root = await discoverAuthorizationServerMetadata(
      COMPASS_PUBLIC_ORIGIN,
      { fetchFn }
    );
    const canonical = await discoverAuthorizationServerMetadata(
      COMPASS_OAUTH_ISSUER,
      { fetchFn }
    );
    expect(root?.issuer).toBe(COMPASS_PUBLIC_ORIGIN);
    expect(canonical?.issuer).toBe(COMPASS_OAUTH_ISSUER);
    for (const metadata of [root, canonical]) {
      expect(metadata?.authorization_endpoint).toBe(
        `${COMPASS_OAUTH_ISSUER}/authorize`
      );
      expect(metadata?.token_endpoint).toBe(`${COMPASS_OAUTH_ISSUER}/token`);
      expect(metadata?.registration_endpoint).toBe(
        `${COMPASS_OAUTH_ISSUER}/register`
      );
      expect(metadata?.code_challenge_methods_supported).toEqual(["S256"]);
    }
    const discovered = await discoverOAuthServerInfo(COMPASS_MCP_URL, {
      fetchFn,
    });
    expect(discovered.authorizationServerUrl).toBe(COMPASS_OAUTH_ISSUER);
    expect(discovered.authorizationServerMetadata?.issuer).toBe(
      COMPASS_OAUTH_ISSUER
    );
    expect(trace).toContain("/.well-known/oauth-authorization-server");
    expect(trace).toContain(
      "/.well-known/oauth-authorization-server/api/compass/oauth"
    );
    expect(repository.workspaceWrites).toBe(0);
    expect(repository.keys.size).toBe(0);
  });

  it("requires a signed-in, expected owner for consent and binds the ticket against account changes", async () => {
    const { baseUrl, repository } = await setup();
    const client = await registerClient(baseUrl);
    const { ticket } = await startAuthorization(baseUrl, client);

    const unauthenticated = await fetch(
      `${baseUrl}/api/compass/oauth/requests/${ticket}`
    );
    expect(unauthenticated.status).toBe(401);

    const viewed = await fetch(
      `${baseUrl}/api/compass/oauth/requests/${ticket}`,
      {
        headers: ownerOneHeaders,
      }
    );
    expect(viewed.status).toBe(200);
    const view = await viewed.json();
    expect(Object.keys(view).sort()).toEqual([
      "clientName",
      "connectorActor",
      "expiresAt",
      "id",
      "offlineAccess",
      "projectCount",
      "redirectOrigin",
      "requestedScope",
      "taskCount",
    ]);
    expect(view).toMatchObject({
      id: ticket,
      clientName: "Claude Desktop",
      redirectOrigin: "https://claude.ai",
      connectorActor: "connector",
      offlineAccess: false,
      requestedScope: COMPASS_READ_SCOPE,
      taskCount: 1,
      projectCount: 1,
    });

    const swappedAccount = await fetch(
      `${baseUrl}/api/compass/oauth/requests/${ticket}`,
      { headers: ownerTwoHeaders }
    );
    expect(swappedAccount.status).toBe(404);
    const staleOwnerHeader = await fetch(
      `${baseUrl}/api/compass/oauth/requests/${ticket}`,
      { headers: { "x-test-user": "2", "x-steadier-owner": "1" } }
    );
    expect(staleOwnerHeader.status).toBe(403);
    expect(repository.keys).toHaveLength(0);
    expect(repository.workspaceWrites).toBe(0);
  });

  it("returns a bounded client redirect for explicit denial and never issues a key or second decision", async () => {
    const { baseUrl, repository } = await setup();
    const client = await registerClient(baseUrl);
    const { ticket } = await startAuthorization(baseUrl, client, {
      state: "opaque-state",
    });

    const denied = await fetch(
      `${baseUrl}/api/compass/oauth/requests/${ticket}/decision`,
      {
        method: "POST",
        headers: decisionHeaders,
        body: JSON.stringify({ approve: false }),
      }
    );
    expect(denied.status).toBe(200);
    const { redirectUrl } = await denied.json();
    const redirect = new URL(redirectUrl);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("state")).toBe("opaque-state");
    expect(repository.keys).toHaveLength(0);
    expect(repository.codes).toHaveLength(0);

    const replay = await fetch(
      `${baseUrl}/api/compass/oauth/requests/${ticket}/decision`,
      {
        method: "POST",
        headers: decisionHeaders,
        body: JSON.stringify({ approve: false }),
      }
    );
    expect(replay.status).toBe(404);
    expect(repository.keys).toHaveLength(0);
  });

  it("rejects an arbitrary audit label rather than persisting a client-supplied identity", async () => {
    const { baseUrl, repository } = await setup();
    const client = await registerClient(baseUrl, { clientName: "ChatGPT" });
    const { ticket } = await startAuthorization(baseUrl, client);
    const invalid = await fetch(
      `${baseUrl}/api/compass/oauth/requests/${ticket}/decision`,
      {
        method: "POST",
        headers: decisionHeaders,
        body: JSON.stringify({
          approve: true,
          access: "read",
          connectorActor: "trusted_openai",
        }),
      }
    );
    expect(invalid.status).toBe(400);
    expect(repository.keys).toHaveLength(0);
    expect(repository.codes).toHaveLength(0);
  });

  it("mints one existing hashed read-only key only after valid PKCE code redemption", async () => {
    const { baseUrl, repository } = await setup();
    const client = await registerClient(baseUrl);
    const { code, verifier } = await issueCode(baseUrl, client);

    const response = await redeem(baseUrl, {
      grant_type: "authorization_code",
      client_id: client.clientId,
      code,
      redirect_uri: client.redirectUri,
      code_verifier: verifier,
      resource: COMPASS_MCP_URL,
    });
    expect(response.status).toBe(200);
    const token = await response.json();
    expect(token).toMatchObject({
      token_type: "Bearer",
      scope: COMPASS_READ_SCOPE,
    });
    expect(token.access_token).toMatch(/^stdr_/);
    expect(token.expires_in).toBeGreaterThan(60 * 60 * 24);
    expect(token.refresh_token).toBeUndefined();
    expect(repository.keys).toHaveLength(1);
    const storedKey = [...repository.keys.values()][0];
    expect(storedKey.label).toBe("Claude read-only");
    expect(storedKey.tokenHash).toBe(hashCompassToken(token.access_token));
    expect(repository.workspaceWrites).toBe(0);

    const decisionReplay = await fetch(
      `${baseUrl}/api/compass/oauth/requests/${
        [...repository.consents.values()].find(c => c.status === "approved")!.id
      }/decision`,
      {
        method: "POST",
        headers: decisionHeaders,
        body: JSON.stringify({ approve: true }),
      }
    );
    expect(decisionReplay.status).toBe(404);
    expect(repository.codes).toHaveLength(1);
  });

  it("rejects invalid verifier, client, redirect, resource, expired code, and atomic replay without workspace writes", async () => {
    const { baseUrl, repository } = await setup();
    const client = await registerClient(baseUrl);
    const validRequest = (code: string, verifier: string) => ({
      grant_type: "authorization_code",
      client_id: client.clientId,
      code,
      redirect_uri: client.redirectUri,
      code_verifier: verifier,
      resource: COMPASS_MCP_URL,
    });

    const invalidVerifier = await issueCode(baseUrl, client, "v".repeat(64));
    expect(
      (
        await redeem(baseUrl, {
          ...validRequest(invalidVerifier.code, invalidVerifier.verifier),
          code_verifier: "w".repeat(64),
        })
      ).status
    ).toBe(400);

    const invalidRedirect = await issueCode(baseUrl, client);
    expect(
      (
        await redeem(baseUrl, {
          ...validRequest(invalidRedirect.code, invalidRedirect.verifier),
          redirect_uri: "https://claude.ai/wrong",
        })
      ).status
    ).toBe(400);

    const invalidClient = await issueCode(baseUrl, client);
    expect(
      (
        await redeem(baseUrl, {
          ...validRequest(invalidClient.code, invalidClient.verifier),
          client_id: "different-client",
        })
      ).status
    ).toBe(400);

    const invalidResource = await issueCode(baseUrl, client);
    expect(
      (
        await redeem(baseUrl, {
          ...validRequest(invalidResource.code, invalidResource.verifier),
          resource:
            "https://steadier-9wkmejo8.manus.space/not-the-mcp-resource",
        })
      ).status
    ).toBe(400);

    const expired = await issueCode(baseUrl, client);
    repository.codes.get(
      createHash("sha256").update(expired.code, "utf8").digest("hex")
    )!.expiresAt = "2000-01-01T00:00:00.000Z";
    expect(
      (await redeem(baseUrl, validRequest(expired.code, expired.verifier)))
        .status
    ).toBe(400);

    const replay = await issueCode(baseUrl, client);
    const results = await Promise.all([
      redeem(baseUrl, validRequest(replay.code, replay.verifier)),
      redeem(baseUrl, validRequest(replay.code, replay.verifier)),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([200, 400]);
    expect(repository.keys).toHaveLength(1);
    expect(repository.workspaceWrites).toBe(0);
  });
});
