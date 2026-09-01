import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ApiClient from "../lib/api";
import { faixaDeUso, corDaFaixa, percentualDeUso } from "./faixaDeUso";
import { MedidorSegmentado } from "./MedidorSegmentado";
import { ListaDeServicosLocal, resumoDosServicos, type ServicoLocal } from "./statusDosServicos";

// O popup de histórico dos 4 cartões de hardware — abre ao clicar em qualquer um deles. Mesma
// rota (`GET /api/admin/system/hardware`) que os cartões compactos, só que com `from`/`to`/
// `granularity` explícitos: os dois nunca podem contar uma história diferente do mesmo período.
interface PontoDeHardwareLocal {
  medido_em: string;
  cpu_load_percent: number | null;
  memory_used_mb: number | null;
  total_memory_mb: number | null;
  disk_used_mb: number | null;
  disk_total_mb: number | null;
  servicos: ServicoLocal[];
}

export type MetricaDeHardware = "cpu" | "memoria" | "disco" | "servicos";
type Granularidade = "minute" | "hour" | "day";

const TITULO: Record<MetricaDeHardware, { pt: string; en: string }> = {
  cpu: { pt: "CPU", en: "CPU" },
  memoria: { pt: "Memória", en: "Memory" },
  disco: { pt: "Disco", en: "Disk" },
  servicos: { pt: "Serviços", en: "Services" },
};

const UM_DIA_MS = 24 * 60 * 60 * 1000;

function inicioDoDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

interface Atalho {
  chave: string;
  rotuloPt: string;
  rotuloEn: string;
  granularidade: Granularidade;
  from: () => Date;
}

