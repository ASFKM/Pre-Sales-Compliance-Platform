# GitHub Copilot Instructions

You are assisting on Commercial Assistant AI, an enterprise pre-sales compliance and proposal platform.

## Product goals

- Analyze customer project documents and tenders.
- Extract requirements, risks, opportunities, BOM, point-to-point compliance, schedules, and clarification questions.
- Generate technical and commercial proposal drafts for human review.
- Support Portuguese, English, and Spanish.
- Support dedicated customer deployments and future on-premises operation.

## Development rules

- Keep AI calls server-side.
- Do not expose secrets in frontend code.
- Do not store integration tokens in plaintext.
- Add RBAC checks for sensitive operations.
- Validate all API input.
- Do not accept arbitrary request bodies into persisted entities.
- Keep audit logs separate from debug logs.
- Use correlation IDs for debugging.
- Treat uploaded documents as untrusted input.
- Treat AI output as draft content until human review and approval.

## Preferred code structure

For future refactors, prefer:

- `src/client/` for frontend API clients and hooks.
- `src/components/` for reusable UI components.
- `src/pages/` for route-level pages.
- `src/server/routes/` for Express route modules.
- `src/server/services/` for business logic.
- `src/server/repositories/` for persistence.
- `src/server/middleware/` for auth, RBAC, logging, validation, and errors.
- `src/server/adapters/` for AI, storage, export, and integrations.

## Testing expectations

Add or preserve tests for:

- auth and RBAC;
- upload validation;
- document extraction;
- AI structured output validation;
- proposal generation;
- audit/debug behavior.
