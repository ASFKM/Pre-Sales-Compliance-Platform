import express, { Request, Response, NextFunction } from "express";
import { requireAuth } from "./auth";
import { getActiveTasksForUser, getTask, subscribeToUserTasks } from "../../src/backgroundTasks";

const router = express.Router();

// Snapshot of currently active tasks - used on initial page load/reconnect before the SSE
// stream below starts delivering further updates.
router.get("/tasks/active", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const tasks = await getActiveTasksForUser(userId);
    res.json({ success: true, tasks });
  } catch (err) {
    next(err);
  }
});

// Real-time task progress stream (Server-Sent Events). One connection per browser tab;
// forwards whatever this user's tasks publish via Redis, so it works the same regardless of
// which task (analysis, proposal generation, future orchestrator work) is running.
router.get("/tasks/stream", requireAuth, (req: Request, res: Response) => {
  const userId = req.headers["x-user-id"] as string;
  const tenantId = req.headers["x-tenant-id"] as string;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(":ok\n\n");

  const unsubscribe = subscribeToUserTasks(tenantId, userId, (task) => {
    res.write(`data: ${JSON.stringify(task)}\n\n`);
  });

  // Keep intermediaries (proxies/load balancers) from closing an idle connection.
  const heartbeat = setInterval(() => res.write(":heartbeat\n\n"), 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// Single-task lookup - used by callers that poll instead of watching the SSE stream (scripts,
// non-browser clients). Must stay registered after every literal /tasks/* route above - as a
// wildcard it would otherwise swallow requests meant for those (e.g. /tasks/stream matching
// here with id="stream").
router.get("/tasks/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }
    res.json({ success: true, task });
  } catch (err) {
    next(err);
  }
});

export default router;
