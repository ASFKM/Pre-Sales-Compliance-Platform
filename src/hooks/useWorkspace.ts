import { Dispatch, SetStateAction } from "react";
import { AnalysisResult, Document, PricingRow } from "../types";
import { BackgroundTask } from "./useBackgroundTasks";

interface UseWorkspaceParams {
  locale: string;
  tx: (en: string, pt: string) => string;
  hasPermission: (perm: string) => boolean;
  selectedProjectId: string;
  analysisResult: AnalysisResult | null;
  setAnalysisResult: Dispatch<SetStateAction<AnalysisResult | null>>;
  fetchGlobalConfigs: () => Promise<void> | void;
  fetchProjectDetails: (projectId: string) => Promise<void> | void;
  setActiveTab: (tab: "home" | "workspace" | "proposals" | "templates" | "approval" | "admin") => void;
  waitForTask: (taskId: string) => Promise<BackgroundTask>;
  proposalTemplates: any[];
  selectedTechnicalTemplateId: string;
  selectedCommercialTemplateId: string;
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
    proposalTemplates, selectedTechnicalTemplateId, selectedCommercialTemplateId,
    documents, projectFolders, setProjectFolders, docFolderMapping, setDocFolderMapping,
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
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ critical_requirements: updatedReqs })
      });
      if (res.ok) {
        const updatedResult = await res.json();
        setAnalysisResult(updatedResult);
        fetchGlobalConfigs();
      }
    } catch (e) {
      console.error(e);
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
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ risks: updatedRisks })
      });
      if (res.ok) {
        const updatedResult = await res.json();
        setAnalysisResult(updatedResult);
        fetchGlobalConfigs();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateBOM = async (itemId: string, quantity: number) => {
    if (!analysisResult) return;
    const updatedBOM = analysisResult.bom.map(item => {
      if (item.item_id === itemId) {
        return { ...item, quantity };
      }
      return item;
    });

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/analysis-result`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bom: updatedBOM })
      });
      if (res.ok) {
        const updatedResult = await res.json();
        setAnalysisResult(updatedResult);
        fetchGlobalConfigs();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleGenerateTechnicalProposal = async () => {
    if (!hasPermission("proposal:generate")) {
      alert(locale === "pt" ? "Você não tem permissão para gerar propostas." : "You do not have permission to generate proposals.");
      return;
    }

    if (!selectedProjectId) return;

    const templateId = selectedTechnicalTemplateId
      || proposalTemplates.find((tpl: any) => tpl.template_type === "technical" && tpl.default_template && tpl.active)?.id
      || proposalTemplates.find((tpl: any) => tpl.template_type === "technical" && tpl.active)?.id;

    if (!templateId) {
      alert(locale === "pt" ? "Nenhum template técnico ativo foi encontrado." : "No active technical template was found.");
      return;
    }

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/proposals/technical`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: templateId,
          language: locale === "pt" ? "Portuguese" : "English",
          payment_terms: "Net 30",
          delivery_terms: "Delivery after technical approval",
          proposal_validity: "90 days"
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Failed to generate technical proposal.");
      }

      const finished = await waitForTask(data.task_id);
      if (finished.status === "failed") {
        throw new Error(finished.error_message || "Failed to generate technical proposal.");
      }

      await fetchProjectDetails(selectedProjectId);
      fetchGlobalConfigs();
      setActiveTab("proposals");
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleGenerateCommercialProposal = async () => {
    if (!hasPermission("proposal:generate")) {
      alert(locale === "pt" ? "Você não tem permissão para gerar propostas." : "You do not have permission to generate proposals.");
      return;
    }

    if (!selectedProjectId) return;

    const templateId = selectedCommercialTemplateId
      || proposalTemplates.find((tpl: any) => tpl.template_type === "commercial" && tpl.default_template && tpl.active)?.id
      || proposalTemplates.find((tpl: any) => tpl.template_type === "commercial" && tpl.active)?.id;

    if (!templateId) {
      alert(locale === "pt" ? "Nenhum template comercial ativo foi encontrado." : "No active commercial template was found.");
      return;
    }

    const pricingRows: PricingRow[] = (analysisResult?.bom || []).map(b => {
      const unitPrice = b.equipment_name.includes("ALPR") ? 1850 : (b.equipment_name.includes("Switch") ? 420 : 350);

      return {
        item_id: b.item_id,
        product_or_service: b.equipment_name,
        quantity: b.quantity,
        unit: b.unit,
        unit_price: unitPrice,
        total_price: b.quantity * unitPrice,
        currency: "USD",
        is_optional: false,
        discount: 10
      };
    });

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/proposals/commercial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: templateId,
          language: locale === "pt" ? "Portuguese" : "English",
          manual_pricing_table: pricingRows,
          payment_terms: "30% mobilização, 40% entrega de hardware no local, 30% aceite final.",
          delivery_terms: "DDP Local do Cliente (Incoterms 2026)",
          proposal_validity: "90 dias de validade a contar de hoje",
          commercial_assumptions: "Valores estimados com base no BOM técnico preliminar gerado pela análise.",
          exclusions: "Infraestrutura civil de dutos ou permissões públicas regionais."
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Failed to generate commercial proposal.");
      }

      const finished = await waitForTask(data.task_id);
      if (finished.status === "failed") {
        throw new Error(finished.error_message || "Failed to generate commercial proposal.");
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
    handleUpdateBOM,
    handleGenerateTechnicalProposal,
    handleGenerateCommercialProposal,
    handleSendChatMessage,
    saveFoldersToStorage,
    saveVirtualFilesToStorage,
    saveDocMappingsToStorage,
    getFilesForFolder,
  };
}
