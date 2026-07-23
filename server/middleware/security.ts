import { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { dbStore } from "../../src/dbStore";
import { logger } from "../utils/logger";
import { sanitizeAndMaskObject } from "../utils/security";

// 1. Configure Helmet middleware. CSP is only enforced when NODE_ENV=production - that's the
// same signal server.ts uses to decide between serving the static dist/ build and mounting Vite's
// dev middleware (which needs its HMR websocket/eval and is never what's running in production).
// The built SPA has no inline <script>, no external script/font/connect targets (single bundled
// JS/CSS, same-origin fetch only - verified in dist/index.html and the API client) but does rely
// on React's style={{...}} prop, which compiles to inline style="" attributes, so style-src needs
// 'unsafe-inline'. upgradeInsecureRequests is explicitly disabled - Helmet includes it by default,
// and this server (like Fleet Manager's) is still plain HTTP with no reverse proxy/TLS in front
// yet (Fase 1 of the Zero Trust rollout), so it would make browsers try to upgrade requests to a
// https:// origin that doesn't exist here.
const isProductionEnv = process.env.NODE_ENV === "production";
export const helmetMiddleware = helmet({
  contentSecurityPolicy: isProductionEnv
    ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          fontSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'self'"],
          upgradeInsecureRequests: null,
        },
      }
    : false, // Turned off in dev to allow Vite's client connection in dev iframe
  crossOriginEmbedderPolicy: false,
});

// 2. Configure rate limiting for API routes. 100 req/15min sounded reasonable in isolation but
// this app's own admin console routinely fires a dozen-plus requests per page load
// (fetchGlobalConfigs) plus more on every settings save - a single admin doing normal interactive
// testing blew through it in minutes, with no way to distinguish that from actual abuse. Raised
// to a ceiling generous enough for real heavy interactive use while still bounding automated
// abuse; brute-force protection on login now lives in its own stricter limiter instead of sharing
// this one.
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    success: false,
    message: "Too many requests from this endpoint, please retry after 15 minutes."
  }
});

// Dedicated, much stricter limiter for the login endpoint specifically - this is the one place
// the generous general limit above would otherwise leave brute-force guessing unconstrained.
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 login attempts per IP per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts, please retry after 15 minutes."
  }
});

// Every route below runs behind requireAuth or requirePermission (server/routes/auth.ts), which
// always sets req.headers["x-user-id"] from the verified session before calling next() - so a
// missing header here means the request reached a handler it never should have (a route wired up
// without one of those two middlewares). Previously every call site silently fell back to the
// literal "u1" (a real administrator account) instead - which isn't just a missing log line, it's
// a wrong attribution in a compliance platform's own audit trail. Throwing here routes the failure
// through errorHandler instead, where it's now actually visible (correct level, correlation id,
// and once Fase D ships, in the Fleet Manager heartbeat too).
export function requireUserId(req: Request): string {
  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) {
    throw new Error(
      `Missing x-user-id context on ${req.method} ${req.path} - this route must run behind requireAuth/requirePermission.`
    );
  }
  return userId;
}

// 3. Configure correlation ID injection - also the earliest point in the middleware chain, so
// this is where request start time is stamped for real duration measurement in errorHandler
// (which previously hardcoded durationMs to 0).
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const correlationId = (req.headers["x-correlation-id"] as string) || `corr-${Math.random().toString(36).substring(2, 11)}`;
  req.headers["x-correlation-id"] = correlationId;
  res.setHeader("X-Correlation-Id", correlationId);
  (req as any)._startAt = Date.now();
  next();
}

// 4. Centralized Structured Debug Logger - emits to stdout via Pino (structured JSON, real log
// levels) AND persists to DebugLog (the table server/utils/fleetLicense.ts's collectRecentLogs
// ships to the Fleet Manager on every heartbeat) - the one call site both destinations share, so
// callers never have to remember to do both.
const STATUS_TO_LEVEL: Record<string, "info" | "warn" | "error"> = {
  SUCCESS: "info",
  INFO: "info",
  FALLBACK: "warn",
  WARN: "warn",
  ERROR: "error",
};

