import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Ban, Check, Clock, FileText, Inbox, RefreshCw, Send, TrendingDown, Undo2, UserPlus, X } from "lucide-react";
import ApiClient from "../lib/api";
import DemandSlaPanel from "./DemandSlaPanel";
import DemandPurgePanel from "./DemandPurgePanel";
import { Demand, DemandSlaSettings } from "../types";

// CDC 16 — Fase 1. A fila de pré-vendas, do lado de quem trabalha nela.
//
// D15: fila ÚNICA, visível para toda a equipe - não há "minhas demandas" aqui,
// e é de propósito: quem não enxerga o trabalho disponível não se oferece para
// fazê-lo. O filtro por estado existe para separar o que espera do que já anda,
// não para recortar por pessoa.
//
// CDC 16 — Fase 5 acrescentou: a coluna de PRAZO do SLA ao lado da do edital
// (são dois prazos diferentes e a tela não pode confundi-los), o
// direcionamento pelo gerente (D16), a aprovação da devolução (D17) e a segunda
// vista, "Prazos e desempenho", em `DemandSlaPanel`.

const STATUS_LABEL: Record<string, string> = {
  queued: "Na fila",
  assigned: "Assumida",
  in_analysis: "Em análise",
  returned: "Devolvida",
  cancelled: "Cancelada",
  completed: "Concluída",
};

const STATUS_COLOR: Record<string, string> = {
  queued: "bg-brand-50 text-brand-700",
  assigned: "bg-warning-50 text-warning-700",
  in_analysis: "bg-warning-50 text-warning-700",
  returned: "bg-danger-50 text-danger-700",
  cancelled: "bg-slate-100 text-slate-600",
  completed: "bg-success-50 text-success-700",
};

const FILTROS: Array<{ chave: string; rotulo: string }> = [
  { chave: "queued,assigned,in_analysis,returned", rotulo: "Em aberto" },
  { chave: "queued", rotulo: "Na fila" },
  { chave: "assigned,in_analysis", rotulo: "Em andamento" },
  { chave: "returned", rotulo: "Devolvidas" },
  { chave: "queued,assigned,in_analysis,returned,cancelled,completed", rotulo: "Tudo" },
];

