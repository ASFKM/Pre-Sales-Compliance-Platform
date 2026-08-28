import React, { useEffect, useState } from "react";
import { Activity, CircleCheck, FileText, Beaker } from "lucide-react";
import { Project, Poc } from "../types";
import HomeDemandCards from "./HomeDemandCards";
import { DemandPerformanceChart, VerticalPieChart } from "./HomePerformanceChart";

// CDC 16 — Fase 10. A Início vira painel.
//
// Três cortes e três chegadas, todos decididos pelo dono na F8 e medidos antes
// de executar:
//
// SAIU o card "Tarefas Pendentes do Usuário" (resposta C), e saiu INTEIRO — o
// card, a rota `/api/user-tasks` e a tabela `tasks`. O pedido original dizia
// que ele "não estava ligado a nada", e a medição da F8 mostrou o contrário:
// tinha rota, tabela e havia substituído um `localStorage`. O dono decidiu
// removê-lo sabendo disso, e o que tornou a decisão barata foi o outro número,
// medido no Demo em 28/08/2026: zero tarefas gravadas, zero donos, zero ligadas
// a projeto. Remover pela metade — o card sem a rota — deixaria uma porta viva
// sem tela, que é a armadilha que esta casa já pagou como "corrigir tirando,
// sem repor" com o sinal trocado.
//
// SAIU a lista de "Propostas e Editais Ativos": ela REPETIA a aba Projetos,
// linha por linha e coluna por coluna. Um painel que repete a tela seguinte não
// informa, só ocupa a dobra.
//
// SAIU o gráfico de barras por setor, e no lugar dele entrou a PIZZA (item 04
// do feedback). `recharts` já estava no produto.
//
// CHEGARAM os dois cards da fila de pré-vendas (resposta E), substituindo a
// ponte provisória que a F9 deixou marcada como tal; e o gráfico de desempenho,
// que é onde o pré-vendas vê o dele — a rota já sabia recortar desde a F9.

interface HomeProps {
  locale: "en" | "pt";
  projects: Project[];
  // `setActiveTab` sobreviveu ao corte da lista de editais porque os dois cards
  // ainda levam à fila completa; `tx`, `setSelectedProjectId` e
  // `setShowNewProjectModal` saíram com a lista que os usava.
  setActiveTab: (tab: "home" | "workspace" | "projectsList" | "proposals" | "approval" | "knowledgeBase" | "admin" | "demandQueue") => void;
  // CDC 16 F10: a régua de exibição dos dois cards é a MESMA que a aba tinha
  // até a F9 e que a ponte herdou, D06 inclusive — revogar o par CONGELA o que
  // já chegou em vez de apagá-lo da tela. Quem a monta é App.tsx.
  demandQueueVisible?: boolean;
  hasPermission?: (permission: string) => boolean;
  currentUserId?: string;
  onDemandAssumed?: (projectId: string) => void;
  onQueueChanged?: () => void;
  // Fase N (add-on): Home has no other reason to know about the POC module - this single flag
  // gates both the fetch below and the KPI card, mirroring how every other POC-gated UI element
  // in the app is conditioned on hasModule("poc") + the read/manage permission.
  pocModuleEnabled?: boolean;
}

export default function Home({
  locale, projects, setActiveTab, pocModuleEnabled,
  demandQueueVisible, hasPermission, currentUserId, onDemandAssumed, onQueueChanged,
}: HomeProps) {
  const [compliancePct, setCompliancePct] = useState<number | null>(null);
  const [pocs, setPocs] = useState<Poc[]>([]);

  useEffect(() => {
    fetch("/api/dashboard/compliance-summary")
      .then((res) => res.json())
      .then((data) => setCompliancePct(data.has_data ? data.compliance_pct : null))
      .catch(() => setCompliancePct(null));

    if (pocModuleEnabled) {
      fetch("/api/pocs")
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => setPocs(Array.isArray(data) ? data : []))
        .catch(() => setPocs([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pocModuleEnabled]);

  return (
            <div className="flex-1 p-6 overflow-y-auto space-y-6 bg-slate-50/50">

              {/* Os dois cards ficam ACIMA dos KPIs de propósito: o trabalho que
                  espera alguém é a única coisa desta tela que tem prazo, e a
                  fila é o motivo pelo qual o pré-vendas abre o produto. */}
              {demandQueueVisible && hasPermission && currentUserId && (
                <HomeDemandCards
                  hasPermission={hasPermission}
                  currentUserId={currentUserId}
                  onDemandAssumed={onDemandAssumed ?? (() => {})}
                  onQueueChanged={onQueueChanged}
                  onAbrirFila={() => setActiveTab("demandQueue")}
                />
              )}

              {/* KPI Cards Grid */}
              <div className={`grid grid-cols-1 md:grid-cols-3 ${pocModuleEnabled ? "lg:grid-cols-4" : ""} gap-4`}>

                {/* Card 1: Total Bids */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 shrink-0">
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
                  <div className="w-12 h-12 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 shrink-0">
                    <CircleCheck size={22} />
                  </div>
                  <div className="leading-tight">
                    <span className="text-[10px] uppercase font-bold text-slate-400 font-mono tracking-wider block">
                      {locale === "pt" ? "Conformidade Média" : "Avg Compliance"}
                    </span>
                    <span className="text-2xl font-bold text-slate-800 font-mono block mt-0.5">
                      {compliancePct !== null ? `${compliancePct}%` : (locale === "pt" ? "Sem dados" : "No data")}
                    </span>
                  </div>
                </div>

                {/* Card 3: Next Deadline */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 shrink-0">
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

                {/* Card 4: POCs (add-on, only when the module is enabled) */}
                {pocModuleEnabled && (() => {
                  const activeStatuses = new Set(["not_started", "planned", "in_progress", "blocked"]);
                  const activePocs = pocs.filter((p) => activeStatuses.has(p.status)).length;
                  const won = pocs.filter((p) => p.acceptance_decision === "won").length;
                  const lost = pocs.filter((p) => p.acceptance_decision === "lost").length;
                  return (
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 shrink-0">
                        <Beaker size={22} />
                      </div>
                      <div className="leading-tight">
                        <span className="text-[10px] uppercase font-bold text-slate-400 font-mono tracking-wider block">
                          {locale === "pt" ? "POCs Ativas" : "Active POCs"}
                        </span>
                        <span className="text-2xl font-bold text-slate-800 font-mono block mt-0.5">
                          {activePocs}
                        </span>
                        {(won > 0 || lost > 0) && (
                          <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                            {won} {locale === "pt" ? "ganha(s)" : "won"} · {lost} {locale === "pt" ? "perdida(s)" : "lost"}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

              </div>

              {/* Graphical Analysis Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* A pizza, no lugar das barras por setor (item 04 do feedback). */}
                <VerticalPieChart projects={projects} locale={locale} />

                {/* Status and Pipeline Summary */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-brand-500"></span>
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
                          completed: "bg-success-700",
                          analysis_in_progress: "bg-brand-700",
                          waiting_internal: "bg-warning-700",
                          draft: "bg-slate-500"
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

              {/* O desempenho da fila. Só para quem alcança a fila: sem
                  `demand:read` a rota responde 403, e desenhar um bloco de erro
                  para quem nunca vai usá-lo é ruído, não informação. */}
              {demandQueueVisible && currentUserId && <DemandPerformanceChart currentUserId={currentUserId} />}

            </div>
  );
}
