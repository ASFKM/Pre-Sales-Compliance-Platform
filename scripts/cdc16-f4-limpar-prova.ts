import "dotenv/config";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";

/**
 * Limpeza do que a prova da F4 criou NO PRODUTO PUBLICADO.
 *
 * Apaga só o que a prova nomeou: as demandas cujo `demand_ref` começa com `cmcrm-f4-`, o projeto
 * que nasceu de assumi-las, as propostas daquele projeto e o usuário dedicado. Nada que a prova
 * não tenha criado é tocado — a fila do Demo tem demandas de outra origem, e apagar por data ou
 * por "tudo de hoje" levaria junto trabalho de outra pessoa.
 */
const PREFIXO = "cmcrm-f4-";
const TENANT = process.env.PROVA_TENANT || "tenant_default";

await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
  const demandas = await prisma.demand.findMany({
    where: { demandRef: { startsWith: PREFIXO } },
    select: { id: true, demandRef: true, projectId: true },
  });
  console.log(`demandas da prova encontradas: ${demandas.length}`);
  for (const d of demandas) console.log(`  ${d.demandRef} projeto=${d.projectId ?? "-"}`);

  const projetos = demandas.map((d) => d.projectId).filter((p): p is string => !!p);

  await prisma.demandOutboundEvent.deleteMany({
    where: { demandId: { in: demandas.map((d) => d.id) } },
  });
  await prisma.demandDocument.deleteMany({ where: { demandId: { in: demandas.map((d) => d.id) } } });
  await prisma.demand.deleteMany({ where: { id: { in: demandas.map((d) => d.id) } } });

  for (const projectId of projetos) {
    const props = await prisma.proposal.findMany({ where: { projectId }, select: { id: true } });
    await prisma.proposalAiOpinionItem.deleteMany({
      where: { run: { proposalId: { in: props.map((p) => p.id) } } },
    });
    await prisma.proposalOpinionRun.deleteMany({ where: { proposalId: { in: props.map((p) => p.id) } } });
    await prisma.approvalDecision.deleteMany({ where: { proposalId: { in: props.map((p) => p.id) } } });
    await prisma.proposal.deleteMany({ where: { projectId } });
    await prisma.projectPricingLine.deleteMany({ where: { pricingSheet: { projectId } } });
    await prisma.projectPricingSheet.deleteMany({ where: { projectId } });
    await prisma.analysisResult.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
  }

  // Os DOIS usuários dedicados: quem faz a proposta e quem a aprova. Ambos com e-mail em
  // `.invalid` (RFC 2606, que nunca resolve), criados e removidos pela própria prova.
  const dedicados = await prisma.user.findMany({
    where: { email: { startsWith: "prova-cdc16-f4" } },
    select: { email: true },
  });
  for (const { email } of dedicados) {
    const usuario = await prisma.user.findFirst({ where: { email } });
    if (!usuario) continue;
    await prisma.auditLog.deleteMany({ where: { userId: usuario.id } });
    await prisma.teamMembership.deleteMany({
      where: { OR: [{ managerId: usuario.id }, { engineerId: usuario.id }] },
    });
    await prisma.approvalDecision.deleteMany({ where: { approverUserId: usuario.id } });
    await prisma.user.delete({ where: { id: usuario.id } });
    console.log(`usuário da prova removido: ${email}`);
  }

  console.log(`restam ${await prisma.demand.count()} demandas e ${await prisma.project.count()} projetos no tenant`);
});
await prisma.$disconnect();
