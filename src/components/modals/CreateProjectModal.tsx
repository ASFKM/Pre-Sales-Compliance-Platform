import { useState } from "react";
import { X } from "lucide-react";
import { Project } from "../../types";

function HelpTooltip({ content }: { content: string }) {
  void content;
  return null;
}

interface CreateProjectModalProps {
  locale: string;
  onClose: () => void;
  onCreated: (project: Project) => void;
}

const initialNewProject = {
  name: "",
  customer_name: "",
  opportunity_name: "",
  vertical: "Infrastructure",
  description: "",
  deadline: "2026-08-30",
  proposal_validity_date: "2026-11-30",
  output_language: "English" as "English" | "Spanish" | "Portuguese",
  proposal_language: "English" as "English" | "Spanish" | "Portuguese",
  ai_orientation_mode: "Vendor-neutral" as any,
  ai_orientation_text: "",
  selected_approval_workflow_id: "w1",
  procurement_modality: "Licitação",
  procurement_subtype: "Pregão",
  custom_modality: ""
};

export default function CreateProjectModal({ locale, onClose, onCreated }: CreateProjectModalProps) {
  const [newProject, setNewProject] = useState(initialNewProject);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newProject)
      });
      if (res.ok) {
        const created = await res.json();
        onCreated(created);
        setNewProject(initialNewProject);
        onClose();
      }
    } catch (err) {
      console.error("Could not create project node", err);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl border border-slate-200 w-[550px] overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <div className="bg-slate-950 text-white p-4 flex justify-between items-center shrink-0">
          <h3 className="text-sm font-bold uppercase font-mono tracking-wider">{locale === "pt" ? "Inicializar Proposta de Pré-Vendas" : "Initialize Pre-Sales Bid"}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer"><X size={16} /></button>
        </div>

        <form onSubmit={handleCreateProject} className="p-6 overflow-y-auto space-y-4 text-xs text-slate-700 flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Título do Projeto de Proposta" : "Bid Project Title"}</label>
              <input
                type="text" required
                value={newProject.name}
                onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                placeholder={locale === "pt" ? "ex: Modernização de Rodovias ITS" : "e.g. Highway ITS Modernization"}
                className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Cliente" : "Customer / Client"}</label>
              <input
                type="text" required
                value={newProject.customer_name}
                onChange={(e) => setNewProject({ ...newProject, customer_name: e.target.value })}
                placeholder={locale === "pt" ? "ex: Concessionária de Rodovias" : "e.g. Metropolitan Transit Authority"}
                className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Código da Oportunidade" : "Opportunity Code"}</label>
              <input
                type="text" required
                value={newProject.opportunity_name}
                onChange={(e) => setNewProject({ ...newProject, opportunity_name: e.target.value })}
                placeholder="e.g. ITS-MTA-2026"
                className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none animate-pulse"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Vertical do Setor" : "Industry Vertical"}</label>
              <select
                value={newProject.vertical}
                onChange={(e) => setNewProject({ ...newProject, vertical: e.target.value })}
                className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="Infrastructure">{locale === "pt" ? "Infraestrutura" : "Infrastructure"}</option>
                <option value="Critical Infrastructure">{locale === "pt" ? "Infraestrutura Crítica" : "Critical Infrastructure"}</option>
                <option value="Smart Cities">{locale === "pt" ? "Cidades Inteligentes" : "Smart Cities"}</option>
                <option value="Retail">{locale === "pt" ? "Varejo" : "Retail"}</option>
                <option value="Finance">{locale === "pt" ? "Finanças" : "Finance"}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Descrição do Escopo do Edital" : "Tender Scope Description"}</label>
            <textarea
              value={newProject.description} required
              onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
              placeholder={locale === "pt" ? "Detalhe o escopo de entregáveis de alto nível..." : "Detail high level deliverables scope..."}
              className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none h-20"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Prazo Final de Envio" : "Tender Submission Deadline"}</label>
              <input
                type="date" required
                value={newProject.deadline}
                onChange={(e) => setNewProject({ ...newProject, deadline: e.target.value })}
                className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Idioma de Saída de Conformidade da IA" : "AI Output Compliance Language"}</label>
              <select
                value={newProject.output_language}
                onChange={(e) => setNewProject({ ...newProject, output_language: e.target.value as any })}
                className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="English">{locale === "pt" ? "Inglês" : "English"}</option>
                <option value="Spanish">{locale === "pt" ? "Espanhol" : "Spanish"}</option>
                <option value="Portuguese">{locale === "pt" ? "Português" : "Portuguese"}</option>
              </select>
            </div>
          </div>

          {/* Procurement Modality (Modalidade de Contratação) */}
          <div className="border-t border-slate-200 pt-3 space-y-2">
            <div className="flex items-center gap-1">
              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block">
                {locale === "pt" ? "Modalidade de Contratação" : "Procurement Modality"}
              </label>
              <HelpTooltip content={locale === "pt" ? "Selecione o tipo de concorrência ou leilão aplicável à licitação para orientar a IA nas regras de compliance." : "Select the contract procurement type or auction mode to guide the AI compliance checks."} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <select
                  value={newProject.procurement_modality}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewProject({
                      ...newProject,
                      procurement_modality: val,
                      procurement_subtype: val === "Leilão" ? "Leilão Inglês" : (val === "Licitação" ? "Pregão" : ""),
                    });
                  }}
                  className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold text-slate-800"
                >
                  <option value="Licitação">{locale === "pt" ? "Licitação" : "Bidding / Tender"}</option>
                  <option value="Leilão">{locale === "pt" ? "Leilão" : "Auction"}</option>
                  <option value="Outra modalidade">{locale === "pt" ? "Outra Modalidade" : "Other Modality"}</option>
                </select>
              </div>

              <div>
                {newProject.procurement_modality === "Leilão" && (
                  <select
                    value={newProject.procurement_subtype}
                    onChange={(e) => setNewProject({ ...newProject, procurement_subtype: e.target.value })}
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold text-slate-800"
                  >
                    <option value="Leilão Inglês">{locale === "pt" ? "Leilão Inglês" : "English Auction"}</option>
                    <option value="Leilão Holandês">{locale === "pt" ? "Leilão Holandês" : "Dutch Auction"}</option>
                    <option value="Leilão Japonês">{locale === "pt" ? "Leilão Japonês" : "Japanese Auction"}</option>
                    <option value="Primeiro Preço">{locale === "pt" ? "Primeiro Preço" : "First Price"}</option>
                    <option value="Vickrey (Segundo Preço)">{locale === "pt" ? "Vickrey (Segundo Preço)" : "Vickrey (Second Price)"}</option>
                    <option value="Reverso">{locale === "pt" ? "Reverso" : "Reverse"}</option>
                  </select>
                )}

                {newProject.procurement_modality === "Licitação" && (
                  <select
                    value={newProject.procurement_subtype}
                    onChange={(e) => setNewProject({ ...newProject, procurement_subtype: e.target.value })}
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold text-slate-800"
                  >
                    <option value="Pregão">Pregão</option>
                    <option value="Concorrência">Concorrência</option>
                    <option value="Concurso">Concurso</option>
                    <option value="Leilão">Leilão</option>
                    <option value="Diálogo Competitivo">Diálogo Competitivo</option>
                    <option value="Tomada de Preço">Tomada de Preço</option>
                  </select>
                )}

                {newProject.procurement_modality === "Outra modalidade" && (
                  <input
                    type="text" required
                    value={newProject.custom_modality}
                    onChange={(e) => setNewProject({ ...newProject, custom_modality: e.target.value })}
                    placeholder={locale === "pt" ? "Especifique a modalidade..." : "Specify custom modality..."}
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold text-slate-800"
                  />
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Regras de Orientação de Design da IA" : "AI Design Orientation Rules"}</label>
            <div className="space-y-2">
              <select
                value={newProject.ai_orientation_mode}
                onChange={(e) => setNewProject({ ...newProject, ai_orientation_mode: e.target.value as any })}
                className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-bold text-slate-800"
              >
                <option value="Vendor-neutral">{locale === "pt" ? "Fabricante Neutro (foco em estrita conformidade)" : "Vendor-neutral (strict compliance focus)"}</option>
                <option value="Preferred manufacturer">{locale === "pt" ? "Fabricante Preferencial (marcas recomendadas)" : "Preferred manufacturer (recommended brands)"}</option>
                <option value="Mandatory manufacturer">{locale === "pt" ? "Fabricante Obrigatório (especificações críticas de contrato)" : "Mandatory manufacturer (contract-critical specs)"}</option>
                <option value="Existing customer standard">{locale === "pt" ? "Padrão de Cliente Existente" : "Existing customer standard"}</option>
                <option value="Free AI recommendation">{locale === "pt" ? "Recomendação Livre da IA" : "Free AI recommendation"}</option>
              </select>
              <input
                type="text" required
                value={newProject.ai_orientation_text}
                onChange={(e) => setNewProject({ ...newProject, ai_orientation_text: e.target.value })}
                placeholder={locale === "pt" ? "Especifique regras de marcas, ex: Recomendar leitores faciais homologados..." : "Specify brand rules e.g., Recommend certified facial readers..."}
                className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold text-slate-800"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
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
