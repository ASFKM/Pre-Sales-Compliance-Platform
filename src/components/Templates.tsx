import { ProposalTemplate } from "../types";

interface TemplatesProps {
  locale: "en" | "pt";
  proposalTemplates: ProposalTemplate[];
  fetchGlobalConfigs: () => Promise<void> | void;
}

export default function Templates({ locale, proposalTemplates, fetchGlobalConfigs }: TemplatesProps) {
  return (
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-light text-slate-900">{locale === "pt" ? "Gestor de Modelos de Licitação" : "Bid Template Configuration Manager"}</h2>
                <span className="text-xs text-slate-400">{locale === "pt" ? "Configure estruturas corporativas, variáveis e esquemas em conformidade" : "Configure compliant corporate structures, variables and schemas"}</span>
              </div>

              <div className="space-y-4">
                {proposalTemplates.map(tpl => (
                  <div key={tpl.id} className="p-4 bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col gap-3 hover:border-slate-300 transition-all">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-slate-800 uppercase font-mono">{tpl.name}</h4>
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 rounded-full font-bold uppercase font-mono">{tpl.file_type}</span>
                          {tpl.default_template && (
                            <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 rounded-full font-bold">{locale === "pt" ? "PADRÃO" : "DEFAULT"}</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{tpl.description}</p>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            fetch(`/api/templates/proposals/${tpl.id}/validate`, { method: "POST" })
                              .then(r => r.json())
                              .then(res => alert(`Template validation diagnostics: Variables schema compliant! Loaded fields: ${res.variables.join(", ")}`));
                          }}
                          className="text-[11px] font-mono font-bold bg-slate-100 text-slate-600 border border-slate-200 px-2 py-1 rounded hover:bg-slate-200"
                        >
                          {locale === "pt" ? "Verificar Esquema" : "Compile Schema Check"}
                        </button>
                        {!tpl.default_template && (
                          <button
                            onClick={() => {
                              fetch(`/api/templates/proposals/${tpl.id}/set-default`, { method: "POST" })
                                .then(() => fetchGlobalConfigs());
                            }}
                            className="text-[11px] font-mono font-bold bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700"
                          >
                            {locale === "pt" ? "Tornar Padrão" : "Assign Default"}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="text-[11px] font-mono bg-slate-50 p-2.5 rounded border border-slate-200">
                      <span className="text-slate-400 font-bold block mb-1">{locale === "pt" ? "Esquema de Variáveis Dinâmicas Declaradas do Modelo:" : "Declared Dynamic Template Variables Schema:"}</span>
                      <p className="text-slate-600 leading-normal">{tpl.variables_schema}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
  );
}
