# Commercial Assistant AI Roadmap

## Phase 0 - Repository governance

Goal: establish GitHub quality, security, and review controls.

- CI for build and TypeScript checks.
- CodeQL workflow.
- Dependency review workflow.
- Dependabot configuration.
- PR template.
- Issue templates.
- Security policy.
- Agent instructions.
- Quality baseline.
- Manual repository setup guide.

## Phase 1 - Security foundation

Goal: make the application safe enough for controlled internal testing.

- Real authentication.
- Secure sessions.
- MFA-ready structure.
- Server-side RBAC middleware.
- Protected admin/settings/logs/diagnostics endpoints.
- Safe error handling.
- Secret masking.
- Basic security headers and rate limiting.

## Phase 2 - Document Intelligence foundation

Goal: process real project files instead of mocked metadata.

- Multipart upload.
- File validation.
- Safe storage paths.
- Local storage adapter.
- S3/GCS adapter scaffolds.
- Text extraction for PDF, DOCX, XLSX, CSV, TXT.
- Document classification from extracted text.
- Source traceability model improvements.

## Phase 3 - AI Analysis Engine foundation

Goal: produce reliable, auditable AI outputs.

- Provider abstraction.
- Prompt template versioning.
- Structured output schemas.
- Retry and parse-recovery strategy.
- Prompt-injection defensive instructions.
- Failure/fallback semantics.
- Token/cost tracking.
- Conversation history persistence.

## Phase 4 - Proposal Studio foundation

Goal: generate real editable deliverables.

- DOCX template upload.
- DOCX variable extraction.
- Repeating sections/tables.
- Technical proposal generation.
- Commercial proposal generation.
- Manual pricing workflow.
- PDF export.
- Proposal versioning.

## Phase 5 - Production deployment foundation

Goal: prepare on-prem/private-cloud operation.

- Dockerfile(s).
- docker-compose.yml.
- PostgreSQL persistence.
- Redis/job queue.
- MinIO/local object storage.
- Health/readiness checks.
- Backup and retention policies.
- Deployment documentation.

## Phase 6 - Enterprise governance

Goal: mature the application for customer-facing pilots.

- Approval workflow builder.
- Diagnostic ZIP package.
- Retention/deletion policy enforcement.
- Integration Hub connectors.
- Usage analytics.
- Audit export.
- Admin branding/white-label hardening.
