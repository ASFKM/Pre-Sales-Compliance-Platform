import { Fragment, useEffect, useRef, useState } from "react";
import { Download, Upload, Loader2, TriangleAlert, ChevronDown, ChevronRight } from "lucide-react";
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
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

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
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Tabela de preços</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Cadastre e acompanhe os itens da sua tabela de preços. Cada envio de planilha cria uma nova versão de preço por item, sem apagar o histórico.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
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
              <th className="text-right px-3 py-2 font-medium">Preço de lista</th>
              <th className="text-right px-3 py-2 font-medium">Markup mín / máx</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
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
                      {item.markupMin}% / {item.markupMax}%
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={6} className="bg-slate-50/60 border-t border-slate-100">
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
