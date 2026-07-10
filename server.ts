import express, { Response, NextFunction } from "express";
import type { Request } from "./server/types/express";
import path from "path";
import fs from "fs";
import pinoHttp from "pino-http";
import { createServer as createViteServer } from "vite";
import { prisma } from "./src/prisma";
import { redis } from "./src/redis";
import { dbStore } from "./src/dbStore";
import { createStorageAdapter } from "./server/utils/storage";
import { logger } from "./server/utils/logger";

// Middleware Imports
import {
  helmetMiddleware,
  apiRateLimiter,
  correlationIdMiddleware,
  errorHandler
} from "./server/middleware/security";

// Fatal-level safety net: neither of these had any handler before, so an exception escaping every
// other try/catch (in particular, the "void runWithTenant(...)" detached background blocks used
// throughout server/routes/analysis.ts, proposals.ts, projectIntake.ts, knowledgeBase.ts) would
// either crash the process with an unstructured stack trace (uncaughtException) or, from Node 15+,
// also crash it silently by default (unhandledRejection) - either way with zero structured log of
// why. This is a last resort, not the primary mechanism: every one of those background blocks
// already has its own try/catch from earlier hardening work: this only fires for something that
// escapes all of them.
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaughtException - process will exit");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandledRejection - process will exit");
  process.exit(1);
});

// Router Imports
import authRouter from "./server/routes/auth";
import usersRouter from "./server/routes/users";
import rolesRouter from "./server/routes/roles";
import projectsRouter from "./server/routes/projects";
import documentsRouter from "./server/routes/documents";
import analysisRouter from "./server/routes/analysis";
import proposalsRouter from "./server/routes/proposals";
import templatesRouter from "./server/routes/templates";
import approvalsRouter from "./server/routes/approvals";
import settingsRouter from "./server/routes/settings";
import integrationsRouter from "./server/routes/integrations";
import auditRouter from "./server/routes/audit";
import diagnosticsRouter from "./server/routes/diagnostics";
import tasksRouter from "./server/routes/tasks";
import userTasksRouter from "./server/routes/userTasks";
import dashboardRouter from "./server/routes/dashboard";
import projectIntakeRouter from "./server/routes/projectIntake";
import verticalsRouter from "./server/routes/verticals";
import messagesRouter from "./server/routes/messages";
import knowledgeBaseRouter from "./server/routes/knowledgeBase";

const app = express();

// Deliberately NOT calling app.set("trust proxy", ...) here. Verified against the live deployment:
// nginx is not installed/active and Node listens directly on 0.0.0.0:3000 with nothing in front -
// Express's default (trust nothing) is the correct, safe setting for that topology. Setting
// "trust proxy" to true or a wildcard with no real proxy in front would let any client spoof its
// own req.ip via a hand-crafted X-Forwarded-For header, defeating the login rate-limiter and
// falsifying audit-log IPs - strictly worse than the status quo. If a reverse proxy (nginx,
// Cloudflare, an ALB) is added later, set this to the number of trusted hops or the proxy's own
// IP/subnet at that time - not before, since there's nothing to trust yet.

// 1. Basic Security & Body Parsing
app.use(helmetMiddleware);
app.use(express.json());

// 2. Correlation ID injection
app.use(correlationIdMiddleware);

// 2b. Structured, per-request logging - attaches req.log (a Pino child logger) directly on the
// request object rather than relying on AsyncLocalStorage, which this codebase has repeatedly
// found unreliable inside route handlers ("AsyncLocalStorage context set by requireAuth's
// middleware isn't reliably reaching route handlers" - see comments throughout server/routes/).
// req.log is guaranteed present in every handler because Express always threads the same req
// object through the chain; requireAuth (server/routes/auth.ts) further enriches it with
// userId/tenantId/roleId the moment those are known. Also auto-logs one line per request with
// method/path/status/response time - visibility the app had none of before.
app.use(pinoHttp({
  logger,
  genReqId: (req) => req.headers["x-correlation-id"] as string,
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
}));

// 3. API Rate Limiting
app.use("/api", apiRateLimiter);

