# Platform Architecture & Module Layout

Commercial Assistant AI is a full-stack, decoupled platform for pre-sales tender analysis and
proposal generation, backed by a real relational database (not an in-memory store) and a
multi-provider AI abstraction (not locked to a single vendor).

## 1. System Topology Overview

```
+--------------------------------------------------------+
|                      CLIENT WEB SPA                     |
|          React / Vite / Tailwind CSS / Lucide           |
+---------------------------+------------------------------+
                            | HTTP(S) Request
                            v
+--------------------------------------------------------+
|                API GATEWAY & SECURITY LAYER              |
|  Helmet | express-rate-limit | Correlation ID | Pino     |
+---------------------------+------------------------------+
                            | requireAuth / requirePermission
                            v
+--------------------------------------------------------+
|                    EXPRESS BACKEND CORE                  |
| Auth | Projects | Documents | Analysis | Proposals |     |
| Templates | Knowledge Base | Approvals | Settings |      |
| Integrations | Audit | Diagnostics | Tasks | Dashboard    |
+------+-------------------+-------------------+-----------+
       |                   |                   |
       | Prisma / Postgres | Storage Adapter   | AI Provider Abstraction
       v                   v                   v
+--------------+   +----------------+   +--------------------------+
| POSTGRESQL   |   | Local / S3 /   |   | Anthropic / OpenAI /     |
| (Prisma ORM) |   | GCS Adapter    |   | Google (per task type)  |
+--------------+   +----------------+   +--------------------------+
       |
       v
+--------------+
| REDIS        |
| cache/session|
+--------------+
```

---

## 2. Core Modules & Directory Layout

- **`/server.ts`**: Express bootstrapping. Mounts Helmet, JSON body parsing, correlation ID
  middleware, Pino HTTP logging, the global API rate limiter, and every route module (see below).
  Serves the Vite dev middleware in development or the compiled `/dist` static assets in
  production.
- **`/server/middleware/security.ts`**: `requireAuth`/`requirePermission` guards, correlation ID
  propagation, and sanitized error capture (never leaks stack traces or internals to the client).
