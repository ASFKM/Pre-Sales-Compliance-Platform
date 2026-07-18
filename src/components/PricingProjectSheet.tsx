import { useEffect, useState } from "react";
import { FileUp, TriangleAlert, Loader2, CheckCircle2, CircleAlert, Target, Check, X } from "lucide-react";
import ApiClient from "../lib/api";
import { Project } from "../types";

interface ProjectPricingLine {
  id: string;
  bomItemId: string;
  rawPartNumber: string | null;
  rawDescription: string | null;
  matchStatus: "matched" | "manual" | "unmatched";
  quantity: number;
  listPriceSnapshot: number | null;
  discountPercent: number;
  finalUnitPrice: number | null;
  marginPercent: number | null;
}

interface ProjectPricingSheet {
  id: string;
  projectId: string;
  status: string;
  lines: ProjectPricingLine[];
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const MATCH_LABEL: Record<ProjectPricingLine["matchStatus"], string> = {
  matched: "Casado com catálogo",
  manual: "Mapeado manualmente",
  unmatched: "Sem preço cadastrado",
};

const MATCH_COLOR: Record<ProjectPricingLine["matchStatus"], string> = {
  matched: "bg-emerald-50 text-emerald-700",
  manual: "bg-blue-50 text-blue-700",
  unmatched: "bg-amber-50 text-amber-700",
};

const STRATEGY_LABEL: Record<string, string> = {
  equal_percent: "Mesmo % de desconto em todas as linhas",
  equal_amount: "Mesmo valor de desconto em R$ por linha",
};

interface LineSuggestion {
  id: string;
  discountPercent: number;
  finalUnitPrice: number;
  lineTotal: number;
}

interface BudgetOptimizeResponse {
  runId: string;
  strategy: string;
  rationale: string;
  feasible: boolean;
  minAchievableTotal: number;
  maxAchievableTotal: number;
  achievedTotal: number;
  lines: LineSuggestion[];
}

export default function PricingProjectSheet() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [destinationUF, setDestinationUF] = useState<string>("");
  const [sheet, setSheet] = useState<ProjectPricingSheet | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<{ matched: number; unmatched: number; total: number } | null>(null);
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [outOfRangeLineIds, setOutOfRangeLineIds] = useState<Set<string>>(new Set());
  const [targetBudget, setTargetBudget] = useState<string>("");
  const [optimizing, setOptimizing] = useState(false);
  const [suggestion, setSuggestion] = useState<BudgetOptimizeResponse | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    ApiClient.get<Project[]>("/api/projects")
      .then((res) => setProjects(res || []))
      .catch(() => setProjects([]));
  }, []);

  const importBom = async () => {
    if (!selectedProjectId) return;
    setImporting(true);
    setError(null);
    setImportSummary(null);
    try {
      const res = await ApiClient.post<{ success: boolean; sheetId: string; matched: number; unmatched: number; total: number }>(
        `/api/pricing/projects/${selectedProjectId}/pricing-sheets`,
        destinationUF.length === 2 ? { destinationUF } : {}
      );
      setImportSummary({ matched: res.matched, unmatched: res.unmatched, total: res.total });
      const sheetRes = await ApiClient.get<{ success: boolean; sheet: ProjectPricingSheet }>(`/api/pricing/pricing-sheets/${res.sheetId}`);
      setSheet(sheetRes.sheet);
    } catch (e: any) {
      setError(e.message || "Não foi possível importar o BOM deste projeto.");
    } finally {
      setImporting(false);
    }
  };

  const updateDiscount = async (line: ProjectPricingLine, discountPercent: number) => {
    if (!sheet) return;
    setSavingLineId(line.id);
    try {
      const res = await ApiClient.put<{ success: boolean; line: ProjectPricingLine; withinMarkupRange: boolean }>(
        `/api/pricing/pricing-sheets/${sheet.id}/lines/${line.id}`,
        { discountPercent }
      );
      setSheet({ ...sheet, lines: sheet.lines.map((l) => (l.id === line.id ? res.line : l)) });
      setOutOfRangeLineIds((prev) => {
        const next = new Set(prev);
        if (res.withinMarkupRange) next.delete(line.id);
        else next.add(line.id);
        return next;
      });
    } catch (e: any) {
      setError(e.message || "Não foi possível salvar o desconto.");
    } finally {
      setSavingLineId(null);
    }
  };

  const runOptimization = async () => {
    if (!sheet) return;
    const value = Number(targetBudget);
    if (!value || value <= 0) {
      setError("Informe um valor de budget-alvo válido.");
      return;
    }
    setOptimizing(true);
    setError(null);
    setSuggestion(null);
    try {
      const res = await ApiClient.post<{ success: boolean } & BudgetOptimizeResponse>(
        `/api/pricing/pricing-sheets/${sheet.id}/budget-optimize`,
        { targetBudget: value }
      );
      setSuggestion(res);
    } catch (e: any) {
      setError(e.message || "Não foi possível calcular a otimização de budget.");
    } finally {
      setOptimizing(false);
    }
  };

  const acceptSuggestion = async () => {
    if (!sheet || !suggestion) return;
    setApplying(true);
    setError(null);
    try {
      const res = await ApiClient.post<{ success: boolean; sheet: ProjectPricingSheet }>(
        `/api/pricing/pricing-sheets/${sheet.id}/budget-optimize/${suggestion.runId}/apply`,
        {}
      );
      setSheet(res.sheet);
      setOutOfRangeLineIds(new Set());
      setSuggestion(null);
    } catch (e: any) {
      setError(e.message || "Não foi possível aplicar a sugestão.");
    } finally {
      setApplying(false);
    }
  };

  const lineById = new Map((sheet?.lines || []).map((l) => [l.id, l]));

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-800">Precificação de projeto</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Importe o BOM de um projeto para associar automaticamente os preços já cadastrados e aplicar desconto por item.
        </p>
      </div>

      <div className="flex items-center gap-2 mb-6">
        <select
          value={selectedProjectId}
          onChange={(e) => {
            setSelectedProjectId(e.target.value);
            setSheet(null);
            setImportSummary(null);
          }}
          className="text-sm border border-slate-300 rounded-lg px-3 py-2 min-w-[280px]"
        >
          <option value="">Selecione um projeto...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          maxLength={2}
          value={destinationUF}
          onChange={(e) => setDestinationUF(e.target.value.toUpperCase())}
          placeholder="UF destino (opcional)"
          title="Só é usada pelo motor fiscal, se estiver ligado nas Configurações"
          className="text-sm border border-slate-300 rounded-lg px-3 py-2 w-40 uppercase"
        />
        <button
          onClick={importBom}
          disabled={!selectedProjectId || importing}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-emerald-600 rounded-lg px-3 py-2 hover:bg-emerald-700 disabled:opacity-60"
        >
          {importing ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
          {importing ? "Importando..." : "Importar BOM"}
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {importSummary && (
        <div className="mb-4 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2">
          BOM importado: {importSummary.total} item(ns) — {importSummary.matched} casado(s) com o catálogo, {importSummary.unmatched} sem preço cadastrado.
        </div>
      )}

      {sheet && (
        <div className="mb-6 border border-slate-200 rounded-lg p-4 bg-slate-50/50">
          <div className="flex items-center gap-2 mb-1">
            <Target size={16} className="text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-800">Chegar no budget</h3>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Informe o valor total que a proposta precisa atingir. A IA escolhe a estratégia de distribuição do desconto entre as linhas casadas com o catálogo; o cálculo exato respeita sempre o markup mínimo de cada item.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder="Valor total alvo (R$)"
              value={targetBudget}
              onChange={(e) => setTargetBudget(e.target.value)}
              className="text-sm border border-slate-300 rounded-lg px-3 py-2 w-52"
            />
            <button
              onClick={runOptimization}
              disabled={optimizing || !targetBudget}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-emerald-600 rounded-lg px-3 py-2 hover:bg-emerald-700 disabled:opacity-60"
            >
              {optimizing ? <Loader2 size={15} className="animate-spin" /> : <Target size={15} />}
              {optimizing ? "Calculando..." : "Calcular"}
            </button>
          </div>

          {suggestion && (
            <div className="mt-4 border-t border-slate-200 pt-4">
              {!suggestion.feasible && (
                <div className="mb-3 flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                  Budget-alvo fora do que é possível respeitando o markup mínimo de cada item. Faixa
                  atingível: {currencyFormatter.format(suggestion.minAchievableTotal)} a {currencyFormatter.format(suggestion.maxAchievableTotal)}.
                  Aplicando o melhor esforço possível ({currencyFormatter.format(suggestion.achievedTotal)}).
                </div>
              )}
              <p className="text-sm text-slate-700 mb-1">
                <span className="font-medium">Estratégia escolhida:</span> {STRATEGY_LABEL[suggestion.strategy] || suggestion.strategy}
              </p>
              <p className="text-xs text-slate-500 mb-3">{suggestion.rationale}</p>

              <div className="border border-slate-200 rounded-lg overflow-x-auto bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Item</th>
                      <th className="text-right px-3 py-2 font-medium">Desconto atual</th>
                      <th className="text-right px-3 py-2 font-medium">Desconto sugerido</th>
                      <th className="text-right px-3 py-2 font-medium">Preço final sugerido</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {suggestion.lines.map((s) => {
                      const line = lineById.get(s.id);
                      return (
                        <tr key={s.id}>
                          <td className="px-3 py-2 text-slate-700">{line?.rawDescription || s.id}</td>
                          <td className="px-3 py-2 text-right text-slate-500">{line?.discountPercent ?? 0}%</td>
                          <td className="px-3 py-2 text-right font-medium text-emerald-700">{s.discountPercent}%</td>
                          <td className="px-3 py-2 text-right text-slate-700">{currencyFormatter.format(s.finalUnitPrice)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={acceptSuggestion}
                  disabled={applying}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-emerald-600 rounded-lg px-3 py-2 hover:bg-emerald-700 disabled:opacity-60"
                >
                  {applying ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  Aceitar e aplicar
                </button>
                <button
                  onClick={() => setSuggestion(null)}
                  disabled={applying}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 border border-slate-300 rounded-lg px-3 py-2 hover:bg-slate-50"
                >
                  <X size={15} />
                  Rejeitar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {sheet && (
        <div className="border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Item</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-right px-3 py-2 font-medium">Qtd.</th>
                <th className="text-right px-3 py-2 font-medium">Preço de lista</th>
                <th className="text-right px-3 py-2 font-medium">Desconto %</th>
                <th className="text-right px-3 py-2 font-medium">Preço final</th>
                <th className="text-right px-3 py-2 font-medium">Margem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sheet.lines.map((line) => {
                const outOfRange = outOfRangeLineIds.has(line.id);
                return (
                  <tr key={line.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-700">
                      <div>{line.rawDescription || "—"}</div>
                      <div className="text-xs font-mono text-slate-400">{line.rawPartNumber || "sem PN"}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${MATCH_COLOR[line.matchStatus]}`}>
                        {MATCH_LABEL[line.matchStatus]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">{line.quantity}</td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      {line.listPriceSnapshot != null ? currencyFormatter.format(line.listPriceSnapshot) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {line.matchStatus === "unmatched" ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          max={100}
                          defaultValue={line.discountPercent}
                          disabled={savingLineId === line.id}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (!Number.isNaN(v) && v !== line.discountPercent) updateDiscount(line, v);
                          }}
                          className="w-16 text-right text-sm border border-slate-300 rounded px-1.5 py-1"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">
                      {line.finalUnitPrice != null ? currencyFormatter.format(line.finalUnitPrice) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {line.marginPercent != null ? (
                        <span className={`inline-flex items-center gap-1 ${outOfRange ? "text-amber-600" : "text-slate-600"}`}>
                          {outOfRange ? <CircleAlert size={13} /> : <CheckCircle2 size={13} className="text-emerald-500" />}
                          {line.marginPercent.toFixed(1)}%
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
