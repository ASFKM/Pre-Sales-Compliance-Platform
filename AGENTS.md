# Agent Operating Guide

This repository may be edited by AI coding agents. Agents must follow this guide before proposing code changes.

## Product context

Commercial Assistant AI is an enterprise pre-sales platform for:

- project workspaces;
- document classification and extraction;
- AI-assisted requirement, risk, opportunity, BOM, and schedule analysis;
- technical and commercial proposal generation;
- configurable approval workflows;
- audit, debug, and diagnostic governance.

The platform is intended for dedicated customer deployments, including on-premises or private cloud environments.

## Non-negotiable rules

- Never commit secrets, API keys, customer documents, tokens, private keys, or real credentials.
- Never move AI provider calls to frontend code.
- Never expose uploaded files, generated exports, templates, or runtime state without authorization.
- Never treat AI output as final approved content without human review.
- Never let a failed AI call silently become a successful production result.
- Never bypass RBAC for admin, audit, debug, diagnostic, settings, template, user, role, or integration endpoints.

## Preferred implementation approach

- Make small, reviewable PRs.
- Keep domain logic in services, not UI components.
- Keep persistence behind repositories.
- Validate all write inputs with schemas.
- Add audit logs for business/security actions.
- Add debug logs with correlation IDs for troubleshooting.
- Mask sensitive values before logging.
- Preserve support for Portuguese, English, and Spanish.

## Priority roadmap for agents

1. Security foundation: real auth, sessions, RBAC middleware, safe errors.
2. Document foundation: real upload, storage adapter, file validation, text extraction.
3. AI foundation: provider abstraction, prompt templates, structured output validation, failure handling.
4. Proposal foundation: real DOCX template engine, PDF export, versioning.
5. Deployment foundation: Docker, PostgreSQL, Redis, MinIO/local object storage.
6. Observability: health/readiness, correlation IDs, diagnostic ZIP, CI gates.

## Pull request expectations

Every PR must include:

- clear summary;
- affected module list;
- test/build evidence;
- security impact notes;
- rollback notes when relevant.
