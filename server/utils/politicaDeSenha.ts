/**
 * F3 (01/09/2026) — A POLÍTICA DE SENHA, EM UM LUGAR SÓ, COM A MESMA SEMÂNTICA NOS TRÊS PRODUTOS.
 *
 * Este arquivo é deliberadamente IDÊNTICO em PreSales, CMSaaS e CMCRM (só mudam os comentários
 * de contexto). O motivo está no prompt da fase e vale repetir: se `exigir_especial` quisesse
 * dizer coisas diferentes em cada produto, a MESMA política escrita pelo mesmo administrador
 * produziria senhas diferentes em cada tela — e ninguém descobriria isso lendo a tela.
 *
 * O QUE ELE É: funções puras sobre um objeto de política. Não sabe ler banco, não sabe HTTP.
 * Quem lê e grava a política é o repositório (`politicaDeSenhaRepo`); quem recusa uma senha são
 * as rotas que gravam senha. A tela avisa; a rota decide.
 *
 * DEFINIÇÃO DAS CLASSES DE CARACTERE (a parte que precisa ser literal, não "óbvia"):
 *   maiúscula = letra maiúscula Unicode (\p{Lu}) — "Á" conta.
 *   minúscula = letra minúscula Unicode (\p{Ll}) — "ç" conta.
 *   número    = dígito Unicode (\p{Nd}).
 *   especial  = qualquer coisa que NÃO seja letra nem número (\P{L} e \P{N}) — pontuação,
 *               símbolo e o espaço. Um "é" é letra, não caractere especial: definir especial
 *               como "fora de [A-Za-z0-9]" faria acento virar caractere especial e a mesma
 *               senha passar num produto e falhar noutro dependendo do teclado.
 */

export interface PoliticaDeSenha {
  /** Comprimento mínimo em caracteres. Padrão de fábrica 12. */
  comprimento_minimo: number;
  exigir_maiuscula: boolean;
  exigir_minuscula: boolean;
  exigir_numero: boolean;
  exigir_especial: boolean;
  /** Quantas senhas anteriores não podem ser reusadas. 0 desliga a verificação. */
  historico_de_reuso: number;
  /** Dias até a senha vencer e a troca virar obrigatória. 0 = sem validade. */
  validade_em_dias: number;
}

/**
 * PADRÃO DE FÁBRICA, decidido pelo dono em 31/08/2026: 12 caracteres, número e caractere
 * especial obrigatórios, histórico de 5, sem validade.
 *
 * Maiúscula e minúscula nascem DESLIGADAS de propósito: exigir as duas junto com número e
 * especial num mínimo de 12 empurra a pessoa para o padrão "Senha@2026" — previsível — em vez
 * de uma frase longa. Quem quiser ligar liga na tela; o padrão não força.
 *
 * Uma instalação sem política gravada assume exatamente isto, e nunca fica MAIS PERMISSIVA do
 * que estava antes da F3: antes valia "12 caracteres, sem exigência de composição", e este
 * padrão é esse mesmo mínimo mais duas exigências.
 */
export const POLITICA_PADRAO: PoliticaDeSenha = {
  comprimento_minimo: 12,
  exigir_maiuscula: false,
  exigir_minuscula: false,
  exigir_numero: true,
  exigir_especial: true,
  historico_de_reuso: 5,
  validade_em_dias: 0,
};

/**
 * LIMITES DO QUE UM ADMINISTRADOR PODE ESCREVER.
 *
 * O piso de 8 no comprimento existe porque a política é editável e a tela não deve poder
 * desfazer a decisão do dono de sair dos 8 caracteres de antes da Fase 13 — 8 é o CHÃO, não uma
 * sugestão. O teto de 24 no histórico é o outro lado da moeda do item 7 do prompt: cada entrada
 * de histórico é material de senha guardado, e guardar 500 senhas antigas de alguém é um risco
 * que nenhuma política de reuso justifica.
 */
export const LIMITES_DA_POLITICA = {
  comprimento_minimo: { minimo: 8, maximo: 128 },
  historico_de_reuso: { minimo: 0, maximo: 24 },
  validade_em_dias: { minimo: 0, maximo: 3650 },
} as const;

const TEM_MAIUSCULA = /\p{Lu}/u;
const TEM_MINUSCULA = /\p{Ll}/u;
const TEM_NUMERO = /\p{Nd}/u;
const TEM_ESPECIAL = /[^\p{L}\p{N}]/u;

export interface RequisitoDeSenha {
  chave: "comprimento" | "maiuscula" | "minuscula" | "numero" | "especial";
  texto: string;
  atendido: boolean;
}

/**
 * Os requisitos da política JÁ AVALIADOS contra uma senha — é isto que a tela desenha enquanto a
 * pessoa digita, e é isto que o erro do servidor descreve quando ela erra. Uma função só para os
 * dois usos: a lista que aparece na tela não pode divergir da que a rota aplica.
 *
 * Passe `""` para obter a lista com tudo `atendido: false`, que é a forma de mostrar as regras
 * antes de a pessoa digitar qualquer coisa.
 */
