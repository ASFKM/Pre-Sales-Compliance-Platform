import { Dispatch, ReactNode, SetStateAction, useEffect, useRef, useState } from "react";
import {
  TriangleAlert, ArrowLeft, DollarSign, PenLine, FileCode, FilePlus,
  FolderOpen, FolderPlus, HardDrive, MessageSquare, Plus, RefreshCw, Trash2, X,
  PanelRightClose, PanelRightOpen,
} from "lucide-react";
import { AnalysisResult, BOMItem, Document } from "../types";
import { useWorkspace } from "../hooks/useWorkspace";
import { BackgroundTask } from "../hooks/useBackgroundTasks";
import { PROPOSAL_TYPES, PROPOSAL_TYPE_LABELS, ProposalTypeValue } from "../../server/utils/proposalTypes";

type SubTab = "summary" | "requirements" | "risks" | "bom" | "proposal_builder" | "explorer";

// Card copy/icon for each of the 7 proposal types in the Studio generator grid - purely
// presentational metadata, the actual type list/labels come from server/utils/proposalTypes.ts.
const PROPOSAL_TYPE_GENERATOR_META: Record<ProposalTypeValue, { icon: typeof FileCode; titleEn: string; titlePt: string; descriptionEn: string; descriptionPt: string }> = {
  technical: {
    icon: FileCode,
    titleEn: "Technical Proposal Document", titlePt: "Documento de Proposta Técnica",
    descriptionEn: "Compiles detailed executive summaries, full specs compliance tables, proposed engineering schedule phases, and points traceability matrices into a unified engineering bid.",
    descriptionPt: "Reúne resumos executivos detalhados, tabelas de conformidade técnica, fases de cronograma de engenharia e matrizes de rastreabilidade num único documento técnico.",
  },
  commercial: {
    icon: DollarSign,
    titleEn: "Commercial Proposal Document", titlePt: "Documento de Proposta Comercial",
    descriptionEn: "Designs beautifully structured commercial pricing tables, custom discount allocations, delivery timetables, assumptions and legal liability exclusion paragraphs.",
    descriptionPt: "Monta tabelas de precificação comercial, descontos, prazos de entrega, premissas e cláusulas de exclusão de responsabilidade.",
  },
  technical_commercial: {
    icon: FilePlus,
    titleEn: "Technical-Commercial Proposal Document", titlePt: "Documento de Proposta Técnico-Comercial",
    descriptionEn: "Fuses the technical and commercial content into a single document - full specs, schedule and compliance alongside pricing and commercial terms.",
    descriptionPt: "Funde o conteúdo técnico e comercial num único documento - especificações, cronograma e conformidade junto com preços e termos comerciais.",
  },
  executive_summary: {
    icon: PenLine,
    titleEn: "Executive Summary Document", titlePt: "Documento de Resumo Executivo",
    descriptionEn: "A concise, leadership-facing summary of the project overview, context, main requirements, risks, opportunities and recommended strategy.",
    descriptionPt: "Um resumo conciso, voltado à liderança, com visão geral do projeto, contexto, principais requisitos, riscos, oportunidades e estratégia recomendada.",
  },
  risk_report: {
    icon: TriangleAlert,
    titleEn: "Risk Report Document", titlePt: "Documento de Relatório de Riscos",
    descriptionEn: "A dedicated report listing every identified risk with severity, probability, impact, mitigation and the area responsible for each.",
    descriptionPt: "Um relatório dedicado listando cada risco identificado com severidade, probabilidade, impacto, mitigação e área responsável.",
  },
  bom_report: {
    icon: HardDrive,
    titleEn: "BOM Report Document", titlePt: "Documento de Relatório de BOM",
    descriptionEn: "A standalone bill-of-materials report with every item, manufacturer, quantity and specification from the analysis.",
    descriptionPt: "Um relatório autônomo de lista de materiais com todos os itens, fabricantes, quantidades e especificações da análise.",
  },
  questions_report: {
    icon: MessageSquare,
    titleEn: "Clarification Questions Document", titlePt: "Documento de Perguntas de Esclarecimento",
    descriptionEn: "A document listing every clarification question the analysis recommends sending to the customer, with reason and priority.",
    descriptionPt: "Um documento listando cada pergunta de esclarecimento recomendada pela análise para enviar ao cliente, com motivo e prioridade.",
  },
};

// Lightweight markdown rendering for chat replies - just **bold** and "- " bullet lines, the two
// things AI answers actually use here. No markdown library pulled in for this; the copilot never
// needed headings/tables/links, just enough that the user doesn't see literal "**" asterisks.
function renderChatMarkdown(text: string): ReactNode {
  const boldSplit = (line: string, keyPrefix: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**")
        ? <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
        : <span key={`${keyPrefix}-${i}`}>{part}</span>
    );

  return text.split("\n").map((line, i) => {
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)/);
    if (bulletMatch) {
      return <div key={i} className="pl-3 relative before:content-['•'] before:absolute before:left-0">{boldSplit(bulletMatch[1], `l${i}`)}</div>;
    }
    return <div key={i}>{boldSplit(line, `l${i}`) }{line === "" ? " " : null}</div>;
  });
}

interface WorkspaceProps {
  locale: "en" | "pt";
  tx: (en: string, pt: string) => string;
  t: (key: string) => string;
  hasPermission: (perm: string) => boolean;
  activeTasks: BackgroundTask[];
  selectedProjectId: string;
  projectName: string;
  documents: Document[];
  setDocuments: Dispatch<SetStateAction<Document[]>>;
  analysisResult: AnalysisResult | null;
  setAnalysisResult: Dispatch<SetStateAction<AnalysisResult | null>>;
  displayAnalysisResult: AnalysisResult | null;
  analysisError: string;
  docsCount: number;
  reqsCount: number;
  risksCount: number;
  oppsCount: number;
  proposalTemplates: any[];
  fetchGlobalConfigs: () => Promise<void> | void;
  fetchProjectDetails: (projectId: string) => Promise<void> | void;
  setActiveTab: (tab: "home" | "workspace" | "projectsList" | "proposals" | "approval" | "knowledgeBase" | "admin") => void;
  // CDC 16 F9: "demands" entrou na lista. A união é escrita à mão nos dois
  // lados, e o compilador só reclama porque ela é repetida - lista duplicada
  // que diverge é padrão já pago nesta casa.
  setActiveAdminSection: Dispatch<SetStateAction<"overview" | "users" | "ai" | "templates" | "approval_flow" | "demands" | "subscription" | "system_updates" | "integrations" | "storage" | "audit">>;
  canAccessAdminSection: (section: string) => boolean;
  handleDeleteDocument: (id: string) => void;
  getDocTag: (filename: string) => { label: string; style: string };
  selectedTemplateIdByType: Record<string, string>;
  setSelectedTemplateIdByType: Dispatch<SetStateAction<Record<string, string>>>;
  chatHistory: { role: string; message: string }[];
  setChatHistory: Dispatch<SetStateAction<{ role: string; message: string }[]>>;
  waitForTask: (taskId: string) => Promise<BackgroundTask>;
  currentUserName: string;
}

