import type { Express, Request, Response } from "express";
import type { CloudRecord } from "../../shared/cloud";
import { sdk } from "../_core/sdk";
import { parseNear, searchPlaces } from "./placeSearch";
import { compassContext, workspaceSheetCsv } from "./projections";
import { createProductionRepository } from "./repository";
import {
  BACKUP_LIMIT,
  ChangeError,
  applyGuardedChange,
  type WorkspaceChangeRepository,
} from "./changes";
import { planConfirmDelete, planKeepItem, planRestore } from "./connectorOps";
import { exportBackup } from "../../client/src/domain/transfer";
import { adelaideDate, adelaideTimestamp } from "../../shared/time";
import {
  CALENDAR_TOKEN_PATTERN,
  DrizzleCalendarFeedRepository,
  calendarFeedUrl,
  createCalendarToken,
  hashCalendarToken,
  workspaceCalendarIcs,
  type CalendarFeedRepository,
} from "./calendar";
import {
  authenticateCompassToken,
  cloudRecordFromStored,
  createCompassKey,
  emptyCloudRecord,
  saveWorkspace,
  type SteadierRepository,
  WorkspaceConflictError,
} from "./service";
import {
  assertCompassLabel,
  parseCloudWrite,
  ValidationError,
} from "./validation";

export type SteadierSessionUser = {
  id: number;
  name: string | null;
  isCron?: boolean;
};

export type SteadierRouteDependencies = {
  repository?: SteadierRepository;
  changes?: WorkspaceChangeRepository;
  calendar?: CalendarFeedRepository;
  authenticateSession?: (request: Request) => Promise<SteadierSessionUser>;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>
  ) {
    super(String(body.code ?? status));
  }
}

function noStore(
  _request: Request,
  response: Response,
  next: () => void
): void {
  response.set("Cache-Control", "private, no-store");
  next();
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
      if (error instanceof ValidationError) {
        response
          .status(400)
          .json({ code: "INVALID_REQUEST", message: error.message });
        return;
      }
      if (error instanceof ChangeError) {
        const status =
          error.code === "NOT_FOUND"
            ? 404
            : error.code === "INVALID_CHANGE"
              ? 400
              : error.code === "BACKUP_FAILED"
                ? 503
                : 409;
        response
          .status(status)
          .json({ code: error.code, message: error.message });
        return;
      }
      if (error instanceof WorkspaceConflictError) {
        response.status(409).json({ code: error.code, record: error.record });
        return;
      }
      if (
        error instanceof Error &&
        error.name === "CompassAuthenticationError"
      ) {
        response.status(401).json({ code: "UNAUTHORIZED" });
        return;
      }
      if (error instanceof Error && error.name === "CompassKeyLimitError") {
        response
          .status(409)
          .json({ code: "KEY_LIMIT", message: error.message });
        return;
      }
      // Deliberately do not log request headers, bodies, or opaque capabilities.
      response.status(500).json({ code: "SERVER_ERROR" });
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
    // Scheduled-task identities are deliberately not owner identities.
    throw new HttpError(403, { code: "FORBIDDEN" });
  }
  return user;
}

/**
 * Bind an authenticated request to the account the client believed it was using.
 * This is intentionally checked after session authentication, so a changed browser
 * cookie cannot cause an old account's queued data to be applied to the new owner.
 */
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

function parseKeyRequest(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError("request body must be a JSON object.");
  }
  const keys = Object.keys(body);
  if (keys.some(key => key !== "label")) {
    throw new ValidationError("Compass key request has unsupported fields.");
  }
  return assertCompassLabel((body as { label?: unknown }).label);
}

function parsePositiveId(value: string): number {
  if (!/^\d+$/.test(value))
    throw new ValidationError("key id must be a positive integer.");
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ValidationError("key id must be a positive integer.");
  }
  return id;
}

async function cloudRecordForUser(
  repository: SteadierRepository,
  userId: number
): Promise<CloudRecord> {
  const stored = await repository.readWorkspace(userId);
  return stored ? cloudRecordFromStored(stored) : emptyCloudRecord();
}

function sendsCsv(request: Request): boolean {
  const accept = request.get("accept") ?? "";
  return (
    request.path.endsWith(".csv") ||
    request.query.format === "csv" ||
    /(?:^|,)\s*text\/csv(?:\s*;|\s*,|$)/i.test(accept)
  );
}

function sendCsv(response: Response, record: CloudRecord): void {
  response
    .status(200)
    .set("Content-Type", "text/csv; charset=utf-8")
    .set("Content-Disposition", 'attachment; filename="steadier-sheet.csv"')
    .send(workspaceSheetCsv(record));
}

/**
 * Register all private Steadier endpoints. Tests inject an auth function and
 * in-memory repository; production gets validated Manus sessions and getDb().
 */
