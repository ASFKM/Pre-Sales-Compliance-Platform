import { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { dbStore } from "../../src/dbStore";

// 1. Configure Helmet middleware
export const helmetMiddleware = helmet({
  contentSecurityPolicy: false, // Turned off to allow Vite's client connection in dev iframe
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

// 3. Configure correlation ID injection
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const correlationId = (req.headers["x-correlation-id"] as string) || `corr-${Math.random().toString(36).substring(2, 11)}`;
  req.headers["x-correlation-id"] = correlationId;
  res.setHeader("X-Correlation-Id", correlationId);
  next();
}

// 4. Centralized Structured Debug Logger
export function logDebugMessage(options: {
  operation: string;
  message: string;
  status: "SUCCESS" | "WARN" | "ERROR" | "FALLBACK" | "INFO";
  durationMs: number;
  correlationId: string;
  userId?: string;
  projectId?: string;
  documentId?: string;
  error?: any;
}) {
  const safeMetadata: any = {};
  if (options.error) {
    safeMetadata.error_message = options.error.message;
    safeMetadata.error_stack = options.error.stack;
  }

  // Fire-and-forget: debug logging must never block the request it is describing.
  dbStore.addDebugLog({
    log_level: options.status === "ERROR" ? "ERROR" : (options.status === "WARN" ? "WARN" : "DEBUG"),
    service_name: "API Service Engine",
    module_name: "server-api",
    environment: process.env.NODE_ENV || "development",
    correlation_id: options.correlationId,
    request_id: `req-${Math.random().toString(36).substring(2, 11)}`,
    user_id: options.userId,
    project_id: options.projectId,
    document_id: options.documentId,
    operation: options.operation,
    message: options.message,
    status: options.status,
    duration_ms: options.durationMs,
    safe_metadata: JSON.stringify(safeMetadata)
  }).catch((err) => console.error("Failed to persist debug log:", err));
}

// 5. Centralized Error Handling Middleware
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-unknown";
  const durationMs = 0;

  console.error(`[Error - ${correlationId}]`, err);

  logDebugMessage({
    operation: `${req.method} ${req.path}`,
    message: err.message || "An unexpected error occurred inside the api server",
    status: "ERROR",
    durationMs,
    correlationId,
    error: err
  });

  // Safe client-friendly response preventing internal leak of stack traces
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "An unexpected system error occurred on the server.",
    correlationId
  });
}
