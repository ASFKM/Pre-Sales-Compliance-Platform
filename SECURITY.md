# Platform Security & Cryptography Controls

Commercial Assistant AI is hardened for B2B/on-premises deployment, protecting customer tender
documents, generated proposals, and connected API credentials.

---

## 1. Authentication & Identity Management

- **Password hashing**: `scrypt` (via Node's built-in `crypto.scryptSync`), with a unique random
  salt per user, stored as `scrypt$<salt>$<derived>` (`server/utils/security.ts`). Not a fast hash
  (SHA-256/MD5) — scrypt is deliberately memory-hard to resist brute-force and GPU cracking.
- **Sessions**: JWT-signed session tokens (`JWT_SESSION_SECRET`), backed by Redis, with a
  configurable TTL (`SESSION_TTL_MINUTES`). The client stores the token and sends it as
  `Authorization: Bearer <token>`.
- **MFA**: real TOTP (RFC 6238) once a user has enrolled a secret (`verifyTotpCode`, the secret is
  itself AES-256-CBC encrypted at rest, never stored or transmitted in plaintext). A demo-only
  fallback (codes `123456`, `000000`, `111111`) exists **only** for accounts that haven't enrolled
  a real secret yet, and **only** when `isDemoRuntime()` is true — i.e. `APP_RUNTIME_MODE=demo`.
  **Never deploy a real tenant with `APP_RUNTIME_MODE=demo`** — production mode hard-blocks this
  fallback entirely, so an account without an enrolled TOTP secret simply cannot complete MFA in
  production, by design.
- **Brute-force protection**: failed login and MFA attempts are rate-limited per account+IP
  (`recordFailedAttempt`/`clearFailedAttempts`), returning HTTP 429 after repeated failures.
- **Seed/demo credentials**: `prisma/seed.ts` creates demo users with the password `password123`
  for local development and CI regression tests only. **Change or remove these accounts before any
  real deployment** — the seed script is meant to bootstrap an empty database, not to ship
  production credentials.

---

## 2. Role-Based Access Control (RBAC)

Every sensitive route is protected by `requirePermission("permission:name")` middleware — RBAC is
enforced at the API layer, not just hidden in the UI. The default seed (`prisma/seed.ts`) ships 3
roles; permissions are fully data-driven (`Role.permissions`), so custom roles can be created with
any subset of the permissions below.

| Permission | Administrator | Sales Manager | Pre-Sales Engineer |
|---|:---:|:---:|:---:|
| `project:create` / `project:read` / `project:update` | ✅ | ✅ | ✅ |
| `project:delete` | ✅ | – | – |
| `document:upload` / `document:read` | ✅ | ✅ | ✅ |
| `document:delete` | ✅ | – | ✅ |
| `analysis:run` / `analysis:edit` | ✅ | – | ✅ |
| `analysis:read` | ✅ | ✅ | ✅ |
| `proposal:generate` / `proposal:edit` / `proposal:export` | ✅ | ✅ | ✅ |
| `proposal:approve` | ✅ | ✅ | – |
| `template:manage` | ✅ | ✅ | – |
| `approval:manage` | ✅ | ✅ | – |
| `admin:settings` | ✅ | ✅ | – |
| `admin:users` / `admin:roles` / `admin:audit` / `admin:debug` / `admin:diagnostics` | ✅ | – | – |
| `ai:settings` / `branding:manage` / `storage:manage` / `integrations:manage` | ✅ | – | – |
| `knowledge_base:read` / `knowledge_base:write` | ✅ | – | – |

Admin-only console sections (users, roles, AI/prompt configuration, branding, storage,
integrations, audit, debug, diagnostics, Knowledge Base review) are protected by their specific
`admin:*`/`ai:settings`/`knowledge_base:*` permissions — there is no separate blanket
`requireAdmin` bypass; a custom role only gets admin capabilities if explicitly granted the
matching permission.

---

## 3. Upload & Storage Safety

- **Validated on upload** (`validateUploadedFile`, `server/utils/storage.ts`): file size limit,
  MIME type allow-list, and extension allow-list (`pdf`, `docx`, `xlsx`, `csv`, `txt`, plus image
  types for vision-based analysis of scanned documents).
- **No trusted filenames**: uploaded files are stored under randomized names — the original
  filename is never used to construct a filesystem/object-storage path, which rules out path
  traversal (`../../etc/passwd`-style attacks).
- **Storage adapter isolation**: local filesystem, AWS S3, and Google Cloud Storage are accessed
  through one common interface (`createStorageAdapter`), so switching storage backends in Admin →
  Settings never changes the validation/randomization guarantees above.

---

## 4. Encryption of Secrets & API Connectors

- **AES-256-CBC at rest**: AI provider API keys, connector credentials, and enrolled TOTP secrets
  are encrypted with a key derived from `SECRET_ENCRYPTION_KEY`, with a fresh IV per value (no
  cipher/ciphertext reuse across records).
- **Masked before reaching the browser**: encrypted values are decrypted server-side only when
  actually needed for an outbound call; anything ever sent to the frontend (e.g. integration
  status) is masked (`sk_t...8a91`-style), so client-side inspection/XSS cannot recover a real
  credential.

---

## 5. Knowledge Base & AI Output Governance

- **Human review gate**: entries proposed by the Knowledge Base ingestion pipeline (from uploaded
  reference datasheets/standards) start in `pending` status and are never used to enrich a BOM
  until a user with `knowledge_base:write` explicitly approves them.
- **Provenance is always tracked, never silent**: a BOM item's manufacturer/part number is tagged
  `sourced_via_knowledge_base` or `sourced_via_web_search` (or neither, if nothing confident was
  found) — the platform never presents an AI-sourced technical fact as if it were stated in the
  tender document itself.
- **AI output is never final without review**: proposal drafts, BOM enrichment, and analysis
  results are all subject to the configurable multi-role approval workflow before being treated as
  an approved deliverable.
- **Cost governance**: `PlatformSettings.monthly_cost_cap_usd` blocks further AI calls once a
  tenant's configured monthly spend is reached, returning HTTP 402 rather than silently continuing
  to bill.
- **Pricing data never becomes fact without review**: an AI-extracted supplier quote (Módulo de
  Precificação's "Enviar Arquivos") never writes to the price catalog directly — it always lands
  in `PriceCatalogExtractionDraft` for human review/confirmation first, same governance principle
  as Knowledge Base entries above. A row missing a required field is completed from an
  already-catalogued item when possible, never from AI guesswork.
- **Margin is never exposed to the customer**: markup and list price are deliberately never copied
  into the data structure the DOCX template resolver receives when a project's real pricing feeds
  a generated proposal (`server/utils/docxTemplateEngine.ts`) — the protection lives at the
  data-origin (`server/routes/proposals.ts`), not just at the template-variable mapping step, so a
  future change to the resolver can't accidentally leak it.
