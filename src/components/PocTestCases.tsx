import { useEffect, useState } from "react";
import { Sparkles, Plus, Trash2, Pen, X, Check } from "lucide-react";
import { PocTestCase, PocTestCaseStatus } from "../types";
import ApiClient from "../lib/api";
import { BackgroundTask } from "../hooks/useBackgroundTasks";

const STATUS_LABEL: Record<PocTestCaseStatus, string> = {
  pending: "Pendente",
  in_progress: "Em execução",
  approved: "Aprovado",
  failed: "Reprovado",
};

const STATUS_COLOR: Record<PocTestCaseStatus, string> = {
  pending: "bg-slate-100 text-slate-600",
  in_progress: "bg-blue-50 text-blue-700",
  approved: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
};

interface ManualFormState {
  title: string;
  objective: string;
  steps: string;
  expected_result: string;
}

const EMPTY_FORM: ManualFormState = { title: "", objective: "", steps: "", expected_result: "" };

interface PocTestCasesProps {
  pocId: string;
  canManage: boolean;
  activeTasks: BackgroundTask[];
  waitForTask: (taskId: string) => Promise<BackgroundTask>;
}

export default function PocTestCases({ pocId, canManage, activeTasks, waitForTask }: PocTestCasesProps) {
  const [cases, setCases] = useState<PocTestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [knowledgeBaseWarning, setKnowledgeBaseWarning] = useState("");

  // The generation task belongs to this specific POC's test-case flow, not just "any" active
  // poc_test_generation task in the app - resultId is set to the POC id at task creation
  // (see server/routes/pocs.ts) precisely so this filter can disambiguate.
  const generationTask = activeTasks.find((t) => t.type === "poc_test_generation" && t.result_id === pocId);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ManualFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState<ManualFormState>(EMPTY_FORM);

  const fetchCases = async () => {
    setLoading(true);
    try {
      const data = await ApiClient.get<PocTestCase[]>(`/api/pocs/${pocId}/test-cases`);
      setCases(Array.isArray(data) ? data : []);
    } catch (e) {
      setCases([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pocId]);

  const generate = async () => {
    setGenerating(true);
    setGenerateError("");
    setKnowledgeBaseWarning("");
    try {
      const data = await ApiClient.post<{ success: boolean; task_id: string }>(`/api/pocs/${pocId}/test-cases/generate`, {});
      const finished = await waitForTask(data.task_id);
      if (finished.status === "failed") {
        setGenerateError(finished.error_message || "Não foi possível gerar os casos de teste.");
        return;
      }
      await fetchCases();
      if (finished.warning_message) {
        setKnowledgeBaseWarning(finished.warning_message);
      }
    } catch (e: any) {
      setGenerateError(e.message || "Não foi possível gerar os casos de teste.");
    } finally {
      setGenerating(false);
    }
  };

  const submitManual = async () => {
    if (!form.title.trim() || !form.objective.trim() || !form.steps.trim() || !form.expected_result.trim()) return;
    setSaving(true);
    try {
      await ApiClient.post(`/api/pocs/${pocId}/test-cases`, form);
      setForm(EMPTY_FORM);
      setShowForm(false);
      await fetchCases();
    } catch (e: any) {
      alert(e.message || "Não foi possível criar o caso de teste.");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (tc: PocTestCase) => {
    setEditingId(tc.id);
    setEditBuffer({ title: tc.title, objective: tc.objective, steps: tc.steps, expected_result: tc.expected_result });
  };

  const saveEdit = async (tc: PocTestCase) => {
    setSaving(true);
    try {
      await ApiClient.put(`/api/pocs/${pocId}/test-cases/${tc.id}`, editBuffer);
      setEditingId(null);
      await fetchCases();
    } catch (e: any) {
      alert(e.message || "Não foi possível salvar as alterações.");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (tc: PocTestCase, status: PocTestCaseStatus) => {
    try {
      await ApiClient.put(`/api/pocs/${pocId}/test-cases/${tc.id}`, { status });
      await fetchCases();
    } catch (e: any) {
      alert(e.message || "Não foi possível atualizar o status.");
    }
  };

  const removeCase = async (tc: PocTestCase) => {
    try {
      await ApiClient.delete(`/api/pocs/${pocId}/test-cases/${tc.id}`);
      await fetchCases();
    } catch (e: any) {
      alert(e.message || "Não foi possível remover o caso de teste.");
    }
  };

  if (loading) {
    return <p className="text-xs text-slate-400">Carregando...</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 bg-emerald-50/60 border border-emerald-100 rounded-lg px-3 py-2.5 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className="text-[10px] font-bold text-emerald-700 bg-white border border-emerald-200 rounded-full px-2 py-0.5">
            Gerado por IA
          </span>
          Casos de teste derivados do objetivo e dos critérios de sucesso desta POC.
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 font-mono text-xs cursor-pointer text-slate-500"
            >
              <Plus size={13} />
              Adicionar manual
            </button>
            <button
              onClick={generate}
              disabled={generating || !!generationTask}
              className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer disabled:opacity-60"
            >
              <Sparkles size={13} className={generating || generationTask ? "animate-pulse" : ""} />
              {generationTask ? generationTask.current_step || "Gerando..." : generating ? "Gerando..." : "Regenerar com IA"}
            </button>
          </div>
        )}
      </div>
      {generationTask && (
        <div className="flex items-center gap-2 text-[11px] text-slate-500 px-1">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
          <span className="truncate">{generationTask.current_step}</span>
          <span className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <span
              className="block h-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${typeof generationTask.progress_pct === "number" ? generationTask.progress_pct : 5}%` }}
            />
          </span>
        </div>
      )}
      {generateError && <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs">{generateError}</div>}
      {knowledgeBaseWarning && (
        <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs">
          <span className="font-bold">Base de Conhecimento insuficiente: </span>
          {knowledgeBaseWarning}
        </div>
      )}

      {showForm && (
        <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 space-y-3">
          <input
            className="w-full p-2 rounded bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            placeholder="Título do caso de teste"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <textarea
            className="w-full p-2 rounded bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            placeholder="Objetivo do teste"
            rows={2}
            value={form.objective}
            onChange={(e) => setForm({ ...form, objective: e.target.value })}
          />
          <textarea
            className="w-full p-2 rounded bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            placeholder="Passos (um por linha)"
            rows={3}
            value={form.steps}
            onChange={(e) => setForm({ ...form, steps: e.target.value })}
          />
          <textarea
            className="w-full p-2 rounded bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            placeholder="Resultado esperado"
            rows={2}
            value={form.expected_result}
            onChange={(e) => setForm({ ...form, expected_result: e.target.value })}
          />
          <div className="flex items-center gap-2 pt-1">
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 font-mono text-xs cursor-pointer text-slate-500">
              Cancelar
            </button>
            <button
              onClick={submitManual}
              disabled={saving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer disabled:opacity-60"
            >
              Salvar
            </button>
          </div>
        </div>
      )}

      {cases.length === 0 ? (
        <p className="text-xs text-slate-400 italic py-4">Nenhum caso de teste ainda. Gere com IA ou adicione manualmente.</p>
      ) : (
        <div className="space-y-2">
          {cases.map((tc) => (
            <div key={tc.id} className="border border-slate-200 rounded-lg p-3.5 bg-white">
              {editingId === tc.id ? (
                <div className="space-y-2">
                  <input
                    className="w-full p-2 rounded bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold"
                    value={editBuffer.title}
                    onChange={(e) => setEditBuffer({ ...editBuffer, title: e.target.value })}
                  />
                  <textarea
                    className="w-full p-2 rounded bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    rows={2}
                    value={editBuffer.objective}
                    onChange={(e) => setEditBuffer({ ...editBuffer, objective: e.target.value })}
                  />
                  <textarea
                    className="w-full p-2 rounded bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    rows={3}
                    value={editBuffer.steps}
                    onChange={(e) => setEditBuffer({ ...editBuffer, steps: e.target.value })}
                  />
                  <textarea
                    className="w-full p-2 rounded bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    rows={2}
                    value={editBuffer.expected_result}
                    onChange={(e) => setEditBuffer({ ...editBuffer, expected_result: e.target.value })}
                  />
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditingId(null)} className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 font-mono text-xs cursor-pointer text-slate-500">
                      <X size={12} />
                      Cancelar
                    </button>
                    <button
                      onClick={() => saveEdit(tc)}
                      disabled={saving}
                      className="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer disabled:opacity-60"
                    >
                      <Check size={12} />
                      Salvar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-slate-400">{tc.code}</span>
                      <span className="text-sm font-semibold text-slate-900">{tc.title}</span>
                      {tc.edited_manually && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 rounded px-1.5 py-0.5">
                          <Pen size={9} />
                          editado
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {canManage ? (
                        <select
                          className={`text-[11px] font-semibold rounded-full px-2 py-1 border-0 ${STATUS_COLOR[tc.status]}`}
                          value={tc.status}
                          onChange={(e) => updateStatus(tc, e.target.value as PocTestCaseStatus)}
                        >
                          {(["pending", "in_progress", "approved", "failed"] as PocTestCaseStatus[]).map((s) => (
                            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={`text-[11px] font-semibold rounded-full px-2 py-1 ${STATUS_COLOR[tc.status]}`}>{STATUS_LABEL[tc.status]}</span>
                      )}
                      {canManage && (
                        <>
                          <button onClick={() => startEdit(tc)} className="text-slate-400 hover:text-slate-700">
                            <Pen size={13} />
                          </button>
                          <button onClick={() => removeCase(tc)} className="text-slate-300 hover:text-red-500">
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 whitespace-pre-wrap">{tc.objective}</p>
                  <div className="text-xs text-slate-600 mt-1.5 whitespace-pre-wrap">{tc.steps}</div>
                  <div className="text-xs text-slate-500 mt-1.5"><span className="font-semibold text-slate-600">Resultado esperado:</span> {tc.expected_result}</div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
