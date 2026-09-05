/*
 * F8: O POPUP DE CONFIRMAÇÃO AO APROVAR, mostrando O QUE está sendo aprovado.
 *
 * Aprovar é o clique irreversível deste produto: a decisão é gravada, a rota recusa a segunda com
 * 409, e quando todas as etapas obrigatórias aprovam a proposta muda de status e viaja para o CRM.
 * Até aqui, ele era um botão de 9px ao lado de outro botão de 9px.
 *
 * O que este popup mostra é o RESUMO DO DOSSIÊ, não uma pergunta genérica: qual proposta, qual
 * versão, qual etapa, quantos apontamentos ainda estão abertos, quantos foram aceitos com risco (e
 * portanto seguem valendo como risco assumido), quantas verificações determinísticas estão
 * bloqueantes, e o parecer que a pessoa digitou.
 *
 * A APROVAÇÃO NÃO LEVA RESSALVA - decisão da rodada. Não há caixa de condição aqui de propósito:
 * uma "aprovação com ressalva" é uma rejeição que ninguém vai tratar, porque nada no fluxo obriga
 * a voltar a ela. O que precisa mudar, rejeita - e aí a ressalva vira item de seção, que nasce
 * como apontamento aberto na v2 e barra o reenvio até ser tratado.
 */
import { X, TriangleAlert, CircleCheck } from "lucide-react";

export interface ResumoDaAprovacao {
  proposalLabel: string;
  version: number;
  stageName: string;
  apontamentosAbertos: number;
  apontamentosAceitosComRisco: number;
  verificacoesBloqueantes: number;
  verificacoesTotal: number;
  verificacoesDisponiveis: boolean;
}

interface ApprovalConfirmModalProps {
  locale: "en" | "pt";
  resumo: ResumoDaAprovacao;
  comments: string;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function Linha({ rotulo, valor, alerta }: { rotulo: string; valor: string; alerta: boolean }) {
  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded border ${alerta ? "bg-warning-50 border-warning-200" : "bg-slate-50 border-slate-200"}`}>
      <span className="text-[11px] text-slate-600">{rotulo}</span>
      <span className={`text-[11px] font-bold font-mono ${alerta ? "text-warning-800" : "text-slate-700"}`}>{valor}</span>
    </div>
  );
}

export default function ApprovalConfirmModal({ locale, resumo, comments, submitting, onCancel, onConfirm }: ApprovalConfirmModalProps) {
  const temAlerta = resumo.apontamentosAbertos > 0 || resumo.apontamentosAceitosComRisco > 0 || resumo.verificacoesBloqueantes > 0;

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col">
        <div className="flex items-start justify-between p-4 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-success-800">
              {locale === "pt" ? "Confirmar aprovação" : "Confirm approval"}
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">{resumo.proposalLabel}</p>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-700 cursor-pointer" title={locale === "pt" ? "Cancelar" : "Cancel"}>
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-2">
          <p className="text-[12px] text-slate-700 leading-snug mb-2">
            {locale === "pt" ? "Você está aprovando:" : "You are approving:"}
          </p>

          <Linha rotulo={locale === "pt" ? "Versão do documento" : "Document version"} valor={`v${resumo.version}`} alerta={false} />
          <Linha rotulo={locale === "pt" ? "Etapa do fluxo" : "Workflow stage"} valor={resumo.stageName} alerta={false} />
          <Linha
            rotulo={locale === "pt" ? "Apontamentos ainda abertos" : "Findings still open"}
            valor={String(resumo.apontamentosAbertos)}
            alerta={resumo.apontamentosAbertos > 0}
          />
          <Linha
            rotulo={locale === "pt" ? "Aceitos com risco (risco assumido)" : "Accepted with risk"}
            valor={String(resumo.apontamentosAceitosComRisco)}
            alerta={resumo.apontamentosAceitosComRisco > 0}
          />
          <Linha
            rotulo={locale === "pt" ? "Verificações bloqueantes" : "Blocking checks"}
            valor={
              resumo.verificacoesDisponiveis
                ? `${resumo.verificacoesBloqueantes} / ${resumo.verificacoesTotal}`
                : locale === "pt" ? "não conferido" : "not checked"
            }
            alerta={resumo.verificacoesBloqueantes > 0}
          />

          <div className="mt-3 pt-3 border-t border-slate-100">
            <p className="text-[10px] font-mono uppercase text-slate-400 mb-1">
              {locale === "pt" ? "Seu parecer" : "Your comments"}
            </p>
            <p className="text-[11px] text-slate-600 italic leading-snug">
              {comments.trim().length > 0
                ? `"${comments.trim()}"`
                : locale === "pt"
                  ? "(sem parecer — a aprovação aceita comentário vazio)"
                  : "(no comments — approval accepts an empty comment)"}
            </p>
          </div>

          <div className={`flex items-start gap-2 mt-3 p-3 rounded border ${temAlerta ? "bg-warning-50 border-warning-200" : "bg-success-50 border-success-200"}`}>
            {temAlerta ? (
              <TriangleAlert className="text-warning-700 shrink-0 mt-0.5" size={14} />
            ) : (
              <CircleCheck className="text-success-700 shrink-0 mt-0.5" size={14} />
            )}
            <p className="text-[11px] leading-snug text-slate-700">
              {locale === "pt"
                ? "A aprovação não leva ressalva: ela é registrada como está. Se algo precisa mudar, rejeite apontando a seção — o item vira apontamento aberto na próxima versão."
                : "Approval carries no caveat: it is recorded as is. If something has to change, reject flagging the section instead."}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 font-mono text-[11px] font-bold px-3 py-1.5 rounded cursor-pointer disabled:opacity-50"
          >
            {locale === "pt" ? "Cancelar" : "Cancel"}
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            className="bg-success-700 hover:bg-success-800 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded cursor-pointer disabled:opacity-50"
          >
            {submitting
              ? locale === "pt" ? "Registrando..." : "Recording..."
              : locale === "pt" ? "Confirmar aprovação" : "Confirm approval"}
          </button>
        </div>
      </div>
    </div>
  );
}
