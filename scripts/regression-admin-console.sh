#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

echo "=== REGRESSION: ADMIN CONSOLE COMPACT ==="

DB_BAK="$(mktemp)"
cp db_state.json "$DB_BAK"

cleanup() {
  cp "$DB_BAK" db_state.json
  rm -f "$DB_BAK" /tmp/admin_reg_*.json /tmp/admin_reg_*.txt /tmp/admin_reg_*.csv
  sudo systemctl restart commercial-assistant-ai >/dev/null 2>&1 || true
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
    -X POST http://127.0.0.1:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"password123\"}" >/dev/null

  local token
  token="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!j.token) process.exit(1); console.log(j.token)' "$out")"

  expect 200 "mfa $email" \
    -X POST http://127.0.0.1:3000/api/auth/mfa/verify \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$token\",\"code\":\"123456\"}" >/dev/null

  echo "$token"
}

expect 200 "health" http://127.0.0.1:3000/api/health >/dev/null

ADMIN_TOKEN="$(login "alex.rivera@enterprise.com")"
MANAGER_TOKEN="$(login "marcus.vance@enterprise.com")"
ENGINEER_TOKEN="$(login "elena.rostova@enterprise.com")"
SUFFIX="$(date +%s)_$RANDOM"

grep -q '\["subscription"' src/App.tsx || fail "subscription menu missing"
grep -q 'activeAdminSection === "subscription"' src/App.tsx || fail "subscription panel missing"
ok "subscription kept for last phase"

if grep -q 'Desbloquear console de diagnóstico\|Unlock Diagnostic Console\|Fully Decrypted\|Totalmente Descriptografado\|Active Channels.*3' src/App.tsx; then
  fail "admin diagnostics still contains mock/fake diagnostic copy"
fi
ok "diagnostics copy is enterprise-safe"

echo "Users/Roles"
expect 403 "manager cannot list users" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  http://127.0.0.1:3000/api/users

expect_save 200 "admin lists users" /tmp/admin_reg_users.json \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://127.0.0.1:3000/api/users

expect 403 "engineer cannot create role" \
  -X POST http://127.0.0.1:3000/api/roles \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Blocked Role $SUFFIX\",\"permissions\":[\"project:read\"]}"


expect 400 "invalid role permission is blocked" \
  -X POST http://127.0.0.1:3000/api/roles \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Invalid Permission Role $SUFFIX\",\"permissions\":[\"project:read\",\"invalid:permission\"]}"

expect_save 201 "admin creates role" /tmp/admin_reg_role.json \
  -X POST http://127.0.0.1:3000/api/roles \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Regression Role $SUFFIX\",\"description\":\"tmp\",\"permissions\":[\"project:read\",\"document:read\"]}"

ROLE_ID="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/admin_reg_role.json","utf8")); console.log(j.id)')"

expect_save 201 "admin creates user" /tmp/admin_reg_user.json \
  -X POST http://127.0.0.1:3000/api/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Regression User $SUFFIX\",\"email\":\"regression_$SUFFIX@example.com\",\"role_id\":\"$ROLE_ID\",\"initial_password\":\"ChangeMe123!\"}"

USER_ID="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/admin_reg_user.json","utf8")); console.log(j.id)')"


expect 409 "duplicate user email is blocked" \
  -X POST http://127.0.0.1:3000/api/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Duplicate User $SUFFIX\",\"email\":\"regression_$SUFFIX@example.com\",\"role_id\":\"$ROLE_ID\",\"initial_password\":\"ChangeMe123\"}"

expect 400 "missing user role is blocked" \
  -X POST http://127.0.0.1:3000/api/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Missing Role User $SUFFIX\",\"email\":\"missing_role_$SUFFIX@example.com\",\"role_id\":\"role_missing\",\"initial_password\":\"ChangeMe123\"}"

expect 400 "self delete is blocked" \
  -X DELETE http://127.0.0.1:3000/api/users/u1 \
  -H "Authorization: Bearer $ADMIN_TOKEN"

expect 200 "admin updates user" \
  -X PUT "http://127.0.0.1:3000/api/users/$USER_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Regression User Updated","mfa_enabled":true}'

expect 200 "admin deletes user" \
  -X DELETE "http://127.0.0.1:3000/api/users/$USER_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

expect 200 "admin deletes role" \
  -X DELETE "http://127.0.0.1:3000/api/roles/$ROLE_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

echo "Settings/AI/Prompts/Branding/Storage"
expect 403 "engineer cannot update settings" \
  -X PUT http://127.0.0.1:3000/api/settings \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"default_log_level":"INFO"}'

expect 200 "manager updates settings" \
  -X PUT http://127.0.0.1:3000/api/settings \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"default_log_level":"DEBUG"}'