export function requisitosDaPolitica(senha: string, politica: PoliticaDeSenha): RequisitoDeSenha[] {
  const requisitos: RequisitoDeSenha[] = [
    {
      chave: "comprimento",
      texto: `Pelo menos ${politica.comprimento_minimo} caracteres`,
      atendido: [...senha].length >= politica.comprimento_minimo,
    },
  ];
  if (politica.exigir_maiuscula) {
    requisitos.push({ chave: "maiuscula", texto: "Uma letra maiúscula", atendido: TEM_MAIUSCULA.test(senha) });
  }
  if (politica.exigir_minuscula) {
    requisitos.push({ chave: "minuscula", texto: "Uma letra minúscula", atendido: TEM_MINUSCULA.test(senha) });
  }
  if (politica.exigir_numero) {
    requisitos.push({ chave: "numero", texto: "Um número", atendido: TEM_NUMERO.test(senha) });
  }
  if (politica.exigir_especial) {
    requisitos.push({
      chave: "especial",
      texto: "Um caractere especial (pontuação ou símbolo)",
      atendido: TEM_ESPECIAL.test(senha),
    });
  }
  return requisitos;
}

/**
 * O que a senha NÃO cumpre. Vazio significa aceita — pela composição; o reuso é verificado
 * separadamente, contra o histórico, porque depende do banco.
 *
 * `[...senha].length` e não `senha.length`: `length` conta unidades UTF-16, então um emoji
 * sozinho contaria como 2 caracteres e uma senha de 6 emojis passaria por 12.
 */
export function violacoesDaPolitica(senha: string, politica: PoliticaDeSenha): string[] {
  return requisitosDaPolitica(senha, politica)
    .filter((r) => !r.atendido)
    .map((r) => r.texto);
}

/** Atalho para a tela: a senha cumpre TODOS os requisitos de composição? */
export function senhaCumprePolitica(senha: string, politica: PoliticaDeSenha): boolean {
  return requisitosDaPolitica(senha, politica).every((r) => r.atendido);
}

/** Mensagem única para a rota devolver quando a senha não cumpre a política. */
export function mensagemDeViolacao(violacoes: string[]): string {
  return `A senha não cumpre a política: ${violacoes.join("; ")}.`;
}

/**
 * VALIDADE. `trocadaEm` nulo significa "nunca trocada desde que a validade passou a ser contada":
 * trata-se como VENCIDA quando há validade configurada, e não como "recém-trocada". O contrário
 * daria vida eterna justamente às contas mais antigas, que são as que a validade existe para
 * alcançar.
 */
export function senhaExpirada(politica: PoliticaDeSenha, trocadaEm: Date | string | null | undefined, agora: Date = new Date()): boolean {
  if (!politica.validade_em_dias || politica.validade_em_dias <= 0) return false;
  if (!trocadaEm) return true;
  const data = trocadaEm instanceof Date ? trocadaEm : new Date(trocadaEm);
  if (Number.isNaN(data.getTime())) return true;
  const vencimento = data.getTime() + politica.validade_em_dias * 24 * 60 * 60 * 1000;
  return agora.getTime() >= vencimento;
}

function inteiroDentroDosLimites(valor: unknown, limites: { minimo: number; maximo: number }, atual: number): number {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return atual;
  const inteiro = Math.trunc(valor);
  if (inteiro < limites.minimo) return limites.minimo;
  if (inteiro > limites.maximo) return limites.maximo;
  return inteiro;
}

/**
 * Normaliza o que chegou pela rota contra os limites, partindo do que já está gravado. Campo
 * ausente mantém o valor atual (a tela pode mandar só o que mudou); campo fora dos limites é
 * grampeado, não recusado — grampear é o comportamento previsível quando o front manda 4 e o
 * chão é 8.
 */
export function normalizarPolitica(entrada: Partial<PoliticaDeSenha> | null | undefined, atual: PoliticaDeSenha = POLITICA_PADRAO): PoliticaDeSenha {
  const e = entrada || {};
  return {
    comprimento_minimo: inteiroDentroDosLimites(e.comprimento_minimo, LIMITES_DA_POLITICA.comprimento_minimo, atual.comprimento_minimo),
    exigir_maiuscula: typeof e.exigir_maiuscula === "boolean" ? e.exigir_maiuscula : atual.exigir_maiuscula,
    exigir_minuscula: typeof e.exigir_minuscula === "boolean" ? e.exigir_minuscula : atual.exigir_minuscula,
    exigir_numero: typeof e.exigir_numero === "boolean" ? e.exigir_numero : atual.exigir_numero,
    exigir_especial: typeof e.exigir_especial === "boolean" ? e.exigir_especial : atual.exigir_especial,
    historico_de_reuso: inteiroDentroDosLimites(e.historico_de_reuso, LIMITES_DA_POLITICA.historico_de_reuso, atual.historico_de_reuso),
    validade_em_dias: inteiroDentroDosLimites(e.validade_em_dias, LIMITES_DA_POLITICA.validade_em_dias, atual.validade_em_dias),
  };
}
