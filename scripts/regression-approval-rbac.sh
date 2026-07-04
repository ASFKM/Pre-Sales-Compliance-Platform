#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

echo "=== REGRESSION: APPROVAL RBAC / STAGE TARGETS / RELEASE ==="

npm run lint
npm run build

sudo systemctl restart commercial-assistant-ai >/dev/null
sleep 2
curl -s -w "\nHTTP:%{http_code}\n" http://127.0.0.1:3000/api/health | grep -q "HTTP:200"

cleanup() {
  if [ -n "${GENERATED_DOCX_PATH:-}" ]; then
    rm -f "$GENERATED_DOCX_PATH"
  fi

  if [ -n "${GENERATED_PDF_PATH:-}" ]; then
    rm -f "$GENERATED_PDF_PATH"
  fi

  rm -f \
    /tmp/regression_approval_context.json \
    /tmp/regression_approval_export.docx \
    /tmp/regression_approval_final.docx \
    /tmp/regression_approval_final.pdf \
    /tmp/regression_approval_projects.json \
    /tmp/regression_approval_templates.json \
    /tmp/regression_approval_workflows.json \
    /tmp/regression_approval_users.json \
    /tmp/regression_approval_roles.json \
    /tmp/regression_approval_decisions.json \
    /tmp/regression_approval_release_audit.json
}
trap cleanup EXIT

login_token() {
  local email="$1"
  local login_response
  local token

  login_response="$(curl -s -X POST http://127.0.0.1:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"password123\"}")"

  token="$(echo "$login_response" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if(!j.token){console.error(s); process.exit(1)} console.log(j.token)})')"

  curl -s -X POST http://127.0.0.1:3000/api/auth/mfa/verify \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$token\",\"code\":\"123456\"}" >/dev/null

  echo "$token"
}

ADMIN_TOKEN="$(login_token "alex.rivera@enterprise.com")"
MANAGER_TOKEN="$(login_token "marcus.vance@enterprise.com")"
ENGINEER_TOKEN="$(login_token "elena.rostova@enterprise.com")"

curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "http://127.0.0.1:3000/api/projects" > /tmp/regression_approval_projects.json
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "http://127.0.0.1:3000/api/templates/proposals" > /tmp/regression_approval_templates.json
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "http://127.0.0.1:3000/api/approval-workflows" > /tmp/regression_approval_workflows.json

node - <<'NODE' > /tmp/regression_approval_context.json
const fs = require("fs");
const projects = JSON.parse(fs.readFileSync("/tmp/regression_approval_projects.json", "utf8"));
const proposalTemplates = JSON.parse(fs.readFileSync("/tmp/regression_approval_templates.json", "utf8"));
const approvalWorkflows = JSON.parse(fs.readFileSync("/tmp/regression_approval_workflows.json", "utf8"));

const project = projects[0];
const technicalTemplate =
  proposalTemplates.find(t => t.template_type === "technical" && t.default_template && t.active) ||
  proposalTemplates.find(t => t.template_type === "technical" && t.active);
const workflow = approvalWorkflows.find(w => w.id === "w1");

if (!project) throw new Error("NO_PROJECT_FOUND");
if (!technicalTemplate) throw new Error("NO_ACTIVE_TECHNICAL_TEMPLATE_FOUND");
if (!workflow) throw new Error("NO_W1_WORKFLOW_FOUND");

console.log(JSON.stringify({
  project_id: project.id,
  template_id: technicalTemplate.id,
  workflow_id: workflow.id,
  stage_r3: workflow.stages.find(s => s.approver_role_id === "r3")?.id,
  stage_r2: workflow.stages.find(s => s.approver_role_id === "r2")?.id,
  stage_r1: workflow.stages.find(s => s.approver_role_id === "r1")?.id
}));
NODE

