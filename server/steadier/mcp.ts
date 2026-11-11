import { taskSetup } from "./cardOps";
import type { Express, Request, Response } from "express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
  type AuthInfo,
  type McpServerFactory,
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  COMPASS_MCP_PATH,
  COMPASS_MCP_URL,
  COMPASS_PUBLIC_ORIGIN,
  COMPASS_RESOURCE_METADATA_PATH,
  COMPASS_WRITE_SCOPE,
} from "../../shared/compassConnection";
import type { WorkspaceChangeRepository } from "./changes";
import {
  registerBackupReadTools,
  registerWriteTools,
  UNTRUSTED_DATA_RULE,
} from "./mcpWriteTools";
import type { CloudRecord, ConnectorActor } from "../../shared/cloud";
import {
  compassContext,
  presentProject,
  presentTask,
  workspaceSheetCsv,
} from "./projections";
import { createProductionRepository } from "./repository";
import {
  authenticateCompassToken,
  cloudRecordFromStored,
  emptyCloudRecord,
  type SteadierRepository,
} from "./service";

const RESOURCE_METADATA_URL = `${COMPASS_PUBLIC_ORIGIN}${COMPASS_RESOURCE_METADATA_PATH}`;
const AUTH_INFO_CLIENT_PREFIX = "steadier-reader:";
const MCP_SERVER_VERSION = "1.1.0";
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const EMPTY_INPUT_SCHEMA = fromJsonSchema({
  type: "object",
  properties: {},
  additionalProperties: false,
});
const TASK_INPUT_SCHEMA = fromJsonSchema({
  type: "object",
  properties: {
    taskId: { type: "string", minLength: 1, maxLength: 200 },
  },
  required: ["taskId"],
  additionalProperties: false,
});
const PROJECT_INPUT_SCHEMA = fromJsonSchema({
  type: "object",
  properties: {
    projectId: { type: "string", minLength: 1, maxLength: 200 },
  },
  required: ["projectId"],
  additionalProperties: false,
});
const taskInput = z.object({ taskId: z.string().min(1).max(200) }).strict();
const projectInput = z
  .object({ projectId: z.string().min(1).max(200) })
  .strict();

const PLANNING_GUIDANCE = `Before planning, read the current saved context and check its planning date, server revision, and freshness warning. This is a request-based read-only snapshot, not monitoring or scheduled outreach: saved context may exclude offline edits. Keep actual deadlines distinct from provisional preparation dates. Direction/Support and Timely/Sustained are qualities, not measures of personal value. Honor the saved intention, choose one physical next action, and if the user reports drifting, offer a gentle two-minute re-entry. Never claim monitoring or an attention diagnosis, and never change records unless the owner asks in this conversation. Times are Australia/Adelaide. ${UNTRUSTED_DATA_RULE}`;

export type CompassMcpRouteDependencies = {
  repository?: SteadierRepository;
  changes?: WorkspaceChangeRepository;
};

type ScopedAuthInfo = AuthInfo & { clientId: string };

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

function noStore(response: Response): Response {
  return response.set("Cache-Control", "private, no-store");
}

function sendJsonError(response: Response, status: number, code: string): void {
  noStore(response).status(status).json({ code });
}

function sendUnauthorized(response: Response): void {
  noStore(response)
    .status(401)
    .set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${RESOURCE_METADATA_URL}"`
    )
    .json({ code: "UNAUTHORIZED" });
}

function hasUnsupportedQuery(request: Request): boolean {
  // MCP credentials and requests are never accepted via a URL. This also avoids
  // accidentally putting an opaque reader key into logs, history, or caches.
  return request.originalUrl.includes("?");
}

function hasAllowedOrigin(request: Request): boolean {
  const origin = request.get("origin");
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (
      parsed.origin === COMPASS_PUBLIC_ORIGIN ||
      parsed.origin === "https://claude.ai" ||
      parsed.origin === "https://chatgpt.com" ||
      parsed.origin === "https://chat.openai.com"
    )
      return true;
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function scopedAuthInfo(
  userId: number,
  expiresAt: string,
  scope: string,
  actor: ConnectorActor
): ScopedAuthInfo {
  return {
    // This is deliberately a fixed marker, never the opaque reader key.
    token: "steadier-reader-key-validated",
    clientId: `${AUTH_INFO_CLIENT_PREFIX}${userId}:${actor}`,
    scopes: (scope || "steadier:read").split(/\s+/).filter(Boolean),
    expiresAt: Math.floor(Date.parse(expiresAt) / 1000),
    // The canonical public address is a constant and is never derived from Host.
    resource: new URL(COMPASS_MCP_URL),
  };
}

function userIdFromAuthInfo(authInfo: AuthInfo | undefined): number | null {
  const clientId = authInfo?.clientId;
  if (
    typeof clientId !== "string" ||
    !clientId.startsWith(AUTH_INFO_CLIENT_PREFIX)
  ) {
    return null;
  }
  const match = /^([1-9]\d*)(?::(?:claude|chatgpt|connector))?$/.exec(
    clientId.slice(AUTH_INFO_CLIENT_PREFIX.length)
  );
  if (!match) return null;
  const userId = Number(match[1]);
  return Number.isSafeInteger(userId) ? userId : null;
}

function connectorActorFromAuthInfo(
  authInfo: AuthInfo | undefined
): ConnectorActor {
  const clientId = authInfo?.clientId;
  const match =
    typeof clientId === "string"
      ? /^steadier-reader:[1-9]\d*:(claude|chatgpt|connector)$/.exec(clientId)
      : null;
  return (match?.[1] as ConnectorActor | undefined) ?? "claude";
}

async function cloudRecordForUser(
  repository: SteadierRepository,
  userId: number
): Promise<CloudRecord> {
  const stored = await repository.readWorkspace(userId);
  return stored ? cloudRecordFromStored(stored) : emptyCloudRecord();
}

function textResult(payload: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function notFoundResult(kind: "task" | "project"): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: `${kind === "task" ? "Task" : "Project"} not found.`,
      },
    ],
    structuredContent: { code: "NOT_FOUND" },
    isError: true,
  };
}

