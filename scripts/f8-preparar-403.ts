/*
 * F8 — o cenário que isola o 403 do gate do dossiê.
 *
 * Descoberta desta fase: src/prisma.ts já recorta `Proposal` por visibilidade, e uma das quatro
 * condições é justamente "sou aprovador designado no workflow desta proposta". Por isso a conta sem
 * alçada recebe 404 no dossiê - a proposta é invisível para ela uma camada ANTES do gate novo, o
 * que é ainda mais forte (não vaza nem a existência dela).
 *
 * Para provar o 403 do gate em si é preciso alguém que ENXERGUE a proposta por outro caminho e
 * mesmo assim não seja aprovador dela: o DONO DO PROJETO. É o que este script monta, clonando um
 * projeto real (para não ter de reconstruir a lista de campos obrigatórios à mão) e trocando o dono.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const dono = await prisma.user.findUniqueOrThrow({ where: { id: "usr_prova_f8_sem_alcada" } });
const modelo = await prisma.project.findUniqueOrThrow({ where: { id: "prova-f8-projeto" } });
const propostaModelo = await prisma.proposal.findUniqueOrThrow({ where: { id: "prop_07fcad053d9188e7" } });

const { id: _pid, createdAt: _pc, updatedAt: _pu, ...camposDoProjeto } = modelo as any;
const projeto = await prisma.project.upsert({
  where: { id: "proj_prova_f8_403" },
  update: { ownerUserId: dono.id },
  create: {
    ...camposDoProjeto,
    id: "proj_prova_f8_403",
    name: "Prova F8 - 403 do dossie",
    ownerUserId: dono.id,
  },
});

const { id: _id, generatedAt: _g, ...camposDaProposta } = propostaModelo as any;
const proposta = await prisma.proposal.upsert({
  where: { id: "prop_prova_f8_403" },
  update: { status: "submitted" },
  create: {
    ...camposDaProposta,
    id: "prop_prova_f8_403",
    projectId: projeto.id,
    proposalGroupId: "prop_prova_f8_403",
    previousVersionId: null,
    latestOpinionRunId: null,
    status: "submitted",
    version: 1,
    // w1: os três estágios são dos papéis r3/r2/r1. O papel de prova não é nenhum deles, então o
    // dono do projeto VÊ a proposta e mesmo assim não é aprovador designado dela.
    approvalWorkflowId: "w1",
  },
});

console.log(JSON.stringify({ projeto: projeto.id, proposta: proposta.id, dono: dono.id }));
await prisma.$disconnect();
