# Checkpoint: RBAC, Approval Stage Targets and Proposal Release

Date: 2026-07-03  
Tag: `checkpoint-rbac-approval-release-2026-07-03`  
Commit: `0954872ac7daa3422086b450d96cf19218889594`  
Branch: `main`

## Scope Closed

This checkpoint closes the functional cycle for:

- proposal permission enforcement;
- proposal export permission enforcement;
- proposal edit lock after draft submission;
- approval workflow state rules;
- approval stage target enforcement by configured user or role;
- final proposal release;
- admin console permission gating;
- frontend proposal action gating by session permissions;
- local regression coverage for approval RBAC and release flow.

## Main Behavior Validated

The approval workflow `w1` was validated with three mandatory role-targeted stages:

1. Pre-Sales Engineer stage: approved by `Elena Rostova`.
2. Sales Manager stage: approved by `Marcus Vance`.
3. Administrator stage: approved by `Alex Rivera`.

The validated flow confirms:

- Engineer can generate a technical proposal.
- Engineer can export DOCX when allowed.
- Engineer cannot submit the proposal for approval without `approval:manage`.
- Manager can submit the proposal for approval.
- Manager cannot approve the Administrator-targeted stage.
- Engineer can approve only the Engineer-targeted stage.
- Manager can approve only the Manager-targeted stage.
- Admin can approve only the Admin-targeted stage.
- Proposal status changes to `approved` after all mandatory stages are approved.
- Engineer cannot perform final release without `proposal:approve`.
- Manager can perform final release.
- Released proposal exports DOCX and PDF successfully.
- Release audit records `previous_status: approved` and `next_status: released`.

## Regression Command

Run the full local regression with:

    npm run regression:approval-rbac

The regression script validates:

- lint;
- production build;
- API health;
- proposal generation;
- DOCX export;
- approval submit permissions;
- stage-target approval restrictions;
- final release permissions;
- DOCX/PDF export after release;
- audit metadata;
- database restore after the test;
- cleanup of generated DOCX/PDF files.

## Stable Commits in This Cycle

- `7b595a1` - require proposal export permission
- `25fa344` - expose session permissions and gate proposal UI actions
- `5b6c80e` - gate admin console sections by permission
- `0f295ec` - enforce approval stage approver targets
- `5c67c3b` - align approval UI with stage approver targets
- `2c8a93b` - add approval RBAC regression script
- `8a28d65` - add approval RBAC regression npm script
- `0954872` - clean generated files in approval RBAC regression

## Validation Status

At checkpoint creation:

- `HEAD` equals `origin/main`;
- latest CI succeeded;
- local regression passed;
- `npm run lint` passed;
- `npm run build` passed;
- local service health returned HTTP 200;
- no orphan generated proposal files remained in `uploads/p1`;
- working tree was clean.

## Recovery

To inspect or restore this stable point:

    git checkout checkpoint-rbac-approval-release-2026-07-03

To return to active development:

    git checkout main
