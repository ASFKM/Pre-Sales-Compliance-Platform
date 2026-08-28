import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Ban, Check, FileText, Send, TrendingDown, Undo2, UserPlus, X } from "lucide-react";
import ApiClient from "../lib/api";
import { Demand, DemandSlaSettings } from "../types";
import { Campo, dataCurta, estadoDoPrazo, moeda } from "./demandFormat";

// CDC 16 — Fase 10. A GAVETA de detalhe da demanda, e tudo o que se decide nela.
//
// Ela não é nova: até a F9 vivia dentro de `DemandQueue.tsx`, e o diff desta
// fase a mostra saindo de lá inteira — o mesmo texto, os mesmos diálogos, as
// mesmas regras. O motivo da mudança de lugar é a resposta H do dono, que a F10
// executa: a linha da tabela passa a ter só "Detalhes", e TODO ato — assumir,
// devolver, direcionar, encerrar, decidir a atualização, aprovar ou recusar a
// devolução — acontece aqui dentro. Com dois lugares desenhando linha de
// demanda a partir desta fase (a fila e os dois cards da Início), deixar os
// botões na linha significaria escrever a mesma decisão duas vezes; e duas
// cópias da mesma regra divergem na primeira mudança.
//
// A régua da resposta I, que a F9 acertou, continua palavra por palavra:
// `podeAssumirAgora` — e não `podeAssumir` — decide o botão de assumir, porque
// numa fila direcionada (D16) quem não é gerente levaria 403 da rota. Os dois
// lados obedecem à mesma régua porque agora são o mesmo lado.

interface DemandDetailDrawerProps {
  demanda: Demand;
  /** A configuração de prazo/atribuição da instalação. É dela que sai a D16. */
  config: DemandSlaSettings | null;
  hasPermission: (permission: string) => boolean;
  currentUserId: string;
  onFechar: () => void;
  /** Recarrega a lista de quem abriu a gaveta (a fila, ou um dos cards). */
  onMudou: () => void | Promise<void>;
  onAssumida: (projectId: string) => void;
}

