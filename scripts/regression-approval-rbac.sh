#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

# A instancia alvo e parametrizavel: o CI sobe o app na 3000 (default abaixo, comportamento
# inalterado), mas o servidor de desenvolvimento roda APP_RUNTIME_MODE=production e recusa a senha
# de seed que este script usa - la a unica forma de executar de verdade e apontar para uma
# instancia descartavel em modo demo, noutra porta.
REG_BASE="${REGRESSION_BASE_URL:-http://127.0.0.1:3000}"

echo "=== REGRESSION: APPROVAL RBAC / STAGE TARGETS / RELEASE ==="

# lint/build/restart deliberately not repeated here - the CI workflow (.github/workflows/ci.yml)
# already does all three immediately before running this script. Just confirm the already-running
# server is actually up.
curl -s -w "\nHTTP:%{http_code}\n" $REG_BASE/api/health | grep -q "HTTP:200"

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
    /tmp/regression_approval_template_novo.json \
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

  login_response="$(curl -s -X POST $REG_BASE/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"Demonstracao2026!\"}")"

  token="$(echo "$login_response" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if(!j.token){console.error(s); process.exit(1)} console.log(j.token)})')"

  curl -s -X POST $REG_BASE/api/auth/mfa/verify \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$token\",\"code\":\"123456\"}" >/dev/null

  echo "$token"
}

ADMIN_TOKEN="$(login_token "alex.rivera@enterprise.com")"
MANAGER_TOKEN="$(login_token "marcus.vance@enterprise.com")"
ENGINEER_TOKEN="$(login_token "elena.rostova@enterprise.com")"

curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$REG_BASE/api/projects" > /tmp/regression_approval_projects.json
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$REG_BASE/api/templates/proposals" > /tmp/regression_approval_templates.json
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$REG_BASE/api/approval-workflows" > /tmp/regression_approval_workflows.json

node - <<'NODE' > /tmp/regression_approval_context.json
const fs = require("fs");
const projects = JSON.parse(fs.readFileSync("/tmp/regression_approval_projects.json", "utf8"));
const proposalTemplates = JSON.parse(fs.readFileSync("/tmp/regression_approval_templates.json", "utf8"));
const approvalWorkflows = JSON.parse(fs.readFileSync("/tmp/regression_approval_workflows.json", "utf8"));

const project = projects[0];
const workflow = approvalWorkflows.find(w => w.id === "w1");

if (!project) throw new Error("NO_PROJECT_FOUND");
if (!workflow) throw new Error("NO_W1_WORKFLOW_FOUND");

console.log(JSON.stringify({
  project_id: project.id,
  workflow_id: workflow.id,
  stage_r3: workflow.stages.find(s => s.approver_role_id === "r3")?.id,
  stage_r2: workflow.stages.find(s => s.approver_role_id === "r2")?.id,
  stage_r1: workflow.stages.find(s => s.approver_role_id === "r1")?.id
}));
NODE

PROJECT_ID="$(node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/regression_approval_context.json","utf8")); console.log(c.project_id)')"

# O TEMPLATE E CRIADO AQUI, por upload real do fixture — nao mais reaproveitado do seed.
#
# A F5 da rodada 09/2026 tornou o modelo .docx OBRIGATORIO para gerar proposta: sem arquivo no
# armazenamento a rota devolve 422 TEMPLATE_SEM_ARQUIVO antes de qualquer trabalho. Os templates
# que `prisma/seed.ts` cria tem `filePath` apontando para caminhos que NUNCA existiram no
# armazenamento do CI (`/templates/technical_swiss_v1.docx` e companhia), entao este script parou
# de conseguir gerar a proposta que ele precisa aprovar — e a falha so apareceu na F9, porque
# nenhuma fase da rodada abriu PR antes dela.
#
# Corrigido criando o template aqui, com o MESMO fixture que regression-admin-console.sh ja usa: um
# .docx OOXML minimo de verdade, versionado. Isso mantem o script independente do seed e exercita o
# caminho que o produto agora exige — template com arquivo real. Corrigir o seed em vez disto
# tambem funcionaria, mas colocaria um binario no seed de producao para servir a um script de CI.
TEMPLATE_FIXTURE="$BASE_DIR/scripts/fixtures/regression-template.docx"
curl -s -X POST "$REG_BASE/api/templates/proposals" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "name=Regression Approval RBAC $$" \
  -F "template_type=technical" \
  -F "language=Portuguese" \
  -F "variables_schema=[\"{{project.name}}\"]" \
  -F "file=@$TEMPLATE_FIXTURE;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" \
  > /tmp/regression_approval_template_novo.json

