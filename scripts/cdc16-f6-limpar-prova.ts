/**
 * CDC 16 — Fase 6. Apaga SÓ o que as provas desta fase criaram do lado do PreSales.
 *
 * Por PREFIXO do identificador, nunca por data: a fila desta instalação tem demandas de outra
 * origem, e "tudo de hoje" levaria junto trabalho de outra pessoa. Regra da F4, repetida.
 *
 *   npx tsx scripts/cdc16-f6-limpar-prova.ts
 */
import "dotenv/config";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";

const TENANT = process.env.PROVA_TENANT || "tenant_default";
const PREFIXO = "prova-cdc16-f6-";

async function main() {
  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    const eventos = await prisma.demandOutboundEvent.deleteMany({
      where: { demand: { demandRef: { startsWith: "presales-" } } },
    });
    const demandas = await prisma.demand.deleteMany({ where: { source: "presales" } });
    /*
     * Os projetos saem por DOIS critérios: o prefixo do nome e o DONO. Só pelo prefixo não basta —
     * a captura visual cria o projeto pelo assistente, e o nome dele vem da ficha que a IA
     * preencheu a partir do edital, sem prefixo nenhum. O que amarra esse projeto à prova é o
     * dono, que é um usuário dedicado com e-mail em `.invalid`. Sem isto o `deleteMany` dos
     * usuários estoura em `projects_owner_user_id_fkey` — foi o que aconteceu.
     */
    const contas = await prisma.user.findMany({
      where: { email: { startsWith: PREFIXO } },
      select: { id: true },
    });
    const projetos = await prisma.project.deleteMany({
      where: {
        OR: [{ name: { startsWith: PREFIXO } }, { ownerUserId: { in: contas.map((c) => c.id) } }],
      },
    });
    const usuarios = await prisma.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    const papeis = await prisma.role.deleteMany({ where: { name: { startsWith: "Prova F6" } } });
    // A organização escolhida é ajuste da INSTALAÇÃO, não dado de prova: deixá-la apontando para a
    // organização que a prova usou faria o próximo edital nascer vinculado a ela sem ninguém ter
    // escolhido. É a mesma lição da configuração de SLA que a F5 teve de remover.
    const par = await prisma.crmPairKey.updateMany({
      where: { tenantId: TENANT },
      data: { crmOrganizationId: null },
    });

    console.log(
      JSON.stringify(
        {
          eventos: eventos.count,
          demandasEspelho: demandas.count,
          projetos: projetos.count,
          usuarios: usuarios.count,
          papeis: papeis.count,
          organizacaoDoParZerada: par.count,
        },
        null,
        2,
      ),
    );

    const restou = {
      demandas: await prisma.demand.count(),
      demandasEspelho: await prisma.demand.count({ where: { source: "presales" } }),
      projetos: await prisma.project.count(),
      usuarios: await prisma.user.count(),
      configuracoesDeSla: await prisma.demandSlaSettings.count(),
    };
    console.log("restou:", JSON.stringify(restou));
  });
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
