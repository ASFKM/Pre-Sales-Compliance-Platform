import { describe, it, expect } from "vitest";
import {
  ESTADOS_TERMINAIS,
  aceitaAtualizacao,
  avaliarCancelamento,
  diferencas,
  especieDaAtualizacao,
  pareceOportunidadePerdida,
  precisaDeDecisao,
  textoComparavel,
  type EstadoDaDemanda,
} from "./demandLifecycle";

// CDC 16 — Fase 7. A máquina de estados, provada estado por estado.
//
// Sem banco, e é o ponto: são TRÊS VERBOS que se parecem — cancelar, perder e
// expurgar — sobre uma demanda que tem seis estados, e o custo de errar um deles
// é apagar ou congelar o trabalho de alguém. Mesma disciplina da F5 com
// `demandSla.ts`.

const TODOS: EstadoDaDemanda[] = ["queued", "assigned", "in_analysis", "returned", "cancelled", "completed"];

describe("avaliarCancelamento — a tabela inteira, estado por estado", () => {
  it("cancela NA HORA o que está na fila sem dono", () => {
    const r = avaliarCancelamento("queued");
    expect(r.desfecho).toBe("cancelled");
    expect("jaEstava" in r).toBe(false);
  });

  it("vira PEDIDO quando alguém está trabalhando", () => {
    expect(avaliarCancelamento("assigned").desfecho).toBe("cancellation_requested");
    expect(avaliarCancelamento("in_analysis").desfecho).toBe("cancellation_requested");
  });

  it("repetir sobre a já cancelada não é erro, e não reescreve", () => {
    const r = avaliarCancelamento("cancelled");
    expect(r.desfecho).toBe("cancelled");
    expect("jaEstava" in r && r.jaEstava).toBe(true);
  });

  it("recusa a concluída e a devolvida, com motivos DIFERENTES", () => {
    const concluida = avaliarCancelamento("completed");
    const devolvida = avaliarCancelamento("returned");
    expect(concluida.desfecho).toBe("recusado");
    expect(devolvida.desfecho).toBe("recusado");
    // Duas recusas com a mesma frase fariam o CRM tratar dois fatos diferentes
    // como o mesmo: uma proposta entregue não é uma demanda que voltou.
    expect("motivo" in concluida && "motivo" in devolvida && concluida.motivo).not.toBe(
      "motivo" in devolvida ? devolvida.motivo : ""
    );
  });

  it("cobre os seis estados, sem cair em nenhum caso não previsto", () => {
    for (const estado of TODOS) {
      const r = avaliarCancelamento(estado);
      expect(["cancelled", "cancellation_requested", "recusado"]).toContain(r.desfecho);
    }
  });
});

describe("aceitaAtualizacao e precisaDeDecisao", () => {
  it("aceita atualização enquanto a demanda está viva", () => {
    expect(aceitaAtualizacao("queued")).toBe(true);
    expect(aceitaAtualizacao("assigned")).toBe(true);
    expect(aceitaAtualizacao("in_analysis")).toBe(true);
  });

  it("recusa nos três estados terminais", () => {
    for (const estado of ["returned", "cancelled", "completed"] as EstadoDaDemanda[]) {
      expect(ESTADOS_TERMINAIS.has(estado)).toBe(true);
      expect(aceitaAtualizacao(estado)).toBe(false);
    }
  });

  it("na fila NÃO pede decisão: não há a quem perguntar nem projeto onde incorporar", () => {
    expect(precisaDeDecisao("queued")).toBe(false);
    expect(precisaDeDecisao("assigned")).toBe(true);
    expect(precisaDeDecisao("in_analysis")).toBe(true);
  });
});

describe("textoComparavel — a comparação que não inventa diferença", () => {
  it("colapsa null, undefined e texto vazio no mesmo nada", () => {
    expect(textoComparavel(null)).toBeNull();
    expect(textoComparavel(undefined)).toBeNull();
    expect(textoComparavel("   ")).toBeNull();
    expect(textoComparavel([])).toBeNull();
  });

  it("corta data no DIA CIVIL, dos dois lados", () => {
    // O produto inteiro lê `deadline` com toISOString().substring(0,10) — a
    // convenção que a F5 registrou. Comparar instante contra dia civil
    // produziria "mudou" a cada chamada, sobre um prazo que ninguém mudou.
    expect(textoComparavel(new Date("2026-09-30T00:00:00.000Z"))).toBe("2026-09-30");
    expect(textoComparavel("2026-09-30T00:00:00.000Z")).toBe("2026-09-30");
    expect(textoComparavel("2026-09-30")).toBe("2026-09-30");
  });

  it("uma Date inválida não vira 'Invalid Date' na tela", () => {
    expect(textoComparavel(new Date("nada disso"))).toBeNull();
  });
});

