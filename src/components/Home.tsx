import { useEffect, useState } from "react";
import { Activity, CheckCircle2, ChevronRight, FileText, ListTodo, Plus, Trash2 } from "lucide-react";
import { Project } from "../types";

interface HomeProps {
  locale: "en" | "pt";
  tx: (en: string, pt: string) => string;
  projects: Project[];
  setSelectedProjectId: (id: string) => void;
  setActiveTab: (tab: "home" | "workspace" | "proposals" | "templates" | "approval" | "admin") => void;
  setShowNewProjectModal: (show: boolean) => void;
}

export default function Home({
  locale, tx, projects, setSelectedProjectId, setActiveTab, setShowNewProjectModal,
}: HomeProps) {
  const [tasks, setTasks] = useState<{ id: string; text: string; done: boolean; dueDate?: string }[]>(() => {
    const saved = localStorage.getItem("user_tasks");
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      { id: "1", text: "Revisar inconformidades críticas do Edital 82", done: false, dueDate: "2026-07-05" },
      { id: "2", text: "Ajustar margem de lucro e precificação na planilha BOM", done: false, dueDate: "2026-07-08" },
      { id: "3", text: "Subir diagramas elétricos no explorador de arquivos", done: false, dueDate: "2026-07-06" },
      { id: "4", text: "Gerar minuta final da proposta comercial para diretoria", done: true, dueDate: "2026-06-30" }
    ];
  });
  const [newTaskText, setNewTaskText] = useState("");

  useEffect(() => {
    localStorage.setItem("user_tasks", JSON.stringify(tasks));
  }, [tasks]);

  const handleViewProjectWorkspace = (projId: string) => {
    setSelectedProjectId(projId);
    setActiveTab("workspace");
  };

  return (
            <div className="flex-1 p-6 overflow-y-auto space-y-6 bg-slate-50/50">

              {/* Operational Tasks Section */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                      <ListTodo size={20} />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide font-mono">
                        {locale === "pt" ? "Tarefas Pendentes do Usuário" : "User's Pending Tasks"}
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {locale === "pt"
                          ? `Foco operacional: ${tasks.filter(t => !t.done).length} pendências para resolução imediata`
                          : `Operational focus: ${tasks.filter(t => !t.done).length} pending actions requiring immediate attention`}
                      </p>
                    </div>
                  </div>
                  {/* Progress Indicators */}
                  <div className="flex items-center gap-3 self-end sm:self-auto">
                    <span className="text-xs font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                      {Math.round((tasks.filter(t => t.done).length / (tasks.length || 1)) * 100)}% {locale === "pt" ? "Concluído" : "Completed"}
                    </span>
                    <div className="w-24 bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-emerald-600 h-full transition-all duration-300 rounded-full"
                        style={{ width: `${(tasks.filter(t => t.done).length / (tasks.length || 1)) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                </div>

                {/* Add task form inline */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newTaskText.trim()) return;
                    const newTask = {
                      id: Date.now().toString(),
                      text: newTaskText.trim(),
                      done: false,
                      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
                    };
                    setTasks([...tasks, newTask]);
                    setNewTaskText("");
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={newTaskText}
                    onChange={(e) => setNewTaskText(e.target.value)}
                    placeholder={locale === "pt" ? "Nova tarefa... Ex: Revisar conformidades do Anexo B" : "New task... Ex: Review compliance on Appendix B"}
                    className="flex-1 text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-50/50 hover:bg-slate-50 transition-colors"
                  />
                  <button
                    type="submit"
                    className="bg-slate-950 hover:bg-slate-800 text-white font-bold text-xs px-4 py-2 rounded-lg transition-all cursor-pointer shadow-xs font-mono"
                  >
                    + {locale === "pt" ? "ADICIONAR" : "ADD TASK"}
                  </button>
                </form>

                {/* Grid layout of actual tasks */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[190px] overflow-y-auto pr-1">
                  {tasks.length === 0 ? (
                    <div className="col-span-2 text-center py-8 text-xs text-slate-400 italic font-mono">
                      {locale === "pt" ? "Nenhuma tarefa pendente! Excelente trabalho." : "No pending tasks found! Awesome job."}
                    </div>
                  ) : (
                    tasks.map(task => (
                      <div
                        key={task.id}
                        className={`p-3 rounded-xl border flex items-start justify-between gap-3 transition-all group ${
                          task.done
                            ? "bg-slate-50/50 border-slate-100 opacity-60"
                            : "bg-white border-slate-200 hover:border-slate-300 shadow-xs"
                        }`}
                      >
                        <div className="flex gap-3 items-start flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={task.done}
                            onChange={() => {
                              setTasks(tasks.map(t => t.id === task.id ? { ...t, done: !t.done } : t));
                            }}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer shrink-0"
                          />
                          <div className="leading-tight flex-1 min-w-0">
                            <p className={`text-xs font-semibold text-slate-700 truncate ${task.done ? "line-through text-slate-400 font-normal" : ""}`} title={task.text}>
                              {task.text}
                            </p>
                            {task.dueDate && (
                              <span className="text-[9px] font-mono text-slate-400 bg-slate-100 px-1 rounded mt-1.5 inline-block font-bold">
                                📅 {locale === "pt" ? "PRAZO: " : "DUE: "}{task.dueDate}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setTasks(tasks.filter(t => t.id !== task.id));
                          }}
                          className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 cursor-pointer shrink-0"
                          title={locale === "pt" ? "Excluir tarefa" : "Delete task"}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* KPI Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                {/* Card 1: Total Bids */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                    <FileText size={22} />
                  </div>
                  <div className="leading-tight">
                    <span className="text-[10px] uppercase font-bold text-slate-400 font-mono tracking-wider block">
                      {locale === "pt" ? "Propostas Ativas" : "Active Bids"}
                    </span>
                    <span className="text-2xl font-bold text-slate-800 font-mono block mt-0.5">
                      {projects.length}
                    </span>
                  </div>
                </div>

                {/* Card 2: Average Compliance */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                    <CheckCircle2 size={22} />
                  </div>
                  <div className="leading-tight">
                    <span className="text-[10px] uppercase font-bold text-slate-400 font-mono tracking-wider block">
                      {locale === "pt" ? "Conformidade Média" : "Avg Compliance"}
                    </span>
                    <span className="text-2xl font-bold text-slate-800 font-mono block mt-0.5">
                      94.2%
                    </span>
                  </div>
                </div>

                {/* Card 3: Next Deadline */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 shrink-0">
                    <Activity size={22} />
                  </div>
                  <div className="leading-tight">
                    <span className="text-[10px] uppercase font-bold text-slate-400 font-mono tracking-wider block">
                      {locale === "pt" ? "Próximo Prazo" : "Next Deadline"}
                    </span>
                    <span className="text-xs font-bold text-slate-700 font-mono block mt-1.5">
                      {projects.length > 0
                        ? projects.reduce((min, p) => p.deadline < min ? p.deadline : min, projects[0].deadline)
                        : "2026-08-30"}
                    </span>
                  </div>
                </div>

              </div>

              {/* Graphical Analysis Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Industry Verticals Breakdown */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                    {locale === "pt" ? "Licitações por Setor / Vertical" : "Bids by Industry Vertical"}
                  </h3>

                  <div className="space-y-3.5 pt-1">
                    {projects.length === 0 ? (
                      <p className="text-xs text-slate-400 italic text-center py-6">{locale === "pt" ? "Nenhuma licitação registrada" : "No bids registered"}</p>
                    ) : (
                      Object.entries(
                        projects.reduce((acc, p) => {
                          acc[p.vertical] = (acc[p.vertical] || 0) + 1;
                          return acc;
                        }, {} as Record<string, number>)
                      ).map(([vertical, count]) => {
                        const pct = Math.round(((count as number) / projects.length) * 100);
                        return (
                          <div key={vertical} className="space-y-1">
                            <div className="flex justify-between text-xs font-semibold text-slate-700">
                              <span>{vertical}</span>
                              <span className="font-mono text-slate-500">{count} {count === 1 ? "bid" : "bids"} ({pct}%)</span>
                            </div>
                            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                              <div
                                className="bg-emerald-600 h-full rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              ></div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Status and Pipeline Summary */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                    {locale === "pt" ? "Pipeline de Status" : "Pipeline Status Distribution"}
                  </h3>

                  <div className="space-y-3.5 pt-1">
                    {projects.length === 0 ? (
                      <p className="text-xs text-slate-400 italic text-center py-6">{locale === "pt" ? "Nenhum status disponível" : "No status available"}</p>
                    ) : (
                      Object.entries(
                        projects.reduce((acc, p) => {
                          const status = p.status || "draft";
                          acc[status] = (acc[status] || 0) + 1;
                          return acc;
                        }, {} as Record<string, number>)
                      ).map(([status, count]) => {
                        const pct = Math.round(((count as number) / projects.length) * 100);
                        const statusLabels: Record<string, string> = {
                          completed: locale === "pt" ? "Concluído" : "Completed",
                          analysis_in_progress: locale === "pt" ? "Análise em Andamento" : "Analysis In Progress",
                          waiting_internal: locale === "pt" ? "Aguardando Interno" : "Waiting Internal",
                          draft: locale === "pt" ? "Rascunho" : "Draft"
                        };
                        const statusColors: Record<string, string> = {
                          completed: "bg-emerald-500",
                          analysis_in_progress: "bg-blue-500",
                          waiting_internal: "bg-purple-500",
                          draft: "bg-amber-500"
                        };
                        return (
                          <div key={status} className="space-y-1">
                            <div className="flex justify-between text-xs font-semibold text-slate-700">
                              <span className="capitalize">{statusLabels[status] || status}</span>
                              <span className="font-mono text-slate-500">{count} ({pct}%)</span>
                            </div>
                            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                              <div
                                className={`${statusColors[status] || "bg-slate-500"} h-full rounded-full transition-all duration-500`}
                                style={{ width: `${pct}%` }}
                              ></div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

              </div>

              {/* Active Tender / Bids Datagrid List */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800">
                    {locale === "pt" ? "Lista de Propostas e Editais Ativos" : "Active Bids & Tenders Directory"}
                  </h3>
                  <button
                    onClick={() => setShowNewProjectModal(true)}
                    className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition-all shadow-sm cursor-pointer"
                  >
                    <Plus size={14} /> {locale === "pt" ? "Adicionar Nova" : "Add New"}
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-400 font-mono uppercase bg-slate-50/50">
                        <th className="p-3.5 font-bold">{locale === "pt" ? "Projeto / Cliente" : "Project / Client"}</th>
                        <th className="p-3.5 font-bold">{locale === "pt" ? "Setor" : "Vertical"}</th>
                        <th className="p-3.5 font-bold">{locale === "pt" ? "Prazo Final" : "Submission Deadline"}</th>
                        <th className="p-3.5 font-bold">{tx("Status", "Status")}</th>
                        <th className="p-3.5 font-bold text-right">{locale === "pt" ? "Ações" : "Actions"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {projects.map(proj => {
                        return (
                          <tr key={proj.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="p-3.5">
                              <p className="font-bold text-slate-800 text-sm leading-tight">{proj.name}</p>
                              <p className="text-xs text-slate-500 leading-tight mt-0.5">{proj.customer_name} • <span className="font-mono bg-slate-100 text-slate-600 px-1 rounded text-[10px]">{proj.opportunity_name}</span></p>
                            </td>
                            <td className="p-3.5 font-medium text-slate-600">
                              <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded-full text-[10px] uppercase font-mono">{proj.vertical}</span>
                            </td>
                            <td className="p-3.5 text-slate-500 font-mono font-semibold">{proj.deadline}</td>
                            <td className="p-3.5">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                                proj.status === "completed" ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
                                proj.status === "analysis_in_progress" ? "text-blue-700 bg-blue-50 border-blue-200" :
                                proj.status === "waiting_internal" ? "text-purple-700 bg-purple-50 border-purple-200" :
                                "text-amber-700 bg-amber-50 border-amber-200"
                              }`}>
                                {locale === "pt" ?
                                  (proj.status === "completed" ? "CONCLUÍDO" :
                                   proj.status === "analysis_in_progress" ? "EM ANÁLISE" :
                                   proj.status === "waiting_internal" ? "AGUARDANDO INTERNO" : "RASCUNHO") :
                                  (proj.status || "draft").toUpperCase().replace("_", " ")
                                }
                              </span>
                            </td>
                            <td className="p-3.5 text-right">
                              <button
                                onClick={() => handleViewProjectWorkspace(proj.id)}
                                className="bg-slate-800 hover:bg-emerald-600 text-white hover:text-white px-3 py-1.5 rounded-lg font-semibold transition-all shadow-sm cursor-pointer inline-flex items-center gap-1 text-[11px]"
                              >
                                {locale === "pt" ? "Ir para Área de Trabalho" : "Open Workspace"} <ChevronRight size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
  );
}
