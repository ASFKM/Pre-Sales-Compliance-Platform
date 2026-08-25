import { Fragment, useEffect, useMemo, useState } from "react";
import { Download, Upload, Loader2, TriangleAlert, ChevronDown, ChevronRight, Pencil, Check, X, RefreshCw, Trash2, Search } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import ApiClient from "../lib/api";
import PricingFileUploadModal from "./PricingFileUploadModal";
import type { BackgroundTask } from "../hooks/useBackgroundTasks";

interface PriceCatalogItem {
  id: string;
  itemCode: string;
  erpCode: string | null;
  category: string;
  pn: string;
  description: string;
  currentListPrice: number;
  currentListPriceUsd: number | null;
  currency: string;
  lastUpdateSource: "spreadsheet" | "supplier_quote";
  lastUpdateSupplierName: string | null;
  markupMin: number;
  markupMax: number;
  active: boolean;
}

interface PriceHistoryEntry {
  id: string;
  listPrice: number;
  effectiveDate: string;
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const usdFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

const rateDateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

function ExchangeRateBadge() {
  const [rate, setRate] = useState<number | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const applyResponse = (res: { usdBrlExchangeRate: number; usdBrlExchangeRateSource?: string | null; usdBrlExchangeRateUpdatedAt: string | null }) => {
    setRate(res.usdBrlExchangeRate);
    setSource(res.usdBrlExchangeRateSource ?? null);
    setUpdatedAt(res.usdBrlExchangeRateUpdatedAt);
  };

  const load = () =>
    ApiClient.get<{ success: boolean; usdBrlExchangeRate: number; usdBrlExchangeRateSource: string | null; usdBrlExchangeRateUpdatedAt: string | null }>(
      "/api/pricing/settings"
    )
      .then(applyResponse)
      .catch(() => setRate(null));

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    const value = Number(draft.replace(",", "."));
    if (!value || value <= 0) return;
    setSaving(true);
    try {
      const res = await ApiClient.put<{ success: boolean; usdBrlExchangeRate: number; usdBrlExchangeRateSource: string | null; usdBrlExchangeRateUpdatedAt: string | null }>(
        "/api/pricing/settings",
        { usdBrlExchangeRate: value }
      );
      applyResponse(res);
      setEditing(false);
    } catch {
      // silencioso - o badge simplesmente mantém a cotação anterior visível
    } finally {
      setSaving(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await ApiClient.post<{ success: boolean; usdBrlExchangeRate: number; usdBrlExchangeRateSource: string | null; usdBrlExchangeRateUpdatedAt: string | null }>(
        "/api/pricing/settings/refresh-exchange-rate",
        {}
      );
      applyResponse(res);
    } catch {
      // silencioso - fail-open, mantém a cotação anterior visível
    } finally {
      setRefreshing(false);
    }
  };

  if (rate == null) return null;

  const sourceCaption = `Fonte: ${source || "Banco Central do Brasil (PTAX)"}${
    updatedAt ? ` · atualizada em ${rateDateFormatter.format(new Date(updatedAt))}` : " · ainda não atualizada"
  }`;

  if (editing) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <div className="flex items-center gap-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5">
          <span className="text-slate-500">US$ 1 =</span>
          <input
            type="text"
            autoFocus
            defaultValue={rate.toFixed(2)}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="w-16 text-right border border-slate-300 rounded px-1 py-0.5"
          />
          <button onClick={save} disabled={saving} className="text-brand-600 hover:text-brand-700 disabled:opacity-50">
            <Check size={14} />
          </button>
          <button onClick={() => setEditing(false)} disabled={saving} className="text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        </div>
        <span className="text-[10px] text-slate-400">{sourceCaption}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-1">
        <button
          onClick={() => {
            setDraft(rate.toFixed(2));
            setEditing(true);
          }}
          title="Cotação usada para converter preços entre R$ e US$ ao importar a planilha"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-100"
        >
          Cotação: US$ 1 = {currencyFormatter.format(rate)}
          <Pencil size={11} />
        </button>
        <button
          onClick={refresh}
          disabled={refreshing}
          title="Buscar cotação atual no Banco Central agora"
          className="text-slate-400 hover:text-slate-600 disabled:opacity-50 p-1.5"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>
      <span className="text-[10px] text-slate-400">{sourceCaption}</span>
    </div>
  );
}

