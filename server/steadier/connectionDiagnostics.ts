import type { Express, Request, Response } from "express";
import {
  COMPASS_MCP_URL,
  COMPASS_READ_SCOPE,
} from "../../shared/compassConnection";

export type ConnectionDiagnostic = Readonly<
  Record<string, string | number | boolean>
>;
export type ConnectionDiagnosticLogger = (event: ConnectionDiagnostic) => void;

// Exact known public paths only. Never derive a logged path from arbitrary input.
const STAGES = new Map<string, string>([
  ["/api/compass/mcp", "mcp"],
  ["/.well-known/oauth-protected-resource", "resource-root"],
  [
    "/.well-known/oauth-protected-resource/api/compass/mcp",
    "resource-canonical",
  ],
  ["/.well-known/oauth-authorization-server", "issuer-root"],
  [
    "/.well-known/oauth-authorization-server/api/compass/oauth",
    "issuer-canonical",
  ],
  [
    "/.well-known/oauth-authorization-server/api/compass/mcp",
    "issuer-resource-variant",
  ],
  ["/.well-known/openid-configuration", "oidc-root-variant"],
  [
    "/.well-known/openid-configuration/api/compass/oauth",
    "oidc-issuer-variant",
  ],
  [
    "/api/compass/oauth/.well-known/openid-configuration",
    "oidc-append-variant",
  ],
  [
    "/api/compass/oauth/.well-known/oauth-authorization-server",
    "issuer-append-variant",
  ],
  ["/api/compass/oauth/register", "registration"],
  ["/api/compass/oauth/authorize", "authorization"],
  ["/api/compass/oauth/token", "token"],
]);

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function registrationFlags(request: Request): ConnectionDiagnostic {
  const body = record(request.body);
  const grants = Array.isArray(body.grant_types) ? body.grant_types : [];
  const method = body.token_endpoint_auth_method;
  return {
    parsedJsonBody:
      request.is("application/json") !== false &&
      request.is("application/json") !== null,
    hasClientName: typeof body.client_name === "string",
    hasGrantTypes: body.grant_types !== undefined,
    requestsAuthorizationCode: grants.includes("authorization_code"),
    requestsRefreshToken: grants.includes("refresh_token"),
    authMethod:
      method === undefined
        ? "omitted"
        : method === "none"
          ? "none"
          : method === "client_secret_basic" || method === "client_secret_post"
            ? "confidential"
            : "other",
    redirectCount: Array.isArray(body.redirect_uris)
      ? Math.min(body.redirect_uris.length, 6)
      : 0,
    hasHostedClaudeRedirect:
      Array.isArray(body.redirect_uris) &&
      body.redirect_uris.includes("https://claude.ai/api/mcp/auth_callback"),
    scopeCompatible:
      body.scope === undefined || body.scope === COMPASS_READ_SCOPE,
  };
}

function authorizationFlags(request: Request): ConnectionDiagnostic {
  return {
    hasClientId: typeof request.query.client_id === "string",
    usesS256: request.query.code_challenge_method === "S256",
    hasChallenge: typeof request.query.code_challenge === "string",
    resourceCompatible:
      request.query.resource === undefined ||
      request.query.resource === COMPASS_MCP_URL,
    scopeCompatible:
      request.query.scope === undefined ||
      request.query.scope === COMPASS_READ_SCOPE,
  };
}

function contentCategory(response: Response): string {
  const type = String(response.getHeader("content-type") ?? "").toLowerCase();
  return type.startsWith("application/json")
    ? "json"
    : type.startsWith("text/html")
      ? "html"
      : type.startsWith("text/event-stream")
        ? "sse"
        : "other";
}

/** No request bodies, URLs, credentials, identifiers, user names or task data. */
export function registerCompassConnectionDiagnostics(
  app: Express,
  logger: ConnectionDiagnosticLogger = event =>
    console.info("[CompassConnection]", JSON.stringify(event))
): void {
  let windowStartedAt = Date.now();
  let requestsInWindow = 0;
  const emit = (event: ConnectionDiagnostic) => {
    try {
      logger(event);
    } catch {
      /* Diagnostics must never affect permission or transport. */
    }
  };
  app.use((request, response, next) => {
    const stage = STAGES.get(request.path.replace(/\/$/, ""));
    if (!stage) {
      next();
      return;
    }
    const startedAt = Date.now();
    if (startedAt - windowStartedAt >= 60_000) {
      windowStartedAt = startedAt;
      requestsInWindow = 0;
    }
    if (++requestsInWindow > 200) {
      next();
      return;
    }
    const method = ["GET", "POST", "HEAD", "OPTIONS", "DELETE"].includes(
      request.method
    )
      ? request.method
      : "other";
    const flags =
      stage === "registration"
        ? registrationFlags(request)
        : stage === "authorization"
          ? authorizationFlags(request)
          : {};
    emit({ phase: "request", stage, method, ...flags });
    response.once("finish", () =>
      emit({
        phase: "response",
        stage,
        method,
        status: response.statusCode,
        content: contentCategory(response),
        durationMs: Math.max(0, Date.now() - startedAt),
      })
    );
    next();
  });
}
