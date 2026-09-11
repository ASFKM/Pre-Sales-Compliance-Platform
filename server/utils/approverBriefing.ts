/*
 * F9 (rodada 09/2026): O ASSISTENTE DO APROVADOR - as amarras que impedem a tarefa de virar
 * recomendacao, e a impressao que decide se o resultado guardado ainda fala do documento atual.
 *
 * =============================================================================================
 * POR QUE O PROMPT NAO BASTA
 * =============================================================================================
 *
 * `buildApproverBriefingPrompt` (server/routes/proposals.ts) proibe o veredito com todas as
 * letras, e essa proibicao e hasheada pelo guard de versao de logica. Ela continua sendo a
 * primeira linha de defesa e a mais importante - mas e uma instrucao, e uma instrucao e obedecida
 * na maioria das vezes, nao em todas. Uma unica saida que diga "a proposta pode ser aprovada"
 * bastaria para transformar o assistente naquilo que a fase inteira existe para evitar: o
 * aprovador vira carimbo, e a governanca das oito fases anteriores se perde no ultimo metro.
 *
 * Por isso a proibicao existe DUAS vezes - uma no prompt, outra aqui, em codigo que nao depende
 * de o modelo ter cooperado. E a mesma disciplina que `recortarApontamento` (F6) e o filtro de
 * secao inexistente da coerencia (F7) aplicam: o que o modelo devolve e proposta, nao verdade, e
 * o que nao passa nas regras da casa nao chega a tela.
 *
 * =============================================================================================
 * AS TRES AMARRAS
 * =============================================================================================
 *
 *   1. TODO PONTO E UMA PERGUNTA. Um ponto que nao termina em "?" e descartado. Esta e a amarra
 *      forte, e e forte justamente por ser sintatica: "verifique se o prazo de suporte foi
 *      acordado" e "recomendo aprovar" sao ambos afirmacoes, e a forma interrogativa e o que
 *      separa "olhe para isto" de "faca isto". Uma pergunta nao decide nada - ela devolve a
 *      decisao a quem tem autoridade para toma-la, que e o ponto inteiro desta tarefa.
 *
 *   2. NENHUM PONTO RECOMENDA DECIDIR. `contemRecomendacaoDeDecisao` procura as formas em que uma
 *      recomendacao se disfarcaria de pergunta ("nao seria caso de aprovar?"). A lista e de
 *      expressoes que combinam um verbo de decisao com marca de conselho ou de suficiencia -
 *      NUNCA a palavra "aprovar" sozinha, que e vocabulario legitimo e inevitavel aqui: "o
 *      aprovador anterior", "o fluxo de aprovacao", "aprovado na etapa comercial" sao todos
 *      texto normal deste dominio, e barra-los esvaziaria o assistente em vez de disciplina-lo.
 *
 *   3. NADA DE NUMERO. Um ponto que peca conferencia de total, preco, quantidade ou calculo e
 *      descartado: essa conferencia e deterministica (server/utils/proposalQa.ts, exposta em GET
 *      /proposals/:id/revisao) e trocar uma prova exata por um palpite de modelo seria uma
 *      regressao, nao um recurso. Mesma fronteira que `buildCoherencePrompt` defende desde a F7.
 *
 * Um ponto barrado nao vira erro: ele sai da lista e o total de descartados e devolvido na
 * resposta, para que uma queda repentina de qualidade do modelo apareca em vez de passar em
 * silencio.
 */
import crypto from "crypto";

export const CATEGORIAS_DO_ASSISTENTE = [
  "tratativa",
  "edicao",
  "risco_aceito",
  "concentracao",
  "entre_versoes",
] as const;
export type CategoriaDoAssistente = (typeof CATEGORIAS_DO_ASSISTENTE)[number];

export interface PontoDoAssistente {
  pergunta: string;
  por_que: string;
  categoria: CategoriaDoAssistente;
  secao: string | null;
  apontamento_id: string | null;
}

/*
 * Expressoes que denunciam uma RECOMENDACAO DE DECISAO, e nao a mencao normal ao ato de aprovar.
 *
 * O criterio para entrar nesta lista e estreito de proposito: a expressao tem de aconselhar ou
 * declarar suficiencia sobre a decisao. Verbo de decisao sozinho nao entra - este produto fala de
 * aprovacao o tempo todo, e "quem aprovou a v1 viu esta secao?" e exatamente o tipo de pergunta
 * que o assistente deve fazer.
 */
