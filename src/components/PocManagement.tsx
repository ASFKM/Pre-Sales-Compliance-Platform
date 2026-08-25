import { useEffect, useState } from "react";
import { Plus, X, ArrowLeft, Pen, Check, Trash2, Paperclip, TriangleAlert, Download, PackageSearch, BookMarked, FileUp, Truck, RefreshCw, Archive } from "lucide-react";
import { Poc, PocStatus, PocSuccessCriterion, PocEquipmentItem, PocEquipmentStatus, PocBomCandidate, Project } from "../types";
import ApiClient from "../lib/api";
import PocGanttChart from "./PocGanttChart";
import PocTestCases from "./PocTestCases";
import PocAcceptancePanel from "./PocAcceptancePanel";
import { BackgroundTask } from "../hooks/useBackgroundTasks";

const STATUS_LABEL: Record<PocStatus, string> = {
  not_started: "Não iniciada",
  planned: "Planejada",
  in_progress: "Em andamento",
  blocked: "Bloqueada",
  completed: "Concluída",
};

const EQUIPMENT_STATUS_LABEL: Record<PocEquipmentStatus, string> = {
  shipped: "Enviado",
  at_customer: "Na casa do cliente",
  returned: "Devolvido",
};

const EQUIPMENT_STATUS_COLOR: Record<PocEquipmentStatus, string> = {
  shipped: "bg-brand-50 text-brand-700",
  at_customer: "bg-warning-50 text-warning-700",
  returned: "bg-success-50 text-success-700",
};

const STATUS_BADGE_COLOR: Record<PocStatus, string> = {
  not_started: "bg-slate-100 text-slate-600",
  planned: "bg-brand-50 text-brand-700",
  in_progress: "bg-brand-100 text-brand-800",
  blocked: "bg-warning-50 text-warning-700",
  completed: "bg-slate-100 text-slate-700",
};

// Fase K: 5 real pipeline stages, 1:1 with PocStatus - won/lost no longer live here (that's
// PocAcceptance.decision, denormalized onto Poc.acceptance_decision), just a visual border on the
// card once it lands in "Concluída".
const COLUMNS: { key: PocStatus; label: string; dot: string }[] = [
  { key: "not_started", label: "Não iniciada", dot: "bg-slate-400" },
  { key: "planned", label: "Planejada", dot: "bg-brand-500" },
  { key: "in_progress", label: "Em andamento", dot: "bg-brand-700" },
  { key: "blocked", label: "Bloqueada", dot: "bg-warning-500" },
  { key: "completed", label: "Concluída", dot: "bg-slate-600" },
];

const ALL_STATUSES: PocStatus[] = ["not_started", "planned", "in_progress", "blocked", "completed"];

interface EditableFields {
  name: string;
  objective: string;
  status: PocStatus;
  start_date: string;
  end_date: string;
  customer_contact_name: string;
  customer_contact_role: string;
  address_zip: string;
  address_street: string;
  address_number: string;
  address_complement: string;
  address_neighborhood: string;
  address_city: string;
  address_state: string;
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
    address_zip: p.address_zip || "",
    address_street: p.address_street || "",
    address_number: p.address_number || "",
    address_complement: p.address_complement || "",
    address_neighborhood: p.address_neighborhood || "",
    address_city: p.address_city || "",
    address_state: p.address_state || "",
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
  activeTasks: BackgroundTask[];
  waitForTask: (taskId: string) => Promise<BackgroundTask>;
}

