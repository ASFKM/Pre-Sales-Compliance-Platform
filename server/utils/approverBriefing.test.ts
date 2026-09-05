import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  calcularImpressaoDoEstado,
  contemRecomendacaoDeDecisao,
  pedeConferenciaNumerica,
  percentualDeMudanca,
  recortarPontosDoAssistente,
  type EstadoLidoPeloAssistente,
  type PontoDoAssistente,
} from "./approverBriefing";

/*
 * F9 - o assistente do aprovador.
 *
 * O que estes testes travam e a promessa da fase, nao o formato dela: o assistente devolve
 * PERGUNTAS e nunca um veredito. A proibicao esta no prompt (sob guard de hash) e aqui, em codigo,
 * porque uma instrucao a um modelo e cumprida quase sempre - e "quase" nao serve quando o preco de
 * falhar e o aprovador virar carimbo.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA SUITE E ESCRITA COM ACENTO, E POR QUE ISSO E UM TESTE EM SI
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A primeira versao desta suite foi escrita SEM UM UNICO ACENTO, e por isso deixou passar um
 * defeito que so a revisao de seguranca da fase encontrou: as regexes usam `\w`, que em JavaScript
 * sem a flag `u` e [A-Za-z0-9_] e NAO cobre letra acentuada. `est\w*` nunca casava "esta" com
 * acento - `\w*` parava antes do "a" e o `\s+` seguinte falhava contra a propria letra.
 *
 * Consequencia medida: "A proposta esta pronta para ser aprovada" (com acento) e "Nao ha motivo
 * para nao aprovar" (com til e acento) PASSAVAM pela amarra. E como o prompt manda o modelo
 * responder em portugues, a saida real vem sempre acentuada - ou seja, a camada de codigo estava
 * parcialmente desligada justamente na forma que o produto produz.
 *
 * A correcao foi DOBRAR o texto (NFD + remocao de combining marks + minusculas) antes de compara-lo,
 * mantendo as listas em ASCII. E o ultimo teste desta suite existe para que a cegueira nao volte:
 * ele falha se algum exemplo aqui deixar de ter acento.
 */

const ponto = (over: Partial<PontoDoAssistente> = {}): PontoDoAssistente => ({
  pergunta: "A justificativa registrada responde ao que o apontamento dizia?",
  por_que: "O apontamento fala de prazo e a justificativa fala de escopo.",
  categoria: "tratativa",
  secao: null,
  apontamento_id: null,
  ...over,
});

const SECOES = new Set(["escopo_tecnico", "payment_terms"]);
const APONTAMENTOS = new Set(["pof_1", "pof_2"]);

/*
 * As frases que TEM de cair. Escritas como o modelo realmente escreve: em portugues, com acento.
 * Cada bloco cobre uma forma diferente de dizer a mesma coisa proibida - aconselhar, obrigar,
 * permitir, ou declarar que nao ha o que verificar.
 */
const RECOMENDACOES_QUE_TEM_DE_CAIR = [
  // Aconselhar
  "Recomendo aprovar a proposta.",
  "Recomendo que a proposta seja aprovada.",
  "Minha recomendação: aprovar.",
  "Sugiro aprovar com ressalvas.",
  "Sugiro que seja rejeitada.",
  // Obrigar ou permitir
  "A proposta deve ser aprovada.",
  "A v2 pode ser aprovada.",
  "O aprovador deve rejeitar.",
  "Aprove a proposta.",
  "Rejeite esta versão.",
  // Declarar suficiência — a forma mais comum, e a que passava antes da correção
  "A proposta está pronta para ser aprovada.",
  "A proposta está apta para aprovação.",
  "Não há motivo para não aprovar.",
  "Não há impedimento para aprovar.",
  "Não vejo nenhuma razão para não aprovar.",
  "Sem ressalvas para a aprovação.",
  "Não seria o caso de rejeitá-la?",
  "Nada a verificar nesta versão.",
  "Está tudo em ordem.",
  "Todos os apontamentos foram devidamente tratados.",
  "A proposta atende plenamente ao que foi pedido.",
  // Inglês
  "This proposal should be approved.",
  "I recommend rejecting this.",
  "The proposal is ready for approval.",
  "There are no blockers to approve.",
  // Espanhol
  "Recomiendo aprobar esta propuesta.",
  "La propuesta debe ser aprobada.",
  "Apruebe la propuesta.",
];