export function logDebugMessage(options: {
  operation: string;
  message: string;
  status: "SUCCESS" | "WARN" | "ERROR" | "FALLBACK" | "INFO";
  durationMs: number;
  correlationId: string;
  tenantId?: string;
  userId?: string;
  projectId?: string;
  documentId?: string;
  error?: any;
}) {
  const level = STATUS_TO_LEVEL[options.status] || "info";
  const dbLogLevel = level === "error" ? "ERROR" : level === "warn" ? "WARN" : "INFO";

  const safeMetadata: any = {};
  if (options.error) {
    safeMetadata.error_message = options.error.message;
    safeMetadata.error_stack = options.error.stack;
  }
  const sanitizedMetadata = sanitizeAndMaskObject(safeMetadata);

  logger[level](
    {
      correlationId: options.correlationId,
      tenantId: options.tenantId,
      userId: options.userId,
      projectId: options.projectId,
      documentId: options.documentId,
      operation: options.operation,
      durationMs: options.durationMs,
      ...(options.error ? { err: options.error } : {}),
    },
    options.message
  );

  // Fire-and-forget: debug logging must never block the request it is describing.
  dbStore.addDebugLog({
    log_level: dbLogLevel,
    service_name: "API Service Engine",
    module_name: "server-api",
    environment: process.env.NODE_ENV || "development",
    correlation_id: options.correlationId,
    // Reuses the real per-request correlation id instead of generating a fresh random value on
    // every call - previously every logDebugMessage call minted its own random request_id, so
    // multiple log lines from the same request never actually shared one to correlate by.
    request_id: options.correlationId,
    tenant_id: options.tenantId,
    user_id: options.userId,
    project_id: options.projectId,
    document_id: options.documentId,
    operation: options.operation,
    message: options.message,
    status: options.status,
    duration_ms: options.durationMs,
    safe_metadata: JSON.stringify(sanitizedMetadata)
  }).catch((err) => logger.error({ err }, "Failed to persist debug log"));
}

// 5. Centralized Error Handling Middleware - the one place guaranteed to run for every unhandled
// error in the app, so it's also the one place context absolutely cannot be missing.
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-unknown";
  const tenantId = req.headers["x-tenant-id"] as string | undefined;
  const userId = req.headers["x-user-id"] as string | undefined;
  const durationMs = (req as any)._startAt ? Date.now() - (req as any)._startAt : 0;

  logDebugMessage({
    operation: `${req.method} ${req.path}`,
    message: err.message || "An unexpected error occurred inside the api server",
    status: "ERROR",
    durationMs,
    correlationId,
    tenantId,
    userId,
    error: err
  });

  // CloudMountain Diagnostics Agent (CDA) - additive to logDebugMessage above, not a replacement:
  // DebugLog stays the existing log/audit trail this app already ships to the Fleet Manager on
  // heartbeat; this is the separate, faster channel the CDC briefing calls for (Seção 12 -
  // critical events shouldn't wait up to 20 minutes for the next heartbeat). Dynamically imported
  // and wrapped so a bug in the Agent itself can never break error handling for the real request.
  import("../diagnostics/agent")
    .then(({ captureBackendError }) =>
      captureBackendError({
        tenantId,
        message: err.message || "An unexpected error occurred inside the api server",
        exceptionType: err.name,
        stackTrace: err.stack,
        route: req.path,
        httpMethod: req.method,
        httpStatus: err.status || 500,
        operation: `${req.method} ${req.path}`,
        correlationId,
      })
    )
    .catch((agentErr) => logger.error({ err: agentErr }, "cda: capture failed"));

  // Safe client-friendly response - only a generic message reaches the client. Routes that want
  // to surface a specific message to the client (e.g. Zod validation errors) already do so
  // directly with their own res.status(...).json(...) before ever calling next(err); anything
  // that reaches this handler is an unexpected error, and err.message may contain internal
  // details (stack fragments, DB/driver errors, file paths) that must not leak. Full details are
  // still captured via logDebugMessage above for internal diagnosis.
  res.status(err.status || 500).json({
    success: false,
    message: "An unexpected system error occurred on the server.",
    correlationId
  });
}
