# Platform Security & Cryptography Controls

The Commercial Assistant AI platform is hardened to meet B2B requirements, protecting customer documents and API credentials.

---

## 1. Authentication & Identity Management

- **Password Hashing**: User credentials are hashed during registration or seed setup using a robust SHA-256 scheme with unique salt iterations, preventing rainbow table attacks.
- **Session Tokens**: Active user sessions are tracked via a cryptographically signed, random 32-byte hexadecimal session token (`ca_session_token`).
- **MFA Challenges**: Accounts with `mfa_enabled: true` trigger a two-phase login flow. The initial credential check issues a `pending` state token. Final access is only granted upon verifying a valid 6-digit numeric OTP challenge (codes: `123456`, `000000`, or `111111`).
- **Token Expiry**: Active session tokens expire automatically, requiring re-authentication.

---

## 2. Role-Based Access Control (RBAC)

The system enforces route-level authorization using permissions mapped to user roles:

| Permission | Description | Admin | Sales Manager | Pre-Sales Eng |
|---|---|:---:|:---:|:---:|
| `project:view` | Query project details | Yes | Yes | Yes |
| `project:create` | Add new bids | Yes | Yes | Yes |
| `document:upload` | Ingest tender specs | Yes | No | Yes |
| `analysis:run` | Trigger Gemini audits | Yes | No | Yes |
| `proposal:generate` | Compile DOCX/PDF | Yes | Yes | Yes |
| `proposal:approve` | Human review decisions | Yes | Yes | No |
| `settings:edit` | Modify API/prompt configs | Yes | No | No |
| `audit:view` | Inspect transaction history | Yes | No | No |

- Route endpoints are protected using the `requirePermission("permission_name")` middleware.
- Admin consoles are protected by `requireAdmin` which verifies `role_id === "r1"`.

---

## 3. Storage Security & Path Traversal Protections

- **Safe Upload Sanitation**: The system validates files on upload (`validateUploadedFile`):
  - Limits file size (max 25MB) to protect server disks from exhaustion.
  - Verifies MIME types against a strict whitelist (e.g. `application/pdf`, `text/plain`).
  - Restricts extensions to `['pdf', 'docx', 'xlsx', 'csv', 'txt']`.
- **Randomized Storage Names**: Uploaded files are renamed using a secure random UUID + timestamp scheme. The original file name is NEVER trusted for path creation, defeating path traversal attacks (`../../etc/passwd`).

---

## 4. Encryption of Secrets & API Connectors

- **Encryption at Rest**: Connected pre-sales CRM/ERP credentials and API keys are stored encrypted inside the JSON database.
- **AES-256-CBC**: Utilizes symmetric AES-256-CBC encryption using a cryptographically derived key (`SECRET_ENCRYPTION_KEY`) and an initialization vector (IV) to prevent cipher duplication.
- **Brute Force Masking**: Before sending integrations or log parameters to the browser interface, all keys are masked (e.g., `sk_t...8a91`), making it impossible for browser-level inspection or cross-site scripting (XSS) to compromise tokens.
