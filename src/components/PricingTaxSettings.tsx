import { useEffect, useState } from "react";
import { Loader2, TriangleAlert, CheckCircle2 } from "lucide-react";
import ApiClient from "../lib/api";

interface TaxProfile {
  originUF: string;
  taxRegime: "simples_nacional" | "lucro_presumido" | "lucro_real";
}

const REGIME_LABEL: Record<TaxProfile["taxRegime"], string> = {
  simples_nacional: "Simples Nacional",
  lucro_presumido: "Lucro Presumido",
  lucro_real: "Lucro Real",
};

export default function PricingTaxSettings() {
  const [enabled, setEnabled] = useState(false);
  const [originUF, setOriginUF] = useState("");
  const [taxRegime, setTaxRegime] = useState<TaxProfile["taxRegime"]>("lucro_presumido");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    ApiClient.get<{ success: boolean; taxCalculationEnabled: boolean; taxProfile: TaxProfile | null }>("/api/pricing/settings")
      .then((res) => {
        setEnabled(res.taxCalculationEnabled);
        if (res.taxProfile) {
          setOriginUF(res.taxProfile.originUF);
          setTaxRegime(res.taxProfile.taxRegime);
        }
      })
      .catch((e: any) => setError(e.message || "Não foi possível carregar as configurações."))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      if (enabled && (!originUF || originUF.length !== 2)) {
        setError("Informe uma UF de origem válida (2 letras) para ligar o motor fiscal.");
        setSaving(false);
        return;
      }
      await ApiClient.put("/api/pricing/settings", {
        taxCalculationEnabled: enabled,
        originUF: originUF || undefined,
        taxRegime,
      });
      setSaved(true);
    } catch (e: any) {
      setError(e.message || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-slate-400">Carregando...</div>;
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">Motor fiscal</h2>
      <p className="text-sm text-slate-500 mb-6">
        Opcional e desligado por padrão — muitos tenants já calculam imposto direto no ERP. Quando ligado, calcula ICMS interestadual, PIS/COFINS por regime, ISS (itens de serviço) e IPI (se informado por item). Substituição tributária (ST) não é calculada — apenas sinalizada para revisão manual, já que depende de bases fiscais pagas mantidas por terceiros.
      </p>

      <label className="flex items-center gap-3 mb-5 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4" />
        <span className="text-sm font-medium text-slate-700">Ativar cálculo de impostos</span>
      </label>

      {enabled && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">UF de origem (onde a empresa está)</label>
            <input
              type="text"
              maxLength={2}
              value={originUF}
              onChange={(e) => setOriginUF(e.target.value.toUpperCase())}
              placeholder="SP"
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 uppercase"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Regime tributário</label>
            <select
              value={taxRegime}
              onChange={(e) => setTaxRegime(e.target.value as TaxProfile["taxRegime"])}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            >
              {(Object.keys(REGIME_LABEL) as TaxProfile["taxRegime"][]).map((r) => (
                <option key={r} value={r}>
                  {REGIME_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}
      {saved && (
        <div className="mb-4 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <CheckCircle2 size={15} />
          Configurações salvas.
        </div>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-emerald-600 rounded-lg px-3 py-2 hover:bg-emerald-700 disabled:opacity-60"
      >
        {saving ? <Loader2 size={15} className="animate-spin" /> : null}
        Salvar
      </button>
    </div>
  );
}