const ATALHOS: Atalho[] = [
  { chave: "12h", rotuloPt: "Últimas 12h", rotuloEn: "Last 12h", granularidade: "minute", from: () => new Date(Date.now() - 12 * 60 * 60 * 1000) },
  { chave: "7d", rotuloPt: "7 dias", rotuloEn: "7 days", granularidade: "hour", from: () => new Date(Date.now() - 7 * UM_DIA_MS) },
  { chave: "30d", rotuloPt: "30 dias", rotuloEn: "30 days", granularidade: "hour", from: () => new Date(Date.now() - 30 * UM_DIA_MS) },
  { chave: "mes", rotuloPt: "Este mês", rotuloEn: "This month", granularidade: "day", from: () => new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
  { chave: "ano", rotuloPt: "Este ano", rotuloEn: "This year", granularidade: "day", from: () => new Date(new Date().getFullYear(), 0, 1) },
];

function paraInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Granularidades que fazem sentido pro período escolhido - pedir "minuto" num ano inteiro
 * devolveria (ou truncaria em) um teto de pontos ilegível. */
function granularidadesPermitidas(from: Date, to: Date): Granularidade[] {
  const dias = (to.getTime() - from.getTime()) / UM_DIA_MS;
  if (dias <= 2) return ["minute", "hour", "day"];
  if (dias <= 60) return ["hour", "day"];
  return ["day"];
}

const HORA_MINUTO = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const DIA_MES = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const DIA_MES_HORA = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const TOOLTIP_CONTENT_STYLE: React.CSSProperties = {
  fontSize: 11, lineHeight: 1.4, background: "#fff", border: "1px solid var(--color-slate-200)",
  borderRadius: 8, padding: "6px 8px", boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
};
const TOOLTIP_LABEL_STYLE: React.CSSProperties = {
  fontFamily: "ui-monospace, monospace", fontSize: 9, textTransform: "uppercase",
  letterSpacing: "0.05em", color: "var(--color-slate-400)", marginBottom: 2,
};
const TOOLTIP_ITEM_STYLE: React.CSSProperties = {
  fontFamily: "ui-monospace, monospace", fontSize: 12, fontWeight: 700, color: "var(--color-slate-800)", padding: 0,
};

export function HardwareHistoryModal({ metrica, locale, aoFechar }: { metrica: MetricaDeHardware; locale: "en" | "pt"; aoFechar: () => void }) {
  const [atalho, setAtalho] = useState<string>("12h");
  const [fromCustom, setFromCustom] = useState<string>("");
  const [toCustom, setToCustom] = useState<string>("");
  const [granularidade, setGranularidade] = useState<Granularidade>("minute");
  const [pontos, setPontos] = useState<PontoDeHardwareLocal[] | null>(null);
  const [erro, setErro] = useState("");

  const { from, to } = useMemo(() => {
    if (fromCustom && toCustom) {
      return { from: inicioDoDia(new Date(fromCustom)), to: new Date(new Date(toCustom).getTime() + UM_DIA_MS) };
    }
    const preset = ATALHOS.find(a => a.chave === atalho) ?? ATALHOS[0];
    return { from: preset.from(), to: new Date() };
  }, [atalho, fromCustom, toCustom]);

  const permitidas = useMemo(() => granularidadesPermitidas(from, to), [from, to]);

  useEffect(() => {
    if (!permitidas.includes(granularidade)) {
      setGranularidade(permitidas[permitidas.length - 1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permitidas.join(",")]);

  useEffect(() => {
    let vivo = true;
    setPontos(null);
    ApiClient.get<{ pontos: PontoDeHardwareLocal[] }>(
      `/api/admin/system/hardware?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&granularity=${granularidade}`
    )
      .then(r => { if (vivo) setPontos(r.pontos); })
      .catch((e: any) => { if (vivo) setErro(e?.message || (locale === "pt" ? "Não foi possível carregar o histórico." : "Could not load history.")); });
    return () => { vivo = false; };
  }, [from, to, granularidade, locale]);

  const escolherAtalho = (chave: string) => {
    setAtalho(chave);
    setFromCustom("");
    setToCustom("");
  };

  const rotuloDoEixo = (v: string) => {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "";
    return granularidade === "day" ? DIA_MES.format(d) : granularidade === "hour" ? DIA_MES_HORA.format(d) : HORA_MINUTO.format(d);
  };

  const serieCpu = (pontos || []).map(p => ({ tempo: p.medido_em, valor: p.cpu_load_percent }));
  const serieMemoria = (pontos || []).map(p => ({ tempo: p.medido_em, valor: percentualDeUso(p.memory_used_mb, p.total_memory_mb) }));
  const serieDisco = (pontos || []).map(p => ({ tempo: p.medido_em, valor: percentualDeUso(p.disk_used_mb, p.disk_total_mb) }));
  const ultimo = pontos && pontos.length > 0 ? pontos[pontos.length - 1] : null;
  const historicoDeServicos = (pontos || []).map(p => ({ medido_em: p.medido_em, servicos: p.servicos }));
  const resumoServicos = ultimo ? resumoDosServicos(ultimo.servicos) : { status: "unknown" as const, texto: "—" };

  const rotuloDaGranularidade: Record<Granularidade, { pt: string; en: string }> = {
    minute: { pt: "Por minuto", en: "By minute" },
    hour: { pt: "Por hora", en: "By hour" },
    day: { pt: "Por dia", en: "By day" },
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4" onClick={aoFechar}>
      <div className="bg-white rounded-xl border border-slate-200 w-full max-w-4xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-950 text-white p-4 flex justify-between items-center">
          <h3 className="text-sm font-bold uppercase font-mono tracking-wider">
            {locale === "pt" ? TITULO[metrica].pt : TITULO[metrica].en}
          </h3>
          <button onClick={aoFechar} className="text-slate-400 hover:text-white cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              {ATALHOS.map(a => (
                <button
                  key={a.chave}
                  onClick={() => escolherAtalho(a.chave)}
                  className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg border ${
                    atalho === a.chave && !fromCustom
                      ? "bg-brand-600 text-white border-brand-600"
                      : "bg-slate-50 text-slate-600 border-slate-200 hover:border-brand-300"
                  }`}
                >
                  {locale === "pt" ? a.rotuloPt : a.rotuloEn}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 ml-auto">
              <input
                type="date"
                value={fromCustom}
                max={paraInputDate(new Date())}
                onChange={e => setFromCustom(e.target.value)}
                className="text-[11px] p-1.5 rounded border border-slate-200"
              />
              <span className="text-[11px] text-slate-400">{locale === "pt" ? "até" : "to"}</span>
              <input
                type="date"
                value={toCustom}
                max={paraInputDate(new Date())}
                onChange={e => setToCustom(e.target.value)}
                className="text-[11px] p-1.5 rounded border border-slate-200"
              />
            </div>

            <select
              value={granularidade}
              onChange={e => setGranularidade(e.target.value as Granularidade)}
              className="text-[11px] font-bold p-1.5 rounded border border-slate-200 bg-white"
            >
              {permitidas.map(g => (
                <option key={g} value={g}>{locale === "pt" ? rotuloDaGranularidade[g].pt : rotuloDaGranularidade[g].en}</option>
              ))}
            </select>
          </div>

          {erro ? (
            <p className="text-xs text-danger-700">{erro}</p>
          ) : !pontos ? (
            <div className="h-72 flex items-center justify-center text-xs text-slate-400">
              {locale === "pt" ? "Carregando..." : "Loading..."}
            </div>
          ) : pontos.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-xs text-slate-400">
              {locale === "pt" ? "Nenhuma leitura neste período." : "No reading in this period."}
            </div>
          ) : metrica === "cpu" ? (
            <div style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={serieCpu} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <XAxis dataKey="tempo" tickFormatter={rotuloDoEixo} tick={{ fontSize: 10 }} minTickGap={40} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={32} axisLine={false} tickLine={false} />
                  <Tooltip isAnimationActive={false} contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(v: any) => [`${Math.round(v)}%`, "CPU"]} labelFormatter={(v: any) => rotuloDoEixo(String(v))} />
                  <Area type="monotone" dataKey="valor" stroke="var(--color-brand-600)" fill="var(--color-brand-200)" isAnimationActive={false} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : metrica === "memoria" ? (
            <div style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={serieMemoria} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <XAxis dataKey="tempo" tickFormatter={rotuloDoEixo} tick={{ fontSize: 10 }} minTickGap={40} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={32} axisLine={false} tickLine={false} />
                  <Tooltip isAnimationActive={false} contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(v: any) => [`${Math.round(v)}%`, locale === "pt" ? "Memória" : "Memory"]} labelFormatter={(v: any) => rotuloDoEixo(String(v))} />
                  <Area type="monotone" dataKey="valor" stroke="var(--color-brand-700)" fill="var(--color-brand-300)" isAnimationActive={false} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : metrica === "disco" ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2" style={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={serieDisco} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                    <XAxis dataKey="tempo" tickFormatter={rotuloDoEixo} tick={{ fontSize: 10 }} minTickGap={40} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={32} axisLine={false} tickLine={false} />
                    <Tooltip isAnimationActive={false} contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                      formatter={(v: any) => [`${Math.round(v)}%`, locale === "pt" ? "Disco" : "Disk"]} labelFormatter={(v: any) => rotuloDoEixo(String(v))} />
                    <Area type="monotone" dataKey="valor" stroke="var(--color-brand-800)" fill="var(--color-brand-400)" isAnimationActive={false} connectNulls />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col justify-center">
                <p className="text-[10px] uppercase font-mono text-slate-400 mb-2">
                  {locale === "pt" ? "Agora" : "Now"}
                </p>
                <div style={{ height: 90 }}>
                  <MedidorSegmentado usado={ultimo?.disk_used_mb ?? null} total={ultimo?.disk_total_mb ?? null} locale={locale} />
                </div>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-[10px] uppercase font-mono text-slate-400 mb-2">
                {resumoServicos.texto} {locale === "pt" ? "no ar (última leitura do período)" : "up (last reading in period)"}
              </p>
              <ListaDeServicosLocal servicos={ultimo?.servicos ?? []} historico={historicoDeServicos} locale={locale} tracos={90} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
