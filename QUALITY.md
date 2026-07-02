# Quality Baseline

This document defines the minimum quality bar for Commercial Assistant AI.

## Current repository status

The current codebase is a prototype generated from Google AI Studio. It is useful for product validation, but several areas are still scaffolded or mocked.

Known prototype limitations:

- Authentication is not production-ready.
- RBAC is modeled but not enforced server-side.
- File upload currently stores metadata only in parts of the prototype.
- DOCX/PDF generation is not production-grade yet.
- Persistence is file-based and must move to a durable database.
- Storage adapters are not fully implemented.
- AI output validation must be strengthened.

## Definition of Done

A change is complete only when:

- TypeScript checks pass.
- Build passes.
- New endpoints validate input.
- Authorization requirements are reviewed.
- Sensitive data is not logged.
- User-facing errors are safe.
- Audit logs are added for relevant business/security actions.
- Documentation is updated when behavior changes.
- Manual testing notes or automated tests are included.

## Required CI checks

- Install dependencies with `npm ci`.
- Run `npm run lint`.
- Run `npm run build`.
- Run CodeQL for JavaScript/TypeScript.
- Run dependency review on pull requests.

## Coding guidelines

- Prefer small modules over large monolithic files.
- Keep AI provider calls server-side.
- Use correlation IDs across API, worker, logs, and diagnostic packages.
- Use explicit types for domain models.
- Do not accept arbitrary `req.body` directly into persistent state.
- Use schema validation for every write endpoint.
- Keep audit logs separate from debug logs.
- Mask secrets in logs, diagnostics, and UI.

## Refactoring priorities

1. Split `server.ts` into routes, services, repositories, and middleware.
2. Split `App.tsx` into pages, components, hooks, and API clients.
3. Add authentication and RBAC middleware.
4. Replace JSON file persistence with PostgreSQL.
5. Implement real upload, extraction, and storage adapters.
6. Implement real DOCX/PDF export.
7. Add automated tests.
