import { TEMPLATE_VARIABLE_CATALOG } from "./templateVariableCatalog";

/*
 * F6, frentes (a) e (b): apoio de IA na geração da proposta.
 *
 * (a) preencher variáveis "livres" do template - as que o template pede, que não têm fonte de dado
 *     no sistema, e que hoje saem em branco no documento;
 * (b) redigir seções de texto corrido (resumo executivo, justificativa técnica) a partir da análise
 *     técnica que já existe no projeto.
 *
 * As duas frentes são o mesmo mecanismo com origens diferentes, então compartilham este módulo: o
 * que muda é de onde vem a matéria-prima de cada variável, e isso viaja junto na sugestão para
 * quem revisa saber o que está aceitando.
 *
 * Duas regras que este módulo NÃO negocia:
 *
 * 1. A IA nunca escreve na proposta. Ela devolve SUGESTÃO, que só vira conteúdo depois de um
 *    clique humano - o mesmo contrato que a F7 estabeleceu para o parecer acionável, e que o
 *    AGENTS.md exige ("Never treat AI output as final approved content without human review").
 * 2. A IA nunca inventa número, preço, quantidade ou item de BOM. Ver PODE_SER_SUGERIDA abaixo.
 */

// Variáveis de laço ({{#bom}}, {{#precificacao}}, {{#riscos}}...) carregam dados estruturados com
// fonte própria - análise técnica, catálogo de produtos, sessão de precificação. Preenchê-las por
// modelo seria fabricar fato, não redigir texto.
const NOMES_DE_LACO = new Set(
  TEMPLATE_VARIABLE_CATALOG.filter((v) => v.kind === "loop").map((v) => v.name)
);

const NOMES_DE_CAMPO_INTERNO_DE_LACO = new Set(
  TEMPLATE_VARIABLE_CATALOG.flatMap((v) => (v.loopFields || []).map((f) => f.name))
);

/*
 * Variáveis de valor que, ainda assim, a IA não pode sugerir: são compromisso comercial ou número.
 * `preco_total` é calculado a partir das linhas; os termos e a validade são decisão comercial de
 * uma pessoa (e já têm edição estruturada própria desde a F7/F8). Um texto plausível gerado aqui
 * viraria promessa contratual sem que ninguém tivesse decidido nada.
 */
const VALORES_QUE_A_IA_NAO_SUGERE = new Set([
  "preco_total",
  "validade_proposta",
  "termos_pagamento",
  "termos_entrega",
  "data_validade_projeto",
  "prazo_projeto",
]);

export function podeSerSugeridaPelaIa(nomeDaVariavel: string): boolean {
  if (NOMES_DE_LACO.has(nomeDaVariavel)) return false;
  if (NOMES_DE_CAMPO_INTERNO_DE_LACO.has(nomeDaVariavel)) return false;
  if (VALORES_QUE_A_IA_NAO_SUGERE.has(nomeDaVariavel)) return false;
  return true;
}

export type OrigemDaVariavel = "secao_de_texto" | "variavel_livre";

export interface VariavelParaSugerir {
  nome: string;
  origem: OrigemDaVariavel;
  // Descrição do catálogo quando a variável é conhecida - é o que diz ao modelo o que se espera
  // dela. Uma variável livre não tem descrição: o próprio nome é a única pista.
  descricao?: string;
}

/**
 * Quais variáveis deste template valem uma sugestão de IA.
 *
 * Entra na lista o que o template REALMENTE usa (placeholders lidos do arquivo) e que saiu vazio.
 * Uma variável já preenchida pelos dados do projeto nunca é tocada - a IA não reescreve o que o
 * sistema sabe.
 *
 * A origem separa as duas frentes do pedido: `secao_de_texto` é uma variável do catálogo que ficou
 * vazia porque a análise não produziu aquela seção (frente b); `variavel_livre` é um placeholder
 * que o autor do template inventou e que o sistema não sabe preencher de jeito nenhum (frente a).
 */
export function identificarVariaveisParaSugerir(
  placeholdersDoTemplate: string[],
  variaveisResolvidas: Record<string, unknown>
): VariavelParaSugerir[] {
  const doCatalogo = new Map(TEMPLATE_VARIABLE_CATALOG.map((v) => [v.name, v]));

  return placeholdersDoTemplate
    .filter((nome) => podeSerSugeridaPelaIa(nome))
    .filter((nome) => {
      const valor = variaveisResolvidas[nome];
      if (valor === undefined) return true; // variável livre: o resolvedor nem conhece o nome
      if (Array.isArray(valor)) return false; // laço já barrado acima, mas não custa ser explícito
      return typeof valor === "string" && valor.trim().length === 0;
    })
    .map((nome) => {
      const entrada = doCatalogo.get(nome);
      return entrada
        ? { nome, origem: "secao_de_texto" as const, descricao: entrada.description }
        : { nome, origem: "variavel_livre" as const };
    });
}

