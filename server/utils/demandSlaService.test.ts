import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../../src/prisma";
import { runWithTenant } from "../../src/tenantContext";
import { randomId } from "../../src/idGenerator";
import {
  assumirDemanda,
  pedirDevolucao,
  recusarDevolucao,
  reatribuirDemanda,
} from "./demands";
import { gravarSla, lerSla, politicaDeAtribuicao } from "./demandSlaConfig";
import {
  PERMISSAO_DE_GERENTE,
  equipeDePreVendas,
  escolherPorMenorCarga,
  gerentesDePreVendas,
  varrerPrazos,
} from "./demandSlaService";

// CDC 16 — Fase 5. O que SÓ o banco prova.
//
// A regra em si é pura e está em `demandSla.test.ts`. Aqui ficam três coisas que
// uma leitura-antes-de-escrever passaria e mentiria: que o índice único impede o
// mesmo prazo de alertar duas vezes, que o pedido de devolução não pode ser
// aberto duas vezes, e que a reatribuição move o DONO DO PROJETO junto.

const TENANT = "test_tenant_cdc16_f5";
const PAPEL_EQUIPE = "test_role_cdc16_f5_equipe";
const PAPEL_GERENTE = "test_role_cdc16_f5_gerente";
const ANA = "test_user_cdc16_f5_ana";
const BRUNO = "test_user_cdc16_f5_bruno";
const GERENTE = "test_user_cdc16_f5_gerente";

