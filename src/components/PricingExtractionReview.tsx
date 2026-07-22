import { useEffect, useMemo, useState } from "react";
import { CircleAlert, Check, X, Loader2 } from "lucide-react";
import ApiClient from "../lib/api";

interface CatalogItemRef {
  itemCode: string;
  pn: string;
  description: string;
}

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

// Mesma exigência do servidor (POST /catalog/extraction-drafts/confirm): sem código, preço (R$ e
// US$) e markup mín/máx preenchidos, a linha não pode virar item de catálogo. Checado aqui também
// pra impedir a seleção ANTES de tentar confirmar, em vez de só mostrar um erro depois do clique.
function isDraftReadyToConfirm(d: ExtractionDraft): boolean {
  return !!d.itemCode && d.listPriceBrl != null && d.listPriceUsd != null && d.markupMin != null && d.markupMax != null;
}

function normalizePn(pn: string): string {
  return pn.trim().toLowerCase();
}

// Edição inline direto no draft - cada onBlur salva o campo editado imediatamente (PUT), sem um
// botão de "salvar" separado. Confirmar em lote é uma ação à parte (POST /confirm). `required`
// marca a borda em vermelho enquanto o campo estiver vazio, pra deixar claro o que falta pra essa
// linha poder ser confirmada. `prefix` mostra o símbolo da moeda (R$/US$) colado ao valor, não só
// no cabeçalho da coluna - um número solto não deixa claro em qual moeda está.
function EditableCell({
  value,
  onSave,
  type = "text",
  placeholder,
  required = false,
  align = "left",
  prefix,
  step,
}: {
  value: string | number | null;
  onSave: (v: string) => void;
  type?: "text" | "number";
  placeholder?: string;
  required?: boolean;
  align?: "left" | "right";
  prefix?: string;
  step?: string;
}) {
  const isEmpty = value == null || value === "";
  const displayValue = typeof value === "number" ? value.toFixed(2) : value ?? "";
  return (
    <div className="flex items-center gap-1">
      {prefix && <span className="text-[10px] text-slate-400 shrink-0">{prefix}</span>}
      <input
        type={type}
        step={step}
        defaultValue={displayValue}
        placeholder={placeholder}
        onBlur={(e) => {
          if (e.target.value !== String(displayValue)) onSave(e.target.value);
        }}
        className={`w-full min-w-0 text-xs rounded px-1.5 py-1 bg-transparent focus:bg-white outline-none border ${
          align === "right" ? "text-right" : "text-left"
        } ${required && isEmpty ? "border-red-300 bg-red-50/50" : "border-transparent hover:border-slate-300"} focus:border-emerald-500`}
      />
    </div>
  );
}

