import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../../src/prisma";
import { runWithTenant } from "../../src/tenantContext";
import { criarDemanda, assumirDemanda } from "./demands";
import {
  aplicarCancelamento,
  registrarAtualizacao,
  incorporarAtualizacao,
  descartarAtualizacao,
  encerrarCancelamento,
} from "./demandLifecycleService";
import { executarExpurgo, CLIENTE_EXPURGADO } from "./crmPurge";
import type { VerifiedPair } from "./pairKey";

// CDC 16 — Fase 7. O que SÓ O BANCO prova.
//
// A máquina de estados já está provada caso a caso em `demandLifecycle.test.ts`,
// sem banco. O que sobra para aqui é o que uma regra pura não alcança: que
// incorporar uma atualização não encosta no que o pré-vendas escreveu, que o
// cascade do expurgo leva o que tem de levar e NÃO leva o registro que prova
// que ele aconteceu, e que uma corrida entre cancelar e assumir tem um vencedor
// só.

const TENANT = "test_tenant_cdc16_f7";
const USUARIO = "test_user_cdc16_f7";
const PAPEL = "test_role_cdc16_f7";

const PAR: VerifiedPair = {
  tenantId: TENANT,
  pairId: "pair_test_cdc16_f7",
  customerId: "cust_test_f7",
  customerName: "Cliente de Teste",
  crossEnvironment: false,
  sides: {
    cmcrm: { product: "cmcrm", installation_id: "inst_crm_f7", label: "CRM", environment: "development", status: "active" },
    presales: { product: "presales", installation_id: "inst_presales_f7", label: "PreSales", environment: "development", status: "active" },
  },
};

function envelope(ref: string, over: Record<string, any> = {}) {
  return {
    demand_ref: ref,
    company: { crm_company_id: "cmp_f7", name: "Prefeitura de Teste" },
    opportunity: { crm_opportunity_id: "opp_f7", name: "Pregão 12/2026", currency: "BRL", value: 250000, stage: "Proposta" },
    sheet: {
      title: "Videomonitoramento urbano",
      vertical: "Segurança Pública",
      description: "Implantação de 40 pontos.",
      deadline: "2026-09-30",
      proposal_validity_date: "2026-10-30",
      output_language: "Portuguese" as const,
      proposal_language: "Portuguese" as const,
      ai_orientation_mode: "Vendor-neutral" as const,
    },
    sent_by: { crm_user_id: "crm_u1", name: "Vendedor de Teste" },
    sent_at: "2026-08-28T12:00:00.000Z",
    ...over,
  };
}

const PATCH_PRAZO = {
  sheet: {
    title: "Videomonitoramento urbano",
    vertical: "Segurança Pública",
    description: "Implantação de 40 pontos.",
    deadline: "2026-10-15",
    proposal_validity_date: "2026-11-15",
    output_language: "Portuguese" as const,
    proposal_language: "Portuguese" as const,
    ai_orientation_mode: "Vendor-neutral" as const,
  },
  changed_by: { crm_user_id: "crm_u1", name: "Vendedor de Teste" },
  changed_at: "2026-08-28T13:00:00.000Z",
  note: "Prazo alterado por impugnação.",
};

