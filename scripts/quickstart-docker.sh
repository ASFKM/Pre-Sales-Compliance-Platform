#!/usr/bin/env bash
# One-shot quickstart for a brand-new installation: brings up throwaway Postgres/Redis containers
# with freshly generated credentials (nothing for the operator to note down or type twice), then
# feeds them straight into `npm run setup` along with the handful of answers only a human can
# provide (company/admin details, public URL). Everything else - secrets, .env, migrations,
# tenant/admin bootstrap, build - is the wizard's job, not this script's.
#
# Usage: run from the repo root: bash scripts/quickstart-docker.sh
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker não encontrado - instale o Docker antes de rodar este script." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm não encontrado - instale o Node.js 22 antes de rodar este script." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== Instalação Presales ==="
DETECTED_IP=$(curl -s --max-time 3 ifconfig.me || true)
read -rp "Nome da empresa/cliente: " COMPANY_NAME
read -rp "Nome do administrador: " ADMIN_NAME
read -rp "E-mail do administrador: " ADMIN_EMAIL
read -rp "URL pública desta instalação [http://${DETECTED_IP:-SEU_IP}:3000]: " APP_URL_INPUT
APP_URL="${APP_URL_INPUT:-http://${DETECTED_IP:-SEU_IP}:3000}"

PG_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)

echo ""
echo "[1/4] Subindo Postgres e Redis..."
docker rm -f presales-postgres presales-redis >/dev/null 2>&1 || true
docker run -d --name presales-postgres \
  -e POSTGRES_DB=commercial_assistant -e POSTGRES_USER=app_user -e POSTGRES_PASSWORD="$PG_PASSWORD" \
  -p 127.0.0.1:5432:5432 -v presales-pgdata:/var/lib/postgresql/data postgres:16-alpine >/dev/null
docker run -d --name presales-redis \
  -p 127.0.0.1:6379:6379 -v presales-redisdata:/data redis:7-alpine --requirepass "$REDIS_PASSWORD" >/dev/null

echo "[2/4] Aguardando bancos ficarem prontos..."
for i in $(seq 1 30); do docker exec presales-postgres pg_isready -U app_user >/dev/null 2>&1 && break; sleep 1; done
for i in $(seq 1 30); do docker exec presales-redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping >/dev/null 2>&1 && break; sleep 1; done

export DATABASE_URL="postgresql://app_user:${PG_PASSWORD}@localhost:5432/commercial_assistant"
export REDIS_URL="redis://:${REDIS_PASSWORD}@localhost:6379/0"

echo "[3/4] Instalando dependências..."
# postinstall runs `prisma generate`, which needs DATABASE_URL in the environment already -
# exporting above (not just assigning) is what makes that visible to this child process.
npm install --silent

echo "[4/4] Rodando o instalador..."
SUMMARY_FILE="$HOME/presales-instalacao-resumo.txt"
printf '%s\n' "$DATABASE_URL" "$REDIS_URL" "$APP_URL" "" "$COMPANY_NAME" "$ADMIN_NAME" "$ADMIN_EMAIL" "" "" "" "" "" "" \
  | npm run setup 2>&1 | tee "$SUMMARY_FILE"
chmod 600 "$SUMMARY_FILE"

echo ""
echo "=== Concluído. Resumo completo salvo em $SUMMARY_FILE (login, e-mail, senha) ==="
