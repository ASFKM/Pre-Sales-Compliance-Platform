// One-time migration: reads the legacy db_state.json (in-memory JSON store) and
// loads it into Postgres via Prisma, preserving ids and timestamps exactly.
// Run once per environment: npm run prisma:migrate-from-json
import fs from "fs";
import path from "path";
import { prisma } from "../src/prisma";

const DB_FILE = path.join(process.cwd(), "db_state.json");
// This script pre-dates multi-tenancy entirely (it migrates from the old single-tenant JSON
// store, retired once Postgres became the real store). It only runs at all if db_state.json
// still exists, which it never will again - kept for historical/audit purposes. Everything it
// creates is attributed to the same default tenant the current prisma/seed.ts creates.
const DEFAULT_TENANT_ID = "tenant_default";

const d = (v?: string | null): Date | undefined => (v ? new Date(v) : undefined);
const dReq = (v: string): Date => new Date(v);

async function main() {
  if (!fs.existsSync(DB_FILE)) {
    console.log(`No ${DB_FILE} found - nothing to migrate, starting from empty database.`);
    return;
  }

  const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));

  console.log("Migrating roles...");
  for (const r of raw.roles || []) {
    await prisma.role.upsert({
      where: { id: r.id },
      create: { id: r.id, tenantId: DEFAULT_TENANT_ID, name: r.name, description: r.description, permissions: r.permissions || [] },
      update: {},
    });
  }

  console.log("Migrating users...");
  for (const u of raw.users || []) {
    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        tenantId: DEFAULT_TENANT_ID,
        name: u.name,
        email: u.email,
        passwordHash: u.password_hash || null,
        mfaEnabled: !!u.mfa_enabled,
        mfaTotpSecret: u.mfa_totp_secret || null,
        status: u.status,
        roleId: u.role_id,
        createdAt: dReq(u.created_at),
        updatedAt: dReq(u.updated_at),
        lastLoginAt: d(u.last_login_at),
      },
      update: {},
    });
  }

  console.log("Migrating projects...");
  for (const p of raw.projects || []) {
    await prisma.project.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        tenantId: DEFAULT_TENANT_ID,
        name: p.name,
        customerName: p.customer_name,
        opportunityName: p.opportunity_name,
        vertical: p.vertical,
        description: p.description,
        status: p.status,
        deadline: dReq(p.deadline),
        proposalValidityDate: dReq(p.proposal_validity_date),
        ownerUserId: p.owner_user_id,
        outputLanguage: p.output_language,
        proposalLanguage: p.proposal_language,
        aiOrientationMode: p.ai_orientation_mode,
        aiOrientationText: p.ai_orientation_text,
        selectedApprovalWorkflowId: p.selected_approval_workflow_id || null,
        procurementModality: p.procurement_modality || null,
        procurementSubtype: p.procurement_subtype || null,
        customModality: p.custom_modality || null,
        createdAt: dReq(p.created_at),
        updatedAt: dReq(p.updated_at),
      },
      update: {},
    });
  }

  console.log("Migrating documents...");
  for (const doc of raw.documents || []) {
    await prisma.document.upsert({
      where: { id: doc.id },
      create: {
        id: doc.id,
        tenantId: DEFAULT_TENANT_ID,
        projectId: doc.project_id,
        filename: doc.filename,
        originalFilename: doc.original_filename,
        mimeType: doc.mime_type,
        fileSize: doc.file_size,
        storageProvider: doc.storage_provider,
        storagePath: doc.storage_path,
        detectedDocumentType: doc.detected_document_type,
        manualDocumentType: doc.manual_document_type || null,
        aiClassificationConfidence: doc.ai_classification_confidence,
        version: doc.version,
        language: doc.language,
        uploadedBy: doc.uploaded_by,
        createdAt: dReq(doc.created_at),
      },
      update: {},
    });
  }

  console.log("Migrating document contents...");
  for (const [documentId, content] of Object.entries(raw.document_contents || {})) {
    await prisma.documentContent.upsert({
      where: { documentId },
      create: { documentId, tenantId: DEFAULT_TENANT_ID, content: content as string },
      update: {},
    });
  }

  console.log("Migrating analysis jobs...");
  for (const j of raw.analysisJobs || []) {
    await prisma.aIAnalysisJob.upsert({
      where: { id: j.id },
      create: {
        id: j.id,
        tenantId: DEFAULT_TENANT_ID,
        projectId: j.project_id,
        status: j.status,
        aiProvider: j.ai_provider,
        aiModel: j.ai_model,
        promptTemplateVersion: j.prompt_template_version,
        startedAt: d(j.started_at),
        completedAt: d(j.completed_at),
        errorMessage: j.error_message || null,
        tokenInput: j.token_input ?? null,
        tokenOutput: j.token_output ?? null,
        estimatedCost: j.estimated_cost ?? null,
        createdBy: j.created_by,
        correlationId: j.correlation_id,
      },
      update: {},
    });
  }

  console.log("Migrating analysis results...");
  for (const ar of raw.analysisResults || []) {
    await prisma.analysisResult.upsert({
      where: { id: ar.id },
      create: {
        id: ar.id,
        tenantId: DEFAULT_TENANT_ID,
        projectId: ar.project_id,
        jobId: ar.job_id,
        executiveSummary: ar.executive_summary,
        criticalRequirements: ar.critical_requirements,
        risks: ar.risks,
        opportunities: ar.opportunities,
        bom: ar.bom,
        pointToPointTable: ar.point_to_point_table,
        preliminarySchedule: ar.preliminary_schedule,
        clarificationQuestions: ar.clarification_questions,
        technicalProposalDraft: ar.technical_proposal_draft,
        commercialProposalDraft: ar.commercial_proposal_draft,
        reviewStatus: ar.review_status,
        approvedBy: ar.approved_by || null,
        approvedAt: d(ar.approved_at),
        createdAt: dReq(ar.created_at),
        updatedAt: dReq(ar.updated_at),
      },
      update: {},
    });
  }

  console.log("Migrating conversation history...");
  for (const c of raw.conversationHistory || []) {
    await prisma.conversationMessage.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        tenantId: DEFAULT_TENANT_ID,
        projectId: c.project_id,
        userId: c.user_id,
        role: c.role,
        message: c.message,
        aiProvider: c.ai_provider,
        aiModel: c.ai_model,
        promptTemplateVersion: c.prompt_template_version,
        inputSummary: c.input_summary,
        outputSummary: c.output_summary,
        tokenInput: c.token_input,
        tokenOutput: c.token_output,
        createdAt: dReq(c.created_at),
      },
      update: {},
    });
  }

  console.log("Migrating proposal templates...");
  for (const t of raw.proposalTemplates || []) {
    await prisma.proposalTemplate.upsert({
      where: { id: t.id },
      create: {
        id: t.id,
        tenantId: DEFAULT_TENANT_ID,
        name: t.name,
        description: t.description,
        templateType: t.template_type,
        language: t.language,
        fileType: t.file_type,
        filePath: t.file_path,
        variablesSchema: t.variables_schema,
        version: t.version,
        active: !!t.active,
        defaultTemplate: !!t.default_template,
        uploadedBy: t.uploaded_by,
        createdAt: dReq(t.created_at),
        updatedAt: dReq(t.updated_at),
      },
      update: {},
    });
  }

  console.log("Migrating approval workflows + stages...");
  for (const w of raw.approvalWorkflows || []) {
    await prisma.approvalWorkflow.upsert({
      where: { id: w.id },
      create: {
        id: w.id,
        tenantId: DEFAULT_TENANT_ID,
        name: w.name,
        description: w.description,
        active: !!w.active,
        appliesTo: w.applies_to,
        createdAt: dReq(w.created_at),
        updatedAt: dReq(w.updated_at),
      },
      update: {},
    });

    for (const s of w.stages || []) {
      await prisma.approvalStage.upsert({
        where: { id: s.id },
        create: {
          id: s.id,
          tenantId: DEFAULT_TENANT_ID,
          workflowId: w.id,
          name: s.name,
          order: s.order,
          approverType: s.approver_type,
          approverUserId: s.approver_user_id || null,
          approverRoleId: s.approver_role_id || null,
          mandatory: s.mandatory ?? true,
          conditions: s.conditions || "",
          createdAt: dReq(s.created_at),
          updatedAt: dReq(s.updated_at),
        },
        update: {},
      });
    }
  }

  console.log("Migrating proposals...");
  for (const p of raw.proposals || []) {
    await prisma.proposal.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        tenantId: DEFAULT_TENANT_ID,
        projectId: p.project_id,
        proposalType: p.proposal_type,
        templateId: p.template_id,
        templateVersion: p.template_version,
        status: p.status,
        language: p.language,
        docxFilePath: p.docx_file_path,
        pdfFilePath: p.pdf_file_path,
        generatedBy: p.generated_by,
        generatedAt: dReq(p.generated_at),
        version: p.version,
        approvalWorkflowId: p.approval_workflow_id,
        manualPricingTable: p.manual_pricing_table ?? undefined,
        paymentTerms: p.payment_terms || null,
        deliveryTerms: p.delivery_terms || null,
        proposalValidity: p.proposal_validity || null,
        commercialAssumptions: p.commercial_assumptions || null,
        exclusions: p.exclusions || null,
      },
      update: {},
    });
  }

  console.log("Migrating approval decisions...");
  for (const dec of raw.approvalDecisions || []) {
    await prisma.approvalDecision.upsert({
      where: { id: dec.id },
      create: {
        id: dec.id,
        tenantId: DEFAULT_TENANT_ID,
        proposalId: dec.proposal_id,
        stageId: dec.stage_id,
        approverUserId: dec.approver_user_id,
        decision: dec.decision,
        comments: dec.comments || "",
        createdAt: dReq(dec.created_at),
      },
      update: {},
    });
  }

  // CDC 16 F10: as tarefas pessoais da Início deixaram de existir (resposta C
  // do dono), e com elas a tabela `tasks`. Um `raw.tasks` que ainda venha num
  // JSON antigo é IGNORADO de propósito, sem erro: este importador existe para
  // trazer instalações velhas, e recusar o arquivo inteiro por causa de uma
  // seção aposentada travaria a migração de tudo o mais que ele carrega.

  console.log("Migrating prompt templates...");
  for (const pt of raw.promptTemplates || []) {
    await prisma.promptTemplate.upsert({
      where: { id: pt.id },
      create: {
        id: pt.id,
        tenantId: DEFAULT_TENANT_ID,
        name: pt.name,
        type: pt.type,
        content: pt.content,
        language: pt.language,
        version: pt.version,
        isActive: !!pt.is_active,
        createdBy: pt.created_by,
        createdAt: dReq(pt.created_at),
        updatedAt: dReq(pt.updated_at),
      },
      update: {},
    });
  }

  if (raw.platformSettings) {
    console.log("Migrating platform settings...");
    const s = raw.platformSettings;
    await prisma.platformSettings.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        tenantId: DEFAULT_TENANT_ID,
        aiProvider: s.ai_provider,
        defaultModel: s.default_model,
        documentAnalysisModel: s.document_analysis_model,
        proposalGenerationModel: s.proposal_generation_model,
        aiApiKeyEncrypted: s.ai_api_key_encrypted || null,
        storageMode: s.storage_mode,
        localStoragePath: s.local_storage_path,
        s3Bucket: s.s3_bucket,
        gcsBucket: s.gcs_bucket,
        defaultLanguage: s.default_language,
        defaultLogLevel: s.default_log_level,
        createdAt: dReq(s.created_at),
        updatedAt: dReq(s.updated_at),
      },
      update: {},
    });
  }

  if (raw.brandingSettings) {
    console.log("Migrating branding settings...");
    const b = raw.brandingSettings;
    await prisma.brandingSettings.upsert({
      where: { id: b.id },
      create: {
        id: b.id,
        tenantId: DEFAULT_TENANT_ID,
        companyName: b.company_name,
        companyLogoPath: b.company_logo_path,
        loginLogoPath: b.login_logo_path,
        sidebarLogoPath: b.sidebar_logo_path,
        reportLogoPath: b.report_logo_path,
        faviconPath: b.favicon_path,
        primaryColor: b.primary_color,
        secondaryColor: b.secondary_color,
        accentColor: b.accent_color,
        backgroundColor: b.background_color,
        textColor: b.text_color,
        fontFamily: b.font_family,
        borderRadius: b.border_radius,
        buttonStyle: b.button_style,
        defaultTheme: b.default_theme,
        customCssVariables: b.custom_css_variables,
        footerText: b.footer_text,
        supportContact: b.support_contact,
        legalText: b.legal_text,
        createdAt: dReq(b.created_at),
        updatedAt: dReq(b.updated_at),
      },
      update: {},
    });
  }

  console.log("Migrating integration connectors...");
  const VALID_INTEGRATION_STATUS = ["connected", "disconnected", "error"];
  for (const i of raw.integrationConnectors || []) {
    if (!VALID_INTEGRATION_STATUS.includes(i.status)) {
      console.warn(`Skipping integration connector ${i.id} ("${i.name}") - invalid legacy status "${i.status}" (never validated by the old JSON store).`);
      continue;
    }
    await prisma.integrationConnector.upsert({
      where: { id: i.id },
      create: {
        id: i.id,
        tenantId: DEFAULT_TENANT_ID,
        name: i.name,
        type: i.type,
        status: i.status,
        configuration: i.configuration,
        lastSyncStatus: i.last_sync_status,
        lastSyncDate: d(i.last_sync_date),
        errorMessage: i.error_message || null,
        createdAt: dReq(i.created_at),
        updatedAt: dReq(i.updated_at),
      },
      update: {},
    });
  }

  console.log("Migrating audit logs...");
  for (const a of raw.auditLogs || []) {
    await prisma.auditLog.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        tenantId: DEFAULT_TENANT_ID,
        userId: a.user_id,
        action: a.action,
        entityType: a.entity_type,
        entityId: a.entity_id,
        projectId: a.project_id || null,
        ipAddress: a.ip_address,
        userAgent: a.user_agent,
        metadata: a.metadata,
        createdAt: dReq(a.created_at),
      },
      update: {},
    });
  }

  console.log("Migrating debug logs...");
  for (const g of raw.debugLogs || []) {
    await prisma.debugLog.upsert({
      where: { id: g.id },
      create: {
        id: g.id,
        tenantId: DEFAULT_TENANT_ID,
        timestamp: dReq(g.timestamp),
        logLevel: g.log_level,
        serviceName: g.service_name,
        moduleName: g.module_name,
        environment: g.environment,
        correlationId: g.correlation_id,
        requestId: g.request_id,
        userId: g.user_id || null,
        projectId: g.project_id || null,
        documentId: g.document_id || null,
        analysisJobId: g.analysis_job_id || null,
        proposalId: g.proposal_id || null,
        operation: g.operation,
        message: g.message,
        status: g.status,
        durationMs: g.duration_ms,
        errorCode: g.error_code || null,
        errorMessage: g.error_message || null,
        safeMetadata: g.safe_metadata,
      },
      update: {},
    });
  }

  console.log("Migration complete.");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
