/*
 * F8 — cria alvos LIMPOS para a prova ponta a ponta.
 *
 * Cada execução da prova consome uma proposta (ela é rejeitada e reaberta), então o alvo precisa
 * nascer novo a cada rodada. Clona uma proposta real do projeto de prova - que tem template com
 * arquivo no storage, condição da reabertura - para não reconstruir a lista de campos à mão.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import crypto from "node:crypto";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const modelo = await prisma.proposal.findUniqueOrThrow({ where: { id: "prop_07fcad053d9188e7" } });
const { id: _id, generatedAt: _g, ...campos } = modelo as any;

const criar = async () => {
  const id = `prop_f8prova_${crypto.randomBytes(6).toString("hex")}`;
  await prisma.proposal.create({
    data: { ...campos, id, proposalGroupId: id, previousVersionId: null, latestOpinionRunId: null, status: "submitted", version: 1 },
  });
  return id;
};

console.log(JSON.stringify({ alvo: await criar(), alvo_ordem: await criar() }));
await prisma.$disconnect();
