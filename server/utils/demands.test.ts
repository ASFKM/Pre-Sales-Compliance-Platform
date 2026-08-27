import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../src/prisma";
import { runWithTenant } from "../../src/tenantContext";
import { DemandCreateSchema, criarDemanda, toDemandState, assumirDemanda, devolverDemanda } from "./demands";
import type { VerifiedPair } from "./pairKey";

// CDC 16 — Fase 1. Testes contra banco real (a CI provisiona um Postgres efêmero
// e aplica as migrations antes de rodar - ver .github/workflows/ci.yml).
//
// O que só o banco prova, e é por isso que estes casos não são unitários: que o
// índice único recusa a segunda demanda com o mesmo demand_ref, e que duas
// pessoas assumindo ao mesmo tempo não viram dois projetos. Uma leitura-antes-de-
// escrever passaria nos dois casos e mentiria - a frente 14 já registrou um
// upsert concorrente que não falhou e deixou o último a escrever ganhar.

const TENANT = "test_tenant_cdc16_f1";
const USUARIO_A = "test_user_cdc16_a";
const USUARIO_B = "test_user_cdc16_b";
const PAPEL = "test_role_cdc16";

const PAR: VerifiedPair = {
  tenantId: TENANT,
  pairId: "pair_test_cdc16",
  customerId: "cust_test",
  customerName: "Cliente de Teste",
  crossEnvironment: true,
  sides: {
    cmcrm: { product: "cmcrm", installation_id: "inst_crm_test", label: "CRM dev", environment: "development", status: "active" },
    presales: { product: "presales", installation_id: "inst_presales_test", label: "PreSales dev", environment: "production", status: "active" },
  },
};

function envelope(ref: string) {
  return {
    demand_ref: ref,
    company: { crm_company_id: "cmp_1", name: "Prefeitura de Teste", tax_id: "12345678000199", cnpj_root: "12345678" },
    opportunity: { crm_opportunity_id: "opp_1", name: "Pregão 12/2026", currency: "BRL", value: 250000, margin_percent: 18.5, risks: ["prazo curto"] },
    sheet: {
      title: "Videomonitoramento urbano",
      vertical: "Segurança Pública",
      description: "Implantação de 40 pontos de monitoramento.",
      deadline: "2026-09-30",
      proposal_validity_date: "2026-10-30",
      ai_orientation_mode: "Vendor-neutral" as const,
    },
    sent_by: { crm_user_id: "crm_u1", name: "Vendedor de Teste" },
    sent_at: "2026-08-27T12:00:00.000Z",
  };
}

