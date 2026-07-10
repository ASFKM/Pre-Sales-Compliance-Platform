import { useEffect, useState } from "react";
import ApiClient from "../../lib/api";

export interface ProjectFieldsValues {
  name: string;
  customer_name: string;
  opportunity_name: string;
  vertical: string;
  description: string;
  deadline: string;
  proposal_validity_date: string;
  output_language: "English" | "Spanish" | "Portuguese";
  proposal_language: "English" | "Spanish" | "Portuguese";
  ai_orientation_mode: string;
  ai_orientation_text: string;
  selected_approval_workflow_id: string;
  procurement_modality: string;
  procurement_subtype: string;
  custom_modality: string;
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// A function, not a static object - the previous hardcoded "2026-08-30"/"2026-11-30" dates were
// frozen at whenever this module happened to be written, so every new project's default deadline
// silently drifted further into the past the longer the app ran. Computed fresh relative to today
// every time a new project form actually opens.
export function getInitialProjectFieldsValues(): ProjectFieldsValues {
  return {
    name: "",
    customer_name: "",
    opportunity_name: "",
    vertical: "Infrastructure",
    description: "",
    deadline: addDays(60),
    proposal_validity_date: addDays(120),
    output_language: "Portuguese",
    proposal_language: "Portuguese",
    ai_orientation_mode: "Vendor-neutral",
    ai_orientation_text: "",
    selected_approval_workflow_id: "w1",
    procurement_modality: "Licitação",
    procurement_subtype: "Pregão",
    custom_modality: "",
  };
}

interface ProjectFieldsFormProps {
  locale: string;
  values: ProjectFieldsValues;
  onChange: (values: ProjectFieldsValues) => void;
}

// The field set shared by manual project creation (CreateProjectModal) and the upload-first
// wizard's validation step (Phase 4) - extracted once so both stay in sync instead of
// duplicating ~150 lines of form JSX.
export default function ProjectFieldsForm({ locale, values, onChange }: ProjectFieldsFormProps) {
  const [verticals, setVerticals] = useState<{ id: string; name: string; is_active: boolean }[]>([]);
  const [manufacturerDraft, setManufacturerDraft] = useState("");

  useEffect(() => {
    ApiClient.get<{ id: string; name: string; is_active: boolean }[]>("/api/verticals")
      .then((v) => setVerticals(v.filter((item) => item.is_active)))
      .catch(() => setVerticals([]));
  }, []);

  // Manufacturer names are stored as a single comma-separated string in ai_orientation_text (no
  // schema/backend change needed - the analysis prompt already reads this as free text and
  // handles a list of names fine) - only the input UX here becomes tag-based for the two modes
  // where a real fixed list of manufacturers is what the field means.
  const isManufacturerMode = values.ai_orientation_mode === "Preferred manufacturer" || values.ai_orientation_mode === "Mandatory manufacturer";
  const manufacturerTags = values.ai_orientation_text.split(",").map((s) => s.trim()).filter(Boolean);

  const addManufacturerTag = () => {
    const name = manufacturerDraft.trim();
    if (!name || manufacturerTags.includes(name)) {
      setManufacturerDraft("");
      return;
    }
    onChange({ ...values, ai_orientation_text: [...manufacturerTags, name].join(", ") });
    setManufacturerDraft("");
  };

  const removeManufacturerTag = (name: string) => {
    onChange({ ...values, ai_orientation_text: manufacturerTags.filter((t) => t !== name).join(", ") });
  };

  return (
    <div className="space-y-4 text-xs text-slate-700">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Título do Projeto de Proposta" : "Bid Project Title"}</label>
          <input
            type="text" required
            value={values.name}
            onChange={(e) => onChange({ ...values, name: e.target.value })}
            placeholder={locale === "pt" ? "ex: Modernização de Rodovias ITS" : "e.g. Highway ITS Modernization"}
            className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Cliente" : "Customer / Client"}</label>
          <input
            type="text" required
            value={values.customer_name}
            onChange={(e) => onChange({ ...values, customer_name: e.target.value })}
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
            value={values.opportunity_name}
            onChange={(e) => onChange({ ...values, opportunity_name: e.target.value })}
            placeholder="e.g. ITS-MTA-2026"
            className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Vertical do Setor" : "Industry Vertical"}</label>
          <select
            value={values.vertical}
            onChange={(e) => onChange({ ...values, vertical: e.target.value })}
            className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
          >
            {verticals.map((v) => (
              <option key={v.id} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Descrição do Escopo do Edital" : "Tender Scope Description"}</label>
        <textarea
          value={values.description} required
          onChange={(e) => onChange({ ...values, description: e.target.value })}
          placeholder={locale === "pt" ? "Detalhe o escopo de entregáveis de alto nível..." : "Detail high level deliverables scope..."}
          className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none h-20"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Prazo Final de Envio" : "Tender Submission Deadline"}</label>
          <input
            type="date" required
            value={values.deadline}
            onChange={(e) => onChange({ ...values, deadline: e.target.value })}
            className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Idioma de Saída de Conformidade da IA" : "AI Output Compliance Language"}</label>
          <select
            value={values.output_language}
            onChange={(e) => onChange({ ...values, output_language: e.target.value as any })}
            className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
          >
            <option value="English">{locale === "pt" ? "Inglês" : "English"}</option>
            <option value="Spanish">{locale === "pt" ? "Espanhol" : "Spanish"}</option>
            <option value="Portuguese">{locale === "pt" ? "Português" : "Portuguese"}</option>
          </select>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-3 space-y-2">
        <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block">
          {locale === "pt" ? "Modalidade de Contratação" : "Procurement Modality"}
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <select
              value={values.procurement_modality}
              onChange={(e) => {
                const val = e.target.value;
                onChange({
                  ...values,
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
            {values.procurement_modality === "Leilão" && (
              <select
                value={values.procurement_subtype}
                onChange={(e) => onChange({ ...values, procurement_subtype: e.target.value })}
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

            {values.procurement_modality === "Licitação" && (
              <select
                value={values.procurement_subtype}
                onChange={(e) => onChange({ ...values, procurement_subtype: e.target.value })}
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

            {values.procurement_modality === "Outra modalidade" && (
              <input
                type="text" required
                value={values.custom_modality}
                onChange={(e) => onChange({ ...values, custom_modality: e.target.value })}
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
            value={values.ai_orientation_mode}
            onChange={(e) => onChange({ ...values, ai_orientation_mode: e.target.value })}
            className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-bold text-slate-800"
          >
            <option value="Vendor-neutral">{locale === "pt" ? "Fabricante Neutro (foco em estrita conformidade)" : "Vendor-neutral (strict compliance focus)"}</option>
            <option value="Preferred manufacturer">{locale === "pt" ? "Fabricante Preferencial (marcas recomendadas)" : "Preferred manufacturer (recommended brands)"}</option>
            <option value="Mandatory manufacturer">{locale === "pt" ? "Fabricante Obrigatório (especificações críticas de contrato)" : "Mandatory manufacturer (contract-critical specs)"}</option>
            <option value="Existing customer standard">{locale === "pt" ? "Padrão de Cliente Existente" : "Existing customer standard"}</option>
            <option value="Free AI recommendation">{locale === "pt" ? "Recomendação Livre da IA" : "Free AI recommendation"}</option>
          </select>
          {isManufacturerMode ? (
            <div className="p-2 rounded bg-slate-50 border border-slate-200 focus-within:ring-1 focus-within:ring-emerald-500">
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {manufacturerTags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2 py-1 rounded-full">
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeManufacturerTag(tag)}
                      className="text-emerald-600 hover:text-emerald-900 cursor-pointer leading-none"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={manufacturerDraft}
                  onChange={(e) => setManufacturerDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addManufacturerTag();
                    }
                  }}
                  placeholder={locale === "pt" ? "Digite um fabricante e pressione Enter ou +" : "Type a manufacturer and press Enter or +"}
                  className="flex-1 p-1.5 rounded bg-white border border-slate-200 text-xs focus:outline-none"
                />
                <button
                  type="button"
                  onClick={addManufacturerTag}
                  className="px-3 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm cursor-pointer"
                  title={locale === "pt" ? "Adicionar fabricante" : "Add manufacturer"}
                >
                  +
                </button>
              </div>
              {manufacturerTags.length === 0 && (
                <p className="text-[10px] text-amber-600 mt-1">{locale === "pt" ? "Adicione ao menos um fabricante." : "Add at least one manufacturer."}</p>
              )}
            </div>
          ) : (
            <input
              type="text" required
              value={values.ai_orientation_text}
              onChange={(e) => onChange({ ...values, ai_orientation_text: e.target.value })}
              placeholder={locale === "pt" ? "Especifique regras de marcas, ex: Recomendar leitores faciais homologados..." : "Specify brand rules e.g., Recommend certified facial readers..."}
              className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold text-slate-800"
            />
          )}
        </div>
      </div>
    </div>
  );
}
