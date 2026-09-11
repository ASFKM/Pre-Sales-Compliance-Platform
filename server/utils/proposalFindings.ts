/*
 * F6 (rodada 09/2026): as regras do APONTAMENTO, fora da rota.
 *
 * Duas regras moram aqui, e as duas são de servidor:
 *
 * 1. O RECORTE DO ALVO. O modelo devolve `target_kind`/`target_key` e pode errar: inventar um nome
 *    de campo, apontar para um campo que este tipo de proposta não tem, ou tentar `preco_total`
 *    apesar da instrução. Nada disso descarta o apontamento - ele DESCE para "geral", perdendo o
 *    botão de aplicar e mantendo o texto, que continua sendo observação legítima de um revisor.
 *
 * 2. A JUSTIFICATIVA OBRIGATÓRIA. "aceito com risco" e "descartado" não acontecem sem ela. A
 *    exigência é daqui, e não do formulário, porque "aceito com risco" é a única saída que a F7 vai
 *    oferecer para submeter uma proposta com apontamento crítico em aberto - um gate cuja única
 *    trava é validação de tela não é um gate, basta uma chamada direta à rota para atravessá-lo.
 *
 * Estão neste módulo, e não inline na rota, porque são exatamente o que precisa de teste: são
 * afirmações sobre o que o servidor recusa, e um teste que precise subir uma rota inteira para
 * verificá-las acaba não sendo escrito.
 */

export const STATUS_DE_APONTAMENTO = [
  "aberto",
  "em_tratativa",
  "resolvido",
  "aceito_com_risco",
  "descartado",
] as const;

export type StatusDeApontamento = (typeof STATUS_DE_APONTAMENTO)[number];

/*
 * `resolvido` NÃO exige justificativa, de propósito: o que sustenta um "resolvido" é a mudança na
 * seção, e essa mudança já fica registrada no histórico (ProposalSectionEdit) com autor, instante e
 * o apontamento que a motivou. Exigir um texto além disso seria pedir que a pessoa escrevesse duas
 * vezes a mesma coisa - e o campo acabaria preenchido com "ok".
 */
const STATUS_QUE_EXIGEM_JUSTIFICATIVA = new Set<string>(["aceito_com_risco", "descartado"]);

export function exigeJustificativa(status: string): boolean {
  return STATUS_QUE_EXIGEM_JUSTIFICATIVA.has(status);
}

/** Um status fechado carimba autor e instante; os dois abertos limpam o carimbo ao voltar. */
export function ehStatusFechado(status: string): boolean {
  return status !== "aberto" && status !== "em_tratativa";
}

export interface ApontamentoDoModelo {
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
  target_kind: string;
  target_key?: string | null;
  suggested_value?: string | null;
}

export interface ApontamentoRecortado {
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
  targetKind: "proposal_field" | "template_field" | "geral";
  targetKey: string | null;
  suggestedValue: string | null;
}

/**
 * Recorta um apontamento do modelo contra as listas do servidor.
 *
 * `alvosDeProposta` são os campos que ESTE tipo de proposta possui (PROPOSAL_TYPE_EDITABLE_FIELDS ∩
 * TEXT_SUGGESTIBLE_FIELDS); `alvosDeTemplate`, as seções de texto do template que sobrevivem à
 * allowlist. Um alvo fora das duas vira "geral" com a sugestão de texto descartada junto - sem
 * alvo não há o que substituir, e guardar um texto de substituição órfão só criaria um botão que
 * não sabe onde escrever.
 */
export function recortarApontamento(
  bruto: ApontamentoDoModelo,
  alvosDeProposta: ReadonlySet<string>,
  alvosDeTemplate: ReadonlySet<string>
): ApontamentoRecortado {
  const chave = bruto.target_key?.trim() || null;
  const alvoValido =
    (bruto.target_kind === "proposal_field" && !!chave && alvosDeProposta.has(chave)) ||
    (bruto.target_kind === "template_field" && !!chave && alvosDeTemplate.has(chave));

  return {
    title: bruto.title,
    detail: bruto.detail,
    severity: bruto.severity,
    targetKind: alvoValido ? (bruto.target_kind as "proposal_field" | "template_field") : "geral",
    targetKey: alvoValido ? chave : null,
    suggestedValue: alvoValido ? bruto.suggested_value?.trim() || null : null,
  };
}