export default function Workspace({
  locale, tx, t, hasPermission, activeTasks, selectedProjectId, projectName,
  documents, setDocuments, analysisResult, setAnalysisResult, displayAnalysisResult,
  analysisError, docsCount, reqsCount, risksCount, oppsCount,
  proposalTemplates, fetchGlobalConfigs, fetchProjectDetails,
  setActiveTab, setActiveAdminSection, canAccessAdminSection, handleDeleteDocument, getDocTag,
  selectedTemplateIdByType, setSelectedTemplateIdByType,
  chatHistory, setChatHistory, waitForTask, currentUserName,
}: WorkspaceProps) {
  const [subTab, setSubTab] = useState<SubTab>("summary");
  // Right column (clarification questions) can retract to free width for the tabbed project
  // content - same collapsible-sidebar pattern as the left bid-management panel in App.tsx,
  // persisted the same way.
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState<boolean>(() => localStorage.getItem("ca_right_panel_collapsed") === "1");
  useEffect(() => {
    localStorage.setItem("ca_right_panel_collapsed", rightPanelCollapsed ? "1" : "0");
  }, [rightPanelCollapsed]);
  const [exportingQuestions, setExportingQuestions] = useState(false);
  const [showCopilotChat, setShowCopilotChat] = useState(false);
  const [editingNotesReqId, setEditingNotesReqId] = useState<string | null>(null);
  const [editingNotesDraft, setEditingNotesDraft] = useState("");
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);
  const partNumberFocusValues = useRef<Record<string, string>>({});

  // Reactive Knowledge Base capture: a human correction becomes a pending suggestion for future
  // analyses to draw on. Fire-and-forget - the edit itself already saved via its own handler, this
  // is best-effort enrichment on top and must never block or surface errors on the edit UI.
  const sendKnowledgeBaseSuggestion = (params: {
    category: "bom_part_number" | "engineering_note" | "compliance_status";
    field_label: string;
    old_value: string;
    new_value: string;
    item_context: string;
  }) => {
    if (!hasPermission("knowledge_base:write") || params.old_value.trim() === params.new_value.trim()) return;
    fetch("/api/knowledge-base/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...params, project_id: selectedProjectId, project_name: projectName }),
    }).catch(() => {});
  };

  // Was a plain <a href download> pointing at the API route - browser-navigated downloads never
  // go through the app's global `fetch` interceptor (App.tsx) that injects the Authorization
  // header, so the request hit the API unauthenticated, got a JSON error response back, and the
  // `download` attribute saved *that* as the file - the exact "downloads a JSON file" the user
  // reported. Using fetch() directly here goes through that same interceptor correctly.
  const handleExportClarificationQuestions = async () => {
    setExportingQuestions(true);
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/clarification-questions/export`);
      if (!res.ok) {
        alert("Não foi possível exportar as perguntas de esclarecimento.");
        return;
      }
      const disposition = res.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const filename = filenameMatch?.[1] || "perguntas-esclarecimento.docx";
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
      alert("Erro ao exportar as perguntas de esclarecimento.");
    } finally {
      setExportingQuestions(false);
    }
  };

  // Single save path for every BOM mutation (add/edit-field/delete item) - previously each of the
  // 3 call sites duplicated this exact fetch with no res.ok check at all, so a failed save (e.g.
  // permission error, network blip) silently refetched the unchanged project and looked like
  // nothing happened, with no indication to the user that their edit was lost.
  const saveBOM = async (updatedBOM: BOMItem[]) => {
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/analysis-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bom: updatedBOM })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.message || (locale === "pt" ? "Não foi possível salvar a alteração na lista de materiais." : "Could not save the bill of materials change."));
        return;
      }
      await fetchProjectDetails(selectedProjectId);
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao salvar a lista de materiais." : "Error saving the bill of materials.");
    }
  };

  // Roadmap item (customer_request): per-section reanalysis - a focused, single-section AI re-run
  // of an already-completed analysis (e.g. just the BOM, if it came out unsatisfactory) instead of
  // rerunning the entire 8-section analysis and hoping. Same background-task/waitForTask pattern
  // already used for proposal generation (see useWorkspace.ts's handleGenerateProposal).
  // "reanalyzingSection" alone only covers this exact page load - the button must also treat a
  // task the SERVER already knows about (activeTasks, backed by the same SSE stream as the
  // footer, survives a page refresh) as running, or a refresh mid-job makes the button look idle
  // and re-clickable while the job is actually still going.
  const [reanalyzingSection, setReanalyzingSection] = useState<string | null>(null);
  const SECTION_LABELS: Record<string, string> = {
    critical_requirements: "Requisitos Críticos",
    risks: "Riscos",
    opportunities: "Oportunidades",
    bom: "BOM (Lista de Materiais)",
  };
  const activeSectionReanalysisTask = activeTasks.find((t) => t.type === "section_reanalysis" && t.result_id === selectedProjectId);
  const isAnySectionReanalysisRunning = reanalyzingSection !== null || !!activeSectionReanalysisTask;
  const handleReanalyzeSection = async (section: string) => {
    if (!hasPermission("analysis:run") || !selectedProjectId || isAnySectionReanalysisRunning) return;
    setReanalyzingSection(section);
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/analysis-result/reanalyze-section`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível iniciar a reanálise." : "Could not start the reanalysis."));
        return;
      }
      const finished = await waitForTask(data.task_id);
      if (finished.status === "failed") {
        throw new Error(finished.error_message || (locale === "pt" ? "Falha na reanálise." : "Reanalysis failed."));
      }
      await fetchProjectDetails(selectedProjectId);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setReanalyzingSection(null);
    }
  };

  const ReanalyzeSectionButton = ({ section }: { section: string }) => {
    const label = SECTION_LABELS[section];
    const isThisSectionRunning = reanalyzingSection === section
      || (!!activeSectionReanalysisTask && (activeSectionReanalysisTask.current_step || "").includes(label));
    const progressPct = isThisSectionRunning ? activeSectionReanalysisTask?.progress_pct : null;
    return (
      <button
        onClick={() => handleReanalyzeSection(section)}
        disabled={isAnySectionReanalysisRunning}
        className="flex items-center gap-1 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 border border-slate-300 text-xs px-2.5 py-1.5 rounded font-bold font-mono transition-all shadow-sm cursor-pointer"
        title={tx("Re-run AI analysis focused only on this section", "Executa a análise de IA novamente, focada só nesta seção")}
      >
        <RefreshCw size={13} className={isThisSectionRunning ? "animate-spin" : ""} />
        {isThisSectionRunning
          ? `${tx("Reanalyzing", "Reanalisando")}${progressPct != null ? ` ${progressPct}%` : "..."}`
          : tx("Reanalyze Section", "Reanalisar Seção")}
      </button>
    );
  };

  const [currentFolder, setCurrentFolder] = useState<string>(""); // "" means root/raiz
  const [projectFolders, setProjectFolders] = useState<string[]>([]);
  const [virtualFiles, setVirtualFiles] = useState<any[]>([]);
  const [docFolderMapping, setDocFolderMapping] = useState<Record<string, string>>({}); // docId -> folderName
  const [editingFileNameId, setEditingFileNameId] = useState<string | null>(null);
  const [editingFileNameValue, setEditingFileNameValue] = useState<string>("");
  const [showNewFolderInput, setShowNewFolderInput] = useState<boolean>(false);
  const [newFolderNameValue, setNewFolderNameValue] = useState<string>("");
  const [activeFileViewer, setActiveFileViewer] = useState<any | null>(null); // To view text/markdown files
  const [showMoveFileModal, setShowMoveFileModal] = useState<any | null>(null); // File to move
  const [showCreateFileModal, setShowCreateFileModal] = useState<boolean>(false);
  const [newFileName, setNewFileName] = useState<string>("");
  const [newFileContent, setNewFileContent] = useState<string>("");
  const [chatMessage, setChatMessage] = useState<string>("");
  const [isChatSending, setIsChatSending] = useState<boolean>(false);

  // Without this, a new message (including the "thinking" indicator) appended to the bottom of
  // the feed stays invisible unless the user manually scrolls down - confirmed via testing that
  // this is exactly why the copilot read as "frozen" after sending a question: the real reply
  // (or the fact that it was still working) was there, just off-screen.
  useEffect(() => {
    if (showCopilotChat) chatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory.length, isChatSending, showCopilotChat]);

  const {
    handleUpdateRequirement,
    handleUpdateRisk,
    handleGenerateProposal,
    handleSendChatMessage,
    saveFoldersToStorage,
    saveVirtualFilesToStorage,
    saveDocMappingsToStorage,
    getFilesForFolder,
  } = useWorkspace({
    locale, tx, hasPermission, selectedProjectId,
    analysisResult, setAnalysisResult, fetchGlobalConfigs, fetchProjectDetails, setActiveTab, waitForTask,
    proposalTemplates, selectedTemplateIdByType,
    documents, projectFolders, setProjectFolders, docFolderMapping, setDocFolderMapping,
    virtualFiles, setVirtualFiles,
    chatMessage, setChatMessage, setChatHistory, setIsChatSending,
  });

  // Load project-specific file system states
  useEffect(() => {
    if (!selectedProjectId) return;

    const savedFolders = localStorage.getItem(`folders_${selectedProjectId}`);
    if (savedFolders) {
      try {
        setProjectFolders(JSON.parse(savedFolders));
      } catch (e) {
        setProjectFolders(["Especificações", "Desenhos CAD", "Planilhas Financeiras", "Propostas e Minutas"]);
      }
    } else {
      const defaults = ["Especificações", "Desenhos CAD", "Planilhas Financeiras", "Propostas e Minutas"];
      setProjectFolders(defaults);
      localStorage.setItem(`folders_${selectedProjectId}`, JSON.stringify(defaults));
    }

    const savedVFiles = localStorage.getItem(`virtual_files_${selectedProjectId}`);
    if (savedVFiles) {
      try {
        setVirtualFiles(JSON.parse(savedVFiles));
      } catch (e) {
        setVirtualFiles([]);
      }
    } else {
      setVirtualFiles([]);
    }

    const savedMappings = localStorage.getItem(`doc_mappings_${selectedProjectId}`);
    if (savedMappings) {
      try {
        setDocFolderMapping(JSON.parse(savedMappings));
      } catch (e) {
        setDocFolderMapping({});
      }
    } else {
      setDocFolderMapping({});
    }

    setCurrentFolder("");
  }, [selectedProjectId]);

  return (
    <>
            <div className="flex items-center gap-6 px-6 h-12 border-b border-slate-200 text-xs font-semibold bg-slate-50/50">
              <button
                onClick={() => setSubTab("summary")}
                className={`h-full px-1 border-b-2 transition-all font-bold uppercase tracking-wider ${subTab === "summary" ? "border-brand-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
              >
                {t("execSummary")}
              </button>
              <button
                onClick={() => setSubTab("requirements")}
                className={`h-full px-1 border-b-2 transition-all font-bold uppercase tracking-wider ${subTab === "requirements" ? "border-brand-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
              >
                {t("reqsGrid")} ({reqsCount})
              </button>
              <button
                onClick={() => setSubTab("risks")}
                className={`h-full px-1 border-b-2 transition-all font-bold uppercase tracking-wider ${subTab === "risks" ? "border-brand-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
              >
                {t("risksOpps")} ({risksCount + oppsCount})
              </button>
              <button
                onClick={() => setSubTab("bom")}
                className={`h-full px-1 border-b-2 transition-all font-bold uppercase tracking-wider ${subTab === "bom" ? "border-brand-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
              >
                {t("bomBuilder")}
              </button>
              <button
                onClick={() => setSubTab("proposal_builder")}
                className={`h-full px-1 border-b-2 transition-all font-bold uppercase tracking-wider ${subTab === "proposal_builder" ? "border-brand-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
              >
                {t("proposalStudioGen")}
              </button>
              <button
                onClick={() => setSubTab("explorer")}
                className={`h-full px-1 border-b-2 transition-all font-bold uppercase tracking-wider ${subTab === "explorer" ? "border-brand-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
              >
                📂 {locale === "pt" ? "Explorador de Arquivos" : "File Explorer"}
              </button>
            </div>

          {/* TAB 1: WORKSPACE TAB */}
            <div className="flex-1 p-6 flex gap-6 overflow-hidden min-h-0">

              {/* Left Column of Workspace (Contents depend on SubTab) */}
              <div className="flex-[2] flex flex-col min-h-0 overflow-y-auto pr-2">

                {/* SUBTAB 1.1: EXECUTIVE SUMMARY */}
                {subTab === "summary" && (
                  <div className="space-y-6">
                    {displayAnalysisResult?.is_document_analysis_stale === true && (
                      <div className="flex items-center gap-2 text-xs text-warning-800 bg-warning-50 border border-warning-200 rounded-lg px-3 py-2">
                        <TriangleAlert size={14} className="shrink-0" />
                        {tx("This analysis was generated with an earlier version of the analysis logic. Consider re-running it.", "Esta análise foi gerada com uma versão anterior da lógica de análise. Considere executá-la novamente.")}
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-4 shrink-0">
                      <div className="p-4 bg-brand-50 border border-brand-100 rounded-lg shadow-sm">
                        <p className="text-[10px] uppercase tracking-wider text-brand-700 font-bold font-mono">{locale === "pt" ? "Especificações Analisadas" : "Specifications Parsed"}</p>
                        <p className="text-2xl font-light text-slate-900">{documents.length} <span className="text-xs text-slate-500 font-mono">{locale === "pt" ? "Arquivos" : "Files"}</span></p>
                        <div className="w-full bg-brand-200 h-1 mt-2 rounded-full"><div className="bg-brand-600 h-1 w-full rounded-full"></div></div>
                      </div>
                      <div className="p-4 bg-brand-50 border border-brand-100 rounded-lg shadow-sm">
                        <p className="text-[10px] uppercase tracking-wider text-brand-700 font-bold font-mono">{locale === "pt" ? "Mitigações Definidas" : "Mitigations Set"}</p>
                        <p className="text-2xl font-light text-slate-900">
                          {analysisResult?.risks.filter(r => r.mitigation).length || 0}
                          <span className="text-xs text-slate-500 font-mono"> / {risksCount} {locale === "pt" ? "Riscos" : "Risks"}</span>
                        </p>
                        <div className="w-full bg-brand-200 h-1 mt-2 rounded-full">
                          <div
                            className="bg-brand-600 h-1 rounded-full"
                            style={{ width: `${risksCount ? ((analysisResult?.risks.filter(r => r.mitigation).length || 0) / risksCount) * 100 : 0}%` }}
                          ></div>
                        </div>
                      </div>
                      <div className="p-4 bg-brand-50 border border-brand-100 rounded-lg shadow-sm">
                        <p className="text-[10px] uppercase tracking-wider text-brand-700 font-bold font-mono">{locale === "pt" ? "Dúvidas Extraídas" : "Extracted Gaps"}</p>
                        <p className="text-2xl font-light text-slate-900">
                          {analysisResult?.clarification_questions.length || 0}
                          <span className="text-xs text-slate-500 font-mono"> {locale === "pt" ? "Perguntas" : "Questions"}</span>
                        </p>
                        <div className="w-full bg-brand-200 h-1 mt-2 rounded-full"><div className="bg-brand-600 h-1 w-full rounded-full"></div></div>
                      </div>
                    </div>

                    {analysisError && (
                      <div className="mb-4 p-4 rounded-xl border border-warning-200 bg-warning-50 text-warning-900 text-sm shadow-sm">
                        <div className="font-bold mb-1">
                          {locale === "pt" ? "Análise não executada" : "Analysis not executed"}
                        </div>
                        <p className="leading-relaxed">{analysisError}</p>
                        <button
                          onClick={() => {
                            if (!canAccessAdminSection("ai")) {
                              alert(locale === "pt" ? "Você não tem permissão para acessar as configurações de IA." : "You do not have permission to access AI settings.");
                              return;
                            }

                            setActiveTab("admin");
                            setActiveAdminSection("ai");
                          }}
                          className="mt-3 bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider"
                        >
                          {locale === "pt" ? "Abrir Configurações de IA" : "Open AI Settings"}
                        </button>
                      </div>
                    )}

                    {!displayAnalysisResult ? (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center flex flex-col items-center justify-center py-16">
                        <TriangleAlert className="text-warning-500 mb-2" size={32} />
                        <h4 className="text-sm font-bold text-slate-800 uppercase font-mono">{tx("Specifications Awaiting Analysis", "Especificações Aguardando Análise")}</h4>
                        <p className="text-xs text-slate-500 max-w-md mt-1 leading-relaxed">
                          Envie os arquivos de documentação da licitação ou as diretrizes de especificação do cliente na barra lateral e clique em <strong>"EXECUTAR ANÁLISE IA"</strong>. A IA vai extrair os requisitos estruturados, analisar possíveis riscos da licitação, montar uma lista de BOM padrão e compilar os quadros de conformidade automaticamente.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <h2 className="text-lg font-light text-slate-900">{locale === "en" ? "Executive Summary" : "Resumo Executivo"}</h2>
                            <span className="text-[10px] bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full font-bold font-mono">{tx("AI COMPLIANCE DIGEST", "RESUMO DE COMPLIANCE IA")}</span>
                          </div>

                          <div className="prose prose-sm text-slate-600 space-y-4">
                            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                              <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono mb-1">{locale === "en" ? "Project & Deliverable Scope" : "Escopo do Projeto e Entregáveis"}</h4>
                              <p className="text-xs text-slate-700 leading-relaxed">{displayAnalysisResult.executive_summary.project_overview}</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                                <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono mb-1">{locale === "en" ? "Customer Objectives" : "Objetivos do Cliente"}</h4>
                                <p className="text-xs text-slate-700 leading-relaxed">{displayAnalysisResult.executive_summary.customer_context}</p>
                              </div>
                              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                                <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono mb-1">{locale === "en" ? "Core Requirements Summary" : "Resumo dos Requisitos Principais"}</h4>
                                <p className="text-xs text-slate-700 leading-relaxed">{displayAnalysisResult.executive_summary.main_requirements}</p>
                              </div>
                            </div>

                            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                              <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono mb-1">{locale === "en" ? "Strategic Bid Orientation Recommendation" : "Recomendação Estratégica de Orientação da Proposta"}</h4>
                              <p className="text-xs text-slate-700 leading-relaxed">{displayAnalysisResult.executive_summary.recommended_strategy}</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                                <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono mb-1">{locale === "en" ? "Technical Assumptions" : "Premissas Técnicas"}</h4>
                                <p className="text-xs text-slate-700 leading-relaxed">{displayAnalysisResult.executive_summary.assumptions}</p>
                              </div>
                              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                                <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono mb-1">{locale === "en" ? "Recommended Next Steps" : "Próximos Passos Recomendados"}</h4>
                                <p className="text-xs text-slate-700 leading-relaxed">{displayAnalysisResult.executive_summary.next_steps}</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Extracted Schedule */}
                        {displayAnalysisResult.preliminary_schedule && displayAnalysisResult.preliminary_schedule.length > 0 && (
                          <div className="pt-4 border-t border-slate-200">
                            <h3 className="text-sm uppercase tracking-wider text-slate-500 font-bold mb-3 font-mono">{locale === "en" ? "Preliminary Engineering Schedule" : "Cronograma Preliminar de Engenharia"}</h3>
                            <div className="space-y-3">
                              {displayAnalysisResult.preliminary_schedule.map((phase, i) => (
                                <div key={i} className="p-3 bg-slate-50 border-l-2 border-brand-500 rounded shadow-sm">
                                  <div className="flex justify-between items-center mb-1">
                                    <h4 className="text-xs font-bold text-slate-800 uppercase font-mono">{phase.phase_name}</h4>
                                    <span className="text-[10px] bg-brand-100 text-brand-800 px-2 rounded-full font-bold">{phase.estimated_duration}</span>
                                  </div>
                                  <p className="text-xs text-slate-500 mb-2 font-mono">{locale === "en" ? "Activities:" : "Atividades:"} {Array.isArray(phase.activities) ? phase.activities.join(", ") : phase.activities}</p>
                                  <div className="grid grid-cols-2 gap-4 text-[10px] text-slate-400 mt-1">
                                    <span><strong>{locale === "en" ? "Responsible:" : "Responsável:"}</strong> {phase.responsible_area}</span>
                                    <span><strong>{locale === "en" ? "Dependencies:" : "Dependências:"}</strong> {Array.isArray(phase.dependencies) ? phase.dependencies.join(", ") : phase.dependencies}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                  </div>
                )}

                {/* SUBTAB 1.2: REQUIREMENTS DATAGRID */}
                {subTab === "requirements" && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">{tx("Tender Requirements Datagrid", "Grade de Requisitos da Licitação")}</h3>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400">{tx("Updates sync in real-time with the central model", "Atualizações sincronizadas em tempo real com o modelo central")}</span>
                        {displayAnalysisResult && <ReanalyzeSectionButton section="critical_requirements" />}
                      </div>
                    </div>

                    {!displayAnalysisResult ? (
                      <div className="text-center py-12 text-slate-400 italic">{tx("No analysis conducted yet. Run analysis to populate requirements grid.", "Nenhuma análise realizada ainda. Execute a análise para preencher a grade de requisitos.")}</div>
                    ) : (
                      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                            <tr>
                              <th className="p-3">{tx("Ref", "Ref.")}</th>
                              <th className="p-3 w-1/3">{tx("Requirement Description", "Descrição do Requisito")}</th>
                              <th className="p-3">{tx("Source Ref", "Fonte")}</th>
                              <th className="p-3">{tx("Category", "Categoria")}</th>
                              <th className="p-3">{tx("Priority", "Prioridade")}</th>
                              <th className="p-3">{tx("Compliance Status", "Status de Conformidade")}</th>
                              <th className="p-3">{tx("Engineering Notes", "Notas de Engenharia")}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {displayAnalysisResult.critical_requirements.map((req, idx) => (
                              <tr key={req.requirement_id || idx} className="hover:bg-slate-50/50">
                                <td className="p-3 font-mono font-bold text-slate-400">{req.requirement_id || `req-${idx+1}`}</td>
                                <td className="p-3">
                                  <p className="font-semibold text-slate-800 leading-normal">{req.description}</p>
                                  {req.source_snippet && (
                                    <span className="text-[10px] text-slate-400 italic block mt-0.5">"{req.source_snippet}"</span>
                                  )}
                                </td>
                                <td className="p-3 text-[11px] font-mono leading-tight">
                                  <p className="font-semibold text-slate-700">{req.source_document}</p>
                                  <p className="text-slate-400">{req.source_page_or_section}</p>
                                </td>
                                <td className="p-3">
                                  <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono uppercase text-[9px]">{req.category}</span>
                                </td>
                                <td className="p-3">
                                  <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] uppercase ${
                                    req.priority === "high" ? "text-danger-700 bg-danger-50 border border-danger-100" :
                                    req.priority === "medium" ? "text-warning-700 bg-warning-50 border border-warning-100" :
                                    "text-slate-600 bg-slate-100 border border-slate-200"
                                  }`}>
                                    {req.priority}
                                  </span>
                                </td>
                                <td className="p-3">
                                  <select
                                    value={req.compliance_status}
                                    onChange={(e) => {
                                      sendKnowledgeBaseSuggestion({
                                        category: "compliance_status",
                                        field_label: "Status de Conformidade",
                                        old_value: req.compliance_status,
                                        new_value: e.target.value,
                                        item_context: `${req.requirement_id}: ${req.description}`,
                                      });
                                      handleUpdateRequirement(req.requirement_id, e.target.value as any, req.notes);
                                    }}
                                    className={`text-[11px] font-bold p-1 rounded border cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-500 ${
                                      req.compliance_status === "compliant" ? "text-success-700 bg-success-50 border-success-200" :
                                      req.compliance_status === "partially_compliant" ? "text-warning-700 bg-warning-50 border-warning-200" :
                                      req.compliance_status === "non_compliant" ? "text-danger-700 bg-danger-50 border-danger-200" :
                                      "text-slate-700 bg-slate-100 border-slate-300"
                                    }`}
                                  >
                                    <option value="compliant">{tx("Compliant", "Conforme")}</option>
                                    <option value="partially_compliant">{tx("Partially", "Parcial")}</option>
                                    <option value="non_compliant">{tx("Non-Compliant", "Não Conforme")}</option>
                                    <option value="not_enough_information">{tx("Needs Info", "Precisa de Informação")}</option>
                                  </select>
                                </td>
                                <td className="p-3">
                                  <button
                                    onClick={() => { setEditingNotesReqId(req.requirement_id); setEditingNotesDraft(req.notes || ""); }}
                                    className={`text-[11px] font-bold px-2 py-1 rounded border transition-colors cursor-pointer whitespace-nowrap ${
                                      req.notes ? "text-brand-700 bg-brand-50 border-brand-200 hover:bg-brand-100" : "text-slate-500 bg-slate-50 border-slate-200 hover:bg-slate-100"
                                    }`}
                                  >
                                    {req.notes ? "Ver Notas de Engenharia" : "+ Notas de Engenharia"}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {editingNotesReqId && (() => {
                      const req = displayAnalysisResult?.critical_requirements.find((r) => r.requirement_id === editingNotesReqId);
                      return (
                        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
                          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
                            <div className="flex items-center justify-between p-4 border-b border-slate-100">
                              <div>
                                <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">Notas de Engenharia</h3>
                                <p className="text-[11px] text-slate-400 font-mono mt-0.5">{editingNotesReqId} — {req?.description}</p>
                              </div>
                              <button onClick={() => setEditingNotesReqId(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer shrink-0 ml-3">
                                <X size={18} />
                              </button>
                            </div>
                            <div className="flex-1 p-4 min-h-0">
                              <textarea
                                value={editingNotesDraft}
                                onChange={(e) => setEditingNotesDraft(e.target.value)}
                                placeholder="Adicionar observações técnicas de conformidade..."
                                className="w-full h-full min-h-[200px] p-3 rounded border border-slate-200 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
                                autoFocus
                              />
                            </div>
                            <div className="flex justify-end gap-2 p-4 border-t border-slate-100">
                              <button
                                onClick={() => setEditingNotesReqId(null)}
                                className="px-4 py-2 text-xs font-bold uppercase text-slate-500 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={() => {
                                  if (req) {
                                    sendKnowledgeBaseSuggestion({
                                      category: "engineering_note",
                                      field_label: "Notas de Engenharia",
                                      old_value: req.notes || "",
                                      new_value: editingNotesDraft,
                                      item_context: `${req.requirement_id}: ${req.description}`,
                                    });
                                    handleUpdateRequirement(req.requirement_id, req.compliance_status, editingNotesDraft);
                                  }
                                  setEditingNotesReqId(null);
                                }}
                                className="px-4 py-2 text-xs font-bold uppercase bg-brand-600 hover:bg-brand-700 text-white rounded transition-colors cursor-pointer"
                              >
                                Salvar
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* SUBTAB 1.3: RISKS & OPPORTUNITIES */}
                {subTab === "risks" && (
                  <div className="space-y-6">

                    {/* Tender Risks Grid */}
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">{tx("Tender Threats & Material Risks", "Riscos Materiais da Licitação")}</h3>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-slate-400">{tx("Risk rating matrix extracted via compliance analysis", "Matriz de riscos extraída pela análise de conformidade")}</span>
                          {displayAnalysisResult && <ReanalyzeSectionButton section="risks" />}
                        </div>
                      </div>

                      {!displayAnalysisResult ? (
                        <div className="text-center py-12 text-slate-400 italic">{tx("No analysis conducted yet. Run analysis to display risks.", "Nenhuma análise realizada ainda. Execute a análise para exibir os riscos.")}</div>
                      ) : (
                        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                              <tr>
                                <th className="p-3">{tx("Ref", "Ref.")}</th>
                                <th className="p-3">{tx("Risk Title & Impact", "Risco e Impacto")}</th>
                                <th className="p-3">{tx("Severity", "Severidade")}</th>
                                <th className="p-3">{tx("Probability", "Probabilidade")}</th>
                                <th className="p-3">{tx("Source Ref", "Fonte")}</th>
                                <th className="p-3">{tx("Mitigation Design", "Plano de Mitigação")}</th>
                                <th className="p-3">{tx("Clarification", "Esclarecimento")}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {displayAnalysisResult.risks.map((risk, idx) => (
                                <tr key={risk.risk_id || idx} className="hover:bg-slate-50/50">
                                  <td className="p-3 font-mono font-bold text-slate-400">{risk.risk_id || `risk-${idx+1}`}</td>
                                  <td className="p-3">
                                    <p className="font-semibold text-slate-800 leading-normal">{risk.title}</p>
                                    <p className="text-xs text-slate-500 leading-normal mt-0.5">{risk.description}</p>
                                    <p className="text-[11px] text-danger-600 mt-1 font-mono">⚠️ Impact: {risk.impact}</p>
                                  </td>
                                  <td className="p-3">
                                    <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] uppercase ${
                                      risk.severity === "critical" || risk.severity === "high" ? "text-danger-700 bg-danger-50" : "text-warning-700 bg-warning-50"
                                    }`}>
                                      {risk.severity}
                                    </span>
                                  </td>
                                  <td className="p-3 uppercase font-mono text-slate-600">{risk.probability}</td>
                                  <td className="p-3 text-[11px] font-mono leading-tight">
                                    <p className="font-semibold text-slate-700">{risk.source_document}</p>
                                    <p className="text-slate-400">{risk.source_page_or_section}</p>
                                  </td>
                                  <td className="p-3 w-1/4">
                                    <textarea
                                      value={risk.mitigation || ""}
                                      placeholder={tx("Detail pre-sales engineering countermeasure...", "Detalhar contramedida técnica de pré-vendas...")}
                                      onChange={(e) => handleUpdateRisk(risk.risk_id, e.target.value, risk.requires_customer_clarification)}
                                      className="border border-slate-200 p-2.5 rounded text-xs w-full h-16 focus:outline-none focus:ring-1 focus:ring-brand-500"
                                    />
                                  </td>
                                  <td className="p-3 text-center">
                                    <button
                                      onClick={() => handleUpdateRisk(risk.risk_id, risk.mitigation || "", !risk.requires_customer_clarification)}
                                      className={`text-[10px] font-bold px-2 py-1 rounded border transition-all ${
                                        risk.requires_customer_clarification ? "bg-warning-50 text-warning-700 border-warning-300" : "bg-slate-50 text-slate-400 border-slate-200"
                                      }`}
                                    >
                                      {risk.requires_customer_clarification ? "Flagged QA" : "Flag QA"}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Up-Sell Opportunities Grid */}
                    <div className="space-y-3 pt-4 border-t border-slate-200">
                      <div className="flex justify-between items-center">
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">{tx("Pre-Sales Up-Sell & SLA Opportunities", "Oportunidades de Pré-Vendas, Upsell e SLA")}</h3>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-slate-400">{tx("Value added propositions parsed from specifications", "Propostas de valor extraídas das especificações")}</span>
                          {displayAnalysisResult && <ReanalyzeSectionButton section="opportunities" />}
                        </div>
                      </div>

                      {!displayAnalysisResult ? (
                        <div className="text-center py-12 text-slate-400 italic">{tx("No analysis conducted.", "Nenhuma análise realizada.")}</div>
                      ) : (
                        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                              <tr>
                                <th className="p-3">{tx("Ref", "Ref.")}</th>
                                <th className="p-3">{tx("Opportunity Proposition", "Proposta de Oportunidade")}</th>
                                <th className="p-3">{tx("Estimated Business Value", "Valor Comercial Estimado")}</th>
                                <th className="p-3">{tx("Suggested Solution Upgrade", "Upgrade de Solução Sugerido")}</th>
                                <th className="p-3">{tx("Sales / Account Strategy", "Estratégia Comercial / Conta")}</th>
                                <th className="p-3">{tx("Priority", "Prioridade")}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {displayAnalysisResult.opportunities.map((opp, idx) => (
                                <tr key={opp.opportunity_id || idx} className="hover:bg-slate-50/50">
                                  <td className="p-3 font-mono font-bold text-slate-400">{opp.opportunity_id || `opp-${idx+1}`}</td>
                                  <td className="p-3">
                                    <p className="font-semibold text-slate-800">{opp.title}</p>
                                    <p className="text-xs text-slate-500 mt-0.5">{opp.description}</p>
                                  </td>
                                  <td className="p-3 font-semibold text-success-700 leading-normal">{opp.business_value}</td>
                                  <td className="p-3 text-slate-700 font-semibold">{opp.suggested_solution}</td>
                                  <td className="p-3 text-slate-600">{opp.sales_strategy}</td>
                                  <td className="p-3 uppercase">
                                    <span className={`px-2 py-0.5 rounded font-bold text-[9px] border ${
                                      opp.priority === "high" ? "text-brand-800 bg-brand-100 border-brand-200" :
                                      opp.priority === "medium" ? "text-brand-700 bg-brand-50 border-brand-100" :
                                      "text-slate-700 bg-slate-100 border-slate-200"
                                    }`}>
                                      {opp.priority}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* SUBTAB 1.4: TECHNICAL BOM BUILDER */}
                {subTab === "bom" && (
                  <div className="space-y-6">

                    {/* Bill of Materials Builder */}
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <div className="flex flex-col">
                          <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">{tx("Specifications Bill of Materials (B.O.M.)", "Lista de Materiais das Especificações (B.O.M.)")}</h3>
                          <span className="text-xs text-slate-400">{tx("Aligned with active design parameters e.g. standard vendor compatibility", "Alinhado aos parâmetros ativos do projeto, como compatibilidade com fornecedor padrão")}</span>
                        </div>
                        <div className="flex items-center gap-2">
                        {displayAnalysisResult?.is_bom_enrichment_stale === true && (
                          <span className="flex items-center gap-1 text-[10px] text-warning-800 bg-warning-50 border border-warning-200 rounded px-2 py-1" title={tx("This BOM was enriched with an earlier version of the matching logic.", "Este BOM foi enriquecido com uma versão anterior da lógica de correspondência.")}>
                            <TriangleAlert size={11} /> {tx("Outdated logic", "Lógica desatualizada")}
                          </span>
                        )}
                        {(() => {
                          const flaggedCount = (displayAnalysisResult?.bom || []).filter((b) => b.brand_policy_applicable && b.brand_policy_compliant === false).length;
                          if (flaggedCount === 0) return null;
                          return (
                            <span className="flex items-center gap-1 text-[10px] text-danger-800 bg-danger-50 border border-danger-200 rounded px-2 py-1">
                              ⚠️ {flaggedCount} {tx("item(s) off the brand policy", "item(ns) fora da política de marca")}
                            </span>
                          );
                        })()}
                        {displayAnalysisResult && <ReanalyzeSectionButton section="bom" />}
                        <button
                          onClick={() => {
                            if (!analysisResult) return;
                            const newBOMItem: BOMItem = {
                              item_id: "bom_custom_" + Math.random().toString(36).substr(2, 5),
                              sku: "",
                              part_number: "",
                              equipment_name: "Novo item",
                              manufacturer: "",
                              quantity: 1,
                              unit: "un",
                              category: "Hardware",
                              specification: "",
                              source_reference: "",
                            };
                            const updatedBOM = [...analysisResult.bom, newBOMItem];
                            saveBOM(updatedBOM);
                          }}
                          className="flex items-center gap-1 bg-brand-600 hover:bg-brand-700 text-white text-xs px-2.5 py-1.5 rounded font-bold font-mono transition-all shadow-sm cursor-pointer"
                        >
                          <Plus size={13} /> Adicionar Item
                        </button>
                        </div>
                      </div>

                      {!displayAnalysisResult ? (
                        <div className="text-center py-12 text-slate-400 italic">{tx("No analysis conducted.", "Nenhuma análise realizada.")}</div>
                      ) : (
                        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                              <tr>
                                <th className="p-3">SKU</th>
                                <th className="p-3">Part Number</th>
                                <th className="p-3">{tx("Equipment", "Equipamento")}</th>
                                <th className="p-3">{tx("Manufacturer", "Fabricante")}</th>
                                <th className="p-3">{tx("Qty", "Qtd.")}</th>
                                <th className="p-3">{tx("Unit", "Unidade")}</th>
                                <th className="p-3">{tx("Category", "Categoria")}</th>
                                <th className="p-3 w-1/4">{tx("Technical Specification", "Especificação Técnica")}</th>
                                <th className="p-3">{tx("Document Ref.", "Ref. no Documento")}</th>
                                <th className="p-3">{tx("Actions", "Ações")}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {displayAnalysisResult.bom.map((item, idx) => {
                                // Editing sku/part_number/manufacturer by hand means a person has
                                // now verified/corrected that value - "found via web search" is
                                // no longer the relevant fact about it, so the badge switches to
                                // who edited it instead of where it originally came from.
                                const SOURCING_FIELDS: (keyof BOMItem)[] = ["sku", "part_number", "manufacturer"];
                                const updateField = (field: keyof BOMItem, value: string | number) => {
                                  const updatedBOM = analysisResult!.bom.map(b => b.item_id === item.item_id
                                    ? {
                                        ...b,
                                        [field]: value,
                                        ...(SOURCING_FIELDS.includes(field) ? { sourced_via_web_search: false, sourced_via_knowledge_base: false, edited_by: currentUserName } : {}),
                                      }
                                    : b);
                                  saveBOM(updatedBOM);
                                };
                                return (
                                <tr key={item.item_id || idx} className="hover:bg-slate-50/50">
                                  <td className="p-3">
                                    <input type="text" value={item.sku} onChange={(e) => updateField("sku", e.target.value)}
                                      className="font-mono text-slate-700 bg-slate-50 px-1 py-0.5 rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500 w-24" />
                                  </td>
                                  <td className="p-3">
                                    <input type="text" value={item.part_number}
                                      onFocus={() => { partNumberFocusValues.current[item.item_id] = item.part_number; }}
                                      onChange={(e) => updateField("part_number", e.target.value)}
                                      onBlur={(e) => {
                                        const original = partNumberFocusValues.current[item.item_id];
                                        if (original !== undefined) {
                                          sendKnowledgeBaseSuggestion({
                                            category: "bom_part_number",
                                            field_label: "Número de Peça (Part Number)",
                                            old_value: original,
                                            new_value: e.target.value,
                                            item_context: `${item.equipment_name} (fabricante: ${item.manufacturer || "não informado"}) - ${item.specification || ""}`,
                                          });
                                        }
                                        delete partNumberFocusValues.current[item.item_id];
                                      }}
                                      className="font-mono text-slate-700 bg-slate-50 px-1 py-0.5 rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500 w-28" />
                                    {item.edited_by ? (
                                      <span
                                        className="inline-block mt-1 text-[9px] font-bold text-success-700 bg-success-50 border border-success-100 px-1.5 py-0.5 rounded-full"
                                        title="Valor corrigido/verificado manualmente"
                                      >
                                        ✏️ Editado por {item.edited_by}
                                      </span>
                                    ) : item.sourced_via_knowledge_base ? (
                                      <span
                                        className="inline-block mt-1 text-[9px] font-bold text-brand-700 bg-brand-50 border border-brand-100 px-1.5 py-0.5 rounded-full"
                                        title="Resolvido a partir da Base de Conhecimento aprovada (conhecimento validado de projetos anteriores)"
                                      >
                                        📚 Via Base de Conhecimento
                                      </span>
                                    ) : item.sourced_via_web_search && (
                                      <span
                                        className="inline-block mt-1 text-[9px] font-bold text-warning-700 bg-warning-50 border border-warning-100 px-1.5 py-0.5 rounded-full"
                                        title="Sugerido por busca real na web, não citado no documento - valide antes de usar na proposta final"
                                      >
                                        🌐 Sugestão via busca web
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-3">
                                    <input type="text" value={item.equipment_name} onChange={(e) => updateField("equipment_name", e.target.value)}
                                      className="font-bold text-slate-800 bg-slate-50 px-1 py-0.5 rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                                    {typeof item.confidence === "number" && (item.manufacturer?.trim() || item.part_number?.trim()) && (
                                      <span
                                        className={`inline-block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                                          item.confidence < 0.5
                                            ? "text-warning-700 bg-warning-50 border-warning-100"
                                            : item.confidence < 0.8
                                              ? "text-slate-600 bg-slate-100 border-slate-200"
                                              : "text-success-700 bg-success-50 border-success-100"
                                        }`}
                                        title={tx(
                                          "AI-reported confidence that this equipment/specification correctly captures what the source document demands - not the same as whether a real product match was found.",
                                          "Confiança reportada pela IA de que este equipamento/especificação captura corretamente o que o documento fonte exige - não é o mesmo que ter encontrado um produto real correspondente."
                                        )}
                                      >
                                        {item.confidence < 0.5 ? `🔎 ${tx("Review", "Revisar")} ` : ""}{Math.round(item.confidence * 100)}%
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-3">
                                    <input type="text" value={item.manufacturer} onChange={(e) => updateField("manufacturer", e.target.value)}
                                      className="text-slate-700 bg-slate-50 px-1 py-0.5 rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                                    {item.brand_policy_applicable && item.brand_policy_compliant === false && (
                                      <span
                                        className={`inline-block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                                          item.brand_policy_confidence === "high" ? "text-danger-700 bg-danger-50 border-danger-100" : "text-warning-700 bg-warning-50 border-warning-100"
                                        }`}
                                        title={item.brand_policy_note || tx("Does not match this project's mandatory brand policy", "Não corresponde à política de marca obrigatória deste projeto")}
                                      >
                                        ⚠️ {tx("Off brand policy", "Fora da política de marca")}
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-3">
                                    <input type="number" value={item.quantity} onChange={(e) => updateField("quantity", parseInt(e.target.value) || 1)}
                                      className="w-14 p-1 rounded border border-slate-200 font-semibold font-mono text-center" />
                                  </td>
                                  <td className="p-3">
                                    <input type="text" value={item.unit} onChange={(e) => updateField("unit", e.target.value)}
                                      className="text-slate-500 uppercase font-mono text-[10px] bg-slate-50 px-1 py-0.5 rounded border border-slate-200 w-14" />
                                  </td>
                                  <td className="p-3 text-slate-700">{item.category}</td>
                                  <td className="p-3">
                                    <textarea value={item.specification} onChange={(e) => updateField("specification", e.target.value)}
                                      className="text-xs text-slate-500 w-full h-12 bg-slate-50 p-1 rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                                  </td>
                                  <td className="p-3 text-slate-400 font-mono text-[10px]">{item.source_reference}</td>
                                  <td className="p-3">
                                    <button
                                      onClick={() => {
                                        const updatedBOM = analysisResult!.bom.filter(b => b.item_id !== item.item_id);
                                        saveBOM(updatedBOM);
                                      }}
                                      className="text-slate-400 hover:text-danger-600 transition-colors"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </td>
                                </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Point to Point Technical Matrices - one table per discipline the AI found
                        in the source document (CFTV, Rede, Elétrica...), each with its own
                        relevant columns rather than one fixed schema for every project.
                        Analyses saved before this schema existed have the old flat-row shape
                        (no `columns`/`rows`) - filtered out defensively rather than crashing on
                        `.map` of undefined; re-running the analysis regenerates it in the new shape. */}
                    {analysisResult && analysisResult.point_to_point_table && analysisResult.point_to_point_table.filter((m) => Array.isArray(m?.columns) && Array.isArray(m?.rows)).length > 0 && (
                      <div className="space-y-5 pt-4 border-t border-slate-200">
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">Matriz de Ponto a Ponto Técnica</h3>
                        {analysisResult.point_to_point_table.filter((m) => Array.isArray(m?.columns) && Array.isArray(m?.rows)).map((matrix, mIdx) => (
                          <div key={mIdx} className="space-y-2">
                            <h4 className="text-xs font-bold uppercase tracking-wide text-brand-700 font-mono">{matrix.discipline}</h4>
                            <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto shadow-sm">
                              <table className="w-full text-left text-xs border-collapse">
                                <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                                  <tr>
                                    {matrix.columns.map((col) => (
                                      <th key={col.key} className="p-3 whitespace-nowrap">{col.label}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                  {matrix.rows.map((row, rIdx) => (
                                    <tr key={rIdx} className="hover:bg-slate-50/50">
                                      {matrix.columns.map((col) => (
                                        <td key={col.key} className="p-3 text-slate-700 align-top">
                                          {row[col.key] === null || row[col.key] === undefined || row[col.key] === ""
                                            ? <span className="text-slate-300">-</span>
                                            : String(row[col.key])}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                  {matrix.rows.length === 0 && (
                                    <tr>
                                      <td colSpan={matrix.columns.length} className="p-4 text-center text-slate-400 italic">Nenhum item identificado para esta disciplina.</td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* SUBTAB 1.5: PROPOSAL STUDIO GENERATOR */}
                {subTab === "proposal_builder" && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">{tx("Proposal Studio Generation", "Geração no Estúdio de Propostas")}</h3>
                      <span className="text-xs text-slate-400">{tx("Generate fully compliant documents from templates", "Gere documentos totalmente conformes a partir de modelos")}</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {PROPOSAL_TYPES.map((proposalType) => {
                        const meta = PROPOSAL_TYPE_GENERATOR_META[proposalType];
                        const Icon = meta.icon;
                        return (
                          <div key={proposalType} className="p-5 bg-slate-50 border border-slate-200 rounded-xl flex flex-col gap-3 shadow-sm">
                            <div className="w-10 h-10 bg-brand-500/10 text-brand-700 rounded-lg flex items-center justify-center">
                              <Icon size={20} />
                            </div>
                            <h4 className="text-sm font-bold text-slate-800 uppercase font-mono leading-none">{tx(meta.titleEn, meta.titlePt)}</h4>
                            <p className="text-xs text-slate-500 leading-relaxed">{tx(meta.descriptionEn, meta.descriptionPt)}</p>
                            <div className="mt-2 pt-2 border-t border-slate-200">
                              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{tx("Select Document Template", "Selecionar Modelo de Documento")}</label>
                              <select
                                value={selectedTemplateIdByType[proposalType] || ""}
                                onChange={(e) => setSelectedTemplateIdByType((current) => ({ ...current, [proposalType]: e.target.value }))}
                                className="text-xs p-1.5 rounded border border-slate-300 w-full focus:outline-none focus:ring-1 focus:ring-brand-500"
                              >
                                {proposalTemplates.filter(t => t.template_type === proposalType && t.active).map(t => (
                                  <option key={t.id} value={t.id}>{t.name} ({t.version})</option>
                                ))}
                              </select>
                            </div>
                            <button
                              onClick={() => handleGenerateProposal(proposalType)}
                              disabled={!analysisResult || !hasPermission("proposal:generate")}
                              className="mt-3 bg-brand-600 hover:bg-brand-700 text-white font-mono text-xs font-bold py-2 px-4 rounded shadow-sm transition-all text-center cursor-pointer disabled:opacity-50"
                            >
                              {tx(`Generate ${PROPOSAL_TYPE_LABELS[proposalType]} (DOCX/PDF)`, `Gerar ${PROPOSAL_TYPE_LABELS[proposalType]} (DOCX/PDF)`)}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* SUBTAB 1.6: FILE EXPLORER / GERENCIADOR DE ARQUIVOS */}
                {subTab === "explorer" && (
                  <div className="space-y-6 flex flex-col h-full min-h-0 bg-slate-50/30 p-4 rounded-xl border border-slate-200">

                    {/* Explorer Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">

                      {/* Left: Breadcrumbs & Path */}
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                        <button
                          onClick={() => setCurrentFolder("")}
                          className="hover:text-brand-600 font-mono flex items-center gap-1 bg-white border border-slate-200 px-2 py-1 rounded shadow-xs transition-colors"
                        >
                          📂 {locale === "pt" ? "Raiz do Projeto" : "Project Root"}
                        </button>
                        {currentFolder && (
                          <>
                            <span className="text-slate-400">/</span>
                            <span className="bg-brand-50 text-brand-800 border border-brand-200 px-2 py-1 rounded font-mono font-bold max-w-[200px] truncate">
                              {currentFolder}
                            </span>
                          </>
                        )}
                        <span className="text-[10px] text-slate-400 font-normal font-mono italic">
                          ({getFilesForFolder ? (getFilesForFolder(currentFolder).real.length + getFilesForFolder(currentFolder).virtual.length) : 0} {locale === "pt" ? "itens" : "items"})
                        </span>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2 self-end sm:self-auto">

                        {/* New Folder Action */}
                        {showNewFolderInput ? (
                          <div className="flex items-center gap-1.5 transition-all">
                            <input
                              type="text"
                              value={newFolderNameValue}
                              onChange={(e) => setNewFolderNameValue(e.target.value)}
                              placeholder={locale === "pt" ? "Nome da pasta..." : "Folder name..."}
                              className="text-xs px-2 py-1 border border-brand-500 rounded focus:outline-none bg-white w-32"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  if (!newFolderNameValue.trim()) return;
                                  if (projectFolders.includes(newFolderNameValue.trim())) {
                                    alert(locale === "pt" ? "Esta pasta já existe!" : "This folder already exists!");
                                    return;
                                  }
                                  saveFoldersToStorage([...projectFolders, newFolderNameValue.trim()]);
                                  setNewFolderNameValue("");
                                  setShowNewFolderInput(false);
                                }
                              }}
                            />
                            <button
                              onClick={() => {
                                if (!newFolderNameValue.trim()) {
                                  setShowNewFolderInput(false);
                                  return;
                                }
                                if (projectFolders.includes(newFolderNameValue.trim())) {
                                  alert(locale === "pt" ? "Esta pasta já existe!" : "This folder already exists!");
                                  return;
                                }
                                saveFoldersToStorage([...projectFolders, newFolderNameValue.trim()]);
                                setNewFolderNameValue("");
                                setShowNewFolderInput(false);
                              }}
                              className="bg-brand-600 text-white text-xs px-2.5 py-1 rounded hover:bg-brand-700 font-bold font-mono"
                            >
                              ✓
                            </button>
                            <button
                              onClick={() => {
                                setShowNewFolderInput(false);
                                setNewFolderNameValue("");
                              }}
                              className="bg-slate-200 text-slate-600 text-xs px-2.5 py-1 rounded hover:bg-slate-300 font-bold font-mono"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setShowNewFolderInput(true)}
                            className="bg-white border border-slate-200 text-slate-700 hover:border-brand-500 hover:text-brand-600 text-xs px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs font-mono"
                          >
                            <FolderPlus size={14} /> {locale === "pt" ? "Nova Pasta" : "New Folder"}
                          </button>
                        )}

                        {/* Create Document Action */}
                        <button
                          onClick={() => {
                            setNewFileName("");
                            setNewFileContent("");
                            setShowCreateFileModal(true);
                          }}
                          className="bg-white border border-slate-200 text-slate-700 hover:border-brand-500 hover:text-brand-600 text-xs px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs font-mono"
                        >
                          <FilePlus size={14} /> {locale === "pt" ? "Novo Documento" : "New Document"}
                        </button>

                      </div>
                    </div>

                    {/* FOLDERS VIEW (Only shown at Root level or top level folder selection) */}
                    {currentFolder === "" && (
                      <div className="space-y-3 shrink-0">
                        <h4 className="text-[10px] uppercase tracking-widest text-slate-400 font-bold font-mono">
                          {locale === "pt" ? "Diretórios de Organização" : "Organizational Directories"}
                        </h4>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          {projectFolders.map(folder => {
                            const folderFiles = (documents.filter(doc => {
                              const assigned = docFolderMapping[doc.id];
                              if (assigned !== undefined) return assigned === folder;
                              const ext = doc.original_filename.split('.').pop()?.toLowerCase();
                              if (folder === "Especificações" && ext === "pdf") return true;
                              if (folder === "Planilhas Financeiras" && (ext === "xlsx" || ext === "xls" || ext === "csv")) return true;
                              if (folder === "Desenhos CAD" && (ext === "dwg" || ext === "dxf" || ext === "cad")) return true;
                              if (folder === "Propostas e Minutas" && (ext === "docx" || ext === "doc")) return true;
                              return false;
                            }).length) + virtualFiles.filter(vf => vf.folder === folder).length;

                            return (
                              <div
                                key={folder}
                                className="bg-white border border-slate-200 hover:border-brand-500 hover:shadow-sm rounded-xl p-4 flex flex-col justify-between h-28 cursor-pointer transition-all group relative"
                                onClick={() => setCurrentFolder(folder)}
                              >
                                <div className="flex justify-between items-start">
                                  <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center border border-brand-100 group-hover:bg-brand-100 group-hover:text-brand-700 group-hover:border-brand-200 transition-colors">
                                    <FolderOpen size={18} />
                                  </div>

                                  {/* Delete Folder Button */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (confirm(locale === "pt" ? `Deseja realmente excluir a pasta "${folder}"? Os arquivos existentes serão movidos para a Raiz.` : `Are you sure you want to delete folder "${folder}"? Existing files will be moved to Root.`)) {
                                        // Move any file that was mapped to this folder back to root
                                        const updatedMappings = { ...docFolderMapping };
                                        Object.keys(updatedMappings).forEach(key => {
                                          if (updatedMappings[key] === folder) {
                                            updatedMappings[key] = "";
                                          }
                                        });
                                        saveDocMappingsToStorage(updatedMappings);

                                        // Move virtual files back to root
                                        const updatedVFiles = virtualFiles.map(vf => vf.folder === folder ? { ...vf, folder: "" } : vf);
                                        saveVirtualFilesToStorage(updatedVFiles);

                                        // Delete the folder
                                        saveFoldersToStorage(projectFolders.filter(f => f !== folder));
                                      }
                                    }}
                                    className="text-slate-400 hover:text-danger-500 p-1 rounded hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                                    title={locale === "pt" ? "Excluir Pasta" : "Delete Folder"}
                                  >
                                    <X size={12} />
                                  </button>
                                </div>

                                <div className="leading-tight mt-3">
                                  <p className="text-xs font-bold text-slate-800 truncate" title={folder}>{folder}</p>
                                  <p className="text-[10px] text-slate-400 font-mono mt-0.5">{folderFiles} {folderFiles === 1 ? "arquivo" : "arquivos"}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* FILES & SUB-ITEMS VIEW */}
                    <div className="flex-1 flex flex-col min-h-0 space-y-3">
                      <div className="flex justify-between items-center shrink-0">
                        <h4 className="text-[10px] uppercase tracking-widest text-slate-400 font-bold font-mono">
                          {currentFolder === "" ? (locale === "pt" ? "Arquivos na Raiz" : "Root Files") : (locale === "pt" ? `Arquivos em "${currentFolder}"` : `Files inside "${currentFolder}"`)}
                        </h4>

                        {currentFolder !== "" && (
                          <button
                            onClick={() => setCurrentFolder("")}
                            className="text-brand-600 hover:text-brand-700 text-xs font-bold flex items-center gap-1 hover:underline cursor-pointer"
                          >
                            <ArrowLeft size={12} /> {locale === "pt" ? "Voltar para Raiz" : "Back to Root"}
                          </button>
                        )}
                      </div>

                      {/* Files grid */}
                      <div className="flex-1 overflow-y-auto pr-1">
                        {(() => {
                          const { real: realDocs, virtual: virtualDocs } = getFilesForFolder(currentFolder);
                          const totalFiles = realDocs.length + virtualDocs.length;

                          if (totalFiles === 0) {
                            return (
                              <div className="text-center py-16 bg-white border border-slate-200 border-dashed rounded-xl flex flex-col items-center justify-center">
                                <HardDrive className="text-slate-300 mb-2" size={32} />
                                <p className="text-xs font-semibold text-slate-500 font-mono uppercase">
                                  {locale === "pt" ? "Nenhum arquivo neste diretório" : "No files in this directory"}
                                </p>
                                <p className="text-[11px] text-slate-400 max-w-xs mt-1 text-center">
                                  {locale === "pt"
                                    ? "Adicione novos arquivos arrastando-os para a barra lateral ou crie um documento de texto virtual!"
                                    : "Add new files by dragging them to the sidebar, or create a virtual text document here!"}
                                </p>
                              </div>
                            );
                          }

                          return (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

                              {/* Virtual files list */}
                              {virtualDocs.map(file => (
                                <div
                                  key={file.id}
                                  className="bg-white border border-slate-200 hover:border-brand-500 rounded-xl p-4 flex flex-col justify-between min-h-[120px] transition-all group relative"
                                >
                                  <div className="flex justify-between items-start gap-2">
                                    <div className="flex items-start gap-2.5 min-w-0">
                                      <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center font-mono text-[9px] font-bold border border-brand-100 shrink-0">
                                        MD
                                      </div>
                                      <div className="leading-tight min-w-0">
                                        {editingFileNameId === file.id ? (
                                          <input
                                            type="text"
                                            value={editingFileNameValue}
                                            onChange={(e) => setEditingFileNameValue(e.target.value)}
                                            className="text-xs font-bold text-slate-800 p-0.5 border border-brand-500 rounded focus:outline-none w-full"
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") {
                                                if (!editingFileNameValue.trim()) return;
                                                const updated = virtualFiles.map(vf => vf.id === file.id ? { ...vf, name: editingFileNameValue.trim(), updatedAt: new Date().toISOString() } : vf);
                                                saveVirtualFilesToStorage(updated);
                                                setEditingFileNameId(null);
                                              }
                                            }}
                                            autoFocus
                                          />
                                        ) : (
                                          <p className="text-xs font-bold text-slate-800 truncate" title={file.name}>
                                            {file.name}
                                          </p>
                                        )}
                                        <span className="text-[9px] font-mono text-slate-400 font-bold block mt-1 uppercase tracking-wider bg-slate-100 px-1 rounded inline-block">
                                          {locale === "pt" ? "Texto Virtual" : "Virtual Text"}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Quick Actions Menu */}
                                    <div className="flex items-center gap-0.5 shrink-0">
                                      <button
                                        onClick={() => {
                                          setEditingFileNameId(file.id);
                                          setEditingFileNameValue(file.name);
                                        }}
                                        className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100 cursor-pointer"
                                        title={locale === "pt" ? "Renomear" : "Rename"}
                                      >
                                        <PenLine size={11} />
                                      </button>
                                      <button
                                        onClick={() => setShowMoveFileModal({ type: "virtual", item: file })}
                                        className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100 cursor-pointer"
                                        title={locale === "pt" ? "Mover de Pasta" : "Move Folder"}
                                      >
                                        <FolderOpen size={11} />
                                      </button>
                                      <button
                                        onClick={() => {
                                          if (confirm(locale === "pt" ? `Excluir o arquivo virtual "${file.name}"?` : `Delete virtual file "${file.name}"?`)) {
                                            saveVirtualFilesToStorage(virtualFiles.filter(vf => vf.id !== file.id));
                                          }
                                        }}
                                        className="text-slate-400 hover:text-danger-500 p-1 rounded hover:bg-slate-100 cursor-pointer"
                                        title={locale === "pt" ? "Excluir" : "Delete"}
                                      >
                                        <Trash2 size={11} />
                                      </button>
                                    </div>
                                  </div>

                                  <div className="border-t border-slate-100 pt-3 mt-3 flex justify-between items-center text-[10px] text-slate-400 font-mono">
                                    <span>{file.size} bytes</span>
                                    <button
                                      onClick={() => setActiveFileViewer(file)}
                                      className="text-brand-600 hover:text-white hover:bg-brand-600 border border-brand-200 px-2.5 py-1 rounded-lg font-bold font-mono transition-all cursor-pointer"
                                    >
                                      {locale === "pt" ? "PREVIEW / EDIT" : "PREVIEW / EDIT"}
                                    </button>
                                  </div>
                                </div>
                              ))}

                              {/* Real documents list */}
                              {realDocs.map(doc => {
                                const tag = getDocTag(doc.original_filename);
                                return (
                                  <div
                                    key={doc.id}
                                    className="bg-white border border-slate-200 hover:border-brand-500 rounded-xl p-4 flex flex-col justify-between min-h-[120px] transition-all group relative"
                                  >
                                    <div className="flex justify-between items-start gap-2">
                                      <div className="flex items-start gap-2.5 min-w-0">
                                        <div className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center font-mono text-[9px] font-bold rounded ${tag.style}`}>
                                          {tag.label}
                                        </div>
                                        <div className="leading-tight min-w-0">
                                          {editingFileNameId === doc.id ? (
                                            <input
                                              type="text"
                                              value={editingFileNameValue}
                                              onChange={(e) => setEditingFileNameValue(e.target.value)}
                                              className="text-xs font-bold text-slate-800 p-0.5 border border-brand-500 rounded focus:outline-none w-full"
                                              onKeyDown={async (e) => {
                                                if (e.key === "Enter") {
                                                  const newName = editingFileNameValue.trim();
                                                  if (!newName) return;

                                                  try {
                                                    const res = await fetch(`/api/documents/${doc.id}/rename`, {
                                                      method: "PUT",
                                                      headers: { "Content-Type": "application/json" },
                                                      body: JSON.stringify({ original_filename: newName })
                                                    });
                                                    if (res.ok) {
                                                      const updated = await res.json();
                                                      setDocuments(documents.map(d => d.id === doc.id ? updated : d));
                                                    } else {
                                                      alert(locale === "pt" ? "Não foi possível renomear o documento." : "Could not rename the document.");
                                                    }
                                                  } catch (err) {
                                                    console.error(err);
                                                    alert(locale === "pt" ? "Erro ao renomear o documento." : "Error renaming the document.");
                                                  }

                                                  setEditingFileNameId(null);
                                                }
                                              }}
                                              autoFocus
                                            />
                                          ) : (
                                            <p className="text-xs font-bold text-slate-800 truncate" title={doc.original_filename}>
                                              {doc.original_filename}
                                            </p>
                                          )}
                                          <span className="text-[9px] font-mono text-slate-400 font-bold block mt-1 uppercase tracking-wider">
                                            {doc.manual_document_type || doc.detected_document_type}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Quick Actions Menu */}
                                      <div className="flex items-center gap-0.5 shrink-0">
                                        <button
                                          onClick={() => {
                                            setEditingFileNameId(doc.id);
                                            setEditingFileNameValue(doc.original_filename);
                                          }}
                                          className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100 cursor-pointer"
                                          title={locale === "pt" ? "Renomear" : "Rename"}
                                        >
                                          <PenLine size={11} />
                                        </button>
                                        <button
                                          onClick={() => setShowMoveFileModal({ type: "real", item: doc })}
                                          className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100 cursor-pointer"
                                          title={locale === "pt" ? "Mover de Pasta" : "Move Folder"}
                                        >
                                          <FolderOpen size={11} />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteDocument(doc.id)}
                                          className="text-slate-400 hover:text-danger-500 p-1 rounded hover:bg-slate-100 cursor-pointer"
                                          title={locale === "pt" ? "Excluir" : "Delete"}
                                        >
                                          <Trash2 size={11} />
                                        </button>
                                      </div>
                                    </div>

                                    <div className="border-t border-slate-100 pt-3 mt-3 flex justify-between items-center text-[10px] text-slate-400 font-mono">
                                      <span>{(doc.file_size / 1024).toFixed(1)} KB</span>
                                      <button
                                        onClick={async () => {
                                          try {
                                            const res = await fetch(`/api/documents/${doc.id}/content`);
                                            const data = await res.json();

                                            if (!res.ok || !data.success) {
                                              alert(data.message || (locale === "pt" ? "Não foi possível carregar o conteúdo extraído." : "Could not load extracted content."));
                                              return;
                                            }

                                            setActiveFileViewer({
                                              id: doc.id,
                                              name: doc.original_filename,
                                              isRealDoc: true,
                                              content: `[Informação do Arquivo]
Nome Original: ${doc.original_filename}
Tipo Classificado: ${doc.manual_document_type || doc.detected_document_type}
Provedor de Armazenamento: ${doc.storage_provider.toUpperCase()}
Caminho no Storage: ${doc.storage_path}
Tamanho: ${doc.file_size} bytes
Enviado por: ${doc.uploaded_by}
Criado em: ${new Date(doc.created_at).toLocaleString()}
Idioma: ${doc.language}
Versão: ${doc.version}
Caracteres Extraídos: ${data.content_length}
Conteúdo Truncado: ${data.truncated ? "sim" : "não"}

--------------------------------------------------
CONTEÚDO EXTRAÍDO
--------------------------------------------------
${data.content_preview || "[Sem conteúdo textual extraído]"}`
                                            });
                                          } catch (err) {
                                            console.error(err);
                                            alert(locale === "pt" ? "Erro ao abrir documento." : "Error opening document.");
                                          }
                                        }}
                                        className="text-slate-700 hover:text-brand-700 hover:bg-brand-50 border border-slate-200 hover:border-brand-200 px-2.5 py-1 rounded-lg font-bold font-mono transition-all cursor-pointer"
                                      >
                                        {locale === "pt" ? "REVISAR META" : "VIEW META"}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}

                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* VIRTUAL FILE EDITOR DIALOG / MODAL */}
                    {activeFileViewer && (
                      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full flex flex-col max-h-[85vh]">
                          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-2xl">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center font-bold text-xs font-mono">
                                {activeFileViewer.isRealDoc ? "R" : "V"}
                              </div>
                              <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800 max-w-sm truncate" title={activeFileViewer.name}>
                                {activeFileViewer.name}
                              </h3>
                            </div>
                            <button
                              onClick={() => setActiveFileViewer(null)}
                              className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-200 cursor-pointer"
                            >
                              <X size={16} />
                            </button>
                          </div>

                          <div className="flex-1 p-5 overflow-y-auto leading-relaxed text-xs">
                            {activeFileViewer.isRealDoc ? (
                              <pre className="font-mono bg-slate-50 p-4 rounded-lg border border-slate-100 text-[11px] whitespace-pre-wrap text-slate-600 leading-normal">
                                {activeFileViewer.content}
                              </pre>
                            ) : (
                              <div className="space-y-4">
                                <p className="text-slate-400 italic">
                                  {locale === "pt" ? "Você pode editar o conteúdo do arquivo de texto virtual abaixo:" : "You can edit the content of your virtual text file below:"}
                                </p>
                                <textarea
                                  value={activeFileViewer.content}
                                  onChange={(e) => {
                                    const updatedContent = e.target.value;
                                    // Update state
                                    const updated = virtualFiles.map(vf => vf.id === activeFileViewer.id ? { ...vf, content: updatedContent, size: updatedContent.length, updatedAt: new Date().toISOString() } : vf);
                                    saveVirtualFilesToStorage(updated);
                                    // Update modal
                                    setActiveFileViewer({ ...activeFileViewer, content: updatedContent });
                                  }}
                                  className="w-full h-80 p-3 font-mono text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500 bg-slate-50"
                                />
                              </div>
                            )}
                          </div>

                          <div className="p-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
                            <button
                              onClick={() => setActiveFileViewer(null)}
                              className="bg-brand-600 hover:bg-brand-700 text-white font-mono text-xs font-bold py-2 px-4 rounded-lg shadow cursor-pointer"
                            >
                              {locale === "pt" ? "FECHAR" : "CLOSE"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* CREATE VIRTUAL FILE DIALOG / MODAL */}
                    {showCreateFileModal && (
                      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full flex flex-col">
                          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-2xl">
                            <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800">
                              {locale === "pt" ? "Criar Novo Documento de Texto" : "Create New Text Document"}
                            </h3>
                            <button
                              onClick={() => setShowCreateFileModal(false)}
                              className="text-slate-400 hover:text-slate-700 cursor-pointer"
                            >
                              <X size={16} />
                            </button>
                          </div>

                          <div className="p-5 space-y-4 text-xs">
                            <div className="space-y-1">
                              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block">
                                {locale === "pt" ? "Nome do Arquivo" : "File Name"}
                              </label>
                              <input
                                type="text"
                                placeholder="Ex: notas_reuniao.md"
                                value={newFileName}
                                onChange={(e) => setNewFileName(e.target.value)}
                                className="w-full p-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500"
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block">
                                {locale === "pt" ? "Conteúdo Inicial" : "Initial Content"}
                              </label>
                              <textarea
                                placeholder={locale === "pt" ? "Escreva aqui as anotações..." : "Write your technical notes here..."}
                                value={newFileContent}
                                onChange={(e) => setNewFileContent(e.target.value)}
                                className="w-full h-40 p-2 font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500"
                              />
                            </div>
                          </div>

                          <div className="p-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
                            <button
                              onClick={() => setShowCreateFileModal(false)}
                              className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-mono text-[10px] font-bold py-1.5 px-3 rounded cursor-pointer"
                            >
                              {locale === "pt" ? "Cancelar" : "Cancel"}
                            </button>
                            <button
                              onClick={() => {
                                if (!newFileName.trim()) return;
                                const fileWithExt = newFileName.includes('.') ? newFileName : `${newFileName}.md`;
                                const newVirtual = {
                                  id: Date.now().toString(),
                                  name: fileWithExt.trim(),
                                  content: newFileContent,
                                  folder: currentFolder,
                                  mime_type: "text/markdown",
                                  size: newFileContent.length,
                                  updatedAt: new Date().toISOString()
                                };
                                saveVirtualFilesToStorage([...virtualFiles, newVirtual]);
                                setShowCreateFileModal(false);
                              }}
                              className="bg-brand-600 hover:bg-brand-700 text-white font-mono text-[10px] font-bold py-1.5 px-4 rounded shadow cursor-pointer"
                            >
                              {locale === "pt" ? "Criar Documento" : "Create File"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* MOVE FILE DIALOG / MODAL */}
                    {showMoveFileModal && (
                      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-xs w-full flex flex-col">
                          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-2xl">
                            <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800">
                              {locale === "pt" ? "Mover Arquivo de Pasta" : "Move File Directory"}
                            </h3>
                            <button
                              onClick={() => setShowMoveFileModal(null)}
                              className="text-slate-400 hover:text-slate-700 cursor-pointer"
                            >
                              <X size={16} />
                            </button>
                          </div>

                          <div className="p-5 text-xs space-y-3">
                            <p className="text-slate-500">
                              {locale === "pt"
                                ? `Selecione o diretório destino para o arquivo "${showMoveFileModal.item.name || showMoveFileModal.item.original_filename}":`
                                : `Select destination directory for file "${showMoveFileModal.item.name || showMoveFileModal.item.original_filename}":`}
                            </p>

                            <select
                              defaultValue={showMoveFileModal.type === "virtual" ? showMoveFileModal.item.folder : (docFolderMapping[showMoveFileModal.item.id] || "")}
                              onChange={(e) => {
                                const targetFold = e.target.value;
                                if (showMoveFileModal.type === "virtual") {
                                  const updated = virtualFiles.map(vf => vf.id === showMoveFileModal.item.id ? { ...vf, folder: targetFold } : vf);
                                  saveVirtualFilesToStorage(updated);
                                } else {
                                  const updated = { ...docFolderMapping, [showMoveFileModal.item.id]: targetFold };
                                  saveDocMappingsToStorage(updated);
                                }
                                setShowMoveFileModal(null);
                              }}
                              className="w-full p-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 bg-slate-50"
                            >
                              <option value="">📂 {locale === "pt" ? "Raiz do Projeto" : "Project Root"}</option>
                              {projectFolders.map(folder => (
                                <option key={folder} value={folder}>📂 {folder}</option>
                              ))}
                            </select>
                          </div>

                          <div className="p-4 border-t border-slate-100 flex justify-end bg-slate-50 rounded-b-2xl">
                            <button
                              onClick={() => setShowMoveFileModal(null)}
                              className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-mono text-[10px] font-bold py-1.5 px-3 rounded cursor-pointer"
                            >
                              {locale === "pt" ? "Cancelar" : "Cancel"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                  </div>
                )}

              </div>

              {/* Right Column of Workspace (Technical Q&A / Clarification List) */}
              <div className={`${rightPanelCollapsed ? "w-10 p-2" : "w-96 p-4"} bg-slate-50 rounded-xl border border-slate-200 flex flex-col min-h-0 shrink-0 shadow-sm transition-[width] duration-150`}>

                {/* Retract/expand toggle - always visible, same pattern as the left panel. */}
                <button
                  onClick={() => setRightPanelCollapsed((v) => !v)}
                  className="flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded p-1 self-start shrink-0 mb-2"
                  title={rightPanelCollapsed ? (locale === "pt" ? "Expandir painel" : "Expand panel") : (locale === "pt" ? "Recolher painel" : "Collapse panel")}
                  aria-label={rightPanelCollapsed ? "Expand panel" : "Collapse panel"}
                >
                  {rightPanelCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
                </button>

                {!rightPanelCollapsed && (
                <>
                {/* Section 1: Dynamic QA List extracted - now the main content of this column
                    (the copilot below is just a small floating trigger), since clarification
                    questions are the more important thing to see at a glance. */}
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold font-mono">
                      Perguntas de Esclarecimento Urgentes ({displayAnalysisResult?.clarification_questions.length || 0})
                    </h3>
                    {displayAnalysisResult && displayAnalysisResult.clarification_questions.length > 0 && (
                      <button
                        onClick={handleExportClarificationQuestions}
                        disabled={exportingQuestions}
                        className="text-[10px] font-bold text-brand-700 hover:text-brand-800 uppercase font-mono disabled:opacity-50 cursor-pointer"
                      >
                        {exportingQuestions ? "Exportando..." : "Exportar (DOCX)"}
                      </button>
                    )}
                  </div>

                  {!displayAnalysisResult ? (
                    <div className="text-xs text-slate-400 italic bg-white p-4 rounded border border-slate-200 text-center shadow-sm">
                      Aguardando avaliação de conformidade para sinalizar lacunas e dúvidas.
                    </div>
                  ) : (
                    <div className="space-y-2 flex-1 overflow-y-auto pr-1">
                      {displayAnalysisResult.clarification_questions.map((q, idx) => (
                        <div key={idx} className="p-3 bg-white border-l-4 border-warning-400 rounded shadow-sm">
                          <p className="text-xs font-bold text-slate-800 leading-tight mb-1">{q.question}</p>
                          <p className="text-[11px] text-slate-500 leading-relaxed font-mono">Motivo: {q.reason}</p>
                          {q.source_reference && (
                            <p className="text-[11px] text-slate-400 leading-relaxed font-mono">Ref.: {q.source_reference}</p>
                          )}
                          <div className="flex justify-between items-center text-[9px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-100 font-mono">
                            <span className="uppercase font-bold text-warning-700">Prioridade {q.priority === "high" ? "Alta" : q.priority === "medium" ? "Média" : "Baixa"}</span>
                            <span className="text-slate-500 font-semibold">{q.target_audience}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Section 2: Copilot trigger - was a fixed-height chat panel always taking up
                    half this column; now a small button that opens the chat as a modal, freeing
                    the space for clarification questions (the more important content here). */}
                <button
                  onClick={() => setShowCopilotChat(true)}
                  className="mt-3 flex items-center justify-center gap-2 bg-white hover:bg-brand-50 border border-slate-200 hover:border-brand-200 rounded-lg shadow-sm py-2.5 transition-colors cursor-pointer shrink-0"
                >
                  <MessageSquare size={15} className="text-brand-600" />
                  <span className="text-xs font-bold text-slate-700 font-mono">Copiloto de Especificações</span>
                  {chatHistory.length > 0 && (
                    <span className="text-[9px] bg-brand-100 text-brand-800 rounded-full px-1.5 font-bold">{chatHistory.length}</span>
                  )}
                </button>
                </>
                )}

              </div>

              {showCopilotChat && (
                <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg h-[70vh] flex flex-col">
                    <div className="flex items-center justify-between p-4 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <MessageSquare size={16} className="text-brand-600" />
                        <span className="text-xs font-bold uppercase tracking-wider font-mono text-slate-700">Copiloto de Especificações de Pré-Vendas</span>
                      </div>
                      <button onClick={() => setShowCopilotChat(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                        <X size={18} />
                      </button>
                    </div>

                    {/* Messages Feed */}
                    <div className="flex-1 overflow-y-auto space-y-2 p-4 text-[11px] leading-relaxed">
                      {chatHistory.length === 0 && (
                        <p className="text-center text-slate-400 italic text-xs mt-6">Pergunte sobre as especificações deste projeto.</p>
                      )}
                      {chatHistory.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                          <div className={`p-2.5 rounded-lg max-w-[85%] border shadow-sm ${
                            msg.role === "user" ? "bg-slate-100 text-slate-800 border-slate-200" : "bg-brand-50 text-slate-800 border-brand-100"
                          }`}>
                            <span className="font-mono text-[9px] text-slate-400 block uppercase mb-0.5">
                              {msg.role === "user" ? "Você" : "Assistente AI"}
                            </span>
                            <div className="leading-normal">{renderChatMarkdown(msg.message)}</div>
                          </div>
                        </div>
                      ))}
                      {isChatSending && (
                        <div className="flex justify-start">
                          <div className="p-2.5 rounded-lg bg-brand-50 border border-brand-100 shadow-sm">
                            <span className="font-mono text-[9px] text-slate-400 block uppercase mb-0.5">Assistente AI</span>
                            <span className="flex items-center gap-1 py-0.5">
                              <span className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></span>
                              <span className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></span>
                              <span className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></span>
                            </span>
                          </div>
                        </div>
                      )}
                      <div ref={chatMessagesEndRef} />
                    </div>

                    {/* Message Input Form */}
                    <form onSubmit={handleSendChatMessage} className="flex gap-1 p-3 border-t border-slate-100">
                      <input
                        type="text"
                        value={chatMessage}
                        onChange={(e) => setChatMessage(e.target.value)}
                        disabled={isChatSending}
                        placeholder="Pergunte sobre as especificações deste projeto..."
                        className="flex-1 text-xs px-3 py-1.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 bg-slate-50 disabled:opacity-60"
                        autoFocus
                      />
                      <button
                        type="submit"
                        disabled={isChatSending}
                        className="bg-brand-600 hover:bg-brand-700 text-white font-mono font-bold text-xs px-3 rounded shadow-sm transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isChatSending ? "..." : "ENVIAR"}
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>
    </>
  );
}
