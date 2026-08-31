// Bootstraps a fresh database (CI, new deployment, or local dev) with the minimal canonical
// dataset the app and the regression scripts assume exists: a default tenant, default roles,
// demo users, one project, proposal templates, and an approval workflow with role-targeted
// stages. Safe to re-run (every write is findUnique-then-create/update - upsert() is disallowed
// on tenant-scoped models by the extension in src/prisma.ts, see the comment on the role seeding
// loop below for why).
import crypto from "crypto";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { BRAND_DEFAULT_PRIMARY, BRAND_DEFAULT_ACCENT } from "../src/brandTheme";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

const DEFAULT_TENANT_ID = "tenant_default";

async function main() {
  console.log("Seeding default tenant...");
  const tenant = await prisma.tenant.upsert({
    where: { id: DEFAULT_TENANT_ID },
    create: {
      id: DEFAULT_TENANT_ID,
      name: "AI Pre-Sales Solutions LLC",
      deploymentMode: "onprem",
      status: "active"
    },
    update: {}
  });

  await runWithTenant({ tenantId: tenant.id }, async () => {
  console.log("Seeding roles...");
  const roles = [
    {
      id: "r1",
      name: "Administrator",
      description: "Full administrative access to all workspace settings, configurations, logs, and users.",
      permissions: [
        "project:create", "project:read", "project:read_all", "project:update", "project:delete",
        "document:upload", "document:read", "document:delete",
        "analysis:run", "analysis:read", "analysis:edit", "analysis:approve",
        "proposal:generate", "proposal:edit", "proposal:approve", "proposal:export",
        "template:manage", "approval:manage", "admin:users", "admin:roles", "admin:settings",
        "admin:audit", "admin:debug", "admin:diagnostics", "admin:system_updates", "ai:settings", "branding:manage",
        "storage:manage", "integrations:manage", "knowledge_base:read", "knowledge_base:write",
        "poc:read", "poc:manage",
        "pricing:read", "pricing:manage",
        // CDC 16 F5: o gerente de pré-vendas (D16, D17, D19). Está no SEED, e a
        // migration desta fase deliberadamente NÃO o distribuiu para os papéis
        // que já existem: dar a permissão a quem já está no ar faria toda
        // devolução passar a exigir aprovação da noite para o dia. Aqui ele
        // existe porque o seed descreve uma instalação inteira e configurada, e
        // é o que torna o caminho do gerente alcançável sem editar banco à mão.
        "demand:read", "demand:assume", "demand:manage"
      ]
    },
    {
      id: "r2",
      name: "Sales Manager",
      description: "Manage pre-sales pipelines, commercial proposals, and customer pricing sheets.",
      permissions: [
        "project:create", "project:read", "project:update",
        "document:upload", "document:read",
        "analysis:read",
        "proposal:generate", "proposal:edit", "proposal:approve", "proposal:export",
        "template:manage", "approval:manage", "admin:settings",
        "demand:read", "demand:assume"
      ]
    },
    {
      id: "r3",
      name: "Pre-Sales Engineer",
      description: "Perform technical specifications analysis, design solutions, create BOM layouts, and draft technical components.",
      permissions: [
        "project:create", "project:read", "project:update",
        "document:upload", "document:read", "document:delete",
        "analysis:run", "analysis:read", "analysis:edit",
        "proposal:generate", "proposal:edit", "proposal:export",
        "demand:read", "demand:assume"
      ]
    }
  ];

  for (const role of roles) {
    // prisma.role.upsert() is disallowed on tenant-scoped models by the tenant-scoping extension
    // (src/prisma.ts) - it can't safely inject tenantId into upsert's where clause unless tenantId
    // is already part of the model's own unique constraint, which a bare @id on `id` isn't.
    const existing = await prisma.role.findUnique({ where: { id: role.id } });
    if (existing) {
      await prisma.role.update({ where: { id: role.id }, data: role });
    } else {
      await prisma.role.create({ data: { ...role, tenantId: tenant.id } });
    }
  }

  /**
   * F1 (31/08/2026) — os usuários de demonstração voltam a nascer com senha.
   *
   * A senha antiga era "password123", que tem 11 caracteres e não passaria no mínimo de 12 que a
   * volta da autenticacão estabeleceu. Como o seed é de desenvolvimento e CI, e as três contas são
   * fictícias, ela virou uma que cabe na regra. Isto NÃO toca os 27 usuários reais do banco de
   * desenvolvimento: eles perderam o hash na migration destrutiva de 30/08 e ficam para depois,
   * por decisão do dono — só o administrador master volta agora.
   *
   * `POST /api/auth/login` continua barrando esta senha quando `APP_RUNTIME_MODE=production`,
   * então um banco de desenvolvimento promovido a produção não entra com ela.
   */
  const SENHA_DE_DEMONSTRACAO = "Demonstracao2026!";
  console.log(`Seeding users (password: ${SENHA_DE_DEMONSTRACAO})...`);
  const passwordHash = hashPassword(SENHA_DE_DEMONSTRACAO);
  const users = [
    { id: "u1", name: "Alex Rivera", email: "alex.rivera@enterprise.com", roleId: "r1", mfaEnabled: false },
    { id: "u2", name: "Marcus Vance", email: "marcus.vance@enterprise.com", roleId: "r2", mfaEnabled: false },
    { id: "u3", name: "Elena Rostova", email: "elena.rostova@enterprise.com", roleId: "r3", mfaEnabled: false }
  ];

  for (const user of users) {
    const existing = await prisma.user.findUnique({ where: { id: user.id } });
    if (existing) {
      await prisma.user.update({
        where: { id: user.id },
        data: { name: user.name, email: user.email, roleId: user.roleId, mfaEnabled: user.mfaEnabled, passwordHash }
      });
    } else {
      await prisma.user.create({ data: { ...user, tenantId: tenant.id, status: "ACTIVE", passwordHash } });
    }
  }

  console.log("Seeding project p1...");
  const existingProject = await prisma.project.findUnique({ where: { id: "p1" } });
  if (!existingProject) {
    await prisma.project.create({
      data: {
        id: "p1",
        tenantId: tenant.id,
        name: "Highway ITS Modernization",
        customerName: "Metropolitan Transit Authority",
        opportunityName: "ITS-MTA-2026",
        vertical: "Infrastructure",
        description: "Comprehensive highway modernization including smart speed detection, automatic incident cameras, and fiber optic telemetry networks.",
        status: "waiting_internal",
        deadline: new Date("2026-08-15T00:00:00.000Z"),
        proposalValidityDate: new Date("2026-11-15T00:00:00.000Z"),
        ownerUserId: "u3",
        outputLanguage: "English",
        proposalLanguage: "English",
        aiOrientationMode: "Vendor-neutral",
        aiOrientationText: "Ensure the ITS hardware is fully vendor-neutral, utilizing ONVIF Profile T open standards for camera communication and multi-vendor controller compatibility.",
        selectedApprovalWorkflowId: "w1",
      }
    });
  }

  console.log("Seeding proposal templates...");
  const templates = [
    {
      id: "t1",
      name: "Standard Swiss Modern Technical Template",
      description: "Clean, high-contrast display typography designed for engineering bids and public infrastructure proposals.",
      templateType: "technical" as const,
      language: "English" as const,
      fileType: "docx" as const,
      filePath: "/templates/technical_swiss_v1.docx",
      variablesSchema: JSON.stringify(["{{project.name}}", "{{project.customer_name}}", "{{analysis.executive_summary}}", "{{analysis.critical_requirements}}", "{{analysis.bom}}"]),
      version: "v3.0",
      active: true,
      defaultTemplate: true,
      uploadedBy: "Elena Rostova"
    },
    {
      id: "t2",
      name: "Corporate Commercial Template",
      description: "Includes standard legal definitions, payment structures, validities, and a beautifully structured pricing matrix.",
      templateType: "commercial" as const,
      language: "English" as const,
      fileType: "docx" as const,
      filePath: "/templates/commercial_corporate_v1.docx",
      variablesSchema: JSON.stringify(["{{project.name}}", "{{project.customer_name}}", "{{proposal.manual_pricing_table}}", "{{proposal.payment_terms}}"]),
      version: "v2.0",
      active: true,
      defaultTemplate: true,
      uploadedBy: "Marcus Vance"
    },
    {
      id: "t3",
      name: "Smart Cities Spanish Technical Template",
      description: "Especificaciones técnicas adaptadas para licitaciones públicas de municipios en España.",
      templateType: "technical" as const,
      language: "Spanish" as const,
      fileType: "docx" as const,
      filePath: "/templates/tecnico_ciudades_inteligentes_v1.docx",
      variablesSchema: JSON.stringify(["{{project.name}}", "{{analysis.executive_summary}}"]),
      version: "v1.1",
      active: true,
      defaultTemplate: false,
      uploadedBy: "Marcus Vance"
    }
  ];

  for (const tpl of templates) {
    const existing = await prisma.proposalTemplate.findUnique({ where: { id: tpl.id } });
    if (existing) {
      await prisma.proposalTemplate.update({ where: { id: tpl.id }, data: tpl });
    } else {
      await prisma.proposalTemplate.create({ data: { ...tpl, tenantId: tenant.id } });
    }
  }

  console.log("Seeding approval workflows w1/w2...");
  // Nothing re-updates an existing workflow's stages on a re-run (the original upsert() this
  // replaces also had `update: {}` - a no-op on the update path), so this only ever creates once.
  if (!(await prisma.approvalWorkflow.findUnique({ where: { id: "w1" } }))) {
    await prisma.approvalWorkflow.create({
      data: {
        id: "w1",
        tenantId: tenant.id,
        name: "High-Value Infrastructure Approval Workflow",
        description: "Rigorous 3-stage validation required for public tenders, infrastructure vertical bids, or any proposal valued over USD 50,000.",
        active: true,
        appliesTo: "all",
        stages: {
          create: [
            { id: "w1-s1", tenantId: tenant.id, name: "Pre-Sales Technical Verification", order: 1, approverType: "role", approverRoleId: "r3", mandatory: true, conditions: "Always mandatory" },
            { id: "w1-s2", tenantId: tenant.id, name: "Commercial & Margin Validation", order: 2, approverType: "role", approverRoleId: "r2", mandatory: true, conditions: "Valued > $10,000" },
            { id: "w1-s3", tenantId: tenant.id, name: "Executive & Director Sign-off", order: 3, approverType: "role", approverRoleId: "r1", mandatory: true, conditions: "Valued > $50,000" }
          ]
        }
      }
    });
  }

  if (!(await prisma.approvalWorkflow.findUnique({ where: { id: "w2" } }))) {
    await prisma.approvalWorkflow.create({
      data: {
        id: "w2",
        tenantId: tenant.id,
        name: "Standard Smart City Bid Flow",
        description: "Fast-tracked 2-stage verification for smart city vertical contracts.",
        active: true,
        appliesTo: "Smart Cities",
        stages: {
          create: [
            { id: "w2-s1", tenantId: tenant.id, name: "Technical Specification Verification", order: 1, approverType: "role", approverRoleId: "r3", mandatory: true, conditions: "Always mandatory" },
            { id: "w2-s2", tenantId: tenant.id, name: "Commercial Approvals", order: 2, approverType: "role", approverRoleId: "r2", mandatory: true, conditions: "Always mandatory" }
          ]
        }
      }
    });
  }

  console.log("Seeding prompt templates...");
  const prompts = [
    {
      id: "prm1",
      name: "Document Classification Prompt",
      type: "classification",
      content: "Classify the uploaded document by type (technical specification, tender/edital, contract, other) based on its extracted text.",
      language: "English" as const,
      version: "v1.2",
      isActive: true,
      createdBy: "u1"
    },
    {
      id: "prm2",
      name: "Pre-Sales Technical Specification Analyser",
      type: "analysis",
      content: "Analyze the extracted document text and produce structured critical requirements, risks, opportunities, and a bill of materials for the pre-sales team.",
      language: "English" as const,
      version: "v2.1",
      isActive: true,
      createdBy: "u1"
    }
  ];

  for (const prompt of prompts) {
    if (!(await prisma.promptTemplate.findUnique({ where: { id: prompt.id } }))) {
      await prisma.promptTemplate.create({ data: { ...prompt, tenantId: tenant.id } });
    }
  }

  console.log("Seeding platform settings...");
  if (!(await prisma.platformSettings.findUnique({ where: { tenantId: tenant.id } }))) {
    await prisma.platformSettings.create({
      data: {
        id: "settings-global",
        tenantId: tenant.id,
        aiProvider: "Google Gemini",
        defaultModel: "gemini-3.5-flash",
        documentAnalysisModel: "gemini-3.5-flash",
        proposalGenerationModel: "gemini-3.5-flash",
        storageMode: "local",
        localStoragePath: "./uploads",
        s3Bucket: "",
        gcsBucket: "",
        defaultLanguage: "English",
        defaultLogLevel: "DEBUG"
      }
    });
  }

  console.log("Seeding branding settings...");
  if (!(await prisma.brandingSettings.findUnique({ where: { tenantId: tenant.id } }))) {
    await prisma.brandingSettings.create({
      data: {
        id: "branding-global",
        tenantId: tenant.id,
        companyName: "Commercial Assistant AI",
        companyLogoPath: "",
        loginLogoPath: "",
        sidebarLogoPath: "",
        reportLogoPath: "",
        faviconPath: "",
        primaryColor: BRAND_DEFAULT_PRIMARY,
        secondaryColor: "#1e293b",
        accentColor: BRAND_DEFAULT_ACCENT,
        // Fase 8: banco novo não tem histórico a preservar, então nasce com a cor da marca
        // JÁ valendo na interface - e como essa cor é exatamente a rampa de src/index.css, ligar
        // não muda um pixel.
        applyToUi: true,
        backgroundColor: "#f8fafc",
        textColor: "#0f172a",
        fontFamily: "Inter",
        borderRadius: "rounded-xl",
        buttonStyle: "solid",
        defaultTheme: "light",
        customCssVariables: "",
        footerText: "Commercial Assistant AI - Enterprise Pre-Sales Solution © 2026",
        supportContact: "support@assistantai-corp.com",
        legalText: "CONFIDENTIALITY NOTICE: This system handles proprietary and sensitive customer bidding documentation. Unauthorized disclosure of technical specification summaries or commercial tables is strictly prohibited."
      }
    });
  }

  // Fase 7 (módulo de Precificação, motor fiscal opcional): tabela de referência CONFAZ de ICMS
  // interestadual - NÃO é tenant-scoped, upsert é permitido. Regra simplificada (Resolução do
  // Senado 22/89): 7% de Sul/Sudeste (exceto ES) para o restante do país; 12% em qualquer outra
  // combinação interestadual. Alíquota interna (mesma UF origem/destino) varia por estado e fica
  // de fora de propósito - não é uma regra federal única, precisa de entrada manual.
  console.log("Seeding ICMS interstate rate table...");
  const ALL_UFS = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];
  const SUDESTE_SUL = new Set(["SP","RJ","MG","PR","SC","RS"]);
  for (const origin of ALL_UFS) {
    for (const destination of ALL_UFS) {
      if (origin === destination) continue;
      const ratePercent = SUDESTE_SUL.has(origin) && !SUDESTE_SUL.has(destination) ? 7 : 12;
      await prisma.icmsInterstateRateTable.upsert({
        where: { originUF_destinationUF: { originUF: origin, destinationUF: destination } },
        create: { id: `icms_${origin}_${destination}`, originUF: origin, destinationUF: destination, ratePercent },
        update: { ratePercent },
      });
    }
  }

  console.log("Seed complete.");
  });
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