function unavailableResult(): ToolResult {
  return {
    content: [
      { type: "text", text: "Saved context is unavailable right now." },
    ],
    structuredContent: { code: "CONTEXT_UNAVAILABLE" },
    isError: true,
  };
}

function invalidArgumentsResult(): ToolResult {
  return {
    content: [{ type: "text", text: "Invalid tool arguments." }],
    structuredContent: { code: "INVALID_ARGUMENTS" },
    isError: true,
  };
}

function freshnessFor(record: CloudRecord, now: Date): Record<string, unknown> {
  return compassContext(record, now).freshness;
}

/**
 * Builds a server with only read-only user-scoped tools. The official SDK calls
 * this factory separately for every modern request and legacy stateless request.
 */
export function createCompassMcpServer(
  repository: SteadierRepository,
  userId: number,
  access: {
    changes?: WorkspaceChangeRepository;
    canWrite?: boolean;
    actor?: ConnectorActor;
  } = {}
): McpServer {
  const server = new McpServer({
    name: "steadier-my-life",
    version: MCP_SERVER_VERSION,
  });

  server.registerTool(
    "read_my_life_context",
    {
      title: "Read my current My Life context",
      description: `Read the complete saved workspace, derived availability, and freshness metadata. ${PLANNING_GUIDANCE}`,
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (): Promise<ToolResult> => {
      try {
        const now = new Date();
        return textResult({
          ...compassContext(await cloudRecordForUser(repository, userId), now),
          dataNotice: UNTRUSTED_DATA_RULE,
        });
      } catch {
        return unavailableResult();
      }
    }
  );

  server.registerTool(
    "read_my_life_task",
    {
      title: "Read one My Life task",
      description: `Read one task from the authenticated owner's saved workspace, its linked project, and its derived blockers and availability. Times are Australia/Adelaide. ${UNTRUSTED_DATA_RULE}`,
      inputSchema: TASK_INPUT_SCHEMA,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async input => {
      const parsedInput = taskInput.safeParse(input);
      if (!parsedInput.success) return invalidArgumentsResult();
      const { taskId } = parsedInput.data;
      try {
        const now = new Date();
        const record = await cloudRecordForUser(repository, userId);
        const task = record.workspace.tasks.find(
          candidate => candidate.id === taskId
        );
        if (!task) return notFoundResult("task");
        const derived = compassContext(record, now);
        return textResult({
          schemaVersion: "steadier-compass-task-v1",
          dataNotice: UNTRUSTED_DATA_RULE,
          task: presentTask(task),
          setup: taskSetup(task, record.workspace.tasks),
          project: (() => {
            const linked = task.projectId
              ? record.workspace.projects.find(
                  project => project.id === task.projectId
                )
              : undefined;
            return linked ? presentProject(linked) : null;
          })(),
          availability:
            derived.derived.tasks.find(row => row.taskId === task.id) ?? null,
          freshness: derived.freshness,
        });
      } catch {
        return unavailableResult();
      }
    }
  );

  server.registerTool(
    "read_my_life_project",
    {
      title: "Read one My Life project",
      description: `Read one project from the authenticated owner's saved workspace, all linked owned tasks, their derived availability, and freshness metadata. Times are Australia/Adelaide. ${UNTRUSTED_DATA_RULE}`,
      inputSchema: PROJECT_INPUT_SCHEMA,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async input => {
      const parsedInput = projectInput.safeParse(input);
      if (!parsedInput.success) return invalidArgumentsResult();
      const { projectId } = parsedInput.data;
      try {
        const now = new Date();
        const record = await cloudRecordForUser(repository, userId);
        const project = record.workspace.projects.find(
          candidate => candidate.id === projectId
        );
        if (!project) return notFoundResult("project");
        const derived = compassContext(record, now);
        const tasks = record.workspace.tasks.filter(
          task => task.projectId === project.id
        );
        const taskIds = new Set(tasks.map(task => task.id));
        return textResult({
          schemaVersion: "steadier-compass-project-v1",
          dataNotice: UNTRUSTED_DATA_RULE,
          project: presentProject(project),
          tasks: tasks.map(presentTask),
          availability: derived.derived.tasks.filter(row =>
            taskIds.has(row.taskId)
          ),
          freshness: derived.freshness,
        });
      } catch {
        return unavailableResult();
      }
    }
  );

  server.registerTool(
    "read_my_life_sheet",
    {
      title: "Read my My Life CSV sheet",
      description: `Read the complete saved workspace as a CSV sheet plus freshness metadata. The CSV is a server snapshot and does not include unsynced offline edits. ${UNTRUSTED_DATA_RULE}`,
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (): Promise<ToolResult> => {
      try {
        const now = new Date();
        const record = await cloudRecordForUser(repository, userId);
        const payload = {
          schemaVersion: "steadier-compass-sheet-v1",
          dataNotice: UNTRUSTED_DATA_RULE,
          csv: workspaceSheetCsv(record, now),
          freshness: freshnessFor(record, now),
        };
        return {
          content: [
            { type: "text", text: UNTRUSTED_DATA_RULE },
            { type: "text", text: payload.csv },
          ],
          structuredContent: payload,
        };
      } catch {
        return unavailableResult();
      }
    }
  );

  if (access.changes) {
    registerBackupReadTools(server, access.changes, userId);
    // Only a connector the owner approved with "read & changes" sees write tools.
    if (access.canWrite)
      registerWriteTools(
        server,
        access.changes,
        userId,
        access.actor ?? "claude"
      );
  }

  return server;
}

/**
 * The SDK handler is reusable because it stores no owner state. Its server
 * factory receives the authenticated request context and returns a new server
 * for each modern request or stateless legacy request.
 */
export function createCompassMcpHandler(
  repository: SteadierRepository,
  changes?: WorkspaceChangeRepository
) {
  const factory: McpServerFactory = context => {
    const userId = userIdFromAuthInfo(context.authInfo);
    if (userId === null) {
      // The route always authenticates before reaching this factory. Do not
      // disclose internal context details if a future mount violates that rule.
      throw new Error("MCP authentication context is unavailable.");
    }
    return createCompassMcpServer(repository, userId, {
      changes,
      canWrite: (context.authInfo?.scopes ?? []).includes(COMPASS_WRITE_SCOPE),
      actor: connectorActorFromAuthInfo(context.authInfo),
    });
  };
  return createMcpHandler(factory, {
    responseMode: "json",
    legacy: "stateless",
    // Tool callbacks and the HTTP boundary return safe errors; avoid logging
    // potentially sensitive request context from the SDK error callback.
    onerror: () => undefined,
  });
}

/**
 * Mount the native Compass endpoint. It uses opaque reader-key Bearer auth only;
 * no browser session or cookie is accepted as an MCP credential.
 */
export function registerCompassMcpRoutes(
  app: Express,
  dependencies: CompassMcpRouteDependencies = {}
): void {
  const production = dependencies.repository
    ? null
    : createProductionRepository();
  const repository = dependencies.repository ?? production!;
  const changes = dependencies.changes ?? production ?? undefined;
  const handler = createCompassMcpHandler(repository, changes);
  // Legacy SSE sets its own no-cache header. Enforce private/no-store on the
  // final Web response, before the Node adapter writes headers for either era.
  const privateHandler = {
    async fetch(...args: Parameters<typeof handler.fetch>) {
      const result = await handler.fetch(...args);
      const headers = new globalThis.Headers(result.headers);
      headers.set("Cache-Control", "private, no-store, no-transform");
      headers.set("Pragma", "no-cache");
      return new globalThis.Response(result.body, {
        status: result.status,
        statusText: result.statusText,
        headers,
      });
    },
  };
  const nodeHandler = toNodeHandler(privateHandler, {
    // The outer boundary deliberately avoids logging raw request headers/bodies.
    onerror: () => undefined,
  });

  app.all(COMPASS_MCP_PATH, (request, response) => {
    void (async () => {
      noStore(response);
      if (hasUnsupportedQuery(request)) {
        sendJsonError(response, 400, "INVALID_REQUEST");
        return;
      }
      if (!hasAllowedOrigin(request)) {
        sendJsonError(response, 403, "FORBIDDEN");
        return;
      }

      let credential: Awaited<ReturnType<typeof authenticateCompassToken>>;
      try {
        credential = await authenticateCompassToken(
          repository,
          request.get("authorization")
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "CompassAuthenticationError"
        ) {
          sendUnauthorized(response);
          return;
        }
        sendJsonError(response, 500, "SERVER_ERROR");
        return;
      }

      // The SDK adapter forwards this safe context to its per-request factory.
      // It contains no opaque token and the resource URL is canonical, not Host-derived.
      (request as Request & { auth?: ScopedAuthInfo }).auth = scopedAuthInfo(
        credential.userId,
        credential.key.expiresAt,
        credential.key.scope,
        credential.key.connectorActor ?? "claude"
      );

      try {
        await nodeHandler(request, response, request.body);
      } catch {
        if (!response.headersSent) sendJsonError(response, 500, "SERVER_ERROR");
      }
    })();
  });
}
