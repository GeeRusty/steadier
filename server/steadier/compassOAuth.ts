import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import {
  COMPASS_MCP_URL,
  COMPASS_OAUTH_BASE,
  COMPASS_OAUTH_ISSUER,
  COMPASS_PUBLIC_ORIGIN,
  COMPASS_OFFLINE_SCOPE,
  COMPASS_READ_SCOPE,
  COMPASS_READ_WRITE_SCOPE,
  COMPASS_WRITE_SCOPE,
  scopeAllowsWrite,
  type CompassGrantedScope,
  COMPASS_RESOURCE_METADATA_PATH,
  type CompassConsentDecision,
  type CompassConsentView,
} from "../../shared/compassConnection";
import { sdk } from "../_core/sdk";
import type { ConnectorActor } from "../../shared/cloud";
import {
  createProductionCompassOAuthRepository,
  type CompassOAuthClient,
  type CompassOAuthRepository,
  type NewCompassAuthorizationCode,
  type NewCompassConsentRequest,
  type StoredCompassAuthorizationCode,
  type StoredCompassConsentRequest,
} from "./oauthRepository";
import { createProductionRepository } from "./repository";
import {
  createCompassKey,
  createCompassRefreshToken,
  createCompassToken,
  hashCompassToken,
  COMPASS_KEY_LIFETIME_MS,
  type SteadierRepository,
  type StoredWorkspace,
} from "./service";

const MAX_REGISTRATION_BYTES = 16 * 1024;
const MAX_REDIRECT_URIS = 5;
const MAX_REDIRECT_URI_BYTES = 2048;
const MAX_CLIENT_NAME_BYTES = 120;
const MAX_STATE_BYTES = 2048;
const CONSENT_LIFETIME_MS = 10 * 60 * 1000;
const AUTHORIZATION_CODE_LIFETIME_MS = 60 * 1000;
const REGISTRATIONS_PER_HOUR = 20;
const REGISTRATION_WINDOW_MS = 60 * 60 * 1000;
const PKCE_VALUE = /^[A-Za-z0-9._~-]{43,128}$/;
const PKCE_S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const CLIENT_ID = /^[A-Za-z0-9_-]{1,96}$/;
const CONSENT_ID = /^[A-Za-z0-9_-]{43}$/;

export type SteadierSessionUser = {
  id: number;
  name: string | null;
  isCron?: boolean;
};

export type CompassOAuthRouteDependencies = {
  /** Existing repository: only readWorkspace and createCompassKey are used. */
  repository?: SteadierRepository;
  oauthRepository?: CompassOAuthRepository;
  authenticateSession?: (request: Request) => Promise<SteadierSessionUser>;
  /** Test-only opt-in. Production accepts registered HTTPS redirect URIs only. */
  allowHttpLocalhost?: boolean;
  /** Injectable clock for focused expiry tests. */
  now?: () => Date;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>
  ) {
    super(String(body.code ?? body.error ?? status));
  }
}

function noStore(
  _request: Request,
  response: Response,
  next: () => void
): void {
  response.set("Cache-Control", "private, no-store");
  response.set("Pragma", "no-cache");
  response.set("Referrer-Policy", "no-referrer");
  response.set("X-Content-Type-Options", "nosniff");
  next();
}

