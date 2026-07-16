import { Dispatch, SetStateAction } from "react";
import { AnalysisResult, Document, PricingRow } from "../types";
import { BackgroundTask } from "./useBackgroundTasks";
import { PROPOSAL_TYPE_LABELS, ProposalTypeValue } from "../../server/utils/proposalTypes";

interface UseWorkspaceParams {
  locale: string;
  tx: (en: string, pt: string) => string;
  hasPermission: (perm: string) => boolean;
  selectedProjectId: string;
  analysisResult: AnalysisResult | null;
  setAnalysisResult: Dispatch<SetStateAction<AnalysisResult | null>>;
  fetchGlobalConfigs: () => Promise<void> | void;
  fetchProjectDetails: (projectId: string) => Promise<void> | void;
  setActiveTab: (tab: "home" | "workspace" | "projectsList" | "proposals" | "approval" | "knowledgeBase" | "admin") => void;
  waitForTask: (taskId: string) => Promise<BackgroundTask>;
  proposalTemplates: any[];
  selectedTemplateIdByType: Record<string, string>;
  documents: Document[];
  projectFolders: string[];
  setProjectFolders: (folders: string[]) => void;
  docFolderMapping: Record<string, string>;
  setDocFolderMapping: (mapping: Record<string, string>) => void;
  virtualFiles: any[];
  setVirtualFiles: (files: any[]) => void;
  chatMessage: string;
  setChatMessage: (msg: string) => void;
  setChatHistory: Dispatch<SetStateAction<{ role: string; message: string }[]>>;
  setIsChatSending: (sending: boolean) => void;
}

