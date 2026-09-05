import { prisma } from "./prisma";
import { getCurrentTenantId } from "./tenantContext";
import { randomId } from "./idGenerator";
import { concluirDemandaDoProjeto } from "../server/utils/crmOutbox";
import {
  User,
  UserStatus,
  Role,
  Project,
  Poc,
  PocSuccessCriterion,
  PocEquipmentItem,
  PocBomCandidate,
  PocTask,
  PocTestCase,
  PocAcceptance,
  PocFinalReportQuestion,
  Document,
  AIAnalysisJob,
  AnalysisResult,
  ConversationMessage,
  AuditLog,
  DebugLog,
  PlatformSettings,
  PromptTemplate,
  ProposalTemplate,
  Proposal,
  ApprovalWorkflow,
  ApprovalDecision,
  IntegrationConnector,
  TeamMembership,
  KnowledgeBaseEntry,
  KnowledgeBaseDocument,
  IaKbBillingSnapshot,
  IaKbTaskConfig,
} from "./types";

// The Prisma extension (src/prisma.ts) auto-injects tenant_id from context at runtime for
// every create/upsert, but Prisma's generated types don't know that - they still require the
// field explicitly. Passing it here keeps the compiler honest; the extension is the actual
// runtime safety net if a call site is ever added without going through this.
function requireTenantId(): string {
  const tenantId = getCurrentTenantId();
  if (!tenantId) {
    throw new Error("No tenant context set - this operation must run inside runWithTenant().");
  }
  return tenantId;
}

// Prisma rows use camelCase/Date; the rest of the app speaks the original
// snake_case/ISO-string shape from types.ts. These mappers keep every route
// file's existing field names working unchanged.
function mapUser(u: any): User {
  return {
    id: u.id,
    tenant_id: u.tenantId,
    name: u.name,
    email: u.email,
    mfa_enabled: u.mfaEnabled,
    must_change_password: u.mustChangePassword,
    status: u.status,
    role_id: u.roleId,
    created_at: u.createdAt.toISOString(),
    updated_at: u.updatedAt.toISOString(),
    last_login_at: u.lastLoginAt ? u.lastLoginAt.toISOString() : undefined,
    password_changed_at: u.passwordChangedAt ? u.passwordChangedAt.toISOString() : undefined,
  } as User;
}

function mapRole(r: any): Role {
  return { id: r.id, tenant_id: r.tenantId, name: r.name, description: r.description, permissions: r.permissions };
}

function mapTeamMembership(t: any): TeamMembership {
  return { id: t.id, tenant_id: t.tenantId, manager_id: t.managerId, engineer_id: t.engineerId, created_at: t.createdAt.toISOString() };
}

function mapProject(p: any): Project {
  return {
    id: p.id,
    name: p.name,
    customer_name: p.customerName,
    opportunity_name: p.opportunityName,
    vertical: p.vertical,
    description: p.description,
    status: p.status,
    deadline: p.deadline.toISOString().substring(0, 10),
    proposal_validity_date: p.proposalValidityDate.toISOString().substring(0, 10),
    owner_user_id: p.ownerUserId,
    output_language: p.outputLanguage,
    proposal_language: p.proposalLanguage,
    ai_orientation_mode: p.aiOrientationMode,
    ai_orientation_text: p.aiOrientationText,
    selected_approval_workflow_id: p.selectedApprovalWorkflowId,
    procurement_modality: p.procurementModality ?? undefined,
    procurement_subtype: p.procurementSubtype ?? undefined,
    custom_modality: p.customModality ?? undefined,
    // CDC 16 (D31): a referência do cliente e da oportunidade no CRM. Sem estas
    // duas linhas as colunas existiriam no banco e seriam invisíveis para quem
    // lê o projeto pela API - foi assim que a prova da F1 as pegou faltando.
    crm_company_id: p.crmCompanyId ?? undefined,
    crm_opportunity_id: p.crmOpportunityId ?? undefined,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  } as Project;
}

function mapPoc(p: any): Poc {
  return {
    id: p.id,
    project_id: p.projectId ?? undefined,
    standalone_customer_name: p.standaloneCustomerName ?? undefined,
    standalone_contact_name: p.standaloneContactName ?? undefined,
    standalone_contact_email: p.standaloneContactEmail ?? undefined,
    standalone_contact_phone: p.standaloneContactPhone ?? undefined,
    name: p.name,
    objective: p.objective,
    status: p.status,
    archived: p.archived,
    acceptance_decision: p.acceptance?.decision ?? undefined,
    start_date: p.startDate.toISOString().substring(0, 10),
    end_date: p.endDate.toISOString().substring(0, 10),
    owner_user_id: p.ownerUserId,
    owner_name: p.owner?.name ?? undefined,
    customer_contact_name: p.customerContactName,
    customer_contact_role: p.customerContactRole,
    address_zip: p.addressZip ?? undefined,
    address_street: p.addressStreet ?? undefined,
    address_number: p.addressNumber ?? undefined,
    address_complement: p.addressComplement ?? undefined,
    address_neighborhood: p.addressNeighborhood ?? undefined,
    address_city: p.addressCity ?? undefined,
    address_state: p.addressState ?? undefined,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  } as Poc;
}

function mapPocSuccessCriterion(c: any): PocSuccessCriterion {
  return {
    id: c.id,
    poc_id: c.pocId,
    description: c.description,
    done: c.done,
    order: c.order,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  } as PocSuccessCriterion;
}

function mapPocEquipmentItem(e: any): PocEquipmentItem {
  return {
    id: e.id,
    poc_id: e.pocId,
    name: e.name,
    serial_number: e.serialNumber ?? undefined,
    status: e.status,
    manufacturer: e.manufacturer ?? undefined,
    part_number: e.partNumber ?? undefined,
    source_bom_item_id: e.sourceBomItemId ?? undefined,
    kb_match_count: e.kbMatchCount,
    datasheet_knowledge_base_document_id: e.datasheetKnowledgeBaseDocumentId ?? undefined,
    shipping_invoice_original_filename: e.shippingInvoiceOriginalFilename ?? undefined,
    return_invoice_original_filename: e.returnInvoiceOriginalFilename ?? undefined,
    tracking_code: e.trackingCode ?? undefined,
    tracking_carrier_status: e.trackingCarrierStatus ?? undefined,
    tracking_last_checked_at: e.trackingLastCheckedAt ? e.trackingLastCheckedAt.toISOString() : undefined,
    created_at: e.createdAt.toISOString(),
    updated_at: e.updatedAt.toISOString(),
  } as PocEquipmentItem;
}

function mapPocTask(t: any): PocTask {
  return {
    id: t.id,
    poc_id: t.pocId,
    name: t.name,
    start_date: t.startDate.toISOString().substring(0, 10),
    duration_days: t.durationDays,
    status: t.status,
    depends_on_task_id: t.dependsOnTaskId ?? undefined,
    generated_by_ai: t.generatedByAi,
    edited_manually: t.editedManually,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
  } as PocTask;
}

function mapPocTestCase(c: any): PocTestCase {
  return {
    id: c.id,
    poc_id: c.pocId,
    code: c.code,
    title: c.title,
    objective: c.objective,
    steps: c.steps,
    expected_result: c.expectedResult,
    status: c.status,
    generated_by_ai: c.generatedByAi,
    edited_manually: c.editedManually,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  } as PocTestCase;
}

function mapPocAcceptance(a: any): PocAcceptance {
  return {
    id: a.id,
    poc_id: a.pocId,
    decision: a.decision,
    signed_document_original_filename: a.signedDocumentOriginalFilename ?? undefined,
    signed_by: a.signedBy ?? undefined,
    signed_at: a.signedAt ? a.signedAt.toISOString().substring(0, 10) : undefined,
    notes: a.notes ?? undefined,
    pending_approval: a.pendingApproval,
    approved_by_user_id: a.approvedByUserId ?? undefined,
    approved_at: a.approvedAt ? a.approvedAt.toISOString() : undefined,
    created_at: a.createdAt.toISOString(),
    updated_at: a.updatedAt.toISOString(),
  } as PocAcceptance;
}

function mapPocFinalReportQuestion(q: any): PocFinalReportQuestion {
  return {
    id: q.id,
    poc_id: q.pocId,
    question: q.question,
    answer: q.answer ?? undefined,
    order: q.order,
    generated_by_ai: q.generatedByAi,
    edited_manually: q.editedManually,
    created_at: q.createdAt.toISOString(),
    updated_at: q.updatedAt.toISOString(),
  } as PocFinalReportQuestion;
}

function mapDocument(d: any): Document {
  return {
    id: d.id,
    project_id: d.projectId,
    filename: d.filename,
    original_filename: d.originalFilename,
    mime_type: d.mimeType,
    file_size: d.fileSize,
    storage_provider: d.storageProvider,
    storage_path: d.storagePath,
    detected_document_type: d.detectedDocumentType,
    manual_document_type: d.manualDocumentType ?? undefined,
    ai_classification_confidence: d.aiClassificationConfidence,
    version: d.version,
    language: d.language,
    uploaded_by: d.uploadedBy,
    created_at: d.createdAt.toISOString(),
  } as Document;
}

function mapKnowledgeBaseEntry(e: any): KnowledgeBaseEntry {
  return {
    id: e.id,
    category: e.category,
    trigger: e.trigger,
    knowledge: e.knowledge,
    status: e.status,
    source: e.source,
    source_project_id: e.sourceProjectId ?? undefined,
    source_project_name: e.sourceProjectName ?? undefined,
    source_document_id: e.sourceDocumentId ?? undefined,
    source_document_name: e.sourceDocumentName ?? undefined,
    created_by: e.createdBy,
    reviewed_by: e.reviewedBy ?? undefined,
    created_at: e.createdAt.toISOString(),
    reviewed_at: e.reviewedAt ? e.reviewedAt.toISOString() : undefined,
    fleet_global_entry_id: e.fleetGlobalEntryId ?? undefined,
    synced_to_fleet_at: e.syncedToFleetAt ? e.syncedToFleetAt.toISOString() : undefined,
  };
}

function mapKnowledgeBaseDocument(d: any): KnowledgeBaseDocument {
  return {
    id: d.id,
    filename: d.filename,
    original_filename: d.originalFilename,
    mime_type: d.mimeType,
    file_size: d.fileSize,
    storage_provider: d.storageProvider,
    storage_path: d.storagePath,
    uploaded_by: d.uploadedBy,
    analyzed_at: d.analyzedAt ? d.analyzedAt.toISOString() : undefined,
    content_hash: d.contentHash ?? undefined,
    created_at: d.createdAt.toISOString(),
  };
}

function mapJob(j: any): AIAnalysisJob {
  return {
    id: j.id,
    project_id: j.projectId,
    status: j.status,
    ai_provider: j.aiProvider,
    ai_model: j.aiModel,
    prompt_template_version: j.promptTemplateVersion,
    started_at: j.startedAt ? j.startedAt.toISOString() : undefined,
    completed_at: j.completedAt ? j.completedAt.toISOString() : undefined,
    error_message: j.errorMessage ?? undefined,
    token_input: j.tokenInput ?? undefined,
    token_output: j.tokenOutput ?? undefined,
    estimated_cost: j.estimatedCost ?? undefined,
    created_by: j.createdBy,
    correlation_id: j.correlationId,
  } as AIAnalysisJob;
}

function mapAnalysisResult(a: any): AnalysisResult {
  return {
    id: a.id,
    project_id: a.projectId,
    job_id: a.jobId,
    executive_summary: a.executiveSummary,
    critical_requirements: a.criticalRequirements,
    risks: a.risks,
    opportunities: a.opportunities,
    bom: a.bom,
    point_to_point_table: a.pointToPointTable,
    preliminary_schedule: a.preliminarySchedule,
    clarification_questions: a.clarificationQuestions,
    technical_proposal_draft: a.technicalProposalDraft,
    commercial_proposal_draft: a.commercialProposalDraft,
    review_status: a.reviewStatus,
    approved_by: a.approvedBy ?? undefined,
    approved_at: a.approvedAt ? a.approvedAt.toISOString() : undefined,
    created_at: a.createdAt.toISOString(),
    updated_at: a.updatedAt.toISOString(),
    logic_versions: a.logicVersions ?? null,
  } as AnalysisResult;
}

function mapConversation(c: any): ConversationMessage {
  return {
    id: c.id,
    project_id: c.projectId,
    user_id: c.userId,
    role: c.role,
    message: c.message,
    ai_provider: c.aiProvider,
    ai_model: c.aiModel,
    prompt_template_version: c.promptTemplateVersion,
    input_summary: c.inputSummary,
    output_summary: c.outputSummary,
    token_input: c.tokenInput,
    token_output: c.tokenOutput,
    created_at: c.createdAt.toISOString(),
  } as ConversationMessage;
}

function mapAuditLog(a: any): AuditLog {
  return {
    id: a.id,
    user_id: a.userId,
    action: a.action,
    entity_type: a.entityType,
    entity_id: a.entityId,
    project_id: a.projectId ?? undefined,
    ip_address: a.ipAddress,
    user_agent: a.userAgent,
    metadata: a.metadata,
    created_at: a.createdAt.toISOString(),
  } as AuditLog;
}

function mapDebugLog(g: any): DebugLog {
  return {
    id: g.id,
    timestamp: g.timestamp.toISOString(),
    log_level: g.logLevel,
    service_name: g.serviceName,
    module_name: g.moduleName,
    environment: g.environment,
    correlation_id: g.correlationId,
    request_id: g.requestId,
    tenant_id: g.tenantId ?? undefined,
    user_id: g.userId ?? undefined,
    project_id: g.projectId ?? undefined,
    document_id: g.documentId ?? undefined,
    analysis_job_id: g.analysisJobId ?? undefined,
    proposal_id: g.proposalId ?? undefined,
    operation: g.operation,
    message: g.message,
    status: g.status,
    duration_ms: g.durationMs,
    error_code: g.errorCode ?? undefined,
    error_message: g.errorMessage ?? undefined,
    safe_metadata: g.safeMetadata,
  } as DebugLog;
}