expect 400 "invalid global language is blocked" \
  -X PUT http://127.0.0.1:3000/api/settings \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"default_language\":\"German\"}"

expect 400 "invalid global log level is blocked" \
  -X PUT http://127.0.0.1:3000/api/settings \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"default_log_level\":\"TRACE\"}"

expect 400 "global settings reject ai scoped field" \
  -X PUT http://127.0.0.1:3000/api/settings \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"ai_provider\":\"Bypass Provider\"}"

expect 400 "global settings reject storage scoped field" \
  -X PUT http://127.0.0.1:3000/api/settings \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"storage_mode\":\"s3\"}"

expect 403 "manager cannot update ai settings" \
  -X PUT http://127.0.0.1:3000/api/settings/ai \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ai_provider":"Google Gemini"}'

expect 200 "admin updates ai settings" \
  -X PUT http://127.0.0.1:3000/api/settings/ai \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ai_provider":"Google Gemini","document_analysis_model":"gemini-3.5-flash"}'

expect 400 "empty ai model is blocked" \
  -X PUT http://127.0.0.1:3000/api/settings/ai \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"document_analysis_model\":\"\"}"

expect 400 "invalid ai language is blocked" \
  -X PUT http://127.0.0.1:3000/api/settings/ai \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"default_language\":\"German\"}"

expect 400 "invalid ai log level is blocked" \
  -X PUT http://127.0.0.1:3000/api/settings/ai \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"default_log_level\":\"TRACE\"}"

expect_save 200 "admin lists prompts" /tmp/admin_reg_prompts.json \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://127.0.0.1:3000/api/settings/prompts

PROMPT_ID="$(node -e 'const fs=require("fs"); const a=JSON.parse(fs.readFileSync("/tmp/admin_reg_prompts.json","utf8")); if(!a[0]?.id) process.exit(1); console.log(a[0].id)')"

expect 200 "admin updates prompt" \
  -X PUT "http://127.0.0.1:3000/api/settings/prompts/$PROMPT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"Regression prompt content."}'

expect 400 "empty prompt content is blocked" \
  -X PUT "http://127.0.0.1:3000/api/settings/prompts/$PROMPT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"\"}"

expect 400 "invalid prompt language is blocked" \
  -X PUT "http://127.0.0.1:3000/api/settings/prompts/$PROMPT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"language\":\"German\"}"

expect 400 "invalid prompt boolean is blocked" \
  -X PUT "http://127.0.0.1:3000/api/settings/prompts/$PROMPT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"is_active\":\"yes\"}"

expect 403 "manager cannot update branding" \
  -X PUT http://127.0.0.1:3000/api/branding \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"company_name":"Blocked"}'

expect 200 "admin updates branding" \
  -X PUT http://127.0.0.1:3000/api/branding \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"company_name":"Assistant AI Regression"}'

expect 400 "empty company name is blocked" \
  -X PUT http://127.0.0.1:3000/api/branding \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"company_name\":\"\"}"

expect 400 "invalid branding color is blocked" \
  -X PUT http://127.0.0.1:3000/api/branding \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"primary_color\":\"green\"}"

expect 400 "invalid branding theme is blocked" \
  -X PUT http://127.0.0.1:3000/api/branding \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"default_theme\":\"auto\"}"

expect 400 "unsafe branding logo path is blocked" \
  -X PUT http://127.0.0.1:3000/api/branding \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"company_logo_path\":\"https://example.com/logo.png\"}"

expect 403 "manager cannot test storage" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  http://127.0.0.1:3000/api/settings/storage/status

expect 200 "admin tests storage" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://127.0.0.1:3000/api/settings/storage/status

expect 403 "manager cannot update storage" \
  -X PUT http://127.0.0.1:3000/api/settings/storage \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"storage_mode\":\"local\"}"

expect 400 "invalid storage mode is blocked" \
  -X PUT http://127.0.0.1:3000/api/settings/storage \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"storage_mode\":\"ftp\"}"

expect 400 "invalid local storage path is blocked" \
  -X PUT http://127.0.0.1:3000/api/settings/storage \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"local_storage_path\":\"/\"}"

expect 400 "storage bucket url is blocked" \
  -X PUT http://127.0.0.1:3000/api/settings/storage \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"storage_mode\":\"s3\",\"s3_bucket\":\"https://example.com/bucket\"}"

echo "Templates/Workflows/Integrations"
expect_save 201 "admin creates template" /tmp/admin_reg_template.json \
  -X POST http://127.0.0.1:3000/api/templates/proposals \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Regression Template $SUFFIX\",\"template_type\":\"technical\",\"language\":\"Portuguese\",\"file_type\":\"docx\",\"file_path\":\"/templates/regression.docx\",\"variables_schema\":\"[\\\"{{project.name}}\\\"]\"}"

