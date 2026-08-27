import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BellOff, CheckCircle2, Clock, RefreshCw, Save, Users } from "lucide-react";
import ApiClient from "../lib/api";
import { DemandPerformance, DemandSlaAlert, DemandSlaSettings } from "../types";

// CDC 16 — Fase 5. Prazos e desempenho, do lado de quem responde por eles.
//
// Três coisas numa tela só, e a ordem é a decisão de desenho:
//
// 1. **o que venceu**, primeiro, porque é a única parte acionável — um alerta
//    embaixo de um formulário de configuração é um alerta que ninguém vê;
// 2. **a configuração** (D19), que é do administrador da instalação e por isso
//    aparece só para quem tem `admin:settings`;
// 3. **o desempenho por pessoa** (D20), que existe SÓ deste lado. O CRM vê o
//    tempo da demanda dele e a média da equipe, e nunca este recorte — a
//    fronteira é decisão do dono, e violá-la é pior do que não medir.

const POLITICAS: Array<{ chave: DemandSlaSettings["assignment_policy"]; rotulo: string; explica: string }> = [
  {
    chave: "auto_servico",
    rotulo: "Auto-serviço",
    explica: "Qualquer pessoa da equipe assume qualquer demanda da fila. É o padrão, e o que esta instalação sempre fez.",
  },
  {
    chave: "direcionamento",
    rotulo: "Direcionamento pelo gerente",
    explica: "Só o gerente de pré-vendas aponta quem trabalha em cada demanda. O botão de assumir some para o resto da equipe.",
  },
  {
    chave: "automatico",
    rotulo: "Automático, por menor carga",
    explica:
      "A demanda é distribuída quando chega, para quem tem menos trabalho urgente: cada demanda aberta pesa 3 se o prazo vence em até 3 dias, 2 em até 7, 1 no resto. Empate vai para quem assumiu há mais tempo. O valor não entra, e o porte também não. Sem ninguém elegível, a demanda fica na fila e o auto-serviço continua valendo.",
  },
];

function duracao(segundos: number | null): string {
  if (segundos === null) return "—";
  const s = Math.max(0, segundos);
  const dias = Math.floor(s / 86400);
  const horas = Math.floor((s % 86400) / 3600);
  const minutos = Math.floor((s % 3600) / 60);
  if (dias > 0) return horas > 0 ? `${dias}d ${horas}h` : `${dias}d`;
  if (horas > 0) return minutos > 0 ? `${horas}h ${minutos}min` : `${horas}h`;
  return `${minutos}min`;
}

function quandoVenceu(iso: string): string {
  const atraso = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return atraso >= 0 ? `venceu há ${duracao(atraso)}` : `vence em ${duracao(-atraso)}`;
}

