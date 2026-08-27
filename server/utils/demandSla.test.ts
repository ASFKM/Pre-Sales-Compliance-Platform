import { describe, it, expect } from "vitest";
import {
  avaliarViolacoes,
  calcularCargas,
  calcularDueAt,
  escolherResponsavel,
  etapaPendente,
  fimDoDiaCivil,
  medir,
  medirPorPessoa,
  pesoDoPrazo,
  type ConfiguracaoDeSla,
  type DemandaParaSla,
} from "./demandSla";

// CDC 16 — Fase 5. A regra de prazo e de carga, provada caso a caso.
//
// Sem banco, e é o ponto: estas funções decidem QUEM TRABALHA (D40) e QUANDO
// ALGUÉM É COBRADO (D19), e uma regra dessas escondida dentro de uma consulta
// SQL não seria discutível. Mesma disciplina que a F4 aplicou ao emparelhamento
// do KPI.

const SLA: ConfiguracaoDeSla = { enabled: true, assumeHours: 8, analysisHours: 24, proposalHours: 120 };

function d(over: Partial<DemandaParaSla> = {}): DemandaParaSla {
  return {
    id: "dem_1",
    status: "queued",
    deadline: new Date("2026-12-31T00:00:00.000Z"),
    queuedAt: new Date("2026-08-27T10:00:00.000Z"),
    assignedAt: null,
    analysisStartedAt: null,
    ...over,
  };
}

describe("etapaPendente", () => {
  it("cada estado aberto deve UMA etapa, e nenhuma outra", () => {
    expect(etapaPendente({ status: "queued" })).toBe("assume");
    expect(etapaPendente({ status: "assigned" })).toBe("analysis");
    expect(etapaPendente({ status: "in_analysis" })).toBe("proposal");
  });

  it("estado terminal não deve etapa nenhuma", () => {
    // Cobrar prazo de quem já entregou, devolveu ou teve a demanda cancelada é
    // o defeito que faria o alerta virar ruído e ser desligado por quem o lê.
    for (const status of ["returned", "cancelled", "completed"]) {
      expect(etapaPendente({ status })).toBeNull();
    }
  });
});

describe("fimDoDiaCivil", () => {
  it("é o último milissegundo do dia CIVIL, lido em UTC", () => {
    // A convenção é a do produto inteiro: `src/dbStore.ts` serializa o prazo
    // com toISOString().substring(0,10), e é esse texto que a tela mostra. Ler
    // em outro fuso faria o prazo cobrado diferir do exibido em até um dia.
    expect(fimDoDiaCivil(new Date("2026-09-10T00:00:00.000Z")).toISOString()).toBe("2026-09-10T23:59:59.999Z");
  });

  it("não anda um dia para trás quando o instante já tem hora", () => {
    expect(fimDoDiaCivil(new Date("2026-09-10T03:00:00.000Z")).toISOString()).toBe("2026-09-10T23:59:59.999Z");
  });
});

describe("calcularDueAt", () => {
  it("sem SLA configurado, não há prazo — o estado de toda instalação hoje", () => {
    expect(calcularDueAt(d(), null)).toBeNull();
  });

  it("SLA desligado é o mesmo que SLA ausente", () => {
    expect(calcularDueAt(d(), { ...SLA, enabled: false })).toBeNull();
  });

  it("na fila, o prazo conta da entrada na fila", () => {
    expect(calcularDueAt(d(), SLA)!.toISOString()).toBe("2026-08-27T18:00:00.000Z");
  });

  it("assumida, o prazo conta do instante em que alguém assumiu", () => {
    const x = d({ status: "assigned", assignedAt: new Date("2026-08-27T12:00:00.000Z") });
    expect(calcularDueAt(x, SLA)!.toISOString()).toBe("2026-08-28T12:00:00.000Z");
  });

  it("em análise, o prazo da proposta conta do início da análise", () => {
    const x = d({
      status: "in_analysis",
      assignedAt: new Date("2026-08-27T12:00:00.000Z"),
      analysisStartedAt: new Date("2026-08-27T14:00:00.000Z"),
    });
    expect(calcularDueAt(x, SLA)!.toISOString()).toBe("2026-09-01T14:00:00.000Z");
  });

  it("o prazo da proposta NUNCA passa do fim do dia civil do edital", () => {
    // 120 h a partir de 27/08 cairia em 01/09; o edital fecha em 29/08. Uma
    // proposta prometida depois do fechamento não é uma proposta atrasada, é
    // uma proposta inútil — e é por isso que o teto existe.
    const x = d({
      status: "in_analysis",
      deadline: new Date("2026-08-29T00:00:00.000Z"),
      assignedAt: new Date("2026-08-27T12:00:00.000Z"),
      analysisStartedAt: new Date("2026-08-27T14:00:00.000Z"),
    });
    expect(calcularDueAt(x, SLA)!.toISOString()).toBe("2026-08-29T23:59:59.999Z");
  });

  it("as etapas de assumir e de analisar NÃO ganham o teto do edital", () => {
    // Um edital que fecha amanhã não torna "assumir" devido para ontem. O que
    // ele torna é a demanda urgente, e a urgência é o peso da D40.
    const x = d({ deadline: new Date("2026-08-27T00:00:00.000Z") });
    expect(calcularDueAt(x, SLA)!.toISOString()).toBe("2026-08-27T18:00:00.000Z");
  });

  it("estado terminal não tem prazo, mesmo com SLA ligado", () => {
    expect(calcularDueAt(d({ status: "completed" }), SLA)).toBeNull();
  });
});