function mapIaKbBillingSnapshot(s: any): IaKbBillingSnapshot {
  return {
    markup_percent: s.markupPercent,
    cycle_start: s.cycleStart ? s.cycleStart.toISOString() : null,
    cycle_billed_cost_usd: s.cycleBilledCostUsd,
    cycle_call_count: s.cycleCallCount,
    next_due_date: s.nextDueDate ? s.nextDueDate.toISOString() : null,
    last_synced_at: s.lastSyncedAt.toISOString(),
  };
}

function mapSettings(s: any): PlatformSettings {
  return {
    id: s.id,
    ai_provider: s.aiProvider,
    default_model: s.defaultModel,
    document_analysis_model: s.documentAnalysisModel,
    proposal_generation_model: s.proposalGenerationModel,
    ai_api_key_encrypted: s.aiApiKeyEncrypted ?? undefined,
    openai_api_key_encrypted: s.openaiApiKeyEncrypted ?? undefined,
    anthropic_api_key_encrypted: s.anthropicApiKeyEncrypted ?? undefined,
    document_analysis_provider: s.documentAnalysisProvider,
    critical_extraction_model: s.criticalExtractionModel,
    critical_extraction_provider: s.criticalExtractionProvider,
    web_grounding_model: s.webGroundingModel,
    web_grounding_provider: s.webGroundingProvider,
    proposal_generation_provider: s.proposalGenerationProvider,
    spec_copilot_model: s.specCopilotModel,
    spec_copilot_provider: s.specCopilotProvider,
    document_classification_model: s.documentClassificationModel,
    document_classification_provider: s.documentClassificationProvider,
    poc_test_generation_model: s.pocTestGenerationModel,
    poc_test_generation_provider: s.pocTestGenerationProvider,
    poc_schedule_generation_model: s.pocScheduleGenerationModel,
    poc_schedule_generation_provider: s.pocScheduleGenerationProvider,
    poc_final_report_generation_model: s.pocFinalReportGenerationModel,
    poc_final_report_generation_provider: s.pocFinalReportGenerationProvider,
    proposal_opinion_panel_model: s.proposalOpinionPanelModel,
    proposal_opinion_panel_provider: s.proposalOpinionPanelProvider,
    pricing_budget_optimization_model: s.pricingBudgetOptimizationModel,
    pricing_budget_optimization_provider: s.pricingBudgetOptimizationProvider,
    pricing_catalog_extraction_model: s.pricingCatalogExtractionModel,
    pricing_catalog_extraction_provider: s.pricingCatalogExtractionProvider,
    proposal_section_rewrite_model: s.proposalSectionRewriteModel,
    proposal_section_rewrite_provider: s.proposalSectionRewriteProvider,
    proposal_finding_remediation_model: s.proposalFindingRemediationModel,
    proposal_finding_remediation_provider: s.proposalFindingRemediationProvider,
    proposal_grammar_check_model: s.proposalGrammarCheckModel,
    proposal_grammar_check_provider: s.proposalGrammarCheckProvider,
    proposal_section_coherence_model: s.proposalSectionCoherenceModel,
    proposal_section_coherence_provider: s.proposalSectionCoherenceProvider,
    proposal_approver_briefing_model: s.proposalApproverBriefingModel,
    proposal_approver_briefing_provider: s.proposalApproverBriefingProvider,
    monthly_cost_cap_usd: s.monthlyCostCapUsd ?? null,
    fleet_manager_url: s.fleetManagerUrl ?? null,
    fleet_manager_api_key_encrypted: s.fleetManagerApiKeyEncrypted ?? undefined,
    fleet_manager_enabled: s.fleetManagerEnabled,
    storage_mode: s.storageMode,
    local_storage_path: s.localStoragePath,
    s3_bucket: s.s3Bucket,
    s3_region: s.s3Region ?? undefined,
    s3_access_key_id: s.s3AccessKeyId ?? undefined,
    s3_secret_access_key_encrypted: s.s3SecretAccessKeyEncrypted ?? undefined,
    gcs_bucket: s.gcsBucket,
    gcs_project_id: s.gcsProjectId ?? undefined,
    gcs_service_account_key_encrypted: s.gcsServiceAccountKeyEncrypted ?? undefined,
    default_language: s.defaultLanguage,
    default_log_level: s.defaultLogLevel,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  } as PlatformSettings;
}

function mapPrompt(p: any): PromptTemplate {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    content: p.content,
    language: p.language,
    version: p.version,
    is_active: p.isActive,
    created_by: p.createdBy,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  } as PromptTemplate;
}

function mapProposalTemplate(t: any): ProposalTemplate {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    template_type: t.templateType,
    language: t.language,
    file_type: t.fileType,
    file_path: t.filePath,
    storage_provider: t.storageProvider,
    variables_schema: t.variablesSchema,
    version: t.version,
    active: t.active,
    default_template: t.defaultTemplate,
    uploaded_by: t.uploadedBy,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
  } as ProposalTemplate;
}

function mapProposal(p: any): Proposal {
  return {
    id: p.id,
    project_id: p.projectId,
    proposal_type: p.proposalType,
    template_id: p.templateId,
    template_version: p.templateVersion,
    status: p.status,
    language: p.language,
    docx_file_path: p.docxFilePath,
    pdf_file_path: p.pdfFilePath,
    storage_provider: p.storageProvider,
    generated_by: p.generatedBy,
    generated_at: p.generatedAt.toISOString(),
    version: p.version,
    template_field_values: (p.templateFieldValues as Record<string, string> | null) ?? null,
    proposal_group_id: p.proposalGroupId,
    previous_version_id: p.previousVersionId ?? null,
    approval_workflow_id: p.approvalWorkflowId,
    manual_pricing_table: p.manualPricingTable ?? undefined,
    payment_terms: p.paymentTerms ?? undefined,
    delivery_terms: p.deliveryTerms ?? undefined,
    proposal_validity: p.proposalValidity ?? undefined,
    commercial_assumptions: p.commercialAssumptions ?? undefined,
    exclusions: p.exclusions ?? undefined,
    editable_content: p.editableContent ?? undefined,
    client_decision: p.clientDecision ?? null,
    client_decision_at: p.clientDecisionAt ? p.clientDecisionAt.toISOString() : null,
    client_decision_by_user_id: p.clientDecisionByUserId ?? null,
    client_decision_note: p.clientDecisionNote ?? null,
    latest_opinion_run_id: p.latestOpinionRunId ?? null,
  } as Proposal;
}

function mapStage(s: any) {
  return {
    id: s.id,
    workflow_id: s.workflowId,
    name: s.name,
    order: s.order,
    approver_type: s.approverType,
    approver_user_id: s.approverUserId ?? undefined,
    approver_role_id: s.approverRoleId ?? undefined,
    mandatory: s.mandatory,
    conditions: s.conditions,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}

function mapWorkflow(w: any): ApprovalWorkflow {
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    active: w.active,
    applies_to: w.appliesTo,
    stages: (w.stages || []).map(mapStage).sort((a: { order: number }, b: { order: number }) => a.order - b.order),
    created_at: w.createdAt.toISOString(),
    updated_at: w.updatedAt.toISOString(),
  } as ApprovalWorkflow;
}

function mapDecision(d: any): ApprovalDecision {
  return {
    id: d.id,
    proposal_id: d.proposalId,
    stage_id: d.stageId,
    approver_user_id: d.approverUserId,
    decision: d.decision,
    comments: d.comments,
    created_at: d.createdAt.toISOString(),
  } as ApprovalDecision;
}

function mapIntegration(i: any): IntegrationConnector {
  return {
    id: i.id,
    name: i.name,
    type: i.type,
    status: i.status,
    configuration: i.configuration,
    // Not part of the IntegrationConnector type, but server/routes/integrations.ts
    // reads/writes these dynamically (already-encrypted values) via `as any`.
    api_key: i.apiKeyEncrypted ?? undefined,
    webhook_secret: i.webhookSecretEncrypted ?? undefined,
    last_sync_status: i.lastSyncStatus,
    last_sync_date: i.lastSyncDate ? i.lastSyncDate.toISOString() : undefined,
    error_message: i.errorMessage ?? undefined,
    created_at: i.createdAt.toISOString(),
    updated_at: i.updatedAt.toISOString(),
  } as unknown as IntegrationConnector;
}

class DBStore {
  // Users
  public async getUsers(): Promise<User[]> {
    return (await prisma.user.findMany({ orderBy: { createdAt: "asc" } })).map(mapUser);
  }

  public async getUserById(id: string): Promise<User | undefined> {
    const u = await prisma.user.findUnique({ where: { id } });
    return u ? mapUser(u) : undefined;
  }

  public async getUserByEmail(email: string): Promise<User | undefined> {
    const u = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    return u ? mapUser(u) : undefined;
  }

  public async getUserPasswordHash(id: string): Promise<string | null> {
    const u = await prisma.user.findUnique({ where: { id }, select: { passwordHash: true } });
    return u?.passwordHash ?? null;
  }

  public async createUser(data: {
    name: string;
    email: string;
    role_id: string;
    status?: UserStatus;
    mfa_enabled?: boolean;
    password_hash: string;
  }): Promise<User> {
    const u = await prisma.user.create({
      data: {
        id: randomId("u"),
        tenantId: requireTenantId(),
        name: data.name,
        email: data.email.toLowerCase().trim(),
        roleId: data.role_id,
        status: data.status || UserStatus.ACTIVE,
        mfaEnabled: data.mfa_enabled ?? false,
        passwordHash: data.password_hash,
        // F3: o relogio da validade comeca agora. Sem isto, uma conta criada hoje ja nasceria
        // vencida num tenant com validade configurada (nulo conta como vencida).
        passwordChangedAt: new Date(),
        // Roadmap (segurança): sempre true na criação, sem opção de desligar - o admin sempre
        // define/aceita a senha inicial, então o usuário sempre precisa trocá-la no primeiro login.
        mustChangePassword: true,
      },
    });
    return mapUser(u);
  }

  public async updateUser(id: string, updates: Partial<User> & { password_hash?: string }): Promise<User | undefined> {
    const exists = await prisma.user.findUnique({ where: { id } });
    if (!exists) return undefined;

    const u = await prisma.user.update({
      where: { id },
      data: {
        name: updates.name,
        email: updates.email ? updates.email.toLowerCase().trim() : undefined,
        roleId: updates.role_id,
        status: updates.status,
        mfaEnabled: updates.mfa_enabled,
        passwordHash: updates.password_hash,
        mustChangePassword: updates.must_change_password,
        // F3: trocar a senha zera o relogio da validade, e SO trocar a senha. `undefined` deixa a
        // coluna intacta em qualquer outro update (nome, papel, status), que e o que se quer:
        // renomear alguem nao deve renovar a validade da senha dessa pessoa.
        passwordChangedAt: updates.password_hash ? new Date() : undefined,
      },
    });
    return mapUser(u);
  }

