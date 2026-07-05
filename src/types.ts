export enum UserStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
  PENDING = "PENDING",
}

export interface User {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  mfa_enabled: boolean;
  status: UserStatus;
  role_id: string;
  created_at: string;
  updated_at: string;
  last_login_at?: string;
}

export interface Role {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  permissions: string[];
}

export type ProjectStatus = "draft" | "analysis_in_progress" | "waiting_customer" | "waiting_internal" | "completed" | "canceled";

export interface Project {
  id: string;
  name: string;
  customer_name: string;
  opportunity_name: string;
  vertical: string;
  description: string;
  status: ProjectStatus;
  deadline: string;
  proposal_validity_date: string;
  owner_user_id: string;
  output_language: "Portuguese" | "English" | "Spanish";
  proposal_language: "Portuguese" | "English" | "Spanish";
  ai_orientation_mode: "Vendor-neutral" | "Preferred manufacturer" | "Mandatory manufacturer" | "Existing customer standard" | "Free AI recommendation" | "Custom instruction";
  ai_orientation_text: string;
  selected_approval_workflow_id: string;
  procurement_modality?: string;
  procurement_subtype?: string;
  custom_modality?: string;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  project_id: string;
  filename: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  storage_provider: "local" | "s3" | "gcs";
  storage_path: string;
  detected_document_type: string;
  manual_document_type?: string;
  ai_classification_confidence: number;
  version: number;
  language: string;
  uploaded_by: string;
  created_at: string;
}

export interface AIAnalysisJob {
  id: string;
  project_id: string;
  status: "idle" | "running" | "completed" | "failed";
  ai_provider: string;
  ai_model: string;
  prompt_template_version: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  token_input?: number;
  token_output?: number;
  estimated_cost?: number;
  created_by: string;
  correlation_id: string;
}

export interface CriticalRequirement {
  requirement_id: string;
  category: "technical" | "commercial" | "contractual" | "operational" | "security" | "integration" | "infrastructure" | "deadline" | "support" | "maintenance" | "documentation" | "training";
  description: string;
  source_document: string;
  source_page_or_section: string;
  source_snippet: string;
  priority: "high" | "medium" | "low";
  mandatory_or_optional: "mandatory" | "optional";
  compliance_status: "compliant" | "partially_compliant" | "non_compliant" | "not_enough_information";
  evidence_type: "directly_supported" | "inferred_from_documents" | "user_provided_instruction" | "assumption" | "missing_information" | "requires_customer_confirmation";
  confidence: number;
  notes: string;
}

export interface ProjectRisk {
  risk_id: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  probability: "low" | "medium" | "high";
  impact: string;
  source_document: string;
  source_page_or_section: string;
  source_snippet: string;
  mitigation: string;
  owner_area: string;
  requires_customer_clarification: boolean;
  evidence_type: string;
  confidence: number;
}

export interface ProjectOpportunity {
  opportunity_id: string;
  title: string;
  description: string;
  business_value: string;
  source_document: string;
  source_page_or_section: string;
  suggested_solution: string;
  sales_strategy: string;
  priority: "high" | "medium" | "low";
  evidence_type: string;
  confidence: number;
}

export interface BOMItem {
  item_id: string;
  product_or_service: string;
  description: string;
  quantity: number;
  unit: string;
  category: string;
  mandatory_or_optional: "mandatory" | "optional";
  reason_for_inclusion: string;
  suggested_manufacturer: string;
  alternatives: string;
  assumptions: string;
  source_reference: string;
  risk_or_dependency: string;
  requires_human_validation: boolean;
}

export interface PointToPointRow {
  item_id: string;
  customer_requirement: string;
  proposed_solution: string;
  compliance: "compliant" | "partially_compliant" | "non_compliant" | "not_enough_information";
  comments: string;
  source_reference: string;
  evidence_type: string;
  confidence: number;
}

export interface PreliminarySchedulePhase {
  phase_id: string;
  phase_name: string;
  activities: string[];
  estimated_duration: string;
  dependencies: string[];
  responsible_area: string;
  assumptions: string;
  risks: string;
}

export interface ClarificationQuestion {
  question_id: string;
  question: string;
  reason: string;
  related_requirement_or_risk: string;
  priority: "high" | "medium" | "low";
  target_audience: string;
}

export interface ExecutiveSummary {
  project_overview: string;
  customer_context: string;
  main_requirements: string;
  main_risks: string;
  main_opportunities: string;
  recommended_strategy: string;
  assumptions: string;
  next_steps: string;
}

export interface PricingRow {
  item_id: string;
  product_or_service: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  currency: string;
  is_optional: boolean;
  discount: number;
}

