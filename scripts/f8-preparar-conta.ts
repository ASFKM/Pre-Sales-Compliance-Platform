/*
 * F8 — cria o papel SEM ALÇADA e a conta de prova que o usa.
 *
 * Por que ele precisa existir: TODOS os quatro papéis desta instalação (r1, r2, r3 e o
 * "Administrador" do tenant de demonstração) são aprovadores designados em algum estágio de algum
 * workflow ativo. Sem um papel novo, o lado NEGATIVO do gate do menu não teria como ser provado -
 * não existe conta neste banco que devesse ver o botão sumir.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import crypto from "node:crypto";

const SENHA = process.env.F8_SENHA!;
const hashPassword = (password: string) => {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
};

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const tenant = await prisma.user.findUniqueOrThrow({ where: { id: "u2" }, select: { tenantId: true } });

const role = await prisma.role.upsert({
  where: { id: "role_prova_f8_sem_alcada" },
  update: {},
  create: {
    id: "role_prova_f8_sem_alcada",
    tenantId: tenant.tenantId,
    name: "Analista sem alçada (prova F8)",
    description: "Papel de prova da F8: não é aprovador designado em estágio nenhum.",
    permissions: ["project:read", "proposal:edit", "document:read", "analysis:read"],
  },
});

const user = await prisma.user.upsert({
  where: { id: "usr_prova_f8_sem_alcada" },
  update: { passwordHash: hashPassword(SENHA), roleId: role.id, status: "ACTIVE", mustChangePassword: false, passwordChangedAt: new Date() },
  create: {
    id: "usr_prova_f8_sem_alcada",
    tenantId: tenant.tenantId,
    name: "Analista sem alçada (prova F8)",
    email: "prova-f8-sem-alcada@local.invalid",
    roleId: role.id,
    passwordHash: hashPassword(SENHA),
    status: "ACTIVE", mustChangePassword: false, passwordChangedAt: new Date(),
  },
  select: { id: true, email: true, roleId: true },
});

console.log(JSON.stringify({ user, role_id: role.id }));
await prisma.$disconnect();
