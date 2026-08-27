/**
 * CDC 16 — Fase 1. Monta o cenário da prova num banco DEDICADO.
 *
 * Roda ANTES de qualquer processo subir, e a primeira coisa que faz é conferir
 * para onde está apontando. Isso não é zelo decorativo: no fechamento da F0 um
 * `set -a; . .env` que não exportou a DATABASE_URL (o valor tinha `&`, e o
 * `source` corta a linha ali) deixou um servidor de prova apontado para o banco
 * de PRODUÇÃO por quatro minutos, sem erro nenhum. A trava abaixo é o que
 * transforma esse acidente em recusa imediata.
 *
 *   npx tsx scripts/cdc16-f1-preparar-prova.ts
 *
 * Variáveis: DATABASE_URL (obrigatoriamente o banco de prova), REDIS_URL
 * (obrigatoriamente outro índice), LIVE_DATABASE_URL (só leitura, para copiar a
 * identidade da instalação).
 */
import "dotenv/config";
import fs from "fs";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { DemandCreateSchema, criarDemanda } from "../server/utils/demands";
import { createStorageAdapter } from "../server/utils/storage";
import { dbStore } from "../src/dbStore";
import { runLicenseStatusPollForTenant, getFleetLicenseStatus } from "../server/utils/fleetLicense";
import { hashPassword } from "../server/utils/security";
import type { VerifiedPair } from "../server/utils/pairKey";

const SUFIXO_BANCO_DE_PROVA = "_cdc16f1";
const INDICE_REDIS_DE_PROVA = "/4";
const TENANT = "tenant_default";

function travaDeDestino() {
  const db = new URL(process.env.DATABASE_URL || "postgres://x/x");
  const redisUrl = new URL(process.env.REDIS_URL || "redis://x/0");
  if (!db.pathname.endsWith(SUFIXO_BANCO_DE_PROVA)) {
    throw new Error(`RECUSADO: DATABASE_URL aponta para "${db.pathname}", que não termina em ${SUFIXO_BANCO_DE_PROVA}.`);
  }
  if (redisUrl.pathname !== INDICE_REDIS_DE_PROVA) {
    throw new Error(`RECUSADO: REDIS_URL aponta para o índice "${redisUrl.pathname}", e a prova exige ${INDICE_REDIS_DE_PROVA}.`);
  }
  console.log(`destino conferido: banco ${db.pathname.slice(1)} @ ${db.hostname}:${db.port}, redis ${redisUrl.hostname}:${redisUrl.port}${redisUrl.pathname}`);
}

/**
 * Copia a IDENTIDADE da instalação (url do CMSaaS e chave da instalação, já
 * cifrada) do banco vivo de desenvolvimento para o de prova.
 *
 * É uma única leitura, SELECT, e nada é escrito do outro lado. Sem ela o
 * servidor de prova não teria licença assinada nenhuma e, portanto, não saberia
 * QUEM ele é - e é o `installation_id` da licença que amarra a chave do par a
 * esta instalação (ver server/utils/pairKey.ts). Os valores não são impressos.
 */
async function copiarIdentidadeDaInstalacao() {
  const live = process.env.LIVE_DATABASE_URL;
  if (!live) {
    console.log("LIVE_DATABASE_URL ausente - identidade da instalação NÃO copiada.");
    return false;
  }
  const ssl = process.env.DATABASE_SSL_CA_PATH
    ? { ca: fs.readFileSync(process.env.DATABASE_SSL_CA_PATH, "utf8"), rejectUnauthorized: true }
    : undefined;
  const clienteVivo = new PrismaClient({ adapter: new PrismaPg({ connectionString: live, ssl }) });
  try {
    const origem = await clienteVivo.platformSettings.findFirst({
      where: { tenantId: TENANT },
      select: { fleetManagerUrl: true, fleetManagerApiKeyEncrypted: true },
    });
    if (!origem?.fleetManagerUrl || !origem.fleetManagerApiKeyEncrypted) {
      console.log("instalação viva sem CMSaaS configurado - identidade não copiada.");
      return false;
    }
    const destino = await prisma.platformSettings.findFirst({ where: { tenantId: TENANT } });
    if (!destino) throw new Error("banco de prova sem platform_settings - rode o seed antes.");
    await prisma.platformSettings.update({
      where: { id: destino.id },
      data: {
        fleetManagerUrl: origem.fleetManagerUrl,
        fleetManagerApiKeyEncrypted: origem.fleetManagerApiKeyEncrypted,
        // Ligado só para a consulta de licença logo abaixo, e desligado em
        // seguida: o heartbeat completo (POST) faz ACK de comandos pendentes da
        // instalação real, e um deles pode ser um apply_update, que dispararia
        // git checkout + build + restart NESTE checkout. A consulta de licença
        // é GET e não consome nada.
        fleetManagerEnabled: true,
      },
    });
    console.log(`identidade copiada: CMSaaS em ${origem.fleetManagerUrl}`);
    return true;
  } finally {
    await clienteVivo.$disconnect();
  }
}

