import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  registerCompassConnectionDiagnostics,
  type ConnectionDiagnostic,
  type ConnectionDiagnosticLogger,
} from "./connectionDiagnostics";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        server =>
          new Promise<void>((resolve, reject) =>
            server.close(error => (error ? reject(error) : resolve()))
          )
      )
  );
});

async function setup(logger: ConnectionDiagnosticLogger) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  registerCompassConnectionDiagnostics(app, logger);
  app.post("/api/compass/oauth/register", (_req, res) =>
    res.status(400).json({ error: "invalid_client_metadata" })
  );
  app.get("/api/compass/mcp", (_req, res) =>
    res.status(401).json({ code: "UNAUTHORIZED" })
  );
  app.use((_req, res) => res.status(404).send("not found"));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("test listener unavailable");
  return `http://127.0.0.1:${address.port}`;
}

describe("private connection diagnostics", () => {
  it("records fixed registration flags and response status without secrets or submitted values", async () => {
    const events: ConnectionDiagnostic[] = [];
    const base = await setup(event => events.push(event));
    const secret = "sensitive-sentinel-never-log";
    const response = await fetch(
      `${base}/api/compass/oauth/register?state=${secret}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret}`,
          cookie: `session=${secret}`,
        },
        body: JSON.stringify({
          client_name: secret,
          client_id: secret,
          client_secret: secret,
          code: secret,
          code_verifier: secret,
          redirect_uris: [`https://example.test/${secret}`],
          grant_types: ["authorization_code", "refresh_token"],
          token_endpoint_auth_method: "none",
        }),
      }
    );
    expect(response.status).toBe(400);
    await response.text();
    expect(events.find(event => event.phase === "request")).toMatchObject({
      stage: "registration",
      requestsAuthorizationCode: true,
      requestsRefreshToken: true,
      hasClientName: true,
      hasHostedClaudeRedirect: false,
      authMethod: "none",
    });
    expect(events.find(event => event.phase === "response")).toMatchObject({
      stage: "registration",
      status: 400,
      content: "json",
    });
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(JSON.stringify(events)).not.toContain("/api/");
    for (const event of events)
      for (const value of Object.values(event))
        expect(["string", "number", "boolean"]).toContain(typeof value);
  });

  it("does not log private workspace paths, consent identifiers or arbitrary paths", async () => {
    const events: ConnectionDiagnostic[] = [];
    const base = await setup(event => events.push(event));
    for (const path of [
      "/api/steadier/workspace",
      "/api/compass/oauth/requests/private-ticket",
      "/arbitrary/private-secret",
    ]) {
      const response = await fetch(base + path);
      await response.text();
    }
    expect(events).toEqual([]);
  });

  it("cannot turn a rejected request into success when the diagnostic logger fails", async () => {
    const base = await setup(() => {
      throw new Error("logger unavailable");
    });
    const response = await fetch(base + "/api/compass/mcp");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "UNAUTHORIZED" });
  });
});