const RECOMENDACOES_DE_DECISAO: readonly RegExp[] = [
  // Aconselhar diretamente
  /\brecomend\w*\s+(?:a\s+|o\s+|que\s+(?:a\s+|o\s+)?)?(?:proposta\s+)?(?:seja\s+)?(?:aprova|reprova|rejeit|recus)/,
  /\brecomendacao\s*[:,]?\s*(?:e\s+)?(?:a\s+)?(?:aprova|reprova|rejeit|recus)/,
  /\bsug(?:ir|est)\w*\s+(?:a\s+|o\s+|que\s+(?:a\s+|o\s+)?)?(?:proposta\s+)?(?:seja\s+)?(?:aprova|reprova|rejeit|recus)/,
  /\bsugest\w*\s+de\s+(?:aprova|reprova|rejeit|recus)/,
  // Declarar obrigacao ou permissao de decidir
  /\b(?:deve|deveria|devia|precisa|pode|poderia)\s+ser\s+(?:aprovad|reprovad|rejeitad|recusad)/,
  /\b(?:deve|deveria|devia)\s+(?:aprovar|reprovar|rejeitar|recusar)/,
  /\bseja\s+(?:aprovad|reprovad|rejeitad|recusad)/,
  /\b(?:aprove|rejeite|reprove|recuse)\b/,
  // Declarar suficiencia — a forma mais comum, e a que a lista antiga nao pegava
  /\best\w*\s+(?:pronta|apta|apto|madura|adequada|em\s+condicoes)\s+(?:para|de)\s+(?:ser\s+)?(?:aprova|segui|avanc)/,
  /\b(?:apta|apto|pronta|pronto|madura)\s+para\s+(?:a\s+)?aprova/,
  /\bn[ao]\w*\s+(?:ha|existe|vejo|resta)\s+(?:nenhum\s+|nenhuma\s+)?(?:motivo|razao|impedimento|obice|ressalva|bloqueio)\s+para\s+(?:n[ao]\w*\s+)?(?:aprova|segui)/,
  /\bsem\s+(?:impedimento|ressalva|obice|bloqueio|pendencia)s?\s+para\s+(?:a\s+)?(?:aprova|segui)/,
  /\bn[ao]\w*\s+(?:seria\s+)?(?:o\s+)?caso\s+de\s+(?:aprova|reprova|rejeit|recus)/,
  /\bnada\s+a\s+(?:verificar|apontar|observar|questionar|ressalvar)/,
  /\btudo\s+(?:em\s+ordem|certo|correto|adequado)\b/,
  /\b(?:todos|todas)\b[^.?!]{0,60}\b(?:foram|estao)\s+(?:devidamente\s+|integralmente\s+)?(?:tratad|sanad|resolvid|enderecad|atendid)/,
  /\batende\s+(?:plenamente|integralmente|completamente)/,
  // Ingles
  /\b(?:should|must|can|may)\s+(?:be\s+)?(?:approv|reject)/,
  /\brecommend\w*\s+(?:approv|reject)/,
  /\bready\s+for\s+approval/,
  /\bno\s+(?:blockers?|reasons?|objections?)\s+(?:to|not\s+to)\s+approv/,
  // Espanhol
  /\brecom(?:iend|end)\w*\s+(?:la\s+|el\s+|que\s+)?(?:aprob|rechaz)/,
  /\b(?:debe|deberia|puede)\s+ser\s+(?:aprobad|rechazad)/,
  /\b(?:apruebe|rechace)\b/,
  /\blista\s+para\s+(?:ser\s+)?aprob/,
];

/*
 * Termos que so aparecem quando o ponto esta pedindo CONFERENCIA DE CONTA. "prazo" e "data" ficam
 * de fora: o assistente pode legitimamente perguntar se um prazo prometido numa secao contradiz o
 * que outra assume, e isso e leitura de texto, nao aritmetica.
 */
const PEDIDOS_DE_CONFERENCIA_NUMERICA: readonly RegExp[] = [
  /\b(?:conf[ei]r|verif|valid|revis|recalcul|chec|refa|som)\w*\s+(?:se\s+)?(?:o\s+|a\s+|os\s+|as\s+)?(?:valor|total|soma|somatori|preco|quantidade|percentual|desconto|calculo|montante|subtotal)/,
  /\b(?:a\s+)?soma\s+(?:dos|das|de)\b.*\b(?:confere|bate|fecha|corresponde)/,
  /\bo\s+total\s+(?:confere|bate|fecha|corresponde|esta\s+correto)/,
  /\b(?:check|verify|validate|recalculat)\w*\s+(?:the\s+)?(?:total|sum|amount|price|quantity|discount)/,
];

