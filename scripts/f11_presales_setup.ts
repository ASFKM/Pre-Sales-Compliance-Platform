import "dotenv/config";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { hashPassword, encryptSecret } from "../server/utils/security";
import { randomId } from "../src/idGenerator";
import { runLicenseStatusPollForTenant, getFleetLicenseStatus } from "../server/utils/fleetLicense";

const TENANT = "tenant_default";

async function main() {
  const db = new URL(process.env.DATABASE_URL || "postgres://x/x");
  if (!db.pathname.endsWith("_f11_test")) {
    throw new Error(`RECUSADO: DATABASE_URL aponta para "${db.pathname}", que não é o banco dedicado da prova F11.`);
  }

  const fleetManagerUrl = process.env.FLEET_MANAGER_URL_PROVA;
  const fleetManagerApiKey = process.env.FLEET_MANAGER_API_KEY_PROVA;
  if (!fleetManagerUrl || !fleetManagerApiKey) {
    throw new Error("FLEET_MANAGER_URL_PROVA / FLEET_MANAGER_API_KEY_PROVA ausentes.");
  }

  const settings = await prisma.platformSettings.findFirst({ where: { tenantId: TENANT } });
  if (!settings) throw new Error("banco de prova sem platform_settings - seed não rodou?");
  await prisma.platformSettings.update({
    where: { id: settings.id },
    data: {
      fleetManagerUrl,
      fleetManagerApiKeyEncrypted: encryptSecret(fleetManagerApiKey),
      fleetManagerEnabled: true,
    },
  });

  const senha = process.env.PROVA_PASSWORD;
  if (!senha) throw new Error("PROVA_PASSWORD ausente.");
  const email = "prova-f11@local.invalid";
  const userId = "u_prova_f11";
  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    const existente = await prisma.user.findFirst({ where: { email } });
    const dados = {
      name: "Prova F11",
      email,
      roleId: "r1", // administrador - a prova cobre config (fleet manager) e IA, então precisa das duas superfícies
      passwordHash: hashPassword(senha),
      mfaEnabled: false,
      mustChangePassword: false,
      status: "ACTIVE" as const,
    };
    if (existente) {
      await prisma.user.update({ where: { id: existente.id }, data: dados });
    } else {
      await prisma.user.create({ data: { id: userId, tenantId: TENANT, ...dados } });
    }
  });

  await runLicenseStatusPollForTenant(TENANT);
  const licenca = await getFleetLicenseStatus(TENANT);
  console.log(JSON.stringify({ email, user_id: userId, licenca }, null, 2));
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FALHOU:", err?.message || err);
  process.exit(1);
});
