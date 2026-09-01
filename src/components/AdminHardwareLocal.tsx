import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ApiClient from "../lib/api";
import { faixaDeUso, corDaFaixa, percentualDeUso } from "./faixaDeUso";
import { MedidorSegmentado } from "./MedidorSegmentado";
import { ListaDeServicosLocal, resumoDosServicos, type ServicoLocal } from "./statusDosServicos";

// Os quatro cartões de hardware LOCAL da Visão Geral — mesma pergunta que o CMSaaS responde de
// fora (CPU/memória/disco/serviços de uma instalação, em hardwareDaInstalacao.tsx), mas de
// dentro: sem heartbeat, sem rede, só o que `GET /api/admin/system/hardware` lê do próprio
// processo (server/utils/hardwareLocalHistory.ts, que reaproveita as MESMAS
// `collectSystemInfo()`/`coletarStatusDosServicos()` do heartbeat, para as leituras nunca
// divergirem).
//
// CPU e memória entram na MESMA escala (0–100%) de propósito: ao contrário do card do CMSaaS, que
// evita eixo compartilhado porque desenha os dois lado a lado (CPU em taxa, memória em MB, escalas
// incomparáveis), aqui cada métrica tem o próprio gráfico — comparar "quão carregada está a
// máquina" nos quatro cartões de relance é mais simples com CPU/memória em porcentagem do que com
// uma delas em megabytes.
interface PontoDeHardwareLocal {
  medido_em: string;
  cpu_load_percent: number | null;
  memory_used_mb: number | null;
  total_memory_mb: number | null;
  disk_used_mb: number | null;
  disk_total_mb: number | null;
  servicos: ServicoLocal[];
}

const INTERVALO_DE_ATUALIZACAO_MS = 15_000;

function Cartao({ titulo, valor, cor, children }: { titulo: string; valor: string; cor: string; children: React.ReactNode }) {
  return (
    <div className="col-span-12 sm:col-span-6 xl:col-span-3 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-slate-800 uppercase font-mono">{titulo}</h3>
        <span className="text-sm font-black font-mono tabular-nums" style={{ color: cor }}>{valor}</span>
      </div>
      <div style={{ height: 132 }}>{children}</div>
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
      <div className="col-span-12 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <p className="text-xs text-danger-700">{erro}</p>
      </div>
    );
  }

  const ultimo = pontos && pontos.length > 0 ? pontos[pontos.length - 1] : null;
  const pctCpu = ultimo ? ultimo.cpu_load_percent : null;
  const pctMemoria = ultimo ? percentualDeUso(ultimo.memory_used_mb, ultimo.total_memory_mb) : null;
  const servicos = ultimo ? ultimo.servicos : [];
  const resumoServicos = resumoDosServicos(servicos);

  const serieCpu = (pontos || []).map(p => ({ tempo: p.medido_em, valor: p.cpu_load_percent }));
  const serieMemoria = (pontos || []).map(p => ({ tempo: p.medido_em, valor: percentualDeUso(p.memory_used_mb, p.total_memory_mb) }));
  const historicoDeServicos = (pontos || []).map(p => ({ medido_em: p.medido_em, servicos: p.servicos }));

  const rotuloDoEixo = (v: string) => {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "" : HORA_MINUTO.format(d);
  };

  const carregando = (
    <p className="h-full flex items-center justify-center text-[10px] text-slate-400">
      {locale === "pt" ? "Carregando..." : "Loading..."}
    </p>
  );

  const corServicos: Record<ServicoLocal["status"], string> = {
    operational: "var(--color-success-600)",
    degraded: "var(--color-warning-600)",
    down: "var(--color-danger-600)",
    unknown: "var(--color-slate-400)",
  };

  return (
    <>
      <Cartao titulo="CPU" valor={pctCpu === null ? "—" : `${pctCpu}%`} cor={corDaFaixa(faixaDeUso(pctCpu))}>
        {!pontos ? (
          carregando
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

      <Cartao titulo={locale === "pt" ? "Memória" : "Memory"} valor={pctMemoria === null ? "—" : `${Math.round(pctMemoria)}%`} cor={corDaFaixa(faixaDeUso(pctMemoria))}>
        {!pontos ? (
          carregando
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={serieMemoria} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <XAxis dataKey="tempo" tickFormatter={rotuloDoEixo} tick={{ fontSize: 9 }} minTickGap={30} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} width={28} axisLine={false} tickLine={false} />
              <Tooltip
                isAnimationActive={false}
                formatter={(v: any) => [`${Math.round(v)}%`, locale === "pt" ? "Memória" : "Memory"]}
                labelFormatter={(v: any) => rotuloDoEixo(String(v))}
              />
              <Area type="monotone" dataKey="valor" stroke="var(--color-brand-700)" fill="var(--color-brand-300)" isAnimationActive={false} connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Cartao>

      <Cartao titulo={locale === "pt" ? "Disco" : "Disk"} valor={ultimo ? `${Math.round(percentualDeUso(ultimo.disk_used_mb, ultimo.disk_total_mb) ?? 0)}%` : "—"} cor={corDaFaixa(faixaDeUso(ultimo ? percentualDeUso(ultimo.disk_used_mb, ultimo.disk_total_mb) : null))}>
        {!pontos ? carregando : <MedidorSegmentado usado={ultimo?.disk_used_mb ?? null} total={ultimo?.disk_total_mb ?? null} locale={locale} />}
      </Cartao>

      <Cartao
        titulo={locale === "pt" ? "Serviços" : "Services"}
        valor={!pontos ? "—" : resumoServicos.texto}
        cor={!pontos ? "var(--color-slate-400)" : corServicos[resumoServicos.status]}
      >
        {!pontos ? carregando : <ListaDeServicosLocal servicos={servicos} historico={historicoDeServicos} locale={locale} />}
      </Cartao>
    </>
  );
}
