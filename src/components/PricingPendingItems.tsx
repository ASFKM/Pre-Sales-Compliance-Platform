import { useEffect, useState } from "react";
import { Download, TriangleAlert } from "lucide-react";
import ApiClient from "../lib/api";

interface PendingItem {
  id: string;
  rawPN: string;
  rawDescription: string | null;
  timesSeen: number;
  firstSeenAt: string;
}

export default function PricingPendingItems() {
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ApiClient.get<{ success: boolean; pending: PendingItem[] }>("/api/pricing/pending-items");
      setPending(res.pending);
    } catch (e: any) {
      setError(e.message || "Não foi possível carregar os itens sem preço.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const exportPending = async () => {
    const token = localStorage.getItem("ca_session_token");
    const res = await fetch("/api/pricing/pending-items/export", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      setError("Não foi possível exportar a planilha.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "itens-sem-preco.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Itens sem preço</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            PNs vistos em BOMs de projetos que ainda não têm preço cadastrado. Exporte, preencha e reenvie pela aba "Tabela de preços" — assim que o item for cadastrado, ele fica resolvido aqui automaticamente.
          </p>
        </div>
        <button
          onClick={exportPending}
          disabled={pending.length === 0}
          className="inline-flex items-center gap-1.5 shrink-0 text-sm font-medium text-white bg-brand-600 rounded-lg px-3 py-2 hover:bg-brand-700 disabled:opacity-60"
        >
          <Download size={15} />
          Exportar pendências
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 text-sm text-danger-700 bg-danger-50 border border-danger-200 rounded-lg px-3 py-2">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide">
            <tr>
              <th className="text-left px-2.5 py-1.5 font-medium">PN</th>
              <th className="text-left px-2.5 py-1.5 font-medium">Descrição (do BOM)</th>
              <th className="text-right px-2.5 py-1.5 font-medium">Vezes visto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={3} className="px-2.5 py-8 text-center text-slate-400">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && pending.length === 0 && (
              <tr>
                <td colSpan={3} className="px-2.5 py-8 text-center text-slate-400">
                  Nenhuma pendência — todos os itens vistos em BOMs já têm preço cadastrado.
                </td>
              </tr>
            )}
            {pending.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50">
                <td className="px-2.5 py-1 font-mono text-xs text-slate-700">{item.rawPN}</td>
                <td className="px-2.5 py-1 text-slate-600">{item.rawDescription || "—"}</td>
                <td className="px-2.5 py-1 text-right text-slate-700 font-medium">{item.timesSeen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