async function buscarLicencaReal() {
  await runLicenseStatusPollForTenant(TENANT);
  const licenca = await getFleetLicenseStatus(TENANT);
  console.log(
    `licença: conectada=${licenca.connected} installation_id=${licenca.installation_id ?? "(nenhum)"} status=${licenca.status ?? "-"} modules=[${licenca.modules.join(", ")}]`
  );
  const settings = await prisma.platformSettings.findFirst({ where: { tenantId: TENANT } });
  if (settings) {
    await prisma.platformSettings.update({ where: { id: settings.id }, data: { fleetManagerEnabled: false } });
    console.log("heartbeat desligado no banco de prova (a licença já está em cache).");
  }
  return licenca;
}

// Par sintético usado SÓ para semear a fila quando ainda não existe par real no
// CMSaaS. Não passa por porta nenhuma: entra pelo mesmo serviço que a porta
// chama, com o mesmo schema de validação, para que a fila e o ato de assumir
// possam ser exercitados de verdade antes de o dono criar o par comercial.
function parDeSemeadura(installationId: string): VerifiedPair {
  return {
    tenantId: TENANT,
    pairId: "pair_semeadura_f1",
    customerId: "cust_semeadura_f1",
    customerName: "Cliente de semeadura",
    crossEnvironment: true,
    sides: {
      cmcrm: { product: "cmcrm", installation_id: "inst_crm_semeadura", label: "CRM (semeadura)", environment: "development", status: "active" },
      presales: { product: "presales", installation_id: installationId, label: "PreSales", environment: "production", status: "active" },
    },
  };
}

const TEXTO_DO_EDITAL = [
  "PREGÃO ELETRÔNICO 12/2026 - PREFEITURA MUNICIPAL DE TESTE",
  "Objeto: implantação de 40 pontos de videomonitoramento urbano com analítico de vídeo.",
  "Item 7 - Anexos técnicos: memorial descritivo e planilha de quantitativos.",
].join("\n");