/*
 * O outro lado da regra, e a razao de ela ser uma lista de EXPRESSOES e nao de palavras: este
 * produto fala de aprovacao o tempo todo, e cada uma destas frases e exatamente o tipo de pergunta
 * que o assistente existe para fazer. Barrar a palavra "aprovar" sozinha esvaziaria o assistente
 * em vez de disciplina-lo.
 */
const MENCOES_QUE_TEM_DE_PASSAR = [
  "Quem aprovou a v1 chegou a ler esta seção?",
  "O aprovador da etapa comercial apontou este item na rejeição anterior?",
  "O fluxo de aprovação previa uma segunda etapa para este tipo de proposta?",
  "Este item já tinha sido aprovado na etapa técnica antes da reabertura?",
  "A justificativa de 'aceito com risco' foi escrita antes ou depois da aprovação da etapa anterior?",
  "O que exatamente o aprovador estaria assumindo ao seguir com este item em aberto?",
  "A rejeição anterior pedia a inclusão do prazo — a versão atual a inclui?",
];

describe("F9 - a proibicao de veredito", () => {
  it("barra as formas de recomendar decisao, COM acento como o modelo escreve", () => {
    for (const texto of RECOMENDACOES_QUE_TEM_DE_CAIR) {
      expect(contemRecomendacaoDeDecisao(texto), texto).toBe(true);
    }
  });

  it("deixa passar a mencao normal ao ato de aprovar", () => {
    for (const texto of MENCOES_QUE_TEM_DE_PASSAR) {
      expect(contemRecomendacaoDeDecisao(texto), texto).toBe(false);
    }
  });

  /*
   * O caso que o defeito original produziria: a MESMA frase, com e sem acento, tem de ter o mesmo
   * veredito. Antes da dobra, a versao sem acento caia e a com acento passava - e a com acento e a
   * unica que o produto gera.
   */
  it("da o mesmo veredito com e sem acento", () => {
    const pares: [string, string][] = [
      ["A proposta está pronta para ser aprovada.", "A proposta esta pronta para ser aprovada."],
      ["Não há motivo para não aprovar.", "Nao ha motivo para nao aprovar."],
      ["Não seria o caso de rejeitá-la?", "Nao seria o caso de rejeita-la?"],
      ["Está tudo em ordem.", "Esta tudo em ordem."],
    ];
    for (const [comAcento, semAcento] of pares) {
      expect(contemRecomendacaoDeDecisao(comAcento), comAcento).toBe(true);
      expect(contemRecomendacaoDeDecisao(semAcento), semAcento).toBe(true);
    }
  });

  it("ignora a caixa", () => {
    expect(contemRecomendacaoDeDecisao("RECOMENDO APROVAR A PROPOSTA.")).toBe(true);
    expect(contemRecomendacaoDeDecisao("A Proposta Está Pronta Para Ser Aprovada.")).toBe(true);
  });
});

describe("F9 - a fronteira do numero", () => {
  it("barra pedido de conferencia de conta, com e sem acento", () => {
    for (const texto of [
      "Confira se o valor total está correto?",
      "Verifique se a soma dos itens bate?",
      "Valide o desconto aplicado?",
      "O total confere com a tabela?",
      "Recalcule o montante da proposta?",
      "Confira se o valor total esta correto?",
      "Check the total amount?",
    ]) {
      expect(pedeConferenciaNumerica(texto), texto).toBe(true);
    }
  });

  // "prazo" e "data" ficam de fora da regra de proposito: perguntar se um prazo prometido numa
  // secao contradiz o que outra assume e leitura de texto, nao aritmetica.
  it("deixa passar pergunta sobre prazo, que e texto e nao conta", () => {
    expect(pedeConferenciaNumerica("O prazo prometido no escopo cabe no cronograma descrito na entrega?")).toBe(false);
    expect(pedeConferenciaNumerica("A data de validade da proposta foi acordada com o cliente?")).toBe(false);
  });
});

