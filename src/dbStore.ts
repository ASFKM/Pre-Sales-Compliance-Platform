import { prisma } from "./prisma";
import { getCurrentTenantId } from "./tenantContext";
import {
  User,
  UserStatus,
  Role,
  Project,
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
  Task,
  BrandingSettings,
  IntegrationConnector,
  TeamMembership,
  KnowledgeBaseEntry,
  KnowledgeBaseDocument,
} from "./types";

function randomId(prefix: string): string {
  return `${prefix}_` + Math.random().toString(36).substring(2, 11);
}

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
    status: u.status,
    role_id: u.roleId,
    created_at: u.createdAt.toISOString(),
    updated_at: u.updatedAt.toISOString(),
    last_login_at: u.lastLoginAt ? u.lastLoginAt.toISOString() : undefined,
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
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  } as Project;
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

function mapBranding(b: any): BrandingSettings {
  return {
    id: b.id,
    company_name: b.companyName,
    company_logo_path: b.companyLogoPath,
    login_logo_path: b.loginLogoPath,
    sidebar_logo_path: b.sidebarLogoPath,
    report_logo_path: b.reportLogoPath,
    favicon_path: b.faviconPath,
    primary_color: b.primaryColor,
    secondary_color: b.secondaryColor,
    accent_color: b.accentColor,
    background_color: b.backgroundColor,
    text_color: b.textColor,
    font_family: b.fontFamily,
    border_radius: b.borderRadius,
    button_style: b.buttonStyle,
    default_theme: b.defaultTheme,
    custom_css_variables: b.customCssVariables,
    footer_text: b.footerText,
    support_contact: b.supportContact,
    legal_text: b.legalText,
    created_at: b.createdAt.toISOString(),
    updated_at: b.updatedAt.toISOString(),
  } as BrandingSettings;
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
    generated_by: p.generatedBy,
    generated_at: p.generatedAt.toISOString(),
    version: p.version,
    approval_workflow_id: p.approvalWorkflowId,
    manual_pricing_table: p.manualPricingTable ?? undefined,
    payment_terms: p.paymentTerms ?? undefined,
    delivery_terms: p.deliveryTerms ?? undefined,
    proposal_validity: p.proposalValidity ?? undefined,
    commercial_assumptions: p.commercialAssumptions ?? undefined,
    exclusions: p.exclusions ?? undefined,
    editable_content: p.editableContent ?? undefined,
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

function mapTask(t: any): Task {
  return {
    id: t.id,
    project_id: t.projectId,
    title: t.title,
    description: t.description,
    owner_user_id: t.ownerUserId,
    due_date: t.dueDate.toISOString().substring(0, 10),
    status: t.status,
    priority: t.priority,
    related_analysis_item: t.relatedAnalysisItem ?? undefined,
    created_by: t.createdBy,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
  } as Task;
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

  public async getJob(id: string): Promise<AIAnalysisJob | undefined> {
    const j = await prisma.aIAnalysisJob.findUnique({ where: { id } });
    return j ? mapJob(j) : undefined;
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

  public async createProposal(prop: Omit<Proposal, "id" | "generated_at">): Promise<Proposal> {
    const p = await prisma.proposal.create({
      data: {
        id: randomId("prop"),
        tenantId: requireTenantId(),
        projectId: prop.project_id,
        proposalType: prop.proposal_type,
        templateId: prop.template_id,
        templateVersion: prop.template_version,
        status: prop.status,
        language: prop.language,
        docxFilePath: prop.docx_file_path,
        pdfFilePath: prop.pdf_file_path,
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
        editableContent: updates.editable_content,
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

  // Audit / Debug logs
  public async getAuditLogs(): Promise<AuditLog[]> {
    return (await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 1000 })).map(mapAuditLog);
  }

  public async queryAuditLogs(filters: { from?: Date; to?: Date; q?: string }): Promise<AuditLog[]> {
    const rows = await prisma.auditLog.findMany({
      where: {
        createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
        OR: filters.q
          ? [
              { action: { contains: filters.q, mode: "insensitive" } },
              { entityType: { contains: filters.q, mode: "insensitive" } },
              { userId: { contains: filters.q, mode: "insensitive" } },
            ]
          : undefined,
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
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

  public async getDebugLogs(): Promise<DebugLog[]> {
    return (await prisma.debugLog.findMany({ orderBy: { timestamp: "desc" }, take: 1000 })).map(mapDebugLog);
  }

  public async addDebugLog(log: Omit<DebugLog, "id" | "timestamp">): Promise<void> {
    await prisma.debugLog.create({
      data: {
        id: randomId("dbg"),
        // Optional: some diagnostic events (e.g. failed login for a nonexistent email)
        // genuinely happen before any tenant is known.
        tenantId: getCurrentTenantId(),
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

  // Branding settings (singleton row)
  public async getBranding(): Promise<BrandingSettings> {
    const b = await prisma.brandingSettings.findFirst();
    if (!b) throw new Error("Branding settings row missing - seed data was not migrated correctly.");
    return mapBranding(b);
  }

  public async updateBranding(updates: Partial<BrandingSettings>): Promise<BrandingSettings> {
    const current = await prisma.brandingSettings.findFirst();
    if (!current) throw new Error("Branding settings row missing - seed data was not migrated correctly.");
    const b = await prisma.brandingSettings.update({
      where: { id: current.id },
      data: {
        companyName: updates.company_name,
        companyLogoPath: updates.company_logo_path,
        loginLogoPath: updates.login_logo_path,
        sidebarLogoPath: updates.sidebar_logo_path,
        reportLogoPath: updates.report_logo_path,
        faviconPath: updates.favicon_path,
        primaryColor: updates.primary_color,
        secondaryColor: updates.secondary_color,
        accentColor: updates.accent_color,
        backgroundColor: updates.background_color,
        textColor: updates.text_color,
        fontFamily: updates.font_family,
        borderRadius: updates.border_radius,
        buttonStyle: updates.button_style,
        defaultTheme: updates.default_theme,
        customCssVariables: updates.custom_css_variables,
        footerText: updates.footer_text,
        supportContact: updates.support_contact,
        legalText: updates.legal_text,
      },
    });
    return mapBranding(b);
  }

  // Prompt templates
  public async getPrompts(): Promise<PromptTemplate[]> {
    return (await prisma.promptTemplate.findMany()).map(mapPrompt);
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

  // Tasks
  public async getTasks(projectId?: string): Promise<Task[]> {
    return (
      await prisma.task.findMany({ where: projectId ? { projectId } : undefined, orderBy: { createdAt: "desc" } })
    ).map(mapTask);
  }

  public async createTask(task: Omit<Task, "id" | "created_at" | "updated_at">): Promise<Task> {
    const t = await prisma.task.create({
      data: {
        id: randomId("task"),
        tenantId: requireTenantId(),
        projectId: task.project_id,
        title: task.title,
        description: task.description,
        ownerUserId: task.owner_user_id,
        dueDate: new Date(task.due_date),
        status: task.status,
        priority: task.priority,
        relatedAnalysisItem: task.related_analysis_item,
        createdBy: task.created_by,
      },
    });
    return mapTask(t);
  }

  public async updateTask(id: string, updates: Partial<Task>): Promise<Task | undefined> {
    const exists = await prisma.task.findUnique({ where: { id } });
    if (!exists) return undefined;
    const t = await prisma.task.update({
      where: { id },
      data: {
        title: updates.title,
        description: updates.description,
        ownerUserId: updates.owner_user_id,
        dueDate: updates.due_date ? new Date(updates.due_date) : undefined,
        status: updates.status,
        priority: updates.priority,
        relatedAnalysisItem: updates.related_analysis_item,
      },
    });
    return mapTask(t);
  }

  public async deleteTask(id: string): Promise<boolean> {
    try {
      await prisma.task.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
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

  // Only approved entries are ever surfaced to the analysis prompt (see aiOrchestrator's
  // getApprovedKnowledgeBaseContext) - a simple ILIKE-based relevance match against trigger since
  // there's no full-text/vector search infra in place yet; good enough at the volumes a single
  // tenant's reviewed knowledge base will realistically reach.
  public async searchApprovedKnowledgeBase(keywords: string[]): Promise<KnowledgeBaseEntry[]> {
    if (keywords.length === 0) return [];
    const rows = await prisma.knowledgeBaseEntry.findMany({
      where: {
        status: "approved",
        OR: keywords.map((kw) => ({ trigger: { contains: kw, mode: "insensitive" as const } })),
      },
      orderBy: { createdAt: "desc" },
      take: 20,
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
      },
    });
    return mapKnowledgeBaseEntry(e);
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

  // Full snapshot for the admin diagnostics export only - never call this on a hot path.
  public async getDiagnosticSnapshot() {
    const [
      users, roles, projects, documents, analysisJobs, analysisResults, conversationHistory,
      auditLogs, debugLogs, platformSettings, promptTemplates, proposalTemplates, proposals,
      approvalWorkflows, approvalDecisions, tasks, brandingSettings, integrationConnectors,
    ] = await Promise.all([
      this.getUsers(), this.getRoles(), this.getProjects(), this.getDocuments(), this.getJobs(),
      prisma.analysisResult.findMany().then((rows) => rows.map(mapAnalysisResult)),
      prisma.conversationMessage.findMany().then((rows) => rows.map(mapConversation)),
      this.getAuditLogs(), this.getDebugLogs(), this.getSettings(), this.getPrompts(),
      this.getProposalTemplates(), this.getProposals(), this.getApprovalWorkflows(),
      this.getApprovalDecisions(), this.getTasks(), this.getBranding(), this.getIntegrations(),
    ]);

    return {
      users, roles, projects, documents, analysisJobs, analysisResults, conversationHistory,
      auditLogs, debugLogs, platformSettings, promptTemplates, proposalTemplates, proposals,
      approvalWorkflows, approvalDecisions, tasks, brandingSettings, integrationConnectors,
    };
  }
}

export const dbStore = new DBStore();
