import { Fragment, useEffect, useRef, useState } from "react";
import { Download, Upload, Loader2, TriangleAlert, ChevronDown, ChevronRight, Pencil, Check, X, RefreshCw } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import ApiClient from "../lib/api";

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
  markupMin: number;
  markupMax: number;
  active: boolean;
}

interface UploadResult {
  uploadId: string;
  created: number;
  updated: number;
  errors: { rowNumber: number; message: string }[];
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
          <button onClick={save} disabled={saving} className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50">
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
    return <div className="text-sm text-red-600 px-4 py-3">{error}</div>;
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
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} />
          <YAxis tick={{ fontSize: 11, fill: "#64748b" }} width={70} tickFormatter={(v) => currencyFormatter.format(v)} />
          <Tooltip formatter={(value) => currencyFormatter.format(Number(value))} />
          <Line type="monotone" dataKey="price" stroke="#059669" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function PricingCatalog() {
  const [items, setItems] = useState<PriceCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [lastUpload, setLastUpload] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileSelected = async (file: File) => {
    setUploading(true);
    setError(null);
    setLastUpload(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await ApiClient.post<UploadResult & { success: boolean }>("/api/pricing/catalog/upload", formData);
      setLastUpload(res);
      await loadItems();
    } catch (e: any) {
      setError(e.message || "Falha ao enviar a planilha.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-emerald-600 rounded-lg px-3 py-2 hover:bg-emerald-700 disabled:opacity-60"
          >
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {uploading ? "Enviando..." : "Enviar planilha"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelected(file);
            }}
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {lastUpload && (
        <div className="mb-4 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2">
          Planilha processada: {lastUpload.created} item(ns) novo(s), {lastUpload.updated} atualizado(s)
          {lastUpload.errors.length > 0 && (
            <>
              , {lastUpload.errors.length} linha(s) com erro:
              <ul className="mt-1 list-disc list-inside text-amber-800">
                {lastUpload.errors.map((err) => (
                  <li key={err.rowNumber}>
                    Linha {err.rowNumber}: {err.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          {lastUpload.errors.length === 0 && "."}
        </div>
      )}

      <div className="border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Código</th>
              <th className="text-left px-3 py-2 font-medium">Categoria</th>
              <th className="text-left px-3 py-2 font-medium">PN</th>
              <th className="text-left px-3 py-2 font-medium">Descrição</th>
              <th className="text-right px-3 py-2 font-medium">Preço de lista (R$)</th>
              <th className="text-right px-3 py-2 font-medium">Preço de lista (US$)</th>
              <th className="text-right px-3 py-2 font-medium">Markup mín / máx</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                  Nenhum item cadastrado ainda. Baixe o modelo, preencha e envie a planilha.
                </td>
              </tr>
            )}
            {items.map((item) => {
              const expanded = expandedId === item.id;
              return (
                <Fragment key={item.id}>
                  <tr
                    onClick={() => setExpandedId(expanded ? null : item.id)}
                    className="hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-slate-700">
                      <span className="inline-flex items-center gap-1">
                        {expanded ? <ChevronDown size={13} className="text-slate-400" /> : <ChevronRight size={13} className="text-slate-400" />}
                        {item.itemCode}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{item.category}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{item.pn}</td>
                    <td className="px-3 py-2 text-slate-700">{item.description}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{currencyFormatter.format(item.currentListPrice)}</td>
                    <td className="px-3 py-2 text-right text-slate-500">
                      {item.currentListPriceUsd != null ? usdFormatter.format(item.currentListPriceUsd) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">
                      {item.markupMin}% / {item.markupMax}%
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={7} className="bg-slate-50/60 border-t border-slate-100">
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
    </div>
  );
}
