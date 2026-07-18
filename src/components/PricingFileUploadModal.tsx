import { useRef, useState } from "react";
import { X, FileUp, Loader2, CheckCircle2, CircleAlert, Sparkles } from "lucide-react";
import ApiClient from "../lib/api";
import type { BackgroundTask } from "../hooks/useBackgroundTasks";

const ACCEPTED_EXTENSIONS = ".xlsx,.pdf,.png,.jpg,.jpeg,.webp,.docx,.csv";

interface TemplateResult {
  fileName: string;
  uploadId: string;
  created: number;
  updated: number;
  errors: { rowNumber: number; message: string }[];
}

interface AiTaskRef {
  taskId: string;
  fileName: string;
}

interface CappedFile {
  fileName: string;
  error: string;
}

interface QueuedFile {
  file: File;
  status: "queued" | "uploading" | "done" | "processing" | "success" | "error";
  templateResult?: TemplateResult;
  errorMessage?: string;
  taskId?: string;
}

export default function PricingFileUploadModal({
  onClose,
  onDone,
  waitForTask,
  tasksById,
}: {
  onClose: () => void;
  onDone: () => void;
  waitForTask: (taskId: string) => Promise<BackgroundTask>;
  tasksById: Record<string, BackgroundTask>;
}) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Uma vez que o lote foi enviado, o botão "Enviar" nunca mais reabilita pra este popup - sem
  // isso, uploading voltava a false assim que a resposta chegava e o botão "Enviar 2 arquivo(s)"
  // ficava clicável de novo, reenviando os MESMOS arquivos já processados (achado real, reportado
  // pelo usuário).
  const [submitted, setSubmitted] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | File[]) => {
    const newOnes = Array.from(files).map((file) => ({ file, status: "queued" as const }));
    setQueue((prev) => [...prev, ...newOnes]);
  };

  const removeFile = (idx: number) => {
    setQueue((prev) => prev.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    if (queue.length === 0 || submitted) return;
    setUploading(true);
    setSubmitted(true);
    setBatchError(null);
    setQueue((prev) => prev.map((q) => ({ ...q, status: "uploading" as const })));
    try {
      const formData = new FormData();
      for (const q of queue) formData.append("files", q.file);
      const res = await ApiClient.post<{ success: boolean; templateResults: TemplateResult[]; aiTasks: AiTaskRef[]; cappedFiles: CappedFile[] }>(
        "/api/pricing/catalog/upload",
        formData
      );
      setQueue((prev) =>
        prev.map((q) => {
          const templateResult = res.templateResults.find((r) => r.fileName === q.file.name);
          if (templateResult) {
            return { ...q, status: templateResult.errors.length > 0 ? "error" : "done", templateResult, errorMessage: undefined };
          }
          const aiTask = res.aiTasks.find((t) => t.fileName === q.file.name);
          if (aiTask) {
            return { ...q, status: "processing" as const, taskId: aiTask.taskId };
          }
          const capped = res.cappedFiles.find((c) => c.fileName === q.file.name);
          if (capped) {
            return { ...q, status: "error" as const, errorMessage: capped.error };
          }
          return q;
        })
      );

      // Cada arquivo de IA vira uma tarefa própria - acompanha até o fim (sucesso ou falha) pra
      // atualizar o status desta linha no popup em tempo real, sem depender só do rodapé (que
      // agrupa várias tarefas numa única entrada global, sem detalhe por arquivo).
      for (const aiTask of res.aiTasks) {
        waitForTask(aiTask.taskId).then((finalTask) => {
          setQueue((prev) =>
            prev.map((q) =>
              q.taskId === aiTask.taskId
                ? {
                    ...q,
                    status: finalTask.status === "completed" ? ("success" as const) : ("error" as const),
                    errorMessage: finalTask.status === "failed" ? finalTask.error_message || "Falha na extração por IA." : undefined,
                  }
                : q
            )
          );
        });
      }

      // Arquivos-modelo já entraram no catálogo agora; arquivos de IA só terminam depois, em
      // segundo plano - onDone() já atualiza o que dá pra atualizar imediatamente (catálogo).
      onDone();
    } catch (e: any) {
      setBatchError(e.message || "Não foi possível enviar os arquivos.");
      setQueue((prev) => prev.map((q) => (q.status === "uploading" ? { ...q, status: "error" as const } : q)));
    } finally {
      setUploading(false);
    }
  };

  const statusLabel = (q: QueuedFile) => {
    if (q.status === "queued") return "Na fila";
    if (q.status === "uploading") return "Enviando...";
    if (q.status === "error") return q.errorMessage || "Erro";
    if (q.status === "success") return "Extraído — confira em \"Extrações pendentes\" para revisar e confirmar";
    if (q.status === "processing") {
      const live = q.taskId ? tasksById[q.taskId] : undefined;
      const step = live?.current_step || "Na fila para análise";
      const pct = typeof live?.progress_pct === "number" ? ` (${live.progress_pct}%)` : "";
      return `${step}${pct}`;
    }
    if (q.templateResult) {
      const errs = q.templateResult.errors.length;
      return `Modelo detectado: ${q.templateResult.created} novo(s), ${q.templateResult.updated} atualizado(s)${errs > 0 ? `, ${errs} linha(s) com erro` : ""}`;
    }
    return "";
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl border border-slate-200 w-full max-w-xl overflow-hidden shadow-2xl">
        <div className="bg-slate-950 text-white p-4 flex justify-between items-center">
          <h3 className="text-sm font-bold uppercase font-mono tracking-wider">Enviar Arquivos</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-500">
            Solte a planilha modelo ou cotações de fornecedor em qualquer formato (PDF, foto, Word, planilha) — o sistema
            detecta sozinho: a planilha modelo importa direto; qualquer outro arquivo é analisado por IA (acompanhe abaixo,
            por arquivo) e vira itens para você revisar antes de entrar no catálogo.
          </p>

          {!submitted && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                dragging ? "border-emerald-500 bg-emerald-50" : "border-slate-300 hover:border-slate-400"
              }`}
            >
              <FileUp size={22} className="mx-auto mb-2 text-slate-400" />
              <p className="text-xs text-slate-500">Arraste arquivos aqui, ou clique para escolher</p>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={ACCEPTED_EXTENSIONS}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {queue.length > 0 && (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {queue.map((q, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2">
                  {q.status === "queued" && <Sparkles size={13} className="text-slate-400 shrink-0" />}
                  {(q.status === "uploading" || q.status === "processing") && <Loader2 size={13} className="animate-spin text-amber-500 shrink-0" />}
                  {(q.status === "done" || q.status === "success") && <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />}
                  {q.status === "error" && <CircleAlert size={13} className="text-red-500 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-700 truncate">{q.file.name}</p>
                    {q.status !== "queued" && <p className="text-[10px] text-slate-500">{statusLabel(q)}</p>}
                  </div>
                  {q.status === "queued" && (
                    <button onClick={() => removeFile(idx)} className="text-slate-400 hover:text-red-500 shrink-0">
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {batchError && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <CircleAlert size={13} className="mt-0.5 shrink-0" />
              {batchError}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            {!submitted && (
              <button
                onClick={submit}
                disabled={queue.length === 0 || uploading}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-emerald-600 rounded-lg px-3 py-2 hover:bg-emerald-700 disabled:opacity-60"
              >
                {uploading ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
                {uploading ? "Enviando..." : `Enviar ${queue.length || ""} arquivo(s)`}
              </button>
            )}
            <button
              onClick={onClose}
              className="text-sm font-medium text-slate-600 border border-slate-300 rounded-lg px-3 py-2 hover:bg-slate-50"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
