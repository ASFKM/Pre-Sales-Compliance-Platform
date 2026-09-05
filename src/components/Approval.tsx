import { useState } from "react";
import { TriangleAlert, FolderOpen } from "lucide-react";
import { ApprovalWorkflow, Proposal } from "../types";
import { useApprovalCenter } from "../hooks/useApprovalCenter";
import { carregarDossieDeAprovacao, DossieDeAprovacao } from "../lib/approvalDossier";
import ApprovalDossierModal from "./modals/ApprovalDossierModal";
import RejectionModal, { ItemDeRejeicaoNaTela } from "./modals/RejectionModal";
import ApprovalConfirmModal, { ResumoDaAprovacao } from "./modals/ApprovalConfirmModal";

export interface ApprovalScope {
  is_approver: boolean;
  stage_ids: string[];
  stages: { workflow_id: string; stage_id: string; stage_name: string; order: number }[];
}

interface ApprovalProps {
  locale: "en" | "pt";
  tx: (en: string, pt: string) => string;
  hasPermission: (perm: string) => boolean;
  currentSessionUser: { id: string; role_id: string };
  proposals: Proposal[];
  approvalWorkflows: ApprovalWorkflow[];
  approvalDecisions: any[];
  users: any[];
  roles: any[];
  selectedProjectId: string;
  // F8: o escopo de aprovação vem do SERVIDOR (GET /api/me/approval-scope) e é o mesmo que gateia o
  // menu em App.tsx. `null` = ainda carregando; enquanto isso os botões ficam desabilitados, porque
  // habilitar por otimismo e desabilitar depois é pior do que esperar um instante.
  approvalScope: ApprovalScope | null;
  fetchGlobalConfigs: () => Promise<void> | void;
  fetchProjectDetails: (projectId: string) => Promise<void> | void;
  handleReleaseProposal: (propId: string) => void;
}

