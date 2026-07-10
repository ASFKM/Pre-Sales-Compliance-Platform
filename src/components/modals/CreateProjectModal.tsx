import { useState } from "react";
import { X } from "lucide-react";
import { Project } from "../../types";
import ProjectFieldsForm, { initialProjectFieldsValues } from "./ProjectFieldsForm";

interface CreateProjectModalProps {
  locale: string;
  onClose: () => void;
  onCreated: (project: Project) => void;
}

export default function CreateProjectModal({ locale, onClose, onCreated }: CreateProjectModalProps) {
  const [newProject, setNewProject] = useState(initialProjectFieldsValues);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newProject)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.message || (locale === "pt" ? "Não foi possível criar o projeto." : "Could not create the project."));
        return;
      }
      const created = await res.json();
      onCreated(created);
      setNewProject(initialProjectFieldsValues);
      onClose();
    } catch (err) {
      console.error("Could not create project node", err);
      alert(locale === "pt" ? "Erro ao criar o projeto." : "Error creating the project.");
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl border border-slate-200 w-[550px] overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <div className="bg-slate-950 text-white p-4 flex justify-between items-center shrink-0">
          <h3 className="text-sm font-bold uppercase font-mono tracking-wider">{locale === "pt" ? "Inicializar Proposta de Pré-Vendas" : "Initialize Pre-Sales Bid"}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer"><X size={16} /></button>
        </div>

        <form onSubmit={handleCreateProject} className="p-6 overflow-y-auto flex-1">
          <ProjectFieldsForm locale={locale} values={newProject} onChange={setNewProject} />

          <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 font-mono text-xs cursor-pointer text-slate-500"
            >
              {locale === "pt" ? "Cancelar" : "Cancel"}
            </button>
            <button
              type="submit"
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer"
            >
              {locale === "pt" ? "Confirmar Configuração de Especificações" : "Confirm Specifications Setup"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
