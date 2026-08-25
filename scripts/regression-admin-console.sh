#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

# A instancia alvo e parametrizavel: o CI sobe o app na 3000 (default abaixo, comportamento
# inalterado), mas o servidor de desenvolvimento roda APP_RUNTIME_MODE=production e recusa a senha
# de seed que este script usa - la a unica forma de executar de verdade e apontar para uma
# instancia descartavel em modo demo, noutra porta.
REG_BASE="${REGRESSION_BASE_URL:-$REG_BASE}"

echo "=== REGRESSION: ADMIN CONSOLE COMPACT ==="

cleanup() {
  rm -f /tmp/admin_reg_*.json /tmp/admin_reg_*.txt /tmp/admin_reg_*.csv
}
trap cleanup EXIT

ok() { echo "OK - $1"; }

fail() {
  echo "FAIL - $1"
  [ -f "${2:-}" ] && cat "$2"
  exit 1
}

expect() {
  local code="$1"
  local label="$2"
  local out="/tmp/admin_reg_response.json"
  shift 2

  local got
  got="$(curl -s -o "$out" -w "%{http_code}" "$@")"

  if [ "$got" != "$code" ]; then
    echo "Expected HTTP $code, got HTTP $got"
    fail "$label" "$out"
  fi

  ok "$label"
}

expect_save() {
  local code="$1"
  local label="$2"
  local out="$3"
  shift 3

  local got
  got="$(curl -s -o "$out" -w "%{http_code}" "$@")"

  if [ "$got" != "$code" ]; then
    echo "Expected HTTP $code, got HTTP $got"
    fail "$label" "$out"
  fi

  ok "$label"
}

login() {
  local email="$1"
  local out="/tmp/admin_reg_login.json"

  expect_save 200 "login $email" "$out" \
    -X POST $REG_BASE/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"password123\"}" >/dev/null

  local token
  token="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!j.token) process.exit(1); console.log(j.token)' "$out")"

  expect 200 "mfa $email" \
    -X POST $REG_BASE/api/auth/mfa/verify \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$token\",\"code\":\"123456\"}" >/dev/null

  echo "$token"
}

expect 200 "health" $REG_BASE/api/health >/dev/null

ADMIN_TOKEN="$(login "alex.rivera@enterprise.com")"
MANAGER_TOKEN="$(login "marcus.vance@enterprise.com")"
ENGINEER_TOKEN="$(login "elena.rostova@enterprise.com")"
SUFFIX="$(date +%s)_$RANDOM"

grep -rq '\["subscription"' src/ || fail "subscription menu missing"
grep -rq 'activeAdminSection === "subscription"' src/ || fail "subscription panel missing"
ok "subscription kept for last phase"

if grep -rq 'Desbloquear console de diagnóstico\|Unlock Diagnostic Console\|Fully Decrypted\|Totalmente Descriptografado\|Active Channels.*3' src/; then
  fail "admin diagnostics still contains mock/fake diagnostic copy"
fi
ok "diagnostics copy is enterprise-safe"

echo "Users/Roles"
expect 403 "manager cannot list users" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  $REG_BASE/api/users

expect_save 200 "admin lists users" /tmp/admin_reg_users.json \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  $REG_BASE/api/users

expect 403 "engineer cannot create role" \
  -X POST $REG_BASE/api/roles \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Blocked Role $SUFFIX\",\"permissions\":[\"project:read\"]}"


expect 400 "invalid role permission is blocked" \
  -X POST $REG_BASE/api/roles \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Invalid Permission Role $SUFFIX\",\"permissions\":[\"project:read\",\"invalid:permission\"]}"

expect_save 201 "admin creates role" /tmp/admin_reg_role.json \
  -X POST $REG_BASE/api/roles \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Regression Role $SUFFIX\",\"description\":\"tmp\",\"permissions\":[\"project:read\",\"document:read\"]}"

ROLE_ID="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/admin_reg_role.json","utf8")); console.log(j.id)')"

expect_save 201 "admin creates user" /tmp/admin_reg_user.json \
  -X POST $REG_BASE/api/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Regression User $SUFFIX\",\"email\":\"regression_$SUFFIX@example.com\",\"role_id\":\"$ROLE_ID\",\"initial_password\":\"ChangeMe123!\"}"

