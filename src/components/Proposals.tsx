import { useEffect, useState } from "react";
import { TriangleAlert, Download, PenLine, ShieldAlert, Sparkles, X, Wrench, Handshake, CircleDollarSign, Eye, CheckCircle2, RotateCcw, type LucideIcon } from "lucide-react";
import * as mammoth from "mammoth";
import DOMPurify from "dompurify";
import { Proposal, SlaRiskFlag } from "../types";
import { useProposals } from "../hooks/useProposals";
import { BackgroundTask } from "../hooks/useBackgroundTasks";
import {
  ProposalEditableField,
  PROPOSAL_TYPE_EDITABLE_FIELDS,
  PROPOSAL_TYPE_LABEL,
  PROPOSAL_TYPE_BADGE,
  PROPOSAL_FIELD_LABEL,
} from "../lib/proposalEditableFields";

const OPINION_PERSPECTIVES = ["technical", "commercial", "legal", "financial"] as const;
type OpinionPerspective = (typeof OPINION_PERSPECTIVES)[number];
const OPINION_PERSPECTIVE_LABEL: Record<OpinionPerspective, { pt: string; en: string }> = {
  technical: { pt: "Técnico", en: "Technical" },
  commercial: { pt: "Comercial", en: "Commercial" },
  legal: { pt: "Jurídico", en: "Legal" },
  financial: { pt: "Financeiro", en: "Financial" },
};
// Identidade visual por perspectiva, separada da severidade (crítico/atenção) do conteúdo em si -
// as duas informações precisam ficar visíveis ao mesmo tempo num card, sem uma sobrescrever a
// outra (antes, só a severidade colorida o card inteiro e todo card tinha a mesma aparência entre
// si). Quem distingue a perspectiva é o ÍCONE (chave/aperto de mão/cifrão/escudo) mais o rótulo;
// o chip é uniforme em brand-* de propósito. As quatro cores anteriores (azul/verde/âmbar/roxo)
// competiam com a própria severidade do card: o chip âmbar de "Financeiro" era indistinguível do
// badge âmbar "atenção" ao lado dele. Repaletização da Fase 4 (identidade visual, 2026-08).
const OPINION_PERSPECTIVE_STYLE: Record<OpinionPerspective, { icon: LucideIcon; iconBg: string; iconColor: string }> = {
  technical: { icon: Wrench, iconBg: "bg-brand-100", iconColor: "text-brand-700" },
  commercial: { icon: Handshake, iconBg: "bg-brand-100", iconColor: "text-brand-700" },
  financial: { icon: CircleDollarSign, iconBg: "bg-brand-100", iconColor: "text-brand-700" },
  legal: { icon: ShieldAlert, iconBg: "bg-brand-100", iconColor: "text-brand-700" },
};
const OPINION_SEVERITY_BORDER: Record<"critical" | "warning" | "none", string> = {
  critical: "border-l-4 border-l-danger-500",
  warning: "border-l-4 border-l-warning-500",
  none: "border-l-4 border-l-transparent",
};
interface OpinionItem {
  perspective: OpinionPerspective;
  status: "completed" | "failed";
  severity?: "info" | "warning" | "critical" | null;
  summary: string;
  content: string;
  // PARTE B (parecer acionável): presente só quando a IA tinha UMA mudança concreta a sugerir a um
  // campo que este tipo de proposta realmente possui (ver server/routes/proposals.ts's
  // TEXT_SUGGESTIBLE_FIELDS) - nunca aplicado sozinho, só via o botão "Aplicar" abaixo.
  suggested_field?: Exclude<ProposalEditableField, "manual_pricing_table"> | null;
  suggested_value?: string | null;
}
interface OpinionRun {
  id: string;
  status: "pending" | "running" | "completed" | "partial" | "failed";
  opinions: OpinionItem[];
}

interface ProposalsProps {
  locale: "en" | "pt";
  hasPermission: (perm: string) => boolean;
  proposals: Proposal[];
  selectedProjectId: string;
  activeTasks: BackgroundTask[];
  waitForTask: (taskId: string) => Promise<BackgroundTask>;
  fetchGlobalConfigs: () => Promise<void> | void;
  fetchProjectDetails: (projectId: string) => Promise<void> | void;
  handleReleaseProposal: (propId: string) => void;
}

