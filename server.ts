import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { prisma } from "./src/prisma";
import { redis } from "./src/redis";
import { dbStore } from "./src/dbStore";
import { createStorageAdapter } from "./server/utils/storage";

// Middleware Imports
import { 
  helmetMiddleware, 
  apiRateLimiter, 
  correlationIdMiddleware, 
  errorHandler 
} from "./server/middleware/security";

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
import projectIntakeRouter from "./server/routes/projectIntake";
import verticalsRouter from "./server/routes/verticals";

const app = express();

// 1. Basic Security & Body Parsing
app.use(helmetMiddleware);
app.use(express.json());

// 2. Correlation ID injection
app.use(correlationIdMiddleware);

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
app.use("/api", projectIntakeRouter);
app.use("/api", verticalsRouter);

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
    app.get("*", (req: Request, res: Response) => {
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
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Enterprise App Server listening on http://0.0.0.0:${PORT}`);
  });

  // Phase 7 (fleet/license management): reports to the vendor's fleet manager and picks up any
  // pending admin commands - client-initiated, since on-prem installs sit behind NAT/firewalls
  // that block inbound but allow outbound. Runs once shortly after boot, then every 20 minutes.
  const { runHeartbeatForAllEnabledTenants } = await import("./server/utils/fleetLicense");
  setTimeout(() => runHeartbeatForAllEnabledTenants().catch((err) => console.error("Initial fleet heartbeat failed:", err)), 30000);
  setInterval(() => runHeartbeatForAllEnabledTenants().catch((err) => console.error("Fleet heartbeat failed:", err)), 20 * 60 * 1000);
}

bootstrap().catch((err) => {
  console.error("Failed to bootstrap enterprise server:", err);
});