async function limpar() {
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

describe("CDC 16 F1 - Demanda, fila e o ato de assumir", () => {
  beforeAll(async () => {
    // Limpa só os ids deste arquivo: um deleteMany sem where apagaria a linha do
    // vizinho quando o vitest roda arquivos em paralelo.
    await limpar();
    await prisma.tenant.create({ data: { id: TENANT, name: "Tenant de teste (demands.test.ts)" } });
    await prisma.role.create({ data: { id: PAPEL, tenantId: TENANT, name: "Papel de teste", description: "", permissions: ["demand:read", "demand:assume"] } });
    for (const [id, nome] of [[USUARIO_A, "Ana"], [USUARIO_B, "Bruno"]]) {
      await prisma.user.create({ data: { id, tenantId: TENANT, name: nome, email: `${id}@teste.local`, roleId: PAPEL } });
    }
  });

  afterAll(limpar);

  it("recusa ficha incompleta com o nome do campo que falta", () => {
    const semPrazo: any = envelope("dr_incompleta");
    delete semPrazo.sheet.deadline;
    const r = DemandCreateSchema.safeParse(semPrazo);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join(".") === "sheet.deadline")).toBe(true);
    }
  });

  it("recusa sha256 que não é hexadecimal de 64 caracteres", () => {
    const env: any = envelope("dr_sha");
    env.documents = [{ document_ref: "d1", filename: "edital.pdf", mime_type: "application/pdf", size_bytes: 10, sha256: "abc" }];
    const r = DemandCreateSchema.safeParse(env);
    expect(r.success).toBe(false);
  });

  it("cria a demanda SEM dono e SEM projeto, e guarda o par de onde ela veio", async () => {
    const criada = await runWithTenant({ tenantId: TENANT }, async () =>
      criarDemanda(DemandCreateSchema.parse(envelope("dr_1")), PAR)
    );
    expect(criada.status).toBe("queued");
    expect(criada.assignedUserId).toBeNull();
    expect(criada.projectId).toBeNull();
    // Tirado do par, não do corpo: quem envia não escolhe de que instalação diz vir.
    expect(criada.pairCrmInstallationId).toBe("inst_crm_test");
    expect(criada.pairCrossEnvironment).toBe(true);
  });

  it("o estado devolvido ao CRM não inventa due_at enquanto não houver SLA", async () => {
    const d = await runWithTenant({ tenantId: TENANT }, async () =>
      prisma.demand.findFirstOrThrow({ where: { demandRef: "dr_1" }, include: { assignedUser: { select: { name: true } } } })
    );
    const estado = toDemandState(d);
    expect(estado.demand_ref).toBe("dr_1");
    expect(estado.status).toBe("queued");
    expect(estado.due_at).toBeUndefined();
    expect(estado.assigned_to).toBeUndefined();
    expect(estado.presales_project_id).toBeUndefined();
  });

  it("o banco recusa a segunda demanda com o mesmo demand_ref no mesmo tenant", async () => {
    await expect(
      runWithTenant({ tenantId: TENANT }, async () => criarDemanda(DemandCreateSchema.parse(envelope("dr_1")), PAR))
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("assumir cria o Projeto com dono e devolve a demanda ligada a ele", async () => {
    const r = await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
      const d = await prisma.demand.findFirstOrThrow({ where: { demandRef: "dr_1" } });
      return assumirDemanda(d.id, USUARIO_A);
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const projeto = await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () =>
      prisma.project.findUniqueOrThrow({ where: { id: r.projectId } })
    );
    expect(projeto.ownerUserId).toBe(USUARIO_A);
    expect(projeto.name).toBe("Videomonitoramento urbano");
    // D31: o cliente entra como REFERÊNCIA, e é isso que a F3 vai usar para
    // devolver evento à oportunidade certa.
    expect(projeto.crmCompanyId).toBe("cmp_1");
    expect(projeto.crmOpportunityId).toBe("opp_1");
    expect(r.demand.status).toBe("assigned");
    expect(r.demand.projectId).toBe(projeto.id);
  });

  it("duas pessoas assumindo a mesma demanda: uma ganha, a outra recebe 'já assumida' e nenhum projeto sobra", async () => {
    const criada = await runWithTenant({ tenantId: TENANT }, async () =>
      criarDemanda(DemandCreateSchema.parse(envelope("dr_corrida")), PAR)
    );
    const projetosAntes = await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () =>
      prisma.project.count()
    );

    const [a, b] = await Promise.all([
      runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => assumirDemanda(criada.id, USUARIO_A)),
      runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => assumirDemanda(criada.id, USUARIO_B)),
    ]);

    const vencedores = [a, b].filter((r) => r.ok);
    expect(vencedores).toHaveLength(1);
    const perdedor = [a, b].find((r) => !r.ok) as any;
    expect(perdedor.motivo).toBe("ja_assumida");

    const projetosDepois = await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () =>
      prisma.project.count()
    );
    // Um único projeto a mais: quem perdeu a corrida não deixou órfão.
    expect(projetosDepois - projetosAntes).toBe(1);
  });

  it("devolver exige a demanda assumida e guarda o motivo; o projeto criado continua existindo", async () => {
    const d = await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () =>
      prisma.demand.findFirstOrThrow({ where: { demandRef: "dr_1" } })
    );
    const projectId = d.projectId;
    const r = await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () =>
      devolverDemanda(d.id, "O edital anexado está incompleto: faltam os anexos técnicos.")
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.demand.status).toBe("returned");
    expect(r.demand.returnedReason).toContain("anexos técnicos");
    expect(r.demand.returnedAt).toBeTruthy();

    const projeto = await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () =>
      prisma.project.findUnique({ where: { id: projectId as string } })
    );
    expect(projeto).not.toBeNull();

    // Uma demanda devolvida não volta a ser assumível nesta fase.
    const denovo = await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => assumirDemanda(d.id, USUARIO_B));
    expect(denovo.ok).toBe(false);
  });

  it("uma demanda na fila não pode ser devolvida", async () => {
    const criada = await runWithTenant({ tenantId: TENANT }, async () =>
      criarDemanda(DemandCreateSchema.parse(envelope("dr_naofila")), PAR)
    );
    const r = await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () =>
      devolverDemanda(criada.id, "motivo suficientemente longo")
    );
    expect(r.ok).toBe(false);
  });

  it("a Demanda é escopada por tenant como todo o resto: outro tenant não a enxerga", async () => {
    const vistaDeOutro = await runWithTenant({ tenantId: "test_tenant_cdc16_outro" }, async () =>
      prisma.demand.findFirst({ where: { demandRef: "dr_1" } })
    );
    expect(vistaDeOutro).toBeNull();
  });
});