function publicMetadata(
  response: Response,
  body: Record<string, unknown>
): void {
  response
    .set("Cache-Control", "public, max-age=300")
    .set("X-Content-Type-Options", "nosniff")
    .status(200)
    .json(body);
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>
): (request: Request, response: Response) => void {
  return (request, response) => {
    void handler(request, response).catch(error => {
      if (response.headersSent) return;
      if (error instanceof HttpError) {
        response.status(error.status).json(error.body);
        return;
      }
      // Do not log opaque codes, consent tickets, Bearer tokens, or redirect query data.
      response.status(500).json({ error: "server_error" });
    });
  };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function opaqueRandom(): string {
  return randomBytes(32).toString("base64url");
}

function hashOpaque(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactString(value: unknown, maxBytes: number): string | null {
  if (typeof value !== "string" || byteLength(value) > maxBytes) return null;
  return value;
}

function queryString(
  request: Request,
  name: string,
  required = true
): string | undefined {
  const value = request.query[name];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") {
    throw new HttpError(400, { error: "invalid_request" });
  }
  return value;
}

function requireClientId(value: unknown): string {
  if (typeof value !== "string" || !CLIENT_ID.test(value)) {
    throw new HttpError(400, { error: "invalid_request" });
  }
  return value;
}

function requireConsentId(value: string): string {
  if (!CONSENT_ID.test(value)) {
    throw new HttpError(404, { code: "CONSENT_NOT_FOUND" });
  }
  return value;
}

type ParsedOAuthScope = {
  scope: CompassGrantedScope;
  offlineAccess: boolean;
};

/** The owner still chooses whether requested changes are granted. */
function parseScope(value: unknown): ParsedOAuthScope {
  if (value === undefined || value === "")
    return { scope: COMPASS_READ_WRITE_SCOPE, offlineAccess: false };
  if (typeof value !== "string" || value.length > 64) {
    throw new HttpError(400, { error: "invalid_scope" });
  }
  const parts = value.split(/\s+/).filter(Boolean);
  if (
    parts.length === 0 ||
    new Set(parts).size !== parts.length ||
    parts.some(
      part =>
        part !== COMPASS_READ_SCOPE &&
        part !== COMPASS_WRITE_SCOPE &&
        part !== COMPASS_OFFLINE_SCOPE
    )
  ) {
    throw new HttpError(400, { error: "invalid_scope" });
  }
  const hasReadWriteScope = parts.includes(COMPASS_WRITE_SCOPE);
  const hasReadScope = parts.includes(COMPASS_READ_SCOPE);
  return {
    scope: hasWriteScope(parts)
      ? COMPASS_READ_WRITE_SCOPE
      : hasReadScope || parts.includes(COMPASS_OFFLINE_SCOPE)
        ? COMPASS_READ_SCOPE
        : COMPASS_READ_SCOPE,
    offlineAccess: parts.includes(COMPASS_OFFLINE_SCOPE),
  };
}

function hasWriteScope(parts: string[]): boolean {
  return parts.includes(COMPASS_WRITE_SCOPE);
}

function parseResource(value: unknown): string {
  if (value === undefined) return COMPASS_MCP_URL;
  if (value !== COMPASS_MCP_URL) {
    throw new HttpError(400, { error: "invalid_target" });
  }
  return COMPASS_MCP_URL;
}

function assertClientName(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, { error: "invalid_client_metadata" });
  }
  const name = value.trim();
  // Allow human-readable Unicode names, but not control/format tricks or markup.
  if (
    !name ||
    byteLength(name) > MAX_CLIENT_NAME_BYTES ||
    hasControlCharacter(name) ||
    !/^[\p{L}\p{N}][\p{L}\p{N} .,'()_:+-]*$/u.test(name)
  ) {
    throw new HttpError(400, { error: "invalid_client_metadata" });
  }
  return name;
}

function assertRedirectUri(
  value: unknown,
  allowHttpLocalhost: boolean
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    byteLength(value) > MAX_REDIRECT_URI_BYTES ||
    hasControlCharacter(value) ||
    value.includes("#")
  ) {
    throw new HttpError(400, { error: "invalid_redirect_uri" });
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(400, { error: "invalid_redirect_uri" });
  }
  const isHttps = parsed.protocol === "https:";
  const isExplicitLocalhostHttp =
    allowHttpLocalhost &&
    parsed.protocol === "http:" &&
    parsed.hostname.toLowerCase() === "localhost";
  if (
    (!isHttps && !isExplicitLocalhostHttp) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new HttpError(400, { error: "invalid_redirect_uri" });
  }
  // Store the original validated string. Requests must match it byte-for-byte.
  return value;
}

function assertPkceChallenge(value: unknown): string {
  if (typeof value !== "string" || !PKCE_S256_CHALLENGE.test(value)) {
    throw new HttpError(400, { error: "invalid_request" });
  }
  return value;
}