USER_ID="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/admin_reg_user.json","utf8")); console.log(j.id)')"


expect 409 "duplicate user email is blocked" \
  -X POST $REG_BASE/api/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Duplicate User $SUFFIX\",\"email\":\"regression_$SUFFIX@example.com\",\"role_id\":\"$ROLE_ID\",\"initial_password\":\"ChangeMe123\"}"

expect 400 "missing user role is blocked" \
  -X POST $REG_BASE/api/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Missing Role User $SUFFIX\",\"email\":\"missing_role_$SUFFIX@example.com\",\"role_id\":\"role_missing\",\"initial_password\":\"ChangeMe123\"}"

expect 400 "self delete is blocked" \
  -X DELETE $REG_BASE/api/users/u1 \
  -H "Authorization: Bearer $ADMIN_TOKEN"

expect 200 "admin updates user" \
  -X PUT "$REG_BASE/api/users/$USER_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Regression User Updated","mfa_enabled":true}'

expect 200 "admin deletes user" \
  -X DELETE "$REG_BASE/api/users/$USER_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

expect 200 "admin deletes role" \
  -X DELETE "$REG_BASE/api/roles/$ROLE_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

echo "Settings/AI/Prompts/Branding/Storage"
expect 403 "engineer cannot update settings" \
  -X PUT $REG_BASE/api/settings \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"default_log_level":"INFO"}'

expect 200 "manager updates settings" \
  -X PUT $REG_BASE/api/settings \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"default_log_level":"DEBUG"}'

expect 400 "invalid global language is blocked" \
  -X PUT $REG_BASE/api/settings \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"default_language\":\"German\"}"

expect 400 "invalid global log level is blocked" \
  -X PUT $REG_BASE/api/settings \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"default_log_level\":\"TRACE\"}"

expect 400 "global settings reject ai scoped field" \
  -X PUT $REG_BASE/api/settings \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"ai_provider\":\"Bypass Provider\"}"

expect 400 "global settings reject storage scoped field" \
  -X PUT $REG_BASE/api/settings \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"storage_mode\":\"s3\"}"

expect 403 "manager cannot update ai settings" \
  -X PUT $REG_BASE/api/settings/ai \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ai_provider":"Google Gemini"}'

expect 200 "admin updates ai settings" \
  -X PUT $REG_BASE/api/settings/ai \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ai_provider":"Google Gemini","document_analysis_model":"gemini-3.5-flash"}'

expect 400 "empty ai model is blocked" \
  -X PUT $REG_BASE/api/settings/ai \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"document_analysis_model\":\"\"}"

expect 400 "invalid ai language is blocked" \
  -X PUT $REG_BASE/api/settings/ai \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"default_language\":\"German\"}"

expect 400 "invalid ai log level is blocked" \
  -X PUT $REG_BASE/api/settings/ai \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"default_log_level\":\"TRACE\"}"

expect_save 200 "admin lists prompts" /tmp/admin_reg_prompts.json \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  $REG_BASE/api/settings/prompts

PROMPT_ID="$(node -e 'const fs=require("fs"); const a=JSON.parse(fs.readFileSync("/tmp/admin_reg_prompts.json","utf8")); if(!a[0]?.id) process.exit(1); console.log(a[0].id)')"

expect 200 "admin updates prompt" \
  -X PUT "$REG_BASE/api/settings/prompts/$PROMPT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"Regression prompt content."}'

expect 400 "empty prompt content is blocked" \
  -X PUT "$REG_BASE/api/settings/prompts/$PROMPT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"\"}"

expect 400 "invalid prompt language is blocked" \
  -X PUT "$REG_BASE/api/settings/prompts/$PROMPT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"language\":\"German\"}"

expect 400 "invalid prompt boolean is blocked" \
  -X PUT "$REG_BASE/api/settings/prompts/$PROMPT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"is_active\":\"yes\"}"

expect 403 "manager cannot update branding" \
  -X PUT $REG_BASE/api/branding \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"company_name":"Blocked"}'

expect 200 "admin updates branding" \
  -X PUT $REG_BASE/api/branding \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"company_name":"Assistant AI Regression"}'

expect 400 "empty company name is blocked" \
  -X PUT $REG_BASE/api/branding \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"company_name\":\"\"}"

