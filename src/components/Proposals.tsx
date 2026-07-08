import { useState } from "react";
import { AlertTriangle, Download, Edit3, X } from "lucide-react";
import { Proposal } from "../types";
import { useProposals } from "../hooks/useProposals";

interface ProposalsProps {
  locale: "en" | "pt";
  hasPermission: (perm: string) => boolean;
  proposals: Proposal[];
  selectedProjectId: string;
  fetchGlobalConfigs: () => Promise<void> | void;
  fetchProjectDetails: (projectId: string) => Promise<void> | void;
  handleReleaseProposal: (propId: string) => void;
}

export default function Proposals({
  locale, hasPermission, proposals, selectedProjectId,
  fetchGlobalConfigs, fetchProjectDetails, handleReleaseProposal,
}: ProposalsProps) {
  const { handleUpdateProposalCommercial, handleSubmitProposalApproval } = useProposals({
    locale, hasPermission, proposals, selectedProjectId, fetchGlobalConfigs, fetchProjectDetails,
  });
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [editingProposal, setEditingProposal] = useState<Proposal | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const openEditor = (prop: Proposal) => {
    setEditingProposal(prop);
    setEditedContent(prop.editable_content || "");
  };

  // Saving regenerates the DOCX/PDF from this text server-side (server/routes/proposals.ts) - the
  // exported files always match what the user reviewed/edited here, not the original AI draft.
  const saveEditedContent = async () => {
    if (!editingProposal) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/proposals/${editingProposal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editable_content: editedContent }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.message || (locale === "pt" ? "Não foi possível salvar as alterações." : "Could not save changes."));
        return;
      }
      setEditingProposal(null);
      await fetchProjectDetails(selectedProjectId);
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao salvar as alterações." : "Error saving changes.");
    } finally {
      setSavingEdit(false);
    }
  };

  // Was a plain <a href target="_blank"> - a browser-navigated request never goes through the
  // app's global fetch() interceptor (App.tsx) that injects the Authorization header, so the API
  // rejected it with "Authorization token required" and the browser rendered/downloaded that raw
  // JSON error instead of the real file. fetch() here goes through that interceptor correctly.
  const handleExportProposal = async (proposalId: string, format: "docx" | "pdf") => {
    setExportingId(`${proposalId}-${format}`);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/export/${format}`);
      if (!res.ok) {
        alert(locale === "pt" ? "Não foi possível exportar a proposta." : "Could not export the proposal.");
        return;
      }
      const disposition = res.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const filename = filenameMatch?.[1] || `proposta-${proposalId}.${format}`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao exportar a proposta." : "Error exporting the proposal.");
    } finally {
      setExportingId(null);
    }
  };

  return (
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-light text-slate-900">{locale === "pt" ? "Espaço de Trabalho do Estúdio de Propostas" : "Proposal Studio Workspace"}</h2>
                <span className="text-xs text-slate-400">{locale === "pt" ? "Gerencie planilhas de precificação de lances, exclusões comerciais e fluxos de aprovação" : "Manage bid pricing spreadsheets, commercial exclusions and approval pipelines"}</span>
              </div>

              {proposals.length === 0 ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center py-16">
                  <AlertTriangle className="text-amber-500 mx-auto mb-2" size={32} />
                  <h4 className="text-sm font-bold text-slate-800 uppercase font-mono">{locale === "pt" ? "Nenhuma Proposta Compilada Ainda" : "No Proposals Compiled Yet"}</h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 leading-relaxed">
                    {locale === "pt" ? "Acesse a Área de Trabalho e escolha a aba 'Estúdio de Geração de Propostas' para compilar especificações técnicas ou planilhas de preços em rascunhos de documentos reais." : "Go to your Workspace tab and choose the 'Proposal Studio Generator' sub-tab to compile technical specifications or pricing tables into actual document drafts."}
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {proposals.map(prop => (
                    <div key={prop.id} className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex flex-col gap-4">

                      {/* Header block of proposal */}
                      <div className="flex justify-between items-start border-b border-slate-100 pb-3">
                        <div className="flex gap-3 items-center">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm ${
                            prop.proposal_type === "technical" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"
                          }`}>
                            {prop.proposal_type === "technical" ? "TECH" : "COMM"}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold text-slate-800 uppercase font-mono">{prop.proposal_type === "technical" ? (locale === "pt" ? "Técnica" : "Technical") : (locale === "pt" ? "Comercial" : "Commercial")} - Draft v{prop.version}.0</h3>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                                prop.status === "released" ? "text-purple-700 bg-purple-50 border-purple-200" :
                                prop.status === "approved" ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
                                prop.status === "submitted" ? "text-blue-700 bg-blue-50 border-blue-200" :
                                prop.status === "rejected" ? "text-red-700 bg-red-50 border-red-200" :
                                "text-amber-700 bg-amber-50 border-amber-200"
                              }`}>
                                {locale === "pt" ? (
                                  prop.status === "released" ? "LIBERADA" :
                                  prop.status === "approved" ? "APROVADA" :
                                  prop.status === "submitted" ? "ENVIADA" :
                                  prop.status === "rejected" ? "REJEITADA" : "RASCUNHO"
                                ) : prop.status}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5 font-mono">{locale === "pt" ? "Gerada por:" : "Generated by:"} {prop.generated_by} {locale === "pt" ? "em" : "on"} {new Date(prop.generated_at).toLocaleString()}</p>
                          </div>
                        </div>

                        {/* Export Action Buttons */}
                        <div className="flex gap-2">
                          {prop.status === "draft" && hasPermission("proposal:edit") && (
                            <button
                              onClick={() => openEditor(prop)}
                              className="flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-blue-200 transition-all shadow-sm cursor-pointer"
                            >
                              <Edit3 size={12} /> {locale === "pt" ? "Revisar e Editar" : "Review & Edit"}
                            </button>
                          )}
                          {hasPermission("proposal:export") && (
                            <>
                              <button
                                onClick={() => handleExportProposal(prop.id, "docx")}
                                disabled={exportingId === `${prop.id}-docx`}
                                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-slate-200 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                              >
                                <Download size={12} /> {exportingId === `${prop.id}-docx` ? (locale === "pt" ? "Exportando..." : "Exporting...") : "Exportar DOCX"}
                              </button>
                              <button
                                onClick={() => handleExportProposal(prop.id, "pdf")}
                                disabled={exportingId === `${prop.id}-pdf`}
                                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-slate-200 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                              >
                                <Download size={12} /> {exportingId === `${prop.id}-pdf` ? (locale === "pt" ? "Exportando..." : "Exporting...") : "Exportar PDF"}
                              </button>
                            </>
                          )}
                          {prop.status === "draft" && hasPermission("approval:manage") && (
                            <button
                              onClick={() => handleSubmitProposalApproval(prop.id)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all cursor-pointer"
                            >
                              {locale === "pt" ? "Enviar para Aprovação de Fluxo" : "Submit to Workflow Approvals"}
                            </button>
                          )}
                          {prop.status === "approved" && hasPermission("proposal:approve") && (
                            <button
                              onClick={() => handleReleaseProposal(prop.id)}
                              className="bg-purple-600 hover:bg-purple-700 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all cursor-pointer"
                            >
                              {locale === "pt" ? "Liberar Versão Final" : "Release Final Version"}
                            </button>
                          )}
                          {prop.status === "released" && (
                            <span className="bg-purple-50 text-purple-700 border border-purple-200 font-mono text-[11px] font-bold px-3 py-1.5 rounded">
                              {locale === "pt" ? "Versão Final Liberada" : "Final Version Released"}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Pricing table block - ONLY FOR COMMERCIAL */}
                      {prop.proposal_type === "commercial" && prop.manual_pricing_table && (
                        <div className="space-y-2">
                          <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono">{locale === "pt" ? "Grade de Planilha de Preço de Licitação" : "Commercial Bid Pricing Sheet Grid"}</h4>
                          <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/50">
                            <table className="w-full text-left text-xs border-collapse">
                              <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                                <tr>
                                  <th className="p-2.5">{locale === "pt" ? "Código do Item" : "Item Code"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Descrição" : "Description"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Quantidade" : "Quantity"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Preço Unitário" : "Unit List Price"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Desconto %" : "Discount %"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Preço Total USD" : "Total USD Price"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Status de Inclusão" : "Inclusion Status"}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 font-mono text-slate-700">
                                {prop.manual_pricing_table.map((row, i) => (
                                  <tr key={row.item_id || i} className="hover:bg-slate-50">
                                    <td className="p-2.5 font-bold">{row.product_or_service}</td>
                                    <td className="p-2.5 text-slate-500 font-sans text-xs">{row.specification || "-"}</td>
                                    <td className="p-2.5">
                                      <input
                                        type="number"
                                        value={row.quantity}
                                        onChange={(e) => handleUpdateProposalCommercial(prop.id, row.item_id, "quantity", parseInt(e.target.value) || 1)}
                                        disabled={prop.status !== "draft" || !hasPermission("proposal:edit")}
                                        className="w-14 p-1 rounded border border-slate-200 text-center font-semibold bg-white disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                                      />
                                    </td>
                                    <td className="p-2.5">
                                      <input
                                        type="number"
                                        value={row.unit_price}
                                        onChange={(e) => handleUpdateProposalCommercial(prop.id, row.item_id, "unit_price", parseFloat(e.target.value) || 0)}
                                        disabled={prop.status !== "draft" || !hasPermission("proposal:edit")}
                                        className="w-20 p-1 rounded border border-slate-200 text-center font-semibold bg-white disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                                      />
                                    </td>
                                    <td className="p-2.5">
                                      <input
                                        type="number"
                                        value={row.discount}
                                        onChange={(e) => handleUpdateProposalCommercial(prop.id, row.item_id, "discount", parseFloat(e.target.value) || 0)}
                                        disabled={prop.status !== "draft" || !hasPermission("proposal:edit")}
                                        className="w-14 p-1 rounded border border-slate-200 text-center font-semibold bg-white disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                                      />
                                    </td>
                                    <td className="p-2.5 font-bold text-slate-900">${row.total_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="p-2.5">
                                      <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] uppercase ${
                                        row.is_optional ? "text-amber-700 bg-amber-50 border border-amber-100" : "text-emerald-700 bg-emerald-50 border border-emerald-100"
                                      }`}>
                                        {row.is_optional ? (locale === "pt" ? "Opcional" : "Optional") : (locale === "pt" ? "Obrigatório" : "Mandatory")}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                                {/* Totals block */}
                                <tr className="bg-slate-100 font-sans font-bold text-slate-800">
                                  <td colSpan={5} className="p-3 text-right uppercase tracking-wider font-mono text-[10px] text-slate-500">{locale === "pt" ? "Preço de Licitação Bruto Total:" : "Gross Contract Bid Price:"}</td>
                                  <td colSpan={2} className="p-3 text-sm text-emerald-800 font-mono">
                                    ${(prop.manual_pricing_table || []).reduce((acc, r) => acc + r.total_price, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Text details for exclusions, validity etc */}
                      <div className="grid grid-cols-2 gap-6 text-xs text-slate-600 bg-slate-50/50 p-4 rounded-lg border border-slate-200">
                        <div className="space-y-3">
                          <div>
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block">{locale === "pt" ? "Exclusões Comerciais" : "Commercial Exclusions"}</span>
                            <p className="text-xs text-slate-700 italic mt-0.5">"{prop.exclusions || "N/A"}"</p>
                          </div>
                          <div>
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block">{locale === "pt" ? "Data de Validade da Proposta" : "Proposal Validity Date"}</span>
                            <p className="text-xs text-slate-700 font-semibold mt-0.5">{prop.proposal_validity || "N/A"}</p>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <div>
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block">{locale === "pt" ? "Termos de Pagamento e Crédito" : "Payment & Credit Terms"}</span>
                            <p className="text-xs text-slate-700 italic mt-0.5">"{prop.payment_terms || "N/A"}"</p>
                          </div>
                          <div>
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block">{locale === "pt" ? "Condições de Entrega Incoterms" : "Incoterms Delivery Conditions"}</span>
                            <p className="text-xs text-slate-700 font-semibold mt-0.5">{prop.delivery_terms || "N/A"}</p>
                          </div>
                        </div>
                      </div>

                    </div>
                  ))}
                </div>
              )}

              {editingProposal && (
                <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
                    <div className="flex items-center justify-between p-4 border-b border-slate-100">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">
                        {locale === "pt" ? "Revisar e Editar Proposta" : "Review & Edit Proposal"}
                      </h3>
                      <button onClick={() => setEditingProposal(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                        <X size={18} />
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 px-4 pt-3">
                      {locale === "pt"
                        ? "Edite qualquer trecho abaixo. Ao salvar, o DOCX e o PDF exportados são regenerados a partir deste texto."
                        : "Edit any part below. Saving regenerates the exported DOCX and PDF from this text."}
                    </p>
                    <div className="flex-1 p-4 min-h-0">
                      <textarea
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        className="w-full h-full min-h-[400px] p-3 rounded border border-slate-200 font-mono text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
                        spellCheck={false}
                      />
                    </div>
                    <div className="flex justify-end gap-2 p-4 border-t border-slate-100">
                      <button
                        onClick={() => setEditingProposal(null)}
                        className="px-4 py-2 text-xs font-bold uppercase text-slate-500 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                      >
                        {locale === "pt" ? "Cancelar" : "Cancel"}
                      </button>
                      <button
                        onClick={saveEditedContent}
                        disabled={savingEdit}
                        className="px-4 py-2 text-xs font-bold uppercase bg-emerald-600 hover:bg-emerald-700 text-white rounded transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {savingEdit ? (locale === "pt" ? "Salvando..." : "Saving...") : (locale === "pt" ? "Salvar e Regenerar Documento" : "Save & Regenerate Document")}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
  );
}