TEMPLATE_ID="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/regression_approval_template_novo.json","utf8")); if(!j.id){console.error(JSON.stringify(j)); process.exit(1)} console.log(j.id)')"
WORKFLOW_ID="$(node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/regression_approval_context.json","utf8")); console.log(c.workflow_id)')"
STAGE_R3="$(node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/regression_approval_context.json","utf8")); console.log(c.stage_r3)')"
STAGE_R2="$(node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/regression_approval_context.json","utf8")); console.log(c.stage_r2)')"
STAGE_R1="$(node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/regression_approval_context.json","utf8")); console.log(c.stage_r1)')"

echo "Context: project=$PROJECT_ID template=$TEMPLATE_ID workflow=$WORKFLOW_ID stages=$STAGE_R3,$STAGE_R2,$STAGE_R1"

CREATE_RESPONSE="$(curl -s -X POST "$REG_BASE/api/projects/$PROJECT_ID/proposals/technical" \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"template_id\":\"$TEMPLATE_ID\",\"language\":\"Portuguese\",\"payment_terms\":\"Net 30\",\"delivery_terms\":\"Delivery after approval\",\"proposal_validity\":\"90 days\"}")"

# Proposal generation runs in the background (Phase 1) - the endpoint above only hands back a
# task id, so poll it until the task reaches a terminal state before reading the proposal.
TASK_ID="$(echo "$CREATE_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if(!j.task_id){console.error(s); process.exit(1)} console.log(j.task_id)})')"

TASK_STATUS=""
for i in $(seq 1 30); do
  TASK_RESPONSE="$(curl -s "$REG_BASE/api/tasks/$TASK_ID" -H "Authorization: Bearer $ENGINEER_TOKEN")"
  TASK_STATUS="$(echo "$TASK_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); console.log(j.task?.status || "")})')"
  if [ "$TASK_STATUS" = "completed" ] || [ "$TASK_STATUS" = "failed" ]; then
    break
  fi
  sleep 1
done

if [ "$TASK_STATUS" != "completed" ]; then
  echo "Proposal generation task did not complete: $TASK_RESPONSE"
  exit 1
fi

PROPOSAL_ID="$(echo "$TASK_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); console.log(j.task.result_id)})')"

PROJECT_PROPOSALS="$(curl -s "$REG_BASE/api/projects/$PROJECT_ID/proposals" -H "Authorization: Bearer $ENGINEER_TOKEN")"
GENERATED_DOCX_PATH="$(echo "$PROJECT_PROPOSALS" | PROPOSAL_ID="$PROPOSAL_ID" node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const list=JSON.parse(s); const p=list.find(x=>x.id===process.env.PROPOSAL_ID); const path=String(p?.docx_file_path || ""); console.log(path.startsWith("/") ? path.slice(1) : path)})')"
GENERATED_PDF_PATH="$(echo "$PROJECT_PROPOSALS" | PROPOSAL_ID="$PROPOSAL_ID" node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const list=JSON.parse(s); const p=list.find(x=>x.id===process.env.PROPOSAL_ID); const path=String(p?.pdf_file_path || ""); console.log(path.startsWith("/") ? path.slice(1) : path)})')"
echo "Created proposal: $PROPOSAL_ID"
echo "Generated files: $GENERATED_DOCX_PATH $GENERATED_PDF_PATH"


# Um .docx e um ZIP com `word/document.xml` dentro — e e ISSO que se verifica aqui, em vez de
# perguntar ao `file` como se chama o que ele viu.
#
# A checagem anterior era `file ... | grep -q "Microsoft Word 2007+"`, e ela quebrou quando a F5
# desta rodada tornou o template .docx obrigatorio: o documento passou a ser o template REAL
# preenchido (antes vinha do gerador generico), o zip resultante e outro, e a base de assinaturas
# do `file` do runner deixou de rotula-lo assim. O export devolvia 200 com um .docx integro e o
# script reprovava mesmo assim.
#
# A verificacao nova e mais forte, nao mais fraca: assinatura PK do zip e a parte que faz de um zip
# um documento do Word. E ela diz o que viu quando falha — uma reprovacao que nao mostra o motivo
# custou um ciclo inteiro de CI para ser diagnosticada.
verificar_docx() {
  local arquivo="$1"
  local rotulo="$2"
  if [ "$(head -c 2 "$arquivo")" != "PK" ]; then
    echo "FALHA: $rotulo nao e um zip. file diz: $(file -b "$arquivo"); primeiros bytes:" >&2
    head -c 200 "$arquivo" >&2
    return 1
  fi
  if ! unzip -l "$arquivo" 2>/dev/null | grep -q "word/document.xml"; then
    echo "FALHA: $rotulo e um zip mas nao tem word/document.xml. Partes:" >&2
    unzip -l "$arquivo" >&2
    return 1
  fi
}

