import { useEffect, useState } from "react";
import { CircleAlert, Check, X, Loader2 } from "lucide-react";
import ApiClient from "../lib/api";

interface ExtractionDraft {
  id: string;
  itemCode: string | null;
  category: string | null;
  pn: string;
  erpCode: string | null;
  description: string;
  listPriceBrl: number | null;
  listPriceUsd: number | null;
  sourceCurrency: string;
  markupMin: number | null;
  markupMax: number | null;
  supplierName: string | null;
  confidenceNote: string | null;
  status: string;
  priceListUpload: { fileName: string; uploadedAt: string };
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Edição inline direto no draft - cada onBlur salva o campo editado imediatamente (PUT), sem um
// botão de "salvar" separado. Confirmar em lote é uma ação à parte (POST /confirm).
function EditableCell({
  value,
  onSave,
  type = "text",
  placeholder,
  width = "auto",
}: {
  value: string | number | null;
  onSave: (v: string) => void;
  type?: "text" | "number";
  placeholder?: string;
  width?: string;
}) {
  return (
    <input
      type={type}
      defaultValue={value ?? ""}
      placeholder={placeholder}
      onBlur={(e) => {
        if (e.target.value !== String(value ?? "")) onSave(e.target.value);
      }}
      className="text-xs border border-transparent hover:border-slate-300 focus:border-emerald-500 rounded px-1.5 py-1 bg-transparent focus:bg-white outline-none"
      style={{ width }}
    />
  );
}

export default function PricingExtractionReview({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const [drafts, setDrafts] = useState<ExtractionDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    ApiClient.get<{ success: boolean; drafts: ExtractionDraft[] }>("/api/pricing/catalog/extraction-drafts")
      .then((res) => {
        setDrafts(res.drafts);
        onCountChange?.(res.drafts.length);
      })
      .catch(() => setDrafts([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const saveField = async (id: string, field: string, rawValue: string) => {
    const isNumeric = ["listPriceBrl", "listPriceUsd", "markupMin", "markupMax"].includes(field);
    const value = isNumeric ? (rawValue === "" ? null : Number(rawValue)) : rawValue === "" ? null : rawValue;
    try {
      await ApiClient.put(`/api/pricing/catalog/extraction-drafts/${id}`, { [field]: value });
      setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: value } : d)));
    } catch (e: any) {
      setMessage(e.message || "Não foi possível salvar essa alteração.");
      setTimeout(() => setMessage(null), 4000);
    }
  };

  const reject = async (id: string) => {
    try {
      await ApiClient.post(`/api/pricing/catalog/extraction-drafts/${id}/reject`, {});
      setDrafts((prev) => {
        const next = prev.filter((d) => d.id !== id);
        onCountChange?.(next.length);
        return next;
      });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e: any) {
      setMessage(e.message || "Não foi possível rejeitar essa linha.");
      setTimeout(() => setMessage(null), 4000);
    }
  };

  const confirmSelected = async () => {
    if (selected.size === 0) return;
    setConfirming(true);
    setMessage(null);
    try {
      const res = await ApiClient.post<{ success: boolean; confirmed: number; errors: { id: string; message: string }[] }>(
        "/api/pricing/catalog/extraction-drafts/confirm",
        { draftIds: Array.from(selected) }
      );
      if (res.errors.length > 0) {
        setMessage(`${res.confirmed} confirmado(s). ${res.errors.length} linha(s) não puderam ser confirmadas: ${res.errors.map((e) => e.message).join("; ")}`);
      } else {
        setMessage(`${res.confirmed} item(ns) confirmado(s) e importado(s) para o catálogo.`);
      }
      setSelected(new Set());
      load();
    } catch (e: any) {
      setMessage(e.message || "Não foi possível confirmar as linhas selecionadas.");
    } finally {
      setConfirming(false);
      setTimeout(() => setMessage(null), 8000);
    }
  };

  const toggleAll = () => {
    if (selected.size === drafts.length) setSelected(new Set());
    else setSelected(new Set(drafts.map((d) => d.id)));
  };

  const groupedByUpload = drafts.reduce<Record<string, ExtractionDraft[]>>((acc, d) => {
    (acc[d.priceListUpload.fileName] ??= []).push(d);
    return acc;
  }, {});

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Extrações pendentes</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Itens extraídos por IA de cotações de fornecedor - revise, edite o que precisar, e confirme para entrar no
            catálogo. Nada aqui é gravado automaticamente.
          </p>
        </div>
        <button
          onClick={confirmSelected}
          disabled={selected.size === 0 || confirming}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-emerald-600 rounded-lg px-3 py-2 hover:bg-emerald-700 disabled:opacity-60 shrink-0"
        >
          {confirming ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          Confirmar selecionados ({selected.size})
        </button>
      </div>

      {message && <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-600">{message}</div>}

      {loading ? (
        <p className="text-xs text-slate-400">Carregando...</p>
      ) : drafts.length === 0 ? (
        <p className="text-xs text-slate-400">Nenhuma extração pendente de revisão no momento.</p>
      ) : (
        Object.entries(groupedByUpload).map(([fileName, rows]) => (
          <div key={fileName} className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 flex items-center gap-2">
              <input
                type="checkbox"
                checked={rows.every((r) => selected.has(r.id))}
                onChange={() => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    const allSelected = rows.every((r) => next.has(r.id));
                    for (const r of rows) (allSelected ? next.delete(r.id) : next.add(r.id));
                    return next;
                  });
                }}
                className="w-3.5 h-3.5"
              />
              {fileName}
              {rows[0]?.supplierName && <span className="text-slate-400">— {rows[0].supplierName}</span>}
              <span className="text-slate-400">({rows.length} item(ns))</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wide text-[10px]">
                  <tr>
                    <th className="px-2 py-1.5 w-8"></th>
                    <th className="text-left px-2 py-1.5 font-medium">Código</th>
                    <th className="text-left px-2 py-1.5 font-medium">Categoria</th>
                    <th className="text-left px-2 py-1.5 font-medium">PN</th>
                    <th className="text-left px-2 py-1.5 font-medium">Descrição</th>
                    <th className="text-right px-2 py-1.5 font-medium">Preço (R$)</th>
                    <th className="text-right px-2 py-1.5 font-medium">Preço (US$)</th>
                    <th className="text-right px-2 py-1.5 font-medium">Markup mín</th>
                    <th className="text-right px-2 py-1.5 font-medium">Markup máx</th>
                    <th className="text-left px-2 py-1.5 font-medium">Fornecedor</th>
                    <th className="px-2 py-1.5 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((d) => (
                    <tr key={d.id} className={selected.has(d.id) ? "bg-emerald-50/40" : ""}>
                      <td className="px-2 py-1">
                        <input
                          type="checkbox"
                          checked={selected.has(d.id)}
                          onChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              next.has(d.id) ? next.delete(d.id) : next.add(d.id);
                              return next;
                            })
                          }
                          className="w-3.5 h-3.5"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <EditableCell value={d.itemCode} onSave={(v) => saveField(d.id, "itemCode", v)} placeholder="obrigatório" width="90px" />
                      </td>
                      <td className="px-2 py-1">
                        <EditableCell value={d.category} onSave={(v) => saveField(d.id, "category", v)} width="90px" />
                      </td>
                      <td className="px-2 py-1">
                        <EditableCell value={d.pn} onSave={(v) => saveField(d.id, "pn", v)} width="90px" />
                      </td>
                      <td className="px-2 py-1">
                        <EditableCell value={d.description} onSave={(v) => saveField(d.id, "description", v)} width="180px" />
                      </td>
                      <td className="px-2 py-1">
                        <EditableCell value={d.listPriceBrl} type="number" onSave={(v) => saveField(d.id, "listPriceBrl", v)} width="80px" />
                      </td>
                      <td className="px-2 py-1">
                        <EditableCell value={d.listPriceUsd} type="number" onSave={(v) => saveField(d.id, "listPriceUsd", v)} width="80px" />
                      </td>
                      <td className="px-2 py-1">
                        <EditableCell value={d.markupMin} type="number" onSave={(v) => saveField(d.id, "markupMin", v)} placeholder="%" width="60px" />
                      </td>
                      <td className="px-2 py-1">
                        <EditableCell value={d.markupMax} type="number" onSave={(v) => saveField(d.id, "markupMax", v)} placeholder="%" width="60px" />
                      </td>
                      <td className="px-2 py-1">
                        <EditableCell value={d.supplierName} onSave={(v) => saveField(d.id, "supplierName", v)} width="110px" />
                      </td>
                      <td className="px-2 py-1">
                        <button onClick={() => reject(d.id)} title="Rejeitar" className="text-slate-400 hover:text-red-500">
                          <X size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {rows.some((d) => d.confidenceNote) && (
                    <tr>
                      <td colSpan={11} className="px-2 py-1.5 bg-amber-50/60">
                        {rows
                          .filter((d) => d.confidenceNote)
                          .map((d) => (
                            <p key={d.id} className="flex items-start gap-1.5 text-[10px] text-amber-700">
                              <CircleAlert size={11} className="mt-0.5 shrink-0" />
                              <span className="font-mono">{d.pn}:</span> {d.confidenceNote}
                            </p>
                          ))}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
