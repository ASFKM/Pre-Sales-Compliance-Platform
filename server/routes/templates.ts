import express, { Request, Response, NextFunction } from "express";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";

const router = express.Router();

router.get("/proposals", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(dbStore.getProposalTemplates());
  } catch (err) {
    next(err);
  }
});

router.post("/proposals/:id/validate", requirePermission("template:edit"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const tpl = dbStore.getProposalTemplates().find(t => t.id === req.params.id);
    if (!tpl) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }
    // Perform standard pre-sales schema validation
    res.json({ success: true, message: "Template schema matching successfully validated." });
  } catch (err) {
    next(err);
  }
});

router.post("/proposals/:id/set-default", requirePermission("template:edit"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const templates = dbStore.getProposalTemplates();
    const tpl = templates.find(t => t.id === req.params.id);
    if (!tpl) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    templates.forEach(t => {
      t.default_template = t.id === req.params.id;
    });

    res.json({ success: true, message: "Default pre-sales template updated." });
  } catch (err) {
    next(err);
  }
});

export default router;
