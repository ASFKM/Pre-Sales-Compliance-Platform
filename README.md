# Commercial Assistant AI — Pre-Sales Compliance Platform

Commercial Assistant AI is a production-hardened, full-stack pre-sales automation platform for
technical/commercial tender analysis. It ingests tender documents (PDF, DOCX, XLSX, CSV, TXT, and
images via vision), runs multi-provider AI analysis (requirements, risks, opportunities, BOM,
schedule, point-to-point compliance matrix), enriches Bill-of-Materials items against a
human-curated Knowledge Base and/or live web search, and generates DOCX/PDF proposals from
customizable templates with a fully documented variable glossary.

---

## Stack

- **Frontend**: React 19 + Vite + Tailwind CSS + Lucide icons.
- **Backend**: Express (TypeScript), served either via Vite middleware (dev) or a single bundled
  `dist/server.cjs` (production, built with esbuild).
- **Database**: PostgreSQL via Prisma ORM (see `prisma/schema.prisma`). Not an in-memory store —
  every table is a real Postgres table, with migrations tracked in `prisma/migrations/`.
- **Cache / sessions**: Redis.
- **File storage**: pluggable adapter — local filesystem, AWS S3, or Google Cloud Storage. A
  MinIO container in `docker-compose.yml` lets you exercise the real S3 adapter locally without an
  AWS account.
- **AI providers**: multi-provider, not locked to a single vendor. Supported today: **Anthropic**
  (Claude), **OpenAI**, and **Google** (Gemini). Each task type (document analysis, web-grounded
  BOM enrichment, spec copilot, Knowledge Base ingestion, etc.) has its own configurable
  provider/model pair in Admin → IA, Prompts e Custos — you are not required to use the same
  provider for every task.

## Key capabilities

1. **Real identity & sessions**: scrypt password hashing, JWT-backed sessions, real TOTP-based MFA
   (with a demo-only fallback code path that is hard-blocked outside `APP_RUNTIME_MODE=demo` —
   see [SECURITY.md](./SECURITY.md)).
2. **Route-level RBAC**: every sensitive endpoint (settings, templates, users, roles, integrations,
   audit, diagnostics) is protected by permission middleware, not just hidden in the UI.
3. **Real document ingestion**: Multer-based multipart upload, strict MIME/extension/size
   validation, randomized storage paths (no path traversal), text extraction for text-bearing
   formats and vision-based analysis for scanned/image documents.
4. **Multi-provider AI analysis**: structured (Zod-validated) extraction of executive summary,
   critical requirements, risks, opportunities, a dynamic point-to-point compliance matrix (columns
   vary by technical discipline), preliminary schedule, clarification questions, and BOM.
5. **BOM enrichment against a Knowledge Base**: items missing a manufacturer/part number are first
   checked against your organization's approved Knowledge Base (human-reviewed facts from past
   projects) before falling back to a live, provider-native web search. Relevance ranking is
   IDF-weighted (rare, distinctive terms matter more than generic jargon) and cross-checked against
   each candidate's full installation context (e.g. a vehicle-mounted camera is never silently
   substituted for a fixed pole-mount requirement, or vice versa).
6. **Real DOCX template engine with a documented variable glossary**: upload a `.docx` with
   `{{placeholders}}`, generate any of 7 proposal document types (technical, commercial,
   technical-commercial, executive summary, risk report, BOM report, clarification-questions
   report) from real project/analysis data — 32 variables across 9 categories, all documented in a
   glossary panel in the Admin Console (not just a code comment). See
   [TEMPLATE_GUIDE.md](./TEMPLATE_GUIDE.md).
7. **Encrypted secrets at rest**: connector/API credentials are AES-256-CBC encrypted in the
   database and masked before ever reaching the browser.
8. **Observability**: Helmet security headers, per-IP rate limiting, correlation IDs on every
   request/log line, structured audit logs separate from technical debug logs, and a sanitized
   diagnostic export bundle for support.

## Add-on Modules

