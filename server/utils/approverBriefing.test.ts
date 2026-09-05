import { describe, expect, it } from "vitest";
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
 * O par de testes que mais importa e o que separa a RECOMENDACAO da MENCAO: "recomendo aprovar"
 * tem de cair, e "quem aprovou a v1 leu esta secao?" tem de passar. Uma regra que barrasse a
 * palavra "aprovar" esvaziaria o assistente num produto cujo dominio inteiro fala de aprovacao.
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

describe("F9 - a proibicao de veredito", () => {
  it("barra as formas diretas de recomendar decisao", () => {
    for (const texto of [
      "Recomendo aprovar a proposta.",
      "Recomendo rejeitar esta versao.",
      "Sugiro aprovar com ressalvas.",
      "A proposta deve ser aprovada.",
      "A v2 pode ser aprovada.",
      "O aprovador deve rejeitar.",
      "Aprove a proposta.",
      "Rejeite esta versao.",
      "A proposta esta pronta para aprovacao.",
      "Nao ha impedimento para aprovar.",
      "Sem ressalvas para aprovacao.",
      "Nao seria caso de rejeitar?",
      "This should be approved.",
      "I recommend rejecting this.",
    ]) {
      expect(contemRecomendacaoDeDecisao(texto), texto).toBe(true);
    }
  });

  /*
   * O outro lado da regra, e a razao de ela ser uma lista de EXPRESSOES e nao de palavras: este
   * produto fala de aprovacao o tempo todo, e cada uma destas frases e exatamente o tipo de
   * pergunta que o assistente existe para fazer.
   */
  it("deixa passar a mencao normal ao ato de aprovar", () => {
    for (const texto of [
      "Quem aprovou a v1 chegou a ler esta secao?",
      "O aprovador da etapa comercial apontou este item na rejeicao anterior?",
      "O fluxo de aprovacao previa uma segunda etapa para este tipo de proposta?",
      "Este item ja tinha sido aprovado na etapa tecnica antes da reabertura?",
      "A justificativa de 'aceito com risco' foi escrita antes ou depois da aprovacao da etapa anterior?",
    ]) {
      expect(contemRecomendacaoDeDecisao(texto), texto).toBe(false);
    }
  });
});

describe("F9 - a fronteira do numero", () => {
  it("barra pedido de conferencia de conta", () => {
    for (const texto of [
      "Confira se o valor total esta correto?",
      "Verifique se a soma dos itens bate?",
      "Valide o desconto aplicado?",
      "O total confere com a tabela?",
    ]) {
      expect(pedeConferenciaNumerica(texto), texto).toBe(true);
    }
  });

  // "prazo" e "data" ficam de fora da regra de proposito: perguntar se um prazo prometido numa
  // secao contradiz o que outra assume e leitura de texto, nao aritmetica.
  it("deixa passar pergunta sobre prazo, que e texto e nao conta", () => {
    expect(pedeConferenciaNumerica("O prazo prometido no escopo cabe no cronograma descrito na entrega?")).toBe(false);
  });
});

describe("F9 - recorte dos pontos", () => {
  it("descarta o que nao e pergunta", () => {
    const r = recortarPontosDoAssistente(
      [ponto({ pergunta: "Verifique a secao de pagamento." }), ponto()],
      SECOES,
      APONTAMENTOS
    );
    expect(r.pontos).toHaveLength(1);
    expect(r.descartados.nao_era_pergunta).toBe(1);
  });

  it("descarta o ponto que recomenda decidir, mesmo em forma de pergunta", () => {
    const r = recortarPontosDoAssistente(
      [ponto({ pergunta: "Nao seria caso de aprovar assim mesmo?" })],
      SECOES,
      APONTAMENTOS
    );
    expect(r.pontos).toHaveLength(0);
    expect(r.descartados.recomendava_decisao).toBe(1);
  });

  // A justificativa e lida pelo aprovador junto com a pergunta: uma pergunta neutra com um "por
  // que" que recomenda decidir recomendaria do mesmo jeito.
  it("descarta quando a recomendacao esta no por_que, e nao na pergunta", () => {
    const r = recortarPontosDoAssistente(
      [ponto({ pergunta: "A tratativa deste item ficou completa?", por_que: "Se sim, a proposta pode ser aprovada." })],
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
      { nome: "escopo_tecnico", texto: "Instalacao e configuracao." },
      { nome: "payment_terms", texto: "30/60/90." },
    ],
    apontamentos: [
      { id: "pof_1", status: "aberto", justificativa: null, veredito: null },
      { id: "pof_2", status: "resolvido", justificativa: "Ajustado o prazo.", veredito: "sanado" },
    ],
    edicoes: [{ secao: "escopo_tecnico", texto_anterior: "Instalacao.", texto_novo: "Instalacao e configuracao." }],
    decisoes: [{ id: "ad_1", decisao: "rejected", comentarios: "Faltou prazo.", itens: [{ secao: "escopo_tecnico", comentario: "Sem prazo." }] }],
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
    const antes = "O prazo de entrega e de 30 dias contados da assinatura do contrato pelas partes.";
    const depois = "O prazo de entrega e de 60 dias contados da assinatura do contrato pelas partes.";
    expect(percentualDeMudanca(antes, depois)).toBeLessThan(5);
  });

  it("e grande quando a secao foi reescrita", () => {
    const antes = "O prazo de entrega e de 30 dias contados da assinatura.";
    const depois = "A implantacao sera conduzida em tres ondas, com marcos de aceite a cada uma delas.";
    expect(percentualDeMudanca(antes, depois)).toBeGreaterThan(60);
  });
});
