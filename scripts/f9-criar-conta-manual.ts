/**
 * Provisiona a conta dedicada de captura dos manuais, autorizada pelo dono em 25/08/2026.
 *
 * Mesmo padrão da conta de captura do baseline visual (`visual-capture@presales.local`, Fase 0):
 * conta própria, MFA desligado (um código que muda a cada execução impede captura reprodutível),
 * senha gerada aqui e gravada apenas em `.env.manual.local`, coberto pelo `.gitignore`.
 *
 * NÃO toca em `admin@manual-demo.local`: a conta que já existe continua valendo, com a senha que
 * ela sempre teve. O nome de exibição é o mesmo ("Admin Demo") para que as capturas dos manuais
 * continuem mostrando no canto o que sempre mostraram.
 */
import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../server/utils/security";

const EMAIL = "manual-capture@manual-demo.local";
const TENANT = "manual_demo_tenant";
const ARQUIVO = path.resolve(process.cwd(), ".env.manual.local");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  // O papel vem da conta administrativa que já existe nesse tenant: a captura precisa enxergar as
  // mesmas telas que o manual documenta, nem mais nem menos.
  const modelo = await prisma.user.findUnique({ where: { email: "admin@manual-demo.local" } });
  if (!modelo) throw new Error("admin@manual-demo.local não existe — tenant errado?");
  if (modelo.tenantId !== TENANT) throw new Error(`tenant inesperado: ${modelo.tenantId}`);

  const senha = crypto.randomBytes(18).toString("base64url");
  const existente = await prisma.user.findUnique({ where: { email: EMAIL } });

  if (existente) {
    await prisma.user.update({
      where: { email: EMAIL },
      data: { passwordHash: hashPassword(senha), status: "ACTIVE", mfaEnabled: false, mustChangePassword: false, roleId: modelo.roleId },
    });
    console.log(`conta ${EMAIL} já existia — senha regravada`);
  } else {
    await prisma.user.create({
      data: {
        id: "u_manual_capture",
        tenantId: TENANT,
        name: modelo.name,
        email: EMAIL,
        passwordHash: hashPassword(senha),
        mfaEnabled: false,
        mustChangePassword: false,
        status: "ACTIVE",
        roleId: modelo.roleId,
      },
    });
    console.log(`conta ${EMAIL} criada no tenant ${TENANT}, papel ${modelo.roleId}, MFA desligado`);
  }

  // A senha existe em um lugar só, fora do git. Nunca é impressa.
  fs.writeFileSync(
    ARQUIVO,
    [
      "# Conta dedicada à captura das imagens dos manuais (docs/manuais/screenshots/).",
      "# Criada em 25/08/2026 com autorização do dono. Fora do git por `.env.*.local`.",
      `MANUAL_CAPTURE_EMAIL=${EMAIL}`,
      `MANUAL_CAPTURE_PASSWORD=${senha}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  console.log(`credenciais gravadas em ${ARQUIVO} (modo 600), fora do git`);

  const conferencia = await prisma.user.findUnique({
    where: { email: EMAIL },
    select: { id: true, email: true, tenantId: true, roleId: true, mfaEnabled: true, status: true },
  });
  console.log(conferencia);
}

main().finally(() => prisma.$disconnect());