function PriceHistoryChart({ itemId }: { itemId: string }) {
  const [entries, setEntries] = useState<PriceHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ApiClient.get<{ success: boolean; entries: PriceHistoryEntry[] }>(`/api/pricing/catalog/${itemId}/history`)
      .then((res) => setEntries(res.entries))
      .catch((e: any) => setError(e.message || "Não foi possível carregar o histórico."));
  }, [itemId]);

  if (error) {
    return <div className="text-sm text-danger-700 px-4 py-3">{error}</div>;
  }
  if (!entries) {
    return <div className="text-sm text-slate-400 px-4 py-3">Carregando histórico...</div>;
  }
  if (entries.length < 2) {
    return <div className="text-sm text-slate-400 px-4 py-3">Ainda não há histórico suficiente para desenhar o gráfico (precisa de pelo menos 2 envios de tabela).</div>;
  }

  const data = entries.map((e) => ({ date: dateFormatter.format(new Date(e.effectiveDate)), price: e.listPrice }));

  return (
    <div className="px-4 py-3" style={{ height: 180 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-neutral-200)" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--color-neutral-500)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--color-neutral-500)" }} width={70} tickFormatter={(v) => currencyFormatter.format(v)} />
          <Tooltip formatter={(value) => currencyFormatter.format(Number(value))} />
          <Line type="monotone" dataKey="price" stroke="var(--color-brand-600)" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface PricingCatalogProps {
  onFilesProcessed?: () => void;
  waitForTask: (taskId: string) => Promise<BackgroundTask>;
  tasksById: Record<string, BackgroundTask>;
}