curl -s -o /tmp/regression_approval_export.docx -w "HTTP:%{http_code}\n" \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  "$REG_BASE/api/proposals/$PROPOSAL_ID/export/docx" | grep -q "HTTP:200"

verificar_docx /tmp/regression_approval_export.docx "o .docx exportado da proposta"

curl -s -w "\nHTTP:%{http_code}\n" -X POST "$REG_BASE/api/proposals/$PROPOSAL_ID/approval/submit" \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"workflow_id\":\"$WORKFLOW_ID\"}" | grep -q "HTTP:403"

curl -s -w "\nHTTP:%{http_code}\n" -X POST "$REG_BASE/api/proposals/$PROPOSAL_ID/approval/submit" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"workflow_id\":\"$WORKFLOW_ID\"}" | grep -q "HTTP:200"

curl -s -w "\nHTTP:%{http_code}\n" -X POST "$REG_BASE/api/proposals/$PROPOSAL_ID/approval/decision" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"stage_id\":\"$STAGE_R1\",\"decision\":\"approved\",\"comments\":\"Manager attempting Admin-targeted stage.\"}" | grep -q "HTTP:403"

curl -s -w "\nHTTP:%{http_code}\n" -X POST "$REG_BASE/api/proposals/$PROPOSAL_ID/approval/decision" \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"stage_id\":\"$STAGE_R3\",\"decision\":\"approved\",\"comments\":\"Technical verification approved.\"}" | grep -q "HTTP:200"

curl -s -w "\nHTTP:%{http_code}\n" -X POST "$REG_BASE/api/proposals/$PROPOSAL_ID/approval/decision" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"stage_id\":\"$STAGE_R2\",\"decision\":\"approved\",\"comments\":\"Commercial validation approved.\"}" | grep -q "HTTP:200"

curl -s -w "\nHTTP:%{http_code}\n" -X POST "$REG_BASE/api/proposals/$PROPOSAL_ID/approval/decision" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"stage_id\":\"$STAGE_R1\",\"decision\":\"approved\",\"comments\":\"Executive sign-off approved.\"}" | tee /tmp/regression_approval_admin_response.txt | grep -q "HTTP:200"

grep -q '"status":"approved"' /tmp/regression_approval_admin_response.txt
rm -f /tmp/regression_approval_admin_response.txt

curl -s -w "\nHTTP:%{http_code}\n" -X POST "$REG_BASE/api/proposals/$PROPOSAL_ID/release" \
  -H "Authorization: Bearer $ENGINEER_TOKEN" | grep -q "HTTP:403"

curl -s -w "\nHTTP:%{http_code}\n" -X POST "$REG_BASE/api/proposals/$PROPOSAL_ID/release" \
  -H "Authorization: Bearer $MANAGER_TOKEN" | tee /tmp/regression_approval_release_response.txt | grep -q "HTTP:200"

grep -q '"status":"released"' /tmp/regression_approval_release_response.txt
rm -f /tmp/regression_approval_release_response.txt

curl -s -o /tmp/regression_approval_final.docx -w "HTTP:%{http_code}\n" \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  "$REG_BASE/api/proposals/$PROPOSAL_ID/export/docx" | grep -q "HTTP:200"

curl -s -o /tmp/regression_approval_final.pdf -w "HTTP:%{http_code}\n" \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  "$REG_BASE/api/proposals/$PROPOSAL_ID/export/pdf" | grep -q "HTTP:200"

verificar_docx /tmp/regression_approval_final.docx "o .docx da proposta liberada"
file /tmp/regression_approval_final.pdf | grep -q "PDF document"

curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$REG_BASE/api/projects/$PROJECT_ID/proposals" > /tmp/regression_approval_proposals_final.json
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$REG_BASE/api/approval-decisions" > /tmp/regression_approval_decisions.json
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$REG_BASE/api/users" > /tmp/regression_approval_users.json
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$REG_BASE/api/roles" > /tmp/regression_approval_roles.json
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$REG_BASE/api/audit-logs?entity_id=$PROPOSAL_ID&action=Release%20Final%20Proposal" > /tmp/regression_approval_release_audit.json

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
