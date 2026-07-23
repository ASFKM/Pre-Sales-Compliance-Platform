import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import { z } from "zod";
import multer from "multer";
import { requireAuth } from "./auth";
import { captureFrontendError, submitBugReport, uploadBugReportAttachment } from "../diagnostics/agent";
import { dbStore } from "../../src/dbStore";
import { runWithTenant } from "../../src/tenantContext";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const ALLOWED_SCREENSHOT_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

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

// "Reportar problema" (briefing Seção 17) - the form itself only ever asks 3 questions (what
// happened / expected behavior / how to reproduce); reporter identity is automatic context from
// the session, never a 4th question, and never trusted from the request body (a user could type
// any name/email there - the real identity is whoever this session actually belongs to).
router.post(
  "/diagnostics-agent/attachments",
  requireAuth,
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.headers["x-tenant-id"] as string | undefined;
      if (!tenantId) {
        return res.status(400).json({ success: false, message: "Missing tenant context." });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: "file is required." });
      }
      if (!ALLOWED_SCREENSHOT_MIME_TYPES.has(req.file.mimetype)) {
        return res.status(400).json({ success: false, message: `Tipo de arquivo não permitido: ${req.file.mimetype}` });
      }
      const result = await uploadBugReportAttachment(tenantId, req.file.buffer, req.file.mimetype, req.file.originalname || "screenshot.png");
      if (!result.ok) {
        return res.status(502).json({ success: false, message: result.error || "Falha ao enviar anexo." });
      }
      res.status(201).json({ success: true, reference: result.reference });
    } catch (err) {
      next(err);
    }
  }
);

const BugReportSchema = z.object({
  title: z.string().min(1).max(200),
  what_happened: z.string().min(1),
  expected_behavior: z.string().optional(),
  steps_to_reproduce: z.string().optional(),
  reported_severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  route: z.string().max(500).optional(),
  session_id: z.string().max(200).optional(),
  correlation_id: z.string().max(200).optional(),
  screenshot_reference: z.string().optional(),
});

router.post("/diagnostics-agent/bug-reports", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = BugReportSchema.parse(req.body);
    const tenantId = req.headers["x-tenant-id"] as string | undefined;
    const userId = req.headers["x-user-id"] as string | undefined;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "Missing tenant context." });
    }

    const user = userId ? await runWithTenant({ tenantId }, () => dbStore.getUserById(userId)) : undefined;

    const result = await submitBugReport({
      tenantId,
      title: validated.title,
      whatHappened: validated.what_happened,
      expectedBehavior: validated.expected_behavior,
      stepsToReproduce: validated.steps_to_reproduce,
      reportedSeverity: validated.reported_severity,
      route: validated.route,
      sessionId: validated.session_id,
      correlationId: validated.correlation_id,
      screenshotReference: validated.screenshot_reference,
      reporterName: user?.name,
      reporterEmail: user?.email,
    });

    if (!result.ok) {
      return res.status(502).json({ success: false, message: result.error || "Não foi possível enviar o report agora. Tente novamente em instantes." });
    }
    res.status(201).json({ success: true, confirmation_code: result.confirmationCode });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

export default router;
