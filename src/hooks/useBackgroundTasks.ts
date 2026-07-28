import { useCallback, useEffect, useRef, useState } from "react";

export interface BackgroundTask {
  id: string;
  tenant_id: string;
  user_id: string;
  type: "document_analysis" | "proposal_generation" | "project_intake_analysis" | "knowledge_base_analysis" | "poc_test_generation" | "poc_schedule_generation" | "section_reanalysis" | "proposal_opinion_panel" | "system_update" | "pricing_catalog_extraction";
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

    // Reconciles local state against the server's authoritative snapshot of what's actually
    // still active. Spreading `map` AFTER `prev` (not before) matters: a task's terminal SSE
    // message (failed/completed) can be missed - a backgrounded tab, a brief network blip, the
    // EventSource silently reconnecting - and /api/tasks/active never re-lists a terminal task,
    // so the old `{...map, ...prev}` order let a stale "running" entry sit in `prev` forever,
    // never overwritten by fresher (correctly absent) data. This way, `map` always wins for any
    // task id it actually knows about; call this again on every SSE reconnect (see es.onopen
    // below), not just on mount, so a connection drop mid-session self-heals instead of only a
    // full page reload clearing it (confirmed against a real stuck-at-68% job in production).
    const syncActiveSnapshot = () => {
      fetch("/api/tasks/active", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((data) => {
          if (cancelled || !data.success) return;
          const map: Record<string, BackgroundTask> = {};
          for (const t of data.tasks) map[t.id] = t;
          setTasks((prev) => ({ ...prev, ...map }));
        })
        .catch(() => {});
    };
    syncActiveSnapshot();

    // AUD-006 (auditoria de segurança, 2026-07-19): EventSource não pode setar cabeçalhos, então
    // não dá pra mandar o token de sessão completo (válido por horas) via Authorization - antes
    // ia direto na query string da URL, risco real de aparecer em log de acesso/histórico do
    // navegador. Busca um ticket de curta duração primeiro (requisição normal, token no header) e
    // usa só ele na URL do EventSource.
    let es: EventSource | undefined;
    fetch("/api/auth/sse-ticket", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data.success) return;
        es = new EventSource(`/api/tasks/stream?ticket=${encodeURIComponent(data.ticket)}`);
        wireEventSource(es);
      })
      .catch(() => {});

    function wireEventSource(es: EventSource) {
    es.onopen = () => {
      syncActiveSnapshot();
      // A task's terminal message (completed/failed) can be missed during the exact disconnect
      // window (confirmed in production: a job finished right as the server restarted, and the
      // user had to hit F5 to see the result) - the raw SSE onmessage push below is the ONLY
      // thing that resolves waitForTask's promise via listenersRef, and syncActiveSnapshot alone
      // can't recover a missed completion because /api/tasks/active deliberately never re-lists
      // a terminal task (see its own comment above) - there is nothing in that response to
      // resolve the promise with. Re-fetch the specific current state of any task someone is
      // still actively awaiting, so a reconnect (not just a full page reload) resolves it.
      for (const taskId of Object.keys(listenersRef.current)) {
        fetch(`/api/tasks/${taskId}`, { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => r.json())
          .then((data) => {
            if (cancelled || !data.success) return;
            const task: BackgroundTask = data.task;
            setTasks((prev) => ({ ...prev, [task.id]: task }));
            if (task.status === "completed" || task.status === "failed") {
              listenersRef.current[task.id]?.(task);
            }
          })
          .catch(() => {});
      }
    };
    es.onmessage = (ev) => {
      try {
        const task: BackgroundTask = JSON.parse(ev.data);
        setTasks((prev) => ({ ...prev, [task.id]: task }));
        listenersRef.current[task.id]?.(task);
      } catch (err) {
        console.error("Failed to parse task update", err);
      }
    };
    }

    return () => {
      cancelled = true;
      es?.close();
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

  // Mapa cru (não filtrado por status, ao contrário de activeTasks) - "Enviar Arquivos" no módulo
  // de Precificação precisa acompanhar o progresso INTERMEDIÁRIO (current_step/progress_pct) de
  // tarefas específicas que ela mesma criou, exibindo por arquivo dentro do próprio popup -
  // waitForTask só resolve no estado terminal, não dá pra desenhar uma barra de progresso com ele
  // sozinho.
  return { activeTasks, waitForTask, tasks };
}
