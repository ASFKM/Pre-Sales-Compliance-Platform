import { TriangleAlert } from "lucide-react";
import { ApprovalWorkflow, Proposal } from "../types";
import { useApprovalCenter } from "../hooks/useApprovalCenter";

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
  fetchGlobalConfigs: () => Promise<void> | void;
  fetchProjectDetails: (projectId: string) => Promise<void> | void;
  handleReleaseProposal: (propId: string) => void;
}

export default function Approval({
  locale, tx, hasPermission, currentSessionUser, proposals, approvalWorkflows, approvalDecisions,
  users, roles, selectedProjectId, fetchGlobalConfigs, fetchProjectDetails, handleReleaseProposal,
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

  const canReviewApprovalStage = (stage: any) => {
    if (!stage || !currentSessionUser.id || !currentSessionUser.role_id) return false;

    if (stage.approver_type === "user") {
      return stage.approver_user_id === currentSessionUser.id;
    }

    return stage.approver_role_id === currentSessionUser.role_id;
  };

  const { handleApprovalDecision } = useApprovalCenter({
    locale, selectedProjectId, fetchGlobalConfigs, fetchProjectDetails, canReviewApprovalStage,
  });

  return (
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-light text-slate-900">{locale === "pt" ? "Fluxo de Aprovação de Pré-Vendas Corporativo" : "Enterprise Pre-Sales Approval Pipeline"}</h2>
                <span className="text-xs text-slate-400">{locale === "pt" ? "Valide limites comerciais, margens e conformidade técnica antes do envio" : "Validate commercial limits, margins and technical compliance before submission"}</span>
              </div>

              {/* Dynamic list of proposals and their approval workflow milestones */}
              {proposals.length === 0 ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center py-16">
                  <TriangleAlert className="text-amber-500 mx-auto mb-2" size={32} />
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
                            <h3 className="text-sm font-bold text-slate-800 uppercase font-mono mt-0.5">{prop.proposal_type === "technical" ? (locale === "pt" ? "TÉCNICA" : "TECHNICAL") : (locale === "pt" ? "COMERCIAL" : "COMMERCIAL")} PROPOSAL BID v1.0</h3>
                          </div>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                            prop.status === "released" ? "text-purple-700 bg-purple-50 border-purple-200" :
                            prop.status === "approved" ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
                            prop.status === "submitted" ? "text-blue-700 bg-blue-50 border-blue-200" :
                            prop.status === "rejected" ? "text-red-700 bg-red-50 border-red-200" :
                            "text-amber-700 bg-amber-50 border-amber-200"
                          }`}>
                            {locale === "pt" ? (
                              prop.status === "released" ? "LIBERADA" :
                              prop.status === "approved" ? "APROVADA" :
                              prop.status === "submitted" ? "ENVIADA" :
                              prop.status === "rejected" ? "REJEITADA" : "RASCUNHO"
                            ) : prop.status}
                          </span>
                        </div>

                        {prop.status === "approved" && hasPermission("proposal:approve") && (
                          <div className="flex justify-end">
                            <button
                              onClick={() => handleReleaseProposal(prop.id)}
                              className="bg-purple-600 hover:bg-purple-700 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all cursor-pointer"
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
                                    matchedDecision ? (matchedDecision.decision === "approved" ? "bg-emerald-50/50 border-emerald-200" : "bg-red-50/50 border-red-200") : "bg-slate-50 border-slate-200"
                                  }`}>
                                    <div className="flex justify-between items-start mb-2">
                                      <span className="text-[10px] font-mono text-slate-400 uppercase font-bold">{locale === "pt" ? "Etapa" : "Stage"} {stage.order}</span>
                                      {matchedDecision ? (
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                                          matchedDecision.decision === "approved" ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50"
                                        }`}>{matchedDecision.decision}</span>
                                      ) : (
                                        <span className="text-[9px] font-bold bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded uppercase">{tx("PENDING", "PENDENTE")}</span>
                                      )}
                                    </div>
                                    <h5 className="text-xs font-bold text-slate-800 uppercase leading-none font-mono mb-1">{stage.name}</h5>
                                    <p className="text-[11px] text-slate-500 leading-snug">{tx("Approver Target", "Aprovador Alvo")}: <span className="font-semibold">{getApprovalStageTargetLabel(stage)}</span></p>

                                    {/* Action inside timeline stage */}
                                    {!matchedDecision && prop.status === "submitted" && canReviewApprovalStage(stage) && (
                                      <div className="mt-3 pt-3 border-t border-slate-200 flex gap-1">
                                        <button
                                          onClick={() => handleApprovalDecision(prop.id, stage, "approved", "Pre-Sales specs verified and margins approved.")}
                                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-[9px] font-bold py-1 px-2 rounded cursor-pointer"
                                        >
                                          Approve
                                        </button>
                                        <button
                                          onClick={() => handleApprovalDecision(prop.id, stage, "rejected", "Requires compliance revision.")}
                                          className="bg-red-600 hover:bg-red-700 text-white font-mono text-[9px] font-bold py-1 px-2 rounded cursor-pointer"
                                        >
                                          Reject
                                        </button>
                                      </div>
                                    )}

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
            </div>
  );
}