// Handlers exclusive to the Workspace tab (analysis results editing, technical/commercial
// proposal generation kickoff, spec discussion chat, and the file-explorer's folder helpers).
export function useWorkspace(params: UseWorkspaceParams) {
  const {
    locale, tx, hasPermission, selectedProjectId, analysisResult, setAnalysisResult,
    fetchGlobalConfigs, fetchProjectDetails, setActiveTab, waitForTask,
    proposalTemplates, selectedTemplateIdByType,
    documents, setProjectFolders, docFolderMapping, setDocFolderMapping,
    virtualFiles, setVirtualFiles,
    chatMessage, setChatMessage, setChatHistory, setIsChatSending,
  } = params;

  const handleUpdateRequirement = async (reqId: string, status: any, notes: string) => {
    if (!analysisResult) return;
    const updatedReqs = analysisResult.critical_requirements.map(r => {
      if (r.requirement_id === reqId) {
        return { ...r, compliance_status: status, notes };
      }
      return r;
    });

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/analysis-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ critical_requirements: updatedReqs })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.message || (locale === "pt" ? "Não foi possível salvar o status do requisito." : "Could not save the requirement status."));
        return;
      }
      const { result: updatedResult } = await res.json();
      setAnalysisResult(updatedResult);
      fetchGlobalConfigs();
    } catch (e) {
      console.error(e);
      alert(locale === "pt" ? "Erro ao salvar o status do requisito." : "Error saving the requirement status.");
    }
  };

  const handleUpdateRisk = async (riskId: string, mitigation: string, requiresClarification: boolean) => {
    if (!analysisResult) return;
    const updatedRisks = analysisResult.risks.map(r => {
      if (r.risk_id === riskId) {
        return { ...r, mitigation, requires_customer_clarification: requiresClarification };
      }
      return r;
    });

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/analysis-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ risks: updatedRisks })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.message || (locale === "pt" ? "Não foi possível salvar a mitigação do risco." : "Could not save the risk mitigation."));
        return;
      }
      const { result: updatedResult } = await res.json();
      setAnalysisResult(updatedResult);
      fetchGlobalConfigs();
    } catch (e) {
      console.error(e);
      alert(locale === "pt" ? "Erro ao salvar a mitigação do risco." : "Error saving the risk mitigation.");
    }
  };

  // Single generic generator for all 7 proposal types (see server/utils/proposalTypes.ts) -
  // replaces what used to be a separate handleGenerateTechnicalProposal/
  // handleGenerateCommercialProposal pair. Commercial pricing only makes sense for the types that
  // actually include commercial content (commercial itself, and technical_commercial which fuses
  // both) - the other 5 (technical + the 4 report types) skip the pricing table and commercial
  // terms entirely.
  const includesCommercialContent = (proposalType: ProposalTypeValue) =>
    proposalType === "commercial" || proposalType === "technical_commercial";

  const handleGenerateProposal = async (proposalType: ProposalTypeValue) => {
    if (!hasPermission("proposal:generate")) {
      alert(locale === "pt" ? "Você não tem permissão para gerar propostas." : "You do not have permission to generate proposals.");
      return;
    }

    if (!selectedProjectId) return;

    const templateId = selectedTemplateIdByType[proposalType]
      || proposalTemplates.find((tpl: any) => tpl.template_type === proposalType && tpl.default_template && tpl.active)?.id
      || proposalTemplates.find((tpl: any) => tpl.template_type === proposalType && tpl.active)?.id;

    if (!templateId) {
      const label = PROPOSAL_TYPE_LABELS[proposalType];
      alert(locale === "pt" ? `Nenhum template ativo do tipo "${label}" foi encontrado.` : `No active "${label}" template was found.`);
      return;
    }

    const body: Record<string, unknown> = {
      template_id: templateId,
      language: locale === "pt" ? "Portuguese" : "English",
    };

    if (includesCommercialContent(proposalType)) {
      // unit_price starts at 0 rather than a guessed number - the BOM has no real pricing source
      // (no supplier catalog/price API integration exists yet), so a fake heuristic price would
      // look precise while being meaningless for any equipment outside the two demo product names
      // (ALPR camera, "Switch") it used to special-case. 0 makes it obvious this needs a real
      // quote before the proposal goes out, and the price cell is already editable inline.
      const pricingRows: PricingRow[] = (analysisResult?.bom || []).map(b => ({
        item_id: b.item_id,
        product_or_service: b.equipment_name,
        specification: b.specification || "",
        quantity: b.quantity,
        unit: b.unit,
        unit_price: 0,
        total_price: 0,
        currency: "USD",
        is_optional: false,
        discount: 0
      }));
      body.manual_pricing_table = pricingRows;
      body.payment_terms = "30% mobilização, 40% entrega de hardware no local, 30% aceite final.";
      body.delivery_terms = "DDP Local do Cliente (Incoterms 2026)";
      body.proposal_validity = "90 dias de validade a contar de hoje";
      body.commercial_assumptions = "Valores estimados com base no BOM técnico preliminar gerado pela análise.";
      body.exclusions = "Infraestrutura civil de dutos ou permissões públicas regionais.";
    } else {
      body.payment_terms = locale === "pt" ? "30 dias líquidos" : "Net 30";
      body.delivery_terms = locale === "pt" ? "Entrega após aprovação técnica" : "Delivery after technical approval";
      body.proposal_validity = locale === "pt" ? "90 dias" : "90 days";
    }

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/proposals/${proposalType}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Failed to generate proposal.");
      }

      const finished = await waitForTask(data.task_id);
      if (finished.status === "failed") {
        throw new Error(finished.error_message || "Failed to generate proposal.");
      }

      await fetchProjectDetails(selectedProjectId);
      fetchGlobalConfigs();
      setActiveTab("proposals");
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim() || !selectedProjectId) return;

    const userMsg = chatMessage;
    setChatHistory(prev => [...prev, { role: "user", message: userMsg }]);
    setChatMessage("");
    setIsChatSending(true);

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg })
      });
      const data = await res.json();

      setChatHistory(prev => [...prev, {
        role: "model",
        message: res.ok ? data.answer : (data.message || tx("Sorry, I couldn't process that question.", "Desculpe, não consegui processar essa pergunta."))
      }]);
    } catch (err) {
      console.error(err);
      setChatHistory(prev => [...prev, {
        role: "model",
        message: tx("Sorry, I couldn't reach the assistant right now.", "Desculpe, não consegui contatar o assistente agora.")
      }]);
    } finally {
      setIsChatSending(false);
    }
  };

  const saveFoldersToStorage = (updated: string[]) => {
    setProjectFolders(updated);
    if (selectedProjectId) {
      localStorage.setItem(`folders_${selectedProjectId}`, JSON.stringify(updated));
    }
  };

  const saveVirtualFilesToStorage = (updated: any[]) => {
    setVirtualFiles(updated);
    if (selectedProjectId) {
      localStorage.setItem(`virtual_files_${selectedProjectId}`, JSON.stringify(updated));
    }
  };

  const saveDocMappingsToStorage = (updated: Record<string, string>) => {
    setDocFolderMapping(updated);
    if (selectedProjectId) {
      localStorage.setItem(`doc_mappings_${selectedProjectId}`, JSON.stringify(updated));
    }
  };

  const getFilesForFolder = (folderName: string) => {
    const realDocsInFolder = documents.filter(doc => {
      const assigned = docFolderMapping[doc.id];
      if (assigned !== undefined && assigned !== null) {
        return assigned === folderName;
      }
      const ext = doc.original_filename.split('.').pop()?.toLowerCase();
      if (folderName === "Especificações" && ext === "pdf") return true;
      if (folderName === "Planilhas Financeiras" && (ext === "xlsx" || ext === "xls" || ext === "csv")) return true;
      if (folderName === "Desenhos CAD" && (ext === "dwg" || ext === "dxf" || ext === "cad")) return true;
      if (folderName === "Propostas e Minutas" && (ext === "docx" || ext === "doc")) return true;

      if (folderName === "") {
        const fitsAnyFolder = ["pdf", "xlsx", "xls", "csv", "dwg", "dxf", "cad", "docx", "doc"].includes(ext || "");
        return !fitsAnyFolder;
      }
      return false;
    });

    const virtualInFolder = virtualFiles.filter(vf => vf.folder === folderName);

    return {
      real: realDocsInFolder,
      virtual: virtualInFolder
    };
  };

  return {
    handleUpdateRequirement,
    handleUpdateRisk,
    handleGenerateProposal,
    handleSendChatMessage,
    saveFoldersToStorage,
    saveVirtualFilesToStorage,
    saveDocMappingsToStorage,
    getFilesForFolder,
  };
}