- **`/server/routes/`** (each mounted under `/api` in `server.ts`):
  - `auth.ts` — login, session verification, logout, real TOTP-based MFA with a demo-only fallback
    (see [SECURITY.md](./SECURITY.md)).
  - `users.ts`, `roles.ts` — user directory and RBAC role/permission matrices.
  - `projects.ts` — tender project/workspace CRUD and configuration.
  - `documents.ts` — Multer-based multipart upload, storage adapter dispatch, text extraction.
  - `analysis.ts` — multi-provider AI analysis: document-wide extraction (executive summary,
    critical requirements, risks, opportunities, point-to-point matrix, preliminary schedule,
    clarification questions, BOM) and BOM enrichment (`enrichBomWithWebSearch`) against the
    approved Knowledge Base and/or live web search.
  - `knowledgeBase.ts` — Knowledge Base entry review/approval workflow, and the document-analysis
    pipeline that proposes new entries from uploaded reference datasheets/standards.
  - `proposals.ts` — compiles DOCX/PDF proposal documents (7 types — see
    [TEMPLATE_GUIDE.md](./TEMPLATE_GUIDE.md)) from project + analysis data.
  - `templates.ts` — proposal template upload/management, the variable glossary endpoint
    (`GET /api/templates/proposals/variables`), and template validation (`/validate`, which
    cross-checks a real uploaded `.docx`'s placeholders against the canonical variable catalog).
  - `approvals.ts` — configurable multi-role approval workflows for proposals.
  - `settings.ts` — platform branding, AI provider/model configuration per task type, prompt
    templates, and cost caps.
  - `integrations.ts` — connector configuration with AES-256-CBC encrypted credential fields.
  - `audit.ts` — business/compliance audit trail (who did what, when — distinct from technical
    debug logs).
  - `diagnostics.ts` — sanitized diagnostic export bundle for support.
  - `tasks.ts`, `userTasks.ts`, `dashboard.ts`, `projectIntake.ts`, `verticals.ts`, `messages.ts` —
    background task tracking, per-user task queues, dashboard aggregates, intake/vertical
    configuration, and the in-app conversational copilot.
  - `pricing.ts` — Módulo de Precificação (add-on, gated by `requireModule("pricing")`): price
    catalog CRUD, template-workbook import and AI-extraction-from-quote import (both landing in
    `PriceCatalogExtractionDraft` when a required field can't be resolved automatically, never
    silently discarded), the extraction-drafts review/confirm workflow, project-level BOM-to-
    catalog matching and per-line pricing (`computeLinePricing`), the optional tax engine
    (`calculateTax`), and USD/BRL exchange-rate settings.
- **`/server/utils/`**:
  - `security.ts` — scrypt password hashing/verification, JWT session signing, TOTP verification,
    AES-256-CBC secret encryption/decryption.
  - `aiProviders.ts` — the provider abstraction: `generateJsonWithProvider`,
    `generateTextWithProvider`, `searchWebWithProvider` (Anthropic/OpenAI/Google, including
    provider-native web search tools), and AI usage cost estimation/recording.
  - `storage.ts` — local filesystem, AWS S3, and GCS storage adapters behind one interface, plus
    upload validation (size/MIME/extension whitelist, randomized storage paths).
  - `extraction.ts` — text extraction for PDF/DOCX/XLSX/CSV/TXT; vision-capable formats are passed
    directly to the AI provider instead.
  - `docx.ts` / `docxTemplateEngine.ts` — the DOCX template compiler (`buildTemplateVariables()`,
    32 variables across 9 categories) and placeholder inspection (`extractTemplatePlaceholders`,
    via `docxtemplater`'s `InspectModule`).
  - `templateVariableCatalog.ts` — the single source of truth for every variable a template can
    use: name, human-readable description, category, and (for loop variables) the inner fields
    available inside `{{#name}}...{{/name}}`. Used by both the glossary endpoint and the `/validate`
    cross-check, so they can never drift apart.
  - `proposalTypes.ts` — the 7 proposal/template type values and their display labels, shared by
    the upload form validation and the generation route.
  - `pricingImport.ts` / `pricingAiExtraction.ts` — deterministic parsing of the strict price-table
    template (positional columns, never AI) and AI-driven extraction of a supplier quote in any
    format, respectively; `pricingMath.ts` / `pricingBudgetOptimizer.ts` / `taxCalculation.ts` /
    `exchangeRateFetch.ts` — per-line price/markup/tax computation, BOM-budget-constrained markup
    optimization, the tax engine, and the Banco Central USD/BRL exchange-rate fetch.

---

## 3. Data Persistence

All persistent state lives in **PostgreSQL**, accessed through **Prisma ORM**
(`prisma/schema.prisma` is the source of truth for every table). Key models:

- `Tenant`, `User`, `Role` — multi-tenant identity and RBAC.
- `Project` — a tender/opportunity workspace (customer, opportunity name/code, vertical,
  procurement modality, deadlines).
- `Document` — uploaded tender documents and their extracted text/metadata.
- `AIAnalysisJob` / `AnalysisResult` — one analysis run per job; the result holds the
  semi-structured JSON sections (executive summary, requirements, risks, opportunities, BOM,
  point-to-point table, preliminary schedule, clarification questions) plus the technical/
  commercial proposal drafts.
- `KnowledgeBaseEntry` — approved (human-reviewed) facts used to enrich BOM items, categorized as
  `datasheet`, `engineering_note`, or `bom_part_number`.
- `ProposalTemplate` / `Proposal` — uploaded template files and generated proposal documents.
- `PlatformSettings` — per-task-type AI provider/model configuration, branding, cost caps.
- `AiUsageLog` — recorded cost/usage per successful AI call, by task type and provider/model.
- `AuditLog` — compliance/business audit trail.
- `PriceCatalogItem` / `PriceListUpload` / `PriceHistoryEntry` — the price catalog's "live" state,
  the upload batch it last came from, and an append-only ledger of every price/markup version (the
  catalog is never silently overwritten — every import or manual edit adds a new history entry).
- `PriceCatalogExtractionDraft` — a row that couldn't be fully resolved on import (template or AI
  quote alike) and needs human review in "Extrações pendentes" before it can become a real
  `PriceCatalogItem`; never auto-confirmed.
- `ProjectPricingSheet` / `ProjectPricingLine` — a project's BOM matched against the price catalog
  (with a match confidence score), discount and tax applied per line.
- `TenantPricingSettings` / `TenantTaxProfile` — the USD/BRL exchange rate source and the optional
  per-tenant tax engine configuration (origin UF, tax regime).

**Redis** backs session storage and short-lived caches — it is not the system of record for any
business data.

**File storage** (uploaded documents, generated proposals, template files) goes through the
storage adapter abstraction in `server/utils/storage.ts`: local filesystem by default, or AWS S3 /
Google Cloud Storage when configured in Admin → Settings.