export default function Proposals({
  locale, hasPermission, proposals, selectedProjectId, activeTasks, waitForTask,
  fetchGlobalConfigs, fetchProjectDetails, handleReleaseProposal,
}: ProposalsProps) {
  const { handleUpdateProposalCommercial, handleUpdateProposalFields, handleSubmitProposalApproval, handleReopenProposal, handleClientDecision } = useProposals({
    locale, hasPermission, proposals, selectedProjectId, fetchGlobalConfigs, fetchProjectDetails,
  });
  const [exportingId, setExportingId] = useState<string | null>(null);
  // Item 18: qual proposta está com o formulário de recusa aberto, o motivo digitado e o erro que
  // o servidor devolveu. O motivo é obrigatório na recusa (a rota recusa sem ele), então ele
  // precisa de um campo de verdade — não de um `confirm()` que não coleta texto.
  const [recusandoId, setRecusandoId] = useState<string | null>(null);
  const [motivoRecusa, setMotivoRecusa] = useState("");
  const [erroDecisao, setErroDecisao] = useState<Record<string, string>>({});
  const [salvandoDecisao, setSalvandoDecisao] = useState<string | null>(null);

  async function registrarDecisao(propId: string, decision: "accepted" | "declined", note: string) {
    setSalvandoDecisao(propId);
    const erro = await handleClientDecision(propId, decision, note);
    setSalvandoDecisao(null);
    setErroDecisao((e) => ({ ...e, [propId]: erro ?? "" }));
    if (!erro) {
      setRecusandoId(null);
      setMotivoRecusa("");
    }
  }
  // Roadmap item (official): "Pareceres de IA Multi-Perspectiva em Propostas" - keyed by
  // proposal.id, undefined = not yet fetched, null = fetched but no run exists yet.
  const [opinionRuns, setOpinionRuns] = useState<Record<string, OpinionRun | null | undefined>>({});

  useEffect(() => {
    let cancelled = false;
    for (const prop of proposals) {
      if (opinionRuns[prop.id] !== undefined) continue;
      fetch(`/api/proposals/${prop.id}/opinion-panel`)
        .then((r) => r.json())
        .then((data) => {
          if (cancelled || !data.success) return;
          setOpinionRuns((prev) => ({ ...prev, [prop.id]: data.run }));
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposals]);

  const activeOpinionPanelTask = (proposalId: string) =>
    activeTasks.find((t) => t.type === "proposal_opinion_panel" && t.result_id === proposalId);

  const generateOpinionPanel = async (proposalId: string) => {
    try {
      const res = await fetch(`/api/proposals/${proposalId}/opinion-panel`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível gerar os pareceres de IA." : "Could not generate the AI opinion panel."));
        return;
      }
      const finished = await waitForTask(data.task_id);
      if (finished.status === "failed") {
        throw new Error(finished.error_message || (locale === "pt" ? "Falha ao gerar os pareceres de IA." : "Failed to generate the AI opinion panel."));
      }
      const res2 = await fetch(`/api/proposals/${proposalId}/opinion-panel`);
      const data2 = await res2.json().catch(() => ({}));
      if (data2.success) setOpinionRuns((prev) => ({ ...prev, [proposalId]: data2.run }));
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : String(err));
    }
  };
  // PARTE A (editor estruturado): substitui o antigo blob único `editable_content` por um formulário
  // com só os campos que o TIPO desta proposta realmente possui (PROPOSAL_TYPE_EDITABLE_FIELDS) -
  // salvar regenera o DOCX/PDF através do mesmo caminho de merge de template da geração inicial
  // (server/routes/proposals.ts), então o letterhead de um template real nunca é mais perdido.
  const [editingProposal, setEditingProposal] = useState<Proposal | null>(null);
  const [editedFields, setEditedFields] = useState<Partial<Record<Exclude<ProposalEditableField, "manual_pricing_table">, string>>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  const openEditor = (prop: Proposal) => {
    const allowed = PROPOSAL_TYPE_EDITABLE_FIELDS[prop.proposal_type];
    const initial: typeof editedFields = {};
    for (const field of allowed) {
      if (field === "manual_pricing_table") continue;
      initial[field] = (prop[field] as string | undefined) || "";
    }
    setEditingProposal(prop);
    setEditedFields(initial);
  };

  /*
   * PreSales F8 (PARTE B): "Reabrir e Editar" numa proposta REJEITADA.
   *
   * A proposta rejeitada some da fila de aprovação (a aba Aprovação só mostra ação em `submitted`),
   * mas continua listada AQUI, no Estúdio de Propostas - que lista todas as propostas do projeto,
   * em qualquer status. É por isso que o ponto de entrada é este card, e não uma tela nova.
   *
   * Reabrir cria a v2 no servidor e devolve o id dela; a lista é recarregada e o editor estruturado
   * que JÁ existe abre na versão nova (ela nasce `draft`, então o PUT funciona nela sem mudança).
   * O `useEffect` existe porque `proposals` só chega atualizado no render seguinte ao refetch - dá
   * para pedir o editor antes de a linha nova existir na lista.
   */
  const [pendingEditorProposalId, setPendingEditorProposalId] = useState<string | null>(null);
  const [reopeningId, setReopeningId] = useState<string | null>(null);

  const reopenProposal = async (propId: string) => {
    setReopeningId(propId);
    try {
      const newId = await handleReopenProposal(propId);
      if (newId) setPendingEditorProposalId(newId);
    } finally {
      setReopeningId(null);
    }
  };

  useEffect(() => {
    if (!pendingEditorProposalId) return;
    const target = proposals.find((p) => p.id === pendingEditorProposalId);
    if (!target) return;
    setPendingEditorProposalId(null);
    // Os 4 tipos de relatório (executive_summary/risk_report/bom_report/questions_report) não têm
    // NENHUM campo estruturado editável (PROPOSAL_TYPE_EDITABLE_FIELDS = []) - a v2 é criada do
    // mesmo jeito, por consistência de auditoria, mas abrir um editor vazio nela só confundiria.
    // Pendência registrada e ainda a confirmar com o dono do produto: o que exatamente se edita
    // numa segunda versão desses quatro tipos.
    if (PROPOSAL_TYPE_EDITABLE_FIELDS[target.proposal_type].length === 0) return;
    openEditor(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposals, pendingEditorProposalId]);

  const saveEditedFields = async () => {
    if (!editingProposal) return;
    setSavingEdit(true);
    try {
      const ok = await handleUpdateProposalFields(editingProposal.id, editedFields);
      if (ok) setEditingProposal(null);
    } finally {
      setSavingEdit(false);
    }
  };

  // PARTE B (parecer acionável): aplica UMA sugestão estruturada de um parecer de IA - o usuário
  // sempre confirma clicando aqui, a IA nunca grava na proposta sozinha (o parecer só devolve
  // suggested_field/suggested_value; ver server/routes/proposals.ts).
  const [applyingSuggestionKey, setApplyingSuggestionKey] = useState<string | null>(null);
  const applyOpinionSuggestion = async (propId: string, field: Exclude<ProposalEditableField, "manual_pricing_table">, value: string) => {
    const key = `${propId}-${field}`;
    setApplyingSuggestionKey(key);
    try {
      await handleUpdateProposalFields(propId, { [field]: value });
    } finally {
      setApplyingSuggestionKey(null);
    }
  };

  /*
   * F6 - revisão do documento gerado (frente c) e sugestões de conteúdo (frentes a/b).
   *
   * A revisão não usa IA e não custa nada: ela reabre o documento REAL e confere marcador não
   * substituído, soma de precificação e itens do BOM. Lista vazia significa "conferido e limpo",
   * e a tela diz isso com todas as letras - "não achei nada" e "não olhei" são estados diferentes
   * para quem está prestes a mandar a proposta ao cliente.
   */
  const [revisao, setRevisao] = useState<Record<string, { achados: Array<{ tipo: string; severidade: string; descricao: string }>; total: number } | null>>({});
  const [revisandoId, setRevisandoId] = useState<string | null>(null);
  const revisarDocumento = async (propId: string) => {
    setRevisandoId(propId);
    try {
      const res = await fetch(`/api/proposals/${propId}/revisao`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível revisar o documento." : "Could not review the document."));
        return;
      }
      setRevisao((atual) => ({ ...atual, [propId]: { achados: data.achados, total: data.total } }));
    } finally {
      setRevisandoId(null);
    }
  };

  /*
   * Sugestões de conteúdo: a IA redige, a pessoa aplica. Mesmo contrato do parecer acionável da
   * F7 - nada é gravado sem um clique, campo a campo.
   */
  const [sugestoes, setSugestoes] = useState<Record<string, Array<{ variavel: string; valor_sugerido: string; origem: string; justificativa: string }>>>({});
  const [sugerindoId, setSugerindoId] = useState<string | null>(null);
  const [aplicandoCampo, setAplicandoCampo] = useState<string | null>(null);

  const pedirSugestoes = async (propId: string) => {
    setSugerindoId(propId);
    try {
      const res = await fetch(`/api/proposals/${propId}/sugerir-conteudo`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível gerar sugestões." : "Could not generate suggestions."));
        return;
      }
      setSugestoes((atual) => ({ ...atual, [propId]: data.sugestoes }));
      if (data.sugestoes.length === 0 && data.message) alert(data.message);
    } finally {
      setSugerindoId(null);
    }
  };

  const aplicarSugestao = async (propId: string, variavel: string, valor: string) => {
    const chave = `${propId}-${variavel}`;
    setAplicandoCampo(chave);
    try {
      const res = await fetch(`/api/proposals/${propId}/campos-do-template`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campos: { [variavel]: valor } }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível aplicar o campo." : "Could not apply the field."));
        return;
      }
      // Aplicado: sai da lista de pendentes. O documento só muda quando a proposta for regerada.
      setSugestoes((atual) => ({
        ...atual,
        [propId]: (atual[propId] || []).filter((sg) => sg.variavel !== variavel),
      }));
    } finally {
      setAplicandoCampo(null);
    }
  };

  // PARTE A (preview do documento real): busca o DOCX/PDF já exportado (as mesmas rotas de
  // download, /export/docx e /export/pdf) e renderiza inline - DOCX via mammoth (já é dependência
  // do produto, usada no server para extração de upload; o mesmo pacote roda no browser),
  // PDF nativamente pelo próprio navegador via <iframe> numa blob URL. Nada de reimplementar
  // renderização de documento no client - é sempre o binário real, não uma reconstrução do texto.
  const [previewingProposalId, setPreviewingProposalId] = useState<string | null>(null);
  const [previewFormat, setPreviewFormat] = useState<"docx" | "pdf">("docx");
  const [previewDocxHtml, setPreviewDocxHtml] = useState<string | null>(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const openPreview = async (proposalId: string, format: "docx" | "pdf") => {
    setPreviewingProposalId(proposalId);
    setPreviewFormat(format);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/export/${format}`);
      if (!res.ok) {
        throw new Error(locale === "pt" ? "Não foi possível carregar o documento." : "Could not load the document.");
      }
      if (format === "docx") {
        const arrayBuffer = await res.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        // mammoth passes through whatever href/src the source .docx's XML declares (e.g. a
        // hyperlink relationship) - sanitize before ever injecting into the DOM, same as any other
        // HTML string built from data that isn't 100% attacker-proof (an uploaded proposal
        // template is admin-controlled, not attacker-controlled, but this is the actual document
        // that gets shown, so it gets the same treatment as untrusted HTML would).
        setPreviewDocxHtml(DOMPurify.sanitize(result.value));
      } else {
        const blob = await res.blob();
        setPreviewPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
      }
    } catch (err) {
      console.error(err);
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewingProposalId(null);
    setPreviewDocxHtml(null);
    setPreviewPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setPreviewError(null);
  };

  // Roadmap item (customer_request): "Alerta de Risco de SLA via Base de Conhecimento" - flags
  // proposed commercial/SLA/penalty terms against the approved Knowledge Base's own recorded
  // lessons learned, before the proposal is sent. undefined = never checked yet, [] = checked and
  // clean, non-empty = flagged risks to show.
  const [slaCheckResults, setSlaCheckResults] = useState<Record<string, SlaRiskFlag[]>>({});
  const [checkingSlaId, setCheckingSlaId] = useState<string | null>(null);
  const checkSlaRisk = async (propId: string) => {
    setCheckingSlaId(propId);
    try {
      const res = await fetch(`/api/proposals/${propId}/sla-risk-check`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível verificar riscos de SLA." : "Could not check SLA risks."));
        return;
      }
      setSlaCheckResults((prev) => ({ ...prev, [propId]: data.risks || [] }));
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao verificar riscos de SLA." : "Error checking SLA risks.");
    } finally {
      setCheckingSlaId(null);
    }
  };

  // Was a plain <a href target="_blank"> - a browser-navigated request never goes through the
  // app's global fetch() interceptor (App.tsx) that injects the Authorization header, so the API
  // rejected it with "Authorization token required" and the browser rendered/downloaded that raw
  // JSON error instead of the real file. fetch() here goes through that interceptor correctly.
  const handleExportProposal = async (proposalId: string, format: "docx" | "pdf") => {
    setExportingId(`${proposalId}-${format}`);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/export/${format}`);
      if (!res.ok) {
        alert(locale === "pt" ? "Não foi possível exportar a proposta." : "Could not export the proposal.");
        return;
      }
      const disposition = res.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const filename = filenameMatch?.[1] || `proposta-${proposalId}.${format}`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao exportar a proposta." : "Error exporting the proposal.");
    } finally {
      setExportingId(null);
    }
  };

  return (
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-light text-slate-900">{locale === "pt" ? "Espaço de Trabalho do Estúdio de Propostas" : "Proposal Studio Workspace"}</h2>
                <span className="text-xs text-slate-400">{locale === "pt" ? "Gerencie planilhas de precificação de lances, exclusões comerciais e fluxos de aprovação" : "Manage bid pricing spreadsheets, commercial exclusions and approval pipelines"}</span>
              </div>

              {proposals.length === 0 ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center py-16">
                  <TriangleAlert className="text-warning-500 mx-auto mb-2" size={32} />
                  <h4 className="text-sm font-bold text-slate-800 uppercase font-mono">{locale === "pt" ? "Nenhuma Proposta Compilada Ainda" : "No Proposals Compiled Yet"}</h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 leading-relaxed">
                    {locale === "pt" ? "Acesse a Área de Trabalho e escolha a aba 'Estúdio de Geração de Propostas' para compilar especificações técnicas ou planilhas de preços em rascunhos de documentos reais." : "Go to your Workspace tab and choose the 'Proposal Studio Generator' sub-tab to compile technical specifications or pricing tables into actual document drafts."}
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {proposals.map(prop => (
                    // PreSales F8: âncora por proposta - é ela que faz o link "ver versão anterior"
                    // de uma v2 levar até o card da v1 sem precisar de uma tela nova de histórico.
                    <div key={prop.id} id={`proposal-${prop.id}`} className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex flex-col gap-4 scroll-mt-6">

                      {/* Header block of proposal */}
                      <div className="flex justify-between items-start border-b border-slate-100 pb-3">
                        <div className="flex gap-3 items-center">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-[10px] bg-brand-50 text-brand-700">
                            {PROPOSAL_TYPE_BADGE[prop.proposal_type]}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              {/* PreSales F8: era "Draft v{version}.0" com `version` sempre 1 (campo
                                  morto no banco) e a palavra "Draft" mesmo numa proposta já liberada.
                                  Agora o número é a versão REAL da cadeia, e o estado quem diz é o
                                  selo ao lado. */}
                              <h3 className="text-sm font-bold text-slate-800 uppercase font-mono">{PROPOSAL_TYPE_LABEL[prop.proposal_type][locale]} - v{prop.version}</h3>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                                prop.status === "released" ? "text-brand-700 bg-brand-50 border-brand-200" :
                                prop.status === "approved" ? "text-success-700 bg-success-50 border-success-200" :
                                prop.status === "submitted" ? "text-warning-700 bg-warning-50 border-warning-200" :
                                prop.status === "rejected" ? "text-danger-700 bg-danger-50 border-danger-200" :
                                "text-slate-700 bg-slate-100 border-slate-200"
                              }`}>
                                {locale === "pt" ? (
                                  prop.status === "released" ? "LIBERADA" :
                                  prop.status === "approved" ? "APROVADA" :
                                  prop.status === "submitted" ? "ENVIADA" :
                                  prop.status === "rejected" ? "REJEITADA" : "RASCUNHO"
                                ) : prop.status}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5 font-mono">{locale === "pt" ? "Gerada por:" : "Generated by:"} {prop.generated_by} {locale === "pt" ? "em" : "on"} {new Date(prop.generated_at).toLocaleString()}</p>
                            {prop.previous_version_id && (
                              <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                                {locale === "pt" ? "Reaberta a partir da versão rejeitada" : "Reopened from the rejected version"}{" "}
                                <a
                                  href={`#proposal-${prop.previous_version_id}`}
                                  className="text-brand-700 hover:text-brand-800 underline underline-offset-2"
                                >
                                  v{prop.version - 1}
                                </a>
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Export Action Buttons */}
                        <div className="flex gap-2">
                          {prop.status === "draft" && hasPermission("proposal:edit") && (
                            <button
                              onClick={() => openEditor(prop)}
                              className="flex items-center gap-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-brand-200 transition-all shadow-sm cursor-pointer"
                            >
                              <PenLine size={12} /> {locale === "pt" ? "Revisar e Editar" : "Review & Edit"}
                            </button>
                          )}
                          {prop.status === "draft" && hasPermission("proposal:edit") && (
                            <button
                              onClick={() => checkSlaRisk(prop.id)}
                              disabled={checkingSlaId === prop.id}
                              className="flex items-center gap-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-brand-200 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                            >
                              <ShieldAlert size={12} className={checkingSlaId === prop.id ? "animate-pulse" : ""} />
                              {checkingSlaId === prop.id ? (locale === "pt" ? "Verificando..." : "Checking...") : (locale === "pt" ? "Verificar Riscos de SLA" : "Check SLA Risks")}
                            </button>
                          )}
                          {prop.status === "draft" && hasPermission("proposal:edit") && (() => {
                            const activeTask = activeOpinionPanelTask(prop.id);
                            const isRunning = !!activeTask;
                            return (
                              <button
                                onClick={() => generateOpinionPanel(prop.id)}
                                disabled={isRunning}
                                className="flex items-center gap-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-brand-200 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                                title={locale === "pt" ? "Gera 4 pareceres de IA (Técnico/Comercial/Jurídico/Financeiro) - puramente informativo, nunca bloqueia o fluxo de aprovação" : "Generates 4 AI opinions (Technical/Commercial/Legal/Financial) - purely informational, never blocks the approval flow"}
                              >
                                <Sparkles size={12} className={isRunning ? "animate-pulse" : ""} />
                                {isRunning
                                  ? `${locale === "pt" ? "Gerando" : "Generating"}${activeTask?.progress_pct != null ? ` ${activeTask.progress_pct}%` : "..."}`
                                  : (locale === "pt" ? "Gerar Pareceres de IA" : "Generate AI Opinions")}
                              </button>
                            );
                          })()}
                          {hasPermission("proposal:edit") && (
                            <button
                              onClick={() => revisarDocumento(prop.id)}
                              disabled={revisandoId === prop.id}
                              className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-slate-200 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                              title={locale === "pt" ? "Confere o documento gerado: marcador de variável não substituído, soma da precificação e itens do BOM. Sem IA, sem custo." : "Checks the generated document: unreplaced placeholders, pricing totals and BOM items. No AI, no cost."}
                            >
                              {revisandoId === prop.id
                                ? (locale === "pt" ? "Revisando..." : "Reviewing...")
                                : (locale === "pt" ? "Revisar Documento" : "Review Document")}
                            </button>
                          )}
                          {prop.status === "draft" && hasPermission("proposal:edit") && (
                            <button
                              onClick={() => pedirSugestoes(prop.id)}
                              disabled={sugerindoId === prop.id}
                              className="flex items-center gap-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-brand-200 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                              title={locale === "pt" ? "A IA redige, a partir da análise técnica, os campos de texto do template que sairiam em branco. Você revisa e aplica campo a campo." : "AI drafts the template's blank text fields from the technical analysis. You review and apply field by field."}
                            >
                              <Sparkles size={12} className={sugerindoId === prop.id ? "animate-pulse" : ""} />
                              {sugerindoId === prop.id
                                ? (locale === "pt" ? "Redigindo..." : "Drafting...")
                                : (locale === "pt" ? "Sugerir Conteúdo" : "Suggest Content")}
                            </button>
                          )}
                          {hasPermission("proposal:export") && (
                            <>
                              <button
                                onClick={() => openPreview(prop.id, "docx")}
                                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-slate-200 transition-all shadow-sm cursor-pointer"
                                title={locale === "pt" ? "Visualiza o documento real (o mesmo que seria exportado)" : "Previews the actual document (the same one that would be exported)"}
                              >
                                <Eye size={12} /> {locale === "pt" ? "Pré-visualizar" : "Preview"}
                              </button>
                              <button
                                onClick={() => handleExportProposal(prop.id, "docx")}
                                disabled={exportingId === `${prop.id}-docx`}
                                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-slate-200 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                              >
                                <Download size={12} /> {exportingId === `${prop.id}-docx` ? (locale === "pt" ? "Exportando..." : "Exporting...") : "Exportar DOCX"}
                              </button>
                              <button
                                onClick={() => handleExportProposal(prop.id, "pdf")}
                                disabled={exportingId === `${prop.id}-pdf`}
                                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-slate-200 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                              >
                                <Download size={12} /> {exportingId === `${prop.id}-pdf` ? (locale === "pt" ? "Exportando..." : "Exporting...") : "Exportar PDF"}
                              </button>
                            </>
                          )}
                          {prop.status === "draft" && hasPermission("approval:manage") && (
                            <button
                              onClick={() => handleSubmitProposalApproval(prop.id)}
                              className="bg-brand-600 hover:bg-brand-700 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all cursor-pointer"
                            >
                              {locale === "pt" ? "Enviar para Aprovação de Fluxo" : "Submit to Workflow Approvals"}
                            </button>
                          )}
                          {prop.status === "approved" && hasPermission("proposal:approve") && (
                            <button
                              onClick={() => handleReleaseProposal(prop.id)}
                              className="bg-brand-600 hover:bg-brand-700 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all cursor-pointer"
                            >
                              {locale === "pt" ? "Liberar Versão Final" : "Release Final Version"}
                            </button>
                          )}
                          {prop.status === "released" && (
                            <span className="bg-brand-50 text-brand-700 border border-brand-200 font-mono text-[11px] font-bold px-3 py-1.5 rounded">
                              {locale === "pt" ? "Versão Final Liberada" : "Final Version Released"}
                            </span>
                          )}
                          {/* Item 18 — a resposta do CLIENTE. Só aparece depois da liberação:
                              antes disso a proposta não saiu daqui, e uma "resposta" a um
                              documento que o cliente nunca viu seria dado inventado. Quem decide
                              ganho/perda é o CRM; isto cobre o cenário SEM integração. */}
                          {prop.status === "released" && prop.client_decision && (
                            <span
                              className={`font-mono text-[11px] font-bold px-3 py-1.5 rounded border ${
                                prop.client_decision === "accepted"
                                  ? "bg-success-50 text-success-700 border-success-200"
                                  : "bg-danger-50 text-danger-700 border-danger-200"
                              }`}
                              title={prop.client_decision_note ?? undefined}
                            >
                              {prop.client_decision === "accepted"
                                ? (locale === "pt" ? "Cliente aceitou" : "Client accepted")
                                : (locale === "pt" ? "Cliente recusou" : "Client declined")}
                            </span>
                          )}
                          {prop.status === "released" && !prop.client_decision && hasPermission("proposal:approve") && recusandoId !== prop.id && (
                            <>
                              <button
                                onClick={() => registrarDecisao(prop.id, "accepted", "")}
                                disabled={salvandoDecisao === prop.id}
                                title={locale === "pt"
                                  ? "Registra que o cliente aceitou esta proposta. O evento vai para a timeline do CRM. Quem marca a oportunidade como ganha continua sendo o CRM."
                                  : "Registers that the client accepted this proposal. The event goes to the CRM timeline. Marking the opportunity as won is still the CRM's job."}
                                className="bg-success-600 hover:bg-success-700 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                              >
                                {locale === "pt" ? "Cliente aceitou" : "Client accepted"}
                              </button>
                              <button
                                onClick={() => { setRecusandoId(prop.id); setMotivoRecusa(""); setErroDecisao((e) => ({ ...e, [prop.id]: "" })); }}
                                title={locale === "pt"
                                  ? "Registra que o cliente recusou esta proposta. O motivo é obrigatório."
                                  : "Registers that the client declined this proposal. A reason is required."}
                                className="bg-white hover:bg-danger-50 text-danger-700 border border-danger-300 font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all cursor-pointer"
                              >
                                {locale === "pt" ? "Cliente recusou" : "Client declined"}
                              </button>
                            </>
                          )}
                          {recusandoId === prop.id && (
                            /* O motivo é obrigatório na recusa — a rota devolve 400 sem ele. É a
                               mesma regra que o CMCRM já aplica para marcar uma oportunidade como
                               perdida, e a mesma lição da F8: "recusado" sem motivo é um dado que
                               não responde a nenhuma pergunta depois. */
                            <div className="flex flex-col gap-2 w-full mt-2">
                              <label htmlFor={`motivo-recusa-${prop.id}`} className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                                {locale === "pt" ? "Motivo da recusa (obrigatório)" : "Decline reason (required)"}
                              </label>
                              <textarea
                                id={`motivo-recusa-${prop.id}`}
                                value={motivoRecusa}
                                onChange={(e) => setMotivoRecusa(e.target.value)}
                                rows={2}
                                placeholder={locale === "pt" ? "O que o cliente disse?" : "What did the client say?"}
                                className="w-full max-w-lg border border-slate-300 rounded px-2 py-1.5 text-[12px] font-sans"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => registrarDecisao(prop.id, "declined", motivoRecusa)}
                                  disabled={motivoRecusa.trim().length === 0 || salvandoDecisao === prop.id}
                                  className="bg-danger-600 hover:bg-danger-700 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                                >
                                  {locale === "pt" ? "Registrar recusa" : "Register decline"}
                                </button>
                                <button
                                  onClick={() => { setRecusandoId(null); setMotivoRecusa(""); }}
                                  className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-mono text-[11px] font-bold px-3 py-1.5 rounded transition-all cursor-pointer"
                                >
                                  {locale === "pt" ? "Cancelar" : "Cancel"}
                                </button>
                              </div>
                            </div>
                          )}
                          {erroDecisao[prop.id] && (
                            <span className="font-mono text-[11px] text-danger-700">{erroDecisao[prop.id]}</span>
                          )}
                          {/* PreSales F8: único caminho de volta para uma proposta REJEITADA. Ela não
                              vira rascunho de novo - fica congelada como registro da recusa, e o
                              botão cria uma VERSÃO NOVA a partir dela. */}
                          {prop.status === "rejected" && hasPermission("proposal:generate") && (
                            <button
                              onClick={() => reopenProposal(prop.id)}
                              disabled={reopeningId === prop.id}
                              title={PROPOSAL_TYPE_EDITABLE_FIELDS[prop.proposal_type].length === 0
                                ? (locale === "pt"
                                  ? "Cria uma nova versão a partir desta proposta rejeitada. A versão rejeitada é preservada intacta. Atenção: este tipo de relatório não tem nenhum campo comercial editável hoje - a nova versão é regerada a partir da análise do projeto."
                                  : "Creates a new version from this rejected proposal. The rejected version is preserved intact. Note: this report type has no editable commercial field today - the new version is regenerated from the project analysis.")
                                : (locale === "pt"
                                  ? "Cria uma nova versão editável a partir desta proposta rejeitada. A versão rejeitada é preservada intacta, com os documentos e pareceres dela."
                                  : "Creates a new editable version from this rejected proposal. The rejected version is preserved intact, with its documents and opinions.")}
                              className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            >
                              <RotateCcw size={12} className={reopeningId === prop.id ? "animate-spin" : ""} />
                              {reopeningId === prop.id
                                ? (locale === "pt" ? "Reabrindo..." : "Reopening...")
                                : (locale === "pt" ? "Reabrir e Editar" : "Reopen & Edit")}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Pricing table block - only for types whose template actually uses pricing */}
                      {PROPOSAL_TYPE_EDITABLE_FIELDS[prop.proposal_type].includes("manual_pricing_table") && prop.manual_pricing_table && (
                        <div className="space-y-2">
                          <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono">{locale === "pt" ? "Grade de Planilha de Preço de Licitação" : "Commercial Bid Pricing Sheet Grid"}</h4>
                          <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/50">
                            <table className="w-full text-left text-xs border-collapse">
                              <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                                <tr>
                                  <th className="p-2.5">{locale === "pt" ? "Código do Item" : "Item Code"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Descrição" : "Description"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Quantidade" : "Quantity"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Preço Unitário" : "Unit List Price"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Desconto %" : "Discount %"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Preço Total USD" : "Total USD Price"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Status de Inclusão" : "Inclusion Status"}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 font-mono text-slate-700">
                                {prop.manual_pricing_table.map((row, i) => (
                                  <tr key={row.item_id || i} className="hover:bg-slate-50">
                                    <td className="p-2.5 font-bold">{row.product_or_service}</td>
                                    <td className="p-2.5 text-slate-500 font-sans text-xs">{row.specification || "-"}</td>
                                    <td className="p-2.5">
                                      <input
                                        type="number"
                                        value={row.quantity}
                                        onChange={(e) => handleUpdateProposalCommercial(prop.id, row.item_id, "quantity", parseInt(e.target.value) || 1)}
                                        disabled={prop.status !== "draft" || !hasPermission("proposal:edit")}
                                        className="w-14 p-1 rounded border border-slate-200 text-center font-semibold bg-white disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                                      />
                                    </td>
                                    <td className="p-2.5">
                                      <input
                                        type="number"
                                        value={row.unit_price}
                                        onChange={(e) => handleUpdateProposalCommercial(prop.id, row.item_id, "unit_price", parseFloat(e.target.value) || 0)}
                                        disabled={prop.status !== "draft" || !hasPermission("proposal:edit")}
                                        className="w-20 p-1 rounded border border-slate-200 text-center font-semibold bg-white disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                                      />
                                    </td>
                                    <td className="p-2.5">
                                      <input
                                        type="number"
                                        value={row.discount}
                                        onChange={(e) => handleUpdateProposalCommercial(prop.id, row.item_id, "discount", parseFloat(e.target.value) || 0)}
                                        disabled={prop.status !== "draft" || !hasPermission("proposal:edit")}
                                        className="w-14 p-1 rounded border border-slate-200 text-center font-semibold bg-white disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                                      />
                                    </td>
                                    <td className="p-2.5 font-bold text-slate-900">${row.total_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="p-2.5">
                                      <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] uppercase ${
                                        row.is_optional ? "text-warning-700 bg-warning-50 border border-warning-100" : "text-slate-700 bg-slate-100 border border-slate-200"
                                      }`}>
                                        {row.is_optional ? (locale === "pt" ? "Opcional" : "Optional") : (locale === "pt" ? "Obrigatório" : "Mandatory")}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                                {/* Totals block */}
                                <tr className="bg-slate-100 font-sans font-bold text-slate-800">
                                  <td colSpan={5} className="p-3 text-right uppercase tracking-wider font-mono text-[10px] text-slate-500">{locale === "pt" ? "Preço de Licitação Bruto Total:" : "Gross Contract Bid Price:"}</td>
                                  <td colSpan={2} className="p-3 text-sm text-brand-800 font-mono">
                                    ${(prop.manual_pricing_table || []).reduce((acc, r) => acc + r.total_price, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Text details for exclusions, validity etc - only the fields this type actually owns */}
                      {(() => {
                        const allowedTextFields = PROPOSAL_TYPE_EDITABLE_FIELDS[prop.proposal_type].filter(
                          (f): f is Exclude<ProposalEditableField, "manual_pricing_table"> => f !== "manual_pricing_table"
                        );
                        if (allowedTextFields.length === 0) return null;
                        return (
                          <div className="grid grid-cols-2 gap-6 text-xs text-slate-600 bg-slate-50/50 p-4 rounded-lg border border-slate-200">
                            {allowedTextFields.map((field) => (
                              <div key={field}>
                                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block">{PROPOSAL_FIELD_LABEL[field][locale]}</span>
                                <p className="text-xs text-slate-700 italic mt-0.5">"{prop[field] || "N/A"}"</p>
                              </div>
                            ))}
                          </div>
                        );
                      })()}

                      {slaCheckResults[prop.id] !== undefined && (
                        slaCheckResults[prop.id].length === 0 ? (
                          <div className="flex items-center gap-2 text-xs text-success-700 bg-success-50 border border-success-200 rounded-lg p-3">
                            <ShieldAlert size={14} />
                            {locale === "pt" ? "Nenhum risco histórico encontrado na Base de Conhecimento para os termos propostos." : "No historical risk found in the Knowledge Base for the proposed terms."}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <h4 className="text-xs uppercase font-bold text-warning-700 tracking-wider font-mono">{locale === "pt" ? "Riscos de SLA Sinalizados pela Base de Conhecimento" : "SLA Risks Flagged by the Knowledge Base"}</h4>
                            {slaCheckResults[prop.id].map((risk, i) => (
                              <div key={i} className={`text-xs rounded-lg p-3 border ${
                                risk.severity === "high" ? "bg-danger-50 border-danger-200 text-danger-800" :
                                risk.severity === "medium" ? "bg-warning-50 border-warning-200 text-warning-800" :
                                "bg-slate-50 border-slate-200 text-slate-700"
                              }`}>
                                <p className="font-bold uppercase text-[10px] tracking-wider mb-1">
                                  {risk.severity === "high" ? (locale === "pt" ? "Alto" : "High") : risk.severity === "medium" ? (locale === "pt" ? "Médio" : "Medium") : (locale === "pt" ? "Baixo" : "Low")}
                                </p>
                                <p className="italic mb-1">"{risk.term_excerpt}"</p>
                                <p className="mb-1">{risk.risk_description}</p>
                                <p className="text-[10px] opacity-75">{locale === "pt" ? "Lição relacionada:" : "Related lesson:"} {risk.related_lesson}</p>
                              </div>
                            ))}
                          </div>
                        )
                      )}

                      {revisao[prop.id] && (
                        <div className="mt-3 border-t border-slate-200 pt-3">
                          <p className="text-[10px] uppercase font-bold text-slate-400 font-mono mb-2">
                            {locale === "pt" ? "Revisão do documento" : "Document review"}
                          </p>
                          {revisao[prop.id]!.total === 0 ? (
                            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
                              {locale === "pt"
                                ? "Documento conferido: nenhum marcador de variável sobrou, a soma da precificação bate com o total e os itens do BOM estão no documento."
                                : "Document checked: no placeholder left behind, pricing adds up to the stated total, and BOM items are present."}
                            </p>
                          ) : (
                            <ul className="space-y-1.5">
                              {revisao[prop.id]!.achados.map((achado, i) => (
                                <li
                                  key={i}
                                  className={`text-xs rounded p-2 border ${achado.severidade === "alta" ? "bg-red-50 border-red-200 text-red-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}
                                >
                                  {achado.descricao}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                      {sugestoes[prop.id] && sugestoes[prop.id].length > 0 && (
                        <div className="mt-3 border-t border-slate-200 pt-3">
                          <p className="text-[10px] uppercase font-bold text-slate-400 font-mono mb-2">
                            {locale === "pt" ? "Sugestões de conteúdo (revise antes de aplicar)" : "Content suggestions (review before applying)"}
                          </p>
                          <ul className="space-y-2">
                            {sugestoes[prop.id].map((sg) => (
                              <li key={sg.variavel} className="text-xs bg-slate-50 border border-slate-200 rounded p-2">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="font-mono font-bold text-slate-600">
                                    {`{{${sg.variavel}}}`}
                                    <span className="ml-2 font-normal text-slate-400">
                                      {sg.origem === "variavel_livre"
                                        ? (locale === "pt" ? "campo livre do template" : "free template field")
                                        : (locale === "pt" ? "seção sem conteúdo na análise" : "section missing from analysis")}
                                    </span>
                                  </span>
                                  <button
                                    onClick={(e) => { e.preventDefault(); aplicarSugestao(prop.id, sg.variavel, sg.valor_sugerido); }}
                                    disabled={aplicandoCampo === `${prop.id}-${sg.variavel}`}
                                    className="bg-brand-600 hover:bg-brand-700 text-white font-mono text-[10px] font-bold px-2 py-1 rounded disabled:opacity-50 cursor-pointer shrink-0"
                                  >
                                    {aplicandoCampo === `${prop.id}-${sg.variavel}`
                                      ? (locale === "pt" ? "Aplicando..." : "Applying...")
                                      : (locale === "pt" ? "Aplicar" : "Apply")}
                                  </button>
                                </div>
                                <p className="text-slate-700 whitespace-pre-wrap">{sg.valor_sugerido}</p>
                                {sg.justificativa && (
                                  <p className="text-[11px] text-slate-400 mt-1">{sg.justificativa}</p>
                                )}
                              </li>
                            ))}
                          </ul>
                          <p className="text-[11px] text-slate-400 mt-2">
                            {locale === "pt"
                              ? "Aplicar grava o texto na proposta. O documento passa a mostrá-lo na próxima geração."
                              : "Applying stores the text on the proposal. The document shows it on the next generation."}
                          </p>
                        </div>
                      )}
                      {opinionRuns[prop.id] && (
                        <div className="space-y-2">
                          <h4 className="text-xs uppercase font-bold text-brand-700 tracking-wider font-mono flex items-center gap-1.5">
                            <Sparkles size={12} />
                            {locale === "pt" ? "Pareceres de IA Multi-Perspectiva" : "Multi-Perspective AI Opinions"}
                            {opinionRuns[prop.id]!.status === "partial" && (
                              <span className="text-[9px] font-bold text-warning-700 bg-warning-50 border border-warning-200 px-1.5 py-0.5 rounded-full normal-case tracking-normal">
                                {locale === "pt" ? "parcial" : "partial"}
                              </span>
                            )}
                          </h4>
                          <div className="grid grid-cols-2 gap-2">
                            {OPINION_PERSPECTIVES.map((perspective) => {
                              const item = opinionRuns[prop.id]!.opinions.find((o) => o.perspective === perspective);
                              const label = OPINION_PERSPECTIVE_LABEL[perspective][locale];
                              const { icon: PerspectiveIcon, iconBg, iconColor } = OPINION_PERSPECTIVE_STYLE[perspective];
                              if (!item || item.status === "failed") {
                                return (
                                  <div key={perspective} className="text-xs rounded-lg p-3 border bg-slate-50 border-slate-200 text-slate-400 italic flex items-start gap-2">
                                    <span className="shrink-0 rounded-full p-1.5 bg-slate-100 text-slate-400">
                                      <PerspectiveIcon size={14} />
                                    </span>
                                    <div>
                                      <p className="font-bold uppercase text-[10px] tracking-wider mb-1 not-italic text-slate-500">{label}</p>
                                      {locale === "pt" ? "Indisponível" : "Unavailable"}
                                    </div>
                                  </div>
                                );
                              }
                              const severityKey = item.severity === "critical" ? "critical" : item.severity === "warning" ? "warning" : "none";
                              const severityLabel = item.severity === "critical"
                                ? (locale === "pt" ? "crítico" : "critical")
                                : item.severity === "warning"
                                  ? (locale === "pt" ? "atenção" : "warning")
                                  : null;
                              return (
                                <details key={perspective} className={`text-xs rounded-lg p-3 border bg-white border-slate-200 text-slate-700 ${OPINION_SEVERITY_BORDER[severityKey]}`}>
                                  <summary className="cursor-pointer flex items-start gap-2">
                                    <span className={`shrink-0 rounded-full p-1.5 ${iconBg} ${iconColor}`}>
                                      <PerspectiveIcon size={14} />
                                    </span>
                                    <span className="flex-1">
                                      <span className="font-bold uppercase text-[10px] tracking-wider flex items-center gap-1.5">
                                        {label}
                                        {severityLabel && (
                                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full normal-case tracking-normal ${severityKey === "critical" ? "bg-danger-50 text-danger-700 border border-danger-200" : "bg-warning-50 text-warning-700 border border-warning-200"}`}>
                                            {severityLabel}
                                          </span>
                                        )}
                                      </span>
                                      <span className="block mt-0.5 font-normal normal-case tracking-normal">{item.summary}</span>
                                    </span>
                                  </summary>
                                  <p className="mt-2 whitespace-pre-wrap pl-8">{item.content}</p>
                                  {item.suggested_field && item.suggested_value && prop.status === "draft" && hasPermission("proposal:edit") && (
                                    <div className="mt-2 ml-8 p-2 rounded border border-brand-200 bg-brand-50/50">
                                      <p className="text-[10px] uppercase font-bold text-brand-700 tracking-wider font-mono mb-1">
                                        {locale === "pt" ? "Sugestão de alteração:" : "Suggested change:"} {PROPOSAL_FIELD_LABEL[item.suggested_field][locale]}
                                      </p>
                                      <p className="italic text-slate-600 mb-2">"{item.suggested_value}"</p>
                                      <button
                                        onClick={(e) => { e.preventDefault(); applyOpinionSuggestion(prop.id, item.suggested_field!, item.suggested_value!); }}
                                        disabled={applyingSuggestionKey === `${prop.id}-${item.suggested_field}`}
                                        className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white font-mono text-[10px] font-bold px-2.5 py-1 rounded transition-all disabled:opacity-50 cursor-pointer"
                                      >
                                        <CheckCircle2 size={11} />
                                        {applyingSuggestionKey === `${prop.id}-${item.suggested_field}`
                                          ? (locale === "pt" ? "Aplicando..." : "Applying...")
                                          : (locale === "pt" ? "Aplicar" : "Apply")}
                                      </button>
                                    </div>
                                  )}
                                </details>
                              );
                            })}
                          </div>
                        </div>
                      )}

                    </div>
                  ))}
                </div>
              )}

              {editingProposal && (() => {
                const allowed = PROPOSAL_TYPE_EDITABLE_FIELDS[editingProposal.proposal_type].filter(
                  (f): f is Exclude<ProposalEditableField, "manual_pricing_table"> => f !== "manual_pricing_table"
                );
                return (
                  <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
                      <div className="flex items-center justify-between p-4 border-b border-slate-100">
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">
                          {locale === "pt" ? "Revisar e Editar Proposta" : "Review & Edit Proposal"}
                        </h3>
                        <button onClick={() => setEditingProposal(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                          <X size={18} />
                        </button>
                      </div>
                      {allowed.length === 0 ? (
                        <p className="p-4 text-xs text-slate-500">
                          {locale === "pt"
                            ? `Documentos do tipo "${PROPOSAL_TYPE_LABEL[editingProposal.proposal_type].pt}" não têm campos comerciais editáveis - todo o conteúdo vem da análise de IA do projeto. Use "Pré-visualizar" para conferir o documento gerado.`
                            : `"${PROPOSAL_TYPE_LABEL[editingProposal.proposal_type].en}" documents have no editable commercial fields - all their content comes from the project's AI analysis. Use "Preview" to check the generated document.`}
                        </p>
                      ) : (
                        <>
                          <p className="text-xs text-slate-500 px-4 pt-3">
                            {locale === "pt"
                              ? "Edite os campos abaixo. Ao salvar, o DOCX e o PDF exportados são regenerados a partir do template real desta proposta."
                              : "Edit the fields below. Saving regenerates the exported DOCX and PDF from this proposal's real template."}
                          </p>
                          <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {allowed.map((field) => (
                              <div key={field}>
                                <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider font-mono block mb-1">
                                  {PROPOSAL_FIELD_LABEL[field][locale]}
                                </label>
                                {field === "proposal_validity" ? (
                                  <input
                                    type="text"
                                    value={editedFields[field] || ""}
                                    onChange={(e) => setEditedFields((prev) => ({ ...prev, [field]: e.target.value }))}
                                    className="w-full p-2 rounded border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                                  />
                                ) : (
                                  <textarea
                                    value={editedFields[field] || ""}
                                    onChange={(e) => setEditedFields((prev) => ({ ...prev, [field]: e.target.value }))}
                                    rows={3}
                                    className="w-full p-2 rounded border border-slate-200 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                      <div className="flex justify-end gap-2 p-4 border-t border-slate-100">
                        <button
                          onClick={() => setEditingProposal(null)}
                          className="px-4 py-2 text-xs font-bold uppercase text-slate-500 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                        >
                          {locale === "pt" ? "Cancelar" : "Cancel"}
                        </button>
                        {allowed.length > 0 && (
                          <button
                            onClick={saveEditedFields}
                            disabled={savingEdit}
                            className="px-4 py-2 text-xs font-bold uppercase bg-brand-600 hover:bg-brand-700 text-white rounded transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {savingEdit ? (locale === "pt" ? "Salvando..." : "Saving...") : (locale === "pt" ? "Salvar e Regenerar Documento" : "Save & Regenerate Document")}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {previewingProposalId && (
                <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                    <div className="flex items-center justify-between p-4 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">
                          {locale === "pt" ? "Pré-visualização do Documento" : "Document Preview"}
                        </h3>
                        <div className="flex rounded border border-slate-200 overflow-hidden ml-2">
                          {(["docx", "pdf"] as const).map((fmt) => (
                            <button
                              key={fmt}
                              onClick={() => openPreview(previewingProposalId, fmt)}
                              className={`px-2.5 py-1 text-[10px] font-bold uppercase font-mono cursor-pointer ${previewFormat === fmt ? "bg-brand-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
                            >
                              {fmt}
                            </button>
                          ))}
                        </div>
                      </div>
                      <button onClick={closePreview} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                        <X size={18} />
                      </button>
                    </div>
                    <div className="flex-1 min-h-[60vh] overflow-y-auto bg-slate-100">
                      {previewLoading && (
                        <div className="h-full flex items-center justify-center text-xs text-slate-400 font-mono">
                          {locale === "pt" ? "Carregando documento..." : "Loading document..."}
                        </div>
                      )}
                      {previewError && (
                        <div className="h-full flex items-center justify-center text-xs text-danger-600 font-mono p-4 text-center">{previewError}</div>
                      )}
                      {!previewLoading && !previewError && previewFormat === "docx" && previewDocxHtml && (
                        <div
                          className="bg-white max-w-3xl mx-auto my-6 p-10 shadow-sm text-sm leading-relaxed prose prose-sm"
                          dangerouslySetInnerHTML={{ __html: previewDocxHtml }}
                        />
                      )}
                      {!previewLoading && !previewError && previewFormat === "pdf" && previewPdfUrl && (
                        <iframe title="pdf-preview" src={previewPdfUrl} className="w-full h-full min-h-[70vh] border-0" />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
  );
}
