/*
 * F8: O DOSSIÊ DO APROVADOR, em quatro abas.
 *
 * O problema que ele resolve: até esta fase o Centro de Aprovação mostrava ao aprovador o
 * cabeçalho da proposta, os estágios do workflow e uma caixa de texto. Não mostrava o DOCUMENTO,
 * nem os pareceres, nem os apontamentos e suas tratativas, nem as verificações determinísticas,
 * nem o histórico de versões. Aprovar era assinar um id.
 *
 * As quatro abas, e o que cada uma responde:
 *   - DOCUMENTO ....... "o que estou aprovando?" - o binário real, pelo mesmo preview do Estúdio.
 *   - PARECERES ....... "o que foi apontado, e o que fizeram a respeito?" - as perspectivas de IA
 *                       com seus apontamentos, o status de cada um, a justificativa de quem o
 *                       fechou e o veredito consultivo de sanação da F7. E, quando existe, a
 *                       rodada do APROVADOR: os itens que ele mesmo escreveu na rejeição anterior.
 *   - VERIFICAÇÕES .... "o documento está íntegro?" - a conferência determinística (GET /revisao),
 *                       sem IA nenhuma: placeholder não substituído, soma que não fecha, item do
 *                       BOM ausente. Continua determinística de propósito.
 *   - VERSÕES ......... "como chegamos até aqui?" - a cadeia inteira do grupo, as decisões de cada
 *                       versão com os itens que cada rejeição apontou, e as edições de seção desta
 *                       versão com o apontamento que motivou cada uma.
 *
 * Tudo vem de UMA chamada (GET /proposals/:id/dossie-de-aprovacao), que tem gate próprio no
 * servidor - esconder o botão do menu é conveniência de tela, o gate é lá.
 */
import { useEffect, useState } from "react";
import { X, FileText, MessagesSquare, ListChecks, History, TriangleAlert, CircleCheck } from "lucide-react";
import {
  DossieDeAprovacao,
  DossieFinding,
  ROTULO_DE_STATUS,
  ROTULO_DE_PERSPECTIVA,
} from "../../lib/approvalDossier";
import { useDocumentPreview, DocumentFormatSwitch, DocumentPreviewBody } from "../ui/DocumentPreview";

type AbaDoDossie = "documento" | "pareceres" | "verificacoes" | "versoes";

interface ApprovalDossierModalProps {
  locale: "en" | "pt";
  dossie: DossieDeAprovacao;
  onClose: () => void;
}

const ESTILO_DE_STATUS: Record<string, string> = {
  aberto: "text-danger-700 bg-danger-50 border-danger-200",
  em_tratativa: "text-warning-700 bg-warning-50 border-warning-200",
  resolvido: "text-success-700 bg-success-50 border-success-200",
  aceito_com_risco: "text-warning-800 bg-warning-100 border-warning-300",
  descartado: "text-slate-600 bg-slate-100 border-slate-200",
};

const ESTILO_DE_SEVERIDADE: Record<string, string> = {
  critical: "text-danger-700 bg-danger-50 border-danger-200",
  alta: "text-danger-700 bg-danger-50 border-danger-200",
  warning: "text-warning-700 bg-warning-50 border-warning-200",
  media: "text-warning-700 bg-warning-50 border-warning-200",
  info: "text-slate-600 bg-slate-100 border-slate-200",
  baixa: "text-slate-600 bg-slate-100 border-slate-200",
};

function CartaoDeApontamento({ locale, finding }: { locale: "en" | "pt"; finding: DossieFinding }) {
  const rotuloStatus = ROTULO_DE_STATUS[finding.status]?.[locale] ?? finding.status;
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h6 className="text-[12px] font-semibold text-slate-800 leading-snug">{finding.title}</h6>
        <div className="flex items-center gap-1 shrink-0">
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${ESTILO_DE_SEVERIDADE[finding.severity] || ESTILO_DE_SEVERIDADE.info}`}>
            {finding.severity}
          </span>
          {/* O chip de status é um <span> de propósito: a suíte de prova filtra card por ele, e um
              <button> com o mesmo rótulo (os do ciclo, no Estúdio) faria o seletor casar duas vezes. */}
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${ESTILO_DE_STATUS[finding.status] || ESTILO_DE_STATUS.descartado}`}>
            {rotuloStatus}
          </span>
        </div>
      </div>
      {finding.target_key && (
        <p className="text-[10px] font-mono text-slate-400 mb-1">
          {locale === "pt" ? "Seção" : "Section"}: {finding.target_key}
        </p>
      )}
      <p className="text-[11px] text-slate-600 leading-snug whitespace-pre-line">{finding.detail}</p>
      {finding.resolution_note && (
        <p className="text-[11px] text-slate-700 mt-2 pt-2 border-t border-slate-100 italic">
          {locale === "pt" ? "Justificativa registrada" : "Recorded justification"}: "{finding.resolution_note}"
        </p>
      )}
      {finding.remediation_verdict && (
        <p className="text-[10px] font-mono text-brand-700 mt-1.5">
          {locale === "pt" ? "Veredito de sanação (consultivo)" : "Remediation verdict (advisory)"}: {finding.remediation_verdict}
        </p>
      )}
    </div>
  );
}