function dataHora(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

interface Props {
  hasPermission: (permission: string) => boolean;
  onChanged?: () => void;
}

export default function DemandSlaPanel({ hasPermission, onChanged }: Props) {
  const podeConfigurar = hasPermission("admin:settings");

  const [config, setConfig] = useState<DemandSlaSettings | null>(null);
  const [rascunho, setRascunho] = useState<DemandSlaSettings | null>(null);
  const [alertas, setAlertas] = useState<DemandSlaAlert[]>([]);
  const [desempenho, setDesempenho] = useState<DemandPerformance | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      const [c, a, d] = await Promise.all([
        ApiClient.get<DemandSlaSettings>("/api/demands/sla-settings"),
        ApiClient.get<DemandSlaAlert[]>("/api/demands/alerts"),
        ApiClient.get<DemandPerformance>("/api/demands/performance"),
      ]);
      setConfig(c);
      setRascunho(c);
      setAlertas(Array.isArray(a) ? a : []);
      setDesempenho(d);
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar prazos e desempenho.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const salvar = async () => {
    if (!rascunho) return;
    setSalvando(true);
    setErro("");
    setAviso("");
    try {
      const salvo = await ApiClient.put<DemandSlaSettings>("/api/demands/sla-settings", {
        enabled: rascunho.enabled,
        assume_hours: rascunho.assume_hours,
        analysis_hours: rascunho.analysis_hours,
        proposal_hours: rascunho.proposal_hours,
        assignment_policy: rascunho.assignment_policy,
      });
      setConfig(salvo);
      setRascunho(salvo);
      setAviso("Configuração salva.");
      onChanged?.();
    } catch (e: any) {
      setErro(e.message || "Não foi possível salvar a configuração.");
    } finally {
      setSalvando(false);
    }
  };

  const verificarAgora = async () => {
    setSalvando(true);
    setErro("");
    setAviso("");
    try {
      const r = await ApiClient.post<{ demandasAbertas: number; vencidas: number; novas: number }>("/api/demands/sla/scan", {});
      setAviso(`${r.demandasAbertas} demanda(s) aberta(s), ${r.vencidas} com prazo vencido, ${r.novas} alerta(s) novo(s).`);
      await carregar();
      onChanged?.();
    } catch (e: any) {
      setErro(e.message || "Não foi possível verificar os prazos agora.");
    } finally {
      setSalvando(false);
    }
  };

  const darPorVisto = async (id: string) => {
    try {
      await ApiClient.post(`/api/demands/alerts/${id}/ack`, {});
      await carregar();
      onChanged?.();
    } catch (e: any) {
      setErro(e.message || "Não foi possível dar o alerta por visto.");
    }
  };

  const semGerente = (config?.managers.length ?? 0) === 0;

  return (
    <div className="space-y-4" data-testid="demand-sla-panel">
      {erro && <div className="bg-danger-50 border border-danger-200 text-danger-700 text-xs rounded-lg p-3">{erro}</div>}
      {aviso && <div className="bg-brand-50 border border-brand-200 text-brand-700 text-xs rounded-lg p-3">{aviso}</div>}

      {/* 1. O que venceu. Primeiro porque é a única parte acionável. */}
      <section className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <header className="flex items-center justify-between gap-3 p-4 border-b border-slate-200">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-danger-600" /> Prazos vencidos ({alertas.length})
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {semGerente
                ? "Sem gerente de pré-vendas nomeado, o alerta vai para toda a equipe."
                : `O alerta vai para ${config?.managers.map((m) => m.name).join(", ")}.`}
            </p>
          </div>
          {podeConfigurar && (
            <button
              onClick={() => void verificarAgora()}
              disabled={salvando}
              data-testid="sla-verificar-agora"
              className="inline-flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-600 text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer"
            >
              <RefreshCw size={13} className={salvando ? "animate-spin" : ""} /> Verificar agora
            </button>
          )}
        </header>
        <div className="p-4">
          {alertas.length === 0 ? (
            <div className="text-center py-6 text-slate-400">
              <CheckCircle2 size={24} className="mx-auto mb-2 opacity-40" />
              <div className="text-xs font-semibold text-slate-500">Nenhum prazo vencido em aberto</div>
              <div className="text-[11px] mt-1">
                {config?.enabled
                  ? "A fila está dentro do prazo configurado."
                  : "O SLA está desligado nesta instalação: nada é cobrado e nada é alertado."}
              </div>
            </div>
          ) : (
            <ul className="space-y-2" data-testid="sla-lista-alertas">
              {alertas.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 border border-danger-200 bg-danger-50/40 rounded-lg p-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-800 truncate">{a.title}</div>
                    <div className="text-[11px] text-slate-500 font-mono">{a.demand_ref}</div>
                    <div className="text-[11px] text-danger-700 font-semibold mt-1">
                      Prazo para {a.stage_label} · {quandoVenceu(a.due_at)}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {a.company_name}
                      {a.assigned_to ? ` · com ${a.assigned_to}` : " · sem dono"}
                      {" · avisou "}
                      {a.recipient_kind === "manager" ? "o gerente" : "a equipe"}
                    </div>
                  </div>
                  <button
                    onClick={() => void darPorVisto(a.id)}
                    className="shrink-0 inline-flex items-center gap-1 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[11px] px-2.5 py-1 rounded-md font-semibold cursor-pointer"
                  >
                    <BellOff size={12} /> Dar por visto
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 2. A configuração da instalação (D19). */}
      {podeConfigurar && rascunho && (
        <section className="bg-white border border-slate-200 rounded-lg shadow-sm" data-testid="sla-configuracao">
          <header className="p-4 border-b border-slate-200">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <Clock size={14} className="text-slate-500" /> Prazo por etapa e política de atribuição
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {config?.configured
                ? "Vale para todas as demandas desta instalação."
                : "Ninguém configurou prazo nesta instalação ainda: as demandas não têm prazo e nada é alertado."}
            </p>
          </header>
          <div className="p-4 space-y-4">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={rascunho.enabled}
                data-testid="sla-enabled"
                onChange={(e) => setRascunho({ ...rascunho, enabled: e.target.checked })}
                className="mt-0.5 cursor-pointer"
              />
              <span>
                <span className="text-xs font-semibold text-slate-700">Cobrar prazo por etapa</span>
                <span className="block text-[11px] text-slate-500">
                  Desligado, nenhuma demanda ganha prazo e nenhum alerta é disparado — e o CRM deixa de receber o prazo junto dos marcos.
                </span>
              </span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(
                [
                  ["assume_hours", "Para assumir", "Contado do envio da demanda para a fila."],
                  ["analysis_hours", "Para iniciar a análise", "Contado do momento em que alguém assumiu."],
                  ["proposal_hours", "Para entregar a proposta", "Contado do início da análise, e nunca depois do fim do prazo do edital."],
                ] as const
              ).map(([campo, rotulo, ajuda]) => (
                <div key={campo}>
                  <label className="block text-[10px] uppercase font-mono text-slate-400 mb-1" htmlFor={`sla-${campo}`}>
                    {rotulo}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id={`sla-${campo}`}
                      data-testid={`sla-${campo}`}
                      type="number"
                      min={1}
                      max={8760}
                      value={rascunho[campo]}
                      disabled={!rascunho.enabled}
                      onChange={(e) => setRascunho({ ...rascunho, [campo]: Number(e.target.value) })}
                      className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-xs disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                    />
                    <span className="text-[11px] text-slate-500">horas</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">{ajuda}</p>
                </div>
              ))}
            </div>

            <div>
              <div className="text-[10px] uppercase font-mono text-slate-400 mb-1.5">Quem trabalha em cada demanda</div>
              <div className="space-y-2">
                {POLITICAS.map((p) => (
                  <label
                    key={p.chave}
                    className={`flex items-start gap-2 border rounded-lg p-3 cursor-pointer transition-all ${
                      rascunho.assignment_policy === p.chave ? "border-brand-300 bg-brand-50/50" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="assignment-policy"
                      data-testid={`sla-policy-${p.chave}`}
                      checked={rascunho.assignment_policy === p.chave}
                      onChange={() => setRascunho({ ...rascunho, assignment_policy: p.chave })}
                      className="mt-0.5 cursor-pointer"
                    />
                    <span>
                      <span className="text-xs font-semibold text-slate-700">{p.rotulo}</span>
                      <span className="block text-[11px] text-slate-500">{p.explica}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-start gap-2 border border-slate-200 bg-slate-50 rounded-lg p-3">
              <Users size={14} className="text-slate-400 mt-0.5 shrink-0" />
              <div className="text-[11px] text-slate-600">
                <span className="font-semibold text-slate-700">Gerente de pré-vendas: </span>
                {semGerente ? (
                  <>
                    ninguém. Enquanto não houver, a devolução é direta e o alerta de prazo vai para toda a equipe. Para nomear um, dê a
                    permissão <code className="font-mono bg-white border border-slate-200 rounded px-1">{config?.manager_permission}</code> a um
                    papel em Administração → Usuários e papéis.
                  </>
                ) : (
                  <>
                    {config?.managers.map((m) => m.name).join(", ")}. A devolução de quem não é gerente passa a precisar da aprovação dele
                    (D17), e é ele quem recebe o alerta de prazo vencido.
                  </>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => void salvar()}
                disabled={salvando}
                data-testid="sla-salvar"
                className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer"
              >
                <Save size={13} /> Salvar
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 3. O desempenho por pessoa (D20) — só aqui, nunca no CRM. */}
      <section className="bg-white border border-slate-200 rounded-lg shadow-sm" data-testid="sla-desempenho">
        <header className="p-4 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-800">Tempo de resposta</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Últimos {desempenho?.days ?? 180} dias. O recorte por pessoa existe só aqui: o CRM vê o tempo da demanda dele e a média da
            equipe, e nunca o desempenho de quem trabalha nesta fila.
          </p>
        </header>
        <div className="p-4 space-y-4">
          {desempenho && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(
                [
                  ["Até assumir", desempenho.team.mediaAteAssumirSegundos, desempenho.team.amostraAteAssumir],
                  ["Até a análise", desempenho.team.mediaAteAnaliseSegundos, desempenho.team.amostraAteAnalise],
                  ["Até concluir", desempenho.team.mediaAteConcluirSegundos, desempenho.team.amostraAteConcluir],
                ] as const
              ).map(([rotulo, valor, amostra]) => (
                <div key={rotulo} className="border border-slate-200 rounded-lg p-3">
                  <div className="text-[10px] uppercase font-mono text-slate-400">{rotulo}</div>
                  <div className="text-sm font-bold text-slate-800 mt-0.5">{duracao(valor)}</div>
                  {/* A amostra fica ao lado do número de propósito: "12 h" sobre
                      uma demanda só não é uma média, e sem o denominador
                      ninguém consegue saber disso. */}
                  <div className="text-[10px] text-slate-400">{amostra} demanda(s)</div>
                </div>
              ))}
              <div className="border border-slate-200 rounded-lg p-3">
                <div className="text-[10px] uppercase font-mono text-slate-400">Devolvidas</div>
                <div className="text-sm font-bold text-slate-800 mt-0.5">{desempenho.team.devolvidas}</div>
                <div className="text-[10px] text-slate-400">de {desempenho.team.total} recebida(s)</div>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs border-collapse">
              <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="p-2.5">Pessoa</th>
                  <th className="p-2.5 text-right">Demandas</th>
                  <th className="p-2.5 text-right">Até assumir</th>
                  <th className="p-2.5 text-right">Até a análise</th>
                  <th className="p-2.5 text-right">Até concluir</th>
                  <th className="p-2.5 text-right">Devolvidas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(desempenho?.people ?? []).map((p) => (
                  <tr key={p.user_id}>
                    <td className="p-2.5 text-slate-700 font-semibold">{p.name}</td>
                    <td className="p-2.5 text-right text-slate-600">{p.total}</td>
                    <td className="p-2.5 text-right font-mono text-slate-700">{duracao(p.mediaAteAssumirSegundos)}</td>
                    <td className="p-2.5 text-right font-mono text-slate-700">{duracao(p.mediaAteAnaliseSegundos)}</td>
                    <td className="p-2.5 text-right font-mono text-slate-700">{duracao(p.mediaAteConcluirSegundos)}</td>
                    <td className="p-2.5 text-right text-slate-600">{p.devolvidas}</td>
                  </tr>
                ))}
                {!carregando && (desempenho?.people.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400 text-[11px]">
                      Nenhuma demanda assumida na janela. A medição aparece quando alguém assume.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {desempenho && (
            <p className="text-[10px] text-slate-400">Desde {dataHora(desempenho.since)}.</p>
          )}
        </div>
      </section>
    </div>
  );
}
