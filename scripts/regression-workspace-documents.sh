#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

echo "=== REGRESSION: WORKSPACE DOCUMENTS / RBAC / CONTENT / CLEANUP ==="

npm run lint
npm run build

sudo systemctl restart commercial-assistant-ai >/dev/null
sleep 2
curl -s -w "\nHTTP:%{http_code}\n" http://127.0.0.1:3000/api/health | grep -q "HTTP:200"

UPLOADED_DOC_ID=""
UPLOADED_STORAGE_PATH=""

cleanup() {
  if [ -n "${UPLOADED_STORAGE_PATH:-}" ]; then
    rm -f "$UPLOADED_STORAGE_PATH"
  fi

  rm -f \
    /tmp/regression_workspace_doc.txt \
    /tmp/regression_workspace_invalid.exe \
    /tmp/regression_workspace_upload_response.json \
    /tmp/regression_workspace_content_response.json \
    /tmp/regression_workspace_reclassify_response.json \
    /tmp/regression_workspace_content_check.json \
    /tmp/regression_workspace_audit_upload.json \
    /tmp/regression_workspace_audit_reclassify.json \
    /tmp/regression_workspace_audit_delete.json
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

echo
echo "=== PREPARAR STORAGE LOCAL TEMPORARIO PARA REGRESSAO ==="
curl -s -w "\nHTTP:%{http_code}\n" -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"storage_mode":"local","local_storage_path":"./uploads"}' \
  http://127.0.0.1:3000/api/settings/storage | grep -q "HTTP:200"

echo
echo "=== 1) LISTA SEM TOKEN DEVE FALHAR ==="
curl -s -w "\nHTTP:%{http_code}\n" \
  http://127.0.0.1:3000/api/projects/p1/documents | grep -q "HTTP:401"

echo
echo "=== 2) LISTA COM MANAGER DEVE FUNCIONAR ==="
curl -s -w "\nHTTP:%{http_code}\n" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  http://127.0.0.1:3000/api/projects/p1/documents | tee /tmp/regression_workspace_list_response.json | grep -q "HTTP:200"
rm -f /tmp/regression_workspace_list_response.json

echo
echo "=== 3) UPLOAD INVALIDO DEVE FALHAR ==="
printf 'invalid binary payload\n' > /tmp/regression_workspace_invalid.exe

curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -F "file=@/tmp/regression_workspace_invalid.exe;type=application/octet-stream" \
  http://127.0.0.1:3000/api/projects/p1/documents | grep -q "HTTP:400"

echo
echo "=== 4) MANAGER FAZ UPLOAD TXT VALIDO ==="
cat > /tmp/regression_workspace_doc.txt <<'TXT'
Documento de regressao Workspace Documents.

Cliente: Metro Transit Authority
Escopo: ITS, CFTV rodoviario, analise de conformidade e proposta tecnica.
Requisito: validar upload, extracao de texto, preview, reclassificacao, RBAC e limpeza.
TXT

UPLOAD_HTTP="$(curl -s -o /tmp/regression_workspace_upload_response.json -w "HTTP:%{http_code}\n" -X POST \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -F "file=@/tmp/regression_workspace_doc.txt;type=text/plain" \
  http://127.0.0.1:3000/api/projects/p1/documents)"

echo "$UPLOAD_HTTP"
echo "$UPLOAD_HTTP" | grep -q "HTTP:211"

cat /tmp/regression_workspace_upload_response.json

UPLOADED_DOC_ID="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/regression_workspace_upload_response.json","utf8")); if(!j.id){process.exit(1)} console.log(j.id)')"
UPLOADED_STORAGE_PATH="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/regression_workspace_upload_response.json","utf8")); let p=String(j.storage_path || ""); if (p.startsWith("local://")) p=p.slice("local://".length); else if (p.startsWith("/uploads/")) p=p.slice(1); console.log(p)')"

echo
echo "Uploaded document: $UPLOADED_DOC_ID"
echo "Uploaded storage path: $UPLOADED_STORAGE_PATH"

test -f "$UPLOADED_STORAGE_PATH"

echo
echo "=== 5) CONTEUDO EXTRAIDO DEVE ESTAR DISPONIVEL ==="
curl -s -o /tmp/regression_workspace_content_response.json -w "HTTP:%{http_code}\n" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  "http://127.0.0.1:3000/api/documents/$UPLOADED_DOC_ID/content" | grep -q "HTTP:200"

node - <<'NODE'
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("/tmp/regression_workspace_content_response.json", "utf8"));