export default function PricingCatalog({ onFilesProcessed, waitForTask, tasksById }: PricingCatalogProps) {
  const [items, setItems] = useState<PriceCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [search, setSearch] = useState("");

  // Edição/exclusão direta de uma linha do catálogo - inline na própria tabela, mesmo espírito do
  // EditableCell de PricingExtractionReview.tsx (draft), mas aqui já é o item de verdade
  // (PUT/DELETE /api/pricing/catalog/:id).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, string> | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const startEdit = (item: PriceCatalogItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(item.id);
    setEditDraft({
      itemCode: item.itemCode,
      category: item.category,
      pn: item.pn,
      description: item.description,
      currentListPrice: String(item.currentListPrice),
      currentListPriceUsd: item.currentListPriceUsd != null ? String(item.currentListPriceUsd) : "",
      markupMin: String(item.markupMin),
      markupMax: String(item.markupMax),
    });
    setRowError(null);
  };

  const cancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
    setEditDraft(null);
    setRowError(null);
  };

  const saveEdit = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editDraft) return;
    setSavingEdit(true);
    setRowError(null);
    try {
      const body = {
        itemCode: editDraft.itemCode.trim(),
        category: editDraft.category.trim(),
        pn: editDraft.pn.trim(),
        description: editDraft.description.trim(),
        currentListPrice: Number(editDraft.currentListPrice.replace(",", ".")),
        currentListPriceUsd: editDraft.currentListPriceUsd.trim() ? Number(editDraft.currentListPriceUsd.replace(",", ".")) : null,
        markupMin: Number(editDraft.markupMin.replace(",", ".")),
        markupMax: Number(editDraft.markupMax.replace(",", ".")),
      };
      const res = await ApiClient.put<{ success: boolean; item: PriceCatalogItem }>(`/api/pricing/catalog/${id}`, body);
      setItems((prev) => prev.map((it) => (it.id === id ? res.item : it)));
      setEditingId(null);
      setEditDraft(null);
    } catch (e: any) {
      setRowError(e.message || "Não foi possível salvar as alterações.");
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteItem = async (item: PriceCatalogItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Excluir "${item.description}" (${item.itemCode}) do catálogo? Projetos que já usaram este item pra precificar mantêm os valores, mas perdem o vínculo com o catálogo.`)) return;
    try {
      await ApiClient.delete(`/api/pricing/catalog/${item.id}`);
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      if (expandedId === item.id) setExpandedId(null);
    } catch (e: any) {
      setError(e.message || "Não foi possível excluir o item.");
    }
  };

  const loadItems = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ApiClient.get<{ success: boolean; items: PriceCatalogItem[] }>("/api/pricing/catalog");
      setItems(res.items);
    } catch (e: any) {
      setError(e.message || "Não foi possível carregar o catálogo.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, []);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) =>
      [item.itemCode, item.erpCode, item.category, item.pn, item.description].some((field) => field?.toLowerCase().includes(term))
    );
  }, [items, search]);

  const downloadTemplate = async () => {
    const token = localStorage.getItem("ca_session_token");
    const res = await fetch("/api/pricing/catalog/template", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      setError("Não foi possível baixar o modelo de planilha.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tabela-de-precos-modelo.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Tabela de preços</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Cadastre e acompanhe os itens da sua tabela de preços. Cada envio de planilha cria uma nova versão de preço por item, sem apagar o histórico.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ExchangeRateBadge />
          <button
            onClick={downloadTemplate}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 border border-slate-300 rounded-lg px-3 py-2 hover:bg-slate-50"
          >
            <Download size={15} />
            Baixar modelo
          </button>
          <button
            onClick={() => setShowUploadModal(true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-brand-600 rounded-lg px-3 py-2 hover:bg-brand-700"
          >
            <Upload size={15} />
            Enviar Arquivos
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 text-sm text-danger-700 bg-danger-50 border border-danger-200 rounded-lg px-3 py-2">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="relative mb-3 max-w-xs">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por código, PN, categoria ou descrição..."
          className="w-full text-xs border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div className="border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide">
            <tr>
              <th className="text-left px-2.5 py-1.5 font-medium">Código</th>
              <th className="text-left px-2.5 py-1.5 font-medium">Categoria</th>
              <th className="text-left px-2.5 py-1.5 font-medium">PN</th>
              <th className="text-left px-2.5 py-1.5 font-medium">Descrição</th>
              <th className="text-right px-2.5 py-1.5 font-medium">Preço de lista (R$)</th>
              <th className="text-right px-2.5 py-1.5 font-medium">Preço de lista (US$)</th>
              <th className="text-right px-2.5 py-1.5 font-medium">Markup mín / máx</th>
              <th className="text-right px-2.5 py-1.5 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={8} className="px-2.5 py-8 text-center text-slate-400">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-2.5 py-8 text-center text-slate-400">
                  Nenhum item cadastrado ainda. Baixe o modelo, preencha e envie a planilha.
                </td>
              </tr>
            )}
            {!loading && items.length > 0 && filteredItems.length === 0 && (
              <tr>
                <td colSpan={8} className="px-2.5 py-8 text-center text-slate-400">
                  Nenhum item encontrado para "{search}".
                </td>
              </tr>
            )}
            {filteredItems.map((item) => {
              const expanded = expandedId === item.id;
              const isEditing = editingId === item.id;
              const inputClass = "w-full text-xs border border-slate-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-brand-500";
              return (
                <Fragment key={item.id}>
                  <tr
                    onClick={() => !isEditing && setExpandedId(expanded ? null : item.id)}
                    className={isEditing ? "bg-brand-50/40" : "hover:bg-slate-50 cursor-pointer"}
                  >
                    <td className="px-2.5 py-1 font-mono text-xs text-slate-700">
                      {isEditing ? (
                        <input className={inputClass} value={editDraft?.itemCode ?? ""} onChange={(e) => setEditDraft((d) => (d ? { ...d, itemCode: e.target.value } : d))} onClick={(e) => e.stopPropagation()} />
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          {expanded ? <ChevronDown size={13} className="text-slate-400" /> : <ChevronRight size={13} className="text-slate-400" />}
                          {item.itemCode}
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-1 text-slate-600">
                      {isEditing ? (
                        <input className={inputClass} value={editDraft?.category ?? ""} onChange={(e) => setEditDraft((d) => (d ? { ...d, category: e.target.value } : d))} onClick={(e) => e.stopPropagation()} />
                      ) : (
                        item.category
                      )}
                    </td>
                    <td className="px-2.5 py-1 font-mono text-xs text-slate-600">
                      {isEditing ? (
                        <input className={inputClass} value={editDraft?.pn ?? ""} onChange={(e) => setEditDraft((d) => (d ? { ...d, pn: e.target.value } : d))} onClick={(e) => e.stopPropagation()} />
                      ) : (
                        item.pn
                      )}
                    </td>
                    <td className="px-2.5 py-1 text-slate-700">
                      {isEditing ? (
                        <input className={inputClass} value={editDraft?.description ?? ""} onChange={(e) => setEditDraft((d) => (d ? { ...d, description: e.target.value } : d))} onClick={(e) => e.stopPropagation()} />
                      ) : (
                        <>
                          <div>{item.description}</div>
                          <div className="text-[10px] text-slate-400">
                            {item.lastUpdateSource === "supplier_quote"
                              ? `via cotação${item.lastUpdateSupplierName ? ` — ${item.lastUpdateSupplierName}` : ""}`
                              : "via planilha"}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="px-2.5 py-1 text-right text-slate-700">
                      {isEditing ? (
                        <input className={`${inputClass} text-right`} value={editDraft?.currentListPrice ?? ""} onChange={(e) => setEditDraft((d) => (d ? { ...d, currentListPrice: e.target.value } : d))} onClick={(e) => e.stopPropagation()} />
                      ) : (
                        currencyFormatter.format(item.currentListPrice)
                      )}
                    </td>
                    <td className="px-2.5 py-1 text-right text-slate-500">
                      {isEditing ? (
                        <input className={`${inputClass} text-right`} placeholder="—" value={editDraft?.currentListPriceUsd ?? ""} onChange={(e) => setEditDraft((d) => (d ? { ...d, currentListPriceUsd: e.target.value } : d))} onClick={(e) => e.stopPropagation()} />
                      ) : item.currentListPriceUsd != null ? (
                        usdFormatter.format(item.currentListPriceUsd)
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2.5 py-1 text-right text-slate-500">
                      {isEditing ? (
                        <div className="flex items-center gap-1 justify-end">
                          <input className={`${inputClass} text-right w-14`} value={editDraft?.markupMin ?? ""} onChange={(e) => setEditDraft((d) => (d ? { ...d, markupMin: e.target.value } : d))} onClick={(e) => e.stopPropagation()} />
                          <span>/</span>
                          <input className={`${inputClass} text-right w-14`} value={editDraft?.markupMax ?? ""} onChange={(e) => setEditDraft((d) => (d ? { ...d, markupMax: e.target.value } : d))} onClick={(e) => e.stopPropagation()} />
                        </div>
                      ) : (
                        `${item.markupMin}% / ${item.markupMax}%`
                      )}
                    </td>
                    <td className="px-2.5 py-1 text-right">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5 justify-end">
                          <button onClick={(e) => saveEdit(item.id, e)} disabled={savingEdit} className="text-brand-600 hover:text-brand-700 disabled:opacity-50" title="Salvar">
                            <Check size={15} />
                          </button>
                          <button onClick={cancelEdit} disabled={savingEdit} className="text-slate-400 hover:text-slate-600" title="Cancelar">
                            <X size={15} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 justify-end">
                          <button onClick={(e) => startEdit(item, e)} className="text-slate-400 hover:text-brand-600" title="Editar">
                            <Pencil size={14} />
                          </button>
                          <button onClick={(e) => deleteItem(item, e)} className="text-slate-400 hover:text-danger-600" title="Excluir">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {isEditing && rowError && (
                    <tr>
                      <td colSpan={8} className="px-2.5 pb-1 text-xs text-danger-700 bg-brand-50/40">
                        {rowError}
                      </td>
                    </tr>
                  )}
                  {expanded && !isEditing && (
                    <tr>
                      <td colSpan={8} className="bg-slate-50/60 border-t border-slate-100">
                        <PriceHistoryChart itemId={item.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {showUploadModal && (
        <PricingFileUploadModal
          onClose={() => setShowUploadModal(false)}
          onDone={() => {
            loadItems();
            onFilesProcessed?.();
          }}
          waitForTask={waitForTask}
          tasksById={tasksById}
        />
      )}
    </div>
  );
}
