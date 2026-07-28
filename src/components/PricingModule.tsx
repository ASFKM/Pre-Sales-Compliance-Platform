import { useEffect, useState } from "react";
import PricingCatalog from "./PricingCatalog";
import PricingProjectSheet from "./PricingProjectSheet";
import PricingPendingItems from "./PricingPendingItems";
import PricingExtractionReview from "./PricingExtractionReview";
import PricingTaxSettings from "./PricingTaxSettings";
import ApiClient from "../lib/api";
import type { BackgroundTask } from "../hooks/useBackgroundTasks";

interface PricingModuleProps {
  waitForTask: (taskId: string) => Promise<BackgroundTask>;
  tasksById: Record<string, BackgroundTask>;
}

export default function PricingModule({ waitForTask, tasksById }: PricingModuleProps) {
  const [tab, setTab] = useState<"catalog" | "project" | "pending" | "extraction" | "tax">("catalog");
  const [extractionCount, setExtractionCount] = useState(0);

  const refreshExtractionCount = () => {
    ApiClient.get<{ success: boolean; drafts: unknown[] }>("/api/pricing/catalog/extraction-drafts")
      .then((res) => setExtractionCount(res.drafts.length))
      .catch(() => {});
  };

  useEffect(() => {
    refreshExtractionCount();
  }, []);

  // Atualização em tempo real do contador, independente do popup de upload estar aberto ou
  // fechado - tasksById já chega atualizado via SSE/Redis pub/sub (useBackgroundTasks em
  // App.tsx). Sem isso, o contador só reflete tarefas concluídas na próxima vez que o popup
  // dispara onFilesProcessed (no submit, antes de qualquer extração terminar de verdade).
  const completedExtractionTaskIds = Object.values(tasksById)
    .filter((t) => t.type === "pricing_catalog_extraction" && t.status === "completed")
    .map((t) => t.id)
    .join(",");
  useEffect(() => {
    if (completedExtractionTaskIds) refreshExtractionCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedExtractionTaskIds]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="border-b border-slate-200 px-6 pt-4 flex gap-4 shrink-0">
        <button
          onClick={() => setTab("catalog")}
          className={`pb-3 text-sm font-medium border-b-2 ${tab === "catalog" ? "border-emerald-500 text-slate-800" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          Tabela de preços
        </button>
        <button
          onClick={() => setTab("project")}
          className={`pb-3 text-sm font-medium border-b-2 ${tab === "project" ? "border-emerald-500 text-slate-800" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          Precificação de projeto
        </button>
        <button
          onClick={() => setTab("pending")}
          className={`pb-3 text-sm font-medium border-b-2 ${tab === "pending" ? "border-emerald-500 text-slate-800" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          Itens sem preço
        </button>
        <button
          onClick={() => setTab("extraction")}
          className={`pb-3 text-sm font-medium border-b-2 flex items-center gap-1.5 ${tab === "extraction" ? "border-emerald-500 text-slate-800" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          Extrações pendentes
          {extractionCount > 0 && (
            <span className="text-[10px] font-bold text-white bg-emerald-600 rounded-full px-1.5 py-0.5 leading-none">{extractionCount}</span>
          )}
        </button>
        <button
          onClick={() => setTab("tax")}
          className={`pb-3 text-sm font-medium border-b-2 ${tab === "tax" ? "border-emerald-500 text-slate-800" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          Motor fiscal
        </button>
      </div>
      {tab === "catalog" && <PricingCatalog onFilesProcessed={refreshExtractionCount} waitForTask={waitForTask} tasksById={tasksById} />}
      {tab === "project" && <PricingProjectSheet />}
      {tab === "pending" && <PricingPendingItems />}
      {tab === "extraction" && <PricingExtractionReview onCountChange={setExtractionCount} />}
      {tab === "tax" && <PricingTaxSettings />}
    </div>
  );
}
