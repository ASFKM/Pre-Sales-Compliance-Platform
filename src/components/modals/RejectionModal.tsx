/*
 * F8: A REJEIÇÃO ESTRUTURADA POR SEÇÃO.
 *
 * Antes desta rodada, rejeitar era escrever um texto corrido numa caixa. O vendedor recebia a
 * recusa e tinha de adivinhar QUAL parágrafo do documento o aprovador tinha em mente. Aqui ele
 * escolhe a seção, o TEXTO ATUAL dela aparece ao lado, e o comentário vai embaixo - vários itens
 * por rejeição, porque uma proposta raramente volta por um motivo só.
 *
 * O RESUMO CONTINUA OBRIGATÓRIO. `ApprovalDecision.comments` é o que o vendedor lê primeiro e o
 * servidor recusa a rejeição sem ele com 400 (server/utils/approvalDecision.ts, provado por teste
 * unitário e pelo script de regressão). Os itens são o "onde"; o resumo é o "o quê". A trava desta
 * tela é só cortesia - a validação real é a de lá.
 *
 * O RETRATO DA SEÇÃO viaja junto (`section_snapshot`): é o texto que o aprovador tinha na frente
 * quando escreveu. Na v2 essa seção vai mudar - é para isso que a v2 existe - e sem o retrato quem
 * ler o apontamento depois da primeira edição não saberá mais a que texto ele se referia.
 */
import { useState } from "react";
import { X, Plus, Trash2, TriangleAlert } from "lucide-react";
import { DossieSecao } from "../../lib/approvalDossier";
import { useModalDialog } from "../../hooks/useModalDialog";

export interface ItemDeRejeicaoNaTela {
  target_kind: "proposal_field" | "template_field" | "geral";
  target_key: string;
  comment: string;
}

interface RejectionModalProps {
  locale: "en" | "pt";
  proposalLabel: string;
  stageName: string;
  secoes: DossieSecao[];
  comments: string;
  onCommentsChange: (value: string) => void;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (items: (ItemDeRejeicaoNaTela & { section_snapshot: string | null })[]) => void;
}

const ALVO_GERAL = "__geral__";