export default function DemandDetailDrawer({
  demanda,
  config,
  hasPermission,
  currentUserId,
  onFechar,
  onMudou,
  onAssumida,
}: DemandDetailDrawerProps) {
  // Cópia local: depois de incorporar uma atualização a gaveta se REABRE com o
  // estado novo, em vez de fechar. Quem incorporou uma quase sempre quer ver a
  // próxima, e fechar faria a pessoa reabrir a mesma demanda a cada decisão.
  const [aberta, setAberta] = useState<Demand>(demanda);
  useEffect(() => setAberta(demanda), [demanda]);

  const [emAcao, setEmAcao] = useState(false);
  const [erroAcao, setErroAcao] = useState("");
  const [devolvendo, setDevolvendo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [direcionando, setDirecionando] = useState(false);
  const [destino, setDestino] = useState("");
  const [equipe, setEquipe] = useState<Array<{ id: string; name: string }>>([]);
  const [descartando, setDescartando] = useState<string | null>(null);
  const [motivoDescarte, setMotivoDescarte] = useState("");
  const [encerrando, setEncerrando] = useState(false);
  const [recusando, setRecusando] = useState(false);
  const [motivoRecusa, setMotivoRecusa] = useState("");

  const podeAssumir = hasPermission("demand:assume");
  const souGerente = hasPermission("demand:manage");
  // D16: numa fila direcionada, assumir é justamente o ato que a política
  // existe para tirar - o botão some para quem não é gerente, e a explicação
  // fica na tela em vez de num 403 mudo.
  const filaDirecionada = config?.assignment_policy === "direcionamento";
  const podeAssumirAgora = podeAssumir && (!filaDirecionada || souGerente);

  const assumir = async () => {
    setEmAcao(true);
    setErroAcao("");
    try {
      const resposta = await ApiClient.post<{ project_id: string; documents_without_content: number }>(
        `/api/demands/${aberta.id}/assume`,
        {}
      );
      onFechar();
      await onMudou();
      onAssumida(resposta.project_id);
    } catch (e: any) {
      setErroAcao(e.message || "Não foi possível assumir esta demanda.");
    } finally {
      setEmAcao(false);
    }
  };

  const devolver = async () => {
    setEmAcao(true);
    setErroAcao("");
    try {
      await ApiClient.post(`/api/demands/${aberta.id}/return`, { reason: motivo });
      setDevolvendo(false);
      setMotivo("");
      onFechar();
      await onMudou();
    } catch (e: any) {
      setErroAcao(e.message || "Não foi possível devolver esta demanda.");
    } finally {
      setEmAcao(false);
    }
  };

  const abrirDirecionamento = async () => {
    setErroAcao("");
    setDestino("");
    setDirecionando(true);
    try {
      if (equipe.length === 0) setEquipe(await ApiClient.get<Array<{ id: string; name: string }>>("/api/demands/team"));
    } catch {
      // A lista vazia já diz o que precisa: sem ninguém elegível, não há para
      // quem direcionar. Um erro aqui não pode fechar o diálogo.
    }
  };

  const direcionar = async () => {
    if (!destino) return;
    setEmAcao(true);
    setErroAcao("");
    try {
      await ApiClient.post(`/api/demands/${aberta.id}/direct`, { user_id: destino });
      setDirecionando(false);
      setDestino("");
      onFechar();
      await onMudou();
    } catch (e: any) {
      setErroAcao(e.message || "Não foi possível direcionar esta demanda.");
    } finally {
      setEmAcao(false);
    }
  };

  // ── F7: as decisões sobre a atualização pós-envio (D27) ──────────────────
  const recarregarEReabrir = async () => {
    await onMudou();
    try {
      setAberta(await ApiClient.get<Demand>(`/api/demands/${aberta.id}`));
    } catch {
      onFechar();
    }
  };

  const incorporar = async (updateId: string) => {
    setEmAcao(true);
    setErroAcao("");
    try {
      await ApiClient.post(`/api/demands/${aberta.id}/updates/${updateId}/incorporate`, {});
      await recarregarEReabrir();
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
      await ApiClient.post(`/api/demands/${aberta.id}/updates/${descartando}/dismiss`, { note: motivoDescarte });
      setDescartando(null);
      setMotivoDescarte("");
      await recarregarEReabrir();
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
    setEmAcao(true);
    setErroAcao("");
    try {
      await ApiClient.post(`/api/demands/${aberta.id}/cancel/close`, {});
      setEncerrando(false);
      onFechar();
      await onMudou();
    } catch (e: any) {
      setErroAcao(e.message || "Não foi possível encerrar esta demanda.");
    } finally {
      setEmAcao(false);
    }
  };

  const aprovarDevolucao = async () => {
    setEmAcao(true);
    setErroAcao("");
    try {
      await ApiClient.post(`/api/demands/${aberta.id}/return/approve`, {});
      onFechar();
      await onMudou();
    } catch (e: any) {
      setErroAcao(e.message || "Não foi possível aprovar a devolução.");
    } finally {
      setEmAcao(false);
    }
  };

  const recusarDevolucao = async () => {
    setEmAcao(true);
    setErroAcao("");
    try {
      await ApiClient.post(`/api/demands/${aberta.id}/return/reject`, { reason: motivoRecusa });
      setRecusando(false);
      setMotivoRecusa("");
      onFechar();
      await onMudou();
    } catch (e: any) {
      setErroAcao(e.message || "Não foi possível recusar a devolução.");
    } finally {
      setEmAcao(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4" onClick={onFechar}>
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
            <button onClick={onFechar} className="text-slate-400 hover:text-slate-600 cursor-pointer" aria-label="Fechar">
              <X size={18} />
            </button>
          </div>

          <div className="p-5 space-y-5 text-xs">
            {/* F10: as três colunas que saíram da linha — Cliente, Vertical e
                Situação — passam a ser lidas AQUI, e por isso a situação ganhou
                lugar próprio no topo. Sem ela, a resposta H trocaria três
                colunas por duas: o cliente e a vertical já tinham seção; o
                estado da demanda não tinha nenhuma. */}
            <section className="flex flex-wrap items-center gap-2" data-testid="modal-situacao">
              <span className="text-[10px] uppercase font-mono text-slate-400">Situação</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${aberta.status === "queued" ? "bg-brand-50 text-brand-700" : aberta.status === "returned" ? "bg-danger-50 text-danger-700" : aberta.status === "completed" ? "bg-success-50 text-success-700" : aberta.status === "cancelled" ? "bg-slate-100 text-slate-600" : "bg-warning-50 text-warning-700"}`}>
                {aberta.status === "queued"
                  ? "Na fila"
                  : aberta.status === "assigned"
                    ? "Assumida"
                    : aberta.status === "in_analysis"
                      ? "Em análise"
                      : aberta.status === "returned"
                        ? "Devolvida"
                        : aberta.status === "cancelled"
                          ? "Cancelada"
                          : "Concluída"}
              </span>
              {aberta.assigned_to && (
                <span className="text-[11px] text-slate-500">
                  com {aberta.assigned_to}
                  {aberta.assignment_source === "auto" && " · automático"}
                  {aberta.assignment_source === "manager" && " · direcionada"}
                </span>
              )}
            </section>

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
                          onClick={() => void incorporar(u.id)}
                          disabled={emAcao}
                          data-testid={`incorporar-${u.id}`}
                          className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-[11px] px-2.5 py-1 rounded-md font-semibold cursor-pointer"
                        >
                          <Check size={12} /> Levar para o projeto
                        </button>
                        <button
                          onClick={() => {
                            setDescartando(u.id);
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

          <div className="flex items-center justify-end flex-wrap gap-2 p-4 border-t border-slate-200 sticky bottom-0 bg-white">
            {/* F9, resposta I do dono: `podeAssumirAgora`, e não `podeAssumir`.
                Numa fila direcionada (D16) quem não é gerente veria aqui um
                botão que a rota recusaria com 403. A F10 não mexeu nesta régua:
                ela só passou a ser a ÚNICA, porque a linha da tabela deixou de
                ter botão de ato. */}
            {aberta.status === "queued" && podeAssumirAgora && (
              <button
                onClick={() => void assumir()}
                disabled={emAcao}
                data-testid="assumir-demanda"
                className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer"
              >
                <UserPlus size={13} /> Assumir e abrir projeto
              </button>
            )}
            {/* O outro lado da mesma régua, e ele precisa estar VISÍVEL: sem
                esta linha, uma fila direcionada esconderia o botão e a pessoa
                não saberia por quê — que é o 403 mudo com outra roupa. */}
            {aberta.status === "queued" && podeAssumir && !podeAssumirAgora && (
              <p className="text-[11px] text-slate-500 mr-auto" data-testid="fila-direcionada-aviso">
                As demandas desta instalação são direcionadas pelo gerente de pré-vendas.
              </p>
            )}
            {(aberta.status === "assigned" || aberta.status === "in_analysis") && podeAssumir && aberta.assigned_user_id === currentUserId && !aberta.return_requested_at && (
              <button
                onClick={() => { setDevolvendo(true); setMotivo(""); setErroAcao(""); }}
                data-testid="devolver-demanda"
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
                    setEncerrando(true);
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
                onClick={() => void abrirDirecionamento()}
                data-testid="direcionar-demanda"
                className="inline-flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer"
              >
                <Send size={13} /> {aberta.status === "queued" ? "Direcionar" : "Reatribuir"}
              </button>
            )}
            {souGerente && aberta.return_requested_at && !aberta.return_decided_at && (
              <>
                <button
                  onClick={() => { setRecusando(true); setMotivoRecusa(""); setErroAcao(""); }}
                  data-testid="recusar-devolucao"
                  className="inline-flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer"
                >
                  <X size={13} /> Recusar devolução
                </button>
                <button
                  onClick={() => void aprovarDevolucao()}
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
                data-testid="devolver-motivo"
                placeholder="Ex.: o edital anexado está incompleto - faltam os anexos técnicos citados no item 7."
                className="w-full border border-slate-200 rounded-lg p-3 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <div className="text-[11px] text-slate-400">{motivo.trim().length} / mínimo 10 caracteres</div>
              {erroAcao && <div className="bg-danger-50 border border-danger-200 text-danger-700 text-xs rounded-lg p-3">{erroAcao}</div>}
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200">
              <button
                onClick={() => setDevolvendo(false)}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => void devolver()}
                disabled={emAcao || motivo.trim().length < 10}
                data-testid="devolver-confirmar"
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
                {aberta.status === "queued" ? "Direcionar demanda" : "Reatribuir demanda"}
              </h3>
              <p className="text-[11px] text-slate-500 mt-1">
                {aberta.status === "queued"
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
                  .filter((u) => u.id !== aberta.assigned_user_id)
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
                onClick={() => setDirecionando(false)}
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
                {aberta.cancellation_justification}
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
                onClick={() => setEncerrando(false)}
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
                onClick={() => setRecusando(false)}
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
  );
}