async function limpar() {
  await prisma.crmPurgeExecution.deleteMany({ where: { tenantId: TENANT } });
  await prisma.demandUpdate.deleteMany({ where: { tenantId: TENANT } });
  await prisma.demandOutboundEvent.deleteMany({ where: { tenantId: TENANT } });
  await prisma.demandDocument.deleteMany({ where: { tenantId: TENANT } });
  await prisma.demand.deleteMany({ where: { tenantId: TENANT } });
  await prisma.documentContent.deleteMany({ where: { tenantId: TENANT } });
  await prisma.document.deleteMany({ where: { tenantId: TENANT } });
  await prisma.idempotencyRecord.deleteMany({ where: { tenantId: TENANT } });
  await prisma.project.deleteMany({ where: { tenantId: TENANT } });
  await prisma.user.deleteMany({ where: { tenantId: TENANT } });
  await prisma.role.deleteMany({ where: { tenantId: TENANT } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
}

/** Só os dados da fase, mantendo tenant, papel e usuário de pé. */
async function limparCenario() {
  await prisma.crmPurgeExecution.deleteMany({ where: { tenantId: TENANT } });
  await prisma.demandUpdate.deleteMany({ where: { tenantId: TENANT } });
  await prisma.demandOutboundEvent.deleteMany({ where: { tenantId: TENANT } });
  await prisma.demandDocument.deleteMany({ where: { tenantId: TENANT } });
  await prisma.demand.deleteMany({ where: { tenantId: TENANT } });
  await prisma.documentContent.deleteMany({ where: { tenantId: TENANT } });
  await prisma.document.deleteMany({ where: { tenantId: TENANT } });
  await prisma.project.deleteMany({ where: { tenantId: TENANT } });
}

const dentro = <T,>(fn: () => Promise<T>) => runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, fn);

describe("CDC 16 F7 - ciclo de vida contra banco real", () => {
  beforeAll(async () => {
    await limpar();
    await prisma.tenant.create({ data: { id: TENANT, name: "Tenant de teste (demandLifecycleService.test.ts)" } });
    await prisma.role.create({
      data: { id: PAPEL, tenantId: TENANT, name: "Papel de teste", description: "", permissions: ["demand:read", "demand:assume"] },
    });
    await prisma.user.create({
      // `.invalid` nunca resolve (RFC 2606). A F3 entregou e-mail de teste na
      // caixa de uma pessoa de verdade uma vez, e a regra ficou.
      data: { id: USUARIO, tenantId: TENANT, name: "Ana", email: `${USUARIO}@teste.invalid`, roleId: PAPEL },
    });
  });

  afterAll(limpar);
  beforeEach(limparCenario);

  it("cancelar na FILA efetiva na hora, e cancelar de novo não reescreve o carimbo", async () => {
    await dentro(async () => {
      const d = await criarDemanda(envelope("f7_fila") as any, PAR);
      const primeiro = await aplicarCancelamento(d.id, {
        justificativa: "O cliente cancelou o edital inteiro.",
        aprovadorCrmUserId: "crm_lider",
        aprovadorNome: "Líder Direto",
      });
      expect(primeiro.ok && primeiro.desfecho).toBe("cancelled");

      const depois = await prisma.demand.findUniqueOrThrow({ where: { id: d.id } });
      expect(depois.status).toBe("cancelled");
      expect(depois.cancellationOutcome).toBe("cancelled");
      expect(depois.cancellationApprovedByName).toBe("Líder Direto");

      const segundo = await aplicarCancelamento(d.id, {
        justificativa: "Outra justificativa qualquer.",
        aprovadorCrmUserId: "crm_outro",
        aprovadorNome: "Outra Pessoa",
      });
      expect(segundo.ok && segundo.desfecho).toBe("cancelled");
      expect(segundo.ok && "jaEstava" in segundo && segundo.jaEstava).toBe(true);

      const final = await prisma.demand.findUniqueOrThrow({ where: { id: d.id } });
      // O carimbo NÃO andou, e o aprovador NÃO mudou: a demanda já estava no
      // estado que o CRM queria, e reescrever faria a hora do cancelamento
      // caminhar a cada retentativa da fila do outro lado.
      expect(final.cancelledAt?.toISOString()).toBe(depois.cancelledAt?.toISOString());
      expect(final.cancellationApprovedByName).toBe("Líder Direto");
    });
  });

  it("cancelar uma demanda ASSUMIDA vira pedido, e o estado NÃO muda", async () => {
    await dentro(async () => {
      const d = await criarDemanda(envelope("f7_assumida") as any, PAR);
      const assumida = await assumirDemanda(d.id, USUARIO);
      expect(assumida.ok).toBe(true);

      const r = await aplicarCancelamento(d.id, {
        justificativa: "O cliente desistiu da contratação.",
        aprovadorCrmUserId: "crm_lider",
        aprovadorNome: "Líder Direto",
      });
      expect(r.ok && r.desfecho).toBe("cancellation_requested");

      const depois = await prisma.demand.findUniqueOrThrow({ where: { id: d.id } });
      expect(depois.status).toBe("assigned");
      expect(depois.cancellationRequestedAt).not.toBeNull();
      expect(depois.cancellationClosedAt).toBeNull();
      // O projeto continua de pé: alguém está trabalhando nele.
      expect(depois.projectId).not.toBeNull();
    });
  });

  it("encerrar depois do pedido fecha a demanda e MANTÉM o projeto", async () => {
    await dentro(async () => {
      const d = await criarDemanda(envelope("f7_encerrar") as any, PAR);
      const assumida = await assumirDemanda(d.id, USUARIO);
      const projectId = assumida.ok ? assumida.projectId : "";
      await aplicarCancelamento(d.id, {
        justificativa: "Edital revogado pela administração.",
        aprovadorCrmUserId: "crm_lider",
        aprovadorNome: "Líder Direto",
      });

      const semPedido = await encerrarCancelamento("dem_inexistente", USUARIO);
      expect(semPedido.ok).toBe(false);

      const r = await encerrarCancelamento(d.id, USUARIO);
      expect(r.ok).toBe(true);

      const depois = await prisma.demand.findUniqueOrThrow({ where: { id: d.id } });
      expect(depois.status).toBe("cancelled");
      expect(depois.cancellationOutcome).toBe("cancelled");
      expect(depois.cancellationClosedByUserId).toBe(USUARIO);
      // A regra que a F1 escreveu para a devolução, e que vale igual aqui.
      expect(await prisma.project.findUnique({ where: { id: projectId } })).not.toBeNull();

      // Encerrar de novo não acontece: o pedido já foi fechado.
      const outra = await encerrarCancelamento(d.id, USUARIO);
      expect(outra.ok).toBe(false);
    });
  });

  it("atualização na FILA já nasce decidida; com dono, fica pendente", async () => {
    await dentro(async () => {
      const naFila = await criarDemanda(envelope("f7_upd_fila") as any, PAR);
      const r1 = await registrarAtualizacao(naFila.id, PATCH_PRAZO as any);
      expect(r1.ok && r1.pendingUpdates).toBe(0);
      const linhaFila = await prisma.demandUpdate.findFirstOrThrow({ where: { demandId: naFila.id } });
      expect(linhaFila.status).toBe("incorporated");
      // E o prazo da DEMANDA mudou na hora: ela existe para espelhar o CRM.
      const demandaFila = await prisma.demand.findUniqueOrThrow({ where: { id: naFila.id } });
      expect(demandaFila.deadline.toISOString().substring(0, 10)).toBe("2026-10-15");

      const comDono = await criarDemanda(envelope("f7_upd_dono") as any, PAR);
      await assumirDemanda(comDono.id, USUARIO);
      const r2 = await registrarAtualizacao(comDono.id, PATCH_PRAZO as any);
      expect(r2.ok && r2.pendingUpdates).toBe(1);
    });
  });

  it("o PATCH NÃO toca no projeto; só incorporar toca", async () => {
    await dentro(async () => {
      const d = await criarDemanda(envelope("f7_nao_toca") as any, PAR);
      const assumida = await assumirDemanda(d.id, USUARIO);
      const projectId = assumida.ok ? assumida.projectId : "";

      await registrarAtualizacao(d.id, PATCH_PRAZO as any);
      const antes = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
      // É o coração da D27: o prazo do projeto continua o que era.
      expect(antes.deadline.toISOString().substring(0, 10)).toBe("2026-09-30");

      const pendente = await prisma.demandUpdate.findFirstOrThrow({ where: { demandId: d.id, status: "pending" } });
      const r = await incorporarAtualizacao(pendente.id, USUARIO);
      expect(r.ok).toBe(true);

      const depois = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
      expect(depois.deadline.toISOString().substring(0, 10)).toBe("2026-10-15");
    });
  });

  it("incorporar a mais NOVA cobre as pendentes anteriores", async () => {
    await dentro(async () => {
      const d = await criarDemanda(envelope("f7_ordem") as any, PAR);
      await assumirDemanda(d.id, USUARIO);

      await registrarAtualizacao(d.id, PATCH_PRAZO as any);
      const maisNova = {
        ...PATCH_PRAZO,
        sheet: { ...PATCH_PRAZO.sheet, deadline: "2026-11-01", proposal_validity_date: "2026-12-01" },
        changed_at: "2026-08-28T15:00:00.000Z",
      };
      await registrarAtualizacao(d.id, maisNova as any);

      const pendentes = await prisma.demandUpdate.findMany({
        where: { demandId: d.id, status: "pending" },
        orderBy: { changedAt: "asc" },
      });
      expect(pendentes).toHaveLength(2);

      const r = await incorporarAtualizacao(pendentes[1].id, USUARIO);
      expect(r.ok && r.cobertas).toBe(1);
      expect(await prisma.demandUpdate.count({ where: { demandId: d.id, status: "pending" } })).toBe(0);

      // Sem essa regra, incorporar a antiga depois escreveria no projeto um
      // prazo que o CRM já corrigiu — e ninguém teria como saber.
      const projeto = await prisma.project.findFirstOrThrow({ where: { tenantId: TENANT } });
      expect(projeto.deadline.toISOString().substring(0, 10)).toBe("2026-11-01");
    });
  });

  it("descartar exige registro e não escreve no projeto", async () => {
    await dentro(async () => {
      const d = await criarDemanda(envelope("f7_descarte") as any, PAR);
      const assumida = await assumirDemanda(d.id, USUARIO);
      const projectId = assumida.ok ? assumida.projectId : "";
      await registrarAtualizacao(d.id, PATCH_PRAZO as any);
      const pendente = await prisma.demandUpdate.findFirstOrThrow({ where: { demandId: d.id, status: "pending" } });

      const r = await descartarAtualizacao(pendente.id, USUARIO, "O prazo novo já estava considerado na análise.");
      expect(r.ok).toBe(true);
      const linha = await prisma.demandUpdate.findUniqueOrThrow({ where: { id: pendente.id } });
      expect(linha.status).toBe("dismissed");
      expect(linha.decisionNote).toContain("já estava considerado");

      const projeto = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
      expect(projeto.deadline.toISOString().substring(0, 10)).toBe("2026-09-30");

      // Decidir duas vezes não acontece.
      expect((await descartarAtualizacao(pendente.id, USUARIO, "de novo, e não devia")).ok).toBe(false);
      expect((await incorporarAtualizacao(pendente.id, USUARIO)).ok).toBe(false);
    });
  });

  it("um PATCH que não muda nada NÃO vira linha", async () => {
    await dentro(async () => {
      const d = await criarDemanda(envelope("f7_igual") as any, PAR);
      await assumirDemanda(d.id, USUARIO);
      const igual = {
        sheet: {
          title: "Videomonitoramento urbano",
          vertical: "Segurança Pública",
          description: "Implantação de 40 pontos.",
          // O MESMO prazo, escrito como instante em vez de dia civil.
          deadline: "2026-09-30T00:00:00.000Z",
          proposal_validity_date: "2026-10-30",
          output_language: "Portuguese" as const,
          proposal_language: "Portuguese" as const,
          ai_orientation_mode: "Vendor-neutral" as const,
        },
      };
      const r = await registrarAtualizacao(d.id, igual as any);
      expect(r.ok && r.pendingUpdates).toBe(0);
      expect(await prisma.demandUpdate.count({ where: { demandId: d.id } })).toBe(0);
    });
  });

  it("o expurgo de EMPRESA apaga a demanda, tira a referência do projeto e o REGISTRO sobrevive", async () => {
    await dentro(async () => {
      const d = await criarDemanda(envelope("f7_expurgo") as any, PAR);
      const assumida = await assumirDemanda(d.id, USUARIO);
      const projectId = assumida.ok ? assumida.projectId : "";

      const r = await executarExpurgo({
        tenantId: TENANT,
        crmInstallationId: "inst_crm_f7",
        reason: "retention",
        targets: [{ kind: "company", crm_id: "cmp_f7" }],
      });
      expect(r.demandsDeleted).toBe(1);
      expect(r.projectsUnlinked).toBe(1);

      expect(await prisma.demand.findUnique({ where: { id: d.id } })).toBeNull();

      // O PROJETO sobrevive — é trabalho, não cópia —, mas perde a referência.
      const projeto = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
      expect(projeto.crmCompanyId).toBeNull();
      expect(projeto.crmOpportunityId).toBeNull();
      expect(projeto.customerName).toBe(CLIENTE_EXPURGADO);

      // E o registro continua lá: `crm_purge_executions` não tem FK para
      // `demands`, então nenhum cascade o alcança.
      const registro = await prisma.crmPurgeExecution.findUniqueOrThrow({ where: { id: r.execucaoId } });
      expect(registro.reason).toBe("retention");
      expect(registro.demandsDeleted).toBe(1);
    });
  });

  it("o registro do expurgo NÃO guarda nome de arquivo nem texto extraído", async () => {
    await dentro(async () => {
      await criarDemanda(
        envelope("f7_sem_nome", {
          documents: [
            {
              document_ref: "doc_1",
              filename: "edital-fulano-de-tal-cpf-12345678900.pdf",
              mime_type: "application/pdf",
              size_bytes: 10,
              sha256: "a".repeat(64),
              extracted_text: "SEGREDO QUE NAO PODE SOBREVIVER AO EXPURGO",
              crm_document_id: "crmdoc_1",
            },
          ],
        }) as any,
        PAR
      );

      const r = await executarExpurgo({
        tenantId: TENANT,
        crmInstallationId: "inst_crm_f7",
        reason: "data_subject_request",
        targets: [{ kind: "document", crm_id: "crmdoc_1" }],
      });

      const registro = await prisma.crmPurgeExecution.findUniqueOrThrow({ where: { id: r.execucaoId } });
      const serializado = JSON.stringify(registro);
      // Num pedido do titular, o nome do arquivo pode ser o próprio dado que se
      // pediu para apagar. O sha256 identifica sem reproduzir.
      expect(serializado).not.toContain("edital-fulano-de-tal");
      expect(serializado).not.toContain("SEGREDO QUE NAO PODE");
      expect(serializado).toContain("a".repeat(64));
      expect(await prisma.demandDocument.count({ where: { tenantId: TENANT } })).toBe(0);
    });
  });

  it("expurgar duas vezes apaga zero na segunda, e grava DOIS registros", async () => {
    await dentro(async () => {
      await criarDemanda(envelope("f7_duas_vezes") as any, PAR);
      const alvo = [{ kind: "company" as const, crm_id: "cmp_f7" }];

      const primeira = await executarExpurgo({ tenantId: TENANT, crmInstallationId: "inst_crm_f7", reason: "retention", targets: alvo });
      const segunda = await executarExpurgo({ tenantId: TENANT, crmInstallationId: "inst_crm_f7", reason: "retention", targets: alvo });

      expect(primeira.demandsDeleted).toBe(1);
      expect(segunda.demandsDeleted).toBe(0);
      // O registro é de EXECUÇÃO, e não de efeito: saber que o CRM pediu duas
      // vezes é parte do que uma auditoria vai querer ler.
      expect(await prisma.crmPurgeExecution.count({ where: { tenantId: TENANT } })).toBe(2);
    });
  });
});