async function semearFila(installationId: string) {
  const par = parDeSemeadura(installationId);
  const conteudo = Buffer.from(TEXTO_DO_EDITAL, "utf8");
  const sha = crypto.createHash("sha256").update(conteudo).digest("hex");

  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    // Limpa só o que ESTE script cria. Um deleteMany largo apagaria demanda de
    // outra rodada ou de outro cenário no mesmo banco.
    const antigas = await prisma.demand.findMany({ where: { demandRef: { startsWith: "cdc16f1-" } }, select: { id: true, projectId: true } });
    for (const d of antigas) {
      await prisma.demandDocument.deleteMany({ where: { demandId: d.id } });
      await prisma.demand.delete({ where: { id: d.id } });
      if (d.projectId) {
        await prisma.documentContent.deleteMany({ where: { document: { projectId: d.projectId } } });
        await prisma.document.deleteMany({ where: { projectId: d.projectId } });
        await prisma.project.deleteMany({ where: { id: d.projectId } });
      }
    }
    await prisma.idempotencyRecord.deleteMany({ where: { key: { startsWith: "cdc16f1-" } } });

    const comDocumento = DemandCreateSchema.parse({
      demand_ref: "cdc16f1-fila-1",
      sequence: 1,
      company: {
        crm_company_id: "cmp_prefeitura_teste",
        name: "Prefeitura Municipal de Teste",
        legal_name: "MUNICIPIO DE TESTE",
        tax_id: "12345678000199",
        cnpj_root: "12345678",
        sector: "Governo",
      },
      opportunity: {
        crm_opportunity_id: "opp_pregao_12_2026",
        name: "Pregão Eletrônico 12/2026 - Videomonitoramento",
        stage: "Qualificação",
        value: 1250000,
        currency: "BRL",
        probability: 60,
        margin_percent: 21.5,
        expected_close_date: "2026-11-15",
        risks: ["prazo de entrega apertado", "exigência de fabricante único no item 4"],
        origin: "licitacao",
      },
      sheet: {
        title: "Videomonitoramento urbano - Pregão 12/2026",
        vertical: "Segurança Pública",
        description: "Implantação de 40 pontos de videomonitoramento com analítico de vídeo e central de operações.",
        deadline: "2026-09-30",
        proposal_validity_date: "2026-10-30",
        ai_orientation_mode: "Vendor-neutral",
      },
      objective: "Precisamos de dimensionamento técnico e proposta com BOM para o pregão.",
      documents: [
        {
          document_ref: "doc_edital_1",
          filename: "edital-12-2026.txt",
          mime_type: "text/plain",
          size_bytes: conteudo.length,
          sha256: sha,
          extracted_text: TEXTO_DO_EDITAL,
          crm_document_id: "crmdoc_1",
        },
      ],
      sent_by: { crm_user_id: "crm_u_vendedor", name: "Vendedor do CRM", email: "vendedor@exemplo.local" },
      sent_at: new Date().toISOString(),
    });

    const primeira = await criarDemanda(comDocumento, par);

    // O binário do documento entra pelo mesmo adaptador de storage que a porta
    // usa, para que o ato de assumir materialize um Document com arquivo de
    // verdade - e não uma promessa quebrada.
    const settings = await dbStore.getSettings();
    const storage = createStorageAdapter(settings);
    const caminho = await storage.uploadFile(primeira.id, conteudo, "edital-12-2026.txt", "text/plain");
    await prisma.demandDocument.updateMany({
      where: { demandId: primeira.id },
      data: { storageProvider: settings.storage_mode, storagePath: caminho, contentReceivedAt: new Date() },
    });

    const semDocumento = DemandCreateSchema.parse({
      demand_ref: "cdc16f1-fila-2",
      company: { crm_company_id: "cmp_industria_teste", name: "Indústria de Teste S.A.", tax_id: "98765432000188" },
      opportunity: { crm_opportunity_id: "opp_privado_7", name: "Modernização de CFTV - matriz", currency: "BRL", value: 380000, margin_percent: 32 },
      sheet: {
        title: "Modernização de CFTV da matriz",
        vertical: "Indústria",
        description: "Troca de 120 câmeras analógicas por IP, com storage centralizado.",
        deadline: "2026-12-20",
        proposal_validity_date: "2027-01-20",
        ai_orientation_mode: "Preferred manufacturer",
        ai_orientation_text: "Cliente já tem padrão instalado.",
      },
      sent_by: { crm_user_id: "crm_u_vendedor2", name: "Outro Vendedor" },
      sent_at: new Date().toISOString(),
    });
    await criarDemanda(semDocumento, par);

    const total = await prisma.demand.count({ where: { demandRef: { startsWith: "cdc16f1-" } } });
    console.log(`fila semeada: ${total} demandas (uma com documento e binário, uma sem documento), sha256 do edital ${sha.slice(0, 12)}...`);
  });
}

/**
 * Usuário da prova, com senha de verdade.
 *
 * Não dá para logar com o usuário do seed: em runtime de produção - que é como
 * esta instalação roda - a rota de login RECUSA a senha padrão do seed
 * ("Blocked Default Demo Credential Login"), e é uma proteção que existe por bom
 * motivo. Baixar o runtime para "demo" só para a prova passar mudaria o
 * comportamento que se quer provar; criar um usuário normal, não.
 *
 * A senha vem de PROVA_PASSWORD, gerada pelo runner e nunca impressa.
 */
async function criarUsuarioDaProva() {
  const senha = process.env.PROVA_PASSWORD;
  if (!senha) throw new Error("PROVA_PASSWORD ausente - o runner precisa gerar a senha do usuário da prova.");
  const email = "prova-cdc16-f1@local.invalid";
  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    const existente = await prisma.user.findFirst({ where: { email } });
    const dados = {
      name: "Prova CDC16 F1",
      email,
      // Papel de pré-vendas de verdade (r3), e não o de administrador: quem
      // trabalha a fila é a equipe, e provar com administrador esconderia uma
      // permissão faltando.
      roleId: "r3",
      passwordHash: hashPassword(senha),
      mfaEnabled: false,
      mustChangePassword: false,
      status: "ACTIVE" as const,
    };
    if (existente) {
      await prisma.user.update({ where: { id: existente.id }, data: dados });
    } else {
      await prisma.user.create({ data: { id: "u_prova_cdc16_f1", tenantId: TENANT, ...dados } });
    }
    console.log(`usuário da prova pronto: ${email} (papel r3)`);
  });
}

async function main() {
  travaDeDestino();
  const copiou = await copiarIdentidadeDaInstalacao();
  const licenca = copiou ? await buscarLicencaReal() : await getFleetLicenseStatus(TENANT);
  const identificacao = licenca.installation_id || "inst_desconhecida_na_prova";
  await criarUsuarioDaProva();
  await semearFila(identificacao);
  console.log("cenário pronto.");
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FALHOU:", err?.message || err);
  process.exit(1);
});