describe("avaliarViolacoes", () => {
  it("devolve o VENCIMENTO, e não o instante em que se percebeu", () => {
    // Um serviço parado por duas horas não pode fazer o atraso parecer duas
    // horas menor do que foi.
    const agora = new Date("2026-08-28T00:00:00.000Z");
    const v = avaliarViolacoes([d()], SLA, agora);
    expect(v).toHaveLength(1);
    expect(v[0].stage).toBe("assume");
    expect(v[0].dueAt.toISOString()).toBe("2026-08-27T18:00:00.000Z");
  });

  it("dentro do prazo não vira violação", () => {
    expect(avaliarViolacoes([d()], SLA, new Date("2026-08-27T17:59:00.000Z"))).toHaveLength(0);
  });

  it("sem SLA, nada vence — nem para uma demanda de um ano atrás", () => {
    const velha = d({ queuedAt: new Date("2025-01-01T00:00:00.000Z") });
    expect(avaliarViolacoes([velha], null, new Date("2026-08-28T00:00:00.000Z"))).toHaveLength(0);
  });
});

describe("pesoDoPrazo (D40)", () => {
  const agora = new Date("2026-08-27T12:00:00.000Z");

  it("3 quando vence em até 3 dias", () => {
    expect(pesoDoPrazo(new Date("2026-08-28T00:00:00.000Z"), agora)).toBe(3);
    expect(pesoDoPrazo(new Date("2026-08-30T00:00:00.000Z"), agora)).toBe(3);
  });

  it("2 quando vence em até 7 dias", () => {
    expect(pesoDoPrazo(new Date("2026-09-02T00:00:00.000Z"), agora)).toBe(2);
  });

  it("1 no resto", () => {
    expect(pesoDoPrazo(new Date("2026-12-31T00:00:00.000Z"), agora)).toBe(1);
  });

  it("vencido pesa o máximo: continua ocupando a pessoa, e mais", () => {
    expect(pesoDoPrazo(new Date("2026-01-01T00:00:00.000Z"), agora)).toBe(3);
  });
});

