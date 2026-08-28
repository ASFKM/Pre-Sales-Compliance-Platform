import { prisma } from "../src/prisma";
import { hashPassword } from "../server/utils/security";
import { randomId } from "../src/idGenerator";

/** Põe uma senha CONHECIDA na conta de captura da F6 — a etapa 2 usou uma sorteada e descartada. */
(async () => {
  const email = "prova-cdc16-f6-marina@local.invalid";
  const senha = process.env.PROVA_PASSWORD;
  if (!senha) throw new Error("PROVA_PASSWORD ausente");
  const papel =
    (await prisma.role.findFirst({ where: { name: "Prova F6 — pré-vendas" } })) ??
    (await prisma.role.create({
      data: {
        id: randomId("role"),
        tenantId: "tenant_default",
        name: "Prova F6 — pré-vendas",
        description: "Papel da prova CDC16 F6",
        permissions: [
          "demand:read",
          "demand:assume",
          "project:create",
          "project:read",
          "project:update",
        ],
      },
    }));
  const dados = {
    passwordHash: hashPassword(senha),
    roleId: papel.id,
    status: "ACTIVE" as const,
    mustChangePassword: false,
  };
  const u = await prisma.user.findFirst({ where: { email } });
  if (u) await prisma.user.update({ where: { id: u.id }, data: dados });
  else
    await prisma.user.create({
      data: { id: randomId("usr"), tenantId: "tenant_default", name: "Marina da prova F6", email, ...dados },
    });
  console.log("conta de captura pronta");
  await prisma.$disconnect();
})();