if (!j.success) throw new Error("CONTENT_SUCCESS_FALSE");
if (!j.document?.id) throw new Error("CONTENT_DOCUMENT_MISSING");
if (!String(j.content || "").includes("Documento de regressao Workspace Documents")) {
  throw new Error("EXTRACTED_CONTENT_MISSING_EXPECTED_TEXT");
}
if (!String(j.content_preview || "").includes("Cliente: Metro Transit Authority")) {
  throw new Error("CONTENT_PREVIEW_MISSING_EXPECTED_TEXT");
}

console.log(JSON.stringify({
  success: j.success,
  document_id: j.document.id,
  content_length: j.content_length,
  truncated: j.truncated
}, null, 2));
NODE

echo
echo "=== 6) RECLASSIFICACAO INVALIDA DEVE FALHAR ==="
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"manual_document_type":""}' \
  "http://127.0.0.1:3000/api/documents/$UPLOADED_DOC_ID/reclassify" | grep -q "HTTP:400"

echo
echo "=== 7) MANAGER RECLASSIFICA DOCUMENTO ==="
curl -s -o /tmp/regression_workspace_reclassify_response.json -w "HTTP:%{http_code}\n" -X POST \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"manual_document_type":"Customer requirements"}' \
  "http://127.0.0.1:3000/api/documents/$UPLOADED_DOC_ID/reclassify" | grep -q "HTTP:200"

node - <<'NODE'
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("/tmp/regression_workspace_reclassify_response.json", "utf8"));

if (j.manual_document_type !== "Customer requirements") throw new Error("MANUAL_TYPE_NOT_UPDATED");
if (j.detected_document_type !== "Customer requirements") throw new Error("DETECTED_TYPE_NOT_UPDATED");

console.log(JSON.stringify({
  id: j.id,
  manual_document_type: j.manual_document_type,
  detected_document_type: j.detected_document_type
}, null, 2));
NODE

echo
echo "=== 8) MANAGER NAO PODE DELETAR ==="
curl -s -w "\nHTTP:%{http_code}\n" -X DELETE \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  "http://127.0.0.1:3000/api/documents/$UPLOADED_DOC_ID" | grep -q "HTTP:403"

echo
echo "=== 9) ENGINEER DELETA DOCUMENTO ==="
curl -s -w "\nHTTP:%{http_code}\n" -X DELETE \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  "http://127.0.0.1:3000/api/documents/$UPLOADED_DOC_ID" | grep -q "HTTP:200"

if [ -f "$UPLOADED_STORAGE_PATH" ]; then
  echo "ERRO: arquivo fisico ainda existe: $UPLOADED_STORAGE_PATH"
  exit 1
fi

echo
echo "=== 10) DB DEVE ESTAR SEM DOCUMENTO E SEM CONTENT INDEX ==="
curl -s -o /tmp/regression_workspace_content_check.json -w "HTTP:%{http_code}\n" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  "http://127.0.0.1:3000/api/documents/$UPLOADED_DOC_ID/content" | tee /tmp/regression_workspace_content_check_status.txt | grep -q "HTTP:404"

curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://127.0.0.1:3000/api/audit-logs?entity_id=$UPLOADED_DOC_ID&action=Upload%20Document" > /tmp/regression_workspace_audit_upload.json
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://127.0.0.1:3000/api/audit-logs?entity_id=$UPLOADED_DOC_ID&action=Reclassify%20Document" > /tmp/regression_workspace_audit_reclassify.json
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://127.0.0.1:3000/api/audit-logs?entity_id=$UPLOADED_DOC_ID&action=Delete%20Document" > /tmp/regression_workspace_audit_delete.json

node - "$UPLOADED_DOC_ID" <<'NODE'
const fs = require("fs");
const docId = process.argv[2];

const uploadAudit = JSON.parse(fs.readFileSync("/tmp/regression_workspace_audit_upload.json", "utf8")).slice(-1)[0];
const reclassifyAudit = JSON.parse(fs.readFileSync("/tmp/regression_workspace_audit_reclassify.json", "utf8")).slice(-1)[0];
const deleteAudit = JSON.parse(fs.readFileSync("/tmp/regression_workspace_audit_delete.json", "utf8")).slice(-1)[0];

if (!uploadAudit) throw new Error("UPLOAD_AUDIT_MISSING");
if (!reclassifyAudit) throw new Error("RECLASSIFY_AUDIT_MISSING");
if (!deleteAudit) throw new Error("DELETE_AUDIT_MISSING");

console.log(JSON.stringify({
  success: true,
  document_removed: true,
  content_removed: true,
  audits: {
    upload: uploadAudit.action,
    reclassify: reclassifyAudit.action,
    delete: deleteAudit.action
  }
}, null, 2));
NODE
rm -f /tmp/regression_workspace_content_check_status.txt

echo
echo "=== REGRESSION PASSED ==="
