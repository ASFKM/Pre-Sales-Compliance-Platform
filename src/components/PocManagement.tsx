import { useEffect, useState } from "react";
import { Plus, X, ArrowLeft, Pen } from "lucide-react";
import { Poc, PocStatus, Project } from "../types";
import ApiClient from "../lib/api";

const STATUS_LABEL: Record<PocStatus, string> = {
  planned: "Planejada",
  in_progress: "Em andamento",
  blocked: "Bloqueada",
  completed_won: "Concluída · Ganha",
  completed_lost: "Concluída · Perdida",
};

const STATUS_BADGE_COLOR: Record<PocStatus, string> = {
  planned: "bg-blue-50 text-blue-700",
  in_progress: "bg-emerald-50 text-emerald-700",
  blocked: "bg-amber-50 text-amber-700",
  completed_won: "bg-emerald-50 text-emerald-700",
  completed_lost: "bg-red-50 text-red-700",
};

const COLUMNS: { key: string; label: string; statuses: PocStatus[]; dot: string }[] = [
  { key: "planned", label: "Planejada", statuses: ["planned"], dot: "bg-blue-500" },
  { key: "in_progress", label: "Em andamento", statuses: ["in_progress"], dot: "bg-emerald-500" },
  { key: "blocked", label: "Bloqueada", statuses: ["blocked"], dot: "bg-amber-500" },
  { key: "completed", label: "Concluída", statuses: ["completed_won", "completed_lost"], dot: "bg-slate-400" },
];

const ALL_STATUSES: PocStatus[] = ["planned", "in_progress", "blocked", "completed_won", "completed_lost"];

interface EditableFields {
  name: string;
  objective: string;
  status: PocStatus;
  start_date: string;
  end_date: string;
  customer_contact_name: string;
  customer_contact_role: string;
}

function toEditable(p: Poc): EditableFields {
  return {
    name: p.name,
    objective: p.objective,
    status: p.status,
    start_date: p.start_date,
    end_date: p.end_date,
    customer_contact_name: p.customer_contact_name,
    customer_contact_role: p.customer_contact_role,
  };
}

interface CreateFormState {
  mode: "project" | "standalone";
  project_id: string;
  standalone_customer_name: string;
  standalone_contact_name: string;
  standalone_contact_email: string;
  standalone_contact_phone: string;
  name: string;
  objective: string;
  start_date: string;
  end_date: string;
  customer_contact_name: string;
  customer_contact_role: string;
}

const EMPTY_CREATE_FORM: CreateFormState = {
  mode: "project",
  project_id: "",
  standalone_customer_name: "",
  standalone_contact_name: "",
  standalone_contact_email: "",
  standalone_contact_phone: "",
  name: "",
  objective: "",
  start_date: "",
  end_date: "",
  customer_contact_name: "",
  customer_contact_role: "",
};

interface PocManagementProps {
  hasPermission: (permission: string) => boolean;
  projects: Project[];
}

