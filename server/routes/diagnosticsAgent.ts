import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import { z } from "zod";
import { requireAuth } from "./auth";
import { captureFrontendError } from "../diagnostics/agent";

const router = express.Router();

// CloudMountain Diagnostics Agent (CDA), frontend side. Deliberately its own router/path -
// NOT the same as server/routes/diagnostics.ts (an unrelated internal admin debug summary panel)
// and not the CMSaaS's own /api/diagnostics/v1/* ingestion API (a different server entirely). The
// browser never holds this installation's Fleet Manager API key - it authenticates the normal way
// (requireAuth, an existing session), and this route is what forwards into the same buffered
// Agent (server/diagnostics/agent.ts) that backend errors go through, keyed off the session's own
// tenant, never a tenant the browser claims for itself.
const FrontendEventSchema = z.object({
  message: z.string().min(1).max(5000),
  stack_trace: z.string().max(20000).optional(),
  route: z.string().max(500).optional(),
  session_id: z.string().max(200).optional(),
  correlation_id: z.string().max(200).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
});

router.post("/diagnostics-agent/frontend-events", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = FrontendEventSchema.parse(req.body);
    const tenantId = req.headers["x-tenant-id"] as string | undefined;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "Missing tenant context." });
    }
    await captureFrontendError({
      tenantId,
      message: validated.message,
      stackTrace: validated.stack_trace,
      route: validated.route,
      sessionId: validated.session_id,
      correlationId: validated.correlation_id,
      severity: validated.severity,
    });
    // 202 Accepted, not 201/200 with a body - the caller (frontend error handler) doesn't need
    // anything back, and must never be blocked/retried waiting on us.
    res.status(202).json({ success: true });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

export default router;
