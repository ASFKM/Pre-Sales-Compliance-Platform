import express, { Request, Response, NextFunction } from "express";
import { dbStore } from "../../src/dbStore";
import { requirePermission } from "./auth";

const router = express.Router();

router.get("/", requirePermission("admin:roles"), (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(dbStore.getData().roles);
  } catch (err) {
    next(err);
  }
});

export default router;
