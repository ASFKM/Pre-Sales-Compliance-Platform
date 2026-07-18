import { useState } from "react";
import PricingCatalog from "./PricingCatalog";
import PricingProjectSheet from "./PricingProjectSheet";
import PricingPendingItems from "./PricingPendingItems";
import PricingTaxSettings from "./PricingTaxSettings";

export default function PricingModule() {
  const [tab, setTab] = useState<"catalog" | "project" | "pending" | "tax">("catalog");

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
          onClick={() => setTab("tax")}
          className={`pb-3 text-sm font-medium border-b-2 ${tab === "tax" ? "border-emerald-500 text-slate-800" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          Motor fiscal
        </button>
      </div>
      {tab === "catalog" && <PricingCatalog />}
      {tab === "project" && <PricingProjectSheet />}
      {tab === "pending" && <PricingPendingItems />}
      {tab === "tax" && <PricingTaxSettings />}
    </div>
  );
}