function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== "string" || !PKCE_VALUE.test(verifier)) return false;
  const calculated = createHash("sha256")
    .update(verifier, "ascii")
    .digest("base64url");
  const left = Buffer.from(calculated, "ascii");
  const right = Buffer.from(challenge, "ascii");
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseState(value: unknown): string | null {
  if (value === undefined) return null;
  if (
    typeof value !== "string" ||
    byteLength(value) > MAX_STATE_BYTES ||
    hasControlCharacter(value)
  ) {
    throw new HttpError(400, { error: "invalid_request" });
  }
  return value;
}

function validateRegistrationBody(
  request: Request,
  allowHttpLocalhost: boolean
): { clientName: string; redirectUris: string[]; refreshEnabled: boolean } {
  const contentType = request.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new HttpError(415, { error: "invalid_client_metadata" });
  }
  const declaredLength = Number(request.get("content-length") ?? "0");
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > MAX_REGISTRATION_BYTES
  ) {
    throw new HttpError(413, { error: "invalid_client_metadata" });
  }
  if (!isObject(request.body)) {
    throw new HttpError(400, { error: "invalid_client_metadata" });
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(request.body);
  } catch {
    throw new HttpError(400, { error: "invalid_client_metadata" });
  }
  if (byteLength(serialized) > MAX_REGISTRATION_BYTES) {
    throw new HttpError(413, { error: "invalid_client_metadata" });
  }

  const redirectUris = request.body.redirect_uris;
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    redirectUris.length > MAX_REDIRECT_URIS
  ) {
    throw new HttpError(400, { error: "invalid_redirect_uri" });
  }
  const validatedRedirectUris = redirectUris.map(uri =>
    assertRedirectUri(uri, allowHttpLocalhost)
  );
  if (new Set(validatedRedirectUris).size !== validatedRedirectUris.length) {
    throw new HttpError(400, { error: "invalid_redirect_uri" });
  }

  const grantTypes = request.body.grant_types;
  if (
    grantTypes !== undefined &&
    (!Array.isArray(grantTypes) ||
      grantTypes.length > 2 ||
      !grantTypes.includes("authorization_code") ||
      new Set(grantTypes).size !== grantTypes.length ||
      grantTypes.some(
        type => type !== "authorization_code" && type !== "refresh_token"
      ))
  ) {
    throw new HttpError(400, { error: "invalid_client_metadata" });
  }
  const refreshEnabled =
    Array.isArray(grantTypes) && grantTypes.includes("refresh_token");
  const responseTypes = request.body.response_types;
  if (
    responseTypes !== undefined &&
    (!Array.isArray(responseTypes) ||
      responseTypes.length !== 1 ||
      responseTypes[0] !== "code")
  ) {
    throw new HttpError(400, { error: "invalid_client_metadata" });
  }
  if (
    request.body.token_endpoint_auth_method !== undefined &&
    request.body.token_endpoint_auth_method !== "none"
  ) {
    throw new HttpError(400, { error: "invalid_client_metadata" });
  }
  const requestedScope = parseScope(request.body.scope);
  if (requestedScope.offlineAccess && !refreshEnabled) {
    throw new HttpError(400, { error: "invalid_client_metadata" });
  }

  return {
    clientName:
      request.body.client_name === undefined
        ? "Unnamed OAuth client"
        : assertClientName(request.body.client_name),
    redirectUris: validatedRedirectUris,
    refreshEnabled,
  };
}

function requestSource(request: Request): string {
  // This is only a bounded best-effort abuse brake, never an authentication signal.
  return request.socket.remoteAddress ?? "unknown";
}

function createRegistrationLimiter() {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return (request: Request, now: Date): void => {
    const timestamp = now.getTime();
    for (const [key, value] of attempts) {
      if (value.resetAt <= timestamp) attempts.delete(key);
    }
    const key = requestSource(request);
    const current = attempts.get(key);
    if (current && current.resetAt > timestamp) {
      if (current.count >= REGISTRATIONS_PER_HOUR) {
        throw new HttpError(429, { error: "slow_down" });
      }
      current.count += 1;
      return;
    }
    attempts.set(key, {
      count: 1,
      resetAt: timestamp + REGISTRATION_WINDOW_MS,
    });
  };
}