describe("F9 - recorte dos pontos", () => {
  it("descarta o que nao e pergunta", () => {
    const r = recortarPontosDoAssistente(
      [ponto({ pergunta: "Verifique a seção de pagamento." }), ponto()],
      SECOES,
      APONTAMENTOS
    );
    expect(r.pontos).toHaveLength(1);
    expect(r.descartados.nao_era_pergunta).toBe(1);
  });

  it("descarta o ponto que recomenda decidir, mesmo em forma de pergunta", () => {
    const r = recortarPontosDoAssistente(
      [ponto({ pergunta: "Não seria o caso de aprová-la assim mesmo?" })],
      SECOES,
      APONTAMENTOS
    );
    expect(r.pontos).toHaveLength(0);
    expect(r.descartados.recomendava_decisao).toBe(1);
  });

  // A justificativa e lida pelo aprovador junto com a pergunta: uma pergunta neutra com um "por
  // que" que recomenda decidir recomendaria do mesmo jeito. Este e o caminho que a revisao de
  // seguranca apontou como o mais provavel, porque o `por_que` nao precisa terminar em "?".
  it("descarta quando a recomendacao esta no por_que, e nao na pergunta", () => {
    const r = recortarPontosDoAssistente(
      [
        ponto({
          pergunta: "Os apontamentos restantes foram revisados?",
          por_que: "Todos foram devidamente tratados; a proposta está pronta para ser aprovada.",
        }),
      ],
      SECOES,
      APONTAMENTOS
    );
    expect(r.pontos).toHaveLength(0);
    expect(r.descartados.recomendava_decisao).toBe(1);
  });

  it("descarta o ponto que pede conferencia de conta", () => {
    const r = recortarPontosDoAssistente(
      [ponto({ pergunta: "Verifique se o valor total da tabela confere?" })],
      SECOES,
      APONTAMENTOS
    );
    expect(r.pontos).toHaveLength(0);
    expect(r.descartados.pedia_conferencia_numerica).toBe(1);
  });

  it("descarta secao e apontamento que nao foram mandados ao modelo", () => {
    const r = recortarPontosDoAssistente(
      [
        ponto({ secao: "secao_que_nao_existe" }),
        ponto({ apontamento_id: "pof_inventado" }),
        ponto({ secao: "escopo_tecnico", apontamento_id: "pof_1" }),
      ],
      SECOES,
      APONTAMENTOS
    );
    expect(r.pontos).toHaveLength(1);
    expect(r.pontos[0].secao).toBe("escopo_tecnico");
    expect(r.descartados.citava_alvo_inexistente).toBe(2);
  });

  it("normaliza secao e apontamento vazios para null", () => {
    const r = recortarPontosDoAssistente([ponto({ secao: "  ", apontamento_id: "" })], SECOES, APONTAMENTOS);
    expect(r.pontos[0].secao).toBeNull();
    expect(r.pontos[0].apontamento_id).toBeNull();
  });
});

describe("F9 - a impressao do estado lido", () => {
  const base: EstadoLidoPeloAssistente = {
    secoes: [
      { nome: "escopo_tecnico", texto: "Instalação e configuração." },
      { nome: "payment_terms", texto: "30/60/90." },
    ],
    apontamentos: [
      { id: "pof_1", status: "aberto", justificativa: null, veredito: null },
      { id: "pof_2", status: "resolvido", justificativa: "Ajustado o prazo.", veredito: "sanado" },
    ],
    edicoes: [{ secao: "escopo_tecnico", texto_anterior: "Instalação.", texto_novo: "Instalação e configuração." }],
    decisoes: [
      { id: "ad_1", decisao: "rejected", comentarios: "Faltou prazo.", itens: [{ secao: "escopo_tecnico", comentario: "Sem prazo." }] },
    ],
  };

  it("e estavel quando so a ORDEM muda - o hash fala do conteudo, nao do orderBy", () => {
    const trocado: EstadoLidoPeloAssistente = {
      ...base,
      secoes: [...base.secoes].reverse(),
      apontamentos: [...base.apontamentos].reverse(),
      decisoes: base.decisoes.map((d) => ({ ...d, itens: [...d.itens].reverse() })),
    };
    expect(calcularImpressaoDoEstado(trocado)).toBe(calcularImpressaoDoEstado(base));
  });

  it("muda quando o TEXTO de uma secao muda", () => {
    const outro = { ...base, secoes: [{ nome: "escopo_tecnico", texto: "Outra coisa." }, base.secoes[1]] };
    expect(calcularImpressaoDoEstado(outro)).not.toBe(calcularImpressaoDoEstado(base));
  });

  // O caso que decide se o cache serve para alguma coisa: mudar o status de um apontamento e o ato
  // mais comum do ciclo da F6, e o resultado guardado tem de saber que envelheceu por causa dele.
  it("muda quando o STATUS de um apontamento muda", () => {
    const outro = {
      ...base,
      apontamentos: [{ id: "pof_1", status: "aceito_com_risco", justificativa: "Assumido.", veredito: null }, base.apontamentos[1]],
    };
    expect(calcularImpressaoDoEstado(outro)).not.toBe(calcularImpressaoDoEstado(base));
  });

  it("muda quando uma decisao nova entra na cadeia", () => {
    const outro = {
      ...base,
      decisoes: [...base.decisoes, { id: "ad_2", decisao: "approved", comentarios: "", itens: [] }],
    };
    expect(calcularImpressaoDoEstado(outro)).not.toBe(calcularImpressaoDoEstado(base));
  });
});

