/**
 * CDC 16 — Fase 7. Apaga SÓ o que as provas desta fase criaram no PreSales.
 *
 * Por PREFIXO do identificador, nunca por data: a fila deste banco tem trabalho de outra origem
 * criado no mesmo dia, e "tudo de hoje" levaria junto o de outra pessoa. A regra é a que a F4
 * escreveu e que a F5 e a F6 repetiram.
 *
 * Três prefixos, porque três coisas criaram dado: a prova do ciclo (`prova-cdc16-f7-`), a
 * captura (`captura-cdc16-f7-`) e a ETAPA 1, que roda no CMCRM e cria as demandas com
 * `cdc16-f7-`. E os REGISTROS DE EXPURGO saem pelo alvo, não pela instalação: o
 * `crm_installation_id` é o do par real, e filtrar por ele apagaria a prova de um expurgo de
 * verdade.
 *
 *   npx tsx scripts/cdc16-f7-limpar-prova.ts
 */
import "dotenv/config";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";

const TENANT = process.env.PROVA_TENANT || "tenant_default";
const PREFIXOS = ["prova-cdc16-f7-", "captura-cdc16-f7-", "cdc16-f7-"];

async function main() {
  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    const antes = {
      demandas: await prisma.demand.count(),
      projetos: await prisma.project.count(),
      usuarios: await prisma.user.count(),
      expurgos: await prisma.crmPurgeExecution.count(),
      atualizacoes: await prisma.demandUpdate.count(),
    };

    const demandas = await prisma.demand.findMany({
      where: { OR: PREFIXOS.map((p) => ({ demandRef: { startsWith: p } })) },
      select: { id: true, projectId: true },
    });
    const ids = demandas.map((d) => d.id);
    if (ids.length) {
      await prisma.demandUpdate.deleteMany({ where: { demandId: { in: ids } } });
      await prisma.demandOutboundEvent.deleteMany({ where: { demandId: { in: ids } } });
      await prisma.demandDocument.deleteMany({ where: { demandId: { in: ids } } });
      await prisma.demand.deleteMany({ where: { id: { in: ids } } });
    }

    // Os projetos saem por DUAS peneiras: os que nasceram das demandas acima, e os que têm o
    // prefixo no nome. A segunda existe porque o expurgo de empresa TIRA a referência do projeto
    // (`crm_company_id` vira nulo), e sem ela o projeto do cenário de expurgo ficaria órfão aqui.
    const projetos = [
      ...new Set([
        ...demandas.map((d) => d.projectId).filter((p): p is string => Boolean(p)),
        ...(await prisma.project.findMany({
          where: { OR: PREFIXOS.map((p) => ({ name: { startsWith: p } })) },
          select: { id: true },
        })).map((p) => p.id),
      ]),
    ];
    if (projetos.length) {
      await prisma.documentContent.deleteMany({ where: { document: { projectId: { in: projetos } } } });
      await prisma.document.deleteMany({ where: { projectId: { in: projetos } } });
      await prisma.project.deleteMany({ where: { id: { in: projetos } } });
    }

    for (const prefixo of PREFIXOS) {
      await prisma.$executeRawUnsafe(
        "delete from crm_purge_executions where tenant_id = $1 and targets::text like $2",
        TENANT,
        `%${prefixo}%`,
      );
      await prisma.idempotencyRecord.deleteMany({ where: { key: { startsWith: prefixo } } });
    }
    await prisma.idempotencyRecord.deleteMany({ where: { key: { startsWith: "f7-" } } });
    await prisma.idempotencyRecord.deleteMany({ where: { key: { startsWith: "captura-f7" } } });

    // Os usuários e papéis DEDICADOS da prova (todos com e-mail em `.invalid`, que nunca resolve).
    const usuarios = await prisma.user.findMany({
      where: { OR: PREFIXOS.map((p) => ({ email: { startsWith: p } })) },
      select: { id: true },
    });
    if (usuarios.length) await prisma.user.deleteMany({ where: { id: { in: usuarios.map((u) => u.id) } } });
    for (const prefixo of PREFIXOS) {
      await prisma.role.deleteMany({ where: { name: { startsWith: prefixo } } });
    }

    const depois = {
      demandas: await prisma.demand.count(),
      projetos: await prisma.project.count(),
      usuarios: await prisma.user.count(),
      expurgos: await prisma.crmPurgeExecution.count(),
      atualizacoes: await prisma.demandUpdate.count(),
    };
    console.log(JSON.stringify({ antes, depois }, null, 2));
  });
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
