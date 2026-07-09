import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requireAuth } from "./auth";

const router = express.Router();

// Real backend for the Home dashboard's "Tarefas Pendentes" widget, replacing what used to be
// pure localStorage (never synced across devices, invisible to every other user). Always scoped
// to the requesting user - this is a personal to-do list, not a shared project task tracker, so
// nobody sees or edits anyone else's items regardless of role.
//
// Mounted at /user-tasks (not /tasks) - server/routes/tasks.ts already owns /tasks/active,
// /tasks/stream and /tasks/:id for a completely different concept (AI background job progress).

const UserTaskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional().default(""),
  due_date: z.string().optional(),
  status: z.enum(["open", "in_progress", "waiting_customer", "waiting_internal", "completed", "canceled"]).optional().default("open"),
  priority: z.enum(["high", "medium", "low"]).optional().default("medium"),
  project_id: z.string().optional(),
});

const UpdateUserTaskSchema = UserTaskSchema.partial();

function defaultDueDate(): string {
  return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

router.get("/user-tasks", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const tasks = await dbStore.getTasks();
    res.json(tasks.filter((t) => t.owner_user_id === userId));
  } catch (err) {
    next(err);
  }
});

router.post("/user-tasks", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = UserTaskSchema.parse(req.body);
    const userId = req.headers["x-user-id"] as string;

    const task = await dbStore.createTask({
      project_id: validated.project_id,
      title: validated.title,
      description: validated.description,
      owner_user_id: userId,
      due_date: validated.due_date || defaultDueDate(),
      status: validated.status,
      priority: validated.priority,
      created_by: userId,
    });

    res.status(201).json(task);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.put("/user-tasks/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const existing = (await dbStore.getTasks()).find((t) => t.id === req.params.id);

    if (!existing) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }
    if (existing.owner_user_id !== userId) {
      return res.status(403).json({ success: false, message: "You can only edit your own tasks." });
    }

    const validated = UpdateUserTaskSchema.parse(req.body);
    const updated = await dbStore.updateTask(req.params.id, validated);
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.delete("/user-tasks/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const existing = (await dbStore.getTasks()).find((t) => t.id === req.params.id);

    if (!existing) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }
    if (existing.owner_user_id !== userId) {
      return res.status(403).json({ success: false, message: "You can only delete your own tasks." });
    }

    await dbStore.deleteTask(req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
