import { useState } from "react";
import { Pen, Trash2, FolderOpen, X } from "lucide-react";
import { Project } from "../types";
import ApiClient from "../lib/api";
import ProjectFieldsForm, { ProjectFieldsValues } from "./modals/ProjectFieldsForm";

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  analysis_in_progress: "Análise em Andamento",
  waiting_customer: "Aguardando Cliente",
  waiting_internal: "Aguardando Interno",
  completed: "Concluído",
  canceled: "Cancelado",
};

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  analysis_in_progress: "bg-blue-50 text-blue-700",
  waiting_customer: "bg-amber-50 text-amber-700",
  waiting_internal: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  canceled: "bg-red-50 text-red-700",
};

function projectToFormValues(p: Project): ProjectFieldsValues {
  return {
    name: p.name,
    customer_name: p.customer_name,
    opportunity_name: p.opportunity_name,
    vertical: p.vertical,
    description: p.description,
    deadline: p.deadline ? p.deadline.substring(0, 10) : "",
    proposal_validity_date: p.proposal_validity_date ? p.proposal_validity_date.substring(0, 10) : "",
    output_language: p.output_language,
    proposal_language: p.proposal_language,
    ai_orientation_mode: p.ai_orientation_mode,
    ai_orientation_text: p.ai_orientation_text,
    selected_approval_workflow_id: p.selected_approval_workflow_id,
    procurement_modality: p.procurement_modality || "",
    procurement_subtype: p.procurement_subtype || "",
    custom_modality: p.custom_modality || "",
    brand_style_id: p.brand_style_id ?? null,
  };
}

interface ProjectsListProps {
  locale: string;
  projects: Project[];
  hasPermission: (permission: string) => boolean;
  onOpenProject: (projectId: string) => void;
  onProjectsChanged: () => void;
}

export default function ProjectsList({ locale, projects, hasPermission, onOpenProject, onProjectsChanged }: ProjectsListProps) {
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editValues, setEditValues] = useState<ProjectFieldsValues | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const canEdit = hasPermission("project:update");
  const canDelete = hasPermission("project:delete");

  const openEdit = (p: Project) => {
    setEditingProject(p);
    setEditValues(projectToFormValues(p));
    setEditError("");
  };

  const saveEdit = async () => {
    if (!editingProject || !editValues) return;
    setSavingEdit(true);
    setEditError("");
    try {
      await ApiClient.put(`/api/projects/${editingProject.id}`, editValues);
      setEditingProject(null);
      setEditValues(null);
      onProjectsChanged();
    } catch (e: any) {
      setEditError(e.message || "Não foi possível salvar as alterações.");
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await ApiClient.delete(`/api/projects/${id}`);
      setConfirmDeleteId(null);
      onProjectsChanged();
    } catch (e: any) {
      alert(e.message || "Não foi possível excluir o projeto.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">Todos os Projetos ({projects.length})</h2>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
            <tr>
              <th className="p-3">Projeto</th>
              <th className="p-3">Cliente</th>
              <th className="p-3">Vertical</th>
              <th className="p-3">Status</th>
              <th className="p-3">Prazo</th>
              <th className="p-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {projects.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50/50">
                <td className="p-3">
                  <div className="font-semibold text-slate-800">{p.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono">{p.id}</div>
                </td>
                <td className="p-3 text-slate-600">{p.customer_name}</td>
                <td className="p-3 text-slate-600">{p.vertical}</td>
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded font-bold text-[9px] uppercase ${STATUS_COLOR[p.status] || "bg-slate-100 text-slate-700"}`}>
                    {STATUS_LABEL[p.status] || p.status}
                  </span>
                </td>
                <td className="p-3 font-mono text-slate-500">{p.deadline ? p.deadline.substring(0, 10) : "-"}</td>
                <td className="p-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => onOpenProject(p.id)}
                      className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors cursor-pointer"
                      title="Abrir na Área de Trabalho"
                    >
                      <FolderOpen size={14} />
                    </button>
                    {canEdit && (
                      <button
                        onClick={() => openEdit(p)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer"
                        title="Editar Projeto"
                      >
                        <Pen size={14} />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => setConfirmDeleteId(p.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                        title="Excluir Projeto"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {projects.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400 italic">Nenhum projeto cadastrado ainda.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingProject && editValues && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 sticky top-0 bg-white z-10">
              <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">Editar Projeto: {editingProject.name}</h3>
              <button onClick={() => { setEditingProject(null); setEditValues(null); }} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="p-5">
              {editError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">{editError}</div>
              )}
              <ProjectFieldsForm locale={locale} values={editValues} onChange={setEditValues} />
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-slate-200 sticky bottom-0 bg-white">
              <button
                onClick={() => { setEditingProject(null); setEditValues(null); }}
                className="px-4 py-2 text-xs font-bold uppercase text-slate-500 hover:bg-slate-100 rounded transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={saveEdit}
                disabled={savingEdit}
                className="px-4 py-2 text-xs font-bold uppercase bg-emerald-600 hover:bg-emerald-700 text-white rounded transition-colors cursor-pointer disabled:opacity-50"
              >
                {savingEdit ? "Salvando..." : "Salvar Alterações"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-sm font-bold text-slate-800 mb-2">Excluir projeto?</h3>
            <p className="text-xs text-slate-500 mb-5 leading-relaxed">
              Esta ação é permanente e vai remover o projeto, documentos, análises e propostas associadas. Não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 text-xs font-bold uppercase text-slate-500 hover:bg-slate-100 rounded transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => confirmDelete(confirmDeleteId)}
                disabled={deletingId === confirmDeleteId}
                className="px-4 py-2 text-xs font-bold uppercase bg-red-600 hover:bg-red-700 text-white rounded transition-colors cursor-pointer disabled:opacity-50"
              >
                {deletingId === confirmDeleteId ? "Excluindo..." : "Excluir Definitivamente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