export default function PocManagement({ hasPermission, projects }: PocManagementProps) {
  const canManage = hasPermission("poc:manage");

  const [pocs, setPocs] = useState<Poc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedPocId, setSelectedPocId] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState<EditableFields | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const fetchPocs = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await ApiClient.get<Poc[]>("/api/pocs");
      setPocs(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message || "Não foi possível carregar as POCs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPocs();
  }, []);

  const selectedPoc = pocs.find((p) => p.id === selectedPocId) || null;
  const linkedProject = selectedPoc?.project_id ? projects.find((pr) => pr.id === selectedPoc.project_id) || null : null;

  const openDetail = (poc: Poc) => {
    setSelectedPocId(poc.id);
    setIsEditing(false);
    setSaveError("");
  };

  const backToList = () => {
    setSelectedPocId(null);
    setIsEditing(false);
  };

  const startEdit = () => {
    if (!selectedPoc) return;
    setEditValues(toEditable(selectedPoc));
    setIsEditing(true);
    setSaveError("");
  };

  const saveEdit = async () => {
    if (!selectedPoc || !editValues) return;
    setSaving(true);
    setSaveError("");
    try {
      await ApiClient.put(`/api/pocs/${selectedPoc.id}`, editValues);
      setIsEditing(false);
      await fetchPocs();
    } catch (e: any) {
      setSaveError(e.message || "Não foi possível salvar as alterações.");
    } finally {
      setSaving(false);
    }
  };

  const submitCreate = async () => {
    setCreating(true);
    setCreateError("");
    try {
      const payload: Record<string, any> = {
        name: createForm.name,
        objective: createForm.objective,
        start_date: createForm.start_date,
        end_date: createForm.end_date,
        customer_contact_name: createForm.customer_contact_name,
        customer_contact_role: createForm.customer_contact_role,
      };
      if (createForm.mode === "project") {
        payload.project_id = createForm.project_id;
      } else {
        payload.standalone_customer_name = createForm.standalone_customer_name;
        payload.standalone_contact_name = createForm.standalone_contact_name;
        payload.standalone_contact_email = createForm.standalone_contact_email;
        payload.standalone_contact_phone = createForm.standalone_contact_phone;
      }
      await ApiClient.post("/api/pocs", payload);
      setShowCreateModal(false);
      setCreateForm(EMPTY_CREATE_FORM);
      await fetchPocs();
    } catch (e: any) {
      setCreateError(e.message || "Não foi possível criar a POC.");
    } finally {
      setCreating(false);
    }
  };

  const clientLabel = (poc: Poc) => {
    if (poc.project_id) {
      const proj = projects.find((pr) => pr.id === poc.project_id);
      return proj ? proj.customer_name : "Projeto vinculado";
    }
    return poc.standalone_customer_name || "Cliente avulso";
  };

  // ================= DETAIL VIEW =================
  if (selectedPoc) {
    return (
      <div className="space-y-4">
        <button
          onClick={backToList}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft size={14} />
          Voltar para Gestão de POC
        </button>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs text-slate-500 mb-1">{clientLabel(selectedPoc)}</div>
              <h1 className="text-lg font-bold text-slate-900">{selectedPoc.name}</h1>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold px-3 py-1 rounded-full ${STATUS_BADGE_COLOR[selectedPoc.status]}`}>
                {STATUS_LABEL[selectedPoc.status]}
              </span>
              {canManage && !isEditing && (
                <button
                  onClick={startEdit}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 border border-slate-300 rounded-md px-2.5 py-1 hover:bg-slate-50"
                >
                  <Pen size={12} />
                  Editar
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700 mb-4">Visão Geral</h2>

          {!isEditing || !editValues ? (
            <div className="space-y-4 text-sm">
              <div>
                <div className="text-[11px] font-semibold uppercase text-slate-400 mb-1">Objetivo</div>
                <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">{selectedPoc.objective}</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-400 mb-1">Início</div>
                  <div className="text-slate-800 font-medium">{selectedPoc.start_date}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-400 mb-1">Prazo final</div>
                  <div className="text-slate-800 font-medium">{selectedPoc.end_date}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-400 mb-1">Contato do cliente</div>
                  <div className="text-slate-800 font-medium">{selectedPoc.customer_contact_name}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-400 mb-1">Cargo</div>
                  <div className="text-slate-800 font-medium">{selectedPoc.customer_contact_role}</div>
                </div>
              </div>
              {linkedProject && (
                <div className="border border-dashed border-slate-300 rounded-lg p-3 bg-slate-50">
                  <div className="text-[11px] font-semibold uppercase text-slate-400 mb-1">Projeto vinculado</div>
                  <div className="text-slate-800 font-medium">{linkedProject.name}</div>
                  <div className="text-xs text-slate-500">{linkedProject.customer_name} · {linkedProject.vertical}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Nome</label>
                <input
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                  value={editValues.name}
                  onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Objetivo</label>
                <textarea
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                  rows={3}
                  value={editValues.objective}
                  onChange={(e) => setEditValues({ ...editValues, objective: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Status</label>
                  <select
                    className="w-full border border-slate-300 rounded-md px-2 py-2 text-sm"
                    value={editValues.status}
                    onChange={(e) => setEditValues({ ...editValues, status: e.target.value as PocStatus })}
                  >
                    {ALL_STATUSES.map((s) => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Início</label>
                  <input
                    type="date"
                    className="w-full border border-slate-300 rounded-md px-2 py-2 text-sm"
                    value={editValues.start_date}
                    onChange={(e) => setEditValues({ ...editValues, start_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Prazo final</label>
                  <input
                    type="date"
                    className="w-full border border-slate-300 rounded-md px-2 py-2 text-sm"
                    value={editValues.end_date}
                    onChange={(e) => setEditValues({ ...editValues, end_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Contato do cliente</label>
                  <input
                    className="w-full border border-slate-300 rounded-md px-2 py-2 text-sm"
                    value={editValues.customer_contact_name}
                    onChange={(e) => setEditValues({ ...editValues, customer_contact_name: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Cargo do contato</label>
                <input
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                  value={editValues.customer_contact_role}
                  onChange={(e) => setEditValues({ ...editValues, customer_contact_role: e.target.value })}
                />
              </div>

              {saveError && <p className="text-xs text-red-600">{saveError}</p>}

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-md px-3 py-2 disabled:opacity-50"
                >
                  {saving ? "Salvando..." : "Salvar alterações"}
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="text-xs font-semibold text-slate-600 border border-slate-300 rounded-md px-3 py-2 hover:bg-slate-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ================= LIST (KANBAN) VIEW =================
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Gestão de POC</h1>
          <p className="text-xs text-slate-500 mt-0.5">Provas de conceito em andamento, cruzando cliente, cronograma e resultado final.</p>
        </div>
        {canManage && (
          <button
            onClick={() => { setShowCreateModal(true); setCreateError(""); }}
            className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-md px-3 py-2"
          >
            <Plus size={14} />
            Nova POC
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {loading ? (
        <p className="text-xs text-slate-500">Carregando...</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
          {COLUMNS.map((col) => {
            const colPocs = pocs.filter((p) => col.statuses.includes(p.status));
            return (
              <div key={col.key} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-3 px-1">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                    {col.label}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400 bg-white border border-slate-200 rounded-full px-1.5">
                    {colPocs.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {colPocs.map((poc) => (
                    <button
                      key={poc.id}
                      onClick={() => openDetail(poc)}
                      className="w-full text-left bg-white border border-slate-200 rounded-md p-3 hover:border-emerald-400 hover:shadow-sm transition-all"
                    >
                      <div className="text-[11px] text-slate-500 mb-0.5">{clientLabel(poc)}</div>
                      <div className="text-sm font-semibold text-slate-900 leading-snug mb-2">{poc.name}</div>
                      {(poc.status === "completed_won" || poc.status === "completed_lost") && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${poc.status === "completed_won" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                          {poc.status === "completed_won" ? "GANHA" : "PERDIDA"}
                        </span>
                      )}
                    </button>
                  ))}
                  {colPocs.length === 0 && (
                    <div className="text-[11px] text-slate-400 italic px-1 py-2">Nenhuma POC aqui</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="font-bold text-slate-900">Nova POC</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setCreateForm({ ...createForm, mode: "project" })}
                  className={`flex-1 text-xs font-semibold rounded-md px-3 py-2 border ${createForm.mode === "project" ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-300 text-slate-600"}`}
                >
                  Vincular a projeto
                </button>
                <button
                  onClick={() => setCreateForm({ ...createForm, mode: "standalone" })}
                  className={`flex-1 text-xs font-semibold rounded-md px-3 py-2 border ${createForm.mode === "standalone" ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-300 text-slate-600"}`}
                >
                  POC avulsa
                </button>
              </div>

              {createForm.mode === "project" ? (
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Projeto</label>
                  <select
                    className="w-full border border-slate-300 rounded-md px-2 py-2 text-sm"
                    value={createForm.project_id}
                    onChange={(e) => setCreateForm({ ...createForm, project_id: e.target.value })}
                  >
                    <option value="">Selecione um projeto...</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} — {p.customer_name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Nome do cliente</label>
                    <input
                      className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                      value={createForm.standalone_customer_name}
                      onChange={(e) => setCreateForm({ ...createForm, standalone_customer_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Nome do contato</label>
                    <input
                      className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                      value={createForm.standalone_contact_name}
                      onChange={(e) => setCreateForm({ ...createForm, standalone_contact_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">E-mail</label>
                    <input
                      className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                      value={createForm.standalone_contact_email}
                      onChange={(e) => setCreateForm({ ...createForm, standalone_contact_email: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Telefone</label>
                    <input
                      className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                      value={createForm.standalone_contact_phone}
                      onChange={(e) => setCreateForm({ ...createForm, standalone_contact_phone: e.target.value })}
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Nome da POC</label>
                <input
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Objetivo</label>
                <textarea
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                  rows={3}
                  value={createForm.objective}
                  onChange={(e) => setCreateForm({ ...createForm, objective: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Início</label>
                  <input
                    type="date"
                    className="w-full border border-slate-300 rounded-md px-2 py-2 text-sm"
                    value={createForm.start_date}
                    onChange={(e) => setCreateForm({ ...createForm, start_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Prazo final</label>
                  <input
                    type="date"
                    className="w-full border border-slate-300 rounded-md px-2 py-2 text-sm"
                    value={createForm.end_date}
                    onChange={(e) => setCreateForm({ ...createForm, end_date: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Contato do cliente</label>
                  <input
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                    value={createForm.customer_contact_name}
                    onChange={(e) => setCreateForm({ ...createForm, customer_contact_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Cargo</label>
                  <input
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                    value={createForm.customer_contact_role}
                    onChange={(e) => setCreateForm({ ...createForm, customer_contact_role: e.target.value })}
                  />
                </div>
              </div>

              {createError && <p className="text-xs text-red-600">{createError}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200">
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-xs font-semibold text-slate-600 border border-slate-300 rounded-md px-3 py-2 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={submitCreate}
                disabled={creating}
                className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-md px-3 py-2 disabled:opacity-50"
              >
                {creating ? "Criando..." : "Criar POC"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
