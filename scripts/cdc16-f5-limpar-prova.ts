import "dotenv/config";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";

/**
 * Limpeza do que a prova da F5 criou do lado do PreSales.
 *
 * Apaga só o que a prova NOMEOU: as demandas cujo `demand_ref` começa com `cmcrm-f5-`, o projeto
 * que nasceu de assumi-las, os alertas de prazo daquelas demandas e os usuários e papéis
 * dedicados. Por PREFIXO, nunca por data: a fila tem demandas de outra origem, e apagar "tudo de
 * hoje" levaria junto trabalho de outra pessoa.
 *
 * A configuração de SLA também sai: ela é da INSTALAÇÃO, e deixá-la ligada faria a fila inteira
 * — inclusive as demandas que não são desta prova — passar a ser cobrada por um prazo que ninguém
 * escolheu.
 */
const PREFIXO = "cmcrm-f5-";
const PREFIXO_USUARIO = "prova-cdc16-f5";
const PREFIXO_PAPEL = "Prova F5 —";
const TENANT = process.env.PROVA_TENANT || "tenant_default";

await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
  const demandas = await prisma.demand.findMany({
    where: { demandRef: { startsWith: PREFIXO } },
    select: { id: true, demandRef: true, projectId: true },
  });
  console.log(`demandas da prova encontradas: ${demandas.length}`);
  const ids = demandas.map((d) => d.id);
  const projetos = demandas.map((d) => d.projectId).filter((p): p is string => !!p);

  await prisma.demandSlaBreach.deleteMany({ where: { demandId: { in: ids } } });
  await prisma.demandOutboundEvent.deleteMany({ where: { demandId: { in: ids } } });
  await prisma.demandDocument.deleteMany({ where: { demandId: { in: ids } } });
  await prisma.demand.deleteMany({ where: { id: { in: ids } } });

  for (const projectId of projetos) {
    const props = await prisma.proposal.findMany({ where: { projectId }, select: { id: true } });
    await prisma.approvalDecision.deleteMany({ where: { proposalId: { in: props.map((p) => p.id) } } });
    await prisma.proposal.deleteMany({ where: { projectId } });
    await prisma.projectPricingLine.deleteMany({ where: { pricingSheet: { projectId } } });
    await prisma.projectPricingSheet.deleteMany({ where: { projectId } });
    await prisma.analysisResult.deleteMany({ where: { projectId } });
    await prisma.documentContent.deleteMany({ where: { document: { projectId } } });
    await prisma.document.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
  }

  // A configuração da instalação. Ela não é "dado da prova", é ajuste do administrador — e é
  // justamente por isso que a prova não pode deixá-la para trás.
  const apagouSla = await prisma.demandSlaSettings.deleteMany({});
  console.log(`configuração de SLA removida: ${apagouSla.count}`);
  await prisma.demandSlaBreach.deleteMany({});

  const dedicados = await prisma.user.findMany({
    where: { email: { startsWith: PREFIXO_USUARIO } },
    select: { id: true, email: true },
  });
  for (const usuario of dedicados) {
    await prisma.auditLog.deleteMany({ where: { userId: usuario.id } });
    await prisma.teamMembership.deleteMany({
      where: { OR: [{ managerId: usuario.id }, { engineerId: usuario.id }] },
    });
    await prisma.approvalDecision.deleteMany({ where: { approverUserId: usuario.id } });
    await prisma.project.deleteMany({ where: { ownerUserId: usuario.id } });
    await prisma.user.delete({ where: { id: usuario.id } });
    console.log(`usuário da prova removido: ${usuario.email}`);
  }

  const papeis = await prisma.role.findMany({ where: { name: { startsWith: PREFIXO_PAPEL } }, select: { id: true, name: true } });
  for (const papel of papeis) {
    const aindaEmUso = await prisma.user.count({ where: { roleId: papel.id } });
    if (aindaEmUso > 0) {
      console.log(`papel ${papel.name} ainda tem ${aindaEmUso} usuário(s); não removido`);
      continue;
    }
    await prisma.role.delete({ where: { id: papel.id } });
    console.log(`papel da prova removido: ${papel.name}`);
  }

  console.log(`restam ${await prisma.demand.count()} demandas e ${await prisma.project.count()} projetos no tenant`);
});
await prisma.$disconnect();