async function requireSignedInUser(
  request: Request,
  authenticateSession: (request: Request) => Promise<SteadierSessionUser>
): Promise<SteadierSessionUser> {
  let user: SteadierSessionUser;
  try {
    user = await authenticateSession(request);
  } catch {
    throw new HttpError(401, { code: "UNAUTHORIZED" });
  }
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || user.isCron) {
    throw new HttpError(403, { code: "FORBIDDEN" });
  }
  return user;
}

function requireExpectedOwner(
  request: Request,
  user: SteadierSessionUser
): void {
  const header = request.get("x-steadier-owner");
  if (!header || !/^[1-9]\d*$/.test(header)) {
    throw new HttpError(403, { code: "ACCOUNT_BINDING_REQUIRED" });
  }
  const expectedOwnerId = Number(header);
  if (!Number.isSafeInteger(expectedOwnerId)) {
    throw new HttpError(403, { code: "ACCOUNT_BINDING_REQUIRED" });
  }
  if (expectedOwnerId !== user.id) {
    throw new HttpError(403, {
      code: "ACCOUNT_CHANGED",
      message:
        "The signed-in account differs from this request's expected account.",
    });
  }
}

function requireCookieWriteRequest(request: Request): void {
  if (request.get("x-steadier-request") !== "1") {
    throw new HttpError(403, { code: "REQUEST_GUARD_REQUIRED" });
  }
  const contentType = request.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new HttpError(415, { code: "JSON_REQUIRED" });
  }
}

function parseDecision(body: unknown): {
  approve: boolean;
  access: "read" | "write";
  connectorActor: ConnectorActor;
} {
  if (
    !isObject(body) ||
    !("approve" in body) ||
    Object.keys(body).some(
      key => !["approve", "access", "connectorActor"].includes(key)
    )
  ) {
    throw new HttpError(400, { code: "INVALID_REQUEST" });
  }
  if (typeof body.approve !== "boolean") {
    throw new HttpError(400, { code: "INVALID_REQUEST" });
  }
  const access = body.access === undefined ? "read" : body.access;
  if (access !== "read" && access !== "write") {
    throw new HttpError(400, { code: "INVALID_REQUEST" });
  }
  const connectorActor =
    body.connectorActor === undefined ? "connector" : body.connectorActor;
  if (
    connectorActor !== "claude" &&
    connectorActor !== "chatgpt" &&
    connectorActor !== "connector"
  ) {
    throw new HttpError(400, { code: "INVALID_REQUEST" });
  }
  return { approve: body.approve, access, connectorActor };
}