export default function PricingExtractionReview({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const [drafts, setDrafts] = useState<ExtractionDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [catalogItems, setCatalogItems] = useState<CatalogItemRef[]>([]);

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
    // Catálogo completo carregado só pra montar o índice de PN abaixo (nenhum campo extra além
    // do necessário pra sugerir/alertar sobre duplicidade - ver pnIndex).
    ApiClient.get<{ success: boolean; items: CatalogItemRef[] }>("/api/pricing/catalog")
      .then((res) => setCatalogItems(res.items || []))
      .catch(() => setCatalogItems([]));
  }, []);

  // Achado real (verificado no código): a extração por IA de cotação de fornecedor nunca cruza
  // com o catálogo já cadastrado - "item_code" só vem preenchido se estiver escrito no próprio
  // documento do fornecedor (quase nunca), e o confirmar (POST /extraction-drafts/confirm) faz
  // upsert por (tenantId, itemCode) só, sem checar PN/descrição. Ou seja, sem essa ajuda aqui, uma
  // descrição "levemente diferente" (ou nenhuma reconciliação de código) cria um item DUPLICADO em
  // vez de atualizar o existente. Este índice por PN normalizado é o sinal mais confiável
  // disponível (é o identificador real do produto) pra avisar/sugerir antes de confirmar.
  const pnIndex = useMemo(() => {
    const map = new Map<string, CatalogItemRef>();
    for (const item of catalogItems) map.set(normalizePn(item.pn), item);
    return map;
  }, [catalogItems]);

  const saveField = async (id: string, field: string, rawValue: string) => {
    const isNumeric = ["listPriceBrl", "listPriceUsd", "markupMin", "markupMax"].includes(field);
    const isCurrency = field === "listPriceBrl" || field === "listPriceUsd";
    let value: string | number | null = isNumeric ? (rawValue === "" ? null : Number(rawValue)) : rawValue === "" ? null : rawValue;
    // Preço sempre com 2 casas decimais - evita ruído de ponto flutuante da conversão de moeda
    // (ex: 221.15384615384616) tanto na tela quanto no banco.
    if (isCurrency && typeof value === "number") value = Math.round(value * 100) / 100;
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
            catálogo. Nada aqui é gravado automaticamente. Linhas com campos obrigatórios em vermelho (código, preço,
            markup mín/máx) não podem ser selecionadas até serem preenchidas.
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
        Object.entries(groupedByUpload).map(([fileName, rows]) => {
          const readyRows = rows.filter(isDraftReadyToConfirm);
          return (
            <div key={fileName} className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={readyRows.length > 0 && readyRows.every((r) => selected.has(r.id))}
                  disabled={readyRows.length === 0}
                  onChange={() => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      const allSelected = readyRows.every((r) => next.has(r.id));
                      for (const r of readyRows) (allSelected ? next.delete(r.id) : next.add(r.id));
                      return next;
                    });
                  }}
                  className="w-3.5 h-3.5"
                  title={readyRows.length === 0 ? "Nenhuma linha deste arquivo está completa ainda" : undefined}
                />
                {fileName}
                {rows[0]?.supplierName && <span className="text-slate-400">— {rows[0].supplierName}</span>}
                <span className="text-slate-400">
                  ({rows.length} item(ns){readyRows.length < rows.length ? `, ${rows.length - readyRows.length} incompleto(s)` : ""})
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs table-fixed">
                  <colgroup>
                    <col className="w-7" />
                    <col className="w-24" />
                    <col className="w-20" />
                    <col className="w-24" />
                    <col />
                    <col className="w-28" />
                    <col className="w-28" />
                    <col className="w-20" />
                    <col className="w-20" />
                    <col className="w-28" />
                    <col className="w-9" />
                  </colgroup>
                  <thead className="bg-slate-50 text-slate-500 uppercase tracking-wide text-[10px]">
                    <tr>
                      <th className="px-2 py-1.5"></th>
                      <th className="text-left px-2 py-1.5 font-medium">Código</th>
                      <th className="text-left px-2 py-1.5 font-medium">Categoria</th>
                      <th className="text-left px-2 py-1.5 font-medium">PN</th>
                      <th className="text-left px-2 py-1.5 font-medium">Descrição</th>
                      <th className="text-right px-2 py-1.5 font-medium">Preço (R$)</th>
                      <th className="text-right px-2 py-1.5 font-medium">Preço (US$)</th>
                      <th className="text-right px-2 py-1.5 font-medium">Markup mín (%)</th>
                      <th className="text-right px-2 py-1.5 font-medium">Markup máx (%)</th>
                      <th className="text-left px-2 py-1.5 font-medium">Fornecedor</th>
                      <th className="px-2 py-1.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((d) => {
                      const ready = isDraftReadyToConfirm(d);
                      const catalogMatch = pnIndex.get(normalizePn(d.pn));
                      return (
                        <tr key={d.id} className={selected.has(d.id) ? "bg-emerald-50/40" : !ready ? "bg-amber-50/30" : ""}>
                          <td className="px-2 py-1 align-top">
                            <input
                              type="checkbox"
                              checked={selected.has(d.id)}
                              disabled={!ready}
                              title={!ready ? "Preencha os campos obrigatórios (em vermelho) antes de selecionar" : undefined}
                              onChange={() =>
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  next.has(d.id) ? next.delete(d.id) : next.add(d.id);
                                  return next;
                                })
                              }
                              className="w-3.5 h-3.5 mt-1 disabled:opacity-30"
                            />
                          </td>
                          <td className="px-1 py-1 align-top">
                            <EditableCell value={d.itemCode} onSave={(v) => saveField(d.id, "itemCode", v)} placeholder="obrigatório" required />
                            {catalogMatch && !d.itemCode && (
                              <button
                                onClick={() => saveField(d.id, "itemCode", catalogMatch.itemCode)}
                                title={`PN já cadastrado no catálogo como "${catalogMatch.description}"`}
                                className="mt-0.5 block text-left text-[9px] text-blue-600 hover:underline leading-tight"
                              >
                                PN já existe: usar {catalogMatch.itemCode}
                              </button>
                            )}
                            {catalogMatch && d.itemCode && d.itemCode === catalogMatch.itemCode && (
                              <span className="mt-0.5 block text-[9px] text-emerald-600 leading-tight">Atualiza item existente</span>
                            )}
                            {catalogMatch && d.itemCode && d.itemCode !== catalogMatch.itemCode && (
                              <span
                                title={`PN já está cadastrado sob o código "${catalogMatch.itemCode}" - confirme se este é mesmo um item diferente antes de confirmar.`}
                                className="mt-0.5 flex items-center gap-0.5 text-[9px] text-amber-600 leading-tight"
                              >
                                <CircleAlert size={9} className="shrink-0" />
                                PN já existe c/ outro código
                              </span>
                            )}
                          </td>
                          <td className="px-1 py-1 align-top">
                            <EditableCell value={d.category} onSave={(v) => saveField(d.id, "category", v)} placeholder="—" />
                          </td>
                          <td className="px-1 py-1 align-top">
                            <EditableCell value={d.pn} onSave={(v) => saveField(d.id, "pn", v)} />
                          </td>
                          <td className="px-1 py-1 align-top">
                            <EditableCell value={d.description} onSave={(v) => saveField(d.id, "description", v)} />
                          </td>
                          <td className="px-1 py-1 align-top">
                            <EditableCell value={d.listPriceBrl} type="number" step="0.01" prefix="R$" onSave={(v) => saveField(d.id, "listPriceBrl", v)} align="right" required />
                          </td>
                          <td className="px-1 py-1 align-top">
                            <EditableCell value={d.listPriceUsd} type="number" step="0.01" prefix="US$" onSave={(v) => saveField(d.id, "listPriceUsd", v)} align="right" required />
                          </td>
                          <td className="px-1 py-1 align-top">
                            <EditableCell value={d.markupMin} type="number" onSave={(v) => saveField(d.id, "markupMin", v)} placeholder="%" align="right" required />
                          </td>
                          <td className="px-1 py-1 align-top">
                            <EditableCell value={d.markupMax} type="number" onSave={(v) => saveField(d.id, "markupMax", v)} placeholder="%" align="right" required />
                          </td>
                          <td className="px-1 py-1 align-top">
                            <EditableCell value={d.supplierName} onSave={(v) => saveField(d.id, "supplierName", v)} placeholder="—" />
                          </td>
                          <td className="px-2 py-1 align-top">
                            <button onClick={() => reject(d.id)} title="Rejeitar" className="text-slate-400 hover:text-red-500">
                              <X size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
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
          );
        })
      )}
    </div>
  );
}