describe("diferencas — só o que veio, e só o que mudou", () => {
  const antes = {
    "sheet.deadline": new Date("2026-09-30T00:00:00.000Z"),
    "opportunity.value": 100000,
    "opportunity.stage": "Proposta",
    "sheet.description": "texto",
  };

  it("campo AUSENTE no depois significa 'não mudou', nunca 'apagar'", () => {
    const r = diferencas(antes, { "opportunity.value": 100000 });
    expect(r).toHaveLength(0);
  });

  it("acha a mudança e devolve o antes e o depois", () => {
    const r = diferencas(antes, { "sheet.deadline": "2026-10-15" });
    expect(r).toHaveLength(1);
    expect(r[0].antes).toBe("2026-09-30");
    expect(r[0].depois).toBe("2026-10-15");
    expect(r[0].rotulo).toBe("Prazo do edital");
  });

  it("o mesmo prazo escrito como INSTANTE não vira mudança", () => {
    expect(diferencas(antes, { "sheet.deadline": "2026-09-30T00:00:00.000Z" })).toHaveLength(0);
  });

  it("undefined explícito no depois é ignorado, e null não é", () => {
    expect(diferencas(antes, { "opportunity.stage": undefined })).toHaveLength(0);
    const r = diferencas(antes, { "opportunity.stage": null });
    expect(r).toHaveLength(1);
    expect(r[0].depois).toBeNull();
  });
});

describe("pareceOportunidadePerdida — a perda reconhecida pelo que ela é", () => {
  it("acha as grafias que o CRM de fato escreve", () => {
    // `opportunity.stage` é o NOME da etapa configurada pela organização, e não
    // o tipo: "Perdido" e "Perdida" são as duas o mesmo fato.
    for (const etapa of ["Perdida", "perdido", "PERDIDAS", "Fechado - Perdida", "Closed Lost", "closed_lost", "lost"]) {
      expect(pareceOportunidadePerdida(etapa)).toBe(true);
    }
  });

  it("não confunde etapa aberta com perda", () => {
    for (const etapa of ["Proposta", "Negociação", "Ganha", "Qualificação", "Prospecção", null, undefined, ""]) {
      expect(pareceOportunidadePerdida(etapa)).toBe(false);
    }
  });
});

describe("especieDaAtualizacao — a perda tem destaque, e não vira estado", () => {
  it("a etapa perdida vence qualquer outra mudança do mesmo pacote", () => {
    const especie = especieDaAtualizacao([
      { campo: "sheet.deadline", rotulo: "Prazo do edital", antes: "2026-09-30", depois: "2026-10-15" },
      { campo: "opportunity.stage", rotulo: "Etapa no funil", antes: "Proposta", depois: "Perdida" },
    ]);
    expect(especie).toBe("oportunidade_perdida");
  });

  it("uma etapa que NÃO é perda não produz o rótulo de perda", () => {
    expect(
      especieDaAtualizacao([{ campo: "opportunity.stage", rotulo: "Etapa no funil", antes: "Qualificação", depois: "Proposta" }])
    ).toBe("comercial");
  });

  it("separa prazo, escopo, documentos e comercial", () => {
    expect(especieDaAtualizacao([{ campo: "sheet.deadline", rotulo: "", antes: null, depois: null }])).toBe("prazo");
    expect(especieDaAtualizacao([{ campo: "documents", rotulo: "", antes: null, depois: null }])).toBe("documentos");
    expect(especieDaAtualizacao([{ campo: "sheet.description", rotulo: "", antes: null, depois: null }])).toBe("escopo");
    expect(especieDaAtualizacao([{ campo: "opportunity.value", rotulo: "", antes: null, depois: null }])).toBe("comercial");
  });
});
