import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ApiClient from "../lib/api";

// Os três cartões de hardware LOCAL da Visão Geral — mesma pergunta que o CMSaaS responde de
// fora (CPU/memória/disco de uma instalação), mas de dentro: sem heartbeat, sem rede, só o que
// `GET /api/admin/system/hardware` lê do próprio processo (server/utils/hardwareLocalHistory.ts,
// que reaproveita a mesma `collectSystemInfo()` do heartbeat, para as duas leituras nunca
// divergirem).
//
// CPU e memória entram na MESMA escala (0–100%) de propósito: ao contrário do card do CMSaaS, que
// evita eixo compartilhado porque desenha os dois num layout lado a lado (CPU em taxa, memória em
// MB, escalas incomparáveis), aqui cada métrica tem o próprio gráfico — comparar "quão carregada
// está a máquina" nos três cartões de relance é mais simples com os três em porcentagem do que
// com um deles em megabytes.
interface PontoDeHardwareLocal {
  medido_em: string;
  cpu_load_percent: number | null;
  memory_used_mb: number | null;
  total_memory_mb: number | null;
  disk_used_mb: number | null;
  disk_total_mb: number | null;
}

const INTERVALO_DE_ATUALIZACAO_MS = 15_000;

function percentual(usado: number | null, total: number | null): number | null {
  if (usado === null || total === null || total <= 0) return null;
  return Math.min(100, Math.round((usado / total) * 100));
}

function corDaFaixa(pct: number | null): string {
  if (pct === null) return "var(--color-slate-400)";
  if (pct >= 90) return "var(--color-danger-600)";
  if (pct >= 70) return "var(--color-warning-600)";
  return "var(--color-brand-600)";
}

function Cartao({ titulo, valor, cor, children }: { titulo: string; valor: string; cor: string; children: React.ReactNode }) {
  return (
    <div className="col-span-12 sm:col-span-6 xl:col-span-3 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-slate-800 uppercase font-mono">{titulo}</h3>
        <span className="text-sm font-black font-mono tabular-nums" style={{ color: cor }}>{valor}</span>
      </div>
      <div style={{ height: 90 }}>{children}</div>
    </div>
  );
}

const HORA_MINUTO = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function AdminHardwareLocal({ locale }: { locale: "en" | "pt" }) {
  const [pontos, setPontos] = useState<PontoDeHardwareLocal[] | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;

    const carregar = () => {
      ApiClient.get<{ pontos: PontoDeHardwareLocal[] }>("/api/admin/system/hardware")
        .then(r => {
          if (vivo) setPontos(r.pontos);
        })
        .catch((e: any) => {
          if (vivo) setErro(e?.message || (locale === "pt" ? "Não foi possível carregar o hardware." : "Could not load hardware."));
        });
    };

    carregar();
    const id = setInterval(carregar, INTERVALO_DE_ATUALIZACAO_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [locale]);

  if (erro) {
    return (
      <div className="col-span-12 xl:col-span-9 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <p className="text-xs text-danger-700">{erro}</p>
      </div>
    );
  }

  const ultimo = pontos && pontos.length > 0 ? pontos[pontos.length - 1] : null;
  const pctCpu = ultimo ? ultimo.cpu_load_percent : null;
  const pctMemoria = ultimo ? percentual(ultimo.memory_used_mb, ultimo.total_memory_mb) : null;
  const pctDisco = ultimo ? percentual(ultimo.disk_used_mb, ultimo.disk_total_mb) : null;

  const serieCpu = (pontos || []).map(p => ({ tempo: p.medido_em, valor: p.cpu_load_percent }));
  const serieMemoria = (pontos || []).map(p => ({ tempo: p.medido_em, valor: percentual(p.memory_used_mb, p.total_memory_mb) }));

  const rotuloDoEixo = (v: string) => {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "" : HORA_MINUTO.format(d);
  };

  return (
    <>
      <Cartao titulo="CPU" valor={pctCpu === null ? "—" : `${pctCpu}%`} cor={corDaFaixa(pctCpu)}>
        {!pontos ? (
          <p className="h-full flex items-center justify-center text-[10px] text-slate-400">
            {locale === "pt" ? "Carregando..." : "Loading..."}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={serieCpu} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <XAxis dataKey="tempo" tickFormatter={rotuloDoEixo} tick={{ fontSize: 9 }} minTickGap={30} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} width={28} axisLine={false} tickLine={false} />
              <Tooltip
                isAnimationActive={false}
                formatter={(v: any) => [`${v}%`, "CPU"]}
                labelFormatter={(v: any) => rotuloDoEixo(String(v))}
              />
              <Area type="monotone" dataKey="valor" stroke="var(--color-brand-600)" fill="var(--color-brand-200)" isAnimationActive={false} connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Cartao>

      <Cartao titulo={locale === "pt" ? "Memória" : "Memory"} valor={pctMemoria === null ? "—" : `${pctMemoria}%`} cor={corDaFaixa(pctMemoria)}>
        {!pontos ? (
          <p className="h-full flex items-center justify-center text-[10px] text-slate-400">
            {locale === "pt" ? "Carregando..." : "Loading..."}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={serieMemoria} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <XAxis dataKey="tempo" tickFormatter={rotuloDoEixo} tick={{ fontSize: 9 }} minTickGap={30} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} width={28} axisLine={false} tickLine={false} />
              <Tooltip
                isAnimationActive={false}
                formatter={(v: any) => [`${v}%`, locale === "pt" ? "Memória" : "Memory"]}
                labelFormatter={(v: any) => rotuloDoEixo(String(v))}
              />
              <Area type="monotone" dataKey="valor" stroke="var(--color-brand-700)" fill="var(--color-brand-300)" isAnimationActive={false} connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Cartao>

      <Cartao titulo={locale === "pt" ? "Disco" : "Disk"} valor={pctDisco === null ? "—" : `${pctDisco}%`} cor={corDaFaixa(pctDisco)}>
        <div className="h-full flex flex-col justify-center gap-2">
          <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pctDisco ?? 0}%`, backgroundColor: corDaFaixa(pctDisco) }}
            />
          </div>
          <p className="text-[10px] text-slate-400 font-mono">
            {ultimo?.disk_used_mb != null && ultimo?.disk_total_mb != null
              ? `${(ultimo.disk_used_mb / 1024).toFixed(1)} GB / ${(ultimo.disk_total_mb / 1024).toFixed(1)} GB`
              : locale === "pt" ? "Sem leitura de disco." : "No disk reading."}
          </p>
        </div>
      </Cartao>
    </>
  );
}
