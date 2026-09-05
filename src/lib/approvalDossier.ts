/*
 * F8: os tipos do DOSSIÊ DO APROVADOR, e o carregamento dele.
 *
 * Um `fetch` só para as quatro abas: elas abrem juntas, sobre a mesma proposta, e quatro
 * requisições concorrentes produziriam abas que carregam em ordens diferentes e falham em
 * separado. O gate do servidor também é um só (GET /proposals/:id/dossie-de-aprovacao recusa com
 * 403 quem não é aprovador designado nem tem `proposal:approve`).
 */

export interface DossieFinding {
  id: string;
  ordinal: number;
  title: string;
  detail: string;
  severity: string;
  target_kind: string;
  target_key: string | null;
  status: string;
  resolution_note: string | null;
  resolved_at: string | null;
  origem?: string;
  remediation_verdict?: string | null;
  remediation_note?: string | null;
}

export interface DossieOpinion {
  id: string;
  perspective: string;
  status: string;
  severity: string | null;
  summary: string;
  content: string;
  provider_used: string | null;
  model_used: string | null;
  findings: DossieFinding[];
}

export interface DossieDecisao {
  id: string;
  proposal_id: string;
  stage_id: string;
  stage_name: string;
  decision: string;
  comments: string;
  created_at: string;
  approver_user_id: string;
  approver_name: string;
  items: { id: string; ordinal: number; target_kind: string; target_key: string | null; comment: string; section_snapshot: string | null }[];
}

export interface DossieSecao {
  target_kind: string;
  target_key: string;
  label: string;
  texto_atual: string | null;
}

export interface DossieDeAprovacao {
  success: true;
  proposal: {
    id: string;
    version: number;
    status: string;
    proposal_type: string;
    project_id: string;
    project_name: string;
    previous_version_id: string | null;
    proposal_group_id: string;
    approval_workflow_id: string | null;
    generated_at: string;
    generated_by: string;
    has_docx: boolean;
    has_pdf: boolean;
  };
  acesso: { designado: boolean; pode_aprovar: boolean };
  verificacoes: {
    disponivel: boolean;
    erro: string | null;
    achados: { tipo: string; severidade: string; descricao: string }[];
    total: number;
    bloqueantes: number;
  };
  pareceres: {
    run: { id: string; status: string; logic_version: number; created_at: string; completed_at: string | null; opinions: DossieOpinion[] } | null;
    rodada_do_aprovador: { id: string; origem: string; created_at: string; total: number; abertos: number; findings: DossieFinding[] } | null;
  };
  secoes: DossieSecao[];
  versoes: {
    cadeia: { id: string; version: number; status: string; proposal_type: string; generated_at: string; generated_by: string; previous_version_id: string | null; e_a_atual: boolean }[];
    decisoes: DossieDecisao[];
    edicoes_de_secao: {
      id: string;
      target_kind: string;
      target_key: string | null;
      previous_value: string | null;
      new_value: string | null;
      origin: string;
      created_at: string;
      author_name: string;
      finding: { id: string; title: string; severity: string; origem?: string } | null;
    }[];
  };
}

export async function carregarDossieDeAprovacao(proposalId: string): Promise<DossieDeAprovacao> {
  const res = await fetch(`/api/proposals/${proposalId}/dossie-de-aprovacao`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || "Não foi possível carregar o dossiê desta proposta.");
  }
  return data as DossieDeAprovacao;
}

/** Rótulos de status de apontamento, os mesmos do Estúdio - o ciclo é um só. */
export const ROTULO_DE_STATUS: Record<string, { pt: string; en: string }> = {
  aberto: { pt: "Aberto", en: "Open" },
  em_tratativa: { pt: "Em tratativa", en: "In progress" },
  resolvido: { pt: "Resolvido", en: "Resolved" },
  aceito_com_risco: { pt: "Aceito com risco", en: "Accepted with risk" },
  descartado: { pt: "Descartado", en: "Dismissed" },
};

export const ROTULO_DE_PERSPECTIVA: Record<string, { pt: string; en: string }> = {
  technical: { pt: "Técnico", en: "Technical" },
  commercial: { pt: "Comercial", en: "Commercial" },
  legal: { pt: "Jurídico", en: "Legal" },
  financial: { pt: "Financeiro", en: "Financial" },
  aprovador: { pt: "Aprovador", en: "Approver" },
};

/*
 * F9: O ASSISTENTE DO APROVADOR, no cliente.
 *
 * Duas chamadas, e a separação é o ponto: `carregarAssistenteDoAprovador` (GET) nunca gasta IA e
 * por isso pode rodar quando a aba abre; `gerarAssistenteDoAprovador` (POST) é o botão. Fossem a
 * mesma, abrir uma tela viraria um evento de custo - exatamente o que o resultado guardado por
 * versão existe para evitar.
 */
export type CategoriaDoPonto = "tratativa" | "edicao" | "risco_aceito" | "concentracao" | "entre_versoes";

export interface PontoDoAssistente {
  pergunta: string;
  por_que: string;
  categoria: CategoriaDoPonto;
  secao: string | null;
  apontamento_id: string | null;
}

export interface BriefingDoAprovador {
  id: string;
  proposal_version: number;
  panorama: string;
  pontos: PontoDoAssistente[];
  logic_version: number;
  provider_used: string;
  model_used: string;
  created_at: string;
  updated_at: string;
}

export interface RespostaDoAssistente {
  success: true;
  briefing: BriefingDoAprovador | null;
  /** O documento ou a tratativa mudaram desde a geração. O resultado continua servido, marcado. */
  desatualizado: boolean;
  origem?: "guardado" | "gerado";
  descartados?: {
    nao_era_pergunta: number;
    recomendava_decisao: number;
    pedia_conferencia_numerica: number;
    citava_alvo_inexistente: number;
  };
  panorama_substituido?: boolean;
}

async function chamarAssistente(proposalId: string, init?: RequestInit): Promise<RespostaDoAssistente> {
  const res = await fetch(`/api/proposals/${proposalId}/assistente-do-aprovador`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || "Não foi possível falar com o assistente do aprovador.");
  }
  return data as RespostaDoAssistente;
}

/** Lê o resultado guardado desta versão. Nunca chama o modelo. */
export function carregarAssistenteDoAprovador(proposalId: string): Promise<RespostaDoAssistente> {
  return chamarAssistente(proposalId);
}

/**
 * Aciona o assistente. Sem `regenerar`, uma segunda chamada sobre a MESMA versão devolve o
 * resultado guardado sem nova chamada de IA - é o servidor que decide isso, não a tela.
 */
export function gerarAssistenteDoAprovador(proposalId: string, regenerar = false): Promise<RespostaDoAssistente> {
  return chamarAssistente(proposalId, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ regenerar }),
  });
}

export const ROTULO_DE_CATEGORIA: Record<CategoriaDoPonto, { pt: string; en: string }> = {
  tratativa: { pt: "Tratativa", en: "Handling" },
  edicao: { pt: "Edição", en: "Edit" },
  risco_aceito: { pt: "Risco aceito", en: "Accepted risk" },
  concentracao: { pt: "Concentração", en: "Concentration" },
  entre_versoes: { pt: "Entre versões", en: "Across versions" },
};