expect 400 "invalid branding color is blocked" \
  -X PUT $REG_BASE/api/branding \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"primary_color\":\"green\"}"

expect 400 "invalid branding theme is blocked" \
  -X PUT $REG_BASE/api/branding \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"default_theme\":\"auto\"}"

expect 400 "unsafe branding logo path is blocked" \
  -X PUT $REG_BASE/api/branding \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"company_logo_path\":\"https://example.com/logo.png\"}"

expect 403 "manager cannot test storage" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  $REG_BASE/api/settings/storage/status

expect 200 "admin tests storage" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  $REG_BASE/api/settings/storage/status

expect 403 "manager cannot update storage" \
  -X PUT $REG_BASE/api/settings/storage \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"storage_mode\":\"local\"}"

expect 400 "invalid storage mode is blocked" \
  -X PUT $REG_BASE/api/settings/storage \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"storage_mode\":\"ftp\"}"

expect 400 "invalid local storage path is blocked" \
  -X PUT $REG_BASE/api/settings/storage \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"local_storage_path\":\"/\"}"

expect 400 "storage bucket url is blocked" \
  -X PUT $REG_BASE/api/settings/storage \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"storage_mode\":\"s3\",\"s3_bucket\":\"https://example.com/bucket\"}"

echo "Templates/Workflows/Integrations"
# POST /api/templates/proposals takes a real multipart file upload (upload.single("file")) - file_type
# and file_path are derived server-side from the uploaded file itself, never accepted as client
# fields. TEMPLATE_FIXTURE is a real minimal OOXML .docx (a valid ZIP with word/document.xml
# containing a literal {{project.name}} placeholder) so the /validate step below, which actually
# opens the file with docxtemplater to extract real placeholders, has real content to parse instead
# of failing on a fake binary.
TEMPLATE_FIXTURE="$BASE_DIR/scripts/fixtures/regression-template.docx"

expect_save 201 "admin creates template" /tmp/admin_reg_template.json \
  -X POST $REG_BASE/api/templates/proposals \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "name=Regression Template $SUFFIX" \
  -F "template_type=technical" \
  -F "language=Portuguese" \
  -F "variables_schema=[\"{{project.name}}\"]" \
  -F "file=@$TEMPLATE_FIXTURE;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document"

TPL_ID="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/admin_reg_template.json","utf8")); console.log(j.id)')"

expect 409 "duplicate template name is blocked" \
  -X POST $REG_BASE/api/templates/proposals \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "name=Regression Template $SUFFIX" \
  -F "template_type=technical" \
  -F "language=Portuguese" \
  -F "file=@$TEMPLATE_FIXTURE;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document"

expect 400 "unsupported template file type is blocked" \
  -X POST $REG_BASE/api/templates/proposals \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "name=Mismatch Template $SUFFIX" \
  -F "template_type=technical" \
  -F "language=Portuguese" \
  -F "file=@$TEMPLATE_FIXTURE;filename=mismatch.txt;type=text/plain"

expect 200 "admin validates template" \
  -X POST "$REG_BASE/api/templates/proposals/$TPL_ID/validate" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

expect 200 "admin deletes template" \
  -X DELETE "$REG_BASE/api/templates/proposals/$TPL_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

expect_save 201 "admin creates workflow" /tmp/admin_reg_workflow.json \
  -X POST $REG_BASE/api/approval-workflows \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Regression Workflow $SUFFIX\",\"active\":true,\"stages\":[{\"name\":\"Review\",\"approver_type\":\"role\",\"approver_role_id\":\"r3\",\"mandatory\":true}]}"

WF_ID="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/admin_reg_workflow.json","utf8")); console.log(j.id)')"

expect 409 "duplicate workflow name is blocked" \
  -X POST $REG_BASE/api/approval-workflows \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Regression Workflow $SUFFIX\",\"active\":true,\"stages\":[{\"name\":\"Review\",\"approver_type\":\"role\",\"approver_role_id\":\"r3\",\"mandatory\":true}]}"

expect 400 "workflow invalid role approver is blocked" \
  -X POST $REG_BASE/api/approval-workflows \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Invalid Workflow $SUFFIX\",\"active\":true,\"stages\":[{\"name\":\"Review\",\"approver_type\":\"role\",\"approver_role_id\":\"role_missing\",\"mandatory\":true}]}"