function dataCurta(valor?: string | null): string {
  if (!valor) return "—";
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

function moeda(valor?: number | null, currency?: string): string {
  if (valor === null || valor === undefined) return "—";
  try {
    return valor.toLocaleString("pt-BR", { style: "currency", currency: currency || "BRL", maximumFractionDigits: 0 });
  } catch {
    return String(valor);
  }
}

// Quantos dias faltam para o prazo do edital. O sinal é o que decide a cor: uma
// fila de auto-serviço sem urgência visível vira ordem de chegada disfarçada.
function diasAtePrazo(prazo?: string | null): number | null {
  if (!prazo) return null;
  const d = new Date(prazo);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

// O prazo do SLA e o prazo do edital são coisas diferentes, e a tela mostra os
// dois lado a lado justamente por isso: um é a promessa desta equipe (D19), o
// outro é a data em que a licitação fecha. Confundi-los faria a fila cobrar a
// coisa errada.
function estadoDoPrazo(dueAt?: string | null): { texto: string; classe: string; vencido: boolean } | null {
  if (!dueAt) return null;
  const restante = new Date(dueAt).getTime() - Date.now();
  if (Number.isNaN(restante)) return null;
  const vencido = restante < 0;
  const s = Math.abs(Math.round(restante / 1000));
  const dias = Math.floor(s / 86400);
  const horas = Math.floor((s % 86400) / 3600);
  const minutos = Math.floor((s % 3600) / 60);
  const dur = dias > 0 ? `${dias}d ${horas}h` : horas > 0 ? `${horas}h ${minutos}min` : `${minutos}min`;
  return {
    texto: vencido ? `vencido há ${dur}` : `faltam ${dur}`,
    classe: vencido ? "text-danger-600" : restante < 4 * 60 * 60 * 1000 ? "text-warning-700" : "text-slate-400",
    vencido,
  };
}

interface DemandQueueProps {
  hasPermission: (permission: string) => boolean;
  currentUserId: string;
  onDemandAssumed: (projectId: string) => void;
  onQueueChanged?: () => void;
}

export default function DemandQueue({ hasPermission, currentUserId, onDemandAssumed, onQueueChanged }: DemandQueueProps) {
  const [vista, setVista] = useState<"fila" | "prazos" | "expurgos">("fila");
  const [config, setConfig] = useState<DemandSlaSettings | null>(null);
  const [equipe, setEquipe] = useState<Array<{ id: string; name: string }>>([]);
  const [direcionando, setDirecionando] = useState<Demand | null>(null);
  const [destino, setDestino] = useState("");
  const [recusando, setRecusando] = useState<Demand | null>(null);
  const [motivoRecusa, setMotivoRecusa] = useState("");
  const [filtro, setFiltro] = useState(FILTROS[0].chave);
  const [demandas, setDemandas] = useState<Demand[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aberta, setAberta] = useState<Demand | null>(null);
  const [emAcao, setEmAcao] = useState(false);
  const [devolvendo, setDevolvendo] = useState<Demand | null>(null);
  const [motivo, setMotivo] = useState("");
  const [erroAcao, setErroAcao] = useState("");
  // F7: a atualização que a pessoa quer descartar, e o motivo (D27).
  const [descartando, setDescartando] = useState<{ demanda: Demand; updateId: string } | null>(null);
  const [motivoDescarte, setMotivoDescarte] = useState("");
  const [encerrando, setEncerrando] = useState<Demand | null>(null);

  const podeAssumir = hasPermission("demand:assume");
  const souGerente = hasPermission("demand:manage");
  // D16: numa fila direcionada, assumir é justamente o ato que a política
  // existe para tirar - o botão some para quem não é gerente, e a explicação
  // fica no cabeçalho da tela em vez de num 403 mudo.
  const filaDirecionada = config?.assignment_policy === "direcionamento";
  const podeAssumirAgora = podeAssumir && (!filaDirecionada || souGerente);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      const [lista, cfg] = await Promise.all([
        ApiClient.get<Demand[]>(`/api/demands?status=${encodeURIComponent(filtro)}`),
        ApiClient.get<DemandSlaSettings>("/api/demands/sla-settings"),
      ]);
      setDemandas(Array.isArray(lista) ? lista : []);
      setConfig(cfg);
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar a fila.");
    } finally {
      setCarregando(false);
    }
  }, [filtro]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const assumir = async (d: Demand) => {
    setEmAcao(true);
    setErroAcao("");
    try {
      const resposta = await ApiClient.post<{ project_id: string; documents_without_content: number }>(
        `/api/demands/${d.id}/assume`,
        {}
      );
      setAberta(null);
      await carregar();
      onQueueChanged?.();
      onDemandAssumed(resposta.project_id);
    } catch (e: any) {
      setErroAcao(e.message || "Não foi possível assumir esta demanda.");
    } finally {
      setEmAcao(false);
    }
  };

  const devolver = async () => {
    if (!devolvendo) return;
    setEmAcao(true);
    setErroAcao("");
    try {
      await ApiClient.post(`/api/demands/${devolvendo.id}/return`, { reason: motivo });
      setDevolvendo(null);
      setMotivo("");
      setAberta(null);
      await carregar();
      onQueueChanged?.();
    } catch (e: any) {
      setErroAcao(e.message || "Não foi possível devolver esta demanda.");
    } finally {
      setEmAcao(false);
    }
  };

  const direcionar = async () => {
    if (!direcionando || !destino) return;
    setEmAcao(true);
    setErroAcao("");
    try {
      await ApiClient.post(`/api/demands/${direcionando.id}/direct`, { user_id: destino });
      setDirecionando(null);
      setDestino("");
      setAberta(null);
      await carregar();
      onQueueChanged?.();
    } catch (e: any) {
      setErroAcao(e.message || "Não foi possível direcionar esta demanda.");
    } finally {
      setEmAcao(false);
    }
  };

  // ── F7: as decisões sobre a atualização pós-envio (D27) ──────────────────
  //
  // Recarregar e REABRIR a demanda depois de decidir, em vez de fechar o
  // drawer: quem incorporou uma atualização quase sempre quer ver a próxima, e
  // fechar a gaveta faria a pessoa reabrir a mesma demanda a cada decisão.
  const recarregarEReabrir = async (demandaId: string) => {
    await carregar();
    onQueueChanged?.();
    try {
      const atual = await ApiClient.get<Demand>(`/api/demands/${demandaId}`);
      setAberta(atual);
    } catch {
      setAberta(null);
    }
  };

  const incorporar = async (d: Demand, updateId: string) => {
    setEmAcao(true);
    setErroAcao("");
    try {
      await ApiClient.post(`/api/demands/${d.id}/updates/${updateId}/incorporate`, {});
      await recarregarEReabrir(d.id);
    } catch (e: any) {
      setErroAcao(e.message || "Não foi possível incorporar esta atualização.");
    } finally {
      setEmAcao(false);
    }
  };

  const descartar = async () => {
    if (!descartando) return;
    setEmAcao(true);
    setErroAcao("");
    try {
      await ApiClient.post(`/api/demands/${descartando.demanda.id}/updates/${descartando.updateId}/dismiss`, {
        note: motivoDescarte,
      });
      const id = descartando.demanda.id;
      setDescartando(null);
      setMotivoDescarte("");
      await recarregarEReabrir(id);
    } catch (e: any) {
      setErroAcao(e.message || "Não foi possível descartar esta atualização.");
    } finally {
      setEmAcao(false);
    }
  };

  // F7 (D18): encerrar depois do pedido de cancelamento aprovado no CRM. A
  // outra saída é CONCLUIR o projeto, pelo caminho de sempre — e é por isso que
  // a confirmação diz as duas em voz alta.
  const encerrar = async () => {
    if (!encerrando) return;
    setEmAcao(true);
    setErroAcao("");
    try {
      await ApiClient.post(`/api/demands/${encerrando.id}/cancel/close`, {});
      setEncerrando(null);
      setAberta(null);
      await carregar();
      onQueueChanged?.();
    } catch (e: any) {
      setErroAcao(e.message || "Não foi possível encerrar esta demanda.");
    } finally {
      setEmAcao(false);
    }
  };

  const aprovarDevolucao = async (d: Demand) => {
    setEmAcao(true);
    setErroAcao("");
    try {
      await ApiClient.post(`/api/demands/${d.id}/return/approve`, {});
      setAberta(null);
      await carregar();
      onQueueChanged?.();
    } catch (e: any) {
      setErroAcao(e.message || "Não foi possível aprovar a devolução.");
    } finally {
      setEmAcao(false);
    }
  };

  const recusarDevolucao = async () => {
    if (!recusando) return;
    setEmAcao(true);
    setErroAcao("");
    try {
      await ApiClient.post(`/api/demands/${recusando.id}/return/reject`, { reason: motivoRecusa });
      setRecusando(null);
      setMotivoRecusa("");
      setAberta(null);
      await carregar();
      onQueueChanged?.();
    } catch (e: any) {
      setErroAcao(e.message || "Não foi possível recusar a devolução.");
    } finally {
      setEmAcao(false);
    }
  };

  const abrirDirecionamento = async (d: Demand) => {
    setErroAcao("");
    setDestino("");
    setDirecionando(d);
    try {
      if (equipe.length === 0) setEquipe(await ApiClient.get<Array<{ id: string; name: string }>>("/api/demands/team"));
    } catch {
      // A lista vazia já diz o que precisa: sem ninguém elegível, não há para
      // quem direcionar. Um erro aqui não pode fechar o diálogo.
    }
  };

  const naFila = useMemo(() => demandas.filter((d) => d.status === "queued").length, [demandas]);
  const aguardandoAprovacao = useMemo(
    () => demandas.filter((d) => d.return_requested_at && !d.return_decided_at).length,
    [demandas]
  );

  // F7: quantas demandas ESTA pessoa tem com atualização pendente, e quantas
  // com pedido de cancelamento aberto. Recortado por quem assumiu de propósito:
  // um contador global faria todo mundo ver o trabalho pendente de todo mundo,
  // que é o oposto do que um aviso acionável é.
  const minhasComAtualizacao = useMemo(
    () =>
      demandas.filter(
        (d) => d.assigned_user_id === currentUserId && (d.pending_updates?.length ?? 0) > 0
      ).length,
    [demandas, currentUserId]
  );
  const minhasComCancelamento = useMemo(
    () =>
      demandas.filter(
        (d) => d.assigned_user_id === currentUserId && d.cancellation_requested_at && !d.cancellation_closed_at
      ).length,
    [demandas, currentUserId]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">
            {vista === "fila"
              ? `Fila de Pré-vendas (${demandas.length})`
              : vista === "prazos"
                ? "Prazos e desempenho"
                : "Expurgos em cascata"}
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {vista === "fila" ? (
              <>
                Pedidos enviados pelo CRM. {naFila > 0 ? `${naFila} aguardando alguém assumir.` : "Nada aguardando na fila."}
                {filaDirecionada && " As demandas desta instalação são direcionadas pelo gerente de pré-vendas."}
                {config?.assignment_policy === "automatico" && " Novas demandas são distribuídas automaticamente por menor carga."}
              </>
            ) : vista === "prazos" ? (
              "Prazo por etapa, alertas de prazo vencido e tempo de resposta."
            ) : (
              "O que o CRM mandou apagar daqui, e o que de fato saiu."
            )}
          </p>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            {(
              [
                ["fila", "Fila"],
                ["prazos", "Prazos e desempenho"],
                ["expurgos", "Expurgos"],
              ] as const
            ).map(([chave, rotulo]) => (
              <button
                key={chave}
                onClick={() => setVista(chave)}
                data-testid={`demand-vista-${chave}`}
                className={`text-[11px] px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                  vista === chave ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>
        </div>
      </div>

      {vista === "prazos" ? (
        <DemandSlaPanel hasPermission={hasPermission} onChanged={() => void carregar()} />
      ) : vista === "expurgos" ? (
        <DemandPurgePanel onChanged={() => void carregar()} />
      ) : (
      <>
      {(minhasComAtualizacao > 0 || minhasComCancelamento > 0) && (
        <div
          className="bg-brand-50 border border-brand-200 text-brand-800 text-xs rounded-lg p-3 flex items-start gap-2"
          data-testid="aviso-ciclo-de-vida"
        >
          <ArrowRightLeft size={14} className="mt-0.5 shrink-0" />
          <div>
            {minhasComAtualizacao > 0 && (
              <>
                <span className="font-bold">
                  {minhasComAtualizacao} demanda(s) sua(s) com atualização do CRM aguardando decisão.
                </span>{" "}
                Nada foi escrito no seu projeto: abra a demanda para ver o antes e o depois.{" "}
              </>
            )}
            {minhasComCancelamento > 0 && (
              <span className="font-bold">
                {minhasComCancelamento} com pedido de cancelamento aprovado no CRM.
              </span>
            )}
          </div>
        </div>
      )}

      {souGerente && aguardandoAprovacao > 0 && (
        <div className="bg-warning-50 border border-warning-200 text-warning-800 text-xs rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-bold">
              {aguardandoAprovacao} devolução(ões) aguardando sua aprovação.
            </span>{" "}
            Abra a demanda para ler o motivo e decidir.
          </div>
        </div>
      )}

      <div className="flex items-center justify-end flex-wrap gap-2">
          <div className="flex items-center flex-wrap gap-1 bg-slate-100 rounded-lg p-1">
            {FILTROS.map((f) => (
              <button
                key={f.chave}
                onClick={() => setFiltro(f.chave)}
                className={`text-[11px] px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                  filtro === f.chave ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {f.rotulo}
              </button>
            ))}
          </div>
          <button
            onClick={() => void carregar()}
            className="flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer"
          >
            <RefreshCw size={13} className={carregando ? "animate-spin" : ""} /> Atualizar
          </button>
      </div>

      {erro && (
        <div className="bg-danger-50 border border-danger-200 text-danger-700 text-xs rounded-lg p-3">{erro}</div>
      )}

      {/* overflow-x-auto, e não overflow-hidden: em 390px a tabela não cabe, e
          "hidden" CORTA as colunas da direita - valor, prazo, situação e o botão
          de assumir - sem deixar chegar nelas. O min-w mantém as colunas
          legíveis e joga a diferença para a rolagem horizontal DESTA caixa, em
          vez de a página inteira andar de lado. */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto shadow-sm">
        <table className="w-full min-w-[820px] text-left text-xs border-collapse">
          <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
            <tr>
              <th className="p-3">Demanda</th>
              <th className="p-3">Cliente</th>
              <th className="p-3">Vertical</th>
              <th className="p-3 text-right">Valor</th>
              <th className="p-3">Prazo do edital</th>
              <th className="p-3">Prazo do SLA</th>
              <th className="p-3">Situação</th>
              <th className="p-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {demandas.map((d) => {
              const dias = diasAtePrazo(d.deadline);
              return (
                <tr key={d.id} className="hover:bg-slate-50/50">
                  <td className="p-3">
                    <button
                      onClick={() => { setAberta(d); setErroAcao(""); }}
                      className="font-semibold text-slate-800 hover:text-brand-700 text-left cursor-pointer"
                    >
                      {d.title}
                    </button>
                    <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5">
                      {d.demand_ref}
                      {d.documents.length > 0 && (
                        <span className="inline-flex items-center gap-0.5">
                          <FileText size={9} /> {d.documents.length}
                        </span>
                      )}
                      {d.cross_environment && (
                        <span
                          title="Este par cruza ambientes: dado de um ambiente entrando em outro."
                          className="inline-flex items-center gap-0.5 text-warning-700 bg-warning-50 border border-warning-200 rounded px-1"
                        >
                          <AlertTriangle size={9} /> ambientes cruzados
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-slate-700">
                    {d.company.name}
                    {d.company.tax_id && <div className="text-[10px] text-slate-400 font-mono">{d.company.tax_id}</div>}
                  </td>
                  <td className="p-3 text-slate-600">{d.vertical}</td>
                  <td className="p-3 text-right text-slate-700 font-mono">
                    {moeda(d.opportunity.value, d.opportunity.currency)}
                    {d.opportunity.margin_percent !== null && d.opportunity.margin_percent !== undefined && (
                      <div className="text-[10px] text-slate-400">margem {d.opportunity.margin_percent}%</div>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="text-slate-700">{dataCurta(d.deadline)}</div>
                    {dias !== null && (
                      <div
                        className={`text-[10px] font-semibold ${
                          dias < 0 ? "text-danger-600" : dias <= 3 ? "text-warning-700" : "text-slate-400"
                        }`}
                      >
                        {dias < 0 ? `vencido há ${Math.abs(dias)}d` : `faltam ${dias}d`}
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    {(() => {
                      const p = estadoDoPrazo(d.due_at);
                      if (!p) {
                        // Traço, e não "vencido": sem SLA configurado ou em
                        // estado terminal, esta demanda não deve etapa nenhuma.
                        return <span className="text-slate-300">—</span>;
                      }
                      return (
                        <div data-testid={`sla-prazo-${d.demand_ref}`}>
                          <div className="text-slate-700">{dataCurta(d.due_at)}</div>
                          <div className={`text-[10px] font-semibold ${p.classe}`}>{p.texto}</div>
                          <div className="text-[10px] text-slate-400">{d.sla_stage_label}</div>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLOR[d.status] || "bg-slate-100 text-slate-600"}`}>
                      {STATUS_LABEL[d.status] || d.status}
                    </span>
                    {d.assigned_to && (
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {d.assigned_to}
                        {d.assignment_source === "auto" && " · automático"}
                        {d.assignment_source === "manager" && " · direcionada"}
                      </div>
                    )}
                    {d.return_requested_at && !d.return_decided_at && (
                      <div className="text-[10px] text-warning-700 font-semibold mt-0.5" data-testid={`devolucao-pendente-${d.demand_ref}`}>
                        devolução aguardando o gerente
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {d.status === "queued" && podeAssumirAgora && (
                      <button
                        onClick={() => void assumir(d)}
                        disabled={emAcao}
                        className="inline-flex items-center gap-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-[11px] px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer"
                      >
                        <UserPlus size={12} /> Assumir
                      </button>
                    )}
                    {(d.status === "assigned" || d.status === "in_analysis") && podeAssumir && d.assigned_user_id === currentUserId && !d.return_requested_at && (
                      <button
                        onClick={() => { setDevolvendo(d); setMotivo(""); setErroAcao(""); }}
                        className="inline-flex items-center gap-1 border border-slate-200 hover:bg-slate-50 text-slate-600 text-[11px] px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer"
                      >
                        <Undo2 size={12} /> Devolver
                      </button>
                    )}
                    {souGerente && (d.status === "queued" || d.status === "assigned" || d.status === "in_analysis") && (
                      <button
                        onClick={() => void abrirDirecionamento(d)}
                        data-testid={`direcionar-${d.demand_ref}`}
                        className="ml-1 inline-flex items-center gap-1 border border-slate-200 hover:bg-slate-50 text-slate-600 text-[11px] px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer"
                      >
                        <Send size={12} /> {d.status === "queued" ? "Direcionar" : "Reatribuir"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!carregando && demandas.length === 0 && (
              <tr>
                <td colSpan={8} className="p-10 text-center text-slate-400">
                  <Inbox size={28} className="mx-auto mb-2 opacity-40" />
                  <div className="text-xs font-semibold text-slate-500">Nenhuma demanda neste filtro</div>
                  <div className="text-[11px] mt-1">Demandas chegam quando o vendedor envia uma oportunidade do CRM para a pré-venda.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {aberta && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4" onClick={() => setAberta(null)}>
          <div
            data-testid="demand-detail-body"
            className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between p-5 border-b border-slate-200 sticky top-0 bg-white">
              <div>
                <h3 className="text-sm font-bold text-slate-800">{aberta.title}</h3>
                <div className="text-[11px] text-slate-400 font-mono mt-0.5">{aberta.demand_ref}</div>
              </div>
              <button onClick={() => setAberta(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-5 text-xs">
              {aberta.cross_environment && (
                <div className="flex items-start gap-2 bg-warning-50 border border-warning-200 text-warning-800 rounded-lg p-3">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="font-bold">Par com ambientes cruzados</div>
                    <div className="mt-0.5">
                      Esta demanda veio de uma instalação do CRM em outro ambiente. Confira antes de tratar o conteúdo como dado real.
                    </div>
                  </div>
                </div>
              )}

              <section>
                <h4 className="font-mono uppercase text-[10px] text-slate-500 mb-2">Cliente (referência do CRM)</h4>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                  <Campo rotulo="Nome" valor={aberta.company.name} />
                  <Campo rotulo="Razão social" valor={aberta.company.legal_name} />
                  <Campo rotulo="CNPJ" valor={aberta.company.tax_id} />
                  <Campo rotulo="Raiz do CNPJ" valor={aberta.company.cnpj_root} />
                  <Campo rotulo="Setor" valor={aberta.company.sector} />
                  <Campo rotulo="Segmento" valor={aberta.company.segment} />
                </dl>
              </section>

              <section>
                <h4 className="font-mono uppercase text-[10px] text-slate-500 mb-2">Oportunidade</h4>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                  <Campo rotulo="Nome" valor={aberta.opportunity.name} />
                  <Campo rotulo="Etapa" valor={aberta.opportunity.stage} />
                  <Campo rotulo="Valor" valor={moeda(aberta.opportunity.value, aberta.opportunity.currency)} />
                  <Campo
                    rotulo="Margem"
                    valor={aberta.opportunity.margin_percent !== null && aberta.opportunity.margin_percent !== undefined ? `${aberta.opportunity.margin_percent}%` : null}
                  />
                  <Campo
                    rotulo="Probabilidade"
                    valor={aberta.opportunity.probability !== null && aberta.opportunity.probability !== undefined ? `${aberta.opportunity.probability}%` : null}
                  />
                  <Campo rotulo="Fechamento previsto" valor={dataCurta(aberta.opportunity.expected_close_date)} />
                </dl>
                {aberta.opportunity.risks && aberta.opportunity.risks.length > 0 && (
                  <ul className="mt-2 list-disc list-inside text-slate-600 space-y-0.5">
                    {aberta.opportunity.risks.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4 className="font-mono uppercase text-[10px] text-slate-500 mb-2">Pedido</h4>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                  <Campo rotulo="Vertical" valor={aberta.vertical} />
                  <Campo rotulo="Prazo do edital" valor={dataCurta(aberta.deadline)} />
                  <Campo rotulo="Validade da proposta" valor={dataCurta(aberta.proposal_validity_date)} />
                  <Campo rotulo="Modalidade" valor={aberta.procurement_modality} />
                  <Campo rotulo="Orientação de marca" valor={aberta.ai_orientation_mode} />
                  <Campo rotulo="Enviado por" valor={`${aberta.sent_by.name} · ${dataCurta(aberta.sent_at)}`} />
                </dl>
                {aberta.objective && (
                  <p className="mt-2 text-slate-600 whitespace-pre-wrap border-l-2 border-slate-200 pl-3">{aberta.objective}</p>
                )}
                <p className="mt-2 text-slate-600 whitespace-pre-wrap">{aberta.description}</p>
              </section>

              <section>
                <h4 className="font-mono uppercase text-[10px] text-slate-500 mb-2">Documentos ({aberta.documents.length})</h4>
                {aberta.documents.length === 0 && <p className="text-slate-400">Nenhum documento veio no envelope.</p>}
                <ul className="space-y-1">
                  {aberta.documents.map((doc) => (
                    <li key={doc.id} className="flex items-center justify-between border border-slate-200 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText size={13} className="text-slate-400 shrink-0" />
                        <span className="truncate text-slate-700">{doc.filename}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        {doc.has_extracted_text && (
                          <span className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">texto extraído</span>
                        )}
                        <span
                          className={`text-[10px] rounded px-1.5 py-0.5 font-semibold ${
                            doc.has_content ? "bg-success-50 text-success-700" : "bg-warning-50 text-warning-700"
                          }`}
                        >
                          {doc.has_content ? "arquivo recebido" : "aguardando arquivo"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              {aberta.cancellation_requested_at && !aberta.cancellation_closed_at && (
                <section className="border border-danger-200 bg-danger-50/60 rounded-lg p-3" data-testid="modal-cancelamento-pendente">
                  <h4 className="font-mono uppercase text-[10px] text-danger-700 mb-1">
                    Cancelamento aprovado no CRM
                  </h4>
                  <p className="text-slate-700 whitespace-pre-wrap">{aberta.cancellation_justification}</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Aprovado por {aberta.cancellation_approved_by || "—"} em {dataCurta(aberta.cancellation_requested_at)}.
                    A demanda continua com você: encerre-a, ou conclua o projeto se o trabalho ainda servir para outro
                    edital do mesmo cliente.
                  </p>
                </section>
              )}

              {aberta.cancellation_closed_at && aberta.cancellation_outcome && (
                <section className="border border-slate-200 rounded-lg p-3">
                  <h4 className="font-mono uppercase text-[10px] text-slate-500 mb-1">Cancelamento pedido pelo CRM</h4>
                  <p className="text-slate-700 whitespace-pre-wrap">{aberta.cancellation_justification}</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {aberta.cancellation_outcome === "cancelled"
                      ? `Encerrada${aberta.cancellation_closed_by ? ` por ${aberta.cancellation_closed_by}` : " na fila, antes de alguém assumir"}`
                      : "Concluída mesmo assim, por decisão de quem assumiu"}{" "}
                    em {dataCurta(aberta.cancellation_closed_at)}.
                  </p>
                </section>
              )}

              {(aberta.pending_updates?.length ?? 0) > 0 && (
                <section className="space-y-2" data-testid="modal-atualizacoes-pendentes">
                  <h4 className="font-mono uppercase text-[10px] text-slate-500">
                    Atualizações do CRM ({aberta.pending_updates?.length})
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Chegaram depois do envio e já valem na demanda. O seu <strong>projeto não foi tocado</strong> — a
                    travessia é decisão sua.
                  </p>
                  {(aberta.pending_updates ?? []).map((u) => (
                    <div
                      key={u.id}
                      className={`border rounded-lg p-3 ${
                        u.kind === "oportunidade_perdida"
                          ? "border-danger-200 bg-danger-50/60"
                          : "border-slate-200 bg-slate-50/60"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
                        {u.kind === "oportunidade_perdida" ? (
                          <>
                            <TrendingDown size={12} className="text-danger-600" /> A oportunidade foi marcada como
                            perdida no CRM
                          </>
                        ) : (
                          <>
                            <ArrowRightLeft size={12} className="text-slate-500" /> Mudança de {u.kind}
                          </>
                        )}
                      </div>
                      {u.kind === "oportunidade_perdida" && (
                        <p className="text-[11px] text-slate-600 mt-1">
                          Isto é um aviso, e não fecha nada: quem decide encerrar ou concluir é você.
                        </p>
                      )}
                      <p className="text-[11px] text-slate-500 mt-1">
                        {u.changed_by ? `Por ${u.changed_by}` : "Sem autor declarado"} em {dataCurta(u.changed_at)}
                      </p>
                      {u.note && <p className="text-slate-600 mt-1 whitespace-pre-wrap">{u.note}</p>}
                      <ul className="mt-2 space-y-1">
                        {u.changes.map((c) => (
                          <li key={c.campo} className="text-[11px] flex flex-wrap items-baseline gap-1.5">
                            <span className="font-semibold text-slate-600">{c.rotulo}:</span>
                            <span className="line-through text-slate-400">{c.antes ?? "—"}</span>
                            <span className="text-slate-400">→</span>
                            <span className="font-bold text-slate-800">{c.depois ?? "—"}</span>
                          </li>
                        ))}
                      </ul>
                      {aberta.assigned_user_id === currentUserId || souGerente ? (
                        <div className="flex flex-wrap gap-2 mt-3">
                          <button
                            onClick={() => void incorporar(aberta, u.id)}
                            disabled={emAcao}
                            data-testid={`incorporar-${u.id}`}
                            className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-[11px] px-2.5 py-1 rounded-md font-semibold cursor-pointer"
                          >
                            <Check size={12} /> Levar para o projeto
                          </button>
                          <button
                            onClick={() => {
                              setDescartando({ demanda: aberta, updateId: u.id });
                              setMotivoDescarte("");
                              setErroAcao("");
                            }}
                            data-testid={`descartar-${u.id}`}
                            className="inline-flex items-center gap-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[11px] px-2.5 py-1 rounded-md font-semibold cursor-pointer"
                          >
                            <X size={12} /> Não levar
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </section>
              )}

              {aberta.return_requested_at && !aberta.return_decided_at && (
                <section className="border border-warning-200 bg-warning-50/60 rounded-lg p-3" data-testid="modal-devolucao-pendente">
                  <h4 className="font-mono uppercase text-[10px] text-warning-700 mb-1">Devolução aguardando o gerente</h4>
                  <p className="text-slate-700 whitespace-pre-wrap">{aberta.return_request_reason}</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Pedida por {aberta.return_requested_by || "—"} em {dataCurta(aberta.return_requested_at)}. O vendedor NÃO foi avisado:
                    nada é contado ao CRM enquanto a devolução não for aprovada.
                  </p>
                </section>
              )}

              {aberta.return_rejection_reason && (
                <section className="border border-slate-200 rounded-lg p-3">
                  <h4 className="font-mono uppercase text-[10px] text-slate-500 mb-1">Devolução recusada pelo gerente</h4>
                  <p className="text-slate-700 whitespace-pre-wrap">{aberta.return_rejection_reason}</p>
                </section>
              )}

              {aberta.due_at && (
                <section>
                  <h4 className="font-mono uppercase text-[10px] text-slate-500 mb-2">Prazo do SLA</h4>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                    <Campo rotulo="Etapa devida" valor={aberta.sla_stage_label} />
                    <Campo rotulo="Vence em" valor={`${dataCurta(aberta.due_at)} · ${estadoDoPrazo(aberta.due_at)?.texto ?? ""}`} />
                  </dl>
                </section>
              )}

              {aberta.returned_reason && (
                <section>
                  <h4 className="font-mono uppercase text-[10px] text-slate-500 mb-2">Motivo da devolução</h4>
                  <p className="text-slate-600 whitespace-pre-wrap border-l-2 border-danger-200 pl-3">{aberta.returned_reason}</p>
                </section>
              )}

              {erroAcao && <div className="bg-danger-50 border border-danger-200 text-danger-700 rounded-lg p-3">{erroAcao}</div>}
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 sticky bottom-0 bg-white">
              {aberta.status === "queued" && podeAssumir && (
                <button
                  onClick={() => void assumir(aberta)}
                  disabled={emAcao}
                  className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer"
                >
                  <UserPlus size={13} /> Assumir e abrir projeto
                </button>
              )}
              {(aberta.status === "assigned" || aberta.status === "in_analysis") && podeAssumir && aberta.assigned_user_id === currentUserId && !aberta.return_requested_at && (
                <button
                  onClick={() => { setDevolvendo(aberta); setMotivo(""); setErroAcao(""); }}
                  className="inline-flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer"
                >
                  <Undo2 size={13} /> Devolver ao vendedor
                </button>
              )}
              {(aberta.status === "assigned" || aberta.status === "in_analysis") &&
                aberta.cancellation_requested_at &&
                !aberta.cancellation_closed_at &&
                podeAssumir &&
                (aberta.assigned_user_id === currentUserId || souGerente) && (
                  <button
                    onClick={() => {
                      setEncerrando(aberta);
                      setErroAcao("");
                    }}
                    data-testid="encerrar-demanda"
                    className="inline-flex items-center gap-1.5 bg-danger-600 hover:bg-danger-700 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer"
                  >
                    <Ban size={13} /> Encerrar demanda
                  </button>
                )}
              {souGerente && (aberta.status === "queued" || aberta.status === "assigned" || aberta.status === "in_analysis") && (
                <button
                  onClick={() => void abrirDirecionamento(aberta)}
                  className="inline-flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer"
                >
                  <Send size={13} /> {aberta.status === "queued" ? "Direcionar" : "Reatribuir"}
                </button>
              )}
              {souGerente && aberta.return_requested_at && !aberta.return_decided_at && (
                <>
                  <button
                    onClick={() => { setRecusando(aberta); setMotivoRecusa(""); setErroAcao(""); }}
                    data-testid="recusar-devolucao"
                    className="inline-flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer"
                  >
                    <X size={13} /> Recusar devolução
                  </button>
                  <button
                    onClick={() => void aprovarDevolucao(aberta)}
                    disabled={emAcao}
                    data-testid="aprovar-devolucao"
                    className="inline-flex items-center gap-1.5 bg-danger-600 hover:bg-danger-700 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer"
                  >
                    <Check size={13} /> Aprovar devolução
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {devolvendo && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="p-5 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-800">Devolver ao vendedor</h3>
              <p className="text-[11px] text-slate-500 mt-1">
                O motivo vai junto: é com ele que o vendedor sabe o que corrigir antes de reenviar.
              </p>
            </div>
            <div className="p-5 space-y-3">
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={4}
                placeholder="Ex.: o edital anexado está incompleto - faltam os anexos técnicos citados no item 7."
                className="w-full border border-slate-200 rounded-lg p-3 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <div className="text-[11px] text-slate-400">{motivo.trim().length} / mínimo 10 caracteres</div>
              {erroAcao && <div className="bg-danger-50 border border-danger-200 text-danger-700 text-xs rounded-lg p-3">{erroAcao}</div>}
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200">
              <button
                onClick={() => setDevolvendo(null)}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => void devolver()}
                disabled={emAcao || motivo.trim().length < 10}
                className="inline-flex items-center gap-1.5 bg-danger-600 hover:bg-danger-700 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer"
              >
                <Undo2 size={13} /> Devolver
              </button>
            </div>
          </div>
        </div>
      )}

      {direcionando && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md" data-testid="dialogo-direcionar">
            <div className="p-5 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-800">
                {direcionando.status === "queued" ? "Direcionar demanda" : "Reatribuir demanda"}
              </h3>
              <p className="text-[11px] text-slate-500 mt-1">
                {direcionando.status === "queued"
                  ? "A demanda é assumida em nome de quem você escolher, e o projeto nasce com essa pessoa como dona."
                  : "O projeto muda de dono junto. Um pedido de devolução pendente é encerrado por esta decisão."}
              </p>
            </div>
            <div className="p-5 space-y-3">
              <select
                value={destino}
                data-testid="direcionar-destino"
                onChange={(e) => setDestino(e.target.value)}
                className="w-full border border-slate-200 rounded-lg p-2.5 text-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              >
                <option value="">Escolha uma pessoa…</option>
                {equipe
                  .filter((u) => u.id !== direcionando.assigned_user_id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
              {equipe.length === 0 && (
                <p className="text-[11px] text-warning-700">
                  Ninguém com permissão para assumir demandas está ativo nesta instalação.
                </p>
              )}
              {erroAcao && <div className="bg-danger-50 border border-danger-200 text-danger-700 text-xs rounded-lg p-3">{erroAcao}</div>}
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200">
              <button
                onClick={() => setDirecionando(null)}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => void direcionar()}
                disabled={emAcao || !destino}
                data-testid="direcionar-confirmar"
                className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer"
              >
                <Send size={13} /> Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {descartando && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" data-testid="dialogo-descartar-atualizacao">
            <div className="p-5 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-800">Não levar esta atualização para o projeto</h3>
              <p className="text-[11px] text-slate-500 mt-1">
                A demanda continua mostrando o que o CRM diz; o seu projeto fica como está. Diga por quê — meses depois,
                sem o motivo, ninguém sabe se a atualização foi recusada ou se alguém clicou sem ler.
              </p>
            </div>
            <div className="p-5 space-y-3">
              <textarea
                value={motivoDescarte}
                onChange={(e) => setMotivoDescarte(e.target.value)}
                rows={4}
                data-testid="descarte-motivo"
                placeholder="Ex.: o prazo novo já estava considerado na análise; o escopo revisto não muda a solução."
                className="w-full border border-slate-200 rounded-lg p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <p className="text-[11px] text-slate-400">mínimo 10 caracteres</p>
              {erroAcao && <div className="bg-danger-50 border border-danger-200 text-danger-700 text-xs rounded-lg p-3">{erroAcao}</div>}
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200">
              <button
                onClick={() => setDescartando(null)}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
              >
                Voltar
              </button>
              <button
                onClick={() => void descartar()}
                disabled={emAcao || motivoDescarte.trim().length < 10}
                data-testid="descarte-confirmar"
                className="inline-flex items-center gap-1.5 bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer"
              >
                <X size={13} /> Não levar
              </button>
            </div>
          </div>
        </div>
      )}

      {encerrando && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" data-testid="dialogo-encerrar">
            <div className="p-5 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-800">Encerrar a demanda cancelada</h3>
              <p className="text-[11px] text-slate-500 mt-1">
                O vendedor pediu o cancelamento e o líder dele aprovou. Encerrar avisa o CRM de que o trabalho parou
                aqui — e manda e-mail a quem enviou.
              </p>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <p className="text-slate-700 whitespace-pre-wrap border-l-2 border-danger-200 pl-3">
                {encerrando.cancellation_justification}
              </p>
              <p className="text-[11px] text-slate-500">
                <strong>O projeto não é apagado.</strong> A análise, a precificação e a proposta continuam onde estão:
                se o trabalho ainda servir para outro edital do mesmo cliente, feche o projeto por “concluir” em vez de
                encerrar aqui.
              </p>
              {erroAcao && <div className="bg-danger-50 border border-danger-200 text-danger-700 text-xs rounded-lg p-3">{erroAcao}</div>}
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200">
              <button
                onClick={() => setEncerrando(null)}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
              >
                Voltar
              </button>
              <button
                onClick={() => void encerrar()}
                disabled={emAcao}
                data-testid="encerrar-confirmar"
                className="inline-flex items-center gap-1.5 bg-danger-600 hover:bg-danger-700 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer"
              >
                <Ban size={13} /> Encerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {recusando && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" data-testid="dialogo-recusar">
            <div className="p-5 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-800">Recusar a devolução</h3>
              <p className="text-[11px] text-slate-500 mt-1">
                A demanda continua com quem a assumiu. O motivo volta para essa pessoa — sem ele, ela só descobre que o pedido não passou.
              </p>
            </div>
            <div className="p-5 space-y-3">
              <textarea
                value={motivoRecusa}
                onChange={(e) => setMotivoRecusa(e.target.value)}
                rows={4}
                data-testid="recusar-motivo"
                placeholder="Ex.: os anexos estão no portal da licitação; baixe de lá antes de devolver."
                className="w-full border border-slate-200 rounded-lg p-3 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <div className="text-[11px] text-slate-400">{motivoRecusa.trim().length} / mínimo 10 caracteres</div>
              {erroAcao && <div className="bg-danger-50 border border-danger-200 text-danger-700 text-xs rounded-lg p-3">{erroAcao}</div>}
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200">
              <button
                onClick={() => setRecusando(null)}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => void recusarDevolucao()}
                disabled={emAcao || motivoRecusa.trim().length < 10}
                data-testid="recusar-confirmar"
                className="inline-flex items-center gap-1.5 bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer"
              >
                <X size={13} /> Recusar
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  return (
    <div>
      <dt className="text-[10px] uppercase font-mono text-slate-400">{rotulo}</dt>
      <dd className="text-slate-700">{valor || "—"}</dd>
    </div>
  );
}
