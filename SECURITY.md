# Security Policy

Commercial Assistant AI handles customer project documents, proposal drafts, AI outputs, audit logs, debug logs, and future integration credentials. Treat the repository as security-sensitive even during prototype development.

## Supported versions

The current prototype branch is pre-production. Security fixes should target `main` unless a dedicated release branch exists.

## Reporting a vulnerability

Do not open public issues containing secrets, exploit payloads, customer documents, API keys, credentials, or private customer data.

Use a private communication channel with the repository owner. When GitHub private vulnerability reporting is enabled, use that channel first.

Include:

- Summary of the issue.
- Affected area.
- Severity estimate.
- Reproduction steps without secrets.
- Correlation ID or request ID, if available.
- Recommended mitigation, if known.

## Security principles

- No API keys or secrets in frontend code.
- All AI provider calls must run server-side.
- Uploaded files, generated exports, templates, and runtime state must not be publicly exposed.
- Admin endpoints must require authentication and authorization.
- RBAC must be enforced server-side, not only in the UI.
- Debug logs and diagnostic packages must mask secrets and sensitive data.
- AI document processing must consider prompt-injection risk from uploaded files.
- Commercial pricing must remain manually controlled unless a trusted price-source integration is implemented.

## Minimum production blockers

The application must not be deployed for real customer data until these are implemented:

1. Real authentication and secure session handling.
2. Server-side RBAC middleware.
3. Secure secret management.
4. Real file upload validation and storage isolation.
5. Structured validation for AI outputs.
6. Secure diagnostic package generation.
7. Security headers, rate limiting, and safe error responses.
8. PostgreSQL or equivalent durable database with backups.
9. Branch protection and required CI checks.
10. GitHub secret scanning and Dependabot alerts enabled.