expect 200 "admin deletes workflow" \
  -X DELETE "$REG_BASE/api/approval-workflows/$WF_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

expect_save 201 "admin creates integration" /tmp/admin_reg_integration.json \
  -X POST $REG_BASE/api/integrations \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Regression Integration $SUFFIX\",\"type\":\"CRM\",\"url\":\"https://api.example.com/v1\",\"token\":\"regression-secret-token\"}"

node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/admin_reg_integration.json","utf8")); if(JSON.stringify(j).includes("regression-secret-token")) process.exit(1);'

INT_ID="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/admin_reg_integration.json","utf8")); console.log(j.id)')"

expect_save 200 "admin validates integration configuration" /tmp/admin_reg_integration_test.json \
  -X POST "$REG_BASE/api/integrations/$INT_ID/test" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

node - <<'NODE'
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("/tmp/admin_reg_integration_test.json", "utf8"));
if (j.validation_mode !== "configuration_only") process.exit(1);
if (j.external_sync_executed !== false) process.exit(1);
if (j.latency_ms !== null) process.exit(1);
NODE

expect 200 "admin deletes integration" \
  -X DELETE "$REG_BASE/api/integrations/$INT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

echo "Audit/Diagnostics"
expect 403 "manager cannot audit" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  $REG_BASE/api/audit-logs

expect 200 "admin audit" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$REG_BASE/api/audit-logs?limit=5"

expect 400 "invalid audit from date is blocked" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$REG_BASE/api/audit-logs?from=not-a-date"

expect 400 "invalid audit date range is blocked" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$REG_BASE/api/audit-logs?from=2026-07-02T00:00:00Z&to=2026-07-01T00:00:00Z"

LONG_AUDIT_Q="$(node -e 'console.log("x".repeat(201))')"
expect 400 "long audit query is blocked" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$REG_BASE/api/audit-logs?q=$LONG_AUDIT_Q"

expect_save 200 "admin audit csv" /tmp/admin_reg_audit.csv \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  $REG_BASE/api/audit-logs/export/csv

grep -q "Timestamp" /tmp/admin_reg_audit.csv || fail "audit csv invalid"

expect 403 "manager cannot view system status" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  $REG_BASE/api/admin/system/status

expect 403 "manager cannot download diagnostics" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  $REG_BASE/api/admin/diagnostics/package/download

expect 200 "admin system status" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  $REG_BASE/api/admin/system/status

expect_save 200 "admin diagnostics package json" /tmp/admin_reg_diag.json \
  -X POST $REG_BASE/api/admin/diagnostics/package \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Correlation-Id: regression/unsafe correlation id" \
  -H "Content-Type: application/json" \
  -d "{}"

grep -q "correlation_id" /tmp/admin_reg_diag.json || fail "diagnostics json missing correlation id"
if grep -q "regression/unsafe correlation id" /tmp/admin_reg_diag.json; then
  fail "diagnostics correlation id was not sanitized"
fi

expect_save 200 "admin diagnostics download" /tmp/admin_reg_diag.txt \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  $REG_BASE/api/admin/diagnostics/package/download

grep -q "SANITIZED DIAGNOSTIC PACKAGE" /tmp/admin_reg_diag.txt || fail "diagnostics invalid"

echo "Audit actions"
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$REG_BASE/api/audit-logs?limit=1000" > /tmp/admin_reg_audit.json
node - <<'NODE'
const fs = require("fs");
const auditLogs = JSON.parse(fs.readFileSync("/tmp/admin_reg_audit.json", "utf8"));
const actions = new Set((auditLogs || []).map(a => a.action));
const required = [
  "Create User",
  "Update User Record",
  "Delete User Account",
  "Create Role",
  "Delete Role",
  "Update AI Platform Settings",
  "Update Branding Settings",
  "Create Proposal Template",
  "Delete Proposal Template",
  "Create Approval Workflow",
  "Delete Approval Workflow",
  "Add Integration Connector",
  "Validate Integration Configuration",
  "Remove Integration"
];
const missing = required.filter(a => !actions.has(a));
if (missing.length) {
  console.error(JSON.stringify({ missing }, null, 2));
  process.exit(1);
}
console.log("OK - audit actions");
NODE

echo "=== ADMIN CONSOLE REGRESSION PASSED ==="