Some capabilities are sold as separate entitlements, signed and delivered by a companion Fleet
Manager installation (`ModuleEntitlement`) rather than being always-on — a tenant only sees the
module's navigation/API surface once it's actually licensed, enforced at both the UI and the route
layer (`requireModule`), not just hidden in the frontend.

- **Gestão de POC (Proof-of-Concept management)**: a full pipeline for running customer proofs of
  concept end to end — success criteria, an interactive Gantt schedule (drag/resize, critical
  path), equipment loan tracking (importable straight from the linked project's BOM, with shipment
  status via real carrier tracking), an AI-generated test-case notebook and final report grounded
  in the tenant's own Knowledge Base (not generic boilerplate — it explicitly flags missing
  coverage instead of inventing specs), and a client-acceptance workflow with a real approval gate
  that locks the record once a POC is concluded. See `docs/roadmap/REDESIGN_ROADMAP_2026-07.md`
  (Fase 6) for the full build log of each phase.
- **Módulo de Precificação (pricing)**: a price catalog with per-item markup range and an optional
  tax engine (ICMS/IPI/ISS/ST by origin UF), fed either by the strict price-table template or by
  AI extraction of a supplier quote in any format (PDF, photo, DOCX, spreadsheet) with real-time
  per-file progress. A row missing a required field is never rejected outright — the import tries
  to complete it first from an already-catalogued item (matched by item code or PN) and only falls
  back to manual review in "Extrações pendentes" for what genuinely needs a human decision. Project
  pricing matches the BOM against the catalog (with a confidence score), applies a per-line
  discount and tax, and — when a project has real pricing — feeds it straight into proposal
  generation instead of a manually-typed table, with an explicit guarantee that markup and list
  price are never exposed in the generated document (see `server/utils/docxTemplateEngine.ts`).

---

## Local Development Setup

### 1. Prerequisites
- **Node.js** v20 or v22, **npm** v10+.
- **Docker** (for PostgreSQL, Redis, and optionally MinIO) — see
  [DEPLOYMENT.md](./DEPLOYMENT.md) for the full Docker Compose stack, or point `DATABASE_URL`/
  `REDIS_URL` at your own instances.
- At least one AI provider API key (Anthropic, OpenAI, or Google) — you don't need all three,
  each task type's provider is independently configurable once the app is running.

### 2. Configure Environment Variables
```bash
cp .env.example .env
```
At minimum, set `DATABASE_URL`, `REDIS_URL`, `SECRET_ENCRYPTION_KEY`, and `JWT_SESSION_SECRET`.
See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full variable reference.

### 3. Install dependencies and set up the database
```bash
npm install
npm run prisma:migrate:dev
npm run prisma:seed
```

### 4. Run the development server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

For a complete, from-zero walkthrough (including the Docker stack and first-admin setup), see the
**[Installation Cookbook](./docs/INSTALLATION_COOKBOOK.md)**.

---

## Production Build & Run

```bash
npm run build   # compiles the Vite frontend into /dist and bundles the server into dist/server.cjs
npm start        # runs dist/server.cjs
```

## Containerized Deployment
```bash
docker-compose up --build
```
Brings up the app, PostgreSQL, Redis, and a local MinIO instance (S3-compatible storage for
testing the real S3 adapter). See [DEPLOYMENT.md](./DEPLOYMENT.md) for production sizing,
TLS/cert configuration, and cloud deployment options.

---

## Project Documentation Registry
- **[Installation Cookbook](./docs/INSTALLATION_COOKBOOK.md)**: step-by-step guide for a brand new
  installation, from zero to a working first login.
- **[Architecture Guide](./ARCHITECTURE.md)**: full-stack layout, module list, and data flow.
- **[Security Controls Guide](./SECURITY.md)**: authentication, RBAC, encryption, and upload safety.
- **[Deployment Manual](./DEPLOYMENT.md)**: environment variables and deployment options.
- **[Template & Variable Guide](./TEMPLATE_GUIDE.md)**: the full variable glossary and the 7
  proposal document types.
- **[Agent Operating Guide](./AGENTS.md)**: rules for AI coding agents working in this repository.
