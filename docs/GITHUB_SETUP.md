# GitHub Repository Setup Guide

This document lists repository settings that cannot always be fully applied through code files. Apply these manually in GitHub when available.

## Branch protection / rulesets

Protect `main` with:

- Require pull request before merging.
- Require at least 1 approving review.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution before merge.
- Require status checks to pass.
- Required checks:
  - `Build and TypeScript check` from CI.
  - `Analyze JavaScript/TypeScript` from CodeQL.
  - `Dependency review`.
- Block force pushes.
- Block deletion.

## Security settings

Enable:

- Dependabot alerts.
- Dependabot security updates.
- Secret scanning.
- Push protection for secrets.
- CodeQL default setup or the committed CodeQL workflow.
- Private vulnerability reporting, if available.

## Repository insights and quality tracking

Use GitHub Insights to monitor:

- pull request cycle time;
- open security issues;
- dependency alerts;
- stale issues;
- contributor activity;
- CI failure frequency.

## GitHub Projects recommendation

Create a project board named `Commercial Assistant AI Roadmap` with these views:

1. Roadmap by priority.
2. Security hardening.
3. MVP foundation.
4. Proposal Studio.
5. Document Intelligence.
6. Backlog.

Suggested fields:

- Priority: P0, P1, P2, P3.
- Area: Security, Architecture, Frontend, Backend, AI, Documents, Proposal, DevOps, Docs.
- Status: Backlog, Ready, In Progress, In Review, Blocked, Done.
- Target milestone.
- Risk level.

## Labels recommendation

Create labels:

- `p0-critical`
- `p1-high`
- `p2-medium`
- `p3-low`
- `security`
- `quality`
- `architecture`
- `frontend`
- `backend`
- `ai`
- `documents`
- `proposal-studio`
- `approval-workflow`
- `devops`
- `documentation`

## Required repository secrets

Do not add secrets until deployment needs them. When needed, configure:

- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `SESSION_SECRET`
- `ENCRYPTION_KEY`
- Cloud storage credentials through OIDC or secure GitHub environments.

Prefer OpenID Connect for cloud deployments instead of long-lived cloud credentials.