PROJECT_ID="$(node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/regression_approval_context.json","utf8")); console.log(c.project_id)')"
TEMPLATE_ID="$(node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/regression_approval_context.json","utf8")); console.log(c.template_id)')"
WORKFLOW_ID="$(node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/regression_approval_context.json","utf8")); console.log(c.workflow_id)')"
STAGE_R3="$(node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/regression_approval_context.json","utf8")); console.log(c.stage_r3)')"
STAGE_R2="$(node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/regression_approval_context.json","utf8")); console.log(c.stage_r2)')"
STAGE_R1="$(node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/regression_approval_context.json","utf8")); console.log(c.stage_r1)')"

echo "Context: project=$PROJECT_ID template=$TEMPLATE_ID workflow=$WORKFLOW_ID stages=$STAGE_R3,$STAGE_R2,$STAGE_R1"

CREATE_RESPONSE="$(curl -s -X POST "http://127.0.0.1:3000/api/projects/$PROJECT_ID/proposals/technical" \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"template_id\":\"$TEMPLATE_ID\",\"language\":\"Portuguese\",\"payment_terms\":\"Net 30\",\"delivery_terms\":\"Delivery after approval\",\"proposal_validity\":\"90 days\"}")"

PROPOSAL_ID="$(echo "$CREATE_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if(!j.id){console.error(s); process.exit(1)} console.log(j.id)})')"
GENERATED_DOCX_PATH="$(echo "$CREATE_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); const p=String(j.docx_file_path || ""); console.log(p.startsWith("/") ? p.slice(1) : p)})')"
GENERATED_PDF_PATH="$(echo "$CREATE_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); const p=String(j.pdf_file_path || ""); console.log(p.startsWith("/") ? p.slice(1) : p)})')"
echo "Created proposal: $PROPOSAL_ID"
echo "Generated files: $GENERATED_DOCX_PATH $GENERATED_PDF_PATH"

curl -s -o /tmp/regression_approval_export.docx -w "HTTP:%{http_code}\n" \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  "http://127.0.0.1:3000/api/proposals/$PROPOSAL_ID/export/docx" | grep -q "HTTP:200"

file /tmp/regression_approval_export.docx | grep -q "Microsoft Word 2007+"

curl -s -w "\nHTTP:%{http_code}\n" -X POST "http://127.0.0.1:3000/api/proposals/$PROPOSAL_ID/approval/submit" \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"workflow_id\":\"$WORKFLOW_ID\"}" | grep -q "HTTP:403"

curl -s -w "\nHTTP:%{http_code}\n" -X POST "http://127.0.0.1:3000/api/proposals/$PROPOSAL_ID/approval/submit" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"workflow_id\":\"$WORKFLOW_ID\"}" | grep -q "HTTP:200"

curl -s -w "\nHTTP:%{http_code}\n" -X POST "http://127.0.0.1:3000/api/proposals/$PROPOSAL_ID/approval/decision" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"stage_id\":\"$STAGE_R1\",\"decision\":\"approved\",\"comments\":\"Manager attempting Admin-targeted stage.\"}" | grep -q "HTTP:403"

curl -s -w "\nHTTP:%{http_code}\n" -X POST "http://127.0.0.1:3000/api/proposals/$PROPOSAL_ID/approval/decision" \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"stage_id\":\"$STAGE_R3\",\"decision\":\"approved\",\"comments\":\"Technical verification approved.\"}" | grep -q "HTTP:200"

curl -s -w "\nHTTP:%{http_code}\n" -X POST "http://127.0.0.1:3000/api/proposals/$PROPOSAL_ID/approval/decision" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"stage_id\":\"$STAGE_R2\",\"decision\":\"approved\",\"comments\":\"Commercial validation approved.\"}" | grep -q "HTTP:200"

curl -s -w "\nHTTP:%{http_code}\n" -X POST "http://127.0.0.1:3000/api/proposals/$PROPOSAL_ID/approval/decision" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"stage_id\":\"$STAGE_R1\",\"decision\":\"approved\",\"comments\":\"Executive sign-off approved.\"}" | tee /tmp/regression_approval_admin_response.txt | grep -q "HTTP:200"

grep -q '"status":"approved"' /tmp/regression_approval_admin_response.txt
rm -f /tmp/regression_approval_admin_response.txt

