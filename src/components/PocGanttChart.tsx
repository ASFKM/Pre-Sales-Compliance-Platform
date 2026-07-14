import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, X, Sparkles, Pen } from "lucide-react";
import { Poc, PocTask, PocTaskStatus } from "../types";
import ApiClient from "../lib/api";

const DAY_W = 34;
const ROW_H = 40;
const MIN_TOTAL_DAYS = 14;

const STATUS_LABEL: Record<PocTaskStatus, string> = {
  planned: "Planejada",
  in_progress: "Em andamento",
  done: "Concluída",
};

function parseDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toIsoDay(date: Date): string {
  return date.toISOString().substring(0, 10);
}

function shortLabel(date: Date): { day: string; mon: string } {
  const s = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
  const [day, mon] = s.split(" ");
  return { day, mon };
}

function isWeekend(date: Date): boolean {
  const wd = date.getDay();
  return wd === 0 || wd === 6;
}

interface LiveOverride {
  startDay: number; // 0-indexed offset from anchor
  duration: number;
}

interface PocGanttChartProps {
  poc: Poc;
  canManage: boolean;
}

export default function PocGanttChart({ poc, canManage }: PocGanttChartProps) {
  const [tasks, setTasks] = useState<PocTask[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formStart, setFormStart] = useState(poc.start_date);
  const [formDuration, setFormDuration] = useState(1);
  const [formDependsOn, setFormDependsOn] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [knowledgeBaseWarning, setKnowledgeBaseWarning] = useState("");

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editDuration, setEditDuration] = useState(1);
  const [editDependsOn, setEditDependsOn] = useState("");
  const [editError, setEditError] = useState("");

  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<"move" | "resize" | null>(null);
  const [liveOverrides, setLiveOverrides] = useState<Record<string, LiveOverride>>({});
  const dragRef = useRef<{ taskId: string; mode: "move" | "resize"; startX: number; originStartDay: number; originDuration: number } | null>(null);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const data = await ApiClient.get<PocTask[]>(`/api/pocs/${poc.id}/tasks`);
      setTasks(Array.isArray(data) ? data : []);
    } catch (e) {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poc.id]);

  const generateSchedule = async () => {
    setGenerating(true);
    setGenerateError("");
    setKnowledgeBaseWarning("");
    try {
      const data = await ApiClient.post<{ tasks: PocTask[]; knowledge_base_warning: string | null }>(`/api/pocs/${poc.id}/tasks/generate`, {});
      setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
      if (data?.knowledge_base_warning) {
        setKnowledgeBaseWarning(data.knowledge_base_warning);
      }
    } catch (e: any) {
      setGenerateError(e.message || "Não foi possível gerar o cronograma sugerido.");
    } finally {
      setGenerating(false);
    }
  };

  const anchor = useMemo(() => {
    const dates = tasks.map((t) => parseDay(t.start_date));
    dates.push(parseDay(poc.start_date));
    return dates.reduce((min, d) => (d < min ? d : min), dates[0]);
  }, [tasks, poc.start_date]);

  const totalDays = useMemo(() => {
    const ends = tasks.map((t) => {
      const dayOffset = Math.round((parseDay(t.start_date).getTime() - anchor.getTime()) / 86400000);
      return dayOffset + t.duration_days;
    });
    ends.push(Math.round((parseDay(poc.end_date).getTime() - anchor.getTime()) / 86400000));
    const maxEnd = Math.max(MIN_TOTAL_DAYS, ...ends, 0);
    return maxEnd + 3;
  }, [tasks, anchor, poc.end_date]);

  const todayOffset = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((today.getTime() - anchor.getTime()) / 86400000);
  }, [anchor]);

  // Effective (start_day, duration) per task, applying the in-progress drag override so the
  // dragged bar, connectors, and critical path all recompute live instead of snapping only after
  // the API call resolves.
  const effective = useMemo(() => {
    const map: Record<string, { startDay: number; duration: number }> = {};
    for (const t of tasks) {
      const baseStartDay = Math.round((parseDay(t.start_date).getTime() - anchor.getTime()) / 86400000);
      const override = liveOverrides[t.id];
      map[t.id] = override ? { startDay: override.startDay, duration: override.duration } : { startDay: baseStartDay, duration: t.duration_days };
    }
    return map;
  }, [tasks, anchor, liveOverrides]);

  // Critical path: longest weighted (duration) chain through the single-predecessor DAG. Computed
  // as earliest-finish per task (DP over dependsOnTaskId), then walked back from whichever task
  // has the largest finish.
  const criticalTaskIds = useMemo(() => {
    const finish: Record<string, number> = {};
    const byId: Record<string, PocTask> = {};
    for (const t of tasks) byId[t.id] = t;

    const computeFinish = (t: PocTask, seen: Set<string>): number => {
      if (finish[t.id] !== undefined) return finish[t.id];
      if (seen.has(t.id)) return effective[t.id]?.duration ?? t.duration_days; // cycle guard
      seen.add(t.id);
      const dur = effective[t.id]?.duration ?? t.duration_days;
      const pred = t.depends_on_task_id ? byId[t.depends_on_task_id] : undefined;
      const base = pred ? computeFinish(pred, seen) : 0;
      finish[t.id] = base + dur;
      return finish[t.id];
    };

    for (const t of tasks) computeFinish(t, new Set());

    let critical = new Set<string>();
    let maxFinish = -1;
    let endTask: PocTask | null = null;
    for (const t of tasks) {
      if (finish[t.id] > maxFinish) {
        maxFinish = finish[t.id];
        endTask = t;
      }
    }
    let cursor = endTask;
    while (cursor) {
      critical.add(cursor.id);
      cursor = cursor.depends_on_task_id ? byId[cursor.depends_on_task_id] || null : null;
    }
    return critical;
  }, [tasks, effective]);

  const submitCreate = async () => {
    if (!formName.trim()) return;
    setSaving(true);
    setFormError("");
    try {
      await ApiClient.post(`/api/pocs/${poc.id}/tasks`, {
        name: formName.trim(),
        start_date: formStart,
        duration_days: formDuration,
        depends_on_task_id: formDependsOn || undefined,
      });
      setShowForm(false);
      setFormName("");
      setFormDuration(1);
      setFormDependsOn("");
      await fetchTasks();
    } catch (e: any) {
      setFormError(e.message || "Não foi possível criar a tarefa.");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (task: PocTask, status: PocTaskStatus) => {
    try {
      await ApiClient.put(`/api/pocs/${poc.id}/tasks/${task.id}`, { status });
      await fetchTasks();
    } catch (e: any) {
      alert(e.message || "Não foi possível atualizar o status.");
    }
  };

  const removeTask = async (task: PocTask) => {
    try {
      await ApiClient.delete(`/api/pocs/${poc.id}/tasks/${task.id}`);
      await fetchTasks();
    } catch (e: any) {
      alert(e.message || "Não foi possível remover a tarefa.");
    }
  };

  const startEditTask = (task: PocTask) => {
    setEditingTaskId(task.id);
    setEditName(task.name);
    setEditStart(task.start_date);
    setEditDuration(task.duration_days);
    setEditDependsOn(task.depends_on_task_id || "");
    setEditError("");
  };

  // Every task is fully editable after AI generation (or manual creation) - name, dates, order
  // (via start_date) and dependency, including clearing the dependency entirely so tasks can run
  // in parallel instead of a forced single chain (explicitly requested: a suggested schedule
  // shouldn't lock tasks into one sequential line if the real work can happen side by side).
  const saveEditTask = async () => {
    if (!editingTaskId || !editName.trim()) return;
    setSaving(true);
    setEditError("");
    try {
      await ApiClient.put(`/api/pocs/${poc.id}/tasks/${editingTaskId}`, {
        name: editName.trim(),
        start_date: editStart,
        duration_days: editDuration,
        depends_on_task_id: editDependsOn || null,
      });
      setEditingTaskId(null);
      await fetchTasks();
    } catch (e: any) {
      setEditError(e.message || "Não foi possível salvar as alterações.");
    } finally {
      setSaving(false);
    }
  };

  // ---- drag handling ----
  useEffect(() => {
    if (!dragTaskId || !dragMode) return;

    const handleMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;

      if (drag.mode === "move") {
        const dayDelta = Math.round(dx / DAY_W);
        const newStartDay = Math.max(0, drag.originStartDay + dayDelta);
        setLiveOverrides((prev) => ({ ...prev, [drag.taskId]: { startDay: newStartDay, duration: drag.originDuration } }));
      } else {
        const dayDelta = Math.round(dx / DAY_W);
        const newDuration = Math.max(1, drag.originDuration + dayDelta);
        setLiveOverrides((prev) => ({ ...prev, [drag.taskId]: { startDay: drag.originStartDay, duration: newDuration } }));
      }
    };

    const handleUp = async () => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragTaskId(null);
      setDragMode(null);
      if (!drag) return;

      const override = liveOverrides[drag.taskId];
      if (!override) return;

      try {
        await ApiClient.put(`/api/pocs/${poc.id}/tasks/${drag.taskId}`, {
          start_date: toIsoDay(addDays(anchor, override.startDay)),
          duration_days: override.duration,
        });
        await fetchTasks();
      } catch (e: any) {
        alert(e.message || "Não foi possível salvar o reagendamento.");
      } finally {
        setLiveOverrides((prev) => {
          const next = { ...prev };
          delete next[drag.taskId];
          return next;
        });
      }
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragTaskId, dragMode]);

  const startDrag = (task: PocTask, mode: "move" | "resize", e: React.MouseEvent) => {
    if (!canManage) return;
    e.preventDefault();
    const eff = effective[task.id];
    dragRef.current = { taskId: task.id, mode, startX: e.clientX, originStartDay: eff.startDay, originDuration: eff.duration };
    setDragTaskId(task.id);
    setDragMode(mode);
  };

  const barRect = (taskId: string) => {
    const eff = effective[taskId];
    return { x1: eff.startDay * DAY_W, x2: eff.startDay * DAY_W + eff.duration * DAY_W - 4 };
  };

  if (loading) {
    return <p className="text-xs text-slate-400">Carregando...</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-slate-400 inline-block" />Concluída</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-emerald-600 inline-block" />Caminho crítico</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-blue-400 inline-block" />Fora do caminho crítico</span>
          {canManage && <span className="text-slate-400 italic">arraste para mover · arraste a borda direita para redimensionar</span>}
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button
              onClick={generateSchedule}
              disabled={generating}
              className="inline-flex items-center gap-1.5 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 font-mono text-xs font-bold py-1.5 px-4 rounded transition-all cursor-pointer disabled:opacity-60"
            >
              <Sparkles size={13} />
              {generating ? "Gerando..." : "Sugerir cronograma com IA"}
            </button>
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer"
            >
              <Plus size={13} />
              Nova tarefa
            </button>
          </div>
        )}
      </div>

      {generateError && <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs">{generateError}</div>}
      {knowledgeBaseWarning && (
        <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs">
          <span className="font-bold">Base de Conhecimento insuficiente: </span>
          {knowledgeBaseWarning}
        </div>
      )}

      {showForm && (
        <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              className="p-2 rounded bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none text-xs sm:col-span-2"
              placeholder="Nome da tarefa"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
            <input
              type="date"
              className="p-2 rounded bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none text-xs"
              value={formStart}
              onChange={(e) => setFormStart(e.target.value)}
            />
            <input
              type="number"
              min={1}
              className="p-2 rounded bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none text-xs"
              placeholder="Duração (dias)"
              value={formDuration}
              onChange={(e) => setFormDuration(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <select
            className="p-2 rounded bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none text-xs w-full sm:w-auto"
            value={formDependsOn}
            onChange={(e) => setFormDependsOn(e.target.value)}
          >
            <option value="">Sem dependência</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>Depende de: {t.name}</option>
            ))}
          </select>
          {formError && <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs">{formError}</div>}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 font-mono text-xs cursor-pointer text-slate-500">
              Cancelar
            </button>
            <button
              onClick={submitCreate}
              disabled={saving || !formName.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer disabled:opacity-60"
            >
              {saving ? "Criando..." : "Criar tarefa"}
            </button>
          </div>
        </div>
      )}

      {tasks.length === 0 ? (
        <p className="text-xs text-slate-400 italic py-4">Nenhuma tarefa cadastrada ainda.</p>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <div className="flex">
              <div className="w-56 shrink-0 border-r border-slate-200 sticky left-0 bg-white z-10">
                <div className="h-9 border-b border-slate-200 bg-slate-50 flex items-center px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Tarefa
                </div>
                {tasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 px-3 border-b border-slate-100" style={{ height: ROW_H }}>
                    {criticalTaskIds.has(t.id) && <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" />}
                    <span className="text-xs font-medium text-slate-700 truncate flex-1" title={t.name}>{t.name}</span>
                    {canManage && (
                      <button onClick={() => removeTask(t)} className="text-slate-300 hover:text-red-500 shrink-0">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="relative" style={{ width: totalDays * DAY_W }}>
                <div className="h-9 border-b border-slate-200 bg-slate-50 flex">
                  {Array.from({ length: totalDays }).map((_, i) => {
                    const d = addDays(anchor, i);
                    const { day, mon } = shortLabel(d);
                    return (
                      <div
                        key={i}
                        className={`shrink-0 border-r border-slate-200 flex flex-col items-center justify-center text-[9px] font-mono text-slate-400 ${isWeekend(d) ? "bg-slate-100/70" : ""}`}
                        style={{ width: DAY_W }}
                      >
                        <b className="text-[10px] text-slate-500">{day}</b>
                        {mon}
                      </div>
                    );
                  })}
                </div>

                <div className="relative" style={{ height: tasks.length * ROW_H }}>
                  {Array.from({ length: totalDays }).map((_, i) => {
                    const d = addDays(anchor, i);
                    return (
                      <div
                        key={i}
                        className={`absolute top-0 bottom-0 border-r border-slate-100 ${isWeekend(d) ? "bg-slate-50" : ""}`}
                        style={{ left: i * DAY_W, width: DAY_W }}
                      />
                    );
                  })}
                  {tasks.map((_, idx) => (
                    <div key={idx} className="absolute left-0 right-0 border-b border-slate-100" style={{ top: idx * ROW_H, height: ROW_H }} />
                  ))}

                  {todayOffset >= 0 && todayOffset < totalDays && (
                    <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20" style={{ left: todayOffset * DAY_W + DAY_W / 2 }}>
                      <span className="absolute -top-[18px] -translate-x-1/2 bg-red-500 text-white text-[9px] font-bold font-mono rounded px-1.5 whitespace-nowrap">HOJE</span>
                    </div>
                  )}

                  <svg className="absolute inset-0 pointer-events-none z-10 overflow-visible">
                    {tasks
                      .filter((t) => t.depends_on_task_id)
                      .map((t) => {
                        const pred = tasks.find((p) => p.id === t.depends_on_task_id);
                        if (!pred) return null;
                        const predIdx = tasks.indexOf(pred);
                        const idx = tasks.indexOf(t);
                        const r1 = barRect(pred.id);
                        const r2 = barRect(t.id);
                        const y1 = predIdx * ROW_H + ROW_H / 2;
                        const y2 = idx * ROW_H + ROW_H / 2;
                        const midX = r1.x2 + 10;
                        return (
                          <path
                            key={t.id}
                            d={`M${r1.x2},${y1} H${midX} V${y2} H${r2.x1 - 6}`}
                            fill="none"
                            stroke="#94a3b8"
                            strokeWidth={1.5}
                            markerEnd="url(#poc-gantt-arrow)"
                          />
                        );
                      })}
                    <defs>
                      <marker id="poc-gantt-arrow" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
                        <path d="M0,0 L6,3 L0,6 z" fill="#94a3b8" />
                      </marker>
                    </defs>
                  </svg>

                  {tasks.map((t, idx) => {
                    const rect = barRect(t.id);
                    const isCritical = criticalTaskIds.has(t.id);
                    const color =
                      t.status === "done" ? "bg-slate-400" : isCritical ? "bg-emerald-600" : "bg-blue-400";
                    const eff = effective[t.id];
                    return (
                      <div
                        key={t.id}
                        onMouseDown={(e) => startDrag(t, "move", e)}
                        className={`absolute rounded-md ${color} text-white text-[11px] font-semibold flex items-center px-2 overflow-hidden select-none ${canManage ? "cursor-grab active:cursor-grabbing" : ""}`}
                        style={{ top: idx * ROW_H + 7, left: rect.x1, width: rect.x2 - rect.x1, height: 26 }}
                        title={`${t.name} · ${STATUS_LABEL[t.status]}`}
                      >
                        <span className="truncate flex-1 pointer-events-none">{t.name}</span>
                        {canManage && (
                          <div
                            onMouseDown={(e) => { e.stopPropagation(); startDrag(t, "resize", e); }}
                            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize"
                          />
                        )}
                        {dragTaskId === t.id && (
                          <span className="absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap">
                            {toIsoDay(addDays(anchor, eff.startDay))} → {toIsoDay(addDays(anchor, eff.startDay + eff.duration - 1))}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {canManage && (
            <div className="border-t border-slate-200 divide-y divide-slate-100">
              {tasks.map((t) =>
                editingTaskId === t.id ? (
                  <div key={t.id} className="p-3 bg-slate-50 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <input
                        className="sm:col-span-2 p-1.5 text-xs rounded bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                        placeholder="Nome da tarefa"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                      <input
                        type="date"
                        className="p-1.5 text-xs rounded bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                        value={editStart}
                        onChange={(e) => setEditStart(e.target.value)}
                      />
                      <input
                        type="number"
                        min={1}
                        className="p-1.5 text-xs rounded bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                        placeholder="Duração (dias)"
                        value={editDuration}
                        onChange={(e) => setEditDuration(parseInt(e.target.value, 10) || 1)}
                      />
                    </div>
                    <select
                      className="w-full p-1.5 text-xs rounded bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                      value={editDependsOn}
                      onChange={(e) => setEditDependsOn(e.target.value)}
                    >
                      <option value="">Nenhuma (executa em paralelo)</option>
                      {tasks.filter((other) => other.id !== t.id).map((other) => (
                        <option key={other.id} value={other.id}>Depende de: {other.name}</option>
                      ))}
                    </select>
                    {editError && <p className="text-[11px] text-red-600">{editError}</p>}
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEditingTaskId(null)} className="px-2.5 py-1 border border-slate-300 rounded hover:bg-slate-100 font-mono text-[11px] cursor-pointer text-slate-500">
                        Cancelar
                      </button>
                      <button
                        onClick={saveEditTask}
                        disabled={saving || !editName.trim()}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-[11px] font-bold py-1 px-3 rounded shadow transition-all cursor-pointer disabled:opacity-60"
                      >
                        Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={t.id} className="flex items-center justify-between px-3 py-1.5 gap-2">
                    <span className="text-[11px] text-slate-500 truncate flex-1">{t.name}</span>
                    <select
                      className="text-[11px] border border-slate-200 rounded-md px-1.5 py-1"
                      value={t.status}
                      onChange={(e) => updateStatus(t, e.target.value as PocTaskStatus)}
                    >
                      {(["planned", "in_progress", "done"] as PocTaskStatus[]).map((s) => (
                        <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                      ))}
                    </select>
                    <button onClick={() => startEditTask(t)} className="text-slate-400 hover:text-slate-700" title="Editar tarefa">
                      <Pen size={13} />
                    </button>
                    <button onClick={() => removeTask(t)} className="text-slate-300 hover:text-red-500" title="Remover tarefa">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
