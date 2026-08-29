import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./prisma";
import { runWithTenant } from "./tenantContext";
import { getSpendTimeSeries, InvalidTimeSeriesRangeError, MAX_TIME_SERIES_POINTS } from "./aiOrchestrator";

// F10 (PreSales) — o que SÓ o banco prova sobre o histórico de gasto de IA.
//
// Três defeitos aqui são SILENCIOSOS: nenhum lança erro, nenhum aparece no typecheck, e o total
// do topo da tela continua certo enquanto as barras mentem. Por isso este arquivo existe e por
// isso ele fala com o Postgres de verdade, em vez de simular a agregação em memória.
//
//  1. `created_at` é `timestamp WITHOUT time zone` gravado em UTC. `AT TIME ZONE
//     'America/Sao_Paulo'` sozinho INTERPRETA o valor como se já fosse hora de São Paulo em vez
//     de convertê-lo, e um gasto das 23h59 vai para o balde do dia seguinte. O primeiro teste
//     grava exatamente nessa borda; ele falha se a query perder o `AT TIME ZONE 'UTC'`.
//  2. Balde sem gasto tem de sair ZERO, não sumir: uma série com buracos desenha dias parados
//     colados e mente sobre o intervalo.
//  3. `$queryRaw` não passa pela extensão de escopo do Prisma (src/prisma.ts só intercepta
//     operações de modelo), então o WHERE por tenant é escrito à mão — o terceiro teste é o que
//     prova que ele está lá.

const TENANT = "test_tenant_f10_timeseries";
const TENANT_VIZINHO = "test_tenant_f10_timeseries_vizinho";

/** Instante UTC a partir da hora civil de São Paulo (UTC-3 o ano todo desde 2019, sem horário de verão). */
function saoPauloParaUtc(civil: string): Date {
  return new Date(`${civil}-03:00`);
}

async function gravar(tenantId: string, id: string, quandoCivilSp: string, custo: number, taskType = "document_analysis") {
  // `created_at` é escrito como o INSTANTE correspondente àquela hora civil de São Paulo - é o
  // que `recordAiUsage` faz na prática (new Date() no servidor, gravado em UTC pelo driver).
  await runWithTenant({ tenantId, canSeeAllProjects: true }, async () =>
    prisma.aiUsageLog.create({
      data: {
        id,
        tenantId,
        taskType,
        provider: "gemini",
        model: "gemini-2.5-flash",
        estimatedCostUsd: custo,
        createdAt: saoPauloParaUtc(quandoCivilSp),
      },
    }),
  );
}

// Limpa SÓ os ids deste arquivo: um deleteMany por tenant apagaria linha de spec vizinho rodando
// em paralelo contra o mesmo banco.
const IDS = [
  "f10_ts_borda_2359",
  "f10_ts_borda_0030",
  "f10_ts_buraco_inicio",
  "f10_ts_buraco_fim",
  "f10_ts_vizinho",
  "f10_ts_tipo_novo",
];

async function limpar() {
  await prisma.$executeRaw`DELETE FROM ai_usage_logs WHERE id = ANY(${IDS})`;
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, TENANT_VIZINHO] } } });
}

beforeAll(async () => {
  await limpar();
  await prisma.tenant.create({ data: { id: TENANT, name: "Tenant de teste (F10 série temporal)" } });
  await prisma.tenant.create({ data: { id: TENANT_VIZINHO, name: "Tenant vizinho (F10 série temporal)" } });
});

afterAll(async () => {
  await limpar();
});