export default function Approval({
  locale, tx, hasPermission, currentSessionUser, proposals, approvalWorkflows, approvalDecisions,
  users, roles, selectedProjectId, approvalScope, fetchGlobalConfigs, fetchProjectDetails, handleReleaseProposal,
}: ApprovalProps) {
  const getApprovalStageTargetLabel = (stage: any) => {
    if (!stage) return locale === "pt" ? "Não configurado" : "Not configured";

    if (stage.approver_type === "user") {
      const user = users.find((u) => u.id === stage.approver_user_id);
      return user?.name || stage.approver_user_id || (locale === "pt" ? "Usuário não configurado" : "User not configured");
    }

    const role = roles.find((r) => r.id === stage.approver_role_id);
    return role?.name || stage.approver_role_id || (locale === "pt" ? "Perfil não configurado" : "Role not configured");
  };

  /*
   * F8: a regra de "sou o aprovador desta etapa" saiu daqui e virou endpoint.
   *
   * Ela continua idêntica (o servidor a implementa em server/utils/approvalScope.ts, com o mesmo
   * critério letra por letra), mas o CLIENTE não a recalcula mais: ele consome a lista de estágios
   * designados que o servidor devolveu. Duas cópias da mesma regra, uma em cada ponta, é como um
   * gate de tela costuma morrer - basta alguém corrigir um lado.
   *
   * O fallback local existe só para o intervalo em que o escopo ainda não chegou, e ele é
   * RESTRITIVO: sem escopo, ninguém aprova nada nesta tela. A trava real, de qualquer forma, é o
   * 403 da rota de decisão.
   */
  const canReviewApprovalStage = (stage: any) => {
    if (!stage || !approvalScope) return false;
    return approvalScope.stage_ids.includes(stage.id);
  };

  const { handleApprovalDecision } = useApprovalCenter({
    locale, selectedProjectId, fetchGlobalConfigs, fetchProjectDetails, canReviewApprovalStage,
  });

  /*
   * PreSales F8 (PARTE A): o parecer do aprovador é DIGITADO, não mais uma constante.
   *
   * Antes daquela fase, os dois botões mandavam uma frase fixa escrita no código, idêntica em toda
   * decisão de toda proposta - o que fazia o campo `comments` da decisão parecer preenchido e não
   * dizer absolutamente nada sobre aquela proposta.
   *
   * Uma caixa por ETAPA por PROPOSTA (a chave é o par), porque o mesmo aprovador pode ter mais de
   * uma etapa aberta na mesma tela e um rascunho não pode vazar de uma para a outra.
   */
  const [decisionComments, setDecisionComments] = useState<Record<string, string>>({});
  const [submittingDecisionKey, setSubmittingDecisionKey] = useState<string | null>(null);
  const decisionKey = (propId: string, stageId: string) => `${propId}::${stageId}`;

  // ── F8: o dossiê, e os dois popups de decisão. ────────────────────────────────────────────────
  // O dossiê é carregado UMA vez por proposta e reusado: ele é a fonte tanto do modal de quatro
  // abas quanto do resumo do popup de aprovação e da lista de seções do de rejeição. Buscá-lo três
  // vezes mostraria três retratos possivelmente diferentes da mesma proposta.
  const [dossies, setDossies] = useState<Record<string, DossieDeAprovacao>>({});
  const [carregandoDossieId, setCarregandoDossieId] = useState<string | null>(null);
  const [dossieAberto, setDossieAberto] = useState<string | null>(null);
  const [rejeitando, setRejeitando] = useState<{ propId: string; stage: any } | null>(null);
  const [aprovando, setAprovando] = useState<{ propId: string; stage: any } | null>(null);

  const obterDossie = async (propId: string): Promise<DossieDeAprovacao | null> => {
    if (dossies[propId]) return dossies[propId];
    setCarregandoDossieId(propId);
    try {
      const dossie = await carregarDossieDeAprovacao(propId);
      setDossies((atual) => ({ ...atual, [propId]: dossie }));
      return dossie;
    } catch (err) {
      // O servidor responde 403 aqui para quem não é aprovador designado - a mensagem dele é a
      // prova de que o gate não é só de tela, então ela é mostrada como veio.
      alert(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setCarregandoDossieId(null);
    }
  };

  const abrirDossie = async (propId: string) => {
    const dossie = await obterDossie(propId);
    if (dossie) setDossieAberto(propId);
  };

  const abrirAprovacao = async (propId: string, stage: any) => {
    const dossie = await obterDossie(propId);
    if (dossie) setAprovando({ propId, stage });
  };

  const abrirRejeicao = async (propId: string, stage: any) => {
    const dossie = await obterDossie(propId);
    if (dossie) setRejeitando({ propId, stage });
  };

  const registrarDecisao = async (
    propId: string,
    stage: any,
    decision: "approved" | "rejected",
    items?: (ItemDeRejeicaoNaTela & { section_snapshot: string | null })[]
  ) => {
    const key = decisionKey(propId, stage.id);
    const comments = (decisionComments[key] || "").trim();
    setSubmittingDecisionKey(key);
    try {
      const ok = await handleApprovalDecision(propId, stage, decision, comments, items);
      if (ok) {
        // Só limpa se o servidor ACEITOU - numa recusa (400 por motivo vazio, 403 por aprovador
        // errado, 409 por decisão duplicada) o texto que o aprovador escreveu fica onde estava.
        setDecisionComments((prev) => { const next = { ...prev }; delete next[key]; return next; });
        setDossies((atual) => { const next = { ...atual }; delete next[propId]; return next; });
        setRejeitando(null);
        setAprovando(null);
      }
    } finally {
      setSubmittingDecisionKey(null);
    }
  };

  const resumoDaAprovacao = (propId: string, stage: any): ResumoDaAprovacao | null => {
    const dossie = dossies[propId];
    if (!dossie) return null;
    const todosOsApontamentos = [
      ...(dossie.pareceres.run?.opinions.flatMap((o) => o.findings) ?? []),
      ...(dossie.pareceres.rodada_do_aprovador?.findings ?? []),
    ];
    return {
      proposalLabel: `${dossie.proposal.project_name} · ${dossie.proposal.id}`,
      version: dossie.proposal.version,
      stageName: stage?.name || stage?.id || "",
      apontamentosAbertos: todosOsApontamentos.filter((f) => f.status === "aberto" || f.status === "em_tratativa").length,
      apontamentosAceitosComRisco: todosOsApontamentos.filter((f) => f.status === "aceito_com_risco").length,
      verificacoesBloqueantes: dossie.verificacoes.bloqueantes,
      verificacoesTotal: dossie.verificacoes.total,
      verificacoesDisponiveis: dossie.verificacoes.disponivel,
    };
  };

  return (
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-light text-slate-900">{locale === "pt" ? "Fluxo de Aprovação de Pré-Vendas Corporativo" : "Enterprise Pre-Sales Approval Pipeline"}</h2>
                <span className="text-xs text-slate-400">{locale === "pt" ? "Valide limites comerciais, margens e conformidade técnica antes do envio" : "Validate commercial limits, margins and technical compliance before submission"}</span>
              </div>

              {/* Dynamic list of proposals and their approval workflow milestones */}
              {proposals.length === 0 ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center py-16">
                  <TriangleAlert className="text-warning-500 mx-auto mb-2" size={32} />
                  <h4 className="text-sm font-bold text-slate-800 uppercase font-mono">{locale === "pt" ? "Nenhuma Proposta Enviada" : "No Proposals Submitted"}</h4>
                </div>
              ) : (
                <div className="space-y-6">
                  {proposals.map(prop => {
                    const workflow = (Array.isArray(approvalWorkflows) ? approvalWorkflows : []).find(w => w.id === prop.approval_workflow_id);
                    return (
                      <div key={prop.id} className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex flex-col gap-4">
                        <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                          <div>
                            <span className="text-xs font-bold font-mono text-slate-400">{locale === "pt" ? "ID DE REFERÊNCIA DA PROPOSTA:" : "PROPOSAL REFERENCE ID:"} {prop.id}</span>
                            {/* PreSales F8: a versão era o literal "v1.0" no código - toda proposta
                                aparecia como v1 mesmo depois de reaberta. Agora sai o `version` real
                                da linha, e a v2+ ainda diz de qual versão rejeitada ela nasceu. */}
                            <h3 className="text-sm font-bold text-slate-800 uppercase font-mono mt-0.5">
                              {prop.proposal_type === "technical" ? (locale === "pt" ? "TÉCNICA" : "TECHNICAL") : (locale === "pt" ? "COMERCIAL" : "COMMERCIAL")} PROPOSAL BID v{prop.version}
                            </h3>
                            {prop.previous_version_id && (
                              <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                                {locale === "pt" ? "Versão anterior (rejeitada):" : "Previous version (rejected):"} {prop.previous_version_id}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {/* F8: o DOSSIÊ. Antes desta fase o aprovador decidia sobre um id: a tela
                                não mostrava o documento, nem os pareceres, nem as verificações. */}
                            <button
                              onClick={() => abrirDossie(prop.id)}
                              disabled={carregandoDossieId === prop.id}
                              className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[10px] font-bold px-2.5 py-1.5 rounded cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-brand-500"
                            >
                              <FolderOpen size={12} />
                              {carregandoDossieId === prop.id
                                ? (locale === "pt" ? "Abrindo..." : "Opening...")
                                : (locale === "pt" ? "Abrir dossiê" : "Open dossier")}
                            </button>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                              prop.status === "released" ? "text-brand-700 bg-brand-50 border-brand-200" :
                              prop.status === "approved" ? "text-success-700 bg-success-50 border-success-200" :
                              prop.status === "submitted" ? "text-warning-700 bg-warning-50 border-warning-200" :
                              prop.status === "rejected" ? "text-danger-700 bg-danger-50 border-danger-200" :
                              "text-slate-700 bg-slate-100 border-slate-200"
                            }`}>
                              {locale === "pt" ? (
                                prop.status === "released" ? "LIBERADA" :
                                prop.status === "approved" ? "APROVADA" :
                                prop.status === "submitted" ? "ENVIADA" :
                                prop.status === "rejected" ? "REJEITADA" : "RASCUNHO"
                              ) : prop.status}
                            </span>
                          </div>
                        </div>

                        {prop.status === "approved" && hasPermission("proposal:approve") && (
                          <div className="flex justify-end">
                            <button
                              onClick={() => handleReleaseProposal(prop.id)}
                              className="bg-brand-600 hover:bg-brand-700 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all cursor-pointer"
                            >
                              {locale === "pt" ? "Liberar Versão Final" : "Release Final Version"}
                            </button>
                          </div>
                        )}

                        {/* Approval Stage Timeline */}
                        {workflow && (
                          <div className="space-y-4">
                            <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono">{locale === "pt" ? "Checklist de Etapas de Aprovação:" : "Milestone Approval Stages Checklist:"}</h4>

                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                              {workflow.stages.map((stage) => {
                                const matchedDecision = (Array.isArray(approvalDecisions) ? approvalDecisions : []).find(d => d.proposal_id === prop.id && d.stage_id === stage.id);
                                return (
                                  <div key={stage.id} className={`p-4 rounded-lg border ${
                                    matchedDecision ? (matchedDecision.decision === "approved" ? "bg-success-50/50 border-success-200" : "bg-danger-50/50 border-danger-200") : "bg-slate-50 border-slate-200"
                                  }`}>
                                    <div className="flex justify-between items-start mb-2">
                                      <span className="text-[10px] font-mono text-slate-400 uppercase font-bold">{locale === "pt" ? "Etapa" : "Stage"} {stage.order}</span>
                                      {matchedDecision ? (
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                                          matchedDecision.decision === "approved" ? "text-success-700 bg-success-50" : "text-danger-700 bg-danger-50"
                                        }`}>{matchedDecision.decision}</span>
                                      ) : (
                                        <span className="text-[9px] font-bold bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded uppercase">{tx("PENDING", "PENDENTE")}</span>
                                      )}
                                    </div>
                                    <h5 className="text-xs font-bold text-slate-800 uppercase leading-none font-mono mb-1">{stage.name}</h5>
                                    <p className="text-[11px] text-slate-500 leading-snug">{tx("Approver Target", "Aprovador Alvo")}: <span className="font-semibold">{getApprovalStageTargetLabel(stage)}</span></p>

                                    {/* Action inside timeline stage */}
                                    {!matchedDecision && prop.status === "submitted" && canReviewApprovalStage(stage) && (() => {
                                      const key = decisionKey(prop.id, stage.id);
                                      const draft = decisionComments[key] || "";
                                      const busy = submittingDecisionKey === key || carregandoDossieId === prop.id;
                                      const textareaId = `approval-comment-${key.replace("::", "-")}`;
                                      return (
                                        <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
                                          <label htmlFor={textareaId} className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 block">
                                            {locale === "pt" ? "Parecer do aprovador" : "Approver comments"}
                                            <span className="text-danger-700 ml-1">
                                              {locale === "pt" ? "(obrigatório para rejeitar)" : "(required to reject)"}
                                            </span>
                                          </label>
                                          <textarea
                                            id={textareaId}
                                            value={draft}
                                            onChange={(e) => setDecisionComments((prev) => ({ ...prev, [key]: e.target.value }))}
                                            rows={3}
                                            disabled={busy}
                                            placeholder={locale === "pt"
                                              ? "Descreva o que foi verificado, ou o que precisa ser corrigido nesta proposta."
                                              : "Describe what was verified, or what has to be fixed in this proposal."}
                                            className="w-full text-[11px] leading-snug p-2 rounded border border-slate-200 bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 disabled:bg-slate-100 disabled:text-slate-400"
                                          />
                                          <div className="flex gap-2">
                                            {/* F8: os dois botões passaram a ABRIR UM POPUP, e não a
                                                gravar direto. Aprovar mostra o que está sendo
                                                aprovado; rejeitar abre a rejeição por seção. O
                                                "Rejeitar" não é mais desabilitado por falta de
                                                motivo - o motivo agora se escreve no popup, e é lá
                                                (e no servidor) que ele é exigido. */}
                                            <button
                                              onClick={() => abrirAprovacao(prop.id, stage)}
                                              disabled={busy}
                                              className="bg-success-700 hover:bg-success-800 text-white font-mono text-[10px] font-bold py-2 px-3.5 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-brand-500"
                                            >
                                              {locale === "pt" ? "Aprovar" : "Approve"}
                                            </button>
                                            <button
                                              onClick={() => abrirRejeicao(prop.id, stage)}
                                              disabled={busy}
                                              className="bg-danger-700 hover:bg-danger-800 text-white font-mono text-[10px] font-bold py-2 px-3.5 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-brand-500"
                                            >
                                              {locale === "pt" ? "Rejeitar" : "Reject"}
                                            </button>
                                          </div>
                                          <p className="text-[10px] text-slate-500 leading-snug">
                                            {locale === "pt"
                                              ? "Rejeitar abre a tela de apontamento por seção: cada seção apontada vira um apontamento aberto na próxima versão."
                                              : "Rejecting opens the per-section flagging screen: each flagged section becomes an open finding in the next version."}
                                          </p>
                                        </div>
                                      );
                                    })()}

                                    {matchedDecision && (
                                      <p className="text-[11px] text-slate-600 italic mt-2 border-t border-slate-100 pt-1.5">
                                        "{matchedDecision.comments}"
                                      </p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                      </div>
                    );
                  })}
                </div>
              )}

              {dossieAberto && dossies[dossieAberto] && (
                <ApprovalDossierModal locale={locale} dossie={dossies[dossieAberto]} onClose={() => setDossieAberto(null)} />
              )}

              {rejeitando && dossies[rejeitando.propId] && (
                <RejectionModal
                  locale={locale}
                  proposalLabel={`${dossies[rejeitando.propId].proposal.project_name} · v${dossies[rejeitando.propId].proposal.version}`}
                  stageName={rejeitando.stage?.name || ""}
                  secoes={dossies[rejeitando.propId].secoes}
                  comments={decisionComments[decisionKey(rejeitando.propId, rejeitando.stage.id)] || ""}
                  onCommentsChange={(value) =>
                    setDecisionComments((prev) => ({ ...prev, [decisionKey(rejeitando.propId, rejeitando.stage.id)]: value }))
                  }
                  submitting={submittingDecisionKey === decisionKey(rejeitando.propId, rejeitando.stage.id)}
                  onCancel={() => setRejeitando(null)}
                  onConfirm={(items) => registrarDecisao(rejeitando.propId, rejeitando.stage, "rejected", items)}
                />
              )}

              {aprovando && resumoDaAprovacao(aprovando.propId, aprovando.stage) && (
                <ApprovalConfirmModal
                  locale={locale}
                  resumo={resumoDaAprovacao(aprovando.propId, aprovando.stage)!}
                  comments={decisionComments[decisionKey(aprovando.propId, aprovando.stage.id)] || ""}
                  submitting={submittingDecisionKey === decisionKey(aprovando.propId, aprovando.stage.id)}
                  onCancel={() => setAprovando(null)}
                  onConfirm={() => registrarDecisao(aprovando.propId, aprovando.stage, "approved")}
                />
              )}

              {/* `currentSessionUser` continua chegando por prop e é a identidade que o servidor usa
                  nos cabeçalhos da chamada - mantida aqui para o contrato do componente não mudar
                  silenciosamente enquanto a regra migrava para o endpoint. */}
              <span className="hidden" data-current-user={currentSessionUser.id} data-current-role={currentSessionUser.role_id} />
            </div>
  );
}
