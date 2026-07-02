# Platform Architecture & Module Layout

Commercial Assistant AI is built on a robust, full-stack, decoupled architecture that provides secure pre-sales analysis and document compilation.

## 1. System Topology Overview

```
+--------------------------------------------------------+
|                      CLIENT WEB SPA                    |
|          React / Vite / Tailwind CSS / Lucide          |
+---------------------------+----------------------------+
                            | HTTP(S) Request
                            v
+--------------------------------------------------------+
|                API GATEWAY & SECURITY LAYER            |
|       Helmet | Express-Rate-Limit | Correlation ID     |
+---------------------------+----------------------------+
                            | Protected Routing
                            v
+--------------------------------------------------------+
|                    EXPRESS BACKEND CORE                |
|      Auth | Projects | Uploads | Analysis | Proposals  |
+---------------------------+----------------------------+
       |                    |                    |
       | Local FS / S3      | @google/genai      | DOCX Engine
       v                    v                    v
+--------------+     +--------------+     +--------------+
| STORAGE      |     | GEMINI MODEL |     | PRE-SALES    |
| ADAPTER      |     | gemini-3.5-  |     | GENERATOR    |
| Local/S3/GCS |     | flash        |     | DOCX / PDF   |
+--------------+     +--------------+     +--------------+
```

---

## 2. Core Modules & Directory Layout

- **`/server.ts`**: Express application bootstrapping, loading Vite middleware in development or static assets in production, and applying security headers.
- **`/server/middleware/security.ts`**: Core middleware for defensive posture: Helmet headers, API request throttling, correlation tracking, and sanitized error captures.
- **`/server/routes/`**:
  - `auth.ts`: Authentication, session verification, logout, and Multi-Factor Challenges (MFA).
  - `users.ts`: Zod-validated User profiles and user registry query handlers.
  - `roles.ts`: Access to pre-loaded B2B role-permission matrices.
  - `projects.ts`: Core project, tender bid, and workflow configuration endpoints.
  - `documents.ts`: Multer-based multipart file processing, secure file storage, and text extraction pipelines.
  - `analysis.ts`: Integration with Google Gemini SDK (`@google/genai`) to conduct multi-document pre-sales audit analysis.
  - `proposals.ts`: Compiles proposal assets (DOCX/PDF) by parsing variables and repeating grids.
  - `settings.ts`: Configurations for platform branding and AI prompt templates.
  - `integrations.ts`: Connector config with AES-256 encrypted fields.
  - `audit.ts`: Human audit logs separate from diagnostic traces.
  - `diagnostics.ts`: Sanitizes debugging snapshots for system admin support.
- **`/server/utils/`**:
  - `security.ts`: Crypto utilities for password comparison, token signatures, and key encryption.
  - `storage.ts`: Extensible local filesystem, AWS S3, and GCS storage interfaces.
  - `extraction.ts`: Physical text extraction parsers for PDF, DOCX, CSV, XLSX, and TXT.
  - `docx.ts`: Pre-sales template compilers.

---

## 3. Data Persistence & State Model

The platform utilizes a structured, transaction-isolated in-memory store defined in `/src/dbStore.ts` that acts as a secure local database. It mimics relational schemas with tables for:
- `users`, `roles`, `permissions`: RBAC identity tables.
- `projects`, `documents`: Tender workspace resources.
- `analysis_jobs`, `document_contents`: Processing queues and text extracts.
- `proposals`, `approval_decisions`: Presales artifacts and review traces.
- `settings`, `prompt_templates`, `proposal_templates`: Global variables.
- `integrations`: Connected platforms.
- `audit_logs`, `debug_logs`: Separate logs for observability.
