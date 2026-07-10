import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import { dbStore } from "../../src/dbStore";
import { requireAuth } from "./auth";

const router = express.Router();

// Real average compliance across every analysed project - replaces the Home dashboard's
// hardcoded "94.2%". Definition: compliant / (compliant + partially_compliant + non_compliant),
// deliberately excluding not_enough_information from both sides - a requirement nobody has
// reviewed yet isn't a compliance failure, so counting it in the denominator would understate a
// tenant's real compliance rate. has_data lets the UI show a clear empty state instead of a
// misleading 0% when nothing has been analysed yet.
router.get("/dashboard/compliance-summary", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allRequirements = await dbStore.getAllCriticalRequirements();

    let compliant = 0;
    let evaluated = 0;

    for (const requirements of allRequirements) {
      for (const req of requirements) {
        const status = req?.compliance_status;
        if (status === "not_enough_information" || !status) continue;
        evaluated += 1;
        if (status === "compliant") compliant += 1;
      }
    }

    res.json({
      success: true,
      has_data: evaluated > 0,
      compliance_pct: evaluated > 0 ? Math.round((compliant / evaluated) * 1000) / 10 : null,
      evaluated_requirements: evaluated,
      compliant_requirements: compliant,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