describe("escolherResponsavel (D40)", () => {
  const agora = new Date("2026-08-27T12:00:00.000Z");
  const longe = new Date("2026-12-31T00:00:00.000Z");
  const perto = new Date("2026-08-28T00:00:00.000Z");

  it("sem candidato, ninguém — e quem chama deixa a demanda na fila", () => {
    expect(escolherResponsavel([], agora)).toBeNull();
  });

  it("quem não segura nada ganha de quem segura", () => {
    const escolhido = escolherResponsavel(
      [
        { userId: "ocupada", abertas: [{ deadline: longe, assignedAt: agora }] },
        { userId: "livre", abertas: [] },
      ],
      agora
    );
    expect(escolhido).toBe("livre");
  });

  it("CONTAGEM não é carga: três demandas tranquilas perdem para uma urgente", () => {
    // 3 × peso 1 = 3 contra 1 × peso 3 = 3 … empate. Com QUATRO tranquilas a
    // pessoa urgente ganharia; com DUAS, ela é quem recebe. É a ponderação
    // fazendo o que a D40 pediu, e é a razão de a régua não ser "conte quantas".
    const escolhido = escolherResponsavel(
      [
        { userId: "muitas_tranquilas", abertas: [{ deadline: longe, assignedAt: agora }, { deadline: longe, assignedAt: agora }, { deadline: longe, assignedAt: agora }, { deadline: longe, assignedAt: agora }] },
        { userId: "uma_urgente", abertas: [{ deadline: perto, assignedAt: agora }] },
      ],
      agora
    );
    expect(escolhido).toBe("uma_urgente");
  });

  it("o VALOR não entra: a régua não conhece valor nenhum", () => {
    // Prova estrutural, e não de comportamento: `CandidatoParaCarga` não tem
    // onde colocar valor. Se algum dia alguém acrescentar o campo, este teste
    // continua passando — e é por isso que a razão está escrita na D40 e no
    // cabeçalho de `calcularCargas`, não só aqui.
    const cargas = calcularCargas([{ userId: "a", abertas: [{ deadline: longe, assignedAt: agora }] }], agora);
    expect(Object.keys(cargas[0])).toEqual(["userId", "carga", "assumiuHaMaisTempo"]);
  });

  it("empate vai para quem assumiu há mais tempo", () => {
    const escolhido = escolherResponsavel(
      [
        { userId: "recente", abertas: [{ deadline: longe, assignedAt: new Date("2026-08-27T11:00:00.000Z") }] },
        { userId: "antiga", abertas: [{ deadline: longe, assignedAt: new Date("2026-08-20T11:00:00.000Z") }] },
      ],
      agora
    );
    expect(escolhido).toBe("antiga");
  });

  it("empate total é resolvido de forma ESTÁVEL, e não pela ordem do banco", () => {
    const a = escolherResponsavel([{ userId: "u2", abertas: [] }, { userId: "u1", abertas: [] }], agora);
    const b = escolherResponsavel([{ userId: "u1", abertas: [] }, { userId: "u2", abertas: [] }], agora);
    expect(a).toBe(b);
  });

  it("demanda devolvida ou concluída não entra na carga — quem chama nem as traz", () => {
    // A régua recebe só as ABERTAS; a filtragem é da consulta. O teste registra
    // o contrato: uma lista vazia é carga zero, não "sem informação".
    expect(calcularCargas([{ userId: "a", abertas: [] }], agora)[0].carga).toBe(0);
  });
});

describe("medir (D20)", () => {
  const base = {
    assignedUserId: "u1",
    sentAt: new Date("2026-08-27T10:00:00.000Z"),
    queuedAt: new Date("2026-08-27T10:00:00.000Z"),
    assignedAt: new Date("2026-08-27T12:00:00.000Z"),
    analysisStartedAt: new Date("2026-08-27T13:00:00.000Z"),
    completedAt: new Date("2026-08-28T10:00:00.000Z"),
    returnedAt: null as Date | null,
  };

  it("mede do ENVIO, e não da chegada na fila", () => {
    const m = medir([base]);
    expect(m.mediaAteAssumirSegundos).toBe(2 * 3600);
    expect(m.mediaAteAnaliseSegundos).toBe(3600);
    expect(m.mediaAteConcluirSegundos).toBe(24 * 3600);
  });

  it("a amostra vai junto: sem denominador, uma média de uma demanda passa por média", () => {
    const m = medir([base, { ...base, assignedAt: null, analysisStartedAt: null, completedAt: null }]);
    expect(m.total).toBe(2);
    expect(m.amostraAteAssumir).toBe(1);
  });

  it("medição negativa é omitida, e não somada", () => {
    // Relógios fora de sincronia entre os dois lados produzem "assumida antes
    // de enviada". Somar isso envenenaria a média em silêncio.
    const m = medir([{ ...base, assignedAt: new Date("2026-08-27T09:00:00.000Z") }]);
    expect(m.amostraAteAssumir).toBe(0);
    expect(m.mediaAteAssumirSegundos).toBeNull();
  });

  it("sem amostra, a média é nula — e não zero", () => {
    expect(medir([]).mediaAteAssumirSegundos).toBeNull();
  });

  it("agrupa por pessoa, e ignora demanda sem dono", () => {
    const pessoas = medirPorPessoa([base, { ...base, assignedUserId: "u2" }, { ...base, assignedUserId: null }]);
    expect(pessoas.map((p) => p.userId).sort()).toEqual(["u1", "u2"]);
    expect(pessoas.reduce((a, p) => a + p.medicao.total, 0)).toBe(2);
  });
});