export interface AnalysisResult {
  id: string;
  project_id: string;
  job_id: string;
  executive_summary: ExecutiveSummary;
  critical_requirements: CriticalRequirement[];
  risks: ProjectRisk[];
  opportunities: ProjectOpportunity[];
  bom: BOMItem[];
  point_to_point_table: PointToPointRow[];
  preliminary_schedule: PreliminarySchedulePhase[];
  clarification_questions: ClarificationQuestion[];
  technical_proposal_draft: string;
  commercial_proposal_draft: string;
  review_status: "pending" | "reviewed" | "approved";
  approved_by?: string;
  approved_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  project_id: string;
  user_id: string;
  role: "user" | "model";
  message: string;
  ai_provider: string;
  ai_model: string;
  prompt_template_version: string;
  input_summary: string;
  output_summary: string;
  token_input: number;
  token_output: number;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  project_id?: string;
  ip_address: string;
  user_agent: string;
  metadata: string; // JSON string
  created_at: string;
}

export interface DebugLog {
  id: string;
  timestamp: string;
  log_level: "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";
  service_name: string;
  module_name: string;
  environment: string;
  correlation_id: string;
  request_id: string;
  user_id?: string;
  project_id?: string;
  document_id?: string;
  analysis_job_id?: string;
  proposal_id?: string;
  operation: string;
  message: string;
  status: string;
  duration_ms: number;
  error_code?: string;
  error_message?: string;
  safe_metadata: string; // JSON string
}

export interface PlatformSettings {
  id: string;
  ai_provider: string;
  default_model: string;
  document_analysis_model: string;
  proposal_generation_model: string;
  summarization_model: string;
  risk_analysis_model: string;
  ai_api_key_encrypted?: string;
  ai_api_key_configured?: boolean;
  ai_api_key_masked?: string;
  storage_mode: "local" | "s3" | "gcs";
  local_storage_path: string;
  s3_bucket: string;
  s3_region?: string;
  s3_access_key_id?: string;
  s3_secret_access_key_encrypted?: string;
  s3_secret_access_key_configured?: boolean;
  s3_secret_access_key_masked?: string;
  gcs_bucket: string;
  gcs_project_id?: string;
  gcs_service_account_key_encrypted?: string;
  gcs_service_account_key_configured?: boolean;
  default_language: "Portuguese" | "English" | "Spanish";
  default_log_level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  created_at: string;
  updated_at: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  type: string;
  content: string;
  language: "Portuguese" | "English" | "Spanish";
  version: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProposalTemplate {
  id: string;
  name: string;
  description: string;
  template_type: "technical" | "commercial" | "executive_summary" | "risk_report" | "bom_report" | "questions_report";
  language: "Portuguese" | "English" | "Spanish";
  file_type: "docx" | "doc" | "pdf";
  file_path: string;
  variables_schema: string;
  version: string;
  active: boolean;
  default_template: boolean;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

export interface Proposal {
  id: string;
  project_id: string;
  proposal_type: "technical" | "commercial";
  template_id: string;
  template_version: string;
  status: "draft" | "submitted" | "approved" | "rejected" | "released";
  language: "Portuguese" | "English" | "Spanish";
  docx_file_path: string;
  pdf_file_path: string;
  generated_by: string;
  generated_at: string;
  version: number;
  approval_workflow_id: string;
  manual_pricing_table?: PricingRow[];
  payment_terms?: string;
  delivery_terms?: string;
  proposal_validity?: string;
  commercial_assumptions?: string;
  exclusions?: string;
}

export interface ApprovalWorkflow {
  id: string;
  name: string;
  description: string;
  active: boolean;
  applies_to: string; // e.g. "all", "high_risk", "commercial"
  stages: ApprovalStage[];
  created_at: string;
  updated_at: string;
}

export interface ApprovalStage {
  id: string;
  workflow_id: string;
  name: string;
  order: number;
  approver_type: "user" | "role";
  approver_user_id?: string;
  approver_role_id?: string;
  mandatory: boolean;
  conditions: string;
  created_at: string;
  updated_at: string;
}

export interface ApprovalDecision {
  id: string;
  proposal_id: string;
  stage_id: string;
  approver_user_id: string;
  decision: "approved" | "rejected";
  comments: string;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string;
  owner_user_id: string;
  due_date: string;
  status: "open" | "in_progress" | "waiting_customer" | "waiting_internal" | "completed" | "canceled";
  priority: "high" | "medium" | "low";
  related_analysis_item?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface BrandingSettings {
  id: string;
  company_name: string;
  company_logo_path: string;
  login_logo_path: string;
  sidebar_logo_path: string;
  report_logo_path: string;
  favicon_path: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  background_color: string;
  text_color: string;
  font_family: string;
  border_radius: string; // e.g. "rounded-md"
  button_style: string;
  default_theme: "light" | "dark";
  custom_css_variables: string;
  footer_text: string;
  support_contact: string;
  legal_text: string;
  created_at: string;
  updated_at: string;
}

export interface IntegrationConnector {
  id: string;
  name: string;
  type: string; // e.g., "CRM", "ERP", "Notification", etc.
  status: "connected" | "disconnected" | "error";
  configuration: string; // JSON configuration
  // Derived by the API from `configuration` for display/editing convenience - not stored as-is.
  url?: string;
  sync_frequency?: string;
  // Masked (never raw) once a credential is configured.
  token?: string;
  api_key?: string;
  webhook_secret?: string;
  last_sync_status: string;
  last_sync_date?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}
