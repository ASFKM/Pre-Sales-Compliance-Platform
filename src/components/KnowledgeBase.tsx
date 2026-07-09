import { useEffect, useState } from "react";
import { BookOpen, FileText, Trash2, Sparkles, Check, X, Edit2, Upload, Search } from "lucide-react";
import ApiClient from "../lib/api";
import { KnowledgeBaseEntry, KnowledgeBaseDocument, KnowledgeBaseEntryCategory } from "../types";
import { BackgroundTask } from "../hooks/useBackgroundTasks";

interface KnowledgeBaseProps {
  hasPermission: (permission: string) => boolean;
  activeTasks: BackgroundTask[];
  waitForTask: (taskId: string) => Promise<BackgroundTask>;
}

type SubTab = "upload" | "approvals" | "approved";

const CATEGORY_LABEL: Record<KnowledgeBaseEntryCategory, string> = {
  bom_part_number: "Número de Peça (BOM)",
  engineering_note: "Nota de Engenharia",
  compliance_status: "Status de Conformidade",
  datasheet: "Datasheet",
};

const SOURCE_LABEL: Record<string, string> = {
  reactive_edit: "Edição em Projeto",
  uploaded_document: "Documento Enviado",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KnowledgeBase({ hasPermission, activeTasks, waitForTask }: KnowledgeBaseProps) {
  const canWrite = hasPermission("knowledge_base:write");

  const [subTab, setSubTab] = useState<SubTab>("upload");
  const [documents, setDocuments] = useState<KnowledgeBaseDocument[]>([]);
  const [allEntries, setAllEntries] = useState<KnowledgeBaseEntry[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");

  const [approvalsStatusFilter, setApprovalsStatusFilter] = useState<"pending" | "rejected">("pending");
  const [categoryFilter, setCategoryFilter] = useState<"all" | KnowledgeBaseEntryCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [editingEntry, setEditingEntry] = useState<KnowledgeBaseEntry | null>(null);
  const [editTrigger, setEditTrigger] = useState("");
  const [editKnowledge, setEditKnowledge] = useState("");
  const [savingEntryId, setSavingEntryId] = useState<string | null>(null);

  // The analysis task is created and driven entirely by the backend (createTask + a detached
  // runWithTenant job) - it keeps running and reporting progress over the same SSE stream
  // regardless of whether the user stays on this tab, switches tabs, or reloads the page, so
  // navigating away never loses the analysis.
  const analysisTask = activeTasks.find((t) => t.type === "knowledge_base_analysis");
  const pendingDocsCount = documents.filter((d) => !d.analyzed_at).length;
  const pendingEntriesCount = allEntries.filter((e) => e.status === "pending").length;
  const approvedEntriesCount = allEntries.filter((e) => e.status === "approved").length;

  const loadDocuments = async () => {
    setLoadingDocs(true);
    try {
      const docs = await ApiClient.get<KnowledgeBaseDocument[]>("/api/knowledge-base/documents");
      setDocuments(docs);
    } catch (err: any) {
      setError(err.message || "Não foi possível carregar os documentos.");
    } finally {
      setLoadingDocs(false);
    }
  };

  const loadEntries = async () => {
    setLoadingEntries(true);
    try {
      const rows = await ApiClient.get<KnowledgeBaseEntry[]>("/api/knowledge-base/entries");
      setAllEntries(rows);
    } catch (err: any) {
      setError(err.message || "Não foi possível carregar a base de conhecimento.");
    } finally {
      setLoadingEntries(false);
    }
  };

  useEffect(() => {
    loadDocuments();
    loadEntries();
  }, []);

  // Reflect a running/just-finished analysis task without polling - same SSE stream everything
  // else uses, we just re-fetch when it flips.
  useEffect(() => {
    if (!analysisTask) {
      loadDocuments();
      loadEntries();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisTask?.status]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected || !selected.length) return;
    setError("");
    setIsUploading(true);
    try {
      for (const file of Array.from(selected)) {
        const formData = new FormData();
        formData.append("file", file);
        await ApiClient.post<KnowledgeBaseDocument>("/api/knowledge-base/documents", formData);
      }
      await loadDocuments();
    } catch (err: any) {
      setError(err.message || "Falha ao enviar arquivo.");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  const handleDeleteDocument = async (id: string) => {
    try {
      await ApiClient.delete(`/api/knowledge-base/documents/${id}`);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch (err: any) {
      setError(err.message || "Não foi possível excluir o documento.");
    }
  };

  const handleAnalyzeDocuments = async () => {
    setError("");
    setIsAnalyzing(true);
    try {
      const data = await ApiClient.post<{ success: boolean; task_id: string; message?: string }>(
        "/api/knowledge-base/documents/analyze",
        {}
      );
      await waitForTask(data.task_id);
      await loadDocuments();
      await loadEntries();
    } catch (err: any) {
      setError(err.message || "Não foi possível analisar os documentos.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const openEdit = (entry: KnowledgeBaseEntry) => {
    setEditingEntry(entry);
    setEditTrigger(entry.trigger);
    setEditKnowledge(entry.knowledge);
  };

  const closeEdit = () => {
    setEditingEntry(null);
    setEditTrigger("");
    setEditKnowledge("");
  };

  const saveEntryEdit = async () => {
    if (!editingEntry) return;
    setSavingEntryId(editingEntry.id);
    try {
      const updated = await ApiClient.put<KnowledgeBaseEntry>(`/api/knowledge-base/entries/${editingEntry.id}`, {
        trigger: editTrigger,
        knowledge: editKnowledge,
      });
      setAllEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      closeEdit();
    } catch (err: any) {
      setError(err.message || "Não foi possível salvar a edição.");
    } finally {
      setSavingEntryId(null);
    }
  };

  const decideEntry = async (entry: KnowledgeBaseEntry, status: "approved" | "rejected") => {
    setSavingEntryId(entry.id);
    try {
      const updated = await ApiClient.put<KnowledgeBaseEntry>(`/api/knowledge-base/entries/${entry.id}`, { status });
      setAllEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    } catch (err: any) {
      setError(err.message || "Não foi possível atualizar o item.");
    } finally {
      setSavingEntryId(null);
    }
  };

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const visibleEntries = allEntries.filter((e) => {
    const statusOk = subTab === "approved" ? e.status === "approved" : e.status === approvalsStatusFilter;
    if (!statusOk) return false;
    if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
    if (normalizedSearch) {
      const haystack = [
        e.trigger,
        e.knowledge,
        CATEGORY_LABEL[e.category],
        e.source_project_name,
        e.source_document_name,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(normalizedSearch)) return false;
    }
    return true;
  });

  const renderEntryCard = (entry: KnowledgeBaseEntry) => (
    <div key={entry.id} className="p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-2 py-0.5 rounded font-bold text-[9px] uppercase bg-slate-100 text-slate-600">
          {CATEGORY_LABEL[entry.category]}
        </span>
        <span className="text-[10px] text-slate-400 font-mono">
          {SOURCE_LABEL[entry.source] || entry.source}
          {entry.source_project_name ? ` · ${entry.source_project_name}` : ""}
          {entry.source_document_name ? ` · ${entry.source_document_name}` : ""}
        </span>
        <span className="text-[10px] text-slate-400 font-mono ml-auto">
          {new Date(entry.created_at).toLocaleString()}
        </span>
      </div>
      <div className="text-xs text-slate-700">
        <span className="font-bold text-slate-500">Se: </span>
        {entry.trigger}
      </div>
      <div className="text-xs text-slate-700">
        <span className="font-bold text-slate-500">Então: </span>
        {entry.knowledge}
      </div>
      {canWrite && (
        <div className="flex items-center gap-2 pt-1">
          {entry.status !== "approved" && (
            <button
              onClick={() => decideEntry(entry, "approved")}
              disabled={savingEntryId === entry.id}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Check size={12} /> Aprovar
            </button>
          )}
          <button
            onClick={() => openEdit(entry)}
            disabled={savingEntryId === entry.id}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Edit2 size={12} /> Editar
          </button>
          {entry.status !== "rejected" && (
            <button
              onClick={() => decideEntry(entry, "rejected")}
              disabled={savingEntryId === entry.id}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded bg-red-50 text-red-700 hover:bg-red-100 transition-colors cursor-pointer disabled:opacity-50"
            >
              <X size={12} /> Rejeitar
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 p-6 overflow-y-auto space-y-6">
      <div className="flex items-center gap-2">
        <BookOpen className="text-emerald-600" size={18} />
        <h2 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">Base de Conhecimento</h2>
      </div>
      <p className="text-xs text-slate-500 -mt-4 leading-relaxed">
        Correções feitas pela equipe durante análises (peças, notas de engenharia, status de conformidade) e
        documentos de referência enviados manualmente (datasheets, catálogos) alimentam esta base. Toda entrada
        passa por revisão humana antes de ser considerada em futuras análises de IA.
      </p>

      {error && (
        <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs flex justify-between items-start">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-amber-700 hover:text-amber-900 cursor-pointer"><X size={14} /></button>
        </div>
      )}

      {/* Sub-nav */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="flex items-center gap-6 px-4 h-12 border-b border-slate-200 text-xs font-semibold bg-slate-50/50">
          <button
            onClick={() => setSubTab("upload")}
            className={`h-full px-1 border-b-2 transition-all font-bold uppercase tracking-wider cursor-pointer ${subTab === "upload" ? "border-emerald-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
          >
            Upload de Arquivos {documents.length > 0 && `(${documents.length})`}
          </button>
          <button
            onClick={() => setSubTab("approvals")}
            className={`h-full px-1 border-b-2 transition-all font-bold uppercase tracking-wider cursor-pointer ${subTab === "approvals" ? "border-emerald-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
          >
            Aprovações {pendingEntriesCount > 0 && `(${pendingEntriesCount})`}
          </button>
          <button
            onClick={() => setSubTab("approved")}
            className={`h-full px-1 border-b-2 transition-all font-bold uppercase tracking-wider cursor-pointer ${subTab === "approved" ? "border-emerald-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
          >
            Base de Conhecimento {approvedEntriesCount > 0 && `(${approvedEntriesCount})`}
          </button>
        </div>

        {/* SUBTAB: UPLOAD DE ARQUIVOS */}
        {subTab === "upload" && (
          <>
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-600">Documentos de Referência</h3>
              {canWrite && (
                <button
                  onClick={handleAnalyzeDocuments}
                  disabled={isAnalyzing || !!analysisTask || pendingDocsCount === 0}
                  className={`font-mono text-[11px] font-bold py-1.5 px-3 rounded shadow transition-all flex items-center gap-2 ${
                    isAnalyzing || !!analysisTask || pendingDocsCount === 0
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                      : "bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                  }`}
                >
                  <Sparkles size={13} className={isAnalyzing || !!analysisTask ? "animate-pulse" : ""} />
                  {analysisTask
                    ? analysisTask.current_step || "Analisando..."
                    : `Analisar Documentos e Gerar Base de Conhecimento${pendingDocsCount ? ` (${pendingDocsCount})` : ""}`}
                </button>
              )}
            </div>

            {analysisTask && (
              <div className="px-4 py-3 bg-emerald-50/50 border-b border-emerald-100 flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
                <span className="text-[11px] font-mono text-emerald-800 truncate">
                  {analysisTask.current_step}
                  {typeof analysisTask.progress_pct === "number" && ` (${analysisTask.progress_pct}%)`}
                </span>
                <div className="flex-1 h-1.5 bg-emerald-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${typeof analysisTask.progress_pct === "number" ? analysisTask.progress_pct : 5}%` }}
                  />
                </div>
              </div>
            )}

            <div className="p-4 space-y-3">
              {canWrite && (
                <div className="relative border-2 border-dashed border-slate-200 hover:border-emerald-500 rounded p-5 text-center transition-all">
                  <input
                    type="file"
                    multiple
                    onChange={handleFileChange}
                    disabled={isUploading}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <Upload className="mx-auto text-slate-400 mb-2" size={24} />
                  <p className="font-bold text-slate-700 text-xs">
                    {isUploading ? "Enviando..." : "Arraste ou Selecione Datasheets, Catálogos, PDFs"}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">PDF, DOCX, XLSX, imagens...</p>
                </div>
              )}

              {loadingDocs ? (
                <div className="text-xs text-slate-400 italic py-2">Carregando documentos...</div>
              ) : documents.length === 0 ? (
                <div className="text-xs text-slate-400 italic py-2">Nenhum documento enviado ainda.</div>
              ) : (
                <div className="space-y-1.5">
                  {documents.map((doc) => {
                    const isBeingAnalyzedNow = !!analysisTask && !doc.analyzed_at && analysisTask.current_step?.includes(doc.original_filename);
                    return (
                      <div key={doc.id} className={`p-2.5 border rounded text-xs ${isBeingAnalyzedNow ? "bg-emerald-50/50 border-emerald-200" : "bg-slate-50 border-slate-200"}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText size={14} className="text-slate-400 shrink-0" />
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-slate-700">{doc.original_filename}</div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                {formatBytes(doc.file_size)} · {new Date(doc.created_at).toLocaleString()}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`px-2 py-0.5 rounded font-bold text-[9px] uppercase ${
                              isBeingAnalyzedNow ? "bg-emerald-100 text-emerald-700" : doc.analyzed_at ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                            }`}>
                              {isBeingAnalyzedNow ? "Analisando..." : doc.analyzed_at ? "Analisado" : "Pendente"}
                            </span>
                            {canWrite && (
                              <button
                                onClick={() => handleDeleteDocument(doc.id)}
                                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                                title="Excluir Documento"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                        {isBeingAnalyzedNow && typeof analysisTask?.progress_pct === "number" && (
                          <div className="mt-2 h-1 bg-emerald-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 transition-all duration-500"
                              style={{ width: `${analysisTask.progress_pct}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* SUBTAB: APROVAÇÕES */}
        {subTab === "approvals" && (
          <>
            <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-600">
                Fila de Aprovação ({visibleEntries.length})
              </h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar na base..."
                    className="text-[11px] font-mono border border-slate-200 rounded pl-6 pr-2 py-1.5 bg-white text-slate-600 w-40 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <select
                  value={approvalsStatusFilter}
                  onChange={(e) => setApprovalsStatusFilter(e.target.value as any)}
                  className="text-[11px] font-mono border border-slate-200 rounded px-2 py-1.5 bg-white text-slate-600"
                >
                  <option value="pending">Pendente</option>
                  <option value="rejected">Rejeitado</option>
                </select>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as any)}
                  className="text-[11px] font-mono border border-slate-200 rounded px-2 py-1.5 bg-white text-slate-600"
                >
                  <option value="all">Todas as Categorias</option>
                  <option value="bom_part_number">Número de Peça (BOM)</option>
                  <option value="engineering_note">Nota de Engenharia</option>
                  <option value="compliance_status">Status de Conformidade</option>
                  <option value="datasheet">Datasheet</option>
                </select>
              </div>
            </div>

            {loadingEntries ? (
              <div className="text-xs text-slate-400 italic p-6 text-center">Carregando entradas...</div>
            ) : visibleEntries.length === 0 ? (
              <div className="text-xs text-slate-400 italic p-6 text-center">Nenhuma entrada encontrada para este filtro.</div>
            ) : (
              <div className="divide-y divide-slate-200">{visibleEntries.map(renderEntryCard)}</div>
            )}
          </>
        )}

        {/* SUBTAB: BASE DE CONHECIMENTO (aprovadas) */}
        {subTab === "approved" && (
          <>
            <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-600">
                Conhecimento Aprovado ({visibleEntries.length})
              </h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar na base..."
                    className="text-[11px] font-mono border border-slate-200 rounded pl-6 pr-2 py-1.5 bg-white text-slate-600 w-40 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as any)}
                  className="text-[11px] font-mono border border-slate-200 rounded px-2 py-1.5 bg-white text-slate-600"
                >
                  <option value="all">Todas as Categorias</option>
                  <option value="bom_part_number">Número de Peça (BOM)</option>
                  <option value="engineering_note">Nota de Engenharia</option>
                  <option value="compliance_status">Status de Conformidade</option>
                  <option value="datasheet">Datasheet</option>
                </select>
              </div>
            </div>

            {loadingEntries ? (
              <div className="text-xs text-slate-400 italic p-6 text-center">Carregando entradas...</div>
            ) : visibleEntries.length === 0 ? (
              <div className="text-xs text-slate-400 italic p-6 text-center">Nenhuma entrada aprovada ainda.</div>
            ) : (
              <div className="divide-y divide-slate-200">{visibleEntries.map(renderEntryCard)}</div>
            )}
          </>
        )}
      </div>

      {editingEntry && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">Editar Entrada</h3>
              <button onClick={closeEdit} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Se (situação/gatilho)</label>
                <textarea
                  value={editTrigger}
                  onChange={(e) => setEditTrigger(e.target.value)}
                  rows={3}
                  className="w-full text-xs border border-slate-200 rounded p-2 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Então (conhecimento aplicado)</label>
                <textarea
                  value={editKnowledge}
                  onChange={(e) => setEditKnowledge(e.target.value)}
                  rows={3}
                  className="w-full text-xs border border-slate-200 rounded p-2 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-slate-200">
              <button
                onClick={closeEdit}
                className="px-4 py-2 text-xs font-bold uppercase text-slate-500 hover:bg-slate-100 rounded transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={saveEntryEdit}
                disabled={savingEntryId === editingEntry.id}
                className="px-4 py-2 text-xs font-bold uppercase bg-emerald-600 hover:bg-emerald-700 text-white rounded transition-colors cursor-pointer disabled:opacity-50"
              >
                {savingEntryId === editingEntry.id ? "Salvando..." : "Salvar Alterações"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
