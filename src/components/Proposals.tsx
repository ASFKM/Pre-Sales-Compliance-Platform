import { useEffect, useState } from "react";
import { TriangleAlert, Download, PenLine, ShieldAlert, Sparkles, X, Wrench, Handshake, CircleDollarSign, Eye, CheckCircle2, RotateCcw, ListChecks, History, Table2, FileText, type LucideIcon } from "lucide-react";
import * as mammoth from "mammoth";
import DOMPurify from "dompurify";
import { Proposal, SlaRiskFlag, PricingRow } from "../types";
// F7: as mesmas funcoes que o servidor usa para localizar e aplicar uma correcao pontual. Modulo
// puro, sem dependencia de node - importado em vez de espelhado porque a regra de "aceitar UMA
// correcao muda so aquele trecho" tem de ser literalmente a mesma dos dois lados; um espelho
// divergiria na primeira mudanca e o bug apareceria como texto salvo errado.
import { aplicarCorrecao, reposicionarAposAplicar, type CorrecaoLocalizada } from "../../server/utils/proposalGrammar";
import { useProposals } from "../hooks/useProposals";
import { BackgroundTask } from "../hooks/useBackgroundTasks";
import {
  ProposalEditableField,
  PROPOSAL_TYPE_EDITABLE_FIELDS,
  PROPOSAL_TYPE_LABEL,
  PROPOSAL_TYPE_BADGE,
  PROPOSAL_FIELD_LABEL,
} from "../lib/proposalEditableFields";

const OPINION_PERSPECTIVES = ["technical", "commercial", "legal", "financial"] as const;
type OpinionPerspective = (typeof OPINION_PERSPECTIVES)[number];
const OPINION_PERSPECTIVE_LABEL: Record<OpinionPerspective, { pt: string; en: string }> = {
  technical: { pt: "Técnico", en: "Technical" },
  commercial: { pt: "Comercial", en: "Commercial" },
  legal: { pt: "Jurídico", en: "Legal" },
  financial: { pt: "Financeiro", en: "Financial" },
};
// Identidade visual por perspectiva, separada da severidade (crítico/atenção) do conteúdo em si -
// as duas informações precisam ficar visíveis ao mesmo tempo num card, sem uma sobrescrever a
// outra (antes, só a severidade colorida o card inteiro e todo card tinha a mesma aparência entre
// si). Quem distingue a perspectiva é o ÍCONE (chave/aperto de mão/cifrão/escudo) mais o rótulo;
// o chip é uniforme em brand-* de propósito. As quatro cores anteriores (azul/verde/âmbar/roxo)
// competiam com a própria severidade do card: o chip âmbar de "Financeiro" era indistinguível do
// badge âmbar "atenção" ao lado dele. Repaletização da Fase 4 (identidade visual, 2026-08).
const OPINION_PERSPECTIVE_STYLE: Record<OpinionPerspective, { icon: LucideIcon; iconBg: string; iconColor: string }> = {
  technical: { icon: Wrench, iconBg: "bg-brand-100", iconColor: "text-brand-700" },
  commercial: { icon: Handshake, iconBg: "bg-brand-100", iconColor: "text-brand-700" },
  financial: { icon: CircleDollarSign, iconBg: "bg-brand-100", iconColor: "text-brand-700" },
  legal: { icon: ShieldAlert, iconBg: "bg-brand-100", iconColor: "text-brand-700" },
};
const OPINION_SEVERITY_BORDER: Record<"critical" | "warning" | "none", string> = {
  critical: "border-l-4 border-l-danger-500",
  warning: "border-l-4 border-l-warning-500",
  none: "border-l-4 border-l-transparent",
};
/*
 * F6 (rodada 09/2026): o APONTAMENTO, unidade que se dirime.
 *
 * O parecer deixou de ser um bloco em modo leitura porque não se dirime um parágrafo. Cada
 * apontamento tem identidade, severidade, a seção que afeta e um ciclo próprio - e é o ciclo que
 * a tela precisa oferecer: "resolvido" depois de mudar a seção, "aceito com risco" quando se
 * decide seguir assim mesmo, "descartado" quando o apontamento não procedia. Os dois últimos o
 * SERVIDOR recusa sem justificativa (server/utils/proposalFindings.ts), então o formulário abaixo
 * pede o texto antes de chamar - mas quem garante não é ele.
 */
type FindingStatus = "aberto" | "em_tratativa" | "resolvido" | "aceito_com_risco" | "descartado";

interface FindingItem {
  id: string;
  ordinal: number;
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
  target_kind: "proposal_field" | "template_field" | "geral";
  target_key?: string | null;
  suggested_value?: string | null;
  status: FindingStatus;
  resolution_note?: string | null;
  // F7: o apontamento da rodada ANTERIOR que este continua (null = novo nesta rodada).
  previous_finding_id?: string | null;
  // F7: o veredito CONSULTIVO de sanacao. Fica ao lado do status, nunca no lugar dele - a IA
  // sugere que o apontamento foi endereçado, quem fecha e uma pessoa.
  remediation_verdict?: "sanado" | "parcial" | "nao_sanado" | null;
  remediation_note?: string | null;
  remediation_checked_at?: string | null;
}

// F7: o veredito de sanacao, com a cor dizendo o quanto ele ainda pede atencao.
const REMEDIATION_LABEL: Record<string, { pt: string; en: string; classe: string }> = {
  sanado: { pt: "IA: sanado", en: "AI: remediated", classe: "bg-success-50 text-success-700 border-success-200" },
  parcial: { pt: "IA: parcial", en: "AI: partial", classe: "bg-warning-50 text-warning-700 border-warning-200" },
  nao_sanado: { pt: "IA: não sanado", en: "AI: not remediated", classe: "bg-danger-50 text-danger-700 border-danger-200" },
};

// F7: os tres numeros que distinguem progresso de "a IA inventa apontamento toda vez".
interface ComparacaoDeRodadas {
  rodada_atual: { id: string; created_at: string; logic_version: number };
  rodada_anterior: { id: string; created_at: string; logic_version: number };
  comparavel: boolean;
  totais: { sanados: number; parciais: number; novos: number; abertos_na_rodada_anterior: number; total_nesta_rodada: number };
  sanados: Array<{ id: string; title: string; severity: string; status: string }>;
  parciais: Array<{ id: string; title: string; severity: string; status: string }>;
  novos: Array<{ id: string; title: string; severity: string; status: string }>;
}

const FINDING_STATUS_LABEL: Record<FindingStatus, { pt: string; en: string }> = {
  aberto: { pt: "Aberto", en: "Open" },
  em_tratativa: { pt: "Em tratativa", en: "In progress" },
  resolvido: { pt: "Resolvido", en: "Resolved" },
  aceito_com_risco: { pt: "Aceito com risco", en: "Accepted with risk" },
  descartado: { pt: "Descartado", en: "Dismissed" },
};

const FINDING_STATUS_STYLE: Record<FindingStatus, string> = {
  aberto: "bg-slate-100 text-slate-600 border-slate-200",
  em_tratativa: "bg-brand-50 text-brand-700 border-brand-200",
  resolvido: "bg-success-50 text-success-700 border-success-200",
  aceito_com_risco: "bg-warning-50 text-warning-700 border-warning-200",
  descartado: "bg-slate-100 text-slate-400 border-slate-200",
};

// Os dois que o servidor recusa sem justificativa. Espelhado aqui só para o formulário pedir o
// texto ANTES de chamar - a garantia é de lá, não daqui.
const FINDING_STATUS_COM_JUSTIFICATIVA: FindingStatus[] = ["aceito_com_risco", "descartado"];

interface OpinionItem {
  perspective: OpinionPerspective;
  status: "completed" | "failed";
  severity?: "info" | "warning" | "critical" | null;
  summary: string;
  content: string;
  // Vazio nas 8 rodadas geradas antes da F6 (logicVersion 1): elas não têm apontamento nenhum, e
  // isso não é "parecer limpo" - a tela diz a diferença.
  findings?: FindingItem[];
  // PARTE B (parecer acionável): presente só quando a IA tinha UMA mudança concreta a sugerir a um
  // campo que este tipo de proposta realmente possui (ver server/routes/proposals.ts's
  // TEXT_SUGGESTIBLE_FIELDS) - nunca aplicado sozinho, só via o botão "Aplicar" abaixo.
  suggested_field?: Exclude<ProposalEditableField, "manual_pricing_table"> | null;
  suggested_value?: string | null;
}
interface OpinionRun {
  id: string;
  status: "pending" | "running" | "completed" | "partial" | "failed";
  // F6: 1 = rodada sem apontamentos (anterior a esta fase); 2 = com apontamentos.
  logic_version?: number;
  opinions: OpinionItem[];
}

interface ProposalsProps {
  locale: "en" | "pt";
  hasPermission: (perm: string) => boolean;
  proposals: Proposal[];
  selectedProjectId: string;
  activeTasks: BackgroundTask[];
  waitForTask: (taskId: string) => Promise<BackgroundTask>;
  fetchGlobalConfigs: () => Promise<void> | void;
  fetchProjectDetails: (projectId: string) => Promise<void> | void;
  handleReleaseProposal: (propId: string) => void;
}