function redirectWithParams(
  redirectUri: string,
  values: Record<string, string>
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function consentView(
  consent: StoredCompassConsentRequest,
  client: CompassOAuthClient,
  workspace: StoredWorkspace | null
): CompassConsentView {
  return {
    id: consent.id,
    clientName: client.clientName,
    redirectOrigin: new URL(consent.redirectUri).origin,
    requestedScope: consent.scope,
    offlineAccess: consent.offlineAccess,
    // Provider identity is selected by the owner on the consent page, never
    // inferred from the public client's self-declared name or redirect URI.
    connectorActor: "connector",
    expiresAt: consent.expiresAt,
    taskCount: workspace?.workspace.tasks.length ?? 0,
    projectCount: workspace?.workspace.projects.length ?? 0,
  };
}

function connectorDisplayName(actor: ConnectorActor): string {
  return actor === "chatgpt"
    ? "ChatGPT"
    : actor === "claude"
      ? "Claude"
      : "MCP connector";
}

function tokenFailure(response: Response): void {
  response.status(400).json({ error: "invalid_grant" });
}

type AuthorizationCodeGrant = {
  grantType: "authorization_code";
  clientId: string;
  code: string;
  redirectUri: string;
  verifier: string;
  resource: string;
};
type RefreshTokenGrant = {
  grantType: "refresh_token";
  clientId: string;
  refreshToken: string;
  resource: string;
  scope?: string;
};
type TokenGrant = AuthorizationCodeGrant | RefreshTokenGrant;

function parseTokenBody(request: Request): TokenGrant | null {
  const contentType = request.get("content-type") ?? "";
  if (
    !/^application\/(?:x-www-form-urlencoded|json)(?:\s*;|$)/i.test(
      contentType
    ) ||
    !isObject(request.body) ||
    request.get("authorization")
  ) {
    return null;
  }
  const body = request.body;
  const grantType = exactString(body.grant_type, 64);
  const clientId = exactString(body.client_id, 96);
  const resource =
    body.resource === undefined
      ? COMPASS_MCP_URL
      : exactString(body.resource, 2048);
  if (
    !clientId ||
    !CLIENT_ID.test(clientId) ||
    !resource ||
    resource !== COMPASS_MCP_URL
  )
    return null;
  if (grantType === "authorization_code") {
    const code = exactString(body.code, 256);
    const redirectUri = exactString(body.redirect_uri, MAX_REDIRECT_URI_BYTES);
    const verifier = exactString(body.code_verifier, 128);
    if (!code || !CONSENT_ID.test(code) || !redirectUri || !verifier)
      return null;
    return { grantType, clientId, code, redirectUri, verifier, resource };
  }
  if (grantType === "refresh_token") {
    const refreshToken = exactString(body.refresh_token, 128);
    const scope =
      body.scope === undefined ? undefined : exactString(body.scope, 64);
    if (
      !refreshToken ||
      !/^stdr_rt_[A-Za-z0-9_-]{40,}$/.test(refreshToken) ||
      (body.scope !== undefined && scope === null)
    )
      return null;
    return {
      grantType,
      clientId,
      refreshToken,
      resource,
      ...(scope === undefined ? {} : { scope: scope! }),
    };
  }
  return null;
}

function codeIsUsable(
  code: StoredCompassAuthorizationCode,
  token: TokenGrant | null,
  now: Date
): token is AuthorizationCodeGrant {
  return (
    token !== null &&
    token.grantType === "authorization_code" &&
    code.redeemedAt === null &&
    Date.parse(code.expiresAt) > now.getTime() &&
    code.clientId === token.clientId &&
    code.redirectUri === token.redirectUri &&
    code.resource === token.resource &&
    verifyPkce(token.verifier, code.codeChallenge)
  );
}

/**
 * Register the Compass OAuth issuer separately from the MCP transport. Production
 * uses the existing Manus SDK session verifier and Steadier key service; tests can
 * inject both repositories and authentication without touching a real database.
 */
export function registerCompassOAuthRoutes(
  app: Express,
  dependencies: CompassOAuthRouteDependencies = {}
): void {
  const repository = dependencies.repository ?? createProductionRepository();
  const oauthRepository =
    dependencies.oauthRepository ?? createProductionCompassOAuthRepository();
  const authenticateSession =
    dependencies.authenticateSession ??
    (async (request: Request): Promise<SteadierSessionUser> =>
      sdk.authenticateRequest(request));
  const now = dependencies.now ?? (() => new Date());
  const allowHttpLocalhost = dependencies.allowHttpLocalhost === true;
  const takeRegistrationAttempt = createRegistrationLimiter();

  const authorizationServerMetadata = {
    issuer: COMPASS_OAUTH_ISSUER,
    authorization_endpoint: `${COMPASS_OAUTH_ISSUER}/authorize`,
    token_endpoint: `${COMPASS_OAUTH_ISSUER}/token`,
    registration_endpoint: `${COMPASS_OAUTH_ISSUER}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [
      COMPASS_READ_SCOPE,
      COMPASS_WRITE_SCOPE,
      COMPASS_OFFLINE_SCOPE,
    ],
    client_id_metadata_document_supported: false,
  };
  // Legacy clients derive discovery from the origin. Its document must echo
  // that exact origin (RFC 8414 §3.3), not our path-bearing canonical issuer.
  const rootAuthorizationServerMetadata = {
    ...authorizationServerMetadata,
    issuer: COMPASS_PUBLIC_ORIGIN,
  };
  const protectedResourceMetadata = {
    resource: COMPASS_MCP_URL,
    authorization_servers: [COMPASS_OAUTH_ISSUER],
    bearer_methods_supported: ["header"],
    scopes_supported: [
      COMPASS_READ_SCOPE,
      COMPASS_WRITE_SCOPE,
      COMPASS_OFFLINE_SCOPE,
    ],
  };

  // Both root and RFC 8414/RFC 9728 path forms support remote MCP client discovery.
  app.get(COMPASS_RESOURCE_METADATA_PATH, (_request, response) =>
    publicMetadata(response, protectedResourceMetadata)
  );
  app.get("/.well-known/oauth-protected-resource", (_request, response) =>
    publicMetadata(response, protectedResourceMetadata)
  );
  app.get(
    "/.well-known/oauth-authorization-server/api/compass/oauth",
    (_request, response) =>
      publicMetadata(response, authorizationServerMetadata)
  );
  app.get("/.well-known/oauth-authorization-server", (_request, response) =>
    publicMetadata(response, rootAuthorizationServerMetadata)
  );

  app.use(COMPASS_OAUTH_BASE, noStore);

  app.post(
    `${COMPASS_OAUTH_BASE}/register`,
    asyncRoute(async (request, response) => {
      const registeredAt = now();
      takeRegistrationAttempt(request, registeredAt);
      const registration = validateRegistrationBody(
        request,
        allowHttpLocalhost
      );
      const client = await oauthRepository.createClient({
        clientId: `stdr_oauth_${opaqueRandom()}`,
        clientName: registration.clientName,
        redirectUris: registration.redirectUris,
        refreshEnabled: registration.refreshEnabled,
        createdAt: registeredAt,
      });
      response.status(201).json({
        client_id: client.clientId,
        client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: client.refreshEnabled
          ? ["authorization_code", "refresh_token"]
          : ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: client.refreshEnabled
          ? `${COMPASS_READ_WRITE_SCOPE} ${COMPASS_OFFLINE_SCOPE}`
          : COMPASS_READ_WRITE_SCOPE,
      });
    })
  );

  app.get(
    `${COMPASS_OAUTH_BASE}/authorize`,
    asyncRoute(async (request, response) => {
      if (queryString(request, "response_type") !== "code") {
        throw new HttpError(400, { error: "unsupported_response_type" });
      }
      const clientId = requireClientId(queryString(request, "client_id"));
      const client = await oauthRepository.findClient(clientId);
      if (!client) throw new HttpError(400, { error: "invalid_request" });
      const redirectUri = queryString(request, "redirect_uri");
      if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
        throw new HttpError(400, { error: "invalid_request" });
      }
      const scope = parseScope(queryString(request, "scope", false));
      if (scope.offlineAccess && !client.refreshEnabled) {
        throw new HttpError(400, { error: "invalid_scope" });
      }
      const resource = parseResource(queryString(request, "resource", false));
      const state = parseState(queryString(request, "state", false));
      const codeChallenge = assertPkceChallenge(
        queryString(request, "code_challenge")
      );
      if (queryString(request, "code_challenge_method") !== "S256") {
        throw new HttpError(400, { error: "invalid_request" });
      }

      const createdAt = now();
      const ticket = opaqueRandom();
      const consent: NewCompassConsentRequest = {
        id: ticket,
        clientId: client.clientId,
        redirectUri,
        state,
        codeChallenge,
        scope: scope.scope,
        offlineAccess: scope.offlineAccess,
        resource,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + CONSENT_LIFETIME_MS),
      };
      await oauthRepository.createConsentRequest(consent);
      const consentUrl = new URL("/", COMPASS_PUBLIC_ORIGIN);
      consentUrl.searchParams.set("compass_oauth", ticket);
      response.redirect(302, consentUrl.toString());
    })
  );

  app.get(
    `${COMPASS_OAUTH_BASE}/requests/:id`,
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      requireExpectedOwner(request, user);
      const consent = await oauthRepository.claimConsentRequest(
        requireConsentId(request.params.id),
        user.id,
        now()
      );
      if (!consent) throw new HttpError(404, { code: "CONSENT_NOT_FOUND" });
      const client = await oauthRepository.findClient(consent.clientId);
      if (!client) throw new HttpError(404, { code: "CONSENT_NOT_FOUND" });
      response
        .status(200)
        .json(
          consentView(consent, client, await repository.readWorkspace(user.id))
        );
    })
  );

  app.post(
    `${COMPASS_OAUTH_BASE}/requests/:id/decision`,
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      requireExpectedOwner(request, user);
      requireCookieWriteRequest(request);
      const { approve, access, connectorActor } = parseDecision(request.body);
      const decidedAt = now();
      // A direct, signed-in POST is safe too: first claim the ticket to this owner.
      const consent = await oauthRepository.claimConsentRequest(
        requireConsentId(request.params.id),
        user.id,
        decidedAt
      );
      if (!consent) throw new HttpError(404, { code: "CONSENT_NOT_FOUND" });

      let code: string | null = null;
      let authorizationCode: NewCompassAuthorizationCode | undefined;
      if (approve) {
        code = opaqueRandom();
        authorizationCode = {
          requestId: consent.id,
          codeHash: hashOpaque(code),
          ownerId: user.id,
          clientId: consent.clientId,
          redirectUri: consent.redirectUri,
          codeChallenge: consent.codeChallenge,
          // The owner's choice, never more than the client asked for.
          scope:
            access === "write" && consent.scope === COMPASS_READ_WRITE_SCOPE
              ? COMPASS_READ_WRITE_SCOPE
              : COMPASS_READ_SCOPE,
          offlineAccess: consent.offlineAccess,
          connectorActor,
          resource: consent.resource,
          issuedAt: decidedAt,
          expiresAt: new Date(
            decidedAt.getTime() + AUTHORIZATION_CODE_LIFETIME_MS
          ),
        };
      }
      const decided = await oauthRepository.decideConsentRequest({
        id: consent.id,
        ownerId: user.id,
        approve,
        authorizationCode,
        now: decidedAt,
      });
      if (!decided) throw new HttpError(409, { code: "CONSENT_UNAVAILABLE" });

      const redirectUrl = approve
        ? redirectWithParams(consent.redirectUri, {
            code: code!,
            ...(consent.state === null ? {} : { state: consent.state }),
          })
        : redirectWithParams(consent.redirectUri, {
            error: "access_denied",
            ...(consent.state === null ? {} : { state: consent.state }),
          });
      const decision: CompassConsentDecision = { redirectUrl };
      response.status(200).json(decision);
    })
  );

  app.post(
    `${COMPASS_OAUTH_BASE}/token`,
    asyncRoute(async (request, response) => {
      const token = parseTokenBody(request);
      if (!token) {
        tokenFailure(response);
        return;
      }
      const redeemedAt = now();
      const client = await oauthRepository.findClient(token.clientId);
      if (!client) {
        tokenFailure(response);
        return;
      }

      if (token.grantType === "refresh_token") {
        const keyRepository = repository as SteadierRepository;
        if (
          !client.refreshEnabled ||
          !keyRepository.findCompassKeyByRefreshHash ||
          !keyRepository.rotateCompassOAuthKey
        ) {
          tokenFailure(response);
          return;
        }
        const key = await keyRepository.findCompassKeyByRefreshHash(
          hashCompassToken(token.refreshToken)
        );
        if (
          !key ||
          key.revokedAt !== null ||
          key.oauthClientId !== client.clientId ||
          !key.refreshExpiresAt ||
          Date.parse(key.refreshExpiresAt) <= redeemedAt.getTime()
        ) {
          tokenFailure(response);
          return;
        }
        let requestedScope: CompassGrantedScope =
          key.scope as CompassGrantedScope;
        if (token.scope !== undefined) {
          const parsed = parseScope(token.scope);
          const requestedScopes = token.scope.split(/\s+/).filter(Boolean);
          // offline_access is not a workspace permission. If a client sends
          // only that scope on refresh, retain (never broaden) its prior grant.
          if (
            requestedScopes.some(
              scope =>
                scope === COMPASS_READ_SCOPE || scope === COMPASS_WRITE_SCOPE
            )
          ) {
            requestedScope = parsed.scope;
          }
        }
        if (
          (!scopeAllowsWrite(key.scope) && scopeAllowsWrite(requestedScope)) ||
          (requestedScope !== COMPASS_READ_SCOPE &&
            requestedScope !== COMPASS_READ_WRITE_SCOPE)
        ) {
          tokenFailure(response);
          return;
        }

        const nextAccessToken = createCompassToken();
        const nextRefreshToken = createCompassRefreshToken();
        const rotated = await keyRepository.rotateCompassOAuthKey({
          userId: key.userId,
          keyId: key.id,
          clientId: client.clientId,
          priorRefreshHash: hashCompassToken(token.refreshToken),
          accessTokenHash: hashCompassToken(nextAccessToken),
          refreshTokenHash: hashCompassToken(nextRefreshToken),
          scope: requestedScope,
          expiresAt: new Date(redeemedAt.getTime() + COMPASS_KEY_LIFETIME_MS),
          refreshExpiresAt: new Date(
            redeemedAt.getTime() + COMPASS_KEY_LIFETIME_MS
          ),
          rotatedAt: redeemedAt,
        });
        if (!rotated) {
          tokenFailure(response);
          return;
        }
        response.status(200).json({
          access_token: nextAccessToken,
          refresh_token: nextRefreshToken,
          token_type: "Bearer",
          expires_in: Math.floor(COMPASS_KEY_LIFETIME_MS / 1000),
          scope: `${requestedScope} ${COMPASS_OFFLINE_SCOPE}`,
        });
        return;
      }

      const code = await oauthRepository.findAuthorizationCode(
        hashOpaque(token.code)
      );
      if (
        !code ||
        !codeIsUsable(code, token, redeemedAt) ||
        (code.offlineAccess && !client.refreshEnabled)
      ) {
        tokenFailure(response);
        return;
      }
      // The conditional update happens before any reader capability is minted.
      const consumed = await oauthRepository.consumeAuthorizationCode({
        codeHash: code.codeHash,
        clientId: token.clientId,
        redirectUri: token.redirectUri,
        resource: token.resource,
        now: redeemedAt,
      });
      if (!consumed) {
        tokenFailure(response);
        return;
      }

      try {
        const actor = code.connectorActor;
        const refreshToken = code.offlineAccess
          ? createCompassRefreshToken()
          : undefined;
        const issued = await createCompassKey(
          repository,
          code.ownerId,
          `${connectorDisplayName(actor)} ${scopeAllowsWrite(code.scope) ? "read & changes" : "read-only"}`,
          redeemedAt,
          code.scope,
          {
            ...(refreshToken
              ? {
                  refreshTokenHash: hashCompassToken(refreshToken),
                  refreshExpiresAt: new Date(
                    redeemedAt.getTime() + COMPASS_KEY_LIFETIME_MS
                  ),
                }
              : {}),
            oauthClientId: client.clientId,
            connectorActor: actor,
          }
        );
        const expiresIn = Math.max(
          0,
          Math.floor(
            (Date.parse(issued.info.expiresAt) - redeemedAt.getTime()) / 1000
          )
        );
        response.status(200).json({
          access_token: issued.token,
          ...(refreshToken ? { refresh_token: refreshToken } : {}),
          token_type: "Bearer",
          expires_in: expiresIn,
          scope: code.offlineAccess
            ? `${code.scope} ${COMPASS_OFFLINE_SCOPE}`
            : code.scope,
        });
      } catch {
        // The code remains consumed so a retry can never mint a second capability.
        response.status(500).json({ error: "server_error" });
      }
    })
  );
}