export default function ApprovalDossierModal({ locale, dossie, onClose }: ApprovalDossierModalProps) {
  const [aba, setAba] = useState<AbaDoDossie>("documento");
  const preview = useDocumentPreview(locale);

  // O documento carrega assim que o dossiê abre, e não ao clicar na aba: ele é a primeira coisa que
  // o aprovador quer ver, e um clique a mais entre ele e o texto é exatamente o atrito que fazia a
  // decisão ser tomada sem olhar.
  useEffect(() => {
    if (dossie.proposal.has_docx) {
      void preview.openPreview(dossie.proposal.id, "docx");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossie.proposal.id]);

  const abas: { id: AbaDoDossie; rotulo: string; icone: typeof FileText; contagem?: number }[] = [
    { id: "documento", rotulo: locale === "pt" ? "Documento" : "Document", icone: FileText },
    {
      id: "pareceres",
      rotulo: locale === "pt" ? "Pareceres e tratativas" : "Opinions and handling",
      icone: MessagesSquare,
      contagem:
        (dossie.pareceres.run?.opinions.reduce((n, o) => n + o.findings.length, 0) ?? 0) +
        (dossie.pareceres.rodada_do_aprovador?.total ?? 0),
    },
    { id: "verificacoes", rotulo: locale === "pt" ? "Verificações" : "Checks", icone: ListChecks, contagem: dossie.verificacoes.total },
    { id: "versoes", rotulo: locale === "pt" ? "Histórico de versões" : "Version history", icone: History, contagem: dossie.versoes.cadeia.length },
  ];

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">
        <div className="flex items-start justify-between p-4 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">
              {locale === "pt" ? "Dossiê da Proposta" : "Proposal Dossier"}
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {dossie.proposal.project_name} · v{dossie.proposal.version} · {dossie.proposal.proposal_type} ·{" "}
              <span className="font-mono">{dossie.proposal.id}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 cursor-pointer" title={locale === "pt" ? "Fechar" : "Close"}>
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-1 px-4 pt-3 border-b border-slate-100 overflow-x-auto">
          {abas.map((a) => {
            const Icone = a.icone;
            return (
              <button
                key={a.id}
                onClick={() => setAba(a.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold border-b-2 whitespace-nowrap cursor-pointer transition-all ${
                  aba === a.id ? "text-brand-700 border-brand-600" : "text-slate-500 border-transparent hover:text-slate-700"
                }`}
              >
                <Icone size={13} />
                {a.rotulo}
                {typeof a.contagem === "number" && (
                  <span className="text-[9px] font-mono bg-slate-100 text-slate-600 rounded px-1 py-0.5">{a.contagem}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50 min-h-[55vh]">
          {/* ─────────── ABA DOCUMENTO ─────────── */}
          {aba === "documento" && (
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-slate-100">
                <span className="text-[10px] font-mono uppercase text-slate-400">
                  {locale === "pt" ? "Documento real exportado" : "Real exported document"}
                </span>
                <DocumentFormatSwitch format={preview.previewFormat} onChange={(fmt) => preview.openPreview(dossie.proposal.id, fmt)} />
              </div>
              <div className="flex-1">
                <DocumentPreviewBody
                  locale={locale}
                  format={preview.previewFormat}
                  docxHtml={preview.previewDocxHtml}
                  pdfUrl={preview.previewPdfUrl}
                  loading={preview.previewLoading}
                  error={preview.previewError}
                  emptyLabel={
                    dossie.proposal.has_docx
                      ? undefined
                      : locale === "pt"
                        ? "Esta proposta ainda não tem documento gerado."
                        : "This proposal has no generated document yet."
                  }
                />
              </div>
            </div>
          )}

          {/* ─────────── ABA PARECERES E TRATATIVAS ─────────── */}
          {aba === "pareceres" && (
            <div className="p-4 space-y-4">
              {dossie.pareceres.rodada_do_aprovador && (
                <div className="border border-warning-300 bg-warning-50/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h5 className="text-[11px] font-bold uppercase font-mono text-warning-800">
                      {locale === "pt" ? "Itens do aprovador (versão anterior)" : "Approver items (previous version)"}
                    </h5>
                    <span className="text-[10px] font-mono text-warning-800">
                      {dossie.pareceres.rodada_do_aprovador.abertos}/{dossie.pareceres.rodada_do_aprovador.total}{" "}
                      {locale === "pt" ? "em aberto" : "open"}
                    </span>
                  </div>
                  {/* Bloco SEPARADO das perspectivas de IA de propósito: um item escrito por uma
                      pessoa não é parecer de modelo, e misturá-los faria a tela contar um como o
                      outro - que é justamente o que o campo `origem` existe para impedir. */}
                  <div className="space-y-2">
                    {dossie.pareceres.rodada_do_aprovador.findings.map((f) => (
                      <CartaoDeApontamento key={f.id} locale={locale} finding={f} />
                    ))}
                  </div>
                </div>
              )}

              {!dossie.pareceres.run && !dossie.pareceres.rodada_do_aprovador && (
                <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
                  <MessagesSquare className="text-slate-300 mx-auto mb-2" size={28} />
                  <p className="text-xs text-slate-500">
                    {locale === "pt"
                      ? "Nenhuma rodada de pareceres foi executada nesta versão da proposta."
                      : "No opinion round has been run on this version of the proposal."}
                  </p>
                </div>
              )}

              {dossie.pareceres.run?.opinions.map((o) => (
                <div key={o.id} className="bg-white border border-slate-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <h5 className="text-[11px] font-bold uppercase font-mono text-slate-700">
                      {ROTULO_DE_PERSPECTIVA[o.perspective]?.[locale] ?? o.perspective}
                    </h5>
                    <span className="text-[9px] font-mono text-slate-400">
                      {o.provider_used}/{o.model_used}
                    </span>
                  </div>
                  <p className="text-[12px] text-slate-700 leading-snug mb-2">{o.summary}</p>
                  {o.findings.length > 0 && (
                    <div className="space-y-2 mt-2 pt-2 border-t border-slate-100">
                      {o.findings.map((f) => (
                        <CartaoDeApontamento key={f.id} locale={locale} finding={f} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ─────────── ABA VERIFICAÇÕES ─────────── */}
          {aba === "verificacoes" && (
            <div className="p-4 space-y-3">
              <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3">
                {dossie.verificacoes.bloqueantes > 0 ? (
                  <TriangleAlert className="text-danger-600 shrink-0" size={20} />
                ) : (
                  <CircleCheck className="text-success-600 shrink-0" size={20} />
                )}
                <div>
                  <p className="text-xs font-semibold text-slate-800">
                    {dossie.verificacoes.total} {locale === "pt" ? "achado(s)" : "finding(s)"} ·{" "}
                    {dossie.verificacoes.bloqueantes} {locale === "pt" ? "bloqueante(s)" : "blocking"}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {locale === "pt"
                      ? "Conferência determinística do documento gerado — sem IA, sem custo."
                      : "Deterministic check of the generated document — no AI, no cost."}
                  </p>
                </div>
              </div>

              {!dossie.verificacoes.disponivel && (
                <div className="bg-white border border-slate-200 rounded-lg p-4 text-xs text-slate-500">
                  {dossie.verificacoes.erro ||
                    (locale === "pt" ? "Esta proposta ainda não tem documento gerado para conferir." : "This proposal has no generated document to check.")}
                </div>
              )}

              {dossie.verificacoes.achados.map((a, i) => (
                <div key={i} className="bg-white border border-slate-200 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12px] text-slate-700 leading-snug">{a.descricao}</p>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase shrink-0 ${ESTILO_DE_SEVERIDADE[a.severidade] || ESTILO_DE_SEVERIDADE.info}`}>
                      {a.severidade}
                    </span>
                  </div>
                  <p className="text-[10px] font-mono text-slate-400 mt-1">{a.tipo}</p>
                </div>
              ))}

              {dossie.verificacoes.disponivel && dossie.verificacoes.total === 0 && (
                <div className="bg-white border border-success-200 rounded-lg p-6 text-center">
                  <CircleCheck className="text-success-600 mx-auto mb-2" size={24} />
                  <p className="text-xs text-slate-600">
                    {locale === "pt" ? "Documento conferido e limpo." : "Document checked and clean."}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ─────────── ABA HISTÓRICO DE VERSÕES ─────────── */}
          {aba === "versoes" && (
            <div className="p-4 space-y-4">
              <div className="bg-white border border-slate-200 rounded-lg p-3">
                <h5 className="text-[11px] font-bold uppercase font-mono text-slate-500 mb-2">
                  {locale === "pt" ? "Cadeia de versões" : "Version chain"}
                </h5>
                <div className="space-y-1.5">
                  {dossie.versoes.cadeia.map((v) => (
                    <div
                      key={v.id}
                      className={`flex items-center justify-between text-[11px] px-2 py-1.5 rounded border ${
                        v.e_a_atual ? "bg-brand-50 border-brand-200" : "bg-slate-50 border-slate-200"
                      }`}
                    >
                      <span className="font-semibold text-slate-700">
                        v{v.version} {v.e_a_atual && <span className="text-[9px] font-mono text-brand-700">({locale === "pt" ? "esta" : "this one"})</span>}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">{v.status}</span>
                      <span className="text-[10px] text-slate-400">{new Date(v.generated_at).toLocaleString(locale === "pt" ? "pt-BR" : "en-US")}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-3">
                <h5 className="text-[11px] font-bold uppercase font-mono text-slate-500 mb-2">
                  {locale === "pt" ? "Decisões registradas" : "Recorded decisions"}
                </h5>
                {dossie.versoes.decisoes.length === 0 ? (
                  <p className="text-[11px] text-slate-400">{locale === "pt" ? "Nenhuma decisão ainda." : "No decision yet."}</p>
                ) : (
                  <div className="space-y-2">
                    {dossie.versoes.decisoes.map((d) => (
                      <div key={d.id} className="border border-slate-200 rounded p-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold text-slate-700">{d.stage_name}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${d.decision === "approved" ? "text-success-700 bg-success-50" : "text-danger-700 bg-danger-50"}`}>
                            {d.decision}
                          </span>
                        </div>
                        <p className="text-[10px] font-mono text-slate-400 mb-1">
                          {d.approver_name} · {new Date(d.created_at).toLocaleString(locale === "pt" ? "pt-BR" : "en-US")}
                        </p>
                        <p className="text-[11px] text-slate-600 italic">"{d.comments}"</p>
                        {d.items.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-slate-100 space-y-1.5">
                            <p className="text-[10px] font-mono uppercase text-slate-400">
                              {locale === "pt" ? "Seções apontadas" : "Sections flagged"} ({d.items.length})
                            </p>
                            {d.items.map((i) => (
                              <div key={i.id} className="text-[11px] bg-slate-50 border border-slate-200 rounded px-2 py-1.5">
                                <span className="font-mono text-[10px] text-brand-700">{i.target_key || "geral"}</span>
                                <p className="text-slate-600 leading-snug">{i.comment}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-3">
                <h5 className="text-[11px] font-bold uppercase font-mono text-slate-500 mb-2">
                  {locale === "pt" ? "Edições de seção nesta versão" : "Section edits in this version"}
                </h5>
                {dossie.versoes.edicoes_de_secao.length === 0 ? (
                  <p className="text-[11px] text-slate-400">{locale === "pt" ? "Nenhuma edição registrada." : "No edit recorded."}</p>
                ) : (
                  <div className="space-y-1.5">
                    {dossie.versoes.edicoes_de_secao.map((e) => (
                      <div key={e.id} className="text-[11px] border border-slate-200 rounded px-2 py-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10px] text-brand-700">{e.target_key || e.target_kind}</span>
                          <span className="text-[9px] font-mono text-slate-400 uppercase">{e.origin}</span>
                        </div>
                        <p className="text-[10px] text-slate-500">
                          {e.author_name} · {new Date(e.created_at).toLocaleString(locale === "pt" ? "pt-BR" : "en-US")}
                          {e.finding && ` · ${locale === "pt" ? "motivado por" : "driven by"}: ${e.finding.title}`}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