curl -s -w "\nHTTP:%{http_code}\n" -X POST "http://127.0.0.1:3000/api/proposals/$PROPOSAL_ID/release" \
  -H "Authorization: Bearer $ENGINEER_TOKEN" | grep -q "HTTP:403"

curl -s -w "\nHTTP:%{http_code}\n" -X POST "http://127.0.0.1:3000/api/proposals/$PROPOSAL_ID/release" \
  -H "Authorization: Bearer $MANAGER_TOKEN" | tee /tmp/regression_approval_release_response.txt | grep -q "HTTP:200"

grep -q '"status":"released"' /tmp/regression_approval_release_response.txt
rm -f /tmp/regression_approval_release_response.txt

curl -s -o /tmp/regression_approval_final.docx -w "HTTP:%{http_code}\n" \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  "http://127.0.0.1:3000/api/proposals/$PROPOSAL_ID/export/docx" | grep -q "HTTP:200"

curl -s -o /tmp/regression_approval_final.pdf -w "HTTP:%{http_code}\n" \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  "http://127.0.0.1:3000/api/proposals/$PROPOSAL_ID/export/pdf" | grep -q "HTTP:200"

file /tmp/regression_approval_final.docx | grep -q "Microsoft Word 2007+"
file /tmp/regression_approval_final.pdf | grep -q "PDF document"

curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "http://127.0.0.1:3000/api/projects/$PROJECT_ID/proposals" > /tmp/regression_approval_proposals_final.json
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "http://127.0.0.1:3000/api/approval-decisions" > /tmp/regression_approval_decisions.json
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "http://127.0.0.1:3000/api/users" > /tmp/regression_approval_users.json
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "http://127.0.0.1:3000/api/roles" > /tmp/regression_approval_roles.json
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://127.0.0.1:3000/api/audit-logs?entity_id=$PROPOSAL_ID&action=Release%20Final%20Proposal" > /tmp/regression_approval_release_audit.json

node - "$PROPOSAL_ID" <<'NODE'
const fs = require("fs");
const proposalId = process.argv[2];

const proposals = JSON.parse(fs.readFileSync("/tmp/regression_approval_proposals_final.json", "utf8"));
const allDecisionsRaw = JSON.parse(fs.readFileSync("/tmp/regression_approval_decisions.json", "utf8"));
const users = JSON.parse(fs.readFileSync("/tmp/regression_approval_users.json", "utf8"));
const roles = JSON.parse(fs.readFileSync("/tmp/regression_approval_roles.json", "utf8"));
const releaseAuditLogs = JSON.parse(fs.readFileSync("/tmp/regression_approval_release_audit.json", "utf8"));

const proposal = proposals.find(p => p.id === proposalId);
const decisions = allDecisionsRaw.filter(d => d.proposal_id === proposalId).map(d => {
  const user = users.find(u => u.id === d.approver_user_id);
  const role = roles.find(r => r.id === user?.role_id);
  return { stage_id: d.stage_id, approver_role: role?.name, decision: d.decision };
});

const releaseAudit = releaseAuditLogs.slice(-1)[0];

if (proposal?.status !== "released") throw new Error("FINAL_STATUS_NOT_RELEASED");
if (decisions.length !== 3) throw new Error("DECISION_COUNT_INVALID");
if (!decisions.some(d => d.stage_id === "w1-s1" && d.approver_role === "Pre-Sales Engineer")) throw new Error("ENGINEER_STAGE_MISSING");
if (!decisions.some(d => d.stage_id === "w1-s2" && d.approver_role === "Sales Manager")) throw new Error("MANAGER_STAGE_MISSING");
if (!decisions.some(d => d.stage_id === "w1-s3" && d.approver_role === "Administrator")) throw new Error("ADMIN_STAGE_MISSING");
if (!releaseAudit) throw new Error("RELEASE_AUDIT_MISSING");

console.log(JSON.stringify({
  success: true,
  proposal_status: proposal.status,
  decisions,
  release_audit: JSON.parse(releaseAudit.metadata || "{}")
}, null, 2));
NODE

echo "=== REGRESSION PASSED ==="