/*
 * DOBRA o texto antes de compara-lo: NFD separa a letra do acento, o range de combining marks os
 * remove, e o `toLowerCase` fecha a caixa.
 *
 * Isto NAO e detalhe de implementacao — e o que faz as listas acima existirem de verdade. Elas sao
 * escritas em ASCII, e sem esta funcao `est\w*` nunca casaria "esta" com acento: em JavaScript,
 * `\w` sem a flag `u` e [A-Za-z0-9_], entao `\w*` para no primeiro caractere acentuado e o `\s+`
 * seguinte falha contra a propria letra. Como o prompt manda o modelo responder em portugues, a
 * saida REAL vem sempre acentuada, e a regra so alcancava as frases cujo ponto critico por acaso
 * nao tinha acento.
 *
 * Medido na revisao de seguranca da F9, depois da fase ter sido dada por pronta: "A proposta esta
 * pronta para ser aprovada" (com acento em `esta`) e "Nao ha motivo para nao aprovar" (com til e
 * acento) PASSAVAM. Os testes da fase nao pegaram porque foram escritos sem acento nenhum - a mesma
 * cegueira do codigo, replicada na prova. Por isso `approverBriefing.test.ts` agora tem um caso que
 * falha se algum exemplo da suite existir apenas na forma sem acento.
 */
