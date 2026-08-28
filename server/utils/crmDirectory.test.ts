import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../../src/prisma";
import { runWithTenant } from "../../src/tenantContext";
import { randomId } from "../../src/idGenerator";
import { calcularCargas, calcularDueAt } from "./demandSla";

// CDC 16 — Fase 6. O que SÓ o banco prova, na demanda ESPELHO.
//
// A regra do contrato é pura e vive do lado do CMCRM. Aqui ficam três coisas que uma leitura do
// código passaria e mentiria: que a demanda espelho REALMENTE cabe no schema sem remetente, que
// ela conta na carga de quem segura o projeto (D40), e que o índice único de `demandRef`
// continua valendo para ela como para qualquer outra.

const TENANT = "test_tenant_cdc16_f6";
const PAPEL = "test_role_cdc16_f6";
const ANA = "test_user_cdc16_f6_ana";

async function limpar() {
  await prisma.demandSlaBreach.deleteMany({ where: { tenantId: TENANT } });
  await prisma.demandOutboundEvent.deleteMany({ where: { tenantId: TENANT } });
  await prisma.demandDocument.deleteMany({ where: { tenantId: TENANT } });
  await prisma.demand.deleteMany({ where: { tenantId: TENANT } });
  await prisma.project.deleteMany({ where: { tenantId: TENANT } });
  await prisma.crmPairKey.deleteMany({ where: { tenantId: TENANT } });
  await prisma.user.deleteMany({ where: { tenantId: TENANT } });
  await prisma.role.deleteMany({ where: { tenantId: TENANT } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
}

const naTenant = <T>(fn: () => Promise<T>) => runWithTenant({ tenantId: TENANT }, fn);

async function criarProjeto() {
  const id = randomId("prj");
  await prisma.project.create({
    data: {
      id,
      tenantId: TENANT,
      name: "Edital direto F6",
      customerName: "Prefeitura de Exemplo",
      opportunityName: "Pregão 1/2026",
      vertical: "Segurança Pública",
      description: "Projeto nascido do intake, sem demanda do CRM.",
      status: "draft",
      deadline: new Date("2026-12-31T00:00:00.000Z"),
      proposalValidityDate: new Date("2027-01-31T00:00:00.000Z"),
      ownerUserId: ANA,
      outputLanguage: "Portuguese",
      proposalLanguage: "Portuguese",
      aiOrientationMode: "Vendor-neutral",
      aiOrientationText: "",
    },
  });
  return id;
}

async function criarEspelho(projectId: string, over: Record<string, any> = {}) {
  const id = randomId("dem");
  await prisma.demand.create({
    data: {
      id,
      tenantId: TENANT,
      demandRef: over.demandRef ?? `presales-1-${id}`,
      source: "presales",
      status: "assigned",
      assignedUserId: ANA,
      assignedAt: new Date("2026-08-28T10:00:00.000Z"),
      queuedAt: new Date("2026-08-28T10:00:00.000Z"),
      projectId,

      crmCompanyId: "cmp_f6",
      companyName: "Prefeitura de Exemplo",
      crmOpportunityId: "opp_f6",
      opportunityName: "Pregão 1/2026",

      title: "Edital direto F6",
      vertical: "Segurança Pública",
      description: "…",
      deadline: new Date("2026-12-31T00:00:00.000Z"),
      proposalValidityDate: new Date("2027-01-31T00:00:00.000Z"),
      aiOrientationMode: "Vendor-neutral",

      // O ponto do teste: numa demanda espelho não houve envio do lado do CRM.
      sentByCrmUserId: null,
      sentByName: null,
      sentAt: new Date("2026-08-28T10:00:00.000Z"),
      pairCrmInstallationId: "inst_crm_test",
      ...over,
    },
  });
  return id;
}

describe("CDC 16 F6 — a demanda espelho", () => {
  beforeAll(async () => {
    await limpar();
    await prisma.tenant.create({ data: { id: TENANT, name: "Tenant de teste (F6)" } });
    await prisma.role.create({
      data: {
        id: PAPEL,
        tenantId: TENANT,
        name: "Equipe F6",
        description: "",
        permissions: ["demand:read", "demand:assume", "project:create"],
      },
    });
    await prisma.user.create({
      data: { id: ANA, tenantId: TENANT, name: "Ana", email: `${ANA}@teste.invalid`, roleId: PAPEL },
    });
  });

  afterAll(limpar);

  beforeEach(async () => {
    await naTenant(async () => {
      await prisma.demand.deleteMany({});
      await prisma.project.deleteMany({});
      await prisma.crmPairKey.deleteMany({});
    });
  });

  it("nasce SEM remetente, e o schema aceita", async () => {
    await naTenant(async () => {
      const projeto = await criarProjeto();
      const id = await criarEspelho(projeto);
      const lida = await prisma.demand.findUnique({ where: { id } });
      expect(lida?.sentByCrmUserId).toBeNull();
      expect(lida?.sentByName).toBeNull();
      expect(lida?.source).toBe("presales");
    });
  });

  it("toda demanda que já existia continua sendo `crm` sem ninguém escrever nada", async () => {
    // O default da migration é o que impede a fase de reclassificar histórico: nenhuma demanda
    // anterior veio do caminho secundário, e isso é fato, não suposição.
    await naTenant(async () => {
      const id = randomId("dem");
      await prisma.demand.create({
        data: {
          id,
          tenantId: TENANT,
          demandRef: `crm-${id}`,
          status: "queued",
          crmCompanyId: "cmp",
          companyName: "X",
          crmOpportunityId: "opp",
          opportunityName: "Y",
          title: "T",
          vertical: "V",
          description: "D",
          deadline: new Date("2026-12-31T00:00:00.000Z"),
          proposalValidityDate: new Date("2027-01-31T00:00:00.000Z"),
          aiOrientationMode: "Vendor-neutral",
          sentByCrmUserId: "crm_u1",
          sentByName: "Vendedor",
          sentAt: new Date(),
          pairCrmInstallationId: "inst_crm_test",
        },
      });
      const lida = await prisma.demand.findUnique({ where: { id } });
      expect(lida?.source).toBe("crm");
    });
  });

  it("nasce ASSIGNED com o dono do projeto, e não na fila", async () => {
    // `queued` faria a fila oferecer para alguém assumir um trabalho que já começou — e o SLA
    // passaria a cobrar um prazo de assumir que ninguém deve.
    await naTenant(async () => {
      const projeto = await criarProjeto();
      const id = await criarEspelho(projeto);
      const lida = await prisma.demand.findUnique({ where: { id } });
      expect(lida?.status).toBe("assigned");
      expect(lida?.assignedUserId).toBe(ANA);
      expect(lida?.projectId).toBe(projeto);
    });
  });

  it("o prazo devido dela é o da ANÁLISE, não o de assumir", async () => {
    await naTenant(async () => {
      const projeto = await criarProjeto();
      const id = await criarEspelho(projeto);
      const demanda = await prisma.demand.findUniqueOrThrow({ where: { id } });
      const prazo = calcularDueAt(demanda as never, {
        enabled: true,
        assumeHours: 4,
        analysisHours: 24,
        proposalHours: 72,
      });
      // Assumir já aconteceu: o prazo corrente é o da etapa seguinte, contado de `assignedAt`.
      expect(prazo?.toISOString()).toBe("2026-08-29T10:00:00.000Z");
    });
  });

  it("conta na carga de quem segura o projeto (D40)", async () => {
    await naTenant(async () => {
      const projeto = await criarProjeto();
      await criarEspelho(projeto);
      const abertas = await prisma.demand.findMany({
        where: { assignedUserId: ANA, status: { in: ["assigned", "in_analysis"] } },
      });
      expect(abertas).toHaveLength(1);
      // Prazo distante: peso 1, o menor da régua — mas não zero. Uma demanda espelho ocupa a
      // pessoa como qualquer outra, e não contá-la faria a distribuição automática mandar
      // trabalho para quem já está cheio.
      const cargas = calcularCargas(
        [{ userId: ANA, abertas: abertas as never }],
        new Date("2026-08-28T12:00:00.000Z"),
      );
      expect(cargas[0].carga).toBe(1);
    });
  });

  it("o índice único de demandRef vale para ela como para qualquer outra", async () => {
    await naTenant(async () => {
      const projeto = await criarProjeto();
      await criarEspelho(projeto, { demandRef: "presales-1-repetida" });
      const outro = await criarProjeto();
      await expect(
        criarEspelho(outro, { demandRef: "presales-1-repetida" }),
      ).rejects.toThrow();
    });
  });

  it("a organização escolhida do CRM fica guardada no par, e não no projeto", async () => {
    // É um fato da INSTALAÇÃO, não de um projeto: a mesma instalação corresponde sempre à mesma
    // organização do outro lado, e guardá-la por projeto pediria a escolha de novo a cada edital.
    await naTenant(async () => {
      await prisma.crmPairKey.create({
        data: {
          tenantId: TENANT,
          keyEncrypted: "v2:falsa",
          keyHint: "abcd",
          crmInstallationId: "inst_crm_test",
          callbackBaseUrl: "https://exemplo.invalid/api/external/presales/v1",
          receivedAt: new Date(),
        },
      });
      const antes = await prisma.crmPairKey.findUnique({ where: { tenantId: TENANT } });
      expect(antes?.crmOrganizationId).toBeNull();

      await prisma.crmPairKey.update({
        where: { tenantId: TENANT },
        data: { crmOrganizationId: "org-1" },
      });
      const depois = await prisma.crmPairKey.findUnique({ where: { tenantId: TENANT } });
      expect(depois?.crmOrganizationId).toBe("org-1");
    });
  });
});