TPL_ID="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/admin_reg_template.json","utf8")); console.log(j.id)')"

expect 409 "duplicate template name is blocked" \
  -X POST http://127.0.0.1:3000/api/templates/proposals \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Regression Template $SUFFIX\",\"template_type\":\"technical\",\"language\":\"Portuguese\",\"file_type\":\"docx\",\"file_path\":\"/templates/duplicate.docx\",\"variables_schema\":\"[]\"}"

expect 400 "template file type mismatch is blocked" \
  -X POST http://127.0.0.1:3000/api/templates/proposals \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Mismatch Template $SUFFIX\",\"template_type\":\"technical\",\"language\":\"Portuguese\",\"file_type\":\"docx\",\"file_path\":\"/templates/mismatch.pdf\",\"variables_schema\":\"[]\"}"

expect 200 "admin validates template" \
  -X POST "http://127.0.0.1:3000/api/templates/proposals/$TPL_ID/validate" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

expect 200 "admin deletes template" \
  -X DELETE "http://127.0.0.1:3000/api/templates/proposals/$TPL_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

expect_save 201 "admin creates workflow" /tmp/admin_reg_workflow.json \
  -X POST http://127.0.0.1:3000/api/approval-workflows \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Regression Workflow $SUFFIX\",\"active\":true,\"stages\":[{\"name\":\"Review\",\"approver_type\":\"role\",\"approver_role_id\":\"r3\",\"mandatory\":true}]}"

WF_ID="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/admin_reg_workflow.json","utf8")); console.log(j.id)')"

expect 409 "duplicate workflow name is blocked" \
  -X POST http://127.0.0.1:3000/api/approval-workflows \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Regression Workflow $SUFFIX\",\"active\":true,\"stages\":[{\"name\":\"Review\",\"approver_type\":\"role\",\"approver_role_id\":\"r3\",\"mandatory\":true}]}"

expect 400 "workflow invalid role approver is blocked" \
  -X POST http://127.0.0.1:3000/api/approval-workflows \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Invalid Workflow $SUFFIX\",\"active\":true,\"stages\":[{\"name\":\"Review\",\"approver_type\":\"role\",\"approver_role_id\":\"role_missing\",\"mandatory\":true}]}"

expect 200 "admin deletes workflow" \
  -X DELETE "http://127.0.0.1:3000/api/approval-workflows/$WF_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

expect_save 201 "admin creates integration" /tmp/admin_reg_integration.json \
  -X POST http://127.0.0.1:3000/api/integrations \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Regression Integration $SUFFIX\",\"type\":\"CRM\",\"url\":\"https://api.example.com/v1\",\"token\":\"regression-secret-token\"}"

node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/admin_reg_integration.json","utf8")); if(JSON.stringify(j).includes("regression-secret-token")) process.exit(1);'

INT_ID="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/admin_reg_integration.json","utf8")); console.log(j.id)')"

expect_save 200 "admin validates integration configuration" /tmp/admin_reg_integration_test.json \
  -X POST "http://127.0.0.1:3000/api/integrations/$INT_ID/test" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

node - <<'NODE'
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("/tmp/admin_reg_integration_test.json", "utf8"));
if (j.validation_mode !== "configuration_only") process.exit(1);
if (j.external_sync_executed !== false) process.exit(1);
if (j.latency_ms !== null) process.exit(1);
NODE

expect 200 "admin deletes integration" \
  -X DELETE "http://127.0.0.1:3000/api/integrations/$INT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

echo "Audit/Diagnostics"
expect 403 "manager cannot audit" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  http://127.0.0.1:3000/api/audit-logs

expect 200 "admin audit" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://127.0.0.1:3000/api/audit-logs?limit=5"

expect_save 200 "admin audit csv" /tmp/admin_reg_audit.csv \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://127.0.0.1:3000/api/audit-logs/export/csv

grep -q "Timestamp" /tmp/admin_reg_audit.csv || fail "audit csv invalid"

expect 200 "admin system status" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://127.0.0.1:3000/api/admin/system/status

expect_save 200 "admin diagnostics download" /tmp/admin_reg_diag.txt \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://127.0.0.1:3000/api/admin/diagnostics/package/download

grep -q "SANITIZED DIAGNOSTIC PACKAGE" /tmp/admin_reg_diag.txt || fail "diagnostics invalid"

echo "Audit actions"
node - <<'NODE'
const fs = require("fs");
const db = JSON.parse(fs.readFileSync("db_state.json", "utf8"));
const actions = new Set((db.auditLogs || []).map(a => a.action));
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