export default function Proposals({
  locale, hasPermission, proposals, selectedProjectId, activeTasks, waitForTask,
  fetchGlobalConfigs, fetchProjectDetails, handleReleaseProposal,
}: ProposalsProps) {
  const { handleUpdateProposalCommercial, handleUpdateProposalFields, handleSubmitProposalApproval, handleReopenProposal, handleClientDecision } = useProposals({
    locale, hasPermission, proposals, selectedProjectId, fetchGlobalConfigs, fetchProjectDetails,
  });
  const [exportingId, setExportingId] = useState<string | null>(null);
  // Item 18: qual proposta está com o formulário de recusa aberto, o motivo digitado e o erro que
  // o servidor devolveu. O motivo é obrigatório na recusa (a rota recusa sem ele), então ele
  // precisa de um campo de verdade — não de um `confirm()` que não coleta texto.
  const [recusandoId, setRecusandoId] = useState<string | null>(null);
  const [motivoRecusa, setMotivoRecusa] = useState("");
  const [erroDecisao, setErroDecisao] = useState<Record<string, string>>({});
  const [salvandoDecisao, setSalvandoDecisao] = useState<string | null>(null);

  async function registrarDecisao(propId: string, decision: "accepted" | "declined", note: string) {
    setSalvandoDecisao(propId);
    const erro = await handleClientDecision(propId, decision, note);
    setSalvandoDecisao(null);
    setErroDecisao((e) => ({ ...e, [propId]: erro ?? "" }));
    if (!erro) {
      setRecusandoId(null);
      setMotivoRecusa("");
    }
  }
  // Roadmap item (official): "Pareceres de IA Multi-Perspectiva em Propostas" - keyed by
  // proposal.id, undefined = not yet fetched, null = fetched but no run exists yet.
  const [opinionRuns, setOpinionRuns] = useState<Record<string, OpinionRun | null | undefined>>({});
  // F7: a comparacao entre a rodada atual e a anterior, por proposta. `null` = ha rodada mas nao ha
  // com que comparar (primeira rodada) - que e informacao diferente de "tres zeros".
  const [comparacoes, setComparacoes] = useState<Record<string, ComparacaoDeRodadas | null | undefined>>({});
  const [verificandoSanacao, setVerificandoSanacao] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    for (const prop of proposals) {
      if (opinionRuns[prop.id] !== undefined) continue;
      // F7: a comparacao vem junto do painel, na mesma varredura - ela e a primeira coisa que
      // alguem olha ao reabrir uma proposta ja revisada ("melhorou?"), entao esperar um segundo
      // clique para busca-la esconderia justamente o numero que da sentido ao ciclo.
      fetch(`/api/proposals/${prop.id}/comparacao-de-rodadas`)
        .then((r) => r.json())
        .then((data) => { if (data.success) setComparacoes((atual) => ({ ...atual, [prop.id]: data.comparacao })); })
        .catch(() => {});
      fetch(`/api/proposals/${prop.id}/opinion-panel`)
        .then((r) => r.json())
        .then((data) => {
          if (cancelled || !data.success) return;
          setOpinionRuns((prev) => ({ ...prev, [prop.id]: data.run }));
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposals]);

  const activeOpinionPanelTask = (proposalId: string) =>
    activeTasks.find((t) => t.type === "proposal_opinion_panel" && t.result_id === proposalId);

  const generateOpinionPanel = async (proposalId: string) => {
    try {
      const res = await fetch(`/api/proposals/${proposalId}/opinion-panel`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível gerar os pareceres de IA." : "Could not generate the AI opinion panel."));
        return;
      }
      const finished = await waitForTask(data.task_id);
      if (finished.status === "failed") {
        throw new Error(finished.error_message || (locale === "pt" ? "Falha ao gerar os pareceres de IA." : "Failed to generate the AI opinion panel."));
      }
      const cmp = await fetch(`/api/proposals/${proposalId}/comparacao-de-rodadas`).then((r) => r.json()).catch(() => ({}));
      if (cmp.success) setComparacoes((atual) => ({ ...atual, [proposalId]: cmp.comparacao }));
      const res2 = await fetch(`/api/proposals/${proposalId}/opinion-panel`);
      const data2 = await res2.json().catch(() => ({}));
      if (data2.success) setOpinionRuns((prev) => ({ ...prev, [proposalId]: data2.run }));
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : String(err));
    }
  };
  // PARTE A (editor estruturado): substitui o antigo blob único `editable_content` por um formulário
  // com só os campos que o TIPO desta proposta realmente possui (PROPOSAL_TYPE_EDITABLE_FIELDS) -
  // salvar regenera o DOCX/PDF através do mesmo caminho de merge de template da geração inicial
  // (server/routes/proposals.ts), então o letterhead de um template real nunca é mais perdido.
  const [editingProposal, setEditingProposal] = useState<Proposal | null>(null);
  const [editedFields, setEditedFields] = useState<Partial<Record<Exclude<ProposalEditableField, "manual_pricing_table">, string>>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  /*
   * F6: o modal ganhou DUAS ABAS, e a separação não é cosmética.
   *
   * TEXTO edita prosa - campos comerciais de texto e seções do template - e é a única aba com IA:
   * "pedir sugestão" recebe os apontamentos abertos daquela seção como contexto e devolve texto
   * para a pessoa revisar antes de salvar.
   *
   * TABELAS edita a tabela de precificação, à mão, SEM IA - e sem ela de propósito. Uma tabela é
   * item, quantidade e preço: número que vira compromisso. É a mesma linha que
   * TEXT_SUGGESTIBLE_FIELDS já traça no servidor ao excluir manual_pricing_table do que um parecer
   * pode sugerir, e que a allowlist traça ao barrar laço e preço. A aba existe porque a tabela
   * precisava de edição estruturada; a ausência de IA nela é a regra do produto, não uma pendência.
   */
  const [abaDoEditor, setAbaDoEditor] = useState<"texto" | "tabelas">("texto");
  const [secoesDeTexto, setSecoesDeTexto] = useState<Array<{ nome: string; descricao: string; origem: string; valor_aprovado: string | null }>>([]);
  const [textoDaSecao, setTextoDaSecao] = useState<Record<string, string>>({});
  const [sugerindoSecao, setSugerindoSecao] = useState<string | null>(null);
  const [sugestaoDaSecao, setSugestaoDaSecao] = useState<Record<string, { texto_sugerido: string; o_que_mudou: string | null; apontamentos: Array<{ id: string; title: string }> }>>({});
  const [salvandoSecao, setSalvandoSecao] = useState<string | null>(null);
  const [linhasDePreco, setLinhasDePreco] = useState<PricingRow[]>([]);
  const [historicoDeSecoes, setHistoricoDeSecoes] = useState<Array<any>>([]);
  /*
   * F7: a GRAMÁTICA, por seção. `texto_base` é o texto contra o qual os offsets foram calculados -
   * guardá-lo é o que permite aceitar uma correção sem reconsultar o servidor, e recusar sem mexer
   * em nada. Cada aceite reescreve o texto_base e reposiciona as correções que sobraram.
   */
  const [correcoesDaSecao, setCorrecoesDaSecao] = useState<Record<string, { texto_base: string; correcoes: CorrecaoLocalizada[]; descartadas: number }>>({});
  const [revisandoGramatica, setRevisandoGramatica] = useState<string | null>(null);
  // F7: a coerência entre seções, do modal inteiro (não de uma seção só - contradição é relação).
  const [coerencia, setCoerencia] = useState<{ achados: Array<any>; secoes: string[] } | null>(null);
  const [verificandoCoerencia, setVerificandoCoerencia] = useState(false);

  const revisarGramaticaDaSecao = async (propId: string, secao: string) => {
    setRevisandoGramatica(secao);
    try {
      const res = await fetch(`/api/proposals/${propId}/secoes/${secao}/revisar-gramatica`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível revisar a gramática." : "Could not check grammar."));
        return;
      }
      setCorrecoesDaSecao((atual) => ({
        ...atual,
        [secao]: { texto_base: data.texto_atual, correcoes: data.correcoes, descartadas: data.descartadas_por_trecho_inexato ?? 0 },
      }));
      // O textarea passa a mostrar o mesmo texto que a revisão enxergou, senão os trechos
      // destacados abaixo não corresponderiam ao que se está prestes a salvar.
      setTextoDaSecao((atual) => ({ ...atual, [secao]: data.texto_atual }));
    } finally {
      setRevisandoGramatica(null);
    }
  };

  /*
   * Aceitar UMA correção: aplica só aquele trecho, no offset dele, e reposiciona as demais. Recusar
   * apenas remove o item da lista - o texto não é tocado, que é o ponto todo de ter aceitar e
   * recusar por item em vez de um "usar este texto" de tudo ou nada.
   */
  const decidirCorrecao = (secao: string, correcao: CorrecaoLocalizada, aceitar: boolean) => {
    setCorrecoesDaSecao((atual) => {
      const estado = atual[secao];
      if (!estado) return atual;
      if (!aceitar) {
        return { ...atual, [secao]: { ...estado, correcoes: estado.correcoes.filter((c) => c.id !== correcao.id) } };
      }
      const novoTexto = aplicarCorrecao(estado.texto_base, correcao);
      if (novoTexto === null) {
        alert(locale === "pt"
          ? "O texto mudou desde a revisão: peça a revisão gramatical de novo."
          : "The text changed since the review: run the grammar check again.");
        return atual;
      }
      setTextoDaSecao((t) => ({ ...t, [secao]: novoTexto }));
      return { ...atual, [secao]: { ...estado, texto_base: novoTexto, correcoes: reposicionarAposAplicar(estado.correcoes, correcao) } };
    });
  };

  const verificarCoerencia = async (propId: string) => {
    setVerificandoCoerencia(true);
    try {
      const res = await fetch(`/api/proposals/${propId}/coerencia-entre-secoes`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível verificar a coerência." : "Could not check coherence."));
        return;
      }
      setCoerencia({ achados: data.achados, secoes: data.secoes_avaliadas });
    } finally {
      setVerificandoCoerencia(false);
    }
  };

  const openEditor = (prop: Proposal) => {
    const allowed = PROPOSAL_TYPE_EDITABLE_FIELDS[prop.proposal_type];
    const initial: typeof editedFields = {};
    for (const field of allowed) {
      if (field === "manual_pricing_table") continue;
      initial[field] = (prop[field] as string | undefined) || "";
    }
    setEditingProposal(prop);
    setEditedFields(initial);
    setAbaDoEditor("texto");
    setLinhasDePreco((prop.manual_pricing_table as PricingRow[] | undefined) ?? []);
    setSugestaoDaSecao({});
    setCorrecoesDaSecao({});
    setCoerencia(null);

    void fetch(`/api/proposals/${prop.id}/secoes-de-texto`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.success) return;
        setSecoesDeTexto(data.secoes);
        // O textarea nasce com o que JÁ foi aprovado para aquela seção; vazio significa "a seção
        // sai como a análise a deixou", que é diferente de "está em branco no documento".
        setTextoDaSecao(Object.fromEntries(data.secoes.map((sc: any) => [sc.nome, sc.valor_aprovado ?? ""])));
      })
      .catch(() => {});

    void fetch(`/api/proposals/${prop.id}/historico-de-secoes`)
      .then((r) => r.json())
      .then((data) => { if (data.success) setHistoricoDeSecoes(data.historico); })
      .catch(() => {});
  };

  const recarregarHistorico = async (propId: string) => {
    const res = await fetch(`/api/proposals/${propId}/historico-de-secoes`);
    const data = await res.json().catch(() => ({}));
    if (data.success) setHistoricoDeSecoes(data.historico);
  };

  const pedirSugestaoDaSecao = async (propId: string, secao: string) => {
    setSugerindoSecao(secao);
    try {
      const res = await fetch(`/api/proposals/${propId}/secoes/${secao}/sugerir-texto`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível pedir a sugestão." : "Could not request the suggestion."));
        return;
      }
      setSugestaoDaSecao((atual) => ({
        ...atual,
        [secao]: { texto_sugerido: data.texto_sugerido, o_que_mudou: data.o_que_mudou, apontamentos: data.apontamentos_considerados },
      }));
    } finally {
      setSugerindoSecao(null);
    }
  };

  /*
   * Salvar uma seção. `origem` é a distinção que o histórico precisa: "ia" só quando o texto salvo
   * é byte a byte o que a IA devolveu; qualquer toque humano por cima vira "ia_editada"; sem
   * sugestão em tela, "humano". Deduzir isso aqui, comparando com a sugestão que ainda está na
   * memória da tela, é o único ponto onde essa informação existe.
   */
  const salvarSecao = async (propId: string, secao: string) => {
    setSalvandoSecao(secao);
    try {
      const texto = textoDaSecao[secao] ?? "";
      const sugerido = sugestaoDaSecao[secao]?.texto_sugerido;
      const origem = !sugerido ? "humano" : (texto.trim() === sugerido.trim() ? "ia" : "ia_editada");
      const res = await fetch(`/api/proposals/${propId}/campos-do-template`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campos: { [secao]: texto }, origem }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível salvar a seção." : "Could not save the section."));
        return;
      }
      await recarregarHistorico(propId);
      await fetchProjectDetails(selectedProjectId);
    } finally {
      setSalvandoSecao(null);
    }
  };

  /*
   * PreSales F8 (PARTE B): "Reabrir e Editar" numa proposta REJEITADA.
   *
   * A proposta rejeitada some da fila de aprovação (a aba Aprovação só mostra ação em `submitted`),
   * mas continua listada AQUI, no Estúdio de Propostas - que lista todas as propostas do projeto,
   * em qualquer status. É por isso que o ponto de entrada é este card, e não uma tela nova.
   *
   * Reabrir cria a v2 no servidor e devolve o id dela; a lista é recarregada e o editor estruturado
   * que JÁ existe abre na versão nova (ela nasce `draft`, então o PUT funciona nela sem mudança).
   * O `useEffect` existe porque `proposals` só chega atualizado no render seguinte ao refetch - dá
   * para pedir o editor antes de a linha nova existir na lista.
   */
  const [pendingEditorProposalId, setPendingEditorProposalId] = useState<string | null>(null);
  const [reopeningId, setReopeningId] = useState<string | null>(null);

  const reopenProposal = async (propId: string) => {
    setReopeningId(propId);
    try {
      const newId = await handleReopenProposal(propId);
      if (newId) setPendingEditorProposalId(newId);
    } finally {
      setReopeningId(null);
    }
  };

  useEffect(() => {
    if (!pendingEditorProposalId) return;
    const target = proposals.find((p) => p.id === pendingEditorProposalId);
    if (!target) return;
    setPendingEditorProposalId(null);
    // Os 4 tipos de relatório (executive_summary/risk_report/bom_report/questions_report) não têm
    // NENHUM campo estruturado editável (PROPOSAL_TYPE_EDITABLE_FIELDS = []) - a v2 é criada do
    // mesmo jeito, por consistência de auditoria, mas abrir um editor vazio nela só confundiria.
    // Pendência registrada e ainda a confirmar com o dono do produto: o que exatamente se edita
    // numa segunda versão desses quatro tipos.
    if (PROPOSAL_TYPE_EDITABLE_FIELDS[target.proposal_type].length === 0) return;
    openEditor(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposals, pendingEditorProposalId]);

  const saveEditedFields = async () => {
    if (!editingProposal) return;
    setSavingEdit(true);
    try {
      // A tabela só entra no patch quando este tipo de proposta a possui - mandá-la para um tipo
      // que não a tem faria o servidor recusar o PUT inteiro (getRejectedEditableFields), levando
      // junto os campos de texto que estavam certos.
      const temTabela = (PROPOSAL_TYPE_EDITABLE_FIELDS[editingProposal.proposal_type] as readonly string[]).includes("manual_pricing_table");
      const patch: Record<string, any> = { ...editedFields };
      if (temTabela) patch.manual_pricing_table = linhasDePreco;
      const ok = await handleUpdateProposalFields(editingProposal.id, patch);
      if (ok) setEditingProposal(null);
    } finally {
      setSavingEdit(false);
    }
  };

  /*
   * F6: o ciclo do apontamento, e o modal de duas abas.
   *
   * `findingEmJustificativa` é o id do apontamento cujo formulário de justificativa está aberto,
   * junto do status que ele vai receber. O servidor recusa "aceito com risco" e "descartado" sem
   * justificativa, então a tela pede o texto antes - mas se alguém chamar a rota direto, a recusa
   * vem de lá, com mensagem própria, que é o que esta tela exibe.
   */
  const [findingEmJustificativa, setFindingEmJustificativa] = useState<{ id: string; status: FindingStatus } | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const [salvandoFinding, setSalvandoFinding] = useState<string | null>(null);

  const mudarStatusDoApontamento = async (propId: string, findingId: string, status: FindingStatus, texto?: string) => {
    setSalvandoFinding(findingId);
    try {
      const res = await fetch(`/api/proposals/${propId}/apontamentos/${findingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, justificativa: texto }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível mudar o apontamento." : "Could not update the finding."));
        return;
      }
      // Recarrega a rodada inteira: o estado do apontamento é a coisa que a tela precisa mostrar
      // certa, e reconciliar à mão abriria a porta para a tela discordar do banco.
      const res2 = await fetch(`/api/proposals/${propId}/opinion-panel`);
      const data2 = await res2.json().catch(() => ({}));
      if (data2.success) setOpinionRuns((prev) => ({ ...prev, [propId]: data2.run }));
      setFindingEmJustificativa(null);
      setJustificativa("");
    } finally {
      setSalvandoFinding(null);
    }
  };

  const pedirMudanca = (propId: string, finding: FindingItem, status: FindingStatus) => {
    if (FINDING_STATUS_COM_JUSTIFICATIVA.includes(status)) {
      setFindingEmJustificativa({ id: finding.id, status });
      setJustificativa("");
      return;
    }
    void mudarStatusDoApontamento(propId, finding.id, status);
  };

  // PARTE B (parecer acionável): aplica UMA sugestão estruturada de um parecer de IA - o usuário
  // sempre confirma clicando aqui, a IA nunca grava na proposta sozinha (o parecer só devolve
  // suggested_field/suggested_value; ver server/routes/proposals.ts).
  const [applyingSuggestionKey, setApplyingSuggestionKey] = useState<string | null>(null);
  const applyOpinionSuggestion = async (propId: string, field: Exclude<ProposalEditableField, "manual_pricing_table">, value: string) => {
    const key = `${propId}-${field}`;
    setApplyingSuggestionKey(key);
    try {
      await handleUpdateProposalFields(propId, { [field]: value });
    } finally {
      setApplyingSuggestionKey(null);
    }
  };

  /*
   * F7: pedir o veredito de SANAÇÃO de um apontamento.
   *
   * O botão nunca muda o status - ele preenche um campo ao lado dele. Depois de ver "IA: sanado",
   * quem revisa continua tendo de clicar em "Resolvido", que é o ato que carimba autor e instante.
   * Essa separação é o que impede que uma opinião de modelo destranque o gate de envio desta mesma
   * fase, que só olha o status.
   */
  const verificarSanacao = async (propId: string, findingId: string) => {
    setVerificandoSanacao(findingId);
    try {
      const res = await fetch(`/api/proposals/${propId}/apontamentos/${findingId}/verificar-sanacao`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível verificar a sanação." : "Could not check remediation."));
        return;
      }
      const res2 = await fetch(`/api/proposals/${propId}/opinion-panel`);
      const painel = await res2.json().catch(() => ({}));
      if (painel.success) setOpinionRuns((atual) => ({ ...atual, [propId]: painel.run }));
    } finally {
      setVerificandoSanacao(null);
    }
  };

  /*
   * F6: aplicar o texto de um apontamento na seção que ele aponta.
   *
   * Dois destinos diferentes com a mesma cara para quem clica: um campo da própria proposta vai
   * pelo PUT /proposals/:id (que regenera o documento); uma seção de texto do template vai pelo
   * PUT campos-do-template, levando junto a ORIGEM e o apontamento que motivou - é isso que faz o
   * histórico saber que aquele texto veio da IA e por quê.
   */
  const [aplicandoApontamento, setAplicandoApontamento] = useState<string | null>(null);
  const aplicarTextoDoApontamento = async (propId: string, finding: FindingItem, texto: string, origem: "ia" | "ia_editada") => {
    setAplicandoApontamento(finding.id);
    try {
      if (finding.target_kind === "proposal_field" && finding.target_key) {
        // F7: leva a ORIGEM e o apontamento também neste caminho. Antes só o caminho de
        // template_field registrava histórico, e sem ele a verificação de sanação não tem o par
        // texto anterior/texto novo para ler - justamente nos campos que a IA mais aponta.
        await handleUpdateProposalFields(propId, { [finding.target_key]: texto, origem, apontamento_id: finding.id });
      } else if (finding.target_kind === "template_field" && finding.target_key) {
        const res = await fetch(`/api/proposals/${propId}/campos-do-template`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campos: { [finding.target_key]: texto }, origem, apontamento_id: finding.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.message || (locale === "pt" ? "Não foi possível aplicar o texto." : "Could not apply the text."));
          return;
        }
      }
      await fetchProjectDetails(selectedProjectId);
    } finally {
      setAplicandoApontamento(null);
    }
  };

  /*
   * F6 - revisão do documento gerado (frente c) e sugestões de conteúdo (frentes a/b).
   *
   * A revisão não usa IA e não custa nada: ela reabre o documento REAL e confere marcador não
   * substituído, soma de precificação e itens do BOM. Lista vazia significa "conferido e limpo",
   * e a tela diz isso com todas as letras - "não achei nada" e "não olhei" são estados diferentes
   * para quem está prestes a mandar a proposta ao cliente.
   */
  const [revisao, setRevisao] = useState<Record<string, { achados: Array<{ tipo: string; severidade: string; descricao: string }>; total: number } | null>>({});
  const [revisandoId, setRevisandoId] = useState<string | null>(null);
  const revisarDocumento = async (propId: string) => {
    setRevisandoId(propId);
    try {
      const res = await fetch(`/api/proposals/${propId}/revisao`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível revisar o documento." : "Could not review the document."));
        return;
      }
      setRevisao((atual) => ({ ...atual, [propId]: { achados: data.achados, total: data.total } }));
    } finally {
      setRevisandoId(null);
    }
  };

  /*
   * Sugestões de conteúdo: a IA redige, a pessoa aplica. Mesmo contrato do parecer acionável da
   * F7 - nada é gravado sem um clique, campo a campo.
   */
  const [sugestoes, setSugestoes] = useState<Record<string, Array<{ variavel: string; valor_sugerido: string; origem: string; justificativa: string }>>>({});
  const [sugerindoId, setSugerindoId] = useState<string | null>(null);
  const [aplicandoCampo, setAplicandoCampo] = useState<string | null>(null);

  const pedirSugestoes = async (propId: string) => {
    setSugerindoId(propId);
    try {
      const res = await fetch(`/api/proposals/${propId}/sugerir-conteudo`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível gerar sugestões." : "Could not generate suggestions."));
        return;
      }
      setSugestoes((atual) => ({ ...atual, [propId]: data.sugestoes }));
      if (data.sugestoes.length === 0 && data.message) alert(data.message);
    } finally {
      setSugerindoId(null);
    }
  };

  const aplicarSugestao = async (propId: string, variavel: string, valor: string) => {
    const chave = `${propId}-${variavel}`;
    setAplicandoCampo(chave);
    try {
      const res = await fetch(`/api/proposals/${propId}/campos-do-template`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campos: { [variavel]: valor } }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível aplicar o campo." : "Could not apply the field."));
        return;
      }
      // Aplicado: sai da lista de pendentes. O documento só muda quando a proposta for regerada.
      setSugestoes((atual) => ({
        ...atual,
        [propId]: (atual[propId] || []).filter((sg) => sg.variavel !== variavel),
      }));
    } finally {
      setAplicandoCampo(null);
    }
  };

  // PARTE A (preview do documento real): busca o DOCX/PDF já exportado (as mesmas rotas de
  // download, /export/docx e /export/pdf) e renderiza inline - DOCX via mammoth (já é dependência
  // do produto, usada no server para extração de upload; o mesmo pacote roda no browser),
  // PDF nativamente pelo próprio navegador via <iframe> numa blob URL. Nada de reimplementar
  // renderização de documento no client - é sempre o binário real, não uma reconstrução do texto.
  const [previewingProposalId, setPreviewingProposalId] = useState<string | null>(null);
  const [previewFormat, setPreviewFormat] = useState<"docx" | "pdf">("docx");
  const [previewDocxHtml, setPreviewDocxHtml] = useState<string | null>(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const openPreview = async (proposalId: string, format: "docx" | "pdf") => {
    setPreviewingProposalId(proposalId);
    setPreviewFormat(format);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/export/${format}`);
      if (!res.ok) {
        throw new Error(locale === "pt" ? "Não foi possível carregar o documento." : "Could not load the document.");
      }
      if (format === "docx") {
        const arrayBuffer = await res.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        // mammoth passes through whatever href/src the source .docx's XML declares (e.g. a
        // hyperlink relationship) - sanitize before ever injecting into the DOM, same as any other
        // HTML string built from data that isn't 100% attacker-proof (an uploaded proposal
        // template is admin-controlled, not attacker-controlled, but this is the actual document
        // that gets shown, so it gets the same treatment as untrusted HTML would).
        setPreviewDocxHtml(DOMPurify.sanitize(result.value));
      } else {
        const blob = await res.blob();
        setPreviewPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
      }
    } catch (err) {
      console.error(err);
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewingProposalId(null);
    setPreviewDocxHtml(null);
    setPreviewPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setPreviewError(null);
  };

  // Roadmap item (customer_request): "Alerta de Risco de SLA via Base de Conhecimento" - flags
  // proposed commercial/SLA/penalty terms against the approved Knowledge Base's own recorded
  // lessons learned, before the proposal is sent. undefined = never checked yet, [] = checked and
  // clean, non-empty = flagged risks to show.
  const [slaCheckResults, setSlaCheckResults] = useState<Record<string, SlaRiskFlag[]>>({});
  const [checkingSlaId, setCheckingSlaId] = useState<string | null>(null);
  const checkSlaRisk = async (propId: string) => {
    setCheckingSlaId(propId);
    try {
      const res = await fetch(`/api/proposals/${propId}/sla-risk-check`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível verificar riscos de SLA." : "Could not check SLA risks."));
        return;
      }
      setSlaCheckResults((prev) => ({ ...prev, [propId]: data.risks || [] }));
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao verificar riscos de SLA." : "Error checking SLA risks.");
    } finally {
      setCheckingSlaId(null);
    }
  };

  // Was a plain <a href target="_blank"> - a browser-navigated request never goes through the
  // app's global fetch() interceptor (App.tsx) that injects the Authorization header, so the API
  // rejected it with "Authorization token required" and the browser rendered/downloaded that raw
  // JSON error instead of the real file. fetch() here goes through that interceptor correctly.
  const handleExportProposal = async (proposalId: string, format: "docx" | "pdf") => {
    setExportingId(`${proposalId}-${format}`);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/export/${format}`);
      if (!res.ok) {
        alert(locale === "pt" ? "Não foi possível exportar a proposta." : "Could not export the proposal.");
        return;
      }
      const disposition = res.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const filename = filenameMatch?.[1] || `proposta-${proposalId}.${format}`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao exportar a proposta." : "Error exporting the proposal.");
    } finally {
      setExportingId(null);
    }
  };

  return (
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-light text-slate-900">{locale === "pt" ? "Espaço de Trabalho do Estúdio de Propostas" : "Proposal Studio Workspace"}</h2>
                <span className="text-xs text-slate-400">{locale === "pt" ? "Gerencie planilhas de precificação de lances, exclusões comerciais e fluxos de aprovação" : "Manage bid pricing spreadsheets, commercial exclusions and approval pipelines"}</span>
              </div>

              {proposals.length === 0 ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center py-16">
                  <TriangleAlert className="text-warning-500 mx-auto mb-2" size={32} />
                  <h4 className="text-sm font-bold text-slate-800 uppercase font-mono">{locale === "pt" ? "Nenhuma Proposta Compilada Ainda" : "No Proposals Compiled Yet"}</h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 leading-relaxed">
                    {locale === "pt" ? "Acesse a Área de Trabalho e escolha a aba 'Estúdio de Geração de Propostas' para compilar especificações técnicas ou planilhas de preços em rascunhos de documentos reais." : "Go to your Workspace tab and choose the 'Proposal Studio Generator' sub-tab to compile technical specifications or pricing tables into actual document drafts."}
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {proposals.map(prop => (
                    // PreSales F8: âncora por proposta - é ela que faz o link "ver versão anterior"
                    // de uma v2 levar até o card da v1 sem precisar de uma tela nova de histórico.
                    <div key={prop.id} id={`proposal-${prop.id}`} className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex flex-col gap-4 scroll-mt-6">

                      {/* Header block of proposal */}
                      <div className="flex justify-between items-start border-b border-slate-100 pb-3">
                        <div className="flex gap-3 items-center">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-[10px] bg-brand-50 text-brand-700">
                            {PROPOSAL_TYPE_BADGE[prop.proposal_type]}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              {/* PreSales F8: era "Draft v{version}.0" com `version` sempre 1 (campo
                                  morto no banco) e a palavra "Draft" mesmo numa proposta já liberada.
                                  Agora o número é a versão REAL da cadeia, e o estado quem diz é o
                                  selo ao lado. */}
                              <h3 className="text-sm font-bold text-slate-800 uppercase font-mono">{PROPOSAL_TYPE_LABEL[prop.proposal_type][locale]} - v{prop.version}</h3>
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
                            <p className="text-xs text-slate-400 mt-0.5 font-mono">{locale === "pt" ? "Gerada por:" : "Generated by:"} {prop.generated_by} {locale === "pt" ? "em" : "on"} {new Date(prop.generated_at).toLocaleString()}</p>
                            {prop.previous_version_id && (
                              <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                                {locale === "pt" ? "Reaberta a partir da versão rejeitada" : "Reopened from the rejected version"}{" "}
                                <a
                                  href={`#proposal-${prop.previous_version_id}`}
                                  className="text-brand-700 hover:text-brand-800 underline underline-offset-2"
                                >
                                  v{prop.version - 1}
                                </a>
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Export Action Buttons */}
                        <div className="flex gap-2">
                          {prop.status === "draft" && hasPermission("proposal:edit") && (
                            <button
                              onClick={() => openEditor(prop)}
                              className="flex items-center gap-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-brand-200 transition-all shadow-sm cursor-pointer"
                            >
                              <PenLine size={12} /> {locale === "pt" ? "Revisar e Editar" : "Review & Edit"}
                            </button>
                          )}
                          {prop.status === "draft" && hasPermission("proposal:edit") && (
                            <button
                              onClick={() => checkSlaRisk(prop.id)}
                              disabled={checkingSlaId === prop.id}
                              className="flex items-center gap-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-brand-200 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                            >
                              <ShieldAlert size={12} className={checkingSlaId === prop.id ? "animate-pulse" : ""} />
                              {checkingSlaId === prop.id ? (locale === "pt" ? "Verificando..." : "Checking...") : (locale === "pt" ? "Verificar Riscos de SLA" : "Check SLA Risks")}
                            </button>
                          )}
                          {prop.status === "draft" && hasPermission("proposal:edit") && (() => {
                            const activeTask = activeOpinionPanelTask(prop.id);
                            const isRunning = !!activeTask;
                            return (
                              <button
                                onClick={() => generateOpinionPanel(prop.id)}
                                disabled={isRunning}
                                className="flex items-center gap-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-brand-200 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                                title={locale === "pt" ? "Gera 4 pareceres de IA (Técnico/Comercial/Jurídico/Financeiro) - puramente informativo, nunca bloqueia o fluxo de aprovação" : "Generates 4 AI opinions (Technical/Commercial/Legal/Financial) - purely informational, never blocks the approval flow"}
                              >
                                <Sparkles size={12} className={isRunning ? "animate-pulse" : ""} />
                                {isRunning
                                  ? `${locale === "pt" ? "Gerando" : "Generating"}${activeTask?.progress_pct != null ? ` ${activeTask.progress_pct}%` : "..."}`
                                  : (locale === "pt" ? "Gerar Pareceres de IA" : "Generate AI Opinions")}
                              </button>
                            );
                          })()}
                          {hasPermission("proposal:edit") && (
                            <button
                              onClick={() => revisarDocumento(prop.id)}
                              disabled={revisandoId === prop.id}
                              className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-slate-200 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                              title={locale === "pt" ? "Confere o documento gerado: marcador de variável não substituído, soma da precificação e itens do BOM. Sem IA, sem custo." : "Checks the generated document: unreplaced placeholders, pricing totals and BOM items. No AI, no cost."}
                            >
                              {revisandoId === prop.id
                                ? (locale === "pt" ? "Revisando..." : "Reviewing...")
                                : (locale === "pt" ? "Revisar Documento" : "Review Document")}
                            </button>
                          )}
                          {prop.status === "draft" && hasPermission("proposal:edit") && (
                            <button
                              onClick={() => pedirSugestoes(prop.id)}
                              disabled={sugerindoId === prop.id}
                              className="flex items-center gap-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-brand-200 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                              title={locale === "pt" ? "A IA redige, a partir da análise técnica, os campos de texto do template que sairiam em branco. Você revisa e aplica campo a campo." : "AI drafts the template's blank text fields from the technical analysis. You review and apply field by field."}
                            >
                              <Sparkles size={12} className={sugerindoId === prop.id ? "animate-pulse" : ""} />
                              {sugerindoId === prop.id
                                ? (locale === "pt" ? "Redigindo..." : "Drafting...")
                                : (locale === "pt" ? "Sugerir Conteúdo" : "Suggest Content")}
                            </button>
                          )}
                          {hasPermission("proposal:export") && (
                            <>
                              <button
                                onClick={() => openPreview(prop.id, "docx")}
                                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-slate-200 transition-all shadow-sm cursor-pointer"
                                title={locale === "pt" ? "Visualiza o documento real (o mesmo que seria exportado)" : "Previews the actual document (the same one that would be exported)"}
                              >
                                <Eye size={12} /> {locale === "pt" ? "Pré-visualizar" : "Preview"}
                              </button>
                              <button
                                onClick={() => handleExportProposal(prop.id, "docx")}
                                disabled={exportingId === `${prop.id}-docx`}
                                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-slate-200 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                              >
                                <Download size={12} /> {exportingId === `${prop.id}-docx` ? (locale === "pt" ? "Exportando..." : "Exporting...") : "Exportar DOCX"}
                              </button>
                              <button
                                onClick={() => handleExportProposal(prop.id, "pdf")}
                                disabled={exportingId === `${prop.id}-pdf`}
                                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-slate-200 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                              >
                                <Download size={12} /> {exportingId === `${prop.id}-pdf` ? (locale === "pt" ? "Exportando..." : "Exporting...") : "Exportar PDF"}
                              </button>
                            </>
                          )}
                          {prop.status === "draft" && hasPermission("approval:manage") && (
                            <button
                              onClick={() => handleSubmitProposalApproval(prop.id)}
                              className="bg-brand-600 hover:bg-brand-700 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all cursor-pointer"
                            >
                              {locale === "pt" ? "Enviar para Aprovação de Fluxo" : "Submit to Workflow Approvals"}
                            </button>
                          )}
                          {prop.status === "approved" && hasPermission("proposal:approve") && (
                            <button
                              onClick={() => handleReleaseProposal(prop.id)}
                              className="bg-brand-600 hover:bg-brand-700 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all cursor-pointer"
                            >
                              {locale === "pt" ? "Liberar Versão Final" : "Release Final Version"}
                            </button>
                          )}
                          {prop.status === "released" && (
                            <span className="bg-brand-50 text-brand-700 border border-brand-200 font-mono text-[11px] font-bold px-3 py-1.5 rounded">
                              {locale === "pt" ? "Versão Final Liberada" : "Final Version Released"}
                            </span>
                          )}
                          {/* Item 18 — a resposta do CLIENTE. Só aparece depois da liberação:
                              antes disso a proposta não saiu daqui, e uma "resposta" a um
                              documento que o cliente nunca viu seria dado inventado. Quem decide
                              ganho/perda é o CRM; isto cobre o cenário SEM integração. */}
                          {prop.status === "released" && prop.client_decision && (
                            <span
                              className={`font-mono text-[11px] font-bold px-3 py-1.5 rounded border ${
                                prop.client_decision === "accepted"
                                  ? "bg-success-50 text-success-700 border-success-200"
                                  : "bg-danger-50 text-danger-700 border-danger-200"
                              }`}
                              title={prop.client_decision_note ?? undefined}
                            >
                              {prop.client_decision === "accepted"
                                ? (locale === "pt" ? "Cliente aceitou" : "Client accepted")
                                : (locale === "pt" ? "Cliente recusou" : "Client declined")}
                            </span>
                          )}
                          {prop.status === "released" && !prop.client_decision && hasPermission("proposal:approve") && recusandoId !== prop.id && (
                            <>
                              <button
                                onClick={() => registrarDecisao(prop.id, "accepted", "")}
                                disabled={salvandoDecisao === prop.id}
                                title={locale === "pt"
                                  ? "Registra que o cliente aceitou esta proposta. O evento vai para a timeline do CRM. Quem marca a oportunidade como ganha continua sendo o CRM."
                                  : "Registers that the client accepted this proposal. The event goes to the CRM timeline. Marking the opportunity as won is still the CRM's job."}
                                className="bg-success-600 hover:bg-success-700 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                              >
                                {locale === "pt" ? "Cliente aceitou" : "Client accepted"}
                              </button>
                              <button
                                onClick={() => { setRecusandoId(prop.id); setMotivoRecusa(""); setErroDecisao((e) => ({ ...e, [prop.id]: "" })); }}
                                title={locale === "pt"
                                  ? "Registra que o cliente recusou esta proposta. O motivo é obrigatório."
                                  : "Registers that the client declined this proposal. A reason is required."}
                                className="bg-white hover:bg-danger-50 text-danger-700 border border-danger-300 font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all cursor-pointer"
                              >
                                {locale === "pt" ? "Cliente recusou" : "Client declined"}
                              </button>
                            </>
                          )}
                          {recusandoId === prop.id && (
                            /* O motivo é obrigatório na recusa — a rota devolve 400 sem ele. É a
                               mesma regra que o CMCRM já aplica para marcar uma oportunidade como
                               perdida, e a mesma lição da F8: "recusado" sem motivo é um dado que
                               não responde a nenhuma pergunta depois. */
                            <div className="flex flex-col gap-2 w-full mt-2">
                              <label htmlFor={`motivo-recusa-${prop.id}`} className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                                {locale === "pt" ? "Motivo da recusa (obrigatório)" : "Decline reason (required)"}
                              </label>
                              <textarea
                                id={`motivo-recusa-${prop.id}`}
                                value={motivoRecusa}
                                onChange={(e) => setMotivoRecusa(e.target.value)}
                                rows={2}
                                placeholder={locale === "pt" ? "O que o cliente disse?" : "What did the client say?"}
                                className="w-full max-w-lg border border-slate-300 rounded px-2 py-1.5 text-[12px] font-sans"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => registrarDecisao(prop.id, "declined", motivoRecusa)}
                                  disabled={motivoRecusa.trim().length === 0 || salvandoDecisao === prop.id}
                                  className="bg-danger-600 hover:bg-danger-700 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                                >
                                  {locale === "pt" ? "Registrar recusa" : "Register decline"}
                                </button>
                                <button
                                  onClick={() => { setRecusandoId(null); setMotivoRecusa(""); }}
                                  className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-mono text-[11px] font-bold px-3 py-1.5 rounded transition-all cursor-pointer"
                                >
                                  {locale === "pt" ? "Cancelar" : "Cancel"}
                                </button>
                              </div>
                            </div>
                          )}
                          {erroDecisao[prop.id] && (
                            <span className="font-mono text-[11px] text-danger-700">{erroDecisao[prop.id]}</span>
                          )}
                          {/* PreSales F8: único caminho de volta para uma proposta REJEITADA. Ela não
                              vira rascunho de novo - fica congelada como registro da recusa, e o
                              botão cria uma VERSÃO NOVA a partir dela. */}
                          {prop.status === "rejected" && hasPermission("proposal:generate") && (
                            <button
                              onClick={() => reopenProposal(prop.id)}
                              disabled={reopeningId === prop.id}
                              title={PROPOSAL_TYPE_EDITABLE_FIELDS[prop.proposal_type].length === 0
                                ? (locale === "pt"
                                  ? "Cria uma nova versão a partir desta proposta rejeitada. A versão rejeitada é preservada intacta. Atenção: este tipo de relatório não tem nenhum campo comercial editável hoje - a nova versão é regerada a partir da análise do projeto."
                                  : "Creates a new version from this rejected proposal. The rejected version is preserved intact. Note: this report type has no editable commercial field today - the new version is regenerated from the project analysis.")
                                : (locale === "pt"
                                  ? "Cria uma nova versão editável a partir desta proposta rejeitada. A versão rejeitada é preservada intacta, com os documentos e pareceres dela."
                                  : "Creates a new editable version from this rejected proposal. The rejected version is preserved intact, with its documents and opinions.")}
                              className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            >
                              <RotateCcw size={12} className={reopeningId === prop.id ? "animate-spin" : ""} />
                              {reopeningId === prop.id
                                ? (locale === "pt" ? "Reabrindo..." : "Reopening...")
                                : (locale === "pt" ? "Reabrir e Editar" : "Reopen & Edit")}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Pricing table block - only for types whose template actually uses pricing */}
                      {PROPOSAL_TYPE_EDITABLE_FIELDS[prop.proposal_type].includes("manual_pricing_table") && prop.manual_pricing_table && (
                        <div className="space-y-2">
                          <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono">{locale === "pt" ? "Grade de Planilha de Preço de Licitação" : "Commercial Bid Pricing Sheet Grid"}</h4>
                          <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/50">
                            <table className="w-full text-left text-xs border-collapse">
                              <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                                <tr>
                                  <th className="p-2.5">{locale === "pt" ? "Código do Item" : "Item Code"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Descrição" : "Description"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Quantidade" : "Quantity"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Preço Unitário" : "Unit List Price"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Desconto %" : "Discount %"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Preço Total USD" : "Total USD Price"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Status de Inclusão" : "Inclusion Status"}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 font-mono text-slate-700">
                                {prop.manual_pricing_table.map((row, i) => (
                                  <tr key={row.item_id || i} className="hover:bg-slate-50">
                                    <td className="p-2.5 font-bold">{row.product_or_service}</td>
                                    <td className="p-2.5 text-slate-500 font-sans text-xs">{row.specification || "-"}</td>
                                    <td className="p-2.5">
                                      <input
                                        type="number"
                                        value={row.quantity}
                                        onChange={(e) => handleUpdateProposalCommercial(prop.id, row.item_id, "quantity", parseInt(e.target.value) || 1)}
                                        disabled={prop.status !== "draft" || !hasPermission("proposal:edit")}
                                        className="w-14 p-1 rounded border border-slate-200 text-center font-semibold bg-white disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                                      />
                                    </td>
                                    <td className="p-2.5">
                                      <input
                                        type="number"
                                        value={row.unit_price}
                                        onChange={(e) => handleUpdateProposalCommercial(prop.id, row.item_id, "unit_price", parseFloat(e.target.value) || 0)}
                                        disabled={prop.status !== "draft" || !hasPermission("proposal:edit")}
                                        className="w-20 p-1 rounded border border-slate-200 text-center font-semibold bg-white disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                                      />
                                    </td>
                                    <td className="p-2.5">
                                      <input
                                        type="number"
                                        value={row.discount}
                                        onChange={(e) => handleUpdateProposalCommercial(prop.id, row.item_id, "discount", parseFloat(e.target.value) || 0)}
                                        disabled={prop.status !== "draft" || !hasPermission("proposal:edit")}
                                        className="w-14 p-1 rounded border border-slate-200 text-center font-semibold bg-white disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                                      />
                                    </td>
                                    <td className="p-2.5 font-bold text-slate-900">${row.total_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="p-2.5">
                                      <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] uppercase ${
                                        row.is_optional ? "text-warning-700 bg-warning-50 border border-warning-100" : "text-slate-700 bg-slate-100 border border-slate-200"
                                      }`}>
                                        {row.is_optional ? (locale === "pt" ? "Opcional" : "Optional") : (locale === "pt" ? "Obrigatório" : "Mandatory")}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                                {/* Totals block */}
                                <tr className="bg-slate-100 font-sans font-bold text-slate-800">
                                  <td colSpan={5} className="p-3 text-right uppercase tracking-wider font-mono text-[10px] text-slate-500">{locale === "pt" ? "Preço de Licitação Bruto Total:" : "Gross Contract Bid Price:"}</td>
                                  <td colSpan={2} className="p-3 text-sm text-brand-800 font-mono">
                                    ${(prop.manual_pricing_table || []).reduce((acc, r) => acc + r.total_price, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Text details for exclusions, validity etc - only the fields this type actually owns */}
                      {(() => {
                        const allowedTextFields = PROPOSAL_TYPE_EDITABLE_FIELDS[prop.proposal_type].filter(
                          (f): f is Exclude<ProposalEditableField, "manual_pricing_table"> => f !== "manual_pricing_table"
                        );
                        if (allowedTextFields.length === 0) return null;
                        return (
                          <div className="grid grid-cols-2 gap-6 text-xs text-slate-600 bg-slate-50/50 p-4 rounded-lg border border-slate-200">
                            {allowedTextFields.map((field) => (
                              <div key={field}>
                                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block">{PROPOSAL_FIELD_LABEL[field][locale]}</span>
                                <p className="text-xs text-slate-700 italic mt-0.5">"{prop[field] || "N/A"}"</p>
                              </div>
                            ))}
                          </div>
                        );
                      })()}

                      {slaCheckResults[prop.id] !== undefined && (
                        slaCheckResults[prop.id].length === 0 ? (
                          <div className="flex items-center gap-2 text-xs text-success-700 bg-success-50 border border-success-200 rounded-lg p-3">
                            <ShieldAlert size={14} />
                            {locale === "pt" ? "Nenhum risco histórico encontrado na Base de Conhecimento para os termos propostos." : "No historical risk found in the Knowledge Base for the proposed terms."}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <h4 className="text-xs uppercase font-bold text-warning-700 tracking-wider font-mono">{locale === "pt" ? "Riscos de SLA Sinalizados pela Base de Conhecimento" : "SLA Risks Flagged by the Knowledge Base"}</h4>
                            {slaCheckResults[prop.id].map((risk, i) => (
                              <div key={i} className={`text-xs rounded-lg p-3 border ${
                                risk.severity === "high" ? "bg-danger-50 border-danger-200 text-danger-800" :
                                risk.severity === "medium" ? "bg-warning-50 border-warning-200 text-warning-800" :
                                "bg-slate-50 border-slate-200 text-slate-700"
                              }`}>
                                <p className="font-bold uppercase text-[10px] tracking-wider mb-1">
                                  {risk.severity === "high" ? (locale === "pt" ? "Alto" : "High") : risk.severity === "medium" ? (locale === "pt" ? "Médio" : "Medium") : (locale === "pt" ? "Baixo" : "Low")}
                                </p>
                                <p className="italic mb-1">"{risk.term_excerpt}"</p>
                                <p className="mb-1">{risk.risk_description}</p>
                                <p className="text-[10px] opacity-75">{locale === "pt" ? "Lição relacionada:" : "Related lesson:"} {risk.related_lesson}</p>
                              </div>
                            ))}
                          </div>
                        )
                      )}

                      {revisao[prop.id] && (
                        <div className="mt-3 border-t border-slate-200 pt-3">
                          <p className="text-[10px] uppercase font-bold text-slate-400 font-mono mb-2">
                            {locale === "pt" ? "Revisão do documento" : "Document review"}
                          </p>
                          {revisao[prop.id]!.total === 0 ? (
                            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
                              {locale === "pt"
                                ? "Documento conferido: nenhum marcador de variável sobrou, a soma da precificação bate com o total e os itens do BOM estão no documento."
                                : "Document checked: no placeholder left behind, pricing adds up to the stated total, and BOM items are present."}
                            </p>
                          ) : (
                            <ul className="space-y-1.5">
                              {revisao[prop.id]!.achados.map((achado, i) => (
                                <li
                                  key={i}
                                  className={`text-xs rounded p-2 border ${achado.severidade === "alta" ? "bg-red-50 border-red-200 text-red-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}
                                >
                                  {achado.descricao}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                      {sugestoes[prop.id] && sugestoes[prop.id].length > 0 && (
                        <div className="mt-3 border-t border-slate-200 pt-3">
                          <p className="text-[10px] uppercase font-bold text-slate-400 font-mono mb-2">
                            {locale === "pt" ? "Sugestões de conteúdo (revise antes de aplicar)" : "Content suggestions (review before applying)"}
                          </p>
                          <ul className="space-y-2">
                            {sugestoes[prop.id].map((sg) => (
                              <li key={sg.variavel} className="text-xs bg-slate-50 border border-slate-200 rounded p-2">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="font-mono font-bold text-slate-600">
                                    {`{{${sg.variavel}}}`}
                                    <span className="ml-2 font-normal text-slate-400">
                                      {sg.origem === "variavel_livre"
                                        ? (locale === "pt" ? "campo livre do template" : "free template field")
                                        : (locale === "pt" ? "seção sem conteúdo na análise" : "section missing from analysis")}
                                    </span>
                                  </span>
                                  <button
                                    onClick={(e) => { e.preventDefault(); aplicarSugestao(prop.id, sg.variavel, sg.valor_sugerido); }}
                                    disabled={aplicandoCampo === `${prop.id}-${sg.variavel}`}
                                    className="bg-brand-600 hover:bg-brand-700 text-white font-mono text-[10px] font-bold px-2 py-1 rounded disabled:opacity-50 cursor-pointer shrink-0"
                                  >
                                    {aplicandoCampo === `${prop.id}-${sg.variavel}`
                                      ? (locale === "pt" ? "Aplicando..." : "Applying...")
                                      : (locale === "pt" ? "Aplicar" : "Apply")}
                                  </button>
                                </div>
                                <p className="text-slate-700 whitespace-pre-wrap">{sg.valor_sugerido}</p>
                                {sg.justificativa && (
                                  <p className="text-[11px] text-slate-400 mt-1">{sg.justificativa}</p>
                                )}
                              </li>
                            ))}
                          </ul>
                          <p className="text-[11px] text-slate-400 mt-2">
                            {locale === "pt"
                              ? "Aplicar grava o texto na proposta. O documento passa a mostrá-lo na próxima geração."
                              : "Applying stores the text on the proposal. The document shows it on the next generation."}
                          </p>
                        </div>
                      )}
                      {opinionRuns[prop.id] && (
                        <div className="space-y-2">
                          <h4 className="text-xs uppercase font-bold text-brand-700 tracking-wider font-mono flex items-center gap-1.5">
                            <Sparkles size={12} />
                            {locale === "pt" ? "Pareceres de IA Multi-Perspectiva" : "Multi-Perspective AI Opinions"}
                            {opinionRuns[prop.id]!.status === "partial" && (
                              <span className="text-[9px] font-bold text-warning-700 bg-warning-50 border border-warning-200 px-1.5 py-0.5 rounded-full normal-case tracking-normal">
                                {locale === "pt" ? "parcial" : "partial"}
                              </span>
                            )}
                          </h4>

                          {/*
                            * F7: a COMPARAÇÃO CONTRA A RODADA ANTERIOR.
                            *
                            * Sem estes três números, revisar de novo é um ato de fé: "sanados 4,
                            * parciais 1, novos 0" e "sanados 0, parciais 1, novos 6" são duas
                            * situações opostas que a lista de apontamentos sozinha não distingue.
                            * A primeira rodada de uma proposta aparece dizendo que não há com que
                            * comparar, em vez de três zeros - que se leriam como "nada mudou".
                            */}
                          {comparacoes[prop.id] !== undefined && (
                            comparacoes[prop.id] === null ? (
                              <p className="text-[10px] text-slate-400 italic">
                                {locale === "pt"
                                  ? "Primeira rodada desta proposta — não há revisão anterior com que comparar."
                                  : "First run for this proposal — no previous review to compare against."}
                              </p>
                            ) : (
                              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                                <p className="text-[9px] uppercase font-bold text-slate-500 tracking-wider font-mono mb-1.5 flex items-center gap-1">
                                  <ListChecks size={10} />
                                  {locale === "pt" ? "Contra a revisão anterior" : "Against the previous review"}
                                  <span className="normal-case tracking-normal font-normal text-slate-400">
                                    {" "}({new Date(comparacoes[prop.id]!.rodada_anterior.created_at).toLocaleString(locale === "pt" ? "pt-BR" : "en-US")})
                                  </span>
                                </p>
                                {!comparacoes[prop.id]!.comparavel ? (
                                  <p className="text-[10px] text-slate-500 italic">
                                    {locale === "pt"
                                      ? "A revisão anterior é de antes dos apontamentos estruturados: todo apontamento apareceria como novo, o que é verdade e ao mesmo tempo inútil. Gere outra revisão para ter comparação."
                                      : "The previous run predates structured findings: every finding would show as new, which is true and useless at once. Generate another review to get a comparison."}
                                  </p>
                                ) : (
                                  <>
                                    <div className="flex flex-wrap gap-3">
                                      <span className="text-[11px] font-mono">
                                        <span className="font-bold text-success-700 text-sm">{comparacoes[prop.id]!.totais.sanados}</span>
                                        <span className="text-slate-500"> {locale === "pt" ? "sanados" : "remediated"}</span>
                                      </span>
                                      <span className="text-[11px] font-mono">
                                        <span className="font-bold text-warning-700 text-sm">{comparacoes[prop.id]!.totais.parciais}</span>
                                        <span className="text-slate-500"> {locale === "pt" ? "parciais" : "partial"}</span>
                                      </span>
                                      <span className="text-[11px] font-mono">
                                        <span className="font-bold text-danger-700 text-sm">{comparacoes[prop.id]!.totais.novos}</span>
                                        <span className="text-slate-500"> {locale === "pt" ? "novos" : "new"}</span>
                                      </span>
                                      <span className="text-[10px] text-slate-400 font-mono self-center">
                                        {locale === "pt" ? "de" : "of"} {comparacoes[prop.id]!.totais.abertos_na_rodada_anterior} {locale === "pt" ? "abertos antes" : "open before"}
                                      </span>
                                    </div>
                                    {comparacoes[prop.id]!.sanados.length > 0 && (
                                      <p className="mt-1.5 text-[10px] text-slate-500">
                                        <span className="font-bold text-success-700">{locale === "pt" ? "Sanados:" : "Remediated:"}</span>{" "}
                                        {comparacoes[prop.id]!.sanados.map((f) => f.title).join(" · ")}
                                      </p>
                                    )}
                                    {comparacoes[prop.id]!.parciais.length > 0 && (
                                      <p className="mt-0.5 text-[10px] text-slate-500">
                                        <span className="font-bold text-warning-700">{locale === "pt" ? "Continuam:" : "Still standing:"}</span>{" "}
                                        {comparacoes[prop.id]!.parciais.map((f) => f.title).join(" · ")}
                                      </p>
                                    )}
                                    <p className="mt-1.5 text-[9px] text-slate-400 italic">
                                      {locale === "pt"
                                        ? "Um apontamento é reconhecido como o mesmo quando a IA declara o vínculo com o da revisão anterior (id revalidado pelo servidor) ou, na falta dele, quando aponta a mesma seção com título semelhante."
                                        : "A finding is matched when the AI declares the link to the previous run's finding (id revalidated server-side) or, failing that, when it targets the same section with a similar title."}
                                    </p>
                                  </>
                                )}
                              </div>
                            )
                          )}

                          <div className="grid grid-cols-2 gap-2">
                            {OPINION_PERSPECTIVES.map((perspective) => {
                              const item = opinionRuns[prop.id]!.opinions.find((o) => o.perspective === perspective);
                              const label = OPINION_PERSPECTIVE_LABEL[perspective][locale];
                              const { icon: PerspectiveIcon, iconBg, iconColor } = OPINION_PERSPECTIVE_STYLE[perspective];
                              if (!item || item.status === "failed") {
                                return (
                                  <div key={perspective} className="text-xs rounded-lg p-3 border bg-slate-50 border-slate-200 text-slate-400 italic flex items-start gap-2">
                                    <span className="shrink-0 rounded-full p-1.5 bg-slate-100 text-slate-400">
                                      <PerspectiveIcon size={14} />
                                    </span>
                                    <div>
                                      <p className="font-bold uppercase text-[10px] tracking-wider mb-1 not-italic text-slate-500">{label}</p>
                                      {locale === "pt" ? "Indisponível" : "Unavailable"}
                                    </div>
                                  </div>
                                );
                              }
                              const severityKey = item.severity === "critical" ? "critical" : item.severity === "warning" ? "warning" : "none";
                              const severityLabel = item.severity === "critical"
                                ? (locale === "pt" ? "crítico" : "critical")
                                : item.severity === "warning"
                                  ? (locale === "pt" ? "atenção" : "warning")
                                  : null;
                              return (
                                <details key={perspective} className={`text-xs rounded-lg p-3 border bg-white border-slate-200 text-slate-700 ${OPINION_SEVERITY_BORDER[severityKey]}`}>
                                  <summary className="cursor-pointer flex items-start gap-2">
                                    <span className={`shrink-0 rounded-full p-1.5 ${iconBg} ${iconColor}`}>
                                      <PerspectiveIcon size={14} />
                                    </span>
                                    <span className="flex-1">
                                      <span className="font-bold uppercase text-[10px] tracking-wider flex items-center gap-1.5">
                                        {label}
                                        {severityLabel && (
                                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full normal-case tracking-normal ${severityKey === "critical" ? "bg-danger-50 text-danger-700 border border-danger-200" : "bg-warning-50 text-warning-700 border border-warning-200"}`}>
                                            {severityLabel}
                                          </span>
                                        )}
                                      </span>
                                      <span className="block mt-0.5 font-normal normal-case tracking-normal">{item.summary}</span>
                                    </span>
                                  </summary>
                                  <p className="mt-2 whitespace-pre-wrap pl-8">{item.content}</p>

                                  {/*
                                    * F6: os apontamentos deste parecer. Cada um se dirime sozinho.
                                    *
                                    * Uma rodada gerada antes desta fase (logicVersion 1) chega com
                                    * a lista vazia, e a tela diz isso com todas as letras: "esta
                                    * rodada é anterior aos apontamentos" não é a mesma informação
                                    * que "este parecer não achou nada", e confundir as duas faria
                                    * um parecer velho parecer aprovado.
                                    */}
                                  {(item.findings || []).length === 0 ? (
                                    <p className="mt-2 pl-8 text-[10px] text-slate-400 italic">
                                      {(opinionRuns[prop.id]!.logic_version ?? 1) < 2
                                        ? (locale === "pt" ? "Rodada anterior aos apontamentos estruturados — gere os pareceres de novo para obtê-los." : "Run predates structured findings — regenerate the opinions to get them.")
                                        : (locale === "pt" ? "Nenhum apontamento nesta perspectiva." : "No findings from this perspective.")}
                                    </p>
                                  ) : (
                                    <ul className="mt-2 pl-8 space-y-2">
                                      {(item.findings || []).map((finding) => (
                                        <li key={finding.id} className={`rounded border p-2 ${finding.status === "descartado" ? "opacity-60" : ""} ${finding.severity === "critical" ? "border-danger-200 bg-danger-50/40" : finding.severity === "warning" ? "border-warning-200 bg-warning-50/40" : "border-slate-200 bg-slate-50/60"}`}>
                                          <div className="flex items-start justify-between gap-2">
                                            <p className="font-bold text-[11px] text-slate-700 flex-1">{finding.title}</p>
                                            <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${FINDING_STATUS_STYLE[finding.status]}`}>
                                              {FINDING_STATUS_LABEL[finding.status][locale]}
                                            </span>
                                          </div>
                                          <p className="mt-1 text-[11px] text-slate-600">{finding.detail}</p>
                                          {finding.target_key && (
                                            <p className="mt-1 text-[9px] font-mono uppercase tracking-wider text-slate-400">
                                              {locale === "pt" ? "Seção" : "Section"}: {finding.target_key}
                                            </p>
                                          )}
                                          {finding.resolution_note && (
                                            <p className="mt-1 text-[10px] text-slate-500 italic border-l-2 border-slate-300 pl-2">
                                              {locale === "pt" ? "Justificativa" : "Rationale"}: {finding.resolution_note}
                                            </p>
                                          )}

                                          {/*
                                            * F7: o veredito de SANAÇÃO, ao lado do status e nunca
                                            * no lugar dele. Ele diz o que a IA achou da edição que
                                            * a pessoa fez; fechar o apontamento continua sendo o
                                            * clique em "Resolvido", que carimba autor e instante.
                                            */}
                                          {finding.remediation_verdict && (
                                            <div className="mt-1.5 flex items-start gap-1.5">
                                              <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${REMEDIATION_LABEL[finding.remediation_verdict]?.classe ?? ""}`}>
                                                {REMEDIATION_LABEL[finding.remediation_verdict]?.[locale] ?? finding.remediation_verdict}
                                              </span>
                                              {finding.remediation_note && (
                                                <span className="text-[10px] text-slate-500 italic">{finding.remediation_note}</span>
                                              )}
                                            </div>
                                          )}
                                          {finding.previous_finding_id && (
                                            <p className="mt-1 text-[9px] text-slate-400 font-mono uppercase tracking-wider">
                                              {locale === "pt" ? "continua um apontamento da revisão anterior" : "continues a finding from the previous review"}
                                            </p>
                                          )}

                                          {finding.suggested_value && finding.target_key && prop.status === "draft" && hasPermission("proposal:edit") && (
                                            <div className="mt-2 p-2 rounded border border-brand-200 bg-brand-50/50">
                                              <p className="text-[9px] uppercase font-bold text-brand-700 tracking-wider font-mono mb-1">
                                                {locale === "pt" ? "Texto sugerido para esta seção" : "Suggested text for this section"}
                                              </p>
                                              <p className="italic text-slate-600 mb-2 text-[11px] whitespace-pre-wrap">{finding.suggested_value}</p>
                                              <button
                                                onClick={(e) => { e.preventDefault(); void aplicarTextoDoApontamento(prop.id, finding, finding.suggested_value!, "ia"); }}
                                                disabled={aplicandoApontamento === finding.id}
                                                className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white font-mono text-[10px] font-bold px-2.5 py-1 rounded transition-all disabled:opacity-50 cursor-pointer"
                                              >
                                                <CheckCircle2 size={11} />
                                                {aplicandoApontamento === finding.id
                                                  ? (locale === "pt" ? "Aplicando..." : "Applying...")
                                                  : (locale === "pt" ? "Aplicar na seção" : "Apply to section")}
                                              </button>
                                            </div>
                                          )}

                                          {prop.status === "draft" && hasPermission("proposal:edit") && (
                                            findingEmJustificativa?.id === finding.id ? (
                                              <div className="mt-2 p-2 rounded border border-warning-200 bg-warning-50/60">
                                                <label className="text-[9px] uppercase font-bold text-warning-800 tracking-wider font-mono block mb-1">
                                                  {findingEmJustificativa.status === "aceito_com_risco"
                                                    ? (locale === "pt" ? "Por que seguir assim mesmo? (obrigatório)" : "Why proceed anyway? (required)")
                                                    : (locale === "pt" ? "Por que este apontamento não procede? (obrigatório)" : "Why doesn't this finding apply? (required)")}
                                                </label>
                                                <textarea
                                                  value={justificativa}
                                                  onChange={(e) => setJustificativa(e.target.value)}
                                                  rows={2}
                                                  className="w-full p-1.5 rounded border border-warning-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-warning-500 resize-none"
                                                />
                                                <div className="flex gap-1.5 mt-1.5">
                                                  <button
                                                    onClick={(e) => { e.preventDefault(); void mudarStatusDoApontamento(prop.id, finding.id, findingEmJustificativa.status, justificativa); }}
                                                    disabled={salvandoFinding === finding.id}
                                                    className="bg-warning-600 hover:bg-warning-700 text-white font-mono text-[10px] font-bold px-2.5 py-1 rounded disabled:opacity-50 cursor-pointer"
                                                  >
                                                    {salvandoFinding === finding.id ? (locale === "pt" ? "Salvando..." : "Saving...") : (locale === "pt" ? "Confirmar" : "Confirm")}
                                                  </button>
                                                  <button
                                                    onClick={(e) => { e.preventDefault(); setFindingEmJustificativa(null); setJustificativa(""); }}
                                                    className="text-slate-500 hover:bg-slate-100 font-mono text-[10px] font-bold px-2.5 py-1 rounded cursor-pointer"
                                                  >
                                                    {locale === "pt" ? "Cancelar" : "Cancel"}
                                                  </button>
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="flex flex-wrap gap-1.5 mt-2">
                                                {/*
                                                  * F7: só faz sentido para apontamento com seção -
                                                  * o veredito lê o par texto anterior/novo do
                                                  * histórico daquela seção, e um apontamento
                                                  * transversal ("geral") não tem esse par.
                                                  */}
                                                {finding.target_key && (
                                                  <button
                                                    onClick={(e) => { e.preventDefault(); void verificarSanacao(prop.id, finding.id); }}
                                                    disabled={verificandoSanacao === finding.id}
                                                    title={locale === "pt"
                                                      ? "A IA lê o texto anterior e o novo desta seção e diz se a edição endereçou este apontamento. O veredito é consultivo: fechar o apontamento continua sendo seu."
                                                      : "The AI reads this section's previous and new text and says whether the edit addressed this finding. The verdict is advisory: closing the finding is still yours."}
                                                    className="text-[9px] font-mono font-bold px-2 py-0.5 rounded border border-brand-200 bg-brand-50 text-brand-700 hover:brightness-95 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1"
                                                  >
                                                    <Sparkles size={9} />
                                                    {verificandoSanacao === finding.id
                                                      ? (locale === "pt" ? "Verificando..." : "Checking...")
                                                      : (locale === "pt" ? "Verificar sanação" : "Check remediation")}
                                                  </button>
                                                )}
                                                {(["em_tratativa", "resolvido", "aceito_com_risco", "descartado", "aberto"] as FindingStatus[])
                                                  .filter((alvo) => alvo !== finding.status)
                                                  .map((alvo) => (
                                                    <button
                                                      key={alvo}
                                                      onClick={(e) => { e.preventDefault(); pedirMudanca(prop.id, finding, alvo); }}
                                                      disabled={salvandoFinding === finding.id}
                                                      className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border transition-colors disabled:opacity-50 cursor-pointer hover:brightness-95 ${FINDING_STATUS_STYLE[alvo]}`}
                                                    >
                                                      {FINDING_STATUS_LABEL[alvo][locale]}
                                                    </button>
                                                  ))}
                                              </div>
                                            )
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  {item.suggested_field && item.suggested_value && prop.status === "draft" && hasPermission("proposal:edit") && (
                                    <div className="mt-2 ml-8 p-2 rounded border border-brand-200 bg-brand-50/50">
                                      <p className="text-[10px] uppercase font-bold text-brand-700 tracking-wider font-mono mb-1">
                                        {locale === "pt" ? "Sugestão de alteração:" : "Suggested change:"} {PROPOSAL_FIELD_LABEL[item.suggested_field][locale]}
                                      </p>
                                      <p className="italic text-slate-600 mb-2">"{item.suggested_value}"</p>
                                      <button
                                        onClick={(e) => { e.preventDefault(); applyOpinionSuggestion(prop.id, item.suggested_field!, item.suggested_value!); }}
                                        disabled={applyingSuggestionKey === `${prop.id}-${item.suggested_field}`}
                                        className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white font-mono text-[10px] font-bold px-2.5 py-1 rounded transition-all disabled:opacity-50 cursor-pointer"
                                      >
                                        <CheckCircle2 size={11} />
                                        {applyingSuggestionKey === `${prop.id}-${item.suggested_field}`
                                          ? (locale === "pt" ? "Aplicando..." : "Applying...")
                                          : (locale === "pt" ? "Aplicar" : "Apply")}
                                      </button>
                                    </div>
                                  )}
                                </details>
                              );
                            })}
                          </div>
                        </div>
                      )}

                    </div>
                  ))}
                </div>
              )}

              {editingProposal && (() => {
                const allowed = PROPOSAL_TYPE_EDITABLE_FIELDS[editingProposal.proposal_type].filter(
                  (f): f is Exclude<ProposalEditableField, "manual_pricing_table"> => f !== "manual_pricing_table"
                );
                return (
                  <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
                      <div className="flex items-center justify-between p-4 border-b border-slate-100">
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">
                          {locale === "pt" ? "Revisar e Editar Proposta" : "Review & Edit Proposal"}
                        </h3>
                        <button onClick={() => setEditingProposal(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                          <X size={18} />
                        </button>
                      </div>
                      {/*
                        * F6: as duas abas. TEXTO tem IA, TABELAS não - ver o comentário em
                        * `abaDoEditor` para por que a ausência ali é regra, não pendência.
                        */}
                      {(() => {
                        const temTabela = (PROPOSAL_TYPE_EDITABLE_FIELDS[editingProposal.proposal_type] as readonly string[]).includes("manual_pricing_table");
                        return (
                          <div className="flex border-b border-slate-100 px-4">
                            {([["texto", FileText], ["tabelas", Table2]] as const)
                              .filter(([aba]) => aba === "texto" || temTabela)
                              .map(([aba, Icone]) => (
                                <button
                                  key={aba}
                                  onClick={() => setAbaDoEditor(aba)}
                                  className={`flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase font-mono border-b-2 -mb-px transition-colors cursor-pointer ${abaDoEditor === aba ? "border-brand-600 text-brand-700" : "border-transparent text-slate-400 hover:text-slate-600"}`}
                                >
                                  <Icone size={12} />
                                  {aba === "texto" ? (locale === "pt" ? "Texto" : "Text") : (locale === "pt" ? "Tabelas" : "Tables")}
                                </button>
                              ))}
                          </div>
                        );
                      })()}

                      {abaDoEditor === "tabelas" ? (
                        <div className="flex-1 overflow-y-auto p-4">
                          <p className="text-xs text-slate-500 mb-3">
                            {locale === "pt"
                              ? "Edição manual da tabela de precificação. Esta aba não tem apoio de IA: item, quantidade e preço são compromisso comercial, e o produto nunca deixa um modelo escrevê-los."
                              : "Manual pricing-table editing. This tab has no AI support: item, quantity and price are commercial commitments, and the product never lets a model write them."}
                          </p>
                          <div className="overflow-x-auto">
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="text-left text-slate-400 font-mono uppercase text-[9px] tracking-wider">
                                  <th className="p-1.5">{locale === "pt" ? "Item" : "Item"}</th>
                                  <th className="p-1.5 w-20">{locale === "pt" ? "Qtd" : "Qty"}</th>
                                  <th className="p-1.5 w-28">{locale === "pt" ? "Unitário" : "Unit"}</th>
                                  <th className="p-1.5 w-20">{locale === "pt" ? "Desc. %" : "Disc. %"}</th>
                                  <th className="p-1.5 w-28">{locale === "pt" ? "Total" : "Total"}</th>
                                  <th className="p-1.5 w-8"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {linhasDePreco.map((linha, i) => (
                                  <tr key={linha.item_id || i} className="border-t border-slate-100">
                                    <td className="p-1.5">
                                      <input
                                        value={linha.product_or_service}
                                        onChange={(e) => setLinhasDePreco((atual) => atual.map((l, j) => j === i ? { ...l, product_or_service: e.target.value } : l))}
                                        className="w-full p-1 rounded border border-slate-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-brand-500"
                                      />
                                    </td>
                                    <td className="p-1.5">
                                      <input
                                        type="number"
                                        value={linha.quantity}
                                        onChange={(e) => setLinhasDePreco((atual) => atual.map((l, j) => {
                                          if (j !== i) return l;
                                          const quantity = Number(e.target.value);
                                          // O total é derivado, sempre: deixar a pessoa digitar um
                                          // total que não bate com qtd x preço criaria duas verdades
                                          // no mesmo documento.
                                          return { ...l, quantity, total_price: quantity * l.unit_price * (1 - (l.discount || 0) / 100) };
                                        }))}
                                        className="w-full p-1 rounded border border-slate-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-brand-500"
                                      />
                                    </td>
                                    <td className="p-1.5">
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={linha.unit_price}
                                        onChange={(e) => setLinhasDePreco((atual) => atual.map((l, j) => {
                                          if (j !== i) return l;
                                          const unit_price = Number(e.target.value);
                                          return { ...l, unit_price, total_price: l.quantity * unit_price * (1 - (l.discount || 0) / 100) };
                                        }))}
                                        className="w-full p-1 rounded border border-slate-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-brand-500"
                                      />
                                    </td>
                                    <td className="p-1.5">
                                      <input
                                        type="number"
                                        value={linha.discount ?? 0}
                                        onChange={(e) => setLinhasDePreco((atual) => atual.map((l, j) => {
                                          if (j !== i) return l;
                                          const discount = Number(e.target.value);
                                          return { ...l, discount, total_price: l.quantity * l.unit_price * (1 - discount / 100) };
                                        }))}
                                        className="w-full p-1 rounded border border-slate-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-brand-500"
                                      />
                                    </td>
                                    <td className="p-1.5 font-mono text-slate-600">{(linha.total_price ?? 0).toFixed(2)}</td>
                                    <td className="p-1.5">
                                      <button
                                        onClick={() => setLinhasDePreco((atual) => atual.filter((_, j) => j !== i))}
                                        className="text-slate-300 hover:text-danger-600 cursor-pointer"
                                        title={locale === "pt" ? "Remover linha" : "Remove row"}
                                      >
                                        <X size={13} />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                                {linhasDePreco.length === 0 && (
                                  <tr><td colSpan={6} className="p-3 text-center text-slate-400 italic text-[11px]">
                                    {locale === "pt" ? "Nenhuma linha. A tabela sai vazia do documento." : "No rows. The table renders empty in the document."}
                                  </td></tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          <button
                            onClick={() => setLinhasDePreco((atual) => [...atual, {
                              item_id: `linha-${Date.now()}`, product_or_service: "", specification: "",
                              quantity: 1, unit: "un", unit_price: 0, total_price: 0, currency: "BRL",
                              is_optional: false, discount: 0,
                            }])}
                            className="mt-3 text-[10px] font-mono font-bold uppercase text-brand-700 hover:bg-brand-50 border border-brand-200 px-2.5 py-1 rounded cursor-pointer"
                          >
                            {locale === "pt" ? "+ Adicionar linha" : "+ Add row"}
                          </button>
                        </div>
                      ) : (
                        <div className="flex-1 overflow-y-auto p-4 space-y-5">
                          {allowed.length === 0 && secoesDeTexto.length === 0 ? (
                            <p className="text-xs text-slate-500">
                              {locale === "pt"
                                ? `Documentos do tipo "${PROPOSAL_TYPE_LABEL[editingProposal.proposal_type].pt}" não têm campos comerciais editáveis, e o template desta proposta não usa nenhuma seção de texto livre.`
                                : `"${PROPOSAL_TYPE_LABEL[editingProposal.proposal_type].en}" documents have no editable commercial fields, and this proposal's template uses no free text section.`}
                            </p>
                          ) : (
                            <>
                              {allowed.length > 0 && (
                                <div className="space-y-4">
                                  <p className="text-xs text-slate-500">
                                    {locale === "pt"
                                      ? "Campos comerciais desta proposta. Ao salvar, o DOCX e o PDF são regenerados a partir do template real."
                                      : "This proposal's commercial fields. Saving regenerates the DOCX and PDF from the real template."}
                                  </p>
                                  {allowed.map((field) => (
                                    <div key={field}>
                                      <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider font-mono block mb-1">
                                        {PROPOSAL_FIELD_LABEL[field][locale]}
                                      </label>
                                      {field === "proposal_validity" ? (
                                        <input
                                          type="text"
                                          value={editedFields[field] || ""}
                                          onChange={(e) => setEditedFields((prev) => ({ ...prev, [field]: e.target.value }))}
                                          className="w-full p-2 rounded border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                                        />
                                      ) : (
                                        <textarea
                                          value={editedFields[field] || ""}
                                          onChange={(e) => setEditedFields((prev) => ({ ...prev, [field]: e.target.value }))}
                                          rows={3}
                                          className="w-full p-2 rounded border border-slate-200 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
                                        />
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {secoesDeTexto.length > 0 && (
                                <div className="space-y-4 pt-2 border-t border-slate-100">
                                  <p className="text-xs text-slate-500 pt-2">
                                    {locale === "pt"
                                      ? "Seções de texto do template. Salvar uma seção grava o texto e registra no histórico quem escreveu, quando e de onde veio."
                                      : "Template text sections. Saving a section records who wrote it, when, and where it came from."}
                                  </p>
                                  {secoesDeTexto.map((secao) => {
                                    const sugestao = sugestaoDaSecao[secao.nome];
                                    return (
                                      <div key={secao.nome} className="rounded-lg border border-slate-200 p-3">
                                        <div className="flex items-start justify-between gap-2 mb-1">
                                          <div className="flex-1">
                                            <p className="text-[10px] uppercase font-bold text-slate-600 tracking-wider font-mono">{secao.nome}</p>
                                            {secao.descricao && <p className="text-[10px] text-slate-400 mt-0.5">{secao.descricao}</p>}
                                          </div>
                                          <button
                                            onClick={() => void pedirSugestaoDaSecao(editingProposal.id, secao.nome)}
                                            disabled={sugerindoSecao === secao.nome}
                                            title={locale === "pt" ? "A IA recebe os apontamentos abertos desta seção como contexto e devolve um texto para você revisar - nada é gravado sem o seu clique." : "The AI receives this section's open findings as context and returns text for you to review - nothing is saved without your click."}
                                            className="shrink-0 flex items-center gap-1 text-[10px] font-mono font-bold uppercase text-brand-700 hover:bg-brand-50 border border-brand-200 px-2 py-1 rounded cursor-pointer disabled:opacity-50"
                                          >
                                            <Sparkles size={11} />
                                            {sugerindoSecao === secao.nome
                                              ? (locale === "pt" ? "Pedindo..." : "Asking...")
                                              : (locale === "pt" ? "Pedir sugestão à IA" : "Ask AI")}
                                          </button>
                                          {/*
                                            * F7: a GRAMÁTICA. Botão separado do "pedir sugestão" de
                                            * propósito - são coisas diferentes: aquele reescreve a
                                            * seção inteira e é tudo ou nada; este devolve correções
                                            * pontuais, cada uma com aceitar e recusar próprios.
                                            */}
                                          <button
                                            onClick={() => void revisarGramaticaDaSecao(editingProposal.id, secao.nome)}
                                            disabled={revisandoGramatica === secao.nome}
                                            title={locale === "pt" ? "A IA devolve correções pontuais de gramática e ortografia. Você aceita ou recusa uma a uma - aceitar muda só aquele trecho." : "The AI returns pointwise grammar and spelling corrections. You accept or reject each one - accepting changes only that snippet."}
                                            className="shrink-0 flex items-center gap-1 text-[10px] font-mono font-bold uppercase text-slate-600 hover:bg-slate-50 border border-slate-200 px-2 py-1 rounded cursor-pointer disabled:opacity-50"
                                          >
                                            <PenLine size={11} />
                                            {revisandoGramatica === secao.nome
                                              ? (locale === "pt" ? "Revisando..." : "Checking...")
                                              : (locale === "pt" ? "Gramática" : "Grammar")}
                                          </button>
                                        </div>

                                        {sugestao && (
                                          <div className="mb-2 p-2 rounded border border-brand-200 bg-brand-50/50">
                                            <p className="text-[9px] uppercase font-bold text-brand-700 tracking-wider font-mono mb-1">
                                              {locale === "pt" ? "Sugestão da IA" : "AI suggestion"}
                                              {sugestao.apontamentos.length > 0 && (
                                                <span className="normal-case tracking-normal font-normal text-slate-500">
                                                  {" "}({locale === "pt" ? "considerou" : "considered"} {sugestao.apontamentos.length} {locale === "pt" ? "apontamento(s)" : "finding(s)"})
                                                </span>
                                              )}
                                            </p>
                                            {sugestao.o_que_mudou && <p className="text-[10px] text-slate-600 italic mb-1">{sugestao.o_que_mudou}</p>}
                                            <button
                                              onClick={() => setTextoDaSecao((atual) => ({ ...atual, [secao.nome]: sugestao.texto_sugerido }))}
                                              className="text-[10px] font-mono font-bold uppercase bg-brand-600 hover:bg-brand-700 text-white px-2 py-0.5 rounded cursor-pointer"
                                            >
                                              {locale === "pt" ? "Usar este texto" : "Use this text"}
                                            </button>
                                          </div>
                                        )}

                                        {/*
                                          * F7: as correções pontuais, destacadas EM COR dentro do
                                          * próprio texto, com aceitar e recusar por item.
                                          *
                                          * O texto é fatiado pelos offsets que o servidor devolveu
                                          * - por isso ele fica ao lado do textarea e não dentro
                                          * dele: um textarea não colore trecho. Aceitar aplica só
                                          * aquele trecho e reposiciona os demais; recusar remove o
                                          * item e não toca no texto.
                                          */}
                                        {correcoesDaSecao[secao.nome] && (
                                          <div className="mb-2 p-2 rounded border border-slate-200 bg-slate-50/70">
                                            <p className="text-[9px] uppercase font-bold text-slate-600 tracking-wider font-mono mb-1.5">
                                              {locale === "pt" ? "Revisão gramatical" : "Grammar review"}
                                              <span className="normal-case tracking-normal font-normal text-slate-500">
                                                {" "}— {correcoesDaSecao[secao.nome]!.correcoes.length}{" "}
                                                {locale === "pt" ? "correção(ões) pendente(s)" : "pending correction(s)"}
                                                {correcoesDaSecao[secao.nome]!.descartadas > 0 && (
                                                  <span className="text-slate-400">
                                                    {" "}({correcoesDaSecao[secao.nome]!.descartadas}{" "}
                                                    {locale === "pt" ? "descartada(s): trecho não localizado no texto" : "discarded: snippet not found in the text"})
                                                  </span>
                                                )}
                                              </span>
                                            </p>
                                            {correcoesDaSecao[secao.nome]!.correcoes.length === 0 ? (
                                              <p className="text-[10px] text-slate-500 italic">
                                                {locale === "pt" ? "Nada pendente nesta seção." : "Nothing pending in this section."}
                                              </p>
                                            ) : (
                                              <>
                                                <p className="text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap mb-2 p-2 bg-white rounded border border-slate-200 max-h-40 overflow-y-auto">
                                                  {(() => {
                                                    const { texto_base, correcoes } = correcoesDaSecao[secao.nome]!;
                                                    const pedacos: React.ReactNode[] = [];
                                                    let cursor = 0;
                                                    for (const c of correcoes) {
                                                      if (c.offset > cursor) pedacos.push(<span key={`t${c.id}`}>{texto_base.slice(cursor, c.offset)}</span>);
                                                      pedacos.push(
                                                        <mark key={c.id} className="bg-warning-100 text-warning-900 border-b-2 border-warning-400 rounded-sm px-0.5">
                                                          {c.trecho_original}
                                                        </mark>
                                                      );
                                                      cursor = c.offset + c.trecho_original.length;
                                                    }
                                                    pedacos.push(<span key="fim">{texto_base.slice(cursor)}</span>);
                                                    return pedacos;
                                                  })()}
                                                </p>
                                                <ul className="space-y-1.5">
                                                  {correcoesDaSecao[secao.nome]!.correcoes.map((c) => (
                                                    <li key={c.id} className="flex items-start gap-2 text-[10px]">
                                                      <span className="flex-1">
                                                        <span className="bg-danger-50 text-danger-700 line-through px-1 rounded">{c.trecho_original}</span>
                                                        {" → "}
                                                        <span className="bg-success-50 text-success-700 px-1 rounded font-medium">{c.trecho_corrigido}</span>
                                                        {c.motivo && <span className="text-slate-400 italic"> — {c.motivo}</span>}
                                                      </span>
                                                      <button
                                                        onClick={() => decidirCorrecao(secao.nome, c, true)}
                                                        className="shrink-0 text-[9px] font-mono font-bold uppercase bg-success-600 hover:bg-success-700 text-white px-2 py-0.5 rounded cursor-pointer"
                                                      >
                                                        {locale === "pt" ? "Aceitar" : "Accept"}
                                                      </button>
                                                      <button
                                                        onClick={() => decidirCorrecao(secao.nome, c, false)}
                                                        className="shrink-0 text-[9px] font-mono font-bold uppercase text-slate-500 hover:bg-slate-100 border border-slate-200 px-2 py-0.5 rounded cursor-pointer"
                                                      >
                                                        {locale === "pt" ? "Recusar" : "Reject"}
                                                      </button>
                                                    </li>
                                                  ))}
                                                </ul>
                                                <p className="mt-1.5 text-[9px] text-slate-400 italic">
                                                  {locale === "pt"
                                                    ? "Aceitar muda o texto abaixo; salvar a seção é que grava."
                                                    : "Accepting edits the text below; saving the section is what persists it."}
                                                </p>
                                              </>
                                            )}
                                          </div>
                                        )}

                                        <textarea
                                          value={textoDaSecao[secao.nome] ?? ""}
                                          onChange={(e) => setTextoDaSecao((atual) => ({ ...atual, [secao.nome]: e.target.value }))}
                                          rows={4}
                                          placeholder={locale === "pt" ? "Vazio: a seção sai como a análise a deixou." : "Empty: the section renders as the analysis left it."}
                                          className="w-full p-2 rounded border border-slate-200 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-brand-500 resize-y"
                                        />
                                        <button
                                          onClick={() => void salvarSecao(editingProposal.id, secao.nome)}
                                          disabled={salvandoSecao === secao.nome}
                                          className="mt-1.5 text-[10px] font-mono font-bold uppercase bg-slate-700 hover:bg-slate-800 text-white px-2.5 py-1 rounded cursor-pointer disabled:opacity-50"
                                        >
                                          {salvandoSecao === secao.nome
                                            ? (locale === "pt" ? "Salvando..." : "Saving...")
                                            : (locale === "pt" ? "Salvar seção" : "Save section")}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/*
                                * F7: a COERÊNCIA ENTRE SEÇÕES, por IA - contradição entre o que uma
                                * seção afirma e outra nega.
                                *
                                * A coerência NUMÉRICA não está aqui e não deve estar: soma de itens
                                * contra total, item do BOM ausente e placeholder esquecido são
                                * conferidos exatamente, sem IA, em "Revisão do documento"
                                * (GET /proposals/:id/revisao). O aviso abaixo diz isso na tela para
                                * que ninguém leia esta lista como conferência de conta.
                                */}
                              {secoesDeTexto.length > 1 && (
                                <div className="pt-2 border-t border-slate-100">
                                  <div className="flex items-center justify-between gap-2 pt-2 mb-2">
                                    <h4 className="text-[10px] uppercase font-bold text-slate-500 tracking-wider font-mono flex items-center gap-1.5">
                                      <ListChecks size={11} />
                                      {locale === "pt" ? "Coerência entre seções" : "Cross-section coherence"}
                                    </h4>
                                    <button
                                      onClick={() => void verificarCoerencia(editingProposal.id)}
                                      disabled={verificandoCoerencia}
                                      title={locale === "pt" ? "A IA procura contradição entre o que uma seção afirma e outra nega. Número, total e prazo NÃO passam por aqui - são conferidos exatamente na Revisão do documento." : "The AI looks for contradictions between what one section states and another denies. Numbers, totals and deadlines do NOT go through here - they are checked exactly in the document review."}
                                      className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase text-brand-700 hover:bg-brand-50 border border-brand-200 px-2 py-1 rounded cursor-pointer disabled:opacity-50"
                                    >
                                      <Sparkles size={11} />
                                      {verificandoCoerencia
                                        ? (locale === "pt" ? "Verificando..." : "Checking...")
                                        : (locale === "pt" ? "Verificar coerência" : "Check coherence")}
                                    </button>
                                  </div>
                                  {coerencia && (
                                    coerencia.achados.length === 0 ? (
                                      <p className="text-[10px] text-success-700">
                                        {locale === "pt"
                                          ? `Nenhuma contradição encontrada entre as ${coerencia.secoes.length} seções avaliadas.`
                                          : `No contradiction found across the ${coerencia.secoes.length} sections reviewed.`}
                                      </p>
                                    ) : (
                                      <ul className="space-y-1.5">
                                        {coerencia.achados.map((a, i) => (
                                          <li key={i} className={`rounded border p-2 text-[10px] ${a.severidade === "critical" ? "border-danger-200 bg-danger-50/40" : a.severidade === "warning" ? "border-warning-200 bg-warning-50/40" : "border-slate-200 bg-slate-50/60"}`}>
                                            <p className="font-bold text-[11px] text-slate-700">{a.contradicao}</p>
                                            <p className="mt-0.5 text-slate-600">{a.detalhe}</p>
                                            <p className="mt-1 font-mono uppercase tracking-wider text-[9px] text-slate-400">
                                              {a.secao_a} ↔ {a.secao_b}
                                            </p>
                                          </li>
                                        ))}
                                      </ul>
                                    )
                                  )}
                                  <p className="mt-1.5 text-[9px] text-slate-400 italic">
                                    {locale === "pt"
                                      ? "Só texto. Soma de itens, total e item de material são conferidos exatamente, sem IA, na Revisão do documento."
                                      : "Text only. Line totals, grand total and BOM items are checked exactly, without AI, in the document review."}
                                  </p>
                                </div>
                              )}

                              {/* F6: o histórico por seção - autor, instante, origem e apontamento. */}
                              {historicoDeSecoes.length > 0 && (
                                <div className="pt-2 border-t border-slate-100">
                                  <h4 className="text-[10px] uppercase font-bold text-slate-500 tracking-wider font-mono flex items-center gap-1.5 pt-2 mb-2">
                                    <History size={11} />
                                    {locale === "pt" ? "Histórico por seção" : "Section history"}
                                  </h4>
                                  <ul className="space-y-1.5">
                                    {historicoDeSecoes.map((h) => (
                                      <li key={h.id} className="text-[10px] text-slate-500 border-l-2 border-slate-200 pl-2">
                                        <span className="font-mono font-bold text-slate-600">{h.target_key}</span>
                                        {" · "}
                                        <span className={h.origin === "humano" ? "text-slate-600" : h.origin === "ia" ? "text-brand-700" : "text-brand-600"}>
                                          {h.origin === "humano" ? (locale === "pt" ? "humano" : "human") : h.origin === "ia" ? "IA" : (locale === "pt" ? "IA editada" : "AI edited")}
                                        </span>
                                        {" · "}
                                        {h.author_name}
                                        {" · "}
                                        {new Date(h.created_at).toLocaleString(locale === "pt" ? "pt-BR" : "en-US")}
                                        {h.finding && (
                                          <span className="block text-slate-400 italic">
                                            <ListChecks size={9} className="inline mr-1" />
                                            {locale === "pt" ? "motivado por" : "motivated by"}: {h.finding.title}
                                          </span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                      <div className="flex justify-end gap-2 p-4 border-t border-slate-100">
                        <button
                          onClick={() => setEditingProposal(null)}
                          className="px-4 py-2 text-xs font-bold uppercase text-slate-500 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                        >
                          {locale === "pt" ? "Cancelar" : "Cancel"}
                        </button>
                        {allowed.length > 0 && (
                          <button
                            onClick={saveEditedFields}
                            disabled={savingEdit}
                            className="px-4 py-2 text-xs font-bold uppercase bg-brand-600 hover:bg-brand-700 text-white rounded transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {savingEdit ? (locale === "pt" ? "Salvando..." : "Saving...") : (locale === "pt" ? "Salvar e Regenerar Documento" : "Save & Regenerate Document")}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {previewingProposalId && (
                <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                    <div className="flex items-center justify-between p-4 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">
                          {locale === "pt" ? "Pré-visualização do Documento" : "Document Preview"}
                        </h3>
                        <div className="flex rounded border border-slate-200 overflow-hidden ml-2">
                          {(["docx", "pdf"] as const).map((fmt) => (
                            <button
                              key={fmt}
                              onClick={() => openPreview(previewingProposalId, fmt)}
                              className={`px-2.5 py-1 text-[10px] font-bold uppercase font-mono cursor-pointer ${previewFormat === fmt ? "bg-brand-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
                            >
                              {fmt}
                            </button>
                          ))}
                        </div>
                      </div>
                      <button onClick={closePreview} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                        <X size={18} />
                      </button>
                    </div>
                    <div className="flex-1 min-h-[60vh] overflow-y-auto bg-slate-100">
                      {previewLoading && (
                        <div className="h-full flex items-center justify-center text-xs text-slate-400 font-mono">
                          {locale === "pt" ? "Carregando documento..." : "Loading document..."}
                        </div>
                      )}
                      {previewError && (
                        <div className="h-full flex items-center justify-center text-xs text-danger-600 font-mono p-4 text-center">{previewError}</div>
                      )}
                      {!previewLoading && !previewError && previewFormat === "docx" && previewDocxHtml && (
                        <div
                          className="bg-white max-w-3xl mx-auto my-6 p-10 shadow-sm text-sm leading-relaxed prose prose-sm"
                          dangerouslySetInnerHTML={{ __html: previewDocxHtml }}
                        />
                      )}
                      {!previewLoading && !previewError && previewFormat === "pdf" && previewPdfUrl && (
                        <iframe title="pdf-preview" src={previewPdfUrl} className="w-full h-full min-h-[70vh] border-0" />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
  );
}