describe("getSpendTimeSeries", () => {
  it("põe o gasto das 23h59 no dia civil dele, e o das 00h30 no dia seguinte", async () => {
    // 2026-08-19 23:59 em São Paulo = 2026-08-20 02:59 UTC. Sem o `AT TIME ZONE 'UTC'` na
    // conversão, o Postgres lê 02:59 como se fosse hora de São Paulo e joga a linha no dia 20.
    await gravar(TENANT, "f10_ts_borda_2359", "2026-08-19T23:59:00", 1.5);
    await gravar(TENANT, "f10_ts_borda_0030", "2026-08-20T00:30:00", 2.5);

    const serie = await getSpendTimeSeries({ tenantId: TENANT, from: "2026-08-19", to: "2026-08-20", granularity: "day" });

    expect(serie.points.map((p) => p.bucket)).toEqual(["2026-08-19", "2026-08-20"]);
    expect(serie.points[0]).toMatchObject({ bucket: "2026-08-19", costUsd: 1.5, callCount: 1 });
    expect(serie.points[1]).toMatchObject({ bucket: "2026-08-20", costUsd: 2.5, callCount: 1 });
    // O total do período continua certo mesmo com o defeito de fuso - é justamente por isso que
    // conferir só o total não prova nada aqui.
    expect(serie.totalCostUsd).toBeCloseTo(4, 10);
  });

  it("devolve balde vazio como zero em vez de omitir a linha", async () => {
    await gravar(TENANT, "f10_ts_buraco_inicio", "2026-08-10T10:00:00", 3);
    await gravar(TENANT, "f10_ts_buraco_fim", "2026-08-14T10:00:00", 7);

    const serie = await getSpendTimeSeries({ tenantId: TENANT, from: "2026-08-10", to: "2026-08-14", granularity: "day" });

    expect(serie.points.map((p) => p.bucket)).toEqual([
      "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14",
    ]);
    expect(serie.points.map((p) => p.costUsd)).toEqual([3, 0, 0, 0, 7]);
    expect(serie.points.map((p) => p.callCount)).toEqual([1, 0, 0, 0, 1]);
  });

  it("não mistura o gasto de outro tenant, mesmo no mesmo dia", async () => {
    await gravar(TENANT_VIZINHO, "f10_ts_vizinho", "2026-08-10T11:00:00", 999);

    const serie = await getSpendTimeSeries({ tenantId: TENANT, from: "2026-08-10", to: "2026-08-10", granularity: "day" });

    expect(serie.points).toHaveLength(1);
    expect(serie.points[0].costUsd).toBe(3);
    expect(serie.totalCostUsd).toBe(3);
  });

  it("agrupa por semana e por mês sobre os mesmos dados", async () => {
    const semana = await getSpendTimeSeries({ tenantId: TENANT, from: "2026-08-10", to: "2026-08-14", granularity: "week" });
    // date_trunc('week') do Postgres ancora na segunda-feira; 10/08/2026 é uma segunda.
    expect(semana.points).toHaveLength(1);
    expect(semana.points[0]).toMatchObject({ bucket: "2026-08-10", costUsd: 10, callCount: 2 });

    const mes = await getSpendTimeSeries({ tenantId: TENANT, from: "2026-08-01", to: "2026-08-31", granularity: "month" });
    expect(mes.points).toHaveLength(1);
    // Os quatro registros de agosto deste tenant: 1,5 + 2,5 + 3 + 7.
    expect(mes.points[0].costUsd).toBeCloseTo(14, 10);
    expect(mes.points[0].callCount).toBe(4);
  });

  it("recusa um período que estoure o teto de pontos em vez de truncar a série", async () => {
    const erro = await getSpendTimeSeries({ tenantId: TENANT, from: "2020-01-01", to: "2026-01-01", granularity: "day" }).catch((e) => e);
    expect(erro).toBeInstanceOf(InvalidTimeSeriesRangeError);
    expect(erro.code).toBe("too_many_points");
    expect(erro.suggestedGranularity).toBe("week");
    expect(erro.message).toContain(String(MAX_TIME_SERIES_POINTS));
  });

  it("recusa data mal formada, granularidade desconhecida e período invertido", async () => {
    for (const params of [
      { from: "29/08/2026", to: "2026-08-30", granularity: "day", code: "invalid_date" },
      { from: "2026-08-01", to: "2026-08-30", granularity: "hour", code: "invalid_granularity" },
      { from: "2026-08-30", to: "2026-08-01", granularity: "day", code: "inverted_range" },
    ]) {
      const erro = await getSpendTimeSeries({ tenantId: TENANT, ...params }).catch((e) => e);
      expect(erro).toBeInstanceOf(InvalidTimeSeriesRangeError);
      expect(erro.code).toBe(params.code);
    }
  });

  it("conta um taskType que a tela não conhece - a série vem do dado, não de uma lista fixa", async () => {
    // A F6 transformou proposal_generation em tarefa de IA de verdade. O ponto do teste não é
    // esse slug em particular: é que a agregação nunca filtra por uma lista enumerada à mão, de
    // modo que um tipo criado amanhã já aparece no relatório em vez de sumir em silêncio.
    await gravar(TENANT, "f10_ts_tipo_novo", "2026-08-12T09:00:00", 5, "proposal_generation");
    const serie = await getSpendTimeSeries({ tenantId: TENANT, from: "2026-08-12", to: "2026-08-12", granularity: "day" });
    expect(serie.points[0]).toMatchObject({ bucket: "2026-08-12", costUsd: 5, callCount: 1 });
  });
});
