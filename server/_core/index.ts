import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerAndroidAppRoutes } from "./androidApp";
import { registerVoiceRoutes } from "../steadier/voice";
import { registerVoicePage } from "../steadier/voicePage";
import { registerGuidePage } from "../steadier/guide";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerSteadierRoutes } from "../steadier/routes";
import { registerCompassMcpRoutes } from "../steadier/mcp";
import { registerCompassOAuthRoutes } from "../steadier/compassOAuth";
import { registerCompassConnectionDiagnostics } from "../steadier/connectionDiagnostics";

async function startServer() {
  const app = express();
  // Behind Caddy on the same machine: trust its X-Forwarded-* headers for client IPs.
  app.set("trust proxy", "loopback, uniquelocal");
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/platform/config.js", (_req, res) => {
    res
      .set("Cache-Control", "no-store")
      .type("application/javascript")
      .send(publicPlatformScript());
  });
  registerOAuthRoutes(app);
  registerAndroidAppRoutes(app);
  registerVoicePage(app);
  registerGuidePage(app);
  registerVoiceRoutes(app);
  // Owner-scoped data routes must be registered before the Vite/static SPA fallback.
  registerSteadierRoutes(app);
  registerCompassConnectionDiagnostics(app);
  registerCompassOAuthRoutes(app);
  registerCompassMcpRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // Never turn an unknown API request into the client application HTML.
  app.use("/api", (_req, res) => {
    res
      .status(404)
      .set("Cache-Control", "no-store")
      .json({ code: "API_NOT_FOUND" });
  });
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  server.on("error", error => {
    console.error("Server failed:", error.message);
    process.exit(1);
  });
  server.listen(port, "0.0.0.0", () =>
    console.log(`Server listening on port ${port}`)
  );
}

startServer().catch(error => {
  console.error(error);
  process.exit(1);
});
