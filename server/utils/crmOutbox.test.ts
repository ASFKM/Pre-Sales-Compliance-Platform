import { describe, it, expect } from "vitest";
import { montarPayloadDoEvento, falhaPermanente, chaveDoEvento } from "./crmOutbox";

// CDC 16 — Fase 3. O que só a unidade prova.
//
// O caminho inteiro é provado por execução real contra o CMCRM vivo
// (scripts/cdc16-f3-provar-retorno.ts). O que fica aqui é a tabela de decisão: o
// corpo que viaja e a política de retentativa, que por HTTP custariam uma
// requisição por linha e não ficariam mais verdadeiros por isso.

describe("cdc16 F3 — o corpo que viaja", () => {
  const fato = new Date("2026-08-27T10:00:00.000Z");

  it("leva o instante do FATO, no formato do contrato", () => {
    const p = montarPayloadDoEvento({ event: "assigned", occurredAt: fato });
    expect(p.event).toBe("assigned");
    expect(p.occurred_at).toBe("2026-08-27T10:00:00.000Z");
  });

  it("calcula a medição de tempo de resposta a partir dos dois carimbos (D20)", () => {
    const p = montarPayloadDoEvento({
      event: "in_analysis",
      occurredAt: fato,
      sentAt: new Date("2026-08-27T09:00:00.000Z"),
      assignedAt: new Date("2026-08-27T09:30:00.000Z"),
    });
    expect(p.elapsed).toEqual({ since_sent_seconds: 3600, since_assigned_seconds: 1800 });
  });

  it("omite a medição quando ela sairia negativa — relógios fora de sincronia não viram dado", () => {
    const p = montarPayloadDoEvento({
      event: "assigned",
      occurredAt: fato,
      sentAt: new Date("2026-08-27T11:00:00.000Z"),
    });
    expect(p.elapsed).toBeUndefined();
  });

  it("não manda campo vazio: ausente é ausente, e não string vazia", () => {
    const p = montarPayloadDoEvento({ event: "assigned", occurredAt: fato, reason: null, note: "" });
    expect("reason" in p).toBe(false);
    expect("note" in p).toBe(false);
    expect("actor" in p).toBe(false);
  });

  it("o ator viaja com nome e referência externa (D34)", () => {
    const p = montarPayloadDoEvento({
      event: "returned",
      occurredAt: fato,
      actor: { name: "Engenheiro", presales_user_id: "u1" },
      reason: "faltou o quantitativo",
    });
    expect(p.actor).toEqual({ name: "Engenheiro", presales_user_id: "u1" });
    expect(p.reason).toBe("faltou o quantitativo");
  });
});

describe("cdc16 F3 — a chave da mensagem", () => {
  const fato = new Date("2026-08-27T10:00:00.000Z");

  it("é estável para o mesmo fato — um clique duplo não vira duas linhas na timeline", () => {
    expect(chaveDoEvento("d1", "assigned", fato)).toBe(chaveDoEvento("d1", "assigned", new Date(fato)));
  });

  it("e muda quando muda a demanda, o evento ou o instante", () => {
    const base = chaveDoEvento("d1", "assigned", fato);
    expect(chaveDoEvento("d2", "assigned", fato)).not.toBe(base);
    expect(chaveDoEvento("d1", "returned", fato)).not.toBe(base);
    expect(chaveDoEvento("d1", "assigned", new Date("2026-08-27T10:00:01.000Z"))).not.toBe(base);
  });
});

describe("cdc16 F3 — o que não adianta repetir", () => {
  it("falha de negócio é permanente", () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(falhaPermanente(status)).toBe(true);
    }
  });

  it("falha de transporte não é — 5xx e 429 voltam para a fila", () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(falhaPermanente(status)).toBe(false);
    }
  });

  it("sucesso nunca é tratado como falha", () => {
    for (const status of [200, 201, 202]) {
      expect(falhaPermanente(status)).toBe(false);
    }
  });
});
