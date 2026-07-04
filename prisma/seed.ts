// Bootstraps a fresh database (CI, new deployment, or local dev) with the minimal canonical
// dataset the app and the regression scripts assume exists: default roles, demo users, one
// project, proposal templates, and an approval workflow with role-targeted stages. Safe to
// re-run (every write is an upsert).
import crypto from "crypto";
import { prisma } from "../src/prisma";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

async function main() {
  console.log("Seeding roles...");
  const roles = [
    {
      id: "r1",
      name: "Administrator",
      description: "Full administrative access to all workspace settings, configurations, logs, and users.",
      permissions: [
        "project:create", "project:read", "project:update", "project:delete",
        "document:upload", "document:read", "document:delete",
        "analysis:run", "analysis:read", "analysis:edit", "analysis:approve",
        "proposal:generate", "proposal:edit", "proposal:approve", "proposal:export",
        "template:manage", "approval:manage", "admin:users", "admin:roles", "admin:settings",
        "admin:audit", "admin:debug", "admin:diagnostics", "ai:settings", "branding:manage",
        "storage:manage", "integrations:manage"
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
        "template:manage", "approval:manage", "admin:settings"
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
        "proposal:generate", "proposal:edit", "proposal:export"
      ]
    }
  ];

  for (const role of roles) {
    await prisma.role.upsert({ where: { id: role.id }, create: role, update: role });
  }

  console.log("Seeding users (password: password123)...");
  const passwordHash = hashPassword("password123");
  const users = [
    { id: "u1", name: "Alex Rivera", email: "alex.rivera@enterprise.com", roleId: "r1", mfaEnabled: true },
    { id: "u2", name: "Marcus Vance", email: "marcus.vance@enterprise.com", roleId: "r2", mfaEnabled: false },
    { id: "u3", name: "Elena Rostova", email: "elena.rostova@enterprise.com", roleId: "r3", mfaEnabled: true }
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { id: user.id },
      create: { ...user, status: "ACTIVE", passwordHash },
      update: { name: user.name, email: user.email, roleId: user.roleId, mfaEnabled: user.mfaEnabled }
    });
  }

  console.log("Seeding project p1...");
  await prisma.project.upsert({
    where: { id: "p1" },
    create: {
      id: "p1",
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
    },
    update: {}
  });

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
    await prisma.proposalTemplate.upsert({ where: { id: tpl.id }, create: tpl, update: tpl });
  }

  console.log("Seeding approval workflows w1/w2...");
  await prisma.approvalWorkflow.upsert({
    where: { id: "w1" },
    create: {
      id: "w1",
      name: "High-Value Infrastructure Approval Workflow",
      description: "Rigorous 3-stage validation required for public tenders, infrastructure vertical bids, or any proposal valued over USD 50,000.",
      active: true,
      appliesTo: "all",
      stages: {
        create: [
          { id: "w1-s1", name: "Pre-Sales Technical Verification", order: 1, approverType: "role", approverRoleId: "r3", mandatory: true, conditions: "Always mandatory" },
          { id: "w1-s2", name: "Commercial & Margin Validation", order: 2, approverType: "role", approverRoleId: "r2", mandatory: true, conditions: "Valued > $10,000" },
          { id: "w1-s3", name: "Executive & Director Sign-off", order: 3, approverType: "role", approverRoleId: "r1", mandatory: true, conditions: "Valued > $50,000" }
        ]
      }
    },
    update: {}
  });

  await prisma.approvalWorkflow.upsert({
    where: { id: "w2" },
    create: {
      id: "w2",
      name: "Standard Smart City Bid Flow",
      description: "Fast-tracked 2-stage verification for smart city vertical contracts.",
      active: true,
      appliesTo: "Smart Cities",
      stages: {
        create: [
          { id: "w2-s1", name: "Technical Specification Verification", order: 1, approverType: "role", approverRoleId: "r3", mandatory: true, conditions: "Always mandatory" },
          { id: "w2-s2", name: "Commercial Approvals", order: 2, approverType: "role", approverRoleId: "r2", mandatory: true, conditions: "Always mandatory" }
        ]
      }
    },
    update: {}
  });

  console.log("Seeding platform settings...");
  await prisma.platformSettings.upsert({
    where: { id: "settings-global" },
    create: {
      id: "settings-global",
      aiProvider: "Google Gemini",
      defaultModel: "gemini-3.5-flash",
      documentAnalysisModel: "gemini-3.5-flash",
      proposalGenerationModel: "gemini-3.5-flash",
      summarizationModel: "gemini-3.5-flash",
      riskAnalysisModel: "gemini-3.5-flash",
      storageMode: "local",
      localStoragePath: "./uploads",
      s3Bucket: "",
      gcsBucket: "",
      defaultLanguage: "English",
      defaultLogLevel: "DEBUG"
    },
    update: {}
  });

  console.log("Seeding branding settings...");
  await prisma.brandingSettings.upsert({
    where: { id: "branding-global" },
    create: {
      id: "branding-global",
      companyName: "Commercial Assistant AI",
      companyLogoPath: "",
      loginLogoPath: "",
      sidebarLogoPath: "",
      reportLogoPath: "",
      faviconPath: "",
      primaryColor: "#0f172a",
      secondaryColor: "#1e293b",
      accentColor: "#06b6d4",
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
    },
    update: {}
  });

  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