export function registerSteadierRoutes(
  app: Express,
  dependencies: SteadierRouteDependencies = {}
): void {
  const production = dependencies.repository
    ? null
    : createProductionRepository();
  const repository = dependencies.repository ?? production!;
  const changes: WorkspaceChangeRepository | null =
    dependencies.changes ?? production ?? null;
  const requireChanges = (): WorkspaceChangeRepository => {
    if (!changes) throw new HttpError(503, { code: "UNAVAILABLE" });
    return changes;
  };
  const authenticateSession =
    dependencies.authenticateSession ??
    (async (request: Request): Promise<SteadierSessionUser> =>
      sdk.authenticateRequest(request));

  app.use("/api/steadier", noStore);
  app.use("/api/compass", noStore);

  app.get(
    "/api/steadier/session",
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      response.status(200).json({ user: { id: user.id, name: user.name } });
    })
  );

  app.get(
    "/api/steadier/places/search",
    asyncRoute(async (request, response) => {
      await requireSignedInUser(request, authenticateSession);
      const q =
        typeof request.query.q === "string" ? request.query.q.trim() : "";
      if (q.length < 2 || q.length > 200) {
        throw new HttpError(400, {
          code: "INVALID_SEARCH",
          message: "Type 2 to 200 characters to search.",
        });
      }
      try {
        const results = await searchPlaces(q, parseNear(request.query.near));
        response.status(200).json({ results });
      } catch {
        throw new HttpError(502, {
          code: "MAPS_UNAVAILABLE",
          message:
            "Address search is not available right now. Use your current location or paste a map link.",
        });
      }
    })
  );

  app.get(
    "/api/steadier/workspace",
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      requireExpectedOwner(request, user);
      response.status(200).json(await cloudRecordForUser(repository, user.id));
    })
  );

  app.get(
    "/api/steadier/recoveries",
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      requireExpectedOwner(request, user);
      response.status(200).json({
        copies: await repository.listWorkspaceRecoveries(user.id, 3),
      });
    })
  );

  app.put(
    "/api/steadier/workspace",
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      requireExpectedOwner(request, user);
      requireCookieWriteRequest(request);
      const record = await saveWorkspace(
        repository,
        user.id,
        parseCloudWrite(request.body)
      );
      response.status(200).json(record);
    })
  );

  const signedInSheet = asyncRoute(async (request, response) => {
    const user = await requireSignedInUser(request, authenticateSession);
    requireExpectedOwner(request, user);
    const record = await cloudRecordForUser(repository, user.id);
    if (sendsCsv(request)) {
      sendCsv(response, record);
      return;
    }
    response.status(200).json(compassContext(record));
  });
  app.get("/api/steadier/sheet", signedInSheet);
  app.get("/api/steadier/sheet.csv", signedInSheet);

  app.get(
    "/api/steadier/compass-keys",
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      requireExpectedOwner(request, user);
      response
        .status(200)
        .json({ keys: await repository.listCompassKeys(user.id) });
    })
  );

  app.post(
    "/api/steadier/compass-keys",
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      requireExpectedOwner(request, user);
      requireCookieWriteRequest(request);
      const label = parseKeyRequest(request.body);
      response
        .status(201)
        .json(await createCompassKey(repository, user.id, label));
    })
  );

  app.delete(
    "/api/steadier/compass-keys/:id",
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      requireExpectedOwner(request, user);
      requireCookieWriteRequest(request);
      await repository.revokeCompassKey(
        user.id,
        parsePositiveId(request.params.id),
        new Date()
      );
      // Owner-scoped and idempotent: never disclose whether another owner's id exists.
      response.status(200).json({ ok: true });
    })
  );

  const compassRecord = async (request: Request): Promise<CloudRecord> => {
    const credential = await authenticateCompassToken(
      repository,
      request.get("authorization")
    );
    return cloudRecordForUser(repository, credential.userId);
  };

  // ---- Private calendar subscription (Google/Apple/Outlook) ----
  const calendar: CalendarFeedRepository =
    dependencies.calendar ?? new DrizzleCalendarFeedRepository();

  app.get(
    "/api/steadier/calendar-feed",
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      requireExpectedOwner(request, user);
      response.status(200).json(await calendar.readActiveFeed(user.id));
    })
  );

  /** Creates a new private link; any earlier link stops working. Shown once. */
  app.post(
    "/api/steadier/calendar-feed",
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      requireExpectedOwner(request, user);
      requireCookieWriteRequest(request);
      const hideTitles =
        typeof request.body === "object" &&
        request.body !== null &&
        (request.body as { hideTitles?: unknown }).hideTitles === true;
      const token = createCalendarToken();
      await calendar.replaceFeed(
        user.id,
        hashCalendarToken(token),
        hideTitles,
        new Date()
      );
      response.status(201).json({
        url: calendarFeedUrl(token),
        status: await calendar.readActiveFeed(user.id),
      });
    })
  );

  app.delete(
    "/api/steadier/calendar-feed",
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      requireExpectedOwner(request, user);
      requireCookieWriteRequest(request);
      await calendar.revokeFeed(user.id, new Date());
      response.status(200).json({ ok: true });
    })
  );

  /**
   * The subscription itself. Calendar apps cannot sign in, so the unguessable
   * link is the credential (only its hash is stored). Read-only; no notes.
   */
  app.get(
    "/api/calendar/:token/steadier.ics",
    asyncRoute(async (request, response) => {
      const token = String(request.params.token ?? "");
      if (!CALENDAR_TOKEN_PATTERN.test(token))
        throw new HttpError(404, { code: "NOT_FOUND" });
      const feed = await calendar.findActiveFeedByHash(
        hashCalendarToken(token)
      );
      if (!feed) throw new HttpError(404, { code: "NOT_FOUND" });
      const record = await cloudRecordForUser(repository, feed.userId);
      void calendar.touchFeed(feed.id, new Date()).catch(() => undefined);
      response
        .status(200)
        .set("Content-Type", "text/calendar; charset=utf-8")
        .set("Content-Disposition", 'inline; filename="steadier.ics"')
        .set("Cache-Control", "private, max-age=300")
        .set("X-Robots-Tag", "noindex")
        .send(
          workspaceCalendarIcs(record.workspace, {
            hideTitles: feed.hideTitles,
          })
        );
    })
  );

  // ---- Server backups (owner only). Claude can list them but never restore. ----
  app.get(
    "/api/steadier/backups",
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      requireExpectedOwner(request, user);
      response.status(200).json({
        limit: BACKUP_LIMIT,
        backups: await requireChanges().listWorkspaceBackups(
          user.id,
          BACKUP_LIMIT
        ),
      });
    })
  );

  app.get(
    "/api/steadier/backups/:id/download",
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      requireExpectedOwner(request, user);
      const backup = await requireChanges().readWorkspaceBackup(
        user.id,
        parsePositiveId(request.params.id)
      );
      if (!backup) throw new HttpError(404, { code: "NOT_FOUND" });
      response
        .status(200)
        .set("Content-Type", "application/json; charset=utf-8")
        .set(
          "Content-Disposition",
          `attachment; filename="steadier-server-backup-${backup.id}.json"`
        )
        .send(exportBackup(backup.workspace));
    })
  );

  app.post(
    "/api/steadier/backups/:id/restore",
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      requireExpectedOwner(request, user);
      requireCookieWriteRequest(request);
      const store = requireChanges();
      const backup = await store.readWorkspaceBackup(
        user.id,
        parsePositiveId(request.params.id)
      );
      if (!backup) throw new HttpError(404, { code: "NOT_FOUND" });
      // The current workspace is itself backed up first, so a restore can be undone.
      const applied = await applyGuardedChange(store, user.id, "owner", () =>
        planRestore(backup)
      );
      response.status(200).json({
        ok: true,
        restoredBackupId: backup.id,
        revision: applied.revision,
      });
    })
  );

  /** Manual full export of the current server workspace, importable by Restore. */
  app.get(
    "/api/steadier/export",
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      requireExpectedOwner(request, user);
      const record = await cloudRecordForUser(repository, user.id);
      response
        .status(200)
        .set("Content-Type", "application/json; charset=utf-8")
        .set(
          "Content-Disposition",
          `attachment; filename="steadier-full-backup-${adelaideDate()}.json"`
        )
        .set("X-Steadier-Exported-At", adelaideTimestamp())
        .send(exportBackup(record.workspace));
    })
  );

  // ---- Claude's delete requests: only the owner can delete or keep. ----
  app.get(
    "/api/steadier/pending-deletes",
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      requireExpectedOwner(request, user);
      response.status(200).json({
        pending: await requireChanges().listPendingDeletes(user.id, "pending"),
      });
    })
  );

  const decidePendingDelete = (decision: "delete" | "keep") =>
    asyncRoute(async (request, response) => {
      const user = await requireSignedInUser(request, authenticateSession);
      requireExpectedOwner(request, user);
      requireCookieWriteRequest(request);
      const store = requireChanges();
      const pending = await store.findPendingDelete(
        user.id,
        parsePositiveId(request.params.id)
      );
      if (!pending) throw new HttpError(404, { code: "NOT_FOUND" });
      if (pending.status !== "pending") {
        throw new HttpError(409, { code: "ALREADY_DECIDED" });
      }
      const now = new Date();
      const applied = await applyGuardedChange<unknown>(
        store,
        user.id,
        "owner",
        workspace =>
          decision === "delete"
            ? planConfirmDelete(workspace, pending, now)
            : planKeepItem(workspace, pending, now)
      );
      response
        .status(200)
        .json({ ok: true, decision, revision: applied.revision });
    });
  app.post(
    "/api/steadier/pending-deletes/:id/confirm",
    decidePendingDelete("delete")
  );
  app.post(
    "/api/steadier/pending-deletes/:id/keep",
    decidePendingDelete("keep")
  );

  app.get(
    "/api/compass/context",
    asyncRoute(async (request, response) => {
      // This path never calls session auth; only opaque read capability Bearer tokens work.
      response.status(200).json(compassContext(await compassRecord(request)));
    })
  );

  app.get(
    "/api/compass/sheet.csv",
    asyncRoute(async (request, response) => {
      sendCsv(response, await compassRecord(request));
    })
  );

  app.get(
    "/api/health",
    asyncRoute(async (_request, response) => {
      try {
        await repository.checkSchema();
        response.status(200).json({ status: "ok" });
      } catch {
        response.status(503).json({ status: "unavailable" });
      }
    })
  );
}