function dobrar(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function contemRecomendacaoDeDecisao(texto: string): boolean {
  const dobrado = dobrar(texto);
  return RECOMENDACOES_DE_DECISAO.some((r) => r.test(dobrado));
}

export function pedeConferenciaNumerica(texto: string): boolean {
  const dobrado = dobrar(texto);
  return PEDIDOS_DE_CONFERENCIA_NUMERICA.some((r) => r.test(dobrado));
}

export interface ResultadoDoRecorte {
  pontos: PontoDoAssistente[];
  descartados: {
    nao_era_pergunta: number;
    recomendava_decisao: number;
    pedia_conferencia_numerica: number;
    citava_alvo_inexistente: number;
  };
}

/**
 * Aplica as tres amarras e o descarte de alvo inexistente. `secoesConhecidas` e
 * `apontamentosConhecidos` sao o que foi REALMENTE mandado ao modelo: um ponto que cite secao ou
 * apontamento fora dessas listas nao e leitura do documento, e alucinacao - mesma disciplina de
 * `recortarApontamento` (F6) e do filtro de secao da coerencia (F7).
 */
export function recortarPontosDoAssistente(
  brutos: readonly PontoDoAssistente[],
  secoesConhecidas: ReadonlySet<string>,
  apontamentosConhecidos: ReadonlySet<string>
): ResultadoDoRecorte {
  const descartados = {
    nao_era_pergunta: 0,
    recomendava_decisao: 0,
    pedia_conferencia_numerica: 0,
    citava_alvo_inexistente: 0,
  };
  const pontos: PontoDoAssistente[] = [];

  for (const p of brutos) {
    const pergunta = (p.pergunta || "").trim();
    const porQue = (p.por_que || "").trim();
    if (!pergunta.endsWith("?")) {
      descartados.nao_era_pergunta++;
      continue;
    }
    // O "por que" tambem e lido pelo aprovador, entao ele passa pelas mesmas duas proibicoes: uma
    // pergunta neutra com uma justificativa que recomenda decidir recomendaria do mesmo jeito.
    const inteiro = `${pergunta}\n${porQue}`;
    if (contemRecomendacaoDeDecisao(inteiro)) {
      descartados.recomendava_decisao++;
      continue;
    }
    if (pedeConferenciaNumerica(inteiro)) {
      descartados.pedia_conferencia_numerica++;
      continue;
    }
    const secao = p.secao ? String(p.secao).trim() : "";
    const apontamentoId = p.apontamento_id ? String(p.apontamento_id).trim() : "";
    if (secao && !secoesConhecidas.has(secao)) {
      descartados.citava_alvo_inexistente++;
      continue;
    }
    if (apontamentoId && !apontamentosConhecidos.has(apontamentoId)) {
      descartados.citava_alvo_inexistente++;
      continue;
    }
    pontos.push({
      pergunta,
      por_que: porQue,
      categoria: p.categoria,
      secao: secao || null,
      apontamento_id: apontamentoId || null,
    });
  }

  return { pontos, descartados };
}

/*
 * =============================================================================================
 * A IMPRESSAO DO QUE FOI LIDO
 * =============================================================================================
 *
 * O que entra no hash e exatamente o que o assistente leu, e nada alem: o texto de cada secao, o
 * estado de cada apontamento (status, justificativa e veredito consultivo de sanacao), o par de
 * textos de cada edicao e as decisoes da cadeia. `createdAt`, contadores e nomes de autor ficam de
 * fora de proposito - eles mudam sem que a leitura mude, e fariam o resultado nascer desatualizado.
 *
 * O hash NAO invalida: ele marca. Ver o comentario do modelo ProposalApproverBriefing em
 * prisma/schema.prisma para por que marcar e a escolha certa e o que apagar-e-reexecutar custaria.
 */
export interface EstadoLidoPeloAssistente {
  secoes: readonly { nome: string; texto: string }[];
  apontamentos: readonly { id: string; status: string; justificativa: string | null; veredito: string | null }[];
  edicoes: readonly { secao: string; texto_anterior: string; texto_novo: string }[];
  decisoes: readonly { id: string; decisao: string; comentarios: string; itens: readonly { secao: string | null; comentario: string }[] }[];
}

export function calcularImpressaoDoEstado(estado: EstadoLidoPeloAssistente): string {
  // Ordenacao estavel em tudo: a impressao tem de depender do CONTEUDO, nao da ordem em que o
  // banco devolveu as linhas. Sem isto, um `orderBy` diferente marcaria o resultado como
  // desatualizado sem que uma letra do documento tivesse mudado.
  const canonico = {
    secoes: [...estado.secoes].sort((a, b) => a.nome.localeCompare(b.nome)).map((s) => [s.nome, s.texto]),
    apontamentos: [...estado.apontamentos]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((a) => [a.id, a.status, a.justificativa ?? "", a.veredito ?? ""]),
    edicoes: [...estado.edicoes]
      .map((e) => [e.secao, e.texto_anterior, e.texto_novo])
      .sort((a, b) => a.join(" ").localeCompare(b.join(" "))),
    decisoes: [...estado.decisoes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((d) => [
        d.id,
        d.decisao,
        d.comentarios,
        [...d.itens].map((i) => `${i.secao ?? ""}${i.comentario}`).sort((x, y) => x.localeCompare(y)),
      ]),
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonico)).digest("hex");
}

/**
 * Quanto do texto mudou entre duas versoes de uma secao, de 0 a 100, por distancia de Levenshtein
 * normalizada.
 *
 * A conta e feita AQUI e o resultado vai ao modelo como FATO - o modelo nunca recebe os dois
 * textos para "avaliar se mudou pouco". E a mesma politica que mantem a conferencia numerica fora
 * da IA: onde existe resposta exata, quem responde e o codigo. O que sobra para o modelo e a
 * pergunta que nao tem resposta exata, e que e a interessante: a mudanca, do tamanho que teve,
 * enderecou o que o apontamento dizia?
 */
export function percentualDeMudanca(anterior: string, novo: string): number {
  const a = (anterior ?? "").trim();
  const b = (novo ?? "").trim();
  if (a === b) return 0;
  if (a.length === 0 || b.length === 0) return 100;

  /*
   * Levenshtein e O(n*m) SINCRONO, e este processo e um so para todos os tenants: dois textos de
   * 20 mil caracteres seriam 400 milhoes de operacoes bloqueando o event loop. Nenhum campo de
   * texto de proposta tem `.max()`, entao o tamanho e escolhido por quem escreve a proposta - e
   * quem escreve nao e quem espera na tela do aprovador.
   *
   * Acima do teto a resposta vem da diferenca de tamanho, que e O(1) e continua sendo um FATO
   * medido (nunca uma estimativa mandada ao modelo): para textos desse porte ela responde a mesma
   * pergunta que interessa - "mudou pouco ou mudou muito?".
   */
  const TETO_DE_CARACTERES_PARA_LEVENSHTEIN = 4000;
  if (a.length > TETO_DE_CARACTERES_PARA_LEVENSHTEIN || b.length > TETO_DE_CARACTERES_PARA_LEVENSHTEIN) {
    const maior = Math.max(a.length, b.length);
    return Math.min(100, Math.round((Math.abs(a.length - b.length) / maior) * 100));
  }

  // Levenshtein com duas linhas: os textos de secao chegam a alguns milhares de caracteres, e a
  // matriz cheia seria memoria desperdicada num calculo que roda por edicao.
  let anteriorLinha = Array.from({ length: b.length + 1 }, (_, i) => i);
  let atualLinha = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    atualLinha[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atualLinha[j] = Math.min(atualLinha[j - 1] + 1, anteriorLinha[j] + 1, anteriorLinha[j - 1] + custo);
    }
    [anteriorLinha, atualLinha] = [atualLinha, anteriorLinha];
  }
  const distancia = anteriorLinha[b.length];
  return Math.round((distancia / Math.max(a.length, b.length)) * 100);
}