// 4. Register Modular Backend API Routes (Requirement 24)
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/roles", rolesRouter);
app.use("/api/projects", projectsRouter);
app.use("/api", documentsRouter);
app.use("/api", analysisRouter);
app.use("/api", proposalsRouter);
app.use("/api/templates", templatesRouter);
app.use("/api", approvalsRouter);
app.use("/api", settingsRouter);
app.use("/api/integrations", integrationsRouter);
app.use("/api", auditRouter);
app.use("/api", diagnosticsRouter);
app.use("/api", tasksRouter);
app.use("/api", userTasksRouter);
app.use("/api", dashboardRouter);
app.use("/api", projectIntakeRouter);
app.use("/api", verticalsRouter);
app.use("/api", messagesRouter);
app.use("/api", knowledgeBaseRouter);

// 5. Basic Observability / Health Endpoints
app.get("/api/health", (req: Request, res: Response) => {
  res.json({ 
    success: true, 
    status: "healthy", 
    service: "Commercial Assistant AI Core API", 
    uptime: process.uptime() 
  });
});

app.get("/api/health/readiness", async (req: Request, res: Response) => {
  const [databaseOk, redisOk] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    redis.ping().then((reply) => reply === "PONG").catch(() => false),
  ]);

  let storageOk = false;
  try {
    const settings = await dbStore.getSettings();
    storageOk = await createStorageAdapter(settings).checkReachable();
  } catch {
    storageOk = false;
  }

  const ready = databaseOk && redisOk && storageOk;

  res.status(ready ? 200 : 503).json({
    success: ready,
    status: ready ? "ready" : "not_ready",
    database: databaseOk ? "connected" : "unreachable",
    redis: redisOk ? "connected" : "unreachable",
    storage: storageOk ? "accessible" : "unreachable"
  });
});



// 6. API 404 Handler - must run before SPA fallback
app.use("/api", (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: "API route not found",
    path: req.originalUrl
  });
});

// 6. Centralized Error Handling Middleware
app.use(errorHandler);

// 7. Vite Development Middleware / Production static file serving
async function bootstrap() {
  // Ensure template path in uploads directory exists for proposal generation
  const templateDir = path.join(process.cwd(), "uploads", "templates");
  if (!fs.existsSync(templateDir)) {
    fs.mkdirSync(templateDir, { recursive: true });
  }
  const standardTemplatePath = path.join(templateDir, "standard.docx");
  if (!fs.existsSync(standardTemplatePath)) {
    fs.writeFileSync(standardTemplatePath, "Standard Commercial Proposal template schema v1.0", "utf8");
  }

  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // Express 5's path-to-regexp v8 dropped bare "*" as a wildcard path - it now requires a named
    // wildcard segment. "/{*splat}" matches every path including "/" itself (the {} makes the
    // wildcard segment optional), reproducing the old catch-all behavior.
    app.get("/{*splat}", (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    // In development mode, mount Vite dev server as a middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }

  const PORT = 3000;
  // Bound to loopback only - Caddy (Fase 1 of the Zero Trust rollout) is the only thing that
  // should reach this port now, terminating TLS on :443 and reverse-proxying here. Direct LAN
  // access to :3000 is removed from ufw once this is confirmed working end to end.
  app.listen(PORT, "127.0.0.1", () => {
    logger.info({ port: PORT }, "Enterprise App Server listening");
  });

  // Phase 7 (fleet/license management): reports to the vendor's fleet manager and picks up any
  // pending admin commands - client-initiated, since on-prem installs sit behind NAT/firewalls
  // that block inbound but allow outbound. Runs once shortly after boot, then every 20 minutes.
  const { runHeartbeatForAllEnabledTenants } = await import("./server/utils/fleetLicense");
  setTimeout(() => runHeartbeatForAllEnabledTenants().catch((err) => logger.error({ err }, "Initial fleet heartbeat failed")), 30000);
  setInterval(() => runHeartbeatForAllEnabledTenants().catch((err) => logger.error({ err }, "Fleet heartbeat failed")), 20 * 60 * 1000);
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "Failed to bootstrap enterprise server - process will exit");
  process.exit(1);
});