  public async deleteUser(id: string): Promise<boolean> {
    try {
      await prisma.user.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  public async setUserLastLogin(id: string): Promise<void> {
    await prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  public async getUserMfaSecretEncrypted(id: string): Promise<string | null> {
    const u = await prisma.user.findUnique({ where: { id }, select: { mfaTotpSecret: true } });
    return u?.mfaTotpSecret ?? null;
  }

  public async setUserMfaSecret(id: string, encryptedSecret: string | null): Promise<void> {
    await prisma.user.update({ where: { id }, data: { mfaTotpSecret: encryptedSecret } });
  }

  // Roles
  public async getRoles(): Promise<Role[]> {
    return (await prisma.role.findMany()).map(mapRole);
  }

  public async getRoleById(id: string): Promise<Role | undefined> {
    const r = await prisma.role.findUnique({ where: { id } });
    return r ? mapRole(r) : undefined;
  }

  public async createRole(role: Omit<Role, "id" | "tenant_id">): Promise<Role> {
    const r = await prisma.role.create({
      data: { id: randomId("r"), tenantId: requireTenantId(), name: role.name, description: role.description, permissions: role.permissions },
    });
    return mapRole(r);
  }

  public async updateRole(id: string, updates: Partial<Role>): Promise<Role | undefined> {
    const exists = await prisma.role.findUnique({ where: { id } });
    if (!exists) return undefined;
    const r = await prisma.role.update({
      where: { id },
      data: { name: updates.name, description: updates.description, permissions: updates.permissions },
    });
    return mapRole(r);
  }

  public async deleteRole(id: string): Promise<boolean> {
    const protectedRoles = ["r1", "r2", "r3"];
    if (protectedRoles.includes(id)) return false;

    const inUse = await prisma.user.count({ where: { roleId: id } });
    if (inUse > 0) return false;

    try {
      await prisma.role.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  public async getVerticals(): Promise<{ id: string; name: string; is_active: boolean }[]> {
    const rows = await prisma.vertical.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map((v) => ({ id: v.id, name: v.name, is_active: v.isActive }));
  }

  public async createVertical(name: string): Promise<{ id: string; name: string; is_active: boolean }> {
    const v = await prisma.vertical.create({ data: { id: randomId("vert"), tenantId: requireTenantId(), name } });
    return { id: v.id, name: v.name, is_active: v.isActive };
  }

  public async updateVertical(id: string, updates: { name?: string; is_active?: boolean }): Promise<{ id: string; name: string; is_active: boolean } | undefined> {
    const exists = await prisma.vertical.findUnique({ where: { id } });
    if (!exists) return undefined;
    const v = await prisma.vertical.update({ where: { id }, data: { name: updates.name, isActive: updates.is_active } });
    return { id: v.id, name: v.name, is_active: v.isActive };
  }

  public async deleteVertical(id: string): Promise<boolean> {
    const inUse = await prisma.project.count({ where: { vertical: (await prisma.vertical.findUnique({ where: { id } }))?.name || "__none__" } });
    if (inUse > 0) return false;
    try {
      await prisma.vertical.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // Manager <-> Engineer teams (Phase 3 RBAC): N:N, an Engineer can belong to more than one
  // Manager's team - drives the "Manager sees their team's projects" visibility rule embedded
  // in the Prisma extension (src/prisma.ts), not enforced here.
  public async getTeamMemberships(): Promise<TeamMembership[]> {
    return (await prisma.teamMembership.findMany({ orderBy: { createdAt: "desc" } })).map(mapTeamMembership);
  }

  public async addTeamMembership(managerId: string, engineerId: string): Promise<TeamMembership> {
    const t = await prisma.teamMembership.create({
      data: { id: randomId("tm"), tenantId: requireTenantId(), managerId, engineerId },
    });
    return mapTeamMembership(t);
  }

  public async removeTeamMembership(id: string): Promise<boolean> {
    try {
      await prisma.teamMembership.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // Projects
  public async getProjects(): Promise<Project[]> {
    return (await prisma.project.findMany({ orderBy: { createdAt: "desc" } })).map(mapProject);
  }

  public async getProject(id: string): Promise<Project | undefined> {
    const p = await prisma.project.findUnique({ where: { id } });
    return p ? mapProject(p) : undefined;
  }

  public async createProject(project: Omit<Project, "id" | "created_at" | "updated_at">): Promise<Project> {
    const p = await prisma.project.create({
      data: {
        id: randomId("p"),
        tenantId: requireTenantId(),
        name: project.name,
        customerName: project.customer_name,
        opportunityName: project.opportunity_name,
        vertical: project.vertical,
        description: project.description,
        status: project.status,
        deadline: new Date(project.deadline),
        proposalValidityDate: new Date(project.proposal_validity_date),
        ownerUserId: project.owner_user_id,
        outputLanguage: project.output_language,
        proposalLanguage: project.proposal_language,
        aiOrientationMode: project.ai_orientation_mode,
        aiOrientationText: project.ai_orientation_text,
        selectedApprovalWorkflowId: project.selected_approval_workflow_id,
        procurementModality: project.procurement_modality,
        procurementSubtype: project.procurement_subtype,
        customModality: project.custom_modality,
      },
    });
    return mapProject(p);
  }

  public async updateProject(id: string, updates: Partial<Project>): Promise<Project | undefined> {
    const exists = await prisma.project.findUnique({ where: { id } });
    if (!exists) return undefined;

    const p = await prisma.project.update({
      where: { id },
      data: {
        name: updates.name,
        customerName: updates.customer_name,
        opportunityName: updates.opportunity_name,
        vertical: updates.vertical,
        description: updates.description,
        status: updates.status,
        deadline: updates.deadline ? new Date(updates.deadline) : undefined,
        proposalValidityDate: updates.proposal_validity_date ? new Date(updates.proposal_validity_date) : undefined,
        ownerUserId: updates.owner_user_id,
        outputLanguage: updates.output_language,
        proposalLanguage: updates.proposal_language,
        aiOrientationMode: updates.ai_orientation_mode,
        aiOrientationText: updates.ai_orientation_text,
        selectedApprovalWorkflowId: updates.selected_approval_workflow_id,
        procurementModality: updates.procurement_modality,
        procurementSubtype: updates.procurement_subtype,
        customModality: updates.custom_modality,
      },
    });

    // CDC 16 F3: o projeto vinculado a uma Demanda chegando a `completed` é o
    // que CONCLUI a demanda — este produto não tinha um ato de "concluir a
    // demanda" e não deveria ganhar um botão só para isso: quem termina o
    // trabalho termina o PROJETO, e a demanda é o pedido que o originou.
    //
    // A conclusão é registrada mesmo quando o CRM está fora do ar: o carimbo é
    // local e a notícia vai pela fila de saída, que retenta.
    if (updates.status === "completed" && exists.status !== "completed") {
      await concluirDemandaDoProjeto(id, p.tenantId);
    }

    return mapProject(p);
  }

  public async deleteProject(id: string): Promise<boolean> {
    try {
      // Documents/analysisResults/proposals/tasks cascade via FK onDelete: Cascade
      await prisma.project.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // Pocs (Fase 6, add-on) - gated at the route layer by requireModule("poc"), not here; this
  // layer just persists whatever the caller already confirmed is entitled.
  public async getPocs(filters: { archived?: boolean } = {}): Promise<Poc[]> {
    // Owner name is denormalized onto the payload (not left for the frontend to resolve via
    // /api/users) because that endpoint is admin-gated - a regular poc:manage user without
    // admin:users still needs to see who owns each POC. acceptance.decision is denormalized too
    // (Fase K) so the Kanban board can color a completed card won/lost without an N+1 fetch.
    const rows = await prisma.poc.findMany({
      where: filters.archived !== undefined ? { archived: filters.archived } : undefined,
      orderBy: { createdAt: "desc" },
      include: { owner: true, acceptance: true },
    });
    return rows.map(mapPoc);
  }

  public async getPoc(id: string): Promise<Poc | undefined> {
    const p = await prisma.poc.findUnique({ where: { id }, include: { owner: true } });
    return p ? mapPoc(p) : undefined;
  }

  public async createPoc(poc: Omit<Poc, "id" | "created_at" | "updated_at" | "archived" | "acceptance_decision">): Promise<Poc> {
    const p = await prisma.poc.create({
      data: {
        id: randomId("poc"),
        tenantId: requireTenantId(),
        projectId: poc.project_id || null,
        standaloneCustomerName: poc.standalone_customer_name,
        standaloneContactName: poc.standalone_contact_name,
        standaloneContactEmail: poc.standalone_contact_email,
        standaloneContactPhone: poc.standalone_contact_phone,
        name: poc.name,
        objective: poc.objective,
        status: poc.status,
        startDate: new Date(poc.start_date),
        endDate: new Date(poc.end_date),
        ownerUserId: poc.owner_user_id,
        customerContactName: poc.customer_contact_name,
        customerContactRole: poc.customer_contact_role,
        addressZip: poc.address_zip,
        addressStreet: poc.address_street,
        addressNumber: poc.address_number,
        addressComplement: poc.address_complement,
        addressNeighborhood: poc.address_neighborhood,
        addressCity: poc.address_city,
        addressState: poc.address_state,
      },
      include: { owner: true },
    });
    return mapPoc(p);
  }

  public async updatePoc(id: string, updates: Partial<Poc>): Promise<Poc | undefined> {
    const exists = await prisma.poc.findUnique({ where: { id } });
    if (!exists) return undefined;

    const p = await prisma.poc.update({
      where: { id },
      include: { owner: true },
      data: {
        projectId: updates.project_id,
        standaloneCustomerName: updates.standalone_customer_name,
        standaloneContactName: updates.standalone_contact_name,
        standaloneContactEmail: updates.standalone_contact_email,
        standaloneContactPhone: updates.standalone_contact_phone,
        name: updates.name,
        objective: updates.objective,
        status: updates.status,
        archived: updates.archived,
        startDate: updates.start_date ? new Date(updates.start_date) : undefined,
        endDate: updates.end_date ? new Date(updates.end_date) : undefined,
        ownerUserId: updates.owner_user_id,
        customerContactName: updates.customer_contact_name,
        customerContactRole: updates.customer_contact_role,
        addressZip: updates.address_zip,
        addressStreet: updates.address_street,
        addressNumber: updates.address_number,
        addressComplement: updates.address_complement,
        addressNeighborhood: updates.address_neighborhood,
        addressCity: updates.address_city,
        addressState: updates.address_state,
      },
    });
    return mapPoc(p);
  }

  public async deletePoc(id: string): Promise<boolean> {
    try {
      await prisma.poc.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // Poc success criteria (Fase 6, Fase B)
  public async getPocSuccessCriteria(pocId: string): Promise<PocSuccessCriterion[]> {
    const rows = await prisma.pocSuccessCriterion.findMany({
      where: { pocId },
      orderBy: { order: "asc" },
    });
    return rows.map(mapPocSuccessCriterion);
  }

  public async createPocSuccessCriterion(pocId: string, description: string): Promise<PocSuccessCriterion> {
    const count = await prisma.pocSuccessCriterion.count({ where: { pocId } });
    const c = await prisma.pocSuccessCriterion.create({
      data: {
        id: randomId("crit"),
        tenantId: requireTenantId(),
        pocId,
        description,
        order: count,
      },
    });
    return mapPocSuccessCriterion(c);
  }

  public async updatePocSuccessCriterion(id: string, updates: { description?: string; done?: boolean }): Promise<PocSuccessCriterion | undefined> {
    const exists = await prisma.pocSuccessCriterion.findUnique({ where: { id } });
    if (!exists) return undefined;

    const c = await prisma.pocSuccessCriterion.update({
      where: { id },
      data: {
        description: updates.description,
        done: updates.done,
      },
    });
    return mapPocSuccessCriterion(c);
  }

  public async deletePocSuccessCriterion(id: string): Promise<boolean> {
    try {
      await prisma.pocSuccessCriterion.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // Poc equipment (Fase 6, Fase C) - no shared inventory across POCs (product decision,
  // 2026-07-13): each POC only tracks what it itself shipped.
  public async getPocEquipmentItems(pocId: string): Promise<PocEquipmentItem[]> {
    const rows = await prisma.pocEquipmentItem.findMany({
      where: { pocId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(mapPocEquipmentItem);
  }

  // BOM items from the POC's linked Project (if any) not yet imported as equipment - the BOM
  // itself lives as a JSON blob on AnalysisResult (one per project, see getAnalysisResult), not a
  // table, so "already imported" is tracked via PocEquipmentItem.sourceBomItemId rather than a
  // real foreign key.
  public async getPocBomCandidates(pocId: string): Promise<PocBomCandidate[]> {
    const poc = await this.getPoc(pocId);
    if (!poc?.project_id) return [];

    const analysis = await this.getAnalysisResult(poc.project_id);
    if (!analysis?.bom?.length) return [];

    const existing = await this.getPocEquipmentItems(pocId);
    const importedBomItemIds = new Set(existing.map((e) => e.source_bom_item_id).filter(Boolean));

    return analysis.bom
      .filter((item) => !importedBomItemIds.has(item.item_id))
      .map((item) => ({
        bom_item_id: item.item_id,
        equipment_name: item.equipment_name,
        manufacturer: item.manufacturer,
        part_number: item.part_number,
        quantity: item.quantity,
        specification: item.specification,
      }));
  }

  public async createPocEquipmentItem(
    pocId: string,
    item: {
      name: string;
      serial_number?: string;
      manufacturer?: string;
      part_number?: string;
      source_bom_item_id?: string;
      kb_match_count?: number;
    }
  ): Promise<PocEquipmentItem> {
    const e = await prisma.pocEquipmentItem.create({
      data: {
        id: randomId("equip"),
        tenantId: requireTenantId(),
        pocId,
        name: item.name,
        serialNumber: item.serial_number,
        manufacturer: item.manufacturer,
        partNumber: item.part_number,
        sourceBomItemId: item.source_bom_item_id,
        kbMatchCount: item.kb_match_count ?? 0,
      },
    });
    return mapPocEquipmentItem(e);
  }

  public async updatePocEquipmentItem(
    id: string,
    updates: {
      name?: string;
      serial_number?: string;
      status?: PocEquipmentItem["status"];
      kb_match_count?: number;
      datasheet_knowledge_base_document_id?: string;
      tracking_code?: string | null;
      tracking_carrier_status?: string | null;
      tracking_last_checked_at?: string | null;
    }
  ): Promise<PocEquipmentItem | undefined> {
    const exists = await prisma.pocEquipmentItem.findUnique({ where: { id } });
    if (!exists) return undefined;

    const e = await prisma.pocEquipmentItem.update({
      where: { id },
      data: {
        name: updates.name,
        serialNumber: updates.serial_number,
        status: updates.status,
        kbMatchCount: updates.kb_match_count,
        datasheetKnowledgeBaseDocumentId: updates.datasheet_knowledge_base_document_id,
        trackingCode: updates.tracking_code === undefined ? undefined : updates.tracking_code,
        trackingCarrierStatus: updates.tracking_carrier_status === undefined ? undefined : updates.tracking_carrier_status,
        trackingLastCheckedAt: updates.tracking_last_checked_at === undefined ? undefined : (updates.tracking_last_checked_at ? new Date(updates.tracking_last_checked_at) : null),
      },
    });
    return mapPocEquipmentItem(e);
  }

  public async deletePocEquipmentItem(id: string): Promise<boolean> {
    try {
      await prisma.pocEquipmentItem.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // Attaches invoice metadata after the file has already been written via the storage adapter
  // (server/utils/storage.ts) - this layer only persists the resulting path/provider/filename,
  // same division of responsibility as Document uploads in documents.ts.
  public async attachPocEquipmentInvoice(
    id: string,
    which: "shipping" | "return",
    file: { storage_provider: "local" | "s3" | "gcs"; storage_path: string; original_filename: string }
  ): Promise<PocEquipmentItem | undefined> {
    const exists = await prisma.pocEquipmentItem.findUnique({ where: { id } });
    if (!exists) return undefined;

    const e = await prisma.pocEquipmentItem.update({
      where: { id },
      data:
        which === "shipping"
          ? {
              shippingInvoiceStorageProvider: file.storage_provider,
              shippingInvoiceStoragePath: file.storage_path,
              shippingInvoiceOriginalFilename: file.original_filename,
            }
          : {
              returnInvoiceStorageProvider: file.storage_provider,
              returnInvoiceStoragePath: file.storage_path,
              returnInvoiceOriginalFilename: file.original_filename,
            },
    });
    return mapPocEquipmentItem(e);
  }

  // Raw (unmapped) lookup for the download route - needs the real storage_path/provider that
  // mapPocEquipmentItem deliberately excludes from the normal API payload (internal detail).
  public async getPocEquipmentInvoiceFile(
    id: string,
    which: "shipping" | "return"
  ): Promise<{ storage_provider: "local" | "s3" | "gcs"; storage_path: string; original_filename: string } | undefined> {
    const e = await prisma.pocEquipmentItem.findUnique({ where: { id } });
    if (!e) return undefined;

    const provider = which === "shipping" ? e.shippingInvoiceStorageProvider : e.returnInvoiceStorageProvider;
    const path = which === "shipping" ? e.shippingInvoiceStoragePath : e.returnInvoiceStoragePath;
    const filename = which === "shipping" ? e.shippingInvoiceOriginalFilename : e.returnInvoiceOriginalFilename;
    if (!provider || !path || !filename) return undefined;

    return { storage_provider: provider as "local" | "s3" | "gcs", storage_path: path, original_filename: filename };
  }

  // Poc tasks (Fase 6, Fase D) - single-predecessor FS dependency chain, critical path computed
  // on the frontend (small per-POC graph, no benefit to persisting it server-side).
  public async getPocTasks(pocId: string): Promise<PocTask[]> {
    const rows = await prisma.pocTask.findMany({
      where: { pocId },
      orderBy: { startDate: "asc" },
    });
    return rows.map(mapPocTask);
  }

  public async createPocTask(
    pocId: string,
    task: { name: string; start_date: string; duration_days: number; depends_on_task_id?: string; generated_by_ai?: boolean }
  ): Promise<PocTask> {
    const t = await prisma.pocTask.create({
      data: {
        id: randomId("pt"),
        tenantId: requireTenantId(),
        pocId,
        name: task.name,
        startDate: new Date(task.start_date),
        durationDays: task.duration_days,
        dependsOnTaskId: task.depends_on_task_id || null,
        generatedByAi: task.generated_by_ai ?? false,
      },
    });
    return mapPocTask(t);
  }

  public async updatePocTask(
    id: string,
    updates: {
      name?: string;
      start_date?: string;
      duration_days?: number;
      status?: PocTask["status"];
      depends_on_task_id?: string | null;
      edited_manually?: boolean;
    }
  ): Promise<PocTask | undefined> {
    const exists = await prisma.pocTask.findUnique({ where: { id } });
    if (!exists) return undefined;

    const t = await prisma.pocTask.update({
      where: { id },
      data: {
        name: updates.name,
        startDate: updates.start_date ? new Date(updates.start_date) : undefined,
        durationDays: updates.duration_days,
        status: updates.status,
        dependsOnTaskId: updates.depends_on_task_id === undefined ? undefined : updates.depends_on_task_id,
        editedManually: updates.edited_manually,
      },
    });
    return mapPocTask(t);
  }

  public async deletePocTask(id: string): Promise<boolean> {
    try {
      // Dependents pointing at this task get their dependsOnTaskId cleared (onDelete: SetNull in
      // the schema), not cascaded away - deleting one task shouldn't silently delete the rest of
      // the chain after it.
      await prisma.pocTask.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // Fase H: same regeneration safety as deleteUneditedAiPocTestCases - "Sugerir cronograma com IA"
  // only replaces drafts nobody has touched yet.
  public async deleteUneditedAiPocTasks(pocId: string): Promise<void> {
    await prisma.pocTask.deleteMany({
      where: { pocId, generatedByAi: true, editedManually: false },
    });
  }

  // Poc test cases (Fase 6, Fase E) - "IA rascunha, humano valida", same pattern already used in
  // the Proposal Studio: regenerable and editable, not a one-shot frozen record.
  public async getPocTestCases(pocId: string): Promise<PocTestCase[]> {
    const rows = await prisma.pocTestCase.findMany({
      where: { pocId },
      orderBy: { code: "asc" },
    });
    return rows.map(mapPocTestCase);
  }

  public async createPocTestCase(
    pocId: string,
    testCase: { code: string; title: string; objective: string; steps: string; expected_result: string; generated_by_ai?: boolean }
  ): Promise<PocTestCase> {
    const c = await prisma.pocTestCase.create({
      data: {
        id: randomId("tc"),
        tenantId: requireTenantId(),
        pocId,
        code: testCase.code,
        title: testCase.title,
        objective: testCase.objective,
        steps: testCase.steps,
        expectedResult: testCase.expected_result,
        generatedByAi: testCase.generated_by_ai ?? false,
      },
    });
    return mapPocTestCase(c);
  }

  public async updatePocTestCase(
    id: string,
    updates: { title?: string; objective?: string; steps?: string; expected_result?: string; status?: PocTestCase["status"]; edited_manually?: boolean }
  ): Promise<PocTestCase | undefined> {
    const exists = await prisma.pocTestCase.findUnique({ where: { id } });
    if (!exists) return undefined;

    const c = await prisma.pocTestCase.update({
      where: { id },
      data: {
        title: updates.title,
        objective: updates.objective,
        steps: updates.steps,
        expectedResult: updates.expected_result,
        status: updates.status,
        editedManually: updates.edited_manually,
      },
    });
    return mapPocTestCase(c);
  }

  public async deletePocTestCase(id: string): Promise<boolean> {
    try {
      await prisma.pocTestCase.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // Regenerating with AI only replaces drafts nobody has touched yet (generated_by_ai=true AND
  // edited_manually=false) - anything a human wrote from scratch or edited survives regeneration.
  public async deleteUneditedAiPocTestCases(pocId: string): Promise<void> {
    await prisma.pocTestCase.deleteMany({
      where: { pocId, generatedByAi: true, editedManually: false },
    });
  }

  // Poc final report (Fase M) - AI-generated questionnaire, same "IA rascunha, humano valida"
  // regeneration safety as PocTestCase/PocTask, except here what a human "edits" is filling in the
  // answer (the question itself is what the AI authored).
  public async getPocFinalReportQuestions(pocId: string): Promise<PocFinalReportQuestion[]> {
    const rows = await prisma.pocFinalReportQuestion.findMany({ where: { pocId }, orderBy: { order: "asc" } });
    return rows.map(mapPocFinalReportQuestion);
  }

  public async createPocFinalReportQuestion(
    pocId: string,
    q: { question: string; order: number; generated_by_ai?: boolean }
  ): Promise<PocFinalReportQuestion> {
    const created = await prisma.pocFinalReportQuestion.create({
      data: {
        id: randomId("frq"),
        tenantId: requireTenantId(),
        pocId,
        question: q.question,
        order: q.order,
        generatedByAi: q.generated_by_ai ?? false,
      },
    });
    return mapPocFinalReportQuestion(created);
  }

  public async updatePocFinalReportQuestion(
    id: string,
    updates: { answer?: string; edited_manually?: boolean }
  ): Promise<PocFinalReportQuestion | undefined> {
    const exists = await prisma.pocFinalReportQuestion.findUnique({ where: { id } });
    if (!exists) return undefined;
    const updated = await prisma.pocFinalReportQuestion.update({
      where: { id },
      data: { answer: updates.answer, editedManually: updates.edited_manually },
    });
    return mapPocFinalReportQuestion(updated);
  }

  public async deleteUneditedAiPocFinalReportQuestions(pocId: string): Promise<void> {
    await prisma.pocFinalReportQuestion.deleteMany({
      where: { pocId, generatedByAi: true, editedManually: false },
    });
  }

  // Poc acceptance (Fase 6, Fase F) - one row per POC (1:1), lazily created on first write since
  // most POCs live their whole life without a decision yet; getPocAcceptance returns undefined
  // rather than a row until something is actually recorded.
  public async getPocAcceptance(pocId: string): Promise<PocAcceptance | undefined> {
    const a = await prisma.pocAcceptance.findUnique({ where: { pocId } });
    return a ? mapPocAcceptance(a) : undefined;
  }

  // Deliberately not prisma.pocAcceptance.upsert() - same reason documented in detail on
  // saveAnalysisResult below: the tenant-scoping extension unconditionally adds `tenantId` to an
  // upsert's `where`, but this model's only unique constraint is `@@unique([pocId])` alone, so the
  // combined where matches no unique index and the extension hard-blocks the call outright
  // (confirmed live, 2026-07-14: every save/finalize on the acceptance panel was a 500, including
  // just toggling the won/lost decision off). findUnique+create/update sidesteps the extension's
  // upsert-specific handling entirely.
  public async upsertPocAcceptance(
    pocId: string,
    updates: {
      decision?: PocAcceptance["decision"];
      signed_by?: string;
      signed_at?: string;
      notes?: string;
      pending_approval?: boolean;
      approved_by_user_id?: string | null;
      approved_at?: string | null;
    }
  ): Promise<PocAcceptance> {
    const existing = await prisma.pocAcceptance.findUnique({ where: { pocId } });
    let a;
    if (existing) {
      a = await prisma.pocAcceptance.update({
        where: { pocId },
        data: {
          decision: updates.decision,
          signedBy: updates.signed_by,
          signedAt: updates.signed_at ? new Date(updates.signed_at) : undefined,
          notes: updates.notes,
          pendingApproval: updates.pending_approval,
          approvedByUserId: updates.approved_by_user_id === undefined ? undefined : updates.approved_by_user_id,
          approvedAt: updates.approved_at === undefined ? undefined : (updates.approved_at ? new Date(updates.approved_at) : null),
        },
      });
    } else {
      a = await prisma.pocAcceptance.create({
        data: {
          id: randomId("acc"),
          tenantId: requireTenantId(),
          pocId,
          decision: updates.decision || "pending",
          signedBy: updates.signed_by,
          signedAt: updates.signed_at ? new Date(updates.signed_at) : undefined,
          notes: updates.notes,
          pendingApproval: updates.pending_approval ?? false,
          approvedByUserId: updates.approved_by_user_id ?? undefined,
          approvedAt: updates.approved_at ? new Date(updates.approved_at) : undefined,
        },
      });
    }
    return mapPocAcceptance(a);
  }

  // Fase L: approving is the one place PocAcceptance and Poc.status change together - a
  // transaction so a POC can never end up "approved" without actually being marked completed (or
  // vice versa) if one write succeeded and the other didn't.
  public async approvePocAcceptance(pocId: string, approvedByUserId: string): Promise<PocAcceptance> {
    const [a] = await prisma.$transaction([
      prisma.pocAcceptance.update({
        where: { pocId },
        data: { pendingApproval: false, approvedByUserId, approvedAt: new Date() },
      }),
      prisma.poc.update({ where: { id: pocId }, data: { status: "completed" } }),
    ]);
    return mapPocAcceptance(a);
  }

  // Same reason as upsertPocAcceptance above - not prisma.pocAcceptance.upsert().
  public async attachPocAcceptanceDocument(
    pocId: string,
    file: { storage_provider: "local" | "s3" | "gcs"; storage_path: string; original_filename: string }
  ): Promise<PocAcceptance> {
    const existing = await prisma.pocAcceptance.findUnique({ where: { pocId } });
    const documentData = {
      signedDocumentStorageProvider: file.storage_provider,
      signedDocumentStoragePath: file.storage_path,
      signedDocumentOriginalFilename: file.original_filename,
    };
    let a;
    if (existing) {
      a = await prisma.pocAcceptance.update({ where: { pocId }, data: documentData });
    } else {
      a = await prisma.pocAcceptance.create({
        data: { id: randomId("acc"), tenantId: requireTenantId(), pocId, ...documentData },
      });
    }
    return mapPocAcceptance(a);
  }

  public async getPocAcceptanceDocumentFile(
    pocId: string
  ): Promise<{ storage_provider: "local" | "s3" | "gcs"; storage_path: string; original_filename: string } | undefined> {
    const a = await prisma.pocAcceptance.findUnique({ where: { pocId } });
    if (!a || !a.signedDocumentStorageProvider || !a.signedDocumentStoragePath || !a.signedDocumentOriginalFilename) return undefined;
    return {
      storage_provider: a.signedDocumentStorageProvider as "local" | "s3" | "gcs",
      storage_path: a.signedDocumentStoragePath,
      original_filename: a.signedDocumentOriginalFilename,
    };
  }

  // Documents
  public async getDocuments(projectId?: string): Promise<Document[]> {
    const docs = await prisma.document.findMany({
      where: projectId ? { projectId } : undefined,
      orderBy: { createdAt: "asc" },
    });
    return docs.map(mapDocument);
  }

  public async getDocument(id: string): Promise<Document | undefined> {
    const d = await prisma.document.findUnique({ where: { id } });
    return d ? mapDocument(d) : undefined;
  }

  public async addDocument(doc: Omit<Document, "id" | "created_at">): Promise<Document> {
    const d = await prisma.document.create({
      data: {
        id: randomId("doc"),
        tenantId: requireTenantId(),
        projectId: doc.project_id,
        filename: doc.filename,
        originalFilename: doc.original_filename,
        mimeType: doc.mime_type,
        fileSize: doc.file_size,
        storageProvider: doc.storage_provider,
        storagePath: doc.storage_path,
        detectedDocumentType: doc.detected_document_type,
        manualDocumentType: doc.manual_document_type,
        aiClassificationConfidence: doc.ai_classification_confidence,
        version: doc.version,
        language: doc.language,
        uploadedBy: doc.uploaded_by,
      },
    });
    return mapDocument(d);
  }

  public async updateDocument(id: string, updates: Partial<Document>): Promise<Document | undefined> {
    const exists = await prisma.document.findUnique({ where: { id } });
    if (!exists) return undefined;
    const d = await prisma.document.update({
      where: { id },
      data: {
        manualDocumentType: updates.manual_document_type,
        detectedDocumentType: updates.detected_document_type,
        originalFilename: updates.original_filename,
      },
    });
    return mapDocument(d);
  }

  public async deleteDocument(id: string): Promise<boolean> {
    try {
      // document_contents cascades via FK onDelete: Cascade
      await prisma.document.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // Document text content index
  public async getDocumentContent(documentId: string): Promise<string> {
    const row = await prisma.documentContent.findUnique({ where: { documentId } });
    return row?.content || "";
  }

  // Same reasoning as saveAnalysisResult above: avoids the tenant-scoping extension's upsert
  // handling, which appends `tenantId` to `where` and breaks the lookup for models whose only
  // unique constraint is a single non-tenant field (documentId's @id here).
  public async setDocumentContent(documentId: string, content: string): Promise<void> {
    const existing = await prisma.documentContent.findUnique({ where: { documentId } });
    if (existing) {
      await prisma.documentContent.update({ where: { documentId }, data: { content } });
    } else {
      await prisma.documentContent.create({ data: { documentId, tenantId: requireTenantId(), content } });
    }
  }

  // AI Analysis Results
  public async getAnalysisResult(projectId: string): Promise<AnalysisResult | undefined> {
    const a = await prisma.analysisResult.findUnique({ where: { projectId } });
    return a ? mapAnalysisResult(a) : undefined;
  }

  // Every analysis result for the tenant - used by the Home dashboard's real compliance
  // aggregation (previously a hardcoded 94.2%), only ever needs criticalRequirements so that's
  // all this fetches.
  public async getAllCriticalRequirements(): Promise<any[][]> {
    const rows = await prisma.analysisResult.findMany({ select: { criticalRequirements: true } });
    return rows.map((r) => (Array.isArray(r.criticalRequirements) ? (r.criticalRequirements as any[]) : []));
  }

  // Deliberately not prisma.analysisResult.upsert(): the tenant-scoping extension (src/prisma.ts)
  // unconditionally adds `tenantId` to an upsert's `where`, but this model's only unique
  // constraint is `@@unique([projectId])` alone - the combined {projectId, tenantId} `where` then
  // matches no unique index, Prisma can't locate the existing row, and silently falls onto the
  // `create` branch instead, which fails on the first genuinely required field it hits
  // (`executiveSummary`). Confirmed live: every requirement-notes/risk-mitigation/BOM edit was
  // hitting exactly this and failing with a 500, with the UI giving no indication anything had
  // gone wrong. findUnique+create/update sidesteps the extension's upsert-specific handling
  // entirely (its update path already tenant-scopes correctly via WHERE_MUTATION_OPS).
  public async saveAnalysisResult(result: AnalysisResult): Promise<void> {
    const existing = await prisma.analysisResult.findUnique({ where: { projectId: result.project_id } });
    const data = {
      jobId: result.job_id,
      executiveSummary: result.executive_summary as any,
      criticalRequirements: result.critical_requirements as any,
      risks: result.risks as any,
      opportunities: result.opportunities as any,
      bom: result.bom as any,
      pointToPointTable: result.point_to_point_table as any,
      preliminarySchedule: result.preliminary_schedule as any,
      clarificationQuestions: result.clarification_questions as any,
      technicalProposalDraft: result.technical_proposal_draft,
      commercialProposalDraft: result.commercial_proposal_draft,
      reviewStatus: result.review_status,
      approvedBy: result.approved_by,
      approvedAt: result.approved_at ? new Date(result.approved_at) : undefined,
      logicVersions: result.logic_versions === undefined ? undefined : (result.logic_versions as any),
    };

    if (existing) {
      await prisma.analysisResult.update({ where: { projectId: result.project_id }, data });
    } else {
      await prisma.analysisResult.create({
        data: {
          id: result.id || randomId("ar"),
          tenantId: requireTenantId(),
          projectId: result.project_id,
          ...data,
        },
      });
    }
  }

  // AI Jobs
  public async getJobs(): Promise<AIAnalysisJob[]> {
    return (await prisma.aIAnalysisJob.findMany({ orderBy: { startedAt: "desc" } })).map(mapJob);
  }

  public async createJob(job: Omit<AIAnalysisJob, "id">): Promise<AIAnalysisJob> {
    const j = await prisma.aIAnalysisJob.create({
      data: {
        id: randomId("job"),
        tenantId: requireTenantId(),
        projectId: job.project_id,
        status: job.status,
        aiProvider: job.ai_provider,
        aiModel: job.ai_model,
        promptTemplateVersion: job.prompt_template_version,
        startedAt: job.started_at ? new Date(job.started_at) : undefined,
        completedAt: job.completed_at ? new Date(job.completed_at) : undefined,
        errorMessage: job.error_message,
        tokenInput: job.token_input,
        tokenOutput: job.token_output,
        estimatedCost: job.estimated_cost,
        createdBy: job.created_by,
        correlationId: job.correlation_id,
      },
    });
    return mapJob(j);
  }

  public async updateJob(id: string, updates: Partial<AIAnalysisJob>): Promise<AIAnalysisJob | undefined> {
    const exists = await prisma.aIAnalysisJob.findUnique({ where: { id } });
    if (!exists) return undefined;
    const j = await prisma.aIAnalysisJob.update({
      where: { id },
      data: {
        status: updates.status,
        completedAt: updates.completed_at ? new Date(updates.completed_at) : undefined,
        errorMessage: updates.error_message,
        tokenInput: updates.token_input,
        tokenOutput: updates.token_output,
        estimatedCost: updates.estimated_cost,
      },
    });
    return mapJob(j);
  }

  // Proposals
  public async getProposals(projectId?: string): Promise<Proposal[]> {
    const rows = await prisma.proposal.findMany({
      where: projectId ? { projectId } : undefined,
      orderBy: { generatedAt: "desc" },
    });
    return rows.map(mapProposal);
  }

  public async getProposal(id: string): Promise<Proposal | undefined> {
    const p = await prisma.proposal.findUnique({ where: { id } });
    return p ? mapProposal(p) : undefined;
  }

  // PreSales F8: `proposal_group_id` é opcional no INPUT e obrigatório na coluna. Uma proposta
  // nova (nunca reaberta) é a cabeça da própria cadeia, então o grupo dela é o próprio id - e o id
  // precisa ser gerado ANTES do create para poder ser gravado nas duas colunas na mesma linha.
  // Quem reabre (POST /proposals/:id/reopen) passa o grupo da v1 explicitamente, e é assim que a
  // v2 entra na cadeia existente em vez de abrir uma nova.
  public async createProposal(
    prop: Omit<Proposal, "id" | "generated_at" | "proposal_group_id"> & { proposal_group_id?: string }
  ): Promise<Proposal> {
    const id = randomId("prop");
    const p = await prisma.proposal.create({
      data: {
        id,
        proposalGroupId: prop.proposal_group_id || id,
        previousVersionId: prop.previous_version_id ?? null,
        tenantId: requireTenantId(),
        projectId: prop.project_id,
        proposalType: prop.proposal_type,
        templateId: prop.template_id,
        templateVersion: prop.template_version,
        status: prop.status,
        language: prop.language,
        docxFilePath: prop.docx_file_path,
        pdfFilePath: prop.pdf_file_path,
        storageProvider: prop.storage_provider,
        generatedBy: prop.generated_by,
        version: prop.version,
        approvalWorkflowId: prop.approval_workflow_id,
        manualPricingTable: prop.manual_pricing_table as any,
        paymentTerms: prop.payment_terms,
        deliveryTerms: prop.delivery_terms,
        proposalValidity: prop.proposal_validity,
        commercialAssumptions: prop.commercial_assumptions,
        exclusions: prop.exclusions,
        editableContent: prop.editable_content,
      },
    });
    return mapProposal(p);
  }

  public async updateProposal(id: string, updates: Partial<Proposal>): Promise<Proposal | undefined> {
    const exists = await prisma.proposal.findUnique({ where: { id } });
    if (!exists) return undefined;
    const p = await prisma.proposal.update({
      where: { id },
      data: {
        status: updates.status,
        manualPricingTable: updates.manual_pricing_table as any,
        paymentTerms: updates.payment_terms,
        deliveryTerms: updates.delivery_terms,
        proposalValidity: updates.proposal_validity,
        commercialAssumptions: updates.commercial_assumptions,
        exclusions: updates.exclusions,
        docxFilePath: updates.docx_file_path,
        pdfFilePath: updates.pdf_file_path,
        storageProvider: updates.storage_provider,
        editableContent: updates.editable_content,
        // F6: `undefined` deixa o Prisma nao tocar a coluna (update parcial), enquanto `null`
        // limpa de verdade - a rota so envia o campo quando ele mudou.
        templateFieldValues: updates.template_field_values as any,
      },
    });
    return mapProposal(p);
  }

  public async updateProposalStatus(id: string, status: Proposal["status"]): Promise<Proposal | undefined> {
    try {
      const p = await prisma.proposal.update({ where: { id }, data: { status } });
      return mapProposal(p);
    } catch {
      return undefined;
    }
  }

  /**
   * Item 18: grava a resposta do CLIENTE numa proposta ja liberada.
   *
   * `where` com `clientDecision: null` NAO e enfeite: e o que torna a gravacao segura contra duas
   * pessoas registrando respostas diferentes ao mesmo tempo. Sem ele, o ultimo a escrever ganharia
   * em silencio e o evento errado ja teria ido para o CRM. Com ele, o segundo `updateMany` afeta
   * ZERO linhas e quem chamou sabe disso pelo retorno - e por isso o retorno e a contagem, nao a
   * linha.
   */
  public async registrarDecisaoDoCliente(
    id: string,
    decisao: "accepted" | "declined",
    usuarioId: string,
    motivo: string | null,
  ): Promise<number> {
    const r = await prisma.proposal.updateMany({
      where: { id, status: "released", clientDecision: null },
      data: {
        clientDecision: decisao,
        clientDecisionAt: new Date(),
        clientDecisionByUserId: usuarioId,
        clientDecisionNote: motivo,
      },
    });
    return r.count;
  }

  // Audit / Debug logs
  public async getAuditLogs(): Promise<AuditLog[]> {
    return (await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 1000 })).map(mapAuditLog);
  }

  // Real DB-level filtering/limit - the audit route used to fetch up to 1000 rows via
  // getAuditLogs() unconditionally and filter/search all of it in JS on every request, even for a
  // single user_id or a narrow date range. Same idea as the Knowledge Base entries pagination.
  public async queryAuditLogs(filters: {
    userId?: string;
    action?: string;
    entityType?: string;
    entityId?: string;
    projectId?: string;
    from?: Date;
    to?: Date;
    q?: string;
    limit?: number;
  }): Promise<AuditLog[]> {
    const rows = await prisma.auditLog.findMany({
      where: {
        userId: filters.userId,
        entityType: filters.entityType,
        entityId: filters.entityId,
        projectId: filters.projectId,
        action: filters.action ? { contains: filters.action, mode: "insensitive" } : undefined,
        createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
        OR: filters.q
          ? [
              { action: { contains: filters.q, mode: "insensitive" } },
              { entityType: { contains: filters.q, mode: "insensitive" } },
              { entityId: { contains: filters.q, mode: "insensitive" } },
              { userId: { contains: filters.q, mode: "insensitive" } },
              { metadata: { contains: filters.q, mode: "insensitive" } },
            ]
          : undefined,
      },
      orderBy: { createdAt: "desc" },
      take: filters.limit ?? 500,
    });
    return rows.map(mapAuditLog);
  }

  public async addAuditLog(log: Omit<AuditLog, "id" | "created_at">): Promise<void> {
    await prisma.auditLog.create({
      data: {
        id: randomId("aud"),
        tenantId: requireTenantId(),
        userId: log.user_id,
        action: log.action,
        entityType: log.entity_type,
        entityId: log.entity_id,
        projectId: log.project_id,
        ipAddress: log.ip_address,
        userAgent: log.user_agent,
        metadata: log.metadata,
      },
    });
  }

  // Explicit tenantId param, not the tenant-scoping Prisma extension's ALS-based auto-injection:
  // found while working on the Fleet Manager heartbeat (which had the same bug in an even more
  // exposed form - see getDebugLogsSince below) that this was the one call site actually reaching
  // the database unscoped. The extension's own auto-scoping is a silent pass-through when there's
  // no active ALS context (documented on TENANT_SCOPED_MODELS in src/prisma.ts) rather than a
  // throw, so a caller can't tell the difference between "correctly scoped" and "ALS context
  // wasn't there" from the result alone - passing tenantId explicitly here removes that ambiguity
  // for the one place (the admin console's own debug log viewer, requirePermission("admin:debug"))
  // where a silent unscoped fallback would mean any tenant's admin could browse every other
  // tenant's debug logs.
  public async getDebugLogs(tenantId: string): Promise<DebugLog[]> {
    return (await prisma.debugLog.findMany({ where: { tenantId }, orderBy: { timestamp: "desc" }, take: 1000 })).map(mapDebugLog);
  }

  // Used by the Fleet Manager heartbeat (server/utils/fleetLicense.ts's collectRecentLogs) to ship
  // this tenant's own recent diagnostic events - and only this tenant's. The previous
  // implementation called the untenanted getDebugLogs() above (cross-tenant, up to 1000 rows) and
  // filtered by "since" in JS afterwards - for a multi-tenant install, every tenant's heartbeat was
  // shipping every OTHER tenant's debug logs to the Fleet Manager too.
  //
  // warn/error/fatal are never truncated (an incident window is exactly when losing log lines
  // matters most); info/debug are capped to sampleLimit and only fill whatever budget remains -
  // the previous .filter().slice(0,100) applied that cut uniformly, silently dropping the oldest
  // events of a large batch regardless of severity.
  public async getDebugLogsSince(tenantId: string, since: Date, sampleLimit: number): Promise<DebugLog[]> {
    const priority = await prisma.debugLog.findMany({
      where: { tenantId, timestamp: { gt: since }, logLevel: { in: ["WARN", "ERROR", "FATAL"] } },
      orderBy: { timestamp: "desc" },
    });

    const remainingBudget = Math.max(sampleLimit - priority.length, 0);
    const sample = remainingBudget > 0
      ? await prisma.debugLog.findMany({
          where: { tenantId, timestamp: { gt: since }, logLevel: { in: ["INFO", "DEBUG", "TRACE"] } },
          orderBy: { timestamp: "desc" },
          take: remainingBudget,
        })
      : [];

    return [...priority, ...sample].map(mapDebugLog);
  }

  // Real counts for the system-status card - it only ever displayed .length, not read the
  // contents, so fetching up to 1000 full rows of each on every status check was pure waste.
  public async countAuditLogs(): Promise<number> {
    return prisma.auditLog.count();
  }

  public async countDebugLogs(): Promise<number> {
    return prisma.debugLog.count();
  }

  public async addDebugLog(log: Omit<DebugLog, "id" | "timestamp">): Promise<void> {
    await prisma.debugLog.create({
      data: {
        id: randomId("dbg"),
        // Prefer the caller's explicit tenant_id (usually read straight from the request's
        // x-tenant-id header, which is reliably present) over the AsyncLocalStorage-based
        // fallback - many debug-log call sites (the central error handler in particular) run
        // outside any active runWithTenant() context, so getCurrentTenantId() alone left this
        // column null far more often than the real tenant was actually known. Still nullable for
        // the genuine case of a diagnostic event before any tenant is known (e.g. failed login for
        // a nonexistent email).
        tenantId: log.tenant_id || getCurrentTenantId(),
        logLevel: log.log_level,
        serviceName: log.service_name,
        moduleName: log.module_name,
        environment: log.environment,
        correlationId: log.correlation_id,
        requestId: log.request_id,
        userId: log.user_id,
        projectId: log.project_id,
        documentId: log.document_id,
        analysisJobId: log.analysis_job_id,
        proposalId: log.proposal_id,
        operation: log.operation,
        message: log.message,
        status: log.status,
        durationMs: log.duration_ms,
        errorCode: log.error_code,
        errorMessage: log.error_message,
        safeMetadata: log.safe_metadata,
      },
    });
  }

  // Platform settings (singleton row)
  public async getSettings(): Promise<PlatformSettings> {
    const s = await prisma.platformSettings.findFirst();
    if (!s) throw new Error("Platform settings row missing - seed data was not migrated correctly.");
    return mapSettings(s);
  }

  // Phase 7 (fleet/license management): cross-tenant by design - called from the system-level
  // heartbeat scheduler (no request, no single tenant in context), never from a request handler.
  public async getAllTenantIdsWithFleetReportingEnabled(): Promise<string[]> {
    const rows = await prisma.platformSettings.findMany({ where: { fleetManagerEnabled: true }, select: { tenantId: true } });
    return rows.map((r) => r.tenantId);
  }

  public async updateSettings(updates: Partial<PlatformSettings>): Promise<PlatformSettings> {
    const current = await prisma.platformSettings.findFirst();
    if (!current) throw new Error("Platform settings row missing - seed data was not migrated correctly.");
    const s = await prisma.platformSettings.update({
      where: { id: current.id },
      data: {
        aiProvider: updates.ai_provider,
        defaultModel: updates.default_model,
        documentAnalysisModel: updates.document_analysis_model,
        proposalGenerationModel: updates.proposal_generation_model,
        aiApiKeyEncrypted: updates.ai_api_key_encrypted,
        openaiApiKeyEncrypted: updates.openai_api_key_encrypted,
        anthropicApiKeyEncrypted: updates.anthropic_api_key_encrypted,
        documentAnalysisProvider: updates.document_analysis_provider,
        criticalExtractionModel: updates.critical_extraction_model,
        criticalExtractionProvider: updates.critical_extraction_provider,
        webGroundingModel: updates.web_grounding_model,
        webGroundingProvider: updates.web_grounding_provider,
        proposalGenerationProvider: updates.proposal_generation_provider,
        specCopilotModel: updates.spec_copilot_model,
        specCopilotProvider: updates.spec_copilot_provider,
        documentClassificationModel: updates.document_classification_model,
        documentClassificationProvider: updates.document_classification_provider,
        pocTestGenerationModel: updates.poc_test_generation_model,
        pocTestGenerationProvider: updates.poc_test_generation_provider,
        pocScheduleGenerationModel: updates.poc_schedule_generation_model,
        pocScheduleGenerationProvider: updates.poc_schedule_generation_provider,
        pocFinalReportGenerationModel: updates.poc_final_report_generation_model,
        pocFinalReportGenerationProvider: updates.poc_final_report_generation_provider,
        proposalOpinionPanelModel: updates.proposal_opinion_panel_model,
        proposalOpinionPanelProvider: updates.proposal_opinion_panel_provider,
        pricingBudgetOptimizationModel: updates.pricing_budget_optimization_model,
        pricingBudgetOptimizationProvider: updates.pricing_budget_optimization_provider,
        pricingCatalogExtractionModel: updates.pricing_catalog_extraction_model,
        pricingCatalogExtractionProvider: updates.pricing_catalog_extraction_provider,
        proposalSectionRewriteModel: updates.proposal_section_rewrite_model,
        proposalSectionRewriteProvider: updates.proposal_section_rewrite_provider,
        proposalFindingRemediationModel: updates.proposal_finding_remediation_model,
        proposalFindingRemediationProvider: updates.proposal_finding_remediation_provider,
        proposalGrammarCheckModel: updates.proposal_grammar_check_model,
        proposalGrammarCheckProvider: updates.proposal_grammar_check_provider,
        proposalSectionCoherenceModel: updates.proposal_section_coherence_model,
        proposalSectionCoherenceProvider: updates.proposal_section_coherence_provider,
        proposalApproverBriefingModel: updates.proposal_approver_briefing_model,
        proposalApproverBriefingProvider: updates.proposal_approver_briefing_provider,
        monthlyCostCapUsd: updates.monthly_cost_cap_usd,
        fleetManagerUrl: updates.fleet_manager_url,
        fleetManagerApiKeyEncrypted: updates.fleet_manager_api_key_encrypted,
        fleetManagerEnabled: updates.fleet_manager_enabled,
        storageMode: updates.storage_mode,
        localStoragePath: updates.local_storage_path,
        s3Bucket: updates.s3_bucket,
        s3Region: updates.s3_region,
        s3AccessKeyId: updates.s3_access_key_id,
        s3SecretAccessKeyEncrypted: updates.s3_secret_access_key_encrypted,
        gcsBucket: updates.gcs_bucket,
        gcsProjectId: updates.gcs_project_id,
        gcsServiceAccountKeyEncrypted: updates.gcs_service_account_key_encrypted,
        defaultLanguage: updates.default_language,
        defaultLogLevel: updates.default_log_level,
      },
    });
    return mapSettings(s);
  }

  // ia_kb add-on billing snapshot - cached mirror refreshed on every Fleet Manager heartbeat
  // (server/utils/fleetLicense.ts). Not prisma.iaKbBillingSnapshot.upsert(): tenantId is this
  // model's own unique field, but the tenant-scoping extension (src/prisma.ts) still disallows
  // upsert() outright on every tenant-scoped model regardless - same findUnique()+create()/
  // update() pattern already used for PocAcceptance/AnalysisResult above.
  public async getIaKbBillingSnapshot(): Promise<IaKbBillingSnapshot | null> {
    const s = await prisma.iaKbBillingSnapshot.findFirst();
    return s ? mapIaKbBillingSnapshot(s) : null;
  }

  public async upsertIaKbBillingSnapshot(data: {
    markup_percent: number;
    cycle_start: string | null;
    cycle_billed_cost_usd: number;
    cycle_call_count: number;
    next_due_date: string | null;
  }): Promise<IaKbBillingSnapshot> {
    const tenantId = requireTenantId();
    const existing = await prisma.iaKbBillingSnapshot.findUnique({ where: { tenantId } });
    const now = new Date();
    let s;
    if (existing) {
      s = await prisma.iaKbBillingSnapshot.update({
        where: { tenantId },
        data: {
          markupPercent: data.markup_percent,
          cycleStart: data.cycle_start ? new Date(data.cycle_start) : null,
          cycleBilledCostUsd: data.cycle_billed_cost_usd,
          cycleCallCount: data.cycle_call_count,
          nextDueDate: data.next_due_date ? new Date(data.next_due_date) : null,
          lastSyncedAt: now,
        },
      });
    } else {
      s = await prisma.iaKbBillingSnapshot.create({
        data: {
          id: randomId("iakbs"),
          tenantId,
          markupPercent: data.markup_percent,
          cycleStart: data.cycle_start ? new Date(data.cycle_start) : null,
          cycleBilledCostUsd: data.cycle_billed_cost_usd,
          cycleCallCount: data.cycle_call_count,
          nextDueDate: data.next_due_date ? new Date(data.next_due_date) : null,
          lastSyncedAt: now,
        },
      });
    }
    return mapIaKbBillingSnapshot(s);
  }

  // ia_kb task config - the Fleet Manager's per-task provider/model choice, synced on every
  // heartbeat once the add-on is enabled. Full replace (delete-then-recreate), not per-row
  // upsert: the Fleet Manager always sends its complete current set, so a task the CMSaaS admin
  // no longer configures should stop overriding here too, not linger as a stale row.
  public async getAllIaKbTaskConfig(): Promise<IaKbTaskConfig[]> {
    const rows = await prisma.iaKbTaskConfig.findMany();
    return rows.map((r) => ({ task_type: r.taskType, provider: r.provider, model: r.model }));
  }

  public async replaceIaKbTaskConfig(configs: IaKbTaskConfig[]): Promise<void> {
    const tenantId = requireTenantId();
    await prisma.$transaction([
      prisma.iaKbTaskConfig.deleteMany({}),
      ...configs.map((c) =>
        prisma.iaKbTaskConfig.create({
          data: { id: randomId("iakbtc"), tenantId, taskType: c.task_type, provider: c.provider, model: c.model },
        })
      ),
    ]);
  }

  // Lazily bootstraps an active prompt row for a task type the very first time it's needed
  // (e.g. poc_test_generation, the moment a tenant's "poc" module entitlement is confirmed) -
  // seed.ts only ever runs once at initial install, so an add-on module enabled on an
  // already-running installation needs its own way to get its first active prompt row without a
  // manual migration step. No-op if a row for this type already exists (from either path).
  public async ensurePromptSeeded(params: {
    type: string;
    name: string;
    content: string;
    language: PromptTemplate["language"];
    version: string;
    created_by: string;
  }): Promise<void> {
    const existing = await prisma.promptTemplate.findFirst({ where: { type: params.type } });
    if (existing) return;

    await prisma.promptTemplate.create({
      data: {
        id: randomId("prm"),
        tenantId: requireTenantId(),
        name: params.name,
        type: params.type,
        content: params.content,
        language: params.language,
        version: params.version,
        isActive: true,
        createdBy: params.created_by,
      },
    });
  }

  // Prompt templates
  public async getPrompts(): Promise<PromptTemplate[]> {
    return (await prisma.promptTemplate.findMany({ orderBy: { createdAt: "desc" } })).map(mapPrompt);
  }

  // New version of an existing prompt type - never activated automatically, so drafting/reviewing
  // a new version never changes what the live analysis/classification pipeline actually uses until
  // someone explicitly calls setActivePromptVersion. Duplicate (type, version) is caught by the
  // @@unique constraint (P2002), surfaced by the route as a normal validation error.
  public async createPromptVersion(params: {
    name: string;
    type: string;
    content: string;
    language: PromptTemplate["language"];
    version: string;
    created_by: string;
  }): Promise<PromptTemplate> {
    const p = await prisma.promptTemplate.create({
      data: {
        id: randomId("prm"),
        tenantId: requireTenantId(),
        name: params.name,
        type: params.type,
        content: params.content,
        language: params.language,
        version: params.version,
        isActive: false,
        createdBy: params.created_by,
      },
    });
    return mapPrompt(p);
  }

  // Mutually exclusive per type: activating one version deactivates every other version of the
  // same type in the same transaction, so exactly one is ever active - the pipeline's
  // findFirst({isActive: true}) lookup (analysis.ts, documentClassification.ts) depends on this.
  public async setActivePromptVersion(id: string): Promise<PromptTemplate | undefined> {
    const target = await prisma.promptTemplate.findUnique({ where: { id } });
    if (!target) return undefined;

    await prisma.$transaction([
      prisma.promptTemplate.updateMany({
        where: { type: target.type, tenantId: target.tenantId },
        data: { isActive: false },
      }),
      prisma.promptTemplate.update({ where: { id }, data: { isActive: true } }),
    ]);

    const updated = await prisma.promptTemplate.findUnique({ where: { id } });
    return updated ? mapPrompt(updated) : undefined;
  }

  // Custom AI providers (on top of the 3 built-in ones) - any OpenAI-compatible endpoint
  // (Grok/xAI, DeepSeek, Mistral AI, Groq, Together AI, Fireworks, OpenRouter, etc.). The API key
  // is never returned in full - callers must build their own masked view, same as the 3 built-in
  // provider keys.
  public async getAiProviderConfigs() {
    const rows = await prisma.aiProviderConfig.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map((r) => ({
      id: r.id,
      provider_key: r.providerKey,
      display_name: r.displayName,
      base_url: r.baseUrl,
      api_key_encrypted: r.apiKeyEncrypted,
      default_model: r.defaultModel,
      supports_vision: r.supportsVision,
      supports_web_search: r.supportsWebSearch,
      created_at: r.createdAt,
    }));
  }

  public async createAiProviderConfig(params: {
    provider_key: string;
    display_name: string;
    base_url: string;
    api_key_encrypted: string;
    default_model: string;
    supports_vision: boolean;
    supports_web_search: boolean;
  }) {
    const row = await prisma.aiProviderConfig.create({
      data: {
        id: randomId("aipc"),
        tenantId: requireTenantId(),
        providerKey: params.provider_key,
        displayName: params.display_name,
        baseUrl: params.base_url,
        apiKeyEncrypted: params.api_key_encrypted,
        defaultModel: params.default_model,
        supportsVision: params.supports_vision,
        supportsWebSearch: params.supports_web_search,
      },
    });
    return {
      id: row.id,
      provider_key: row.providerKey,
      display_name: row.displayName,
      base_url: row.baseUrl,
      default_model: row.defaultModel,
      supports_vision: row.supportsVision,
      supports_web_search: row.supportsWebSearch,
      created_at: row.createdAt,
    };
  }

  public async deleteAiProviderConfig(id: string): Promise<void> {
    await prisma.aiProviderConfig.delete({ where: { id } });
  }

  public async updatePrompt(id: string, updates: Partial<PromptTemplate>): Promise<PromptTemplate | undefined> {
    const exists = await prisma.promptTemplate.findUnique({ where: { id } });
    if (!exists) return undefined;
    const p = await prisma.promptTemplate.update({
      where: { id },
      data: {
        content: updates.content,
        language: updates.language,
        isActive: updates.is_active,
        name: updates.name,
        type: updates.type,
        version: updates.version,
      },
    });
    return mapPrompt(p);
  }

  // Proposal templates
  public async getProposalTemplates(): Promise<ProposalTemplate[]> {
    return (await prisma.proposalTemplate.findMany()).map(mapProposalTemplate);
  }

  public async createProposalTemplate(
    tpl: Omit<ProposalTemplate, "id" | "created_at" | "updated_at">
  ): Promise<ProposalTemplate> {
    const t = await prisma.proposalTemplate.create({
      data: {
        id: randomId("tpl"),
        tenantId: requireTenantId(),
        name: tpl.name,
        description: tpl.description,
        templateType: tpl.template_type,
        language: tpl.language,
        fileType: tpl.file_type,
        filePath: tpl.file_path,
        storageProvider: tpl.storage_provider,
        variablesSchema: tpl.variables_schema,
        version: tpl.version,
        active: tpl.active,
        defaultTemplate: tpl.default_template,
        uploadedBy: tpl.uploaded_by,
      },
    });
    return mapProposalTemplate(t);
  }

  public async updateProposalTemplate(id: string, updates: Partial<ProposalTemplate>): Promise<ProposalTemplate | undefined> {
    const exists = await prisma.proposalTemplate.findUnique({ where: { id } });
    if (!exists) return undefined;
    const t = await prisma.proposalTemplate.update({
      where: { id },
      data: {
        name: updates.name,
        description: updates.description,
        active: updates.active,
        filePath: updates.file_path,
        fileType: updates.file_type,
        storageProvider: updates.storage_provider,
        variablesSchema: updates.variables_schema,
      },
    });
    return mapProposalTemplate(t);
  }

  public async setDefaultProposalTemplate(id: string): Promise<ProposalTemplate | undefined> {
    const target = await prisma.proposalTemplate.findUnique({ where: { id } });
    if (!target) return undefined;

    await prisma.$transaction([
      prisma.proposalTemplate.updateMany({
        where: { templateType: target.templateType, id: { not: id } },
        data: { defaultTemplate: false },
      }),
      prisma.proposalTemplate.update({
        where: { id },
        data: { active: true, defaultTemplate: true },
      }),
    ]);

    const updated = await prisma.proposalTemplate.findUnique({ where: { id } });
    return updated ? mapProposalTemplate(updated) : undefined;
  }

  public async deleteProposalTemplate(id: string): Promise<boolean> {
    const target = await prisma.proposalTemplate.findUnique({ where: { id } });
    if (!target) return false;

    const isInUse = await prisma.proposal.count({ where: { templateId: id } });
    if (isInUse > 0) return false;

    await prisma.proposalTemplate.delete({ where: { id } });

    if (target.defaultTemplate) {
      const replacement = await prisma.proposalTemplate.findFirst({
        where: { templateType: target.templateType, active: true },
      });
      if (replacement) {
        await prisma.proposalTemplate.update({ where: { id: replacement.id }, data: { defaultTemplate: true } });
      }
    }

    return true;
  }

  // Approval workflows
  public async getApprovalWorkflows(): Promise<ApprovalWorkflow[]> {
    const rows = await prisma.approvalWorkflow.findMany({ include: { stages: true } });
    return rows.map(mapWorkflow);
  }

  public async createApprovalWorkflow(workflow: any): Promise<ApprovalWorkflow> {
    const id = randomId("w");
    // Nested creates aren't seen by the Prisma tenant-scoping extension (it only
    // intercepts top-level model operations), so tenantId has to be set explicitly here.
    const tenantId = getCurrentTenantId();
    const stages = (workflow.stages || []).map((stage: any, index: number) => ({
      id: stage.id || `${id}-s${index + 1}`,
      tenantId,
      name: stage.name,
      order: index + 1,
      approverType: stage.approver_type,
      approverUserId: stage.approver_user_id || null,
      approverRoleId: stage.approver_role_id || null,
      mandatory: stage.mandatory ?? true,
      conditions: stage.conditions || "Always mandatory",
    }));

    const w = await prisma.approvalWorkflow.create({
      data: {
        id,
        tenantId: requireTenantId(),
        name: workflow.name,
        description: workflow.description,
        active: workflow.active ?? true,
        appliesTo: workflow.applies_to,
        stages: { create: stages },
      },
      include: { stages: true },
    });
    return mapWorkflow(w);
  }

  public async updateApprovalWorkflow(id: string, updates: any): Promise<ApprovalWorkflow | undefined> {
    const exists = await prisma.approvalWorkflow.findUnique({ where: { id } });
    if (!exists) return undefined;

    await prisma.$transaction(async (tx) => {
      await tx.approvalWorkflow.update({
        where: { id },
        data: { name: updates.name, description: updates.description, active: updates.active, appliesTo: updates.applies_to },
      });

      if (updates.stages) {
        await tx.approvalStage.deleteMany({ where: { workflowId: id } });
        await tx.approvalStage.createMany({
          data: updates.stages.map((stage: any, index: number) => ({
            id: stage.id || `${id}-s${index + 1}`,
            workflowId: id,
            name: stage.name,
            order: index + 1,
            approverType: stage.approver_type,
            approverUserId: stage.approver_user_id || null,
            approverRoleId: stage.approver_role_id || null,
            mandatory: stage.mandatory ?? true,
            conditions: stage.conditions || "Always mandatory",
          })),
        });
      }
    });

    const w = await prisma.approvalWorkflow.findUnique({ where: { id }, include: { stages: true } });
    return w ? mapWorkflow(w) : undefined;
  }

  public async deleteApprovalWorkflow(id: string): Promise<boolean> {
    const exists = await prisma.approvalWorkflow.findUnique({ where: { id } });
    if (!exists) return false;

    const usedByProject = await prisma.project.count({ where: { selectedApprovalWorkflowId: id } });
    const usedByProposal = await prisma.proposal.count({ where: { approvalWorkflowId: id } });
    if (usedByProject > 0 || usedByProposal > 0) return false;

    await prisma.approvalWorkflow.delete({ where: { id } });
    return true;
  }

  public async createApprovalDecision(decision: Omit<ApprovalDecision, "id" | "created_at">): Promise<ApprovalDecision> {
    const dec = await prisma.approvalDecision.create({
      data: {
        id: randomId("dec"),
        tenantId: requireTenantId(),
        proposalId: decision.proposal_id,
        stageId: decision.stage_id,
        approverUserId: decision.approver_user_id,
        decision: decision.decision,
        comments: decision.comments,
      },
    });
    return mapDecision(dec);
  }

  public async getApprovalDecisions(): Promise<ApprovalDecision[]> {
    return (await prisma.approvalDecision.findMany({ orderBy: { createdAt: "desc" } })).map(mapDecision);
  }

  public async getApprovalDecision(proposalId: string, stageId: string): Promise<ApprovalDecision | undefined> {
    const dec = await prisma.approvalDecision.findFirst({ where: { proposalId, stageId } });
    return dec ? mapDecision(dec) : undefined;
  }

  public async getApprovalDecisionsForProposal(proposalId: string): Promise<ApprovalDecision[]> {
    return (await prisma.approvalDecision.findMany({ where: { proposalId } })).map(mapDecision);
  }

  // Conversation history
  public async getConversationHistory(projectId: string): Promise<ConversationMessage[]> {
    return (
      await prisma.conversationMessage.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } })
    ).map(mapConversation);
  }

  public async addConversationMessage(msg: Omit<ConversationMessage, "id" | "created_at">): Promise<ConversationMessage> {
    const c = await prisma.conversationMessage.create({
      data: {
        id: randomId("msg"),
        tenantId: requireTenantId(),
        projectId: msg.project_id,
        userId: msg.user_id,
        role: msg.role,
        message: msg.message,
        aiProvider: msg.ai_provider,
        aiModel: msg.ai_model,
        promptTemplateVersion: msg.prompt_template_version,
        inputSummary: msg.input_summary,
        outputSummary: msg.output_summary,
        tokenInput: msg.token_input,
        tokenOutput: msg.token_output,
      },
    });
    return mapConversation(c);
  }

  // Integrations
  public async getIntegrations(): Promise<IntegrationConnector[]> {
    return (await prisma.integrationConnector.findMany()).map(mapIntegration);
  }

  public async updateIntegration(id: string, updates: Partial<IntegrationConnector> & { api_key?: string; webhook_secret?: string }): Promise<IntegrationConnector | undefined> {
    const exists = await prisma.integrationConnector.findUnique({ where: { id } });
    if (!exists) return undefined;
    const i = await prisma.integrationConnector.update({
      where: { id },
      data: {
        name: updates.name,
        type: updates.type,
        status: updates.status,
        configuration: updates.configuration,
        apiKeyEncrypted: updates.api_key,
        webhookSecretEncrypted: updates.webhook_secret,
        lastSyncStatus: updates.last_sync_status,
        lastSyncDate: updates.last_sync_date ? new Date(updates.last_sync_date) : undefined,
        errorMessage: updates.error_message,
      },
    });
    return mapIntegration(i);
  }

  public async addIntegration(conn: Omit<IntegrationConnector, "id" | "created_at" | "updated_at"> & { api_key?: string; webhook_secret?: string }): Promise<IntegrationConnector> {
    const i = await prisma.integrationConnector.create({
      data: {
        id: randomId("int"),
        tenantId: requireTenantId(),
        name: conn.name,
        type: conn.type,
        status: conn.status,
        configuration: conn.configuration,
        apiKeyEncrypted: conn.api_key,
        webhookSecretEncrypted: conn.webhook_secret,
        lastSyncStatus: conn.last_sync_status,
        lastSyncDate: conn.last_sync_date ? new Date(conn.last_sync_date) : undefined,
        errorMessage: conn.error_message,
      },
    });
    return mapIntegration(i);
  }

  public async deleteIntegration(id: string): Promise<boolean> {
    try {
      await prisma.integrationConnector.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // Knowledge Base - both entries (trigger/knowledge pairs) and the reference documents
  // (datasheets/catalogs) uploaded to proactively seed them. Deliberately no .upsert() anywhere
  // here - see saveAnalysisResult's comment above for why that's unsafe on this tenant-scoping
  // setup for models without a tenant-inclusive unique constraint (neither of these have one).
  // page/limit are optional on purpose: callers that need the *entire* matching set (e.g.
  // analysis.ts injecting all approved knowledge into the analysis prompt) omit them and get
  // every row back; the paginated list UI passes both.
  public async getKnowledgeBaseEntries(filters?: {
    status?: string;
    category?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{ entries: KnowledgeBaseEntry[]; total: number }> {
    const search = filters?.search?.trim();
    const where = {
      ...(filters?.status ? { status: filters.status as any } : {}),
      ...(filters?.category ? { category: filters.category as any } : {}),
      ...(search
        ? {
            OR: [
              { trigger: { contains: search, mode: "insensitive" as const } },
              { knowledge: { contains: search, mode: "insensitive" as const } },
              { sourceProjectName: { contains: search, mode: "insensitive" as const } },
              { sourceDocumentName: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const limit = filters?.limit && filters.limit > 0 ? filters.limit : undefined;
    const page = filters?.page && filters.page > 0 ? filters.page : 1;

    const [rows, total] = await Promise.all([
      prisma.knowledgeBaseEntry.findMany({
        where,
        orderBy: { createdAt: "desc" },
        ...(limit ? { skip: (page - 1) * limit, take: limit } : {}),
      }),
      prisma.knowledgeBaseEntry.count({ where }),
    ]);
    return { entries: rows.map(mapKnowledgeBaseEntry), total };
  }

  public async getKnowledgeBaseEntryCounts(): Promise<{ pending: number; approved: number; rejected: number }> {
    const [pending, approved, rejected] = await Promise.all([
      prisma.knowledgeBaseEntry.count({ where: { status: "pending" } }),
      prisma.knowledgeBaseEntry.count({ where: { status: "approved" } }),
      prisma.knowledgeBaseEntry.count({ where: { status: "rejected" } }),
    ]);
    return { pending, approved, rejected };
  }

  public async getKnowledgeBaseEntry(id: string): Promise<KnowledgeBaseEntry | undefined> {
    const e = await prisma.knowledgeBaseEntry.findUnique({ where: { id } });
    return e ? mapKnowledgeBaseEntry(e) : undefined;
  }

  // Only approved entries are ever surfaced to the analysis prompt (see analysis.ts's
  // extractKnowledgeBaseKeywords) - a simple ILIKE-based relevance match against trigger AND
  // knowledge since there's no full-text/vector search infra in place yet; good enough at the
  // volumes a single tenant's reviewed knowledge base will realistically reach, and now actually
  // wired up (this used to be dead code - every approved entry was sent unconditionally instead).
  public async searchApprovedKnowledgeBase(keywords: string[], limit = 30): Promise<KnowledgeBaseEntry[]> {
    if (keywords.length === 0) return [];
    // No `take` at the DB level here on purpose: with a broad OR across many keywords, ordering by
    // createdAt and cutting off at `limit` let recent-but-barely-relevant entries crowd out older
    // entries that actually match far more of the keywords (confirmed: a PTZ camera BOM item's
    // union of keywords matched enough generic ITS entries to fill the whole `limit` before the
    // specific Hikvision camera entries - which matched several more keywords each - were ever
    // considered). Approved-entry volume is small enough (low hundreds) that fetching every
    // matching row and ranking by actual keyword-match count in JS is cheap and far more correct.
    const rows = await prisma.knowledgeBaseEntry.findMany({
      where: {
        status: "approved",
        OR: keywords.flatMap((kw) => [
          { trigger: { contains: kw, mode: "insensitive" as const } },
          { knowledge: { contains: kw, mode: "insensitive" as const } },
        ]),
      },
      orderBy: { createdAt: "desc" },
    });

    // Plain match-count scoring (one point per matched keyword, regardless of which keyword) rates
    // generic jargon shared by every product in a category ("câmera", "zoom", "tipo", "resolução")
    // the same as genuinely distinctive terms ("poste", "DAI", a specific SKU) - so whichever
    // competing product's datasheet happens to repeat more generic jargon per row (or, tried next,
    // has more total rows to sum across) wins, regardless of whether it's actually the right
    // product for the item's stated use. Confirmed on two real, different failure modes for the
    // same pole-mounted-camera BOM item: (1) per-row count let a vehicle-mounted "mobile
    // enforcement" camera's generic-heavy entries outrank a fixed pole-mount speed dome's atomic
    // ones; (2) summing per-row scores within a sourceDocumentId group (an earlier attempt at
    // fixing (1)) just swapped which wrong product won, since it now favored whichever product
    // happened to have the MOST total ingested rows rather than the most relevant ones.
    // IDF-style weighting fixes both at once without needing any grouping: a keyword's weight is
    // inverse to how many of THIS query's own candidate rows contain it, so "poste" (rare - a
    // handful of rows) counts far more than "câmera"/"zoom" (common - most rows), and the score no
    // longer scales with how many rows a product happens to have.
    const lowerKeywords = keywords.map((kw) => kw.toLowerCase());
    const haystacks = rows.map((row) => `${row.trigger} ${row.knowledge}`.toLowerCase());
    const keywordWeights = new Map<string, number>(
      lowerKeywords.map((kw) => {
        const docFreq = haystacks.reduce((acc, h) => acc + (h.includes(kw) ? 1 : 0), 0);
        return [kw, docFreq > 0 ? 1 / docFreq : 0];
      })
    );
    const scored = rows.map((row, i) => {
      const haystack = haystacks[i];
      const score = lowerKeywords.reduce((acc, kw) => acc + (haystack.includes(kw) ? keywordWeights.get(kw)! : 0), 0);
      return { row, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);

    // Métrica leve de uso - só sobre as linhas que de fato voltaram no resultado, não sobre todo
    // candidato considerado. Fire-and-forget: não atrasa a resposta da busca, e uma falha aqui
    // não deve derrubar a análise que está chamando isso.
    if (top.length > 0) {
      prisma.knowledgeBaseEntry
        .updateMany({
          where: { id: { in: top.map((s) => s.row.id) } },
          data: { matchCount: { increment: 1 }, lastMatchedAt: new Date() },
        })
        .catch((err) => console.warn("Failed to update knowledge base entry match metrics", err));
    }

    return top.map((s) => mapKnowledgeBaseEntry(s.row));
  }

  // Used by BOM enrichment's context-mismatch check (see enrichBomWithWebSearch) to see a
  // product's FULL disclosed context (e.g. "mobile enforcement system... viaturas policiais"),
  // not just whichever of that product's entries happened to keyword-match a specific BOM item -
  // a product's mobile/vehicle-mounted nature is often stated in only one of its many atomic KB
  // entries, and that one entry may not itself contain the specific item's own search keywords.
  public async getApprovedKnowledgeBaseEntriesByDocument(sourceDocumentIds: string[]): Promise<KnowledgeBaseEntry[]> {
    if (sourceDocumentIds.length === 0) return [];
    const rows = await prisma.knowledgeBaseEntry.findMany({
      where: { status: "approved", sourceDocumentId: { in: sourceDocumentIds } },
    });
    return rows.map(mapKnowledgeBaseEntry);
  }

  public async createKnowledgeBaseEntry(entry: Omit<KnowledgeBaseEntry, "id" | "created_at">): Promise<KnowledgeBaseEntry> {
    const e = await prisma.knowledgeBaseEntry.create({
      data: {
        id: randomId("kbe"),
        tenantId: requireTenantId(),
        category: entry.category as any,
        trigger: entry.trigger,
        knowledge: entry.knowledge,
        status: entry.status as any,
        source: entry.source as any,
        sourceProjectId: entry.source_project_id,
        sourceProjectName: entry.source_project_name,
        sourceDocumentId: entry.source_document_id,
        sourceDocumentName: entry.source_document_name,
        createdBy: entry.created_by,
        reviewedBy: entry.reviewed_by,
        reviewedAt: entry.reviewed_at ? new Date(entry.reviewed_at) : undefined,
        fleetGlobalEntryId: entry.fleet_global_entry_id,
      },
    });
    return mapKnowledgeBaseEntry(e);
  }

  // Entries this tenant created locally (never ones already sourced from the Fleet Manager, which
  // never sync back up) that are approved and haven't been uploaded yet - see
  // server/utils/fleetLicense.ts, called once per heartbeat.
  public async getKnowledgeBaseEntriesToSync(limit = 50): Promise<KnowledgeBaseEntry[]> {
    const rows = await prisma.knowledgeBaseEntry.findMany({
      where: { status: "approved", source: { not: "fleet_manager_global" }, syncedToFleetAt: null },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    return rows.map(mapKnowledgeBaseEntry);
  }

  public async markKnowledgeBaseEntriesSynced(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await prisma.knowledgeBaseEntry.updateMany({ where: { id: { in: ids } }, data: { syncedToFleetAt: new Date() } });
  }

  // Triggered by the Fleet Manager's force_kb_sync command (see fleetLicense.ts) - clears every
  // locally-approved entry's sync marker so getKnowledgeBaseEntriesToSync picks all of them up
  // again on the next heartbeat, not just ones approved since the last sync.
  public async resetKnowledgeBaseSyncCursor(): Promise<void> {
    await prisma.knowledgeBaseEntry.updateMany({
      where: { status: "approved", source: { not: "fleet_manager_global" } },
      data: { syncedToFleetAt: null },
    });
  }

  // findFirst, not findUnique: fleetGlobalEntryId isn't @unique on its own (see the schema
  // comment - a single physical install can host multiple tenants, each legitimately able to
  // receive the same global entry id). The tenant-scoping extension (src/prisma.ts) still injects
  // tenantId into this filter automatically.
  public async findKnowledgeBaseEntryByFleetGlobalId(fleetGlobalEntryId: string): Promise<KnowledgeBaseEntry | undefined> {
    const e = await prisma.knowledgeBaseEntry.findFirst({ where: { fleetGlobalEntryId } });
    return e ? mapKnowledgeBaseEntry(e) : undefined;
  }

  // Used only by the incoming-entry reconciliation check (server/utils/knowledgeBaseReconciliation.ts)
  // to find candidate entries a newly-received global entry might duplicate or contradict - unlike
  // searchApprovedKnowledgeBase above, deliberately NOT status-filtered (a pending entry can still
  // be a real duplicate/contradiction) but IS category-filtered (comparing across categories, e.g.
  // a part number against an engineering note, is never meaningful).
  public async searchKnowledgeBaseByCategory(category: string, keywords: string[], limit = 10): Promise<KnowledgeBaseEntry[]> {
    if (keywords.length === 0) return [];
    const rows = await prisma.knowledgeBaseEntry.findMany({
      where: {
        category: category as any,
        OR: keywords.flatMap((kw) => [
          { trigger: { contains: kw, mode: "insensitive" as const } },
          { knowledge: { contains: kw, mode: "insensitive" as const } },
        ]),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(mapKnowledgeBaseEntry);
  }

  public async updateKnowledgeBaseEntry(id: string, updates: Partial<KnowledgeBaseEntry>): Promise<KnowledgeBaseEntry | undefined> {
    const exists = await prisma.knowledgeBaseEntry.findUnique({ where: { id } });
    if (!exists) return undefined;
    const e = await prisma.knowledgeBaseEntry.update({
      where: { id },
      data: {
        trigger: updates.trigger,
        knowledge: updates.knowledge,
        status: updates.status as any,
        reviewedBy: updates.reviewed_by,
        reviewedAt: updates.reviewed_at ? new Date(updates.reviewed_at) : undefined,
      },
    });
    return mapKnowledgeBaseEntry(e);
  }

  public async getKnowledgeBaseDocuments(): Promise<KnowledgeBaseDocument[]> {
    const rows = await prisma.knowledgeBaseDocument.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map(mapKnowledgeBaseDocument);
  }

  public async getKnowledgeBaseDocument(id: string): Promise<KnowledgeBaseDocument | undefined> {
    const d = await prisma.knowledgeBaseDocument.findUnique({ where: { id } });
    return d ? mapKnowledgeBaseDocument(d) : undefined;
  }

  public async findKnowledgeBaseDocumentByHash(contentHash: string): Promise<KnowledgeBaseDocument | undefined> {
    const d = await prisma.knowledgeBaseDocument.findFirst({ where: { contentHash }, orderBy: { createdAt: "desc" } });
    return d ? mapKnowledgeBaseDocument(d) : undefined;
  }

  public async createKnowledgeBaseDocument(doc: Omit<KnowledgeBaseDocument, "id" | "created_at">): Promise<KnowledgeBaseDocument> {
    const d = await prisma.knowledgeBaseDocument.create({
      data: {
        id: randomId("kbd"),
        tenantId: requireTenantId(),
        filename: doc.filename,
        originalFilename: doc.original_filename,
        mimeType: doc.mime_type,
        fileSize: doc.file_size,
        storageProvider: doc.storage_provider as any,
        storagePath: doc.storage_path,
        uploadedBy: doc.uploaded_by,
        contentHash: doc.content_hash,
      },
    });
    return mapKnowledgeBaseDocument(d);
  }

  public async markKnowledgeBaseDocumentAnalyzed(id: string): Promise<void> {
    const exists = await prisma.knowledgeBaseDocument.findUnique({ where: { id } });
    if (!exists) return;
    await prisma.knowledgeBaseDocument.update({ where: { id }, data: { analyzedAt: new Date() } });
  }

  public async deleteKnowledgeBaseDocument(id: string): Promise<boolean> {
    try {
      await prisma.knowledgeBaseDocument.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // Lean summary for the admin diagnostics export - real counts (prisma .count(), not fetching
  // every row just to read .length) for everything the report only ever shows a total for, and a
  // bounded last-100 query (not the full up-to-1000 getAuditLogs()/getDebugLogs() sliced down
  // afterward) for the two logs the report actually lists in full. Previously fetched every table
  // in the schema - including several (roles, analysisResults, conversationHistory,
  // promptTemplates, approvalWorkflows/decisions, tasks, the report never even
  // read.
  public async getDiagnosticSummary() {
    const [
      projectsCount, documentsCount, jobsCount, proposalsCount, usersCount,
      platformSettings, integrationConnectors, debugLogs, auditLogs,
    ] = await Promise.all([
      prisma.project.count(),
      prisma.document.count(),
      prisma.aIAnalysisJob.count(),
      prisma.proposal.count(),
      prisma.user.count(),
      this.getSettings(),
      this.getIntegrations(),
      prisma.debugLog.findMany({ orderBy: { timestamp: "desc" }, take: 100 }).then((rows) => rows.map(mapDebugLog)),
      prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }).then((rows) => rows.map(mapAuditLog)),
    ]);

    return {
      projectsCount, documentsCount, jobsCount, proposalsCount, usersCount,
      platformSettings, integrationConnectors, debugLogs, auditLogs,
    };
  }
}

export const dbStore = new DBStore();
