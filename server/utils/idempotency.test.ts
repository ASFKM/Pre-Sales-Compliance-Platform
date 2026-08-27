import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../src/prisma";
import { runWithTenant } from "../../src/tenantContext";
import { withIdempotency, IdempotencyConflict } from "./idempotency";

// CDC 16 — Fase 1. A idempotência de toda escrita da porta de máquina.
//
// Contra banco real de propósito: o que segura duas requisições SIMULTÂNEAS com
// a mesma chave é o índice único (tenant, escopo, chave), e não a leitura que
// vem antes dele. Um teste com repositório em memória passaria sem provar isso.

const TENANT = "test_tenant_cdc16_idem";

async function limpar() {
  await prisma.idempotencyRecord.deleteMany({ where: { tenantId: TENANT } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
}

describe("CDC 16 F1 - withIdempotency", () => {
  beforeAll(async () => {
    await limpar();
    await prisma.tenant.create({ data: { id: TENANT, name: "Tenant de teste (idempotency.test.ts)" } });
  });
  afterAll(limpar);

  it("executa uma vez e repete a MESMA resposta na segunda chamada", async () => {
    let execucoes = 0;
    const corpo = { demand_ref: "dr_x", valor: 10 };

    const primeira = await runWithTenant({ tenantId: TENANT }, async () =>
      withIdempotency("teste", "chave-repetida", corpo, async () => {
        execucoes += 1;
        return { status: 201, body: { id: "criado_1" } };
      })
    );
    const segunda = await runWithTenant({ tenantId: TENANT }, async () =>
      withIdempotency("teste", "chave-repetida", corpo, async () => {
        execucoes += 1;
        return { status: 201, body: { id: "criado_2" } };
      })
    );

    expect(execucoes).toBe(1);
    expect(primeira.replayed).toBe(false);
    expect(segunda.replayed).toBe(true);
    expect(segunda.body).toEqual({ id: "criado_1" });
    expect(segunda.status).toBe(201);
  });

  it("a mesma chave com OUTRO conteúdo é conflito, e não uma repetição silenciosa", async () => {
    await runWithTenant({ tenantId: TENANT }, async () =>
      withIdempotency("teste", "chave-reutilizada", { a: 1 }, async () => ({ status: 201, body: { ok: true } }))
    );

    await expect(
      runWithTenant({ tenantId: TENANT }, async () =>
        withIdempotency("teste", "chave-reutilizada", { a: 2 }, async () => ({ status: 201, body: { ok: true } }))
      )
    ).rejects.toBeInstanceOf(IdempotencyConflict);
  });

  it("a ordem das chaves do corpo não muda o veredito - a canonicalização é profunda", async () => {
    await runWithTenant({ tenantId: TENANT }, async () =>
      withIdempotency("teste", "chave-ordem", { a: 1, aninhado: { x: 1, y: 2 } }, async () => ({ status: 201, body: { ok: 1 } }))
    );
    const repetida = await runWithTenant({ tenantId: TENANT }, async () =>
      withIdempotency("teste", "chave-ordem", { aninhado: { y: 2, x: 1 }, a: 1 }, async () => ({ status: 201, body: { ok: 2 } }))
    );
    expect(repetida.replayed).toBe(true);
    expect(repetida.body).toEqual({ ok: 1 });
  });

  it("duas chamadas simultâneas com a mesma chave executam o corpo UMA vez só", async () => {
    let execucoes = 0;
    const executar = () =>
      runWithTenant({ tenantId: TENANT }, async () =>
        withIdempotency("teste", "chave-simultanea", { z: 1 }, async () => {
          execucoes += 1;
          await new Promise((r) => setTimeout(r, 40));
          return { status: 201, body: { id: `exec_${execucoes}` } };
        })
      );

    const resultados = await Promise.allSettled([executar(), executar()]);
    expect(execucoes).toBe(1);

    // A que perdeu a corrida ou repete a resposta, ou é recusada por estar em
    // voo - as duas são respostas honestas. O que NÃO pode acontecer é as duas
    // executarem, que é o que a asserção acima trava.
    const recusadas = resultados.filter(
      (r) => r.status === "rejected" && r.reason instanceof IdempotencyConflict && r.reason.reason === "in_flight"
    );
    const cumpridas = resultados.filter((r) => r.status === "fulfilled");
    expect(recusadas.length + cumpridas.length).toBe(2);
  });

  it("uma execução que falha não deixa a chave enterrada: a retentativa correta passa", async () => {
    await expect(
      runWithTenant({ tenantId: TENANT }, async () =>
        withIdempotency("teste", "chave-falha", { q: 1 }, async () => {
          throw new Error("banco caiu no meio");
        })
      )
    ).rejects.toThrow("banco caiu no meio");

    const depois = await runWithTenant({ tenantId: TENANT }, async () =>
      withIdempotency("teste", "chave-falha", { q: 1 }, async () => ({ status: 201, body: { ok: true } }))
    );
    expect(depois.replayed).toBe(false);
    expect(depois.status).toBe(201);
  });

  it("a mesma chave em outro tenant é outra chave", async () => {
    const OUTRO = "test_tenant_cdc16_idem_2";
    await prisma.tenant.deleteMany({ where: { id: OUTRO } });
    await prisma.tenant.create({ data: { id: OUTRO, name: "Outro tenant (idempotency.test.ts)" } });
    try {
      await runWithTenant({ tenantId: TENANT }, async () =>
        withIdempotency("teste", "chave-cross-tenant", { a: 1 }, async () => ({ status: 201, body: { de: "A" } }))
      );
      const noOutro = await runWithTenant({ tenantId: OUTRO }, async () =>
        withIdempotency("teste", "chave-cross-tenant", { a: 1 }, async () => ({ status: 201, body: { de: "B" } }))
      );
      expect(noOutro.replayed).toBe(false);
      expect(noOutro.body).toEqual({ de: "B" });
    } finally {
      await prisma.idempotencyRecord.deleteMany({ where: { tenantId: OUTRO } });
      await prisma.tenant.deleteMany({ where: { id: OUTRO } });
    }
  });
});