async function limpar() {
  await prisma.demandSlaBreach.deleteMany({ where: { tenantId: TENANT } });
  await prisma.demandOutboundEvent.deleteMany({ where: { tenantId: TENANT } });
  await prisma.demandDocument.deleteMany({ where: { tenantId: TENANT } });
  await prisma.demand.deleteMany({ where: { tenantId: TENANT } });
  await prisma.project.deleteMany({ where: { tenantId: TENANT } });
  await prisma.demandSlaSettings.deleteMany({ where: { tenantId: TENANT } });
  await prisma.user.deleteMany({ where: { tenantId: TENANT } });
  await prisma.role.deleteMany({ where: { tenantId: TENANT } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
}

async function criarDemandaCrua(over: Record<string, any> = {}) {
  const id = randomId("dem");
  await prisma.demand.create({
    data: {
      id,
      tenantId: TENANT,
      demandRef: over.demandRef ?? `f5_${id}`,
      status: "queued",
      crmCompanyId: "cmp_f5",
      companyName: "Prefeitura F5",
      crmOpportunityId: "opp_f5",
      opportunityName: "Pregão F5",
      title: "Demanda de teste da F5",
      vertical: "Segurança Pública",
      description: "…",
      deadline: new Date("2026-12-31T00:00:00.000Z"),
      proposalValidityDate: new Date("2027-01-31T00:00:00.000Z"),
      aiOrientationMode: "Vendor-neutral",
      sentByCrmUserId: "crm_u1",
      sentByName: "Vendedor F5",
      sentAt: new Date("2026-08-27T10:00:00.000Z"),
      pairCrmInstallationId: "inst_crm_test",
      queuedAt: new Date("2026-08-27T10:00:00.000Z"),
      ...over,
    },
  });
  return id;
}

const naTenant = <T>(fn: () => Promise<T>) => runWithTenant({ tenantId: TENANT }, fn);

describe("CDC 16 F5 - SLA, atribuição e devolução aprovada", () => {
  beforeAll(async () => {
    await limpar();
    await prisma.tenant.create({ data: { id: TENANT, name: "Tenant de teste (F5)" } });
    await prisma.role.create({
      data: { id: PAPEL_EQUIPE, tenantId: TENANT, name: "Equipe F5", description: "", permissions: ["demand:read", "demand:assume"] },
    });
    await prisma.role.create({
      data: {
        id: PAPEL_GERENTE,
        tenantId: TENANT,
        name: "Gerente F5",
        description: "",
        permissions: ["demand:read", "demand:assume", PERMISSAO_DE_GERENTE],
      },
    });
    for (const [id, nome, papel] of [
      [ANA, "Ana", PAPEL_EQUIPE],
      [BRUNO, "Bruno", PAPEL_EQUIPE],
      [GERENTE, "Gina", PAPEL_GERENTE],
    ]) {
      await prisma.user.create({ data: { id, tenantId: TENANT, name: nome, email: `${id}@teste.invalid`, roleId: papel } });
    }
  });

  afterAll(limpar);

  beforeEach(async () => {
    await naTenant(async () => {
      await prisma.demandSlaBreach.deleteMany({});
      await prisma.demandOutboundEvent.deleteMany({});
      await prisma.demand.deleteMany({});
      await prisma.project.deleteMany({});
      await prisma.demandSlaSettings.deleteMany({});
    });
  });

  it("sem linha de configuração, a política é auto-serviço e não há SLA", async () => {
    // É o estado de TODA instalação que existe hoje, e o que esta fase não pode
    // quebrar. A ausência da linha não é um defeito a ser corrigido com padrões.
    await naTenant(async () => {
      expect(await lerSla()).toBeNull();
      expect(await politicaDeAtribuicao()).toBe("auto_servico");
    });
  });

  it("gravar duas vezes atualiza a MESMA linha (é singleton, e o upsert do Prisma não serve aqui)", async () => {
    await naTenant(async () => {
      await gravarSla(TENANT, { enabled: true, assumeHours: 4, analysisHours: 8, proposalHours: 48, assignmentPolicy: "automatico" });
      await gravarSla(TENANT, { enabled: true, assumeHours: 6, analysisHours: 8, proposalHours: 48, assignmentPolicy: "automatico" });
      expect(await prisma.demandSlaSettings.count()).toBe(1);
      expect((await lerSla())!.assumeHours).toBe(6);
    });
  });

  it("gerente é quem tem a permissão; sem papel que a tenha, a lista é VAZIA e não um erro", async () => {
    await naTenant(async () => {
      expect((await gerentesDePreVendas()).map((g) => g.id)).toEqual([GERENTE]);
      expect((await equipeDePreVendas()).map((u) => u.id).sort()).toEqual([ANA, BRUNO, GERENTE].sort());
    });
  });

  it("o mesmo prazo vencido só alerta UMA vez, e é o índice único que garante", async () => {
    await naTenant(async () => {
      await gravarSla(TENANT, { enabled: true, assumeHours: 1, analysisHours: 24, proposalHours: 120, assignmentPolicy: "auto_servico" });
      // Entrou na fila há dois dias e ninguém assumiu: o prazo de 1 h venceu.
      await criarDemandaCrua({ queuedAt: new Date(Date.now() - 2 * 86400_000) });

      const primeira = await varrerPrazos(TENANT);
      expect(primeira.vencidas).toBe(1);
      expect(primeira.novas).toBe(1);

      // O verificador roda a cada minuto. Sem a linha, o gerente receberia o
      // mesmo atraso sessenta vezes por hora.
      const segunda = await varrerPrazos(TENANT);
      expect(segunda.vencidas).toBe(1);
      expect(segunda.novas).toBe(0);
      expect(await prisma.demandSlaBreach.count()).toBe(1);
    });
  });

  it("o alerta guarda QUEM foi avisado, e cai na equipe quando não há gerente", async () => {
    await naTenant(async () => {
      await gravarSla(TENANT, { enabled: true, assumeHours: 1, analysisHours: 24, proposalHours: 120, assignmentPolicy: "auto_servico" });
      await criarDemandaCrua({ queuedAt: new Date(Date.now() - 2 * 86400_000) });

      await varrerPrazos(TENANT);
      const comGerente = await prisma.demandSlaBreach.findFirstOrThrow();
      expect(comGerente.recipientKind).toBe("manager");
      expect(comGerente.recipientUserIds).toEqual([GERENTE]);

      // Tirado o gerente, o próximo alerta vai para a equipe (D19).
      await prisma.demandSlaBreach.deleteMany({});
      await prisma.role.update({ where: { id: PAPEL_GERENTE }, data: { permissions: ["demand:read", "demand:assume"] } });
      await varrerPrazos(TENANT);
      const semGerente = await prisma.demandSlaBreach.findFirstOrThrow();
      expect(semGerente.recipientKind).toBe("team");
      expect(semGerente.recipientUserIds.sort()).toEqual([ANA, BRUNO, GERENTE].sort());
      await prisma.role.update({
        where: { id: PAPEL_GERENTE },
        data: { permissions: ["demand:read", "demand:assume", PERMISSAO_DE_GERENTE] },
      });
    });
  });

  it("o prazo vencido enfileira `sla_breached` para o CRM, com o instante do VENCIMENTO", async () => {
    await naTenant(async () => {
      await gravarSla(TENANT, { enabled: true, assumeHours: 1, analysisHours: 24, proposalHours: 120, assignmentPolicy: "auto_servico" });
      const queuedAt = new Date(Date.now() - 2 * 86400_000);
      await criarDemandaCrua({ queuedAt });
      await varrerPrazos(TENANT);

      const saida = await prisma.demandOutboundEvent.findFirstOrThrow({ where: { event: "sla_breached" } });
      const corpo = saida.payload as any;
      // O fato é o VENCIMENTO (entrada na fila + 1 h), e não o instante da
      // varredura: um serviço parado não pode encolher o atraso.
      expect(new Date(corpo.occurred_at).getTime()).toBe(queuedAt.getTime() + 3600_000);
      expect(corpo.due_at).toBe(new Date(queuedAt.getTime() + 3600_000).toISOString());
      // Sem ator: o ator de um prazo vencido é o relógio.
      expect(corpo.actor).toBeUndefined();
    });
  });

  it("SLA desligado não alerta, mesmo com demanda parada há dois dias", async () => {
    await naTenant(async () => {
      await gravarSla(TENANT, { enabled: false, assumeHours: 1, analysisHours: 24, proposalHours: 120, assignmentPolicy: "auto_servico" });
      await criarDemandaCrua({ queuedAt: new Date(Date.now() - 2 * 86400_000) });
      const r = await varrerPrazos(TENANT);
      expect(r.vencidas).toBe(0);
      expect(await prisma.demandSlaBreach.count()).toBe(0);
    });
  });

  it("a distribuição automática escolhe quem tem menos trabalho urgente (D40)", async () => {
    await naTenant(async () => {
      // Ana segura uma demanda que vence amanhã (peso 3); Bruno, uma que vence
      // em três meses (peso 1). A próxima é do Bruno.
      const daAna = await criarDemandaCrua({ deadline: new Date(Date.now() + 86400_000) });
      await assumirDemanda(daAna, ANA);
      const doBruno = await criarDemandaCrua({ deadline: new Date(Date.now() + 90 * 86400_000) });
      await assumirDemanda(doBruno, BRUNO);
      // A gerente não segura nada, então venceria os dois — tirada da conta com
      // uma demanda urgente também, para o teste medir a régua e não a lista.
      const daGina = await criarDemandaCrua({ deadline: new Date(Date.now() + 86400_000) });
      await assumirDemanda(daGina, GERENTE);

      expect(await escolherPorMenorCarga(new Date())).toBe(BRUNO);
    });
  });

  it("a devolução pedida não pode ser aberta duas vezes", async () => {
    await naTenant(async () => {
      const id = await criarDemandaCrua();
      await assumirDemanda(id, ANA);
      expect((await pedirDevolucao(id, ANA, "o edital anexado está incompleto")).ok).toBe(true);
      const segunda = await pedirDevolucao(id, ANA, "outro motivo qualquer aqui");
      expect(segunda.ok).toBe(false);
      if (!segunda.ok) expect(segunda.motivo).toBe("ja_pedida");
    });
  });

  it("recusar guarda o motivo e a demanda CONTINUA com quem a assumiu", async () => {
    await naTenant(async () => {
      const id = await criarDemandaCrua();
      await assumirDemanda(id, ANA);
      await pedirDevolucao(id, ANA, "o edital anexado está incompleto");
      const r = await recusarDevolucao(id, GERENTE, "os anexos estão no portal da licitação");
      expect(r.ok).toBe(true);
      const depois = await prisma.demand.findUniqueOrThrow({ where: { id } });
      expect(depois.status).toBe("assigned");
      expect(depois.assignedUserId).toBe(ANA);
      expect(depois.returnRejectionReason).toBe("os anexos estão no portal da licitação");
      // A devolução NÃO aconteceu: nada pode ter ido ao CRM.
      expect(await prisma.demandOutboundEvent.count({ where: { event: "returned" } })).toBe(0);
    });
  });

  it("recusar sem pedido em aberto é recusado, e não silenciosamente aceito", async () => {
    await naTenant(async () => {
      const id = await criarDemandaCrua();
      await assumirDemanda(id, ANA);
      const r = await recusarDevolucao(id, GERENTE, "motivo qualquer com dez caracteres");
      expect(r.ok).toBe(false);
    });
  });

  it("reatribuir move o DONO DO PROJETO junto, e encerra o pedido pendente", async () => {
    await naTenant(async () => {
      const id = await criarDemandaCrua();
      const assumida = await assumirDemanda(id, ANA);
      expect(assumida.ok).toBe(true);
      if (!assumida.ok) return;
      await pedirDevolucao(id, ANA, "o edital anexado está incompleto");

      const r = await reatribuirDemanda(id, BRUNO, GERENTE);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.anteriorUserId).toBe(ANA);

      const depois = await prisma.demand.findUniqueOrThrow({ where: { id } });
      expect(depois.assignedUserId).toBe(BRUNO);
      expect(depois.assignmentSource).toBe("manager");
      expect(depois.assignedByUserId).toBe(GERENTE);
      expect(depois.returnRequestedAt).toBeNull();

      // Sem isto, Bruno receberia uma demanda cujo projeto ele não enxerga: a
      // visibilidade deste produto é por dono, gerente do dono e aprovador.
      const projeto = await prisma.project.findUniqueOrThrow({ where: { id: assumida.projectId } });
      expect(projeto.ownerUserId).toBe(BRUNO);
    });
  });

  it("reatribuir para a mesma pessoa é recusado", async () => {
    await naTenant(async () => {
      const id = await criarDemandaCrua();
      await assumirDemanda(id, ANA);
      const r = await reatribuirDemanda(id, ANA, GERENTE);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motivo).toBe("mesma_pessoa");
    });
  });

  it("assumir guarda COMO a demanda chegou a essa pessoa", async () => {
    await naTenant(async () => {
      const sozinha = await criarDemandaCrua();
      await assumirDemanda(sozinha, ANA);
      const a = await prisma.demand.findUniqueOrThrow({ where: { id: sozinha } });
      // Auto-serviço: ninguém decidiu por ela, e a coluna fica nula.
      expect(a.assignmentSource).toBeNull();
      expect(a.assignedByUserId).toBeNull();

      const dirigida = await criarDemandaCrua();
      await assumirDemanda(dirigida, ANA, { byUserId: GERENTE, source: "manager" });
      const b = await prisma.demand.findUniqueOrThrow({ where: { id: dirigida } });
      expect(b.assignmentSource).toBe("manager");
      expect(b.assignedByUserId).toBe(GERENTE);
    });
  });
});