export interface SugestaoDeConteudo {
  variavel: string;
  valor_sugerido: string;
  origem: OrigemDaVariavel;
  justificativa: string;
}

/**
 * Prompt das duas frentes.
 *
 * O contexto é a análise técnica que o projeto JÁ tem - o modelo redige a partir dela, nunca a
 * partir de conhecimento próprio sobre o cliente. As instruções são explícitas quanto a isso
 * porque é a diferença entre "escrever a justificativa técnica deste projeto" e "escrever uma
 * justificativa técnica plausível", e só a primeira serve numa proposta que vai a um cliente.
 */
export function montarPromptDeSugestao(entrada: {
  variaveis: VariavelParaSugerir[];
  idioma: string;
  projeto: { nome: string; cliente: string; vertical: string; escopo: string };
  // Tipado como desconhecido de propósito: este módulo só serializa a análise para dentro do
  // prompt, nunca lê campo por campo. Amarrar aqui os tipos concretos de AnalysisResult criaria
  // um acoplamento que quebraria a cada campo novo da análise, sem nenhum ganho.
  analise: Record<string, unknown>;
}): string {
  const { variaveis, idioma, projeto, analise } = entrada;

  const listaDeVariaveis = variaveis
    .map((v) =>
      v.origem === "secao_de_texto"
        ? `- ${v.nome} (seção conhecida do documento): ${v.descricao}`
        : `- ${v.nome} (variável livre criada pelo autor do template; deduza o que ela pede pelo nome)`
    )
    .join("\n");

  return `Você está preenchendo campos de texto de uma proposta comercial de pré-vendas que será enviada a um cliente real.

PROJETO: ${projeto.nome}
CLIENTE: ${projeto.cliente}
VERTICAL: ${projeto.vertical}
ESCOPO CADASTRADO: ${projeto.escopo}

ANÁLISE TÉCNICA JÁ PRODUZIDA PARA ESTE PROJETO (esta é a sua ÚNICA fonte de fatos):
${JSON.stringify(analise, null, 2)}

CAMPOS A PREENCHER:
${listaDeVariaveis}

REGRAS:
- Escreva em ${idioma}.
- Baseie CADA campo exclusivamente na análise técnica e no cadastro acima. Não introduza fato, número, prazo, marca, quantidade ou compromisso que não esteja ali.
- Se a análise não contiver material suficiente para um campo, devolva esse campo com valor_sugerido vazio ("") e diga o motivo na justificativa. Um campo vazio honesto é melhor que um texto plausível inventado.
- Não escreva preço, desconto, condição de pagamento, prazo contratual ou validade de proposta, mesmo que o nome do campo peça: esses são decisão comercial humana.
- Texto corrido, sem marcadores de markdown, pronto para ser inserido num documento Word.

Responda APENAS com um array JSON (sem markdown, sem texto fora do array), neste formato exato:
[{ "variavel": "nome_do_campo", "valor_sugerido": "o texto redigido", "justificativa": "em uma frase, de que parte da análise este texto saiu" }]`;
}

/**
 * Casa a resposta do modelo com as variáveis pedidas, descartando o que não foi pedido.
 *
 * Um modelo pode devolver variável a mais (alucinada) ou a menos; o que vale é a lista que ESTE
 * servidor pediu. Sugestão vazia é descartada aqui mesmo - ela existe no protocolo para o modelo
 * poder dizer honestamente "não tenho material", e não há o que oferecer ao usuário nesse caso.
 */
export function consolidarSugestoes(
  pedidas: VariavelParaSugerir[],
  respostaDoModelo: Array<{ variavel: string; valor_sugerido: string; justificativa?: string }>
): SugestaoDeConteudo[] {
  const origemPorNome = new Map(pedidas.map((v) => [v.nome, v.origem]));

  return respostaDoModelo
    .filter((item) => origemPorNome.has(item.variavel))
    .filter((item) => typeof item.valor_sugerido === "string" && item.valor_sugerido.trim().length > 0)
    .map((item) => ({
      variavel: item.variavel,
      valor_sugerido: item.valor_sugerido.trim(),
      origem: origemPorNome.get(item.variavel)!,
      justificativa: item.justificativa?.trim() || "",
    }));
}
