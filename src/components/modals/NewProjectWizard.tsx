import { useState } from "react";
import { X, FileSpreadsheet, Trash2, Sparkles, ArrowLeft } from "lucide-react";
import { Project } from "../../types";
import { BackgroundTask } from "../../hooks/useBackgroundTasks";
import ProjectFieldsForm, { getInitialProjectFieldsValues, ProjectFieldsValues } from "./ProjectFieldsForm";
import CreateProjectModal from "./CreateProjectModal";

interface NewProjectWizardProps {
  locale: string;
  onClose: () => void;
  onCreated: (project: Project) => void;
  waitForTask: (taskId: string) => Promise<BackgroundTask>;
}

interface StagedFile {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
}

type Step = "upload" | "validate";

// Phase 4: "+ Nova Proposta" opens here first - upload documents, let the AI pre-fill the
// project form, then validate/confirm. The old direct-form flow (CreateProjectModal) is kept
// as a discreet fallback for prospecting stages with no documents yet.
export default function NewProjectWizard({ locale, onClose, onCreated, waitForTask }: NewProjectWizardProps) {
  const [showManualFallback, setShowManualFallback] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [sessionId, setSessionId] = useState<string>("");
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState("");
  const [error, setError] = useState("");
  const [fields, setFields] = useState<ProjectFieldsValues>(getInitialProjectFieldsValues);
  const [isConfirming, setIsConfirming] = useState(false);

  // Cleans up the staging session (and its uploaded files) the moment the user actually abandons
  // the flow, instead of leaving it to expire on its own via Redis TTL (2h) - not a real leak
  // either way, but no reason to wait.
  const handleCancel = () => {
    if (sessionId) {
      fetch(`/api/project-intake/${sessionId}`, { method: "DELETE" }).catch(() => {});
    }
    onClose();
  };

  const ensureSession = async (): Promise<string> => {
    if (sessionId) return sessionId;
    const res = await fetch("/api/project-intake", { method: "POST" });
    const data = await res.json();
    setSessionId(data.session.id);
    return data.session.id;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected || !selected.length) return;

    setError("");
    setIsUploading(true);
    try {
      const sid = await ensureSession();
      for (const file of Array.from(selected)) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(`/api/project-intake/${sid}/documents`, { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) {
          setError(data.message || (locale === "pt" ? "Falha ao enviar arquivo." : "Failed to upload file."));
          continue;
        }
        setFiles(data.session.files);
      }
    } catch (err) {
      console.error(err);
      setError(locale === "pt" ? "Erro inesperado ao enviar arquivos." : "Unexpected error uploading files.");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  const handleRemoveFile = async (fileId: string) => {
    if (!sessionId) return;
    const res = await fetch(`/api/project-intake/${sessionId}/documents/${fileId}`, { method: "DELETE" });
    const data = await res.json();
    if (res.ok) setFiles(data.session.files);
  };

  const handleAnalyze = async () => {
    if (!sessionId || !files.length) return;
    setError("");
    setIsAnalyzing(true);
    setAnalysisStep(locale === "pt" ? "Iniciando..." : "Starting...");
    try {
      const res = await fetch(`/api/project-intake/${sessionId}/analyze`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || (locale === "pt" ? "Não foi possível iniciar a análise." : "Could not start analysis."));
        setIsAnalyzing(false);
        return;
      }

      const finished = await waitForTask(data.task_id);
      if (finished.status === "failed") {
        setError(finished.error_message || (locale === "pt" ? "A análise de IA falhou. Você pode preencher os campos manualmente." : "AI analysis failed. You can fill the fields in manually."));
        setStep("validate");
        setIsAnalyzing(false);
        return;
      }

      const sessionRes = await fetch(`/api/project-intake/${sessionId}`);
      const sessionData = await sessionRes.json();
      if (sessionData.session?.suggested_fields) {
        setFields({ ...getInitialProjectFieldsValues(), ...sessionData.session.suggested_fields });
      }
      setStep("validate");
    } catch (err) {
      console.error(err);
      setError(locale === "pt" ? "Erro inesperado durante a análise." : "Unexpected error during analysis.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsConfirming(true);
    setError("");
    try {
      const res = await fetch(`/api/project-intake/${sessionId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || (locale === "pt" ? "Não foi possível criar o projeto." : "Could not create the project."));
        setIsConfirming(false);
        return;
      }
      onCreated(data);
      onClose();
    } catch (err) {
      console.error(err);
      setError(locale === "pt" ? "Erro inesperado ao confirmar." : "Unexpected error confirming.");
      setIsConfirming(false);
    }
  };

  if (showManualFallback) {
    return <CreateProjectModal locale={locale} onClose={onClose} onCreated={onCreated} />;
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl border border-slate-200 w-[600px] overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <div className="bg-slate-950 text-white p-4 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            {step === "validate" && (
              <button onClick={() => setStep("upload")} className="text-slate-400 hover:text-white cursor-pointer">
                <ArrowLeft size={16} />
              </button>
            )}
            <h3 className="text-sm font-bold uppercase font-mono tracking-wider">
              {step === "upload"
                ? (locale === "pt" ? "Nova Proposta: Enviar Documentos" : "New Bid: Upload Documents")
                : (locale === "pt" ? "Nova Proposta: Validar Dados" : "New Bid: Validate Details")}
            </h3>
          </div>
          <button onClick={handleCancel} className="text-slate-400 hover:text-white cursor-pointer"><X size={16} /></button>
        </div>

        {step === "upload" && (
          <div className="p-6 space-y-4 text-xs text-slate-700 overflow-y-auto flex-1">
            <p className="text-slate-500">
              {locale === "pt"
                ? "Envie os documentos do edital ou da licitação. A IA vai analisar o conteúdo e pré-preencher os dados do projeto para você revisar."
                : "Upload the tender or bid documents. The AI will analyze the content and pre-fill the project details for you to review."}
            </p>

            <div className="relative border-2 border-dashed border-slate-200 hover:border-brand-500 rounded p-6 text-center transition-all">
              <input
                type="file"
                multiple
                onChange={handleFileChange}
                disabled={isUploading}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <FileSpreadsheet className="mx-auto text-slate-400 mb-2" size={28} />
              <p className="font-bold text-slate-700">
                {isUploading
                  ? (locale === "pt" ? "Enviando..." : "Uploading...")
                  : (locale === "pt" ? "Arraste ou Selecione Arquivos" : "Drag & Drop or Browse Files")}
              </p>
              <p className="text-[10px] text-slate-400 mt-1">PDF, DOCX, XLSX, CSV, TXT...</p>
            </div>

            {files.length > 0 && (
              <div className="space-y-1.5">
                {files.map((f) => (
                  <div key={f.id} className="p-2 bg-slate-50 border border-slate-200 rounded flex items-center justify-between">
                    <span className="truncate">{f.filename}</span>
                    <button onClick={() => handleRemoveFile(f.id)} className="text-slate-400 hover:text-danger-600 cursor-pointer">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {error && <div className="p-3 rounded bg-warning-50 border border-warning-200 text-warning-900">{error}</div>}

            <button
              onClick={() => {
                // Switching to the manual form abandons any uploaded documents in this session
                // just like cancelling does.
                if (sessionId) fetch(`/api/project-intake/${sessionId}`, { method: "DELETE" }).catch(() => {});
                setShowManualFallback(true);
              }}
              className="text-brand-600 hover:underline text-[11px] font-semibold cursor-pointer block"
            >
              {locale === "pt" ? "Não tenho documentos ainda, criar manualmente" : "I don't have documents yet, create manually"}
            </button>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={handleCancel}
                className="px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 font-mono text-xs cursor-pointer text-slate-500"
              >
                {locale === "pt" ? "Cancelar" : "Cancel"}
              </button>
              <button
                onClick={handleAnalyze}
                disabled={!files.length || isAnalyzing}
                className={`font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all flex items-center gap-2 ${
                  !files.length || isAnalyzing ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-brand-600 hover:bg-brand-700 text-white cursor-pointer"
                }`}
              >
                <Sparkles size={13} className={isAnalyzing ? "animate-pulse" : ""} />
                {isAnalyzing
                  ? (analysisStep || (locale === "pt" ? "Analisando..." : "Analyzing..."))
                  : (locale === "pt" ? "Analisar com IA" : "Analyze with AI")}
              </button>
            </div>
          </div>
        )}

        {step === "validate" && (
          <form onSubmit={handleConfirm} className="p-6 overflow-y-auto flex-1">
            {error && <div className="mb-4 p-3 rounded bg-warning-50 border border-warning-200 text-warning-900 text-xs">{error}</div>}
            <ProjectFieldsForm locale={locale} values={fields} onChange={setFields} />

            <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={handleCancel}
                className="px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 font-mono text-xs cursor-pointer text-slate-500"
              >
                {locale === "pt" ? "Cancelar" : "Cancel"}
              </button>
              <button
                type="submit"
                disabled={isConfirming}
                className="bg-brand-600 hover:bg-brand-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer disabled:opacity-60"
              >
                {isConfirming
                  ? (locale === "pt" ? "Criando..." : "Creating...")
                  : (locale === "pt" ? "Confirmar e Criar Projeto" : "Confirm and Create Project")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