export default function PocManagement({ hasPermission, projects, activeTasks, waitForTask }: PocManagementProps) {
  const canManage = hasPermission("poc:manage");

  const [pocs, setPocs] = useState<Poc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedPocId, setSelectedPocId] = useState<string | null>(null);
  const [viewingArchivedPoc, setViewingArchivedPoc] = useState<Poc | null>(null);
  const [showArchivedModal, setShowArchivedModal] = useState(false);
  const [archivedPocs, setArchivedPocs] = useState<Poc[]>([]);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [dragPocId, setDragPocId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingPoc, setDeletingPoc] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Roadmap item (customer_request): explicit "Salvar" control on the Test Notebook/Schedule
  // screens - both already persist each row/change on its own (see PocTestCases.tsx/
  // PocGanttChart.tsx), so this button's real job is the not_started -> planned confirmation
  // below, not re-saving content that's already saved. showSaveStatusConfirm holds which screen
  // triggered it, just for the confirmation copy.
  const [showSaveStatusConfirm, setShowSaveStatusConfirm] = useState<"tests" | "gantt" | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [saveStatusFeedback, setSaveStatusFeedback] = useState("");

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState<EditableFields | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [cepLoading, setCepLoading] = useState(false);

  const [criteria, setCriteria] = useState<PocSuccessCriterion[]>([]);
  const [loadingCriteria, setLoadingCriteria] = useState(false);
  const [newCriterionText, setNewCriterionText] = useState("");
  const [addingCriterion, setAddingCriterion] = useState(false);

  const [detailTab, setDetailTab] = useState<"overview" | "equipment" | "gantt" | "tests" | "acceptance">("overview");
  const [equipment, setEquipment] = useState<PocEquipmentItem[]>([]);
  const [loadingEquipment, setLoadingEquipment] = useState(false);
  const [newEquipmentName, setNewEquipmentName] = useState("");
  const [newEquipmentSerial, setNewEquipmentSerial] = useState("");
  const [newEquipmentManufacturer, setNewEquipmentManufacturer] = useState("");
  const [newEquipmentPartNumber, setNewEquipmentPartNumber] = useState("");
  const [addingEquipment, setAddingEquipment] = useState(false);
  const [uploadingInvoice, setUploadingInvoice] = useState<string | null>(null);
  const [bomCandidates, setBomCandidates] = useState<PocBomCandidate[]>([]);
  const [loadingBomCandidates, setLoadingBomCandidates] = useState(false);
  const [importingBomItemId, setImportingBomItemId] = useState<string | null>(null);
  const [uploadingDatasheet, setUploadingDatasheet] = useState<string | null>(null);
  const [editingTrackingId, setEditingTrackingId] = useState<string | null>(null);
  const [trackingCodeInput, setTrackingCodeInput] = useState("");
  const [refreshingTrackingId, setRefreshingTrackingId] = useState<string | null>(null);
  const [trackingError, setTrackingError] = useState("");

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

  // A POC opened from the "Arquivadas" popup isn't in `pocs` (the board excludes archived by
  // design, see fetchPocs), so it's tracked separately rather than merged into the board's list.
  const selectedPoc = viewingArchivedPoc || pocs.find((p) => p.id === selectedPocId) || null;
  const linkedProject = selectedPoc?.project_id ? projects.find((pr) => pr.id === selectedPoc.project_id) || null : null;

  const fetchArchivedPocs = async () => {
    setLoadingArchived(true);
    try {
      const data = await ApiClient.get<Poc[]>("/api/pocs?archived=true");
      setArchivedPocs(Array.isArray(data) ? data : []);
    } catch (e) {
      setArchivedPocs([]);
    } finally {
      setLoadingArchived(false);
    }
  };

  const openArchivedModal = () => {
    setShowArchivedModal(true);
    fetchArchivedPocs();
  };

  const openArchivedDetail = (poc: Poc) => {
    setShowArchivedModal(false);
    setViewingArchivedPoc(poc);
    setIsEditing(false);
    setSaveError("");
    setDetailTab("overview");
    fetchCriteria(poc.id);
    fetchEquipment(poc.id);
    if (poc.project_id) {
      fetchBomCandidates(poc.id);
    }
  };

  const archivePoc = async () => {
    if (!selectedPoc) return;
    setArchiving(true);
    try {
      await ApiClient.put(`/api/pocs/${selectedPoc.id}/archive`, { archived: true });
      setViewingArchivedPoc(null);
      setSelectedPocId(null);
      await fetchPocs();
    } catch (e: any) {
      alert(e.message || "Não foi possível arquivar a POC.");
    } finally {
      setArchiving(false);
    }
  };

  const deletePocHandler = async () => {
    if (!selectedPoc) return;
    setDeletingPoc(true);
    setDeleteError("");
    try {
      await ApiClient.delete(`/api/pocs/${selectedPoc.id}`);
      setShowDeleteConfirm(false);
      setViewingArchivedPoc(null);
      setSelectedPocId(null);
      setIsEditing(false);
      await fetchPocs();
    } catch (e: any) {
      setDeleteError(e.message || "Não foi possível excluir a POC.");
    } finally {
      setDeletingPoc(false);
    }
  };

  const handlePocDrop = async (poc: Poc, newStatus: PocStatus) => {
    if (poc.status === newStatus) return;
    try {
      await ApiClient.put(`/api/pocs/${poc.id}`, { status: newStatus });
      await fetchPocs();
    } catch (e: any) {
      alert(e.message || "Não foi possível mover a POC.");
    }
  };

  const fetchCriteria = async (pocId: string) => {
    setLoadingCriteria(true);
    try {
      const data = await ApiClient.get<PocSuccessCriterion[]>(`/api/pocs/${pocId}/success-criteria`);
      setCriteria(Array.isArray(data) ? data : []);
    } catch (e) {
      setCriteria([]);
    } finally {
      setLoadingCriteria(false);
    }
  };

  const fetchEquipment = async (pocId: string) => {
    setLoadingEquipment(true);
    try {
      const data = await ApiClient.get<PocEquipmentItem[]>(`/api/pocs/${pocId}/equipment`);
      setEquipment(Array.isArray(data) ? data : []);
    } catch (e) {
      setEquipment([]);
    } finally {
      setLoadingEquipment(false);
    }
  };

  const fetchBomCandidates = async (pocId: string) => {
    setLoadingBomCandidates(true);
    try {
      const data = await ApiClient.get<PocBomCandidate[]>(`/api/pocs/${pocId}/equipment/bom-candidates`);
      setBomCandidates(Array.isArray(data) ? data : []);
    } catch (e) {
      setBomCandidates([]);
    } finally {
      setLoadingBomCandidates(false);
    }
  };

  const openDetail = (poc: Poc) => {
    setSelectedPocId(poc.id);
    setIsEditing(false);
    setSaveError("");
    setDetailTab("overview");
    fetchCriteria(poc.id);
    fetchEquipment(poc.id);
    if (poc.project_id) {
      fetchBomCandidates(poc.id);
    }
  };

  const backToList = () => {
    const wasViewingArchived = Boolean(viewingArchivedPoc);
    setSelectedPocId(null);
    setViewingArchivedPoc(null);
    setIsEditing(false);
    setCriteria([]);
    setNewCriterionText("");
    setEquipment([]);
    setBomCandidates([]);
    if (wasViewingArchived) {
      openArchivedModal();
    }
  };

  const addEquipmentItem = async () => {
    if (!selectedPoc || !newEquipmentName.trim()) return;
    setAddingEquipment(true);
    try {
      await ApiClient.post(`/api/pocs/${selectedPoc.id}/equipment`, {
        name: newEquipmentName.trim(),
        serial_number: newEquipmentSerial.trim() || undefined,
        manufacturer: newEquipmentManufacturer.trim() || undefined,
        part_number: newEquipmentPartNumber.trim() || undefined,
      });
      setNewEquipmentName("");
      setNewEquipmentSerial("");
      setNewEquipmentManufacturer("");
      setNewEquipmentPartNumber("");
      await fetchEquipment(selectedPoc.id);
    } catch (e: any) {
      alert(e.message || "Não foi possível adicionar o equipamento.");
    } finally {
      setAddingEquipment(false);
    }
  };

  const importEquipmentFromBom = async (candidate: PocBomCandidate) => {
    if (!selectedPoc) return;
    setImportingBomItemId(candidate.bom_item_id);
    try {
      await ApiClient.post(`/api/pocs/${selectedPoc.id}/equipment/from-bom`, { bom_item_id: candidate.bom_item_id });
      await Promise.all([fetchEquipment(selectedPoc.id), fetchBomCandidates(selectedPoc.id)]);
    } catch (e: any) {
      alert(e.message || "Não foi possível importar o item do BOM.");
    } finally {
      setImportingBomItemId(null);
    }
  };

  const uploadDatasheet = async (item: PocEquipmentItem, file: File) => {
    if (!selectedPoc) return;
    setUploadingDatasheet(item.id);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await ApiClient.post(`/api/pocs/${selectedPoc.id}/equipment/${item.id}/datasheet`, formData);
      await fetchEquipment(selectedPoc.id);
    } catch (e: any) {
      alert(e.message || "Não foi possível enviar o datasheet.");
    } finally {
      setUploadingDatasheet(null);
    }
  };

  const updateEquipmentStatus = async (item: PocEquipmentItem, status: PocEquipmentStatus) => {
    if (!selectedPoc) return;
    try {
      await ApiClient.put(`/api/pocs/${selectedPoc.id}/equipment/${item.id}`, { status });
      await fetchEquipment(selectedPoc.id);
    } catch (e: any) {
      alert(e.message || "Não foi possível atualizar o status.");
    }
  };

  const startEditTracking = (item: PocEquipmentItem) => {
    setEditingTrackingId(item.id);
    setTrackingCodeInput(item.tracking_code || "");
    setTrackingError("");
  };

  const saveTrackingCode = async (item: PocEquipmentItem) => {
    if (!selectedPoc) return;
    try {
      await ApiClient.put(`/api/pocs/${selectedPoc.id}/equipment/${item.id}`, { tracking_code: trackingCodeInput.trim() });
      setEditingTrackingId(null);
      await fetchEquipment(selectedPoc.id);
    } catch (e: any) {
      alert(e.message || "Não foi possível salvar o código de rastreio.");
    }
  };

  const refreshTracking = async (item: PocEquipmentItem) => {
    if (!selectedPoc) return;
    setRefreshingTrackingId(item.id);
    setTrackingError("");
    try {
      await ApiClient.post(`/api/pocs/${selectedPoc.id}/equipment/${item.id}/refresh-tracking`, {});
      await fetchEquipment(selectedPoc.id);
    } catch (e: any) {
      setTrackingError(e.message || "Não foi possível consultar o rastreio.");
    } finally {
      setRefreshingTrackingId(null);
    }
  };

  const removeEquipmentItem = async (item: PocEquipmentItem) => {
    if (!selectedPoc) return;
    try {
      await ApiClient.delete(`/api/pocs/${selectedPoc.id}/equipment/${item.id}`);
      await fetchEquipment(selectedPoc.id);
    } catch (e: any) {
      alert(e.message || "Não foi possível remover o equipamento.");
    }
  };

  const uploadInvoice = async (item: PocEquipmentItem, which: "shipping" | "return", file: File) => {
    if (!selectedPoc) return;
    setUploadingInvoice(`${item.id}:${which}`);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const path = which === "shipping" ? "shipping-invoice" : "return-invoice";
      await ApiClient.post(`/api/pocs/${selectedPoc.id}/equipment/${item.id}/${path}`, formData);
      await fetchEquipment(selectedPoc.id);
    } catch (e: any) {
      alert(e.message || "Não foi possível anexar o arquivo.");
    } finally {
      setUploadingInvoice(null);
    }
  };

  const downloadInvoice = (item: PocEquipmentItem, which: "shipping" | "return") => {
    if (!selectedPoc) return;
    const path = which === "shipping" ? "shipping-invoice" : "return-invoice";
    const token = localStorage.getItem("ca_session_token") || "";
    window.open(`/api/pocs/${selectedPoc.id}/equipment/${item.id}/${path}?token=${encodeURIComponent(token)}`, "_blank");
  };

  const equipmentPendingReturn = equipment.filter((e) => e.status !== "returned").length;
  const pocIsOverdue = selectedPoc ? new Date(selectedPoc.end_date) < new Date() : false;

  // Same "computed on render" idiom as pocIsOverdue above - no scheduler/notification
  // infrastructure exists in this codebase (confirmed before implementing), so this is the
  // realistic scope: a card-level visual cue, recomputed every render, not a real push alert.
  const pocStartDateArrived = (poc: Poc) => poc.status === "planned" && new Date(poc.start_date) <= new Date();

  const handleSaveClick = async (section: "tests" | "gantt") => {
    if (!selectedPoc) return;
    if (selectedPoc.status === "not_started") {
      setShowSaveStatusConfirm(section);
      return;
    }
    // Status already beyond "not_started" - every row already persists itself on change, so
    // there's nothing left to actually save here; just confirm to the user that it's saved.
    setSaveStatusFeedback("Salvo.");
    setTimeout(() => setSaveStatusFeedback(""), 2000);
  };

  const confirmSaveAndPlan = async () => {
    if (!selectedPoc) return;
    setSavingStatus(true);
    try {
      await ApiClient.put(`/api/pocs/${selectedPoc.id}`, { status: "planned" });
      await fetchPocs();
      setShowSaveStatusConfirm(null);
      setSaveStatusFeedback("Salvo - status agora é Planejada.");
      setTimeout(() => setSaveStatusFeedback(""), 2500);
    } catch (e: any) {
      alert(e.message || "Não foi possível salvar.");
    } finally {
      setSavingStatus(false);
    }
  };

  const addCriterion = async () => {
    if (!selectedPoc || !newCriterionText.trim()) return;
    setAddingCriterion(true);
    try {
      await ApiClient.post(`/api/pocs/${selectedPoc.id}/success-criteria`, { description: newCriterionText.trim() });
      setNewCriterionText("");
      await fetchCriteria(selectedPoc.id);
    } catch (e: any) {
      alert(e.message || "Não foi possível adicionar o critério.");
    } finally {
      setAddingCriterion(false);
    }
  };

  const toggleCriterion = async (criterion: PocSuccessCriterion) => {
    if (!selectedPoc) return;
    try {
      await ApiClient.put(`/api/pocs/${selectedPoc.id}/success-criteria/${criterion.id}`, { done: !criterion.done });
      await fetchCriteria(selectedPoc.id);
    } catch (e: any) {
      alert(e.message || "Não foi possível atualizar o critério.");
    }
  };

  const removeCriterion = async (criterion: PocSuccessCriterion) => {
    if (!selectedPoc) return;
    try {
      await ApiClient.delete(`/api/pocs/${selectedPoc.id}/success-criteria/${criterion.id}`);
      await fetchCriteria(selectedPoc.id);
    } catch (e: any) {
      alert(e.message || "Não foi possível remover o critério.");
    }
  };

  const startEdit = () => {
    if (!selectedPoc) return;
    setEditValues(toEditable(selectedPoc));
    setIsEditing(true);
    setSaveError("");
  };

  // Fase J: ViaCEP lookup proxied through the backend (GET /api/pocs/cep/:cep) - the app's CSP
  // pins connect-src to 'self', so a direct browser fetch to viacep.com.br would be blocked.
  const lookupCep = async (rawCep: string) => {
    const cep = rawCep.replace(/\D/g, "");
    if (cep.length !== 8 || !editValues) return;
    setCepLoading(true);
    try {
      const data = await ApiClient.get<{ street: string; neighborhood: string; city: string; state: string }>(`/api/pocs/cep/${cep}`);
      setEditValues((prev) =>
        prev
          ? {
              ...prev,
              address_street: data.street || prev.address_street,
              address_neighborhood: data.neighborhood || prev.address_neighborhood,
              address_city: data.city || prev.address_city,
              address_state: data.state || prev.address_state,
            }
          : prev
      );
    } catch {
      // Silent - CEP autofill is a convenience, not a required step; the user can still fill
      // street/city/state manually if the CEP isn't found or ViaCEP is unreachable.
    } finally {
      setCepLoading(false);
    }
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
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-5 space-y-4">
        <button
          onClick={backToList}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft size={14} />
          {viewingArchivedPoc ? "Voltar para Arquivadas" : "Voltar para Gestão de POC"}
        </button>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs text-slate-500 mb-1">{clientLabel(selectedPoc)}</div>
              <h1 className="text-lg font-bold text-slate-900">{selectedPoc.name}</h1>
            </div>
            <div className="flex items-center gap-2">
              {selectedPoc.acceptance_decision && selectedPoc.acceptance_decision !== "pending" && (
                <span className={`text-[10px] font-bold px-2 py-1 rounded ${selectedPoc.acceptance_decision === "won" ? "bg-success-50 text-success-700" : "bg-danger-50 text-danger-700"}`}>
                  {selectedPoc.acceptance_decision === "won" ? "GANHA" : "PERDIDA"}
                </span>
              )}
              <span className={`text-xs font-semibold px-3 py-1 rounded-full ${STATUS_BADGE_COLOR[selectedPoc.status]}`}>
                {STATUS_LABEL[selectedPoc.status]}
              </span>
              {canManage && selectedPoc.status === "completed" && !selectedPoc.archived && (
                <button
                  onClick={archivePoc}
                  disabled={archiving}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 border border-slate-300 rounded-md px-2.5 py-1 hover:bg-slate-50 disabled:opacity-60"
                >
                  {archiving ? "Arquivando..." : "Arquivar"}
                </button>
              )}
              {canManage && !isEditing && selectedPoc.status !== "completed" && (
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

        <div className="flex items-center gap-5 border-b border-slate-200 -mt-1">
          <button
            onClick={() => setDetailTab("overview")}
            className={`h-9 px-1 border-b-2 transition-all text-xs font-bold uppercase tracking-wider ${detailTab === "overview" ? "border-brand-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
          >
            Visão Geral
          </button>
          <button
            onClick={() => setDetailTab("equipment")}
            className={`h-9 px-1 border-b-2 transition-all text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${detailTab === "equipment" ? "border-brand-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
          >
            Equipamento
            {equipmentPendingReturn > 0 && pocIsOverdue && (
              <span className="w-1.5 h-1.5 rounded-full bg-warning-500" />
            )}
          </button>
          <button
            onClick={() => setDetailTab("tests")}
            className={`h-9 px-1 border-b-2 transition-all text-xs font-bold uppercase tracking-wider ${detailTab === "tests" ? "border-brand-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
          >
            Cadernos de Teste
          </button>
          <button
            onClick={() => setDetailTab("gantt")}
            className={`h-9 px-1 border-b-2 transition-all text-xs font-bold uppercase tracking-wider ${detailTab === "gantt" ? "border-brand-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
          >
            Cronograma
          </button>
          <button
            onClick={() => setDetailTab("acceptance")}
            className={`h-9 px-1 border-b-2 transition-all text-xs font-bold uppercase tracking-wider ${detailTab === "acceptance" ? "border-brand-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
          >
            Aceite do Cliente
          </button>
        </div>

        {detailTab === "overview" && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700 mb-4">Visão Geral</h2>

          {!isEditing || !editValues ? (
            <div className="space-y-4 text-sm">
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono mb-1">Objetivo</div>
                <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">{selectedPoc.objective}</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono mb-1">Início</div>
                  <div className="text-slate-800 font-medium">{selectedPoc.start_date}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono mb-1">Prazo final</div>
                  <div className="text-slate-800 font-medium">{selectedPoc.end_date}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono mb-1">Contato do cliente</div>
                  <div className="text-slate-800 font-medium">{selectedPoc.customer_contact_name}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono mb-1">Cargo</div>
                  <div className="text-slate-800 font-medium">{selectedPoc.customer_contact_role}</div>
                </div>
              </div>
              {linkedProject && (
                <div className="border border-dashed border-slate-300 rounded-lg p-3 bg-slate-50">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono mb-1">Projeto vinculado</div>
                  <div className="text-slate-800 font-medium">{linkedProject.name}</div>
                  <div className="text-xs text-slate-500">{linkedProject.customer_name} · {linkedProject.vertical}</div>
                </div>
              )}

              <div>
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono mb-1">Local da POC</div>
                {selectedPoc.address_street || selectedPoc.address_city ? (
                  <div className="text-slate-700">
                    {[
                      [selectedPoc.address_street, selectedPoc.address_number].filter(Boolean).join(", "),
                      selectedPoc.address_complement,
                      selectedPoc.address_neighborhood,
                      [selectedPoc.address_city, selectedPoc.address_state].filter(Boolean).join(" - "),
                      selectedPoc.address_zip,
                    ].filter(Boolean).join(" · ")}
                  </div>
                ) : (
                  <div className="text-slate-400 italic text-xs">Endereço não informado.</div>
                )}
              </div>

              <div>
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono mb-2">Stakeholders</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="flex items-center gap-2 border border-slate-200 rounded-md px-3 py-2 bg-brand-50/40">
                    <span className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 text-[11px] font-bold flex items-center justify-center shrink-0">
                      {(selectedPoc.owner_name || "?").slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <div className="text-xs font-semibold text-slate-800">{selectedPoc.owner_name || "Responsável interno"}</div>
                      <div className="text-[11px] text-slate-500">Responsável interno</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 border border-slate-200 rounded-md px-3 py-2 bg-slate-50/40">
                    <span className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 text-[11px] font-bold flex items-center justify-center shrink-0">
                      {selectedPoc.customer_contact_name.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <div className="text-xs font-semibold text-slate-800">{selectedPoc.customer_contact_name}</div>
                      <div className="text-[11px] text-slate-500">{selectedPoc.customer_contact_role} · cliente</div>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono mb-2">Critérios de sucesso</div>
                {loadingCriteria ? (
                  <p className="text-xs text-slate-400">Carregando...</p>
                ) : (
                  <div className="space-y-1.5">
                    {criteria.map((c) => (
                      <div
                        key={c.id}
                        className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm ${c.done ? "bg-success-50 border-success-100" : "bg-slate-50 border-slate-200"}`}
                      >
                        <button
                          onClick={() => canManage && toggleCriterion(c)}
                          disabled={!canManage}
                          className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${c.done ? "bg-success-600 border-success-600 text-white" : "border-slate-300 bg-white"}`}
                        >
                          {c.done && <Check size={12} />}
                        </button>
                        <span className={`flex-1 ${c.done ? "text-slate-500 line-through" : "text-slate-800"}`}>{c.description}</span>
                        {canManage && (
                          <button onClick={() => removeCriterion(c)} className="text-slate-300 hover:text-danger-500">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                    {criteria.length === 0 && (
                      <p className="text-xs text-slate-400 italic">Nenhum critério de sucesso definido ainda.</p>
                    )}
                  </div>
                )}
                {canManage && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      className="flex-1 p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs"
                      placeholder="Novo critério de sucesso..."
                      value={newCriterionText}
                      onChange={(e) => setNewCriterionText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") addCriterion(); }}
                    />
                    <button
                      onClick={addCriterion}
                      disabled={addingCriterion || !newCriterionText.trim()}
                      className="bg-brand-600 hover:bg-brand-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer disabled:opacity-60"
                    >
                      Adicionar
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Nome</label>
                <input
                  className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                  value={editValues.name}
                  onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Objetivo</label>
                <textarea
                  className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                  rows={3}
                  value={editValues.objective}
                  onChange={(e) => setEditValues({ ...editValues, objective: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Status</label>
                  <select
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                    value={editValues.status}
                    onChange={(e) => setEditValues({ ...editValues, status: e.target.value as PocStatus })}
                  >
                    {ALL_STATUSES.map((s) => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Início</label>
                  <input
                    type="date"
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                    value={editValues.start_date}
                    onChange={(e) => setEditValues({ ...editValues, start_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Prazo final</label>
                  <input
                    type="date"
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                    value={editValues.end_date}
                    onChange={(e) => setEditValues({ ...editValues, end_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Contato do cliente</label>
                  <input
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                    value={editValues.customer_contact_name}
                    onChange={(e) => setEditValues({ ...editValues, customer_contact_name: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Cargo do contato</label>
                <input
                  className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                  value={editValues.customer_contact_role}
                  onChange={(e) => setEditValues({ ...editValues, customer_contact_role: e.target.value })}
                />
              </div>

              <div className="pt-3 mt-1 border-t border-slate-100">
                <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-700 mb-3">Local da POC</h3>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">CEP</label>
                    <input
                      className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                      placeholder="00000-000"
                      value={editValues.address_zip}
                      onChange={(e) => setEditValues({ ...editValues, address_zip: e.target.value })}
                      onBlur={(e) => lookupCep(e.target.value)}
                    />
                    {cepLoading && <p className="text-[10px] text-slate-400 mt-1">Buscando...</p>}
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Rua</label>
                    <input
                      className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                      value={editValues.address_street}
                      onChange={(e) => setEditValues({ ...editValues, address_street: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Número</label>
                    <input
                      className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                      value={editValues.address_number}
                      onChange={(e) => setEditValues({ ...editValues, address_number: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Complemento</label>
                    <input
                      className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                      value={editValues.address_complement}
                      onChange={(e) => setEditValues({ ...editValues, address_complement: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Bairro</label>
                    <input
                      className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                      value={editValues.address_neighborhood}
                      onChange={(e) => setEditValues({ ...editValues, address_neighborhood: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Cidade</label>
                    <input
                      className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                      value={editValues.address_city}
                      onChange={(e) => setEditValues({ ...editValues, address_city: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">UF</label>
                    <input
                      className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                      maxLength={2}
                      value={editValues.address_state}
                      onChange={(e) => setEditValues({ ...editValues, address_state: e.target.value.toUpperCase() })}
                    />
                  </div>
                </div>
              </div>

              {saveError && <div className="p-3 rounded bg-warning-50 border border-warning-200 text-warning-900 text-xs">{saveError}</div>}

              <div className="flex items-center gap-2 pt-4 mt-2 border-t border-slate-200">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 font-mono text-xs cursor-pointer text-slate-500"
                >
                  Cancelar
                </button>
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  className="bg-brand-600 hover:bg-brand-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Salvar alterações"}
                </button>
                <button
                  onClick={() => { setDeleteError(""); setShowDeleteConfirm(true); }}
                  className="ml-auto bg-danger-600 hover:bg-danger-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer"
                >
                  Excluir POC
                </button>
              </div>
            </div>
          )}
        </div>
        )}

        {detailTab === "equipment" && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">Equipamento</h2>

          {equipmentPendingReturn > 0 && pocIsOverdue && (
            <div className="flex items-center gap-2 bg-warning-50 border border-warning-200 text-warning-800 text-xs rounded-md px-3 py-2">
              <TriangleAlert size={14} className="shrink-0" />
              A POC já passou do prazo final e {equipmentPendingReturn} {equipmentPendingReturn === 1 ? "item ainda não tem" : "itens ainda não têm"} devolução registrada.
            </div>
          )}

          {trackingError && (
            <div className="flex items-center gap-2 bg-warning-50 border border-warning-200 text-warning-800 text-xs rounded-md px-3 py-2">
              <TriangleAlert size={14} className="shrink-0" />
              {trackingError}
            </div>
          )}

          {loadingEquipment ? (
            <p className="text-xs text-slate-400">Carregando...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Equipamento</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Base de Conhecimento</th>
                    <th className="py-2 pr-3">Datasheet</th>
                    <th className="py-2 pr-3">NF de envio</th>
                    <th className="py-2 pr-3">NF de devolução</th>
                    {canManage && <th className="py-2 pr-3 text-right">Ações</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {equipment.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold text-slate-800">{item.name}</div>
                        {item.serial_number && <div className="text-[11px] text-slate-400 font-mono">{item.serial_number}</div>}
                      </td>
                      <td className="py-2.5 pr-3">
                        {editingTrackingId === item.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              autoFocus
                              className="w-28 p-1 text-[11px] rounded bg-white border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none"
                              placeholder="Código de rastreio"
                              value={trackingCodeInput}
                              onChange={(e) => setTrackingCodeInput(e.target.value)}
                            />
                            <button onClick={() => saveTrackingCode(item)} className="text-brand-600 hover:text-brand-800"><Check size={13} /></button>
                            <button onClick={() => setEditingTrackingId(null)} className="text-slate-300 hover:text-slate-500"><X size={13} /></button>
                          </div>
                        ) : item.tracking_code ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1">
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 bg-brand-50 rounded-full px-2 py-1" title={item.tracking_last_checked_at ? `Última consulta: ${new Date(item.tracking_last_checked_at).toLocaleString("pt-BR")}` : "Ainda não consultado"}>
                                <Truck size={11} />
                                {item.tracking_carrier_status || "Aguardando 1ª consulta"}
                              </span>
                              {canManage && (
                                <button
                                  onClick={() => refreshTracking(item)}
                                  disabled={refreshingTrackingId === item.id}
                                  className="text-slate-400 hover:text-slate-700 disabled:opacity-50"
                                  title="Atualizar rastreio"
                                >
                                  <RefreshCw size={12} className={refreshingTrackingId === item.id ? "animate-spin" : ""} />
                                </button>
                              )}
                            </div>
                            {canManage && (
                              <button onClick={() => startEditTracking(item)} className="text-[10px] text-slate-400 hover:text-slate-600 font-mono">
                                {item.tracking_code}
                              </button>
                            )}
                          </div>
                        ) : canManage ? (
                          <div className="flex items-center gap-1.5">
                            <select
                              className={`text-[11px] font-semibold rounded-full px-2 py-1 border-0 ${EQUIPMENT_STATUS_COLOR[item.status]}`}
                              value={item.status}
                              onChange={(e) => updateEquipmentStatus(item, e.target.value as PocEquipmentStatus)}
                            >
                              {(["shipped", "at_customer", "returned"] as PocEquipmentStatus[]).map((s) => (
                                <option key={s} value={s}>{EQUIPMENT_STATUS_LABEL[s]}</option>
                              ))}
                            </select>
                            <button onClick={() => startEditTracking(item)} className="text-[10px] text-slate-400 hover:text-slate-600 underline decoration-dotted" title="Configurar rastreio real da transportadora">
                              + rastreio
                            </button>
                          </div>
                        ) : (
                          <span className={`text-[11px] font-semibold rounded-full px-2 py-1 ${EQUIPMENT_STATUS_COLOR[item.status]}`}>
                            {EQUIPMENT_STATUS_LABEL[item.status]}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        {item.kb_match_count > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-success-700 bg-success-50 rounded-full px-2 py-1" title="Casos de teste e cronograma são gerados com base neste conhecimento">
                            <BookMarked size={11} />
                            {item.kb_match_count} {item.kb_match_count === 1 ? "referência" : "referências"}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-300">sem correspondência</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        {item.datasheet_knowledge_base_document_id ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-success-700 bg-success-50 rounded-md px-2 py-1">
                            <Check size={11} />
                            Enviado
                          </span>
                        ) : canManage ? (
                          <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 border border-dashed border-slate-300 rounded-md px-2 py-1 cursor-pointer hover:bg-slate-50">
                            <FileUp size={11} />
                            {uploadingDatasheet === item.id ? "Enviando..." : "Anexar"}
                            <input
                              type="file"
                              className="hidden"
                              disabled={uploadingDatasheet === item.id}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) uploadDatasheet(item, f);
                                e.target.value = "";
                              }}
                            />
                          </label>
                        ) : (
                          <span className="text-[11px] text-slate-300">pendente</span>
                        )}
                      </td>
                      {(["shipping", "return"] as const).map((which) => {
                        const filename = which === "shipping" ? item.shipping_invoice_original_filename : item.return_invoice_original_filename;
                        const busy = uploadingInvoice === `${item.id}:${which}`;
                        return (
                          <td className="py-2.5 pr-3" key={which}>
                            {filename ? (
                              <button
                                onClick={() => downloadInvoice(item, which)}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-success-700 bg-success-50 rounded-md px-2 py-1 hover:bg-success-100"
                              >
                                <Download size={11} />
                                {filename.length > 18 ? filename.slice(0, 16) + "…" : filename}
                              </button>
                            ) : canManage ? (
                              <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 border border-dashed border-slate-300 rounded-md px-2 py-1 cursor-pointer hover:bg-slate-50">
                                <Paperclip size={11} />
                                {busy ? "Enviando..." : "Anexar"}
                                <input
                                  type="file"
                                  className="hidden"
                                  disabled={busy}
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) uploadInvoice(item, which, f);
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                            ) : (
                              <span className="text-[11px] text-slate-300">pendente</span>
                            )}
                          </td>
                        );
                      })}
                      {canManage && (
                        <td className="py-2.5 pr-3 text-right">
                          <button onClick={() => removeEquipmentItem(item)} className="text-slate-300 hover:text-danger-500">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {equipment.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-4 text-center text-slate-400 italic">Nenhum equipamento registrado ainda.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {canManage && selectedPoc.project_id && (bomCandidates.length > 0 || loadingBomCandidates) && (
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider font-mono text-slate-700">
                <PackageSearch size={13} />
                Adicionar do BOM do projeto
              </div>
              {loadingBomCandidates ? (
                <p className="text-xs text-slate-400">Carregando itens do BOM...</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {bomCandidates.map((c) => (
                    <button
                      key={c.bom_item_id}
                      onClick={() => importEquipmentFromBom(c)}
                      disabled={importingBomItemId === c.bom_item_id}
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 hover:bg-slate-100 disabled:opacity-60"
                    >
                      <Plus size={11} />
                      {c.equipment_name}
                      {c.manufacturer && <span className="text-slate-400 font-normal">· {c.manufacturer}</span>}
                      {c.part_number && <span className="text-slate-400 font-normal font-mono">· PN {c.part_number}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {canManage && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
              <input
                className="flex-1 min-w-[180px] p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs"
                placeholder="Nome do equipamento (ex: Firewall NGFW XG-3400)"
                value={newEquipmentName}
                onChange={(e) => setNewEquipmentName(e.target.value)}
              />
              <input
                className="w-32 p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs"
                placeholder="Fabricante (opcional)"
                value={newEquipmentManufacturer}
                onChange={(e) => setNewEquipmentManufacturer(e.target.value)}
              />
              <input
                className="w-32 p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs"
                placeholder="Part number (opcional)"
                value={newEquipmentPartNumber}
                onChange={(e) => setNewEquipmentPartNumber(e.target.value)}
              />
              <input
                className="w-32 p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs"
                placeholder="Serial (opcional)"
                value={newEquipmentSerial}
                onChange={(e) => setNewEquipmentSerial(e.target.value)}
              />
              <button
                onClick={addEquipmentItem}
                disabled={addingEquipment || !newEquipmentName.trim()}
                className="bg-brand-600 hover:bg-brand-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer disabled:opacity-60 whitespace-nowrap"
              >
                Adicionar
              </button>
            </div>
          )}
        </div>
        )}

        {detailTab === "tests" && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">Cadernos de Teste</h2>
            {canManage && (
              <div className="flex items-center gap-2">
                {saveStatusFeedback && <span className="text-[11px] text-success-700 font-semibold">{saveStatusFeedback}</span>}
                <button
                  onClick={() => handleSaveClick("tests")}
                  className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer"
                >
                  <Check size={13} />
                  Salvar
                </button>
              </div>
            )}
          </div>
          <PocTestCases pocId={selectedPoc.id} canManage={canManage} activeTasks={activeTasks} waitForTask={waitForTask} />
        </div>
        )}

        {detailTab === "gantt" && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">Cronograma</h2>
            {canManage && (
              <div className="flex items-center gap-2">
                {saveStatusFeedback && <span className="text-[11px] text-success-700 font-semibold">{saveStatusFeedback}</span>}
                <button
                  onClick={() => handleSaveClick("gantt")}
                  className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer"
                >
                  <Check size={13} />
                  Salvar
                </button>
              </div>
            )}
          </div>
          <PocGanttChart poc={selectedPoc} canManage={canManage} activeTasks={activeTasks} waitForTask={waitForTask} />
        </div>
        )}

        {detailTab === "acceptance" && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700 mb-4">Aceite do Cliente</h2>
          <PocAcceptancePanel
            pocId={selectedPoc.id}
            canManage={canManage}
            pocStatus={selectedPoc.status}
            onPocUpdated={() => { fetchPocs(); if (viewingArchivedPoc) fetchArchivedPocs(); }}
          />
        </div>
        )}

        {showSaveStatusConfirm && selectedPoc && (
          <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl border border-slate-200 w-[420px] overflow-hidden shadow-2xl">
              <div className="bg-brand-600 text-white p-4 flex justify-between items-center">
                <h3 className="text-sm font-bold uppercase font-mono tracking-wider">Confirmar</h3>
                <button onClick={() => setShowSaveStatusConfirm(null)} className="text-brand-100 hover:text-white cursor-pointer">
                  <X size={16} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-sm text-slate-700">
                  Ao salvar, o status desta POC vai mudar de <span className="font-semibold">"Não iniciada"</span> para
                  <span className="font-semibold"> "Planejada"</span>. Confirma?
                </p>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => setShowSaveStatusConfirm(null)}
                    className="px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 font-mono text-xs cursor-pointer text-slate-500"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmSaveAndPlan}
                    disabled={savingStatus}
                    className="bg-brand-600 hover:bg-brand-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer disabled:opacity-60"
                  >
                    {savingStatus ? "Salvando..." : "Confirmar"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl border border-slate-200 w-[420px] overflow-hidden shadow-2xl">
              <div className="bg-danger-600 text-white p-4 flex justify-between items-center">
                <h3 className="text-sm font-bold uppercase font-mono tracking-wider">Excluir POC</h3>
                <button onClick={() => setShowDeleteConfirm(false)} className="text-danger-100 hover:text-white cursor-pointer">
                  <X size={16} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-sm text-slate-700">
                  Tem certeza que deseja excluir a POC <span className="font-semibold">"{selectedPoc.name}"</span>? Essa ação
                  remove permanentemente o equipamento, cronograma, casos de teste, relatório final e aceite associados, e
                  <span className="font-semibold"> não pode ser desfeita</span>.
                </p>
                {deleteError && <div className="p-3 rounded bg-warning-50 border border-warning-200 text-warning-900 text-xs">{deleteError}</div>}
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 font-mono text-xs cursor-pointer text-slate-500"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={deletePocHandler}
                    disabled={deletingPoc}
                    className="bg-danger-600 hover:bg-danger-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer disabled:opacity-60"
                  >
                    {deletingPoc ? "Excluindo..." : "Excluir definitivamente"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ================= LIST (KANBAN) VIEW =================
  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-5 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        {canManage && (
          <button
            onClick={() => { setShowCreateModal(true); setCreateError(""); }}
            className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer"
          >
            <Plus size={14} />
            Nova POC
          </button>
        )}
        <button
          onClick={openArchivedModal}
          className="inline-flex items-center gap-1.5 border border-slate-300 text-slate-600 hover:bg-slate-50 font-mono text-xs font-bold py-1.5 px-4 rounded transition-all cursor-pointer"
        >
          <Archive size={13} />
          Arquivadas
        </button>
      </div>

      {error && <p className="text-xs text-danger-600">{error}</p>}
      {loading ? (
        <p className="text-xs text-slate-500">Carregando...</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-start">
          {COLUMNS.map((col) => {
            const colPocs = pocs.filter((p) => p.status === col.key);
            return (
              <div
                key={col.key}
                className="bg-slate-50 border border-slate-200 rounded-lg p-3"
                onDragOver={(e) => { if (canManage && dragPocId) e.preventDefault(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!canManage || !dragPocId) return;
                  const dragged = pocs.find((p) => p.id === dragPocId);
                  setDragPocId(null);
                  if (dragged) handlePocDrop(dragged, col.key);
                }}
              >
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
                  {colPocs.map((poc) => {
                    const borderColor =
                      poc.acceptance_decision === "won" ? "border-success-400" :
                      poc.acceptance_decision === "lost" ? "border-danger-300" :
                      "border-slate-200";
                    const startArrived = pocStartDateArrived(poc);
                    return (
                    <button
                      key={poc.id}
                      draggable={canManage}
                      onDragStart={(e) => { setDragPocId(poc.id); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => setDragPocId(null)}
                      onClick={() => openDetail(poc)}
                      title={startArrived ? "Data de início já chegou - atualize o status para \"Em andamento\"" : undefined}
                      className={`w-full text-left bg-white border-2 ${borderColor} rounded-md p-3 hover:border-brand-400 hover:shadow-sm transition-all ${canManage ? "cursor-grab active:cursor-grabbing" : ""} ${startArrived ? "animate-poc-start-glow" : ""}`}
                    >
                      <div className="text-[11px] text-slate-500 mb-0.5">{clientLabel(poc)}</div>
                      <div className="text-sm font-semibold text-slate-900 leading-snug mb-2">{poc.name}</div>
                      {poc.acceptance_decision && poc.acceptance_decision !== "pending" && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${poc.acceptance_decision === "won" ? "bg-success-50 text-success-700" : "bg-danger-50 text-danger-700"}`}>
                          {poc.acceptance_decision === "won" ? "GANHA" : "PERDIDA"}
                        </span>
                      )}
                    </button>
                    );
                  })}
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
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-slate-200 w-[600px] overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="bg-slate-950 text-white p-4 flex justify-between items-center shrink-0">
              <h3 className="text-sm font-bold uppercase font-mono tracking-wider">Nova POC</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs text-slate-700 overflow-y-auto flex-1">
              <div className="flex gap-2">
                <button
                  onClick={() => setCreateForm({ ...createForm, mode: "project" })}
                  className={`flex-1 font-mono text-xs font-bold py-1.5 px-3 rounded border transition-all ${createForm.mode === "project" ? "bg-brand-600 border-brand-600 text-white" : "border-slate-300 text-slate-500 hover:bg-slate-50"}`}
                >
                  Vincular a projeto
                </button>
                <button
                  onClick={() => setCreateForm({ ...createForm, mode: "standalone" })}
                  className={`flex-1 font-mono text-xs font-bold py-1.5 px-3 rounded border transition-all ${createForm.mode === "standalone" ? "bg-brand-600 border-brand-600 text-white" : "border-slate-300 text-slate-500 hover:bg-slate-50"}`}
                >
                  POC avulsa
                </button>
              </div>

              {createForm.mode === "project" ? (
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Projeto</label>
                  <select
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Nome do cliente</label>
                    <input
                      className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                      value={createForm.standalone_customer_name}
                      onChange={(e) => setCreateForm({ ...createForm, standalone_customer_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Nome do contato</label>
                    <input
                      className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                      value={createForm.standalone_contact_name}
                      onChange={(e) => setCreateForm({ ...createForm, standalone_contact_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">E-mail</label>
                    <input
                      className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                      value={createForm.standalone_contact_email}
                      onChange={(e) => setCreateForm({ ...createForm, standalone_contact_email: e.target.value })}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Telefone</label>
                    <input
                      className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                      value={createForm.standalone_contact_phone}
                      onChange={(e) => setCreateForm({ ...createForm, standalone_contact_phone: e.target.value })}
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Nome da POC</label>
                <input
                  className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Objetivo</label>
                <textarea
                  className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none h-20"
                  value={createForm.objective}
                  onChange={(e) => setCreateForm({ ...createForm, objective: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Início</label>
                  <input
                    type="date"
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                    value={createForm.start_date}
                    onChange={(e) => setCreateForm({ ...createForm, start_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Prazo final</label>
                  <input
                    type="date"
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                    value={createForm.end_date}
                    onChange={(e) => setCreateForm({ ...createForm, end_date: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Contato do cliente</label>
                  <input
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                    value={createForm.customer_contact_name}
                    onChange={(e) => setCreateForm({ ...createForm, customer_contact_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Cargo</label>
                  <input
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-sans text-slate-800"
                    value={createForm.customer_contact_role}
                    onChange={(e) => setCreateForm({ ...createForm, customer_contact_role: e.target.value })}
                  />
                </div>
              </div>

              {createError && <div className="p-3 rounded bg-warning-50 border border-warning-200 text-warning-900 text-xs">{createError}</div>}

              <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-slate-200">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 font-mono text-xs cursor-pointer text-slate-500"
                >
                  Cancelar
                </button>
                <button
                  onClick={submitCreate}
                  disabled={creating}
                  className="bg-brand-600 hover:bg-brand-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer disabled:opacity-60"
                >
                  {creating ? "Criando..." : "Criar POC"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showArchivedModal && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-slate-200 w-[520px] overflow-hidden shadow-2xl flex flex-col max-h-[80vh]">
            <div className="bg-slate-950 text-white p-4 flex justify-between items-center shrink-0">
              <h3 className="text-sm font-bold uppercase font-mono tracking-wider flex items-center gap-2">
                <Archive size={14} />
                POCs Arquivadas
              </h3>
              <button onClick={() => setShowArchivedModal(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-2 overflow-y-auto flex-1">
              {loadingArchived ? (
                <p className="text-xs text-slate-400">Carregando...</p>
              ) : archivedPocs.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-6 text-center">Nenhuma POC arquivada ainda.</p>
              ) : (
                archivedPocs.map((poc) => (
                  <button
                    key={poc.id}
                    onClick={() => openArchivedDetail(poc)}
                    className="w-full text-left bg-slate-50 border border-slate-200 rounded-md p-3 hover:border-brand-400 hover:bg-white transition-all"
                  >
                    <div className="text-[11px] text-slate-500 mb-0.5">{clientLabel(poc)}</div>
                    <div className="text-sm font-semibold text-slate-900 leading-snug">{poc.name}</div>
                    {poc.acceptance_decision && poc.acceptance_decision !== "pending" && (
                      <span className={`inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded ${poc.acceptance_decision === "won" ? "bg-success-50 text-success-700" : "bg-danger-50 text-danger-700"}`}>
                        {poc.acceptance_decision === "won" ? "GANHA" : "PERDIDA"}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