describe("F9 - percentual de mudanca", () => {
  it("e zero quando o texto nao mudou, ignorando espaco em volta", () => {
    expect(percentualDeMudanca("Mesmo texto.", "  Mesmo texto.  ")).toBe(0);
  });

  it("e 100 quando uma das pontas esta vazia", () => {
    expect(percentualDeMudanca("", "Texto novo.")).toBe(100);
    expect(percentualDeMudanca("Texto antigo.", "")).toBe(100);
  });

  // O caso que o assistente usa: a edicao que mexeu quase nada, que e o sinal de "trataram de
  // lado" que o aprovador nao veria lendo so o texto final.
  it("e pequeno quando a edicao mexeu em pouca coisa", () => {
    const antes = "O prazo de entrega é de 30 dias contados da assinatura do contrato pelas partes.";
    const depois = "O prazo de entrega é de 60 dias contados da assinatura do contrato pelas partes.";
    expect(percentualDeMudanca(antes, depois)).toBeLessThan(5);
  });

  it("e grande quando a secao foi reescrita", () => {
    const antes = "O prazo de entrega é de 30 dias contados da assinatura.";
    const depois = "A implantação será conduzida em três ondas, com marcos de aceite a cada uma delas.";
    expect(percentualDeMudanca(antes, depois)).toBeGreaterThan(60);
  });

  /*
   * Acima do teto a conta deixa de ser Levenshtein e passa a ser a diferenca de tamanho: O(n*m)
   * sincrono sobre texto que quem escreve a proposta escolhe seria um bloqueio do event loop
   * disparado por quem e julgado, contra quem julga. Continua sendo um FATO medido.
   */
  it("nao roda Levenshtein em texto gigante, e ainda responde", () => {
    const gigante = "a".repeat(9000);
    const outroGigante = "a".repeat(9000) + "b".repeat(1000);
    const inicio = Date.now();
    const pct = percentualDeMudanca(gigante, outroGigante);
    expect(Date.now() - inicio).toBeLessThan(200);
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThanOrEqual(100);
  });
});

/*
 * O guard contra a cegueira voltar. A suite inteira precisa conter letra acentuada: se alguem
 * reescrever os exemplos sem acento - como a primeira versao foi escrita -, as regexes voltam a ser
 * provadas apenas na grafia que o produto nunca gera, e o defeito reaparece em silencio.
 */
describe("F9 - a propria suite", () => {
  it("contem exemplos ACENTUADOS, que e a forma que o modelo realmente produz", () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const fonte = fs.readFileSync(path.join(__dirname, "approverBriefing.test.ts"), "utf8");
    const acentuados = (fonte.match(/[áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ]/g) || []).length;
    expect(
      acentuados,
      "Esta suite precisa provar as regexes na grafia REAL do produto. Sem acento, ela repete a " +
        "cegueira que deixou 'A proposta esta pronta para ser aprovada' (com acento) passar pela amarra."
    ).toBeGreaterThan(50);

    // E as frases proibidas, especificamente, tem de estar acentuadas — nao basta haver acento
    // em outro lugar do arquivo.
    const proibidasComAcento = RECOMENDACOES_QUE_TEM_DE_CAIR.filter((f) => /[áàâãéêíóôõúüç]/i.test(f));
    expect(proibidasComAcento.length).toBeGreaterThanOrEqual(8);
  });
});