export default function RejectionModal({
  locale, proposalLabel, stageName, secoes, comments, onCommentsChange, submitting, onCancel, onConfirm,
}: RejectionModalProps) {
  const [itens, setItens] = useState<ItemDeRejeicaoNaTela[]>([]);
  const refModal = useModalDialog<HTMLDivElement>(onCancel);

  const chaveDaSecao = (s: DossieSecao) => `${s.target_kind}:${s.target_key}`;
  const secaoPorChave = (chave: string) => secoes.find((s) => chaveDaSecao(s) === chave) ?? null;

  const adicionarItem = () => {
    const primeira = secoes[0];
    setItens((atual) => [
      ...atual,
      primeira
        ? { target_kind: primeira.target_kind as ItemDeRejeicaoNaTela["target_kind"], target_key: primeira.target_key, comment: "" }
        : { target_kind: "geral", target_key: "", comment: "" },
    ]);
  };

  const atualizarItem = (i: number, patch: Partial<ItemDeRejeicaoNaTela>) => {
    setItens((atual) => atual.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  };

  const removerItem = (i: number) => setItens((atual) => atual.filter((_, idx) => idx !== i));

  const resumoPreenchido = comments.trim().length > 0;
  const itensIncompletos = itens.some((i) => i.comment.trim().length === 0);
  const podeConfirmar = resumoPreenchido && !itensIncompletos && !submitting;

  const confirmar = () => {
    const comSnapshot = itens.map((item) => {
      if (item.target_kind === "geral") return { ...item, target_key: "", section_snapshot: null };
      const secao = secaoPorChave(`${item.target_kind}:${item.target_key}`);
      return { ...item, section_snapshot: secao?.texto_atual ?? null };
    });
    onConfirm(comSnapshot);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div
        ref={refModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rejeicao-titulo"
        tabIndex={-1}
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col focus:outline-none"
      >
        <div className="flex items-start justify-between p-4 border-b border-slate-100">
          <div>
            <h3 id="rejeicao-titulo" className="text-sm font-bold uppercase tracking-wider font-mono text-danger-700">
              {locale === "pt" ? "Rejeitar proposta" : "Reject proposal"}
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {proposalLabel} · {stageName}
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label={locale === "pt" ? "Cancelar a rejeição" : "Cancel the rejection"}
            title={locale === "pt" ? "Cancelar" : "Cancel"}
            className="-m-1.5 p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <label htmlFor="rejection-summary" className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 block mb-1.5">
              {locale === "pt" ? "Resumo da rejeição" : "Rejection summary"}
              <span className="text-danger-700 ml-1">{locale === "pt" ? "(obrigatório)" : "(required)"}</span>
            </label>
            <textarea
              id="rejection-summary"
              value={comments}
              onChange={(e) => onCommentsChange(e.target.value)}
              rows={3}
              disabled={submitting}
              placeholder={locale === "pt" ? "Em uma frase: por que esta proposta volta." : "In one sentence: why this proposal is going back."}
              className="w-full text-xs leading-snug p-2 rounded border border-slate-200 bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 disabled:bg-slate-100"
            />
            {!resumoPreenchido && (
              <p className="text-[10px] text-slate-500 mt-1 leading-snug">
                {locale === "pt"
                  ? "Sem resumo a rejeição não é aceita pelo servidor: é a primeira coisa que o vendedor lê."
                  : "Without a summary the server rejects this: it is the first thing the seller reads."}
              </p>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">
                {locale === "pt" ? "Seções apontadas" : "Flagged sections"}{" "}
                <span className="text-slate-400">({itens.length})</span>
              </h4>
              <button
                onClick={adicionarItem}
                disabled={submitting}
                className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[10px] font-bold px-2 py-1 rounded cursor-pointer disabled:opacity-50"
              >
                <Plus size={12} />
                {locale === "pt" ? "Apontar seção" : "Flag a section"}
              </button>
            </div>

            {itens.length === 0 ? (
              <p className="text-[11px] text-slate-400 leading-snug">
                {locale === "pt"
                  ? "Opcional. Cada seção apontada aqui vira um apontamento aberto na próxima versão, tratável como qualquer outro."
                  : "Optional. Each section flagged here becomes an open finding in the next version."}
              </p>
            ) : (
              <div className="space-y-3">
                {itens.map((item, i) => {
                  const chaveAtual = item.target_kind === "geral" ? ALVO_GERAL : `${item.target_kind}:${item.target_key}`;
                  const secao = item.target_kind === "geral" ? null : secaoPorChave(chaveAtual);
                  return (
                    <div key={i} className="border border-slate-200 rounded-lg p-2.5 bg-slate-50">
                      <div className="flex items-center gap-2 mb-2">
                        <select
                          value={chaveAtual}
                          onChange={(e) => {
                            if (e.target.value === ALVO_GERAL) {
                              atualizarItem(i, { target_kind: "geral", target_key: "" });
                              return;
                            }
                            const escolhida = secaoPorChave(e.target.value);
                            if (escolhida) {
                              atualizarItem(i, {
                                target_kind: escolhida.target_kind as ItemDeRejeicaoNaTela["target_kind"],
                                target_key: escolhida.target_key,
                              });
                            }
                          }}
                          disabled={submitting}
                          aria-label={locale === "pt" ? `Seção apontada no item ${i + 1}` : `Flagged section in item ${i + 1}`}
                          className="flex-1 text-[11px] p-1.5 rounded border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                        >
                          {secoes.map((s) => (
                            <option key={chaveDaSecao(s)} value={chaveDaSecao(s)}>
                              {s.target_key} {s.label && s.label !== s.target_key ? `— ${s.label}` : ""}
                            </option>
                          ))}
                          <option value={ALVO_GERAL}>{locale === "pt" ? "Geral (não é de uma seção)" : "General (not a section)"}</option>
                        </select>
                        <button
                          onClick={() => removerItem(i)}
                          disabled={submitting}
                          aria-label={locale === "pt" ? `Remover o item ${i + 1}` : `Remove item ${i + 1}`}
                          title={locale === "pt" ? "Remover item" : "Remove item"}
                          className="-m-1.5 p-1.5 rounded text-slate-400 hover:text-danger-600 hover:bg-slate-100 cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      {/* O texto ATUAL da seção, ao lado do comentário - é ele que o aprovador está
                          criticando, e escrever sem vê-lo produz apontamento genérico. */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div>
                          <p className="text-[9px] font-mono uppercase text-slate-400 mb-1">
                            {locale === "pt" ? "Texto atual" : "Current text"}
                          </p>
                          <div className="text-[11px] leading-snug text-slate-600 bg-white border border-slate-200 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-line">
                            {item.target_kind === "geral"
                              ? locale === "pt" ? "— (não se prende a uma seção)" : "— (not tied to a section)"
                              : secao?.texto_atual?.trim()
                                ? secao.texto_atual
                                : locale === "pt" ? "(esta seção está vazia)" : "(this section is empty)"}
                          </div>
                        </div>
                        <div>
                          <p className="text-[9px] font-mono uppercase text-slate-400 mb-1">
                            {locale === "pt" ? "O que precisa mudar" : "What has to change"}
                          </p>
                          <textarea
                            value={item.comment}
                            onChange={(e) => atualizarItem(i, { comment: e.target.value })}
                            rows={5}
                            disabled={submitting}
                            placeholder={locale === "pt" ? "Descreva o problema desta seção." : "Describe the problem with this section."}
                            aria-label={locale === "pt" ? `O que precisa mudar no item ${i + 1}` : `What has to change in item ${i + 1}`}
                            className="w-full text-[11px] leading-snug p-2 rounded border border-slate-200 bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-100"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {itens.length > 0 && (
            <div className="flex items-start gap-2 text-[11px] text-slate-600 bg-white border border-slate-200 rounded-lg p-3">
              <TriangleAlert className="text-warning-600 shrink-0 mt-0.5" size={14} />
              <p className="leading-snug">
                {locale === "pt"
                  ? `Ao reabrir esta proposta, ${itens.length} apontamento(s) crítico(s) nascerão abertos na versão nova, e ela não volta para aprovação enquanto cada um não for tratado — resolvido, descartado ou aceito com risco, com justificativa.`
                  : `When this proposal is reopened, ${itens.length} critical finding(s) will be created open in the new version, and it cannot be resubmitted until each is handled.`}
              </p>
            </div>
          )}
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
            onClick={confirmar}
            disabled={!podeConfirmar}
            title={
              !resumoPreenchido
                ? locale === "pt" ? "Escreva o resumo da rejeição" : "Write the rejection summary"
                : itensIncompletos
                  ? locale === "pt" ? "Há item de seção sem comentário" : "There is a section item without a comment"
                  : undefined
            }
            className="bg-danger-700 hover:bg-danger-800 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting
              ? locale === "pt" ? "Registrando..." : "Recording..."
              : locale === "pt" ? "Confirmar rejeição" : "Confirm rejection"}
          </button>
        </div>
      </div>
    </div>
  );
}
