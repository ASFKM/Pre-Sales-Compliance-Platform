import { useEffect, useMemo, useState } from "react";
import { FileUp, TriangleAlert, Loader2, CheckCircle2, CircleAlert, Target, Check, X, FolderOpen, Trash2, Search, Plus, Layers, Link2 } from "lucide-react";
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
  projectId: string | null;
  label: string | null;
  status: string;
  lines: ProjectPricingLine[];
}

interface ImportedPricingSheetSummary {
  id: string;
  projectId: string | null;
  displayName: string;
  standalone: boolean;
  status: string;
  destinationUF: string | null;
  totalLines: number;
  updatedAt: string;
}

interface CatalogItemOption {
  id: string;
  itemCode: string;
  pn: string;
  description: string;
  currentListPrice: number;
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

const SHEET_STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  finalized: "Finalizada",
};

const MATCH_LABEL: Record<ProjectPricingLine["matchStatus"], string> = {
  matched: "Casado com catálogo",
  manual: "Mapeado manualmente",
  unmatched: "Sem preço cadastrado",
};

const MATCH_COLOR: Record<ProjectPricingLine["matchStatus"], string> = {
  matched: "bg-success-50 text-success-700",
  manual: "bg-slate-100 text-slate-700",
  unmatched: "bg-warning-50 text-warning-700",
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
  const [importedSheets, setImportedSheets] = useState<ImportedPricingSheetSummary[]>([]);
  const [loadingImported, setLoadingImported] = useState(true);
  const [openingSheetId, setOpeningSheetId] = useState<string | null>(null);
  const [deletingSheetId, setDeletingSheetId] = useState<string | null>(null);
  const [mode, setMode] = useState<"project" | "standalone">("project");
  const [standaloneLabel, setStandaloneLabel] = useState<string>("");
  const [creatingStandalone, setCreatingStandalone] = useState(false);
  const [catalogItems, setCatalogItems] = useState<CatalogItemOption[]>([]);
  const [addItemQuery, setAddItemQuery] = useState("");
  const [addItemQty, setAddItemQty] = useState("1");
  const [addingLine, setAddingLine] = useState(false);
  const [deletingLineId, setDeletingLineId] = useState<string | null>(null);

  useEffect(() => {
    ApiClient.get<Project[]>("/api/projects")
      .then((res) => setProjects(res || []))
      .catch(() => setProjects([]));
    // Catálogo completo carregado só pra alimentar a busca de "adicionar item manualmente" abaixo
    // - tanto pra sessão avulsa (sem BOM de origem) quanto pra completar uma sessão importada de
    // projeto que ficou faltando um item.
    ApiClient.get<{ success: boolean; items: CatalogItemOption[] }>("/api/pricing/catalog")
      .then((res) => setCatalogItems(res.items || []))
      .catch(() => setCatalogItems([]));
  }, []);

  const loadImportedSheets = () => {
    setLoadingImported(true);
    ApiClient.get<{ success: boolean; sheets: ImportedPricingSheetSummary[] }>("/api/pricing/pricing-sheets")
      .then((res) => setImportedSheets(res.sheets || []))
      .catch(() => setImportedSheets([]))
      .finally(() => setLoadingImported(false));
  };

  useEffect(() => {
    loadImportedSheets();
  }, []);

  const openSheet = async (sheetId: string, projectId: string | null) => {
    setOpeningSheetId(sheetId);
    setError(null);
    setImportSummary(null);
    setSuggestion(null);
    try {
      const sheetRes = await ApiClient.get<{ success: boolean; sheet: ProjectPricingSheet }>(`/api/pricing/pricing-sheets/${sheetId}`);
      setSheet(sheetRes.sheet);
      setMode(projectId ? "project" : "standalone");
      if (projectId) setSelectedProjectId(projectId);
      setOutOfRangeLineIds(new Set());
    } catch (e: any) {
      setError(e.message || "Não foi possível abrir esta sessão de precificação.");
    } finally {
      setOpeningSheetId(null);
    }
  };

  const deleteSheet = async (s: ImportedPricingSheetSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Excluir a sessão de precificação "${s.displayName}"? Os descontos e ajustes aplicados nela serão perdidos${s.standalone ? "" : " - o BOM do projeto continua intacto e pode ser reimportado depois"}.`)) return;
    setDeletingSheetId(s.id);
    setError(null);
    try {
      await ApiClient.delete(`/api/pricing/pricing-sheets/${s.id}`);
      setImportedSheets((prev) => prev.filter((it) => it.id !== s.id));
      if (sheet?.id === s.id) setSheet(null);
    } catch (e: any) {
      setError(e.message || "Não foi possível excluir esta sessão de precificação.");
    } finally {
      setDeletingSheetId(null);
    }
  };

  const createStandaloneSheet = async () => {
    if (!standaloneLabel.trim()) return;
    setCreatingStandalone(true);
    setError(null);
    setImportSummary(null);
    try {
      const res = await ApiClient.post<{ success: boolean; sheetId: string }>("/api/pricing/pricing-sheets", {
        label: standaloneLabel.trim(),
        ...(destinationUF.length === 2 ? { destinationUF } : {}),
      });
      const sheetRes = await ApiClient.get<{ success: boolean; sheet: ProjectPricingSheet }>(`/api/pricing/pricing-sheets/${res.sheetId}`);
      setSheet(sheetRes.sheet);
      setStandaloneLabel("");
      loadImportedSheets();
    } catch (e: any) {
      setError(e.message || "Não foi possível criar a precificação avulsa.");
    } finally {
      setCreatingStandalone(false);
    }
  };

  const addLine = async (catalogItemId: string) => {
    if (!sheet) return;
    const qty = Number(addItemQty.replace(",", "."));
    if (!qty || qty <= 0) {
      setError("Informe uma quantidade válida antes de adicionar o item.");
      return;
    }
    setAddingLine(true);
    setError(null);
    try {
      const res = await ApiClient.post<{ success: boolean; line: ProjectPricingLine }>(`/api/pricing/pricing-sheets/${sheet.id}/lines`, {
        catalogItemId,
        quantity: qty,
      });
      setSheet({ ...sheet, lines: [...sheet.lines, res.line] });
      setAddItemQuery("");
      setAddItemQty("1");
      loadImportedSheets();
    } catch (e: any) {
      setError(e.message || "Não foi possível adicionar este item.");
    } finally {
      setAddingLine(false);
    }
  };

  const deleteLine = async (lineId: string) => {
    if (!sheet) return;
    setDeletingLineId(lineId);
    setError(null);
    try {
      await ApiClient.delete(`/api/pricing/pricing-sheets/${sheet.id}/lines/${lineId}`);
      setSheet({ ...sheet, lines: sheet.lines.filter((l) => l.id !== lineId) });
    } catch (e: any) {
      setError(e.message || "Não foi possível remover este item.");
    } finally {
      setDeletingLineId(null);
    }
  };

  const addItemMatches = useMemo(() => {
    const term = addItemQuery.trim().toLowerCase();
    if (!term) return [];
    return catalogItems
      .filter((it) => [it.itemCode, it.pn, it.description].some((f) => f?.toLowerCase().includes(term)))
      .slice(0, 8);
  }, [catalogItems, addItemQuery]);

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
      loadImportedSheets();
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
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-800">Precificação de projeto</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Importe o BOM de um projeto para associar automaticamente os preços já cadastrados e aplicar desconto por item, ou crie uma precificação avulsa e adicione itens do catálogo manualmente.
        </p>
      </div>

      <div className="flex items-center gap-1 mb-3">
        <button
          onClick={() => {
            setMode("project");
            setSheet(null);
            setImportSummary(null);
          }}
          className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 border ${
            mode === "project" ? "bg-slate-800 text-white border-slate-800" : "text-slate-500 border-slate-300 hover:bg-slate-50"
          }`}
        >
          <Link2 size={13} />
          Vinculada a projeto
        </button>
        <button
          onClick={() => {
            setMode("standalone");
            setSheet(null);
            setImportSummary(null);
          }}
          className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 border ${
            mode === "standalone" ? "bg-slate-800 text-white border-slate-800" : "text-slate-500 border-slate-300 hover:bg-slate-50"
          }`}
        >
          <Layers size={13} />
          Avulsa (sem projeto)
        </button>
      </div>

      <div className="flex items-center gap-2 mb-6">
        {mode === "project" ? (
          <>
            <select
              value={selectedProjectId}
              onChange={(e) => {
                setSelectedProjectId(e.target.value);
                setSheet(null);
                setImportSummary(null);
              }}
              className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 min-w-[280px] focus:outline-none focus:ring-1 focus:ring-brand-500"
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
              className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 w-36 uppercase focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <button
              onClick={importBom}
              disabled={!selectedProjectId || importing}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-brand-600 rounded-lg px-2.5 py-1.5 hover:bg-brand-700 disabled:opacity-60"
            >
              {importing ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
              {importing ? "Importando..." : "Importar BOM"}
            </button>
          </>
        ) : (
          <>
            <input
              type="text"
              value={standaloneLabel}
              onChange={(e) => setStandaloneLabel(e.target.value)}
              placeholder="Nome desta precificação (ex: Cotação avulsa - Cliente X)"
              className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 min-w-[280px] focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <input
              type="text"
              maxLength={2}
              value={destinationUF}
              onChange={(e) => setDestinationUF(e.target.value.toUpperCase())}
              placeholder="UF destino (opcional)"
              title="Só é usada pelo motor fiscal, se estiver ligado nas Configurações"
              className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 w-36 uppercase focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <button
              onClick={createStandaloneSheet}
              disabled={!standaloneLabel.trim() || creatingStandalone}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-brand-600 rounded-lg px-2.5 py-1.5 hover:bg-brand-700 disabled:opacity-60"
            >
              {creatingStandalone ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {creatingStandalone ? "Criando..." : "Criar precificação avulsa"}
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 text-sm text-danger-700 bg-danger-50 border border-danger-200 rounded-lg px-3 py-2">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {importSummary && (
        <div className="mb-4 text-sm bg-brand-50 border border-brand-200 text-brand-800 rounded-lg px-3 py-2">
          BOM importado: {importSummary.total} item(ns) — {importSummary.matched} casado(s) com o catálogo, {importSummary.unmatched} sem preço cadastrado.
        </div>
      )}

      {sheet && (
        <p className="mb-3 text-xs text-slate-500">
          Sessão aberta: <span className="font-medium text-slate-700">{sheet.label || projects.find((p) => p.id === sheet.projectId)?.name || "—"}</span>
        </p>
      )}

      {sheet && (
        <div className="mb-6 border border-slate-200 rounded-lg p-4 bg-slate-50/50">
          <div className="flex items-center gap-2 mb-1">
            <Target size={16} className="text-brand-600" />
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
              className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 w-48 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <button
              onClick={runOptimization}
              disabled={optimizing || !targetBudget}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-brand-600 rounded-lg px-2.5 py-1.5 hover:bg-brand-700 disabled:opacity-60"
            >
              {optimizing ? <Loader2 size={14} className="animate-spin" /> : <Target size={14} />}
              {optimizing ? "Calculando..." : "Calcular"}
            </button>
          </div>

          {suggestion && (
            <div className="mt-4 border-t border-slate-200 pt-4">
              {!suggestion.feasible && (
                <div className="mb-3 flex items-start gap-2 text-sm text-warning-700 bg-warning-50 border border-warning-200 rounded-lg px-3 py-2">
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
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-2.5 py-1.5 font-medium whitespace-nowrap">Item</th>
                      <th className="text-right px-2.5 py-1.5 font-medium whitespace-nowrap">Desconto atual</th>
                      <th className="text-right px-2.5 py-1.5 font-medium whitespace-nowrap">Desconto sugerido</th>
                      <th className="text-right px-2.5 py-1.5 font-medium whitespace-nowrap">Preço final sugerido</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {suggestion.lines.map((s) => {
                      const line = lineById.get(s.id);
                      return (
                        <tr key={s.id}>
                          <td className="px-2.5 py-1 text-slate-700 whitespace-nowrap">{line?.rawDescription || s.id}</td>
                          <td className="px-2.5 py-1 text-right text-slate-500">{line?.discountPercent ?? 0}%</td>
                          <td className="px-2.5 py-1 text-right font-medium text-brand-700">{s.discountPercent}%</td>
                          <td className="px-2.5 py-1 text-right text-slate-700">{currencyFormatter.format(s.finalUnitPrice)}</td>
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
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-brand-600 rounded-lg px-3 py-2 hover:bg-brand-700 disabled:opacity-60"
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
        <div className="relative mb-3 max-w-md">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={addItemQuery}
                onChange={(e) => setAddItemQuery(e.target.value)}
                placeholder="Buscar item do catálogo pra adicionar a esta sessão..."
                className="w-full text-xs border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <input
              type="number"
              min={1}
              step="1"
              value={addItemQty}
              onChange={(e) => setAddItemQty(e.target.value)}
              title="Quantidade"
              className="w-16 text-xs text-right border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          {addItemMatches.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
              {addItemMatches.map((it) => (
                <button
                  key={it.id}
                  onClick={() => addLine(it.id)}
                  disabled={addingLine}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-brand-50 border-b border-slate-100 last:border-0 disabled:opacity-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-slate-500">{it.pn}</span>
                    <span className="text-slate-600 shrink-0">{currencyFormatter.format(it.currentListPrice)}</span>
                  </div>
                  <div className="text-slate-700 truncate">{it.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {sheet && (
        <div className="border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-xs table-fixed">
            <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide">
              <tr>
                <th className="text-left px-2.5 py-1.5 font-medium w-28 whitespace-nowrap">PN</th>
                <th className="text-left px-2.5 py-1.5 font-medium whitespace-nowrap">Descrição</th>
                <th className="text-left px-2.5 py-1.5 font-medium w-40 whitespace-nowrap">Status</th>
                <th className="text-right px-2.5 py-1.5 font-medium w-16 whitespace-nowrap">Qtd.</th>
                <th className="text-right px-2.5 py-1.5 font-medium w-32 whitespace-nowrap">Preço de lista</th>
                <th className="text-right px-2.5 py-1.5 font-medium w-28 whitespace-nowrap">Desconto %</th>
                <th className="text-right px-2.5 py-1.5 font-medium w-28 whitespace-nowrap">Preço final</th>
                <th className="text-right px-2.5 py-1.5 font-medium w-20 whitespace-nowrap">Margem</th>
                <th className="text-right px-2.5 py-1.5 font-medium w-10 whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sheet.lines.map((line) => {
                const outOfRange = outOfRangeLineIds.has(line.id);
                return (
                  <tr key={line.id} className="hover:bg-slate-50">
                    <td className="px-2.5 py-1 text-xs font-mono text-slate-500 truncate" title={line.rawPartNumber || undefined}>
                      {line.rawPartNumber || "sem PN"}
                    </td>
                    <td className="px-2.5 py-1 text-slate-700 truncate" title={line.rawDescription || undefined}>
                      {line.rawDescription || "—"}
                    </td>
                    <td className="px-2.5 py-1">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${MATCH_COLOR[line.matchStatus]}`}>
                        {MATCH_LABEL[line.matchStatus]}
                      </span>
                    </td>
                    <td className="px-2.5 py-1 text-right text-slate-600">{line.quantity}</td>
                    <td className="px-2.5 py-1 text-right text-slate-600">
                      {line.listPriceSnapshot != null ? currencyFormatter.format(line.listPriceSnapshot) : "—"}
                    </td>
                    <td className="px-2.5 py-1 text-right">
                      {line.matchStatus === "unmatched" ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step="0.01"
                            defaultValue={line.discountPercent}
                            disabled={savingLineId === line.id}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (!Number.isNaN(v) && v !== line.discountPercent) updateDiscount(line, v);
                            }}
                            className="w-14 text-right text-xs border border-slate-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                          <span className="text-xs text-slate-400 shrink-0">%</span>
                        </div>
                      )}
                    </td>
                    <td className="px-2.5 py-1 text-right text-slate-700">
                      {line.finalUnitPrice != null ? currencyFormatter.format(line.finalUnitPrice) : "—"}
                    </td>
                    <td className="px-2.5 py-1 text-right">
                      {line.marginPercent != null ? (
                        <span className={`inline-flex items-center gap-1 whitespace-nowrap ${outOfRange ? "text-warning-700" : "text-slate-600"}`}>
                          {outOfRange ? <CircleAlert size={13} /> : <CheckCircle2 size={13} className="text-success-600" />}
                          {line.marginPercent.toFixed(1)}%
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2.5 py-1 text-right">
                      <button
                        onClick={() => deleteLine(line.id)}
                        disabled={deletingLineId === line.id}
                        className="text-slate-300 hover:text-danger-600 disabled:opacity-50"
                        title="Remover item desta sessão"
                      >
                        {deletingLineId === line.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8">
        <div className="flex items-center gap-1.5 mb-2">
          <FolderOpen size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Sessões de precificação</h3>
        </div>
        <div className="border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide">
              <tr>
                <th className="text-left px-2.5 py-1.5 font-medium">Projeto / nome</th>
                <th className="text-left px-2.5 py-1.5 font-medium w-28">Status</th>
                <th className="text-left px-2.5 py-1.5 font-medium w-24">UF destino</th>
                <th className="text-right px-2.5 py-1.5 font-medium w-20">Itens</th>
                <th className="text-right px-2.5 py-1.5 font-medium w-36">Atualizado em</th>
                <th className="text-right px-2.5 py-1.5 font-medium w-12">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingImported && (
                <tr>
                  <td colSpan={6} className="px-2.5 py-6 text-center text-slate-400">
                    Carregando...
                  </td>
                </tr>
              )}
              {!loadingImported && importedSheets.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2.5 py-6 text-center text-slate-400">
                    Nenhuma sessão de precificação ainda.
                  </td>
                </tr>
              )}
              {importedSheets.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => openSheet(s.id, s.projectId)}
                  className={`cursor-pointer hover:bg-slate-50 ${sheet?.id === s.id ? "bg-brand-50/40" : ""}`}
                >
                  <td className="px-2.5 py-1 text-slate-700 truncate" title={s.displayName}>
                    <span className="inline-flex items-center gap-1.5">
                      {s.standalone && <Layers size={11} className="text-slate-400 shrink-0" aria-label="Avulsa" />}
                      {s.displayName}
                    </span>
                  </td>
                  <td className="px-2.5 py-1 text-slate-600">{SHEET_STATUS_LABEL[s.status] || s.status}</td>
                  <td className="px-2.5 py-1 text-slate-600">{s.destinationUF || "—"}</td>
                  <td className="px-2.5 py-1 text-right text-slate-600">{s.totalLines}</td>
                  <td className="px-2.5 py-1 text-right text-slate-500 whitespace-nowrap">
                    {openingSheetId === s.id ? <Loader2 size={12} className="animate-spin inline-block" /> : dateTimeFormatter.format(new Date(s.updatedAt))}
                  </td>
                  <td className="px-2.5 py-1 text-right">
                    <button
                      onClick={(e) => deleteSheet(s, e)}
                      disabled={deletingSheetId === s.id}
                      className="text-slate-400 hover:text-danger-600 disabled:opacity-50"
                      title="Excluir sessão de precificação"
                    >
                      {deletingSheetId === s.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
