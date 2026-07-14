import { useCallback, useEffect, useRef, useState } from "react";

export interface BackgroundTask {
  id: string;
  tenant_id: string;
  user_id: string;
  type: "document_analysis" | "proposal_generation" | "project_intake_analysis" | "knowledge_base_analysis" | "poc_test_generation" | "poc_schedule_generation";
  status: "queued" | "running" | "completed" | "failed";
  current_step: string;
  progress_pct: number | null;
  error_message: string | null;
  warning_message: string | null;
  result_type: string | null;
  result_id: string | null;
  created_at: string;
  updated_at: string;
}

// Single shared connection for the whole app (call once in App.tsx, pass down what's needed) -
// an EventSource per component would open one SSE connection per subscriber, which is wasteful
// and would each separately re-fetch the initial snapshot.
//
// isAuthenticated must be passed in explicitly (rather than reading localStorage once on mount)
// because App.tsx never unmounts across login - a token that shows up after the initial mount
// (the normal login flow, no page reload) would otherwise be missed forever.
export function useBackgroundTasks(isAuthenticated: boolean) {
  const [tasks, setTasks] = useState<Record<string, BackgroundTask>>({});
  const listenersRef = useRef<Record<string, (task: BackgroundTask) => void>>({});

  useEffect(() => {
    if (!isAuthenticated) return;
    const token = localStorage.getItem("ca_session_token");
    if (!token) return;

    let cancelled = false;

    fetch("/api/tasks/active", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data.success) return;
        const map: Record<string, BackgroundTask> = {};
        for (const t of data.tasks) map[t.id] = t;
        setTasks((prev) => ({ ...map, ...prev }));
      })
      .catch(() => {});

    const es = new EventSource(`/api/tasks/stream?token=${encodeURIComponent(token)}`);
    es.onmessage = (ev) => {
      try {
        const task: BackgroundTask = JSON.parse(ev.data);
        setTasks((prev) => ({ ...prev, [task.id]: task }));
        listenersRef.current[task.id]?.(task);
      } catch (err) {
        console.error("Failed to parse task update", err);
      }
    };

    return () => {
      cancelled = true;
      es.close();
    };
  }, [isAuthenticated]);

  const activeTasks = Object.values(tasks)
    .filter((t) => t.status === "queued" || t.status === "running")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Lets a trigger handler (e.g. "run analysis") await the specific task it just started
  // reaching a terminal state, without polling - resolves off the same SSE stream everything
  // else uses.
  const waitForTask = useCallback((taskId: string): Promise<BackgroundTask> => {
    return new Promise((resolve) => {
      const existing = tasks[taskId];
      if (existing && (existing.status === "completed" || existing.status === "failed")) {
        resolve(existing);
        return;
      }
      listenersRef.current[taskId] = (task) => {
        if (task.status === "completed" || task.status === "failed") {
          delete listenersRef.current[taskId];
          resolve(task);
        }
      };
    });
  }, [tasks]);

  return { activeTasks, waitForTask };
}
