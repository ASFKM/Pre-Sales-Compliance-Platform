#!/usr/bin/env bash
# Sistema de Atualização de Produção: backup -> checkout do ref alvo -> npm ci -> migrate deploy ->
# build -> restart -> health check, com rollback automático (banco + código) em qualquer falha a
# partir do backup. Sempre invocado como processo filho destacado por
# server/utils/updateScheduler.ts (triggerImmediateUpdate) - nunca rode manualmente contra um
# checkout com alterações não commitadas: este script faz `git checkout <ref>`, que pode entrar em
# conflito com trabalho local em andamento.
#
# Uso: scripts/update.sh --ref <git-ref> --release-id <id> --tenant-id <id> --history-id <id> --task-id <id> [--dry-run]
# --dry-run: só valida pré-requisitos (referência existe, espaço em disco) e para - não toca em
# banco, código ou no serviço. Usado para validar o script sem qualquer efeito real.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

REF=""
RELEASE_ID=""
TENANT_ID=""
HISTORY_ID=""
TASK_ID=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    --release-id) RELEASE_ID="$2"; shift 2 ;;
    --tenant-id) TENANT_ID="$2"; shift 2 ;;
    --history-id) HISTORY_ID="$2"; shift 2 ;;
    --task-id) TASK_ID="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Argumento desconhecido: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$REF" || -z "$RELEASE_ID" || -z "$TENANT_ID" || -z "$HISTORY_ID" || -z "$TASK_ID" ]]; then
  echo "Uso: update.sh --ref <ref> --release-id <id> --tenant-id <id> --history-id <id> --task-id <id> [--dry-run]" >&2
  exit 1
fi

RUNNER=(npx tsx scripts/systemUpdateRunner.ts)
BACKUP_DIR="$REPO_ROOT/backups/system_update"
BACKUP_RETENTION_DAYS=7
BACKUP_REF="update_$(date -u +%Y%m%d%H%M%S)"
ERROR_LOG_FILE="$(mktemp)"
HEALTH_URL="http://localhost:3000/api/health"
READINESS_URL="http://localhost:3000/api/health/readiness"

# Container name and DB user/name are NOT standardized across installations - the dev host was
# provisioned via docker-compose (container "commercial-assistant-ai-postgres-1"), while a real
# customer install via scripts/install.sh uses a plain `docker run --name presales-postgres`
# instead. Detected at runtime rather than hardcoded, same reasoning for parsing DB_USER/DB_NAME
# out of DATABASE_URL instead of assuming a fixed value.
DOCKER_POSTGRES_CONTAINER="$(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1)"
if [[ -z "$DOCKER_POSTGRES_CONTAINER" ]]; then
  echo "Não foi possível identificar o container do Postgres (nenhum container com 'postgres' no nome está rodando)." >&2
  exit 1
fi
DB_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d'=' -f2- | tr -d '"')"
DB_USER="$(echo "$DB_URL" | sed -E 's#^[a-zA-Z]+://([^:]+):.*#\1#')"
DB_NAME="$(echo "$DB_URL" | sed -E 's#.*/([a-zA-Z0-9_]+)(\?.*)?$#\1#')"
if [[ -z "$DB_USER" || -z "$DB_NAME" ]]; then
  echo "Não foi possível extrair usuário/nome do banco de DATABASE_URL em .env." >&2
  exit 1
fi

# Same reasoning: the dev host runs under systemd ("commercial-assistant-ai" unit), a real
# customer install via scripts/install.sh runs under PM2 (process "presales", always that literal
# name - see install.sh's own `pm2 start dist/server.cjs --name presales`). Detected once here and
# reused by every restart call below (normal update path and rollback path both call this).
restart_app() {
  if pm2 describe presales >/dev/null 2>&1; then
    pm2 restart presales
  elif systemctl is-enabled commercial-assistant-ai >/dev/null 2>&1; then
    sudo systemctl restart commercial-assistant-ai
  else
    echo "Não foi possível identificar o mecanismo de restart (nem PM2 'presales' nem systemd 'commercial-assistant-ai')." >&2
    return 1
  fi
}

# Set right before the backup actually completes - a failure BEFORE this point (bad ref, no disk
# space) has nothing to roll back yet, so the exit trap below only attempts rollback once this is
# true and we're not in --dry-run.
BACKUP_DONE=false
SUCCEEDED=false
PRE_UPDATE_REF=""

step() {
  echo "==> $1"
  if [[ "$DRY_RUN" == false ]]; then
    "${RUNNER[@]}" step --tenant-id "$TENANT_ID" --task-id "$TASK_ID" --message "$1" || true
  fi
}

health_check() {
  local attempts=0
  local max_attempts=20 # 20 * 3s = 60s
  while [[ $attempts -lt $max_attempts ]]; do
    if curl -sf "$HEALTH_URL" >/dev/null 2>&1 && curl -sf "$READINESS_URL" >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 3
  done
  return 1
}

# Restores the DB dump taken just before checkout, checks out the pre-update ref, rebuilds,
# restarts, health-checks again. If the rollback's OWN health check also fails, this stops here -
# no second-level cascade, a human must intervene at that point (logged as a critical failure).
rollback() {
  {
    echo "==> Iniciando rollback automático"
    git checkout "$PRE_UPDATE_REF"
    docker exec -i "$DOCKER_POSTGRES_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
    docker exec -i "$DOCKER_POSTGRES_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$BACKUP_DIR/$BACKUP_REF.sql"
    npm ci
    npm run build
    restart_app
    sleep 5
  } >> "$ERROR_LOG_FILE" 2>&1

  if health_check; then
    echo "Rollback concluído com sucesso" >> "$ERROR_LOG_FILE"
    "${RUNNER[@]}" rolled_back --tenant-id "$TENANT_ID" --history-id "$HISTORY_ID" --task-id "$TASK_ID" --error-log-file "$ERROR_LOG_FILE"
  else
    echo "FALHA CRÍTICA: rollback também falhou no health check - intervenção manual necessária" >> "$ERROR_LOG_FILE"
    "${RUNNER[@]}" failed --tenant-id "$TENANT_ID" --history-id "$HISTORY_ID" --task-id "$TASK_ID" --error-log-file "$ERROR_LOG_FILE"
  fi
}

on_exit() {
  local exit_code=$?
  if [[ "$SUCCEEDED" == true || "$DRY_RUN" == true ]]; then
    rm -f "$ERROR_LOG_FILE"
    return
  fi
  if [[ $exit_code -ne 0 ]]; then
    echo "Atualização falhou (código $exit_code)" >> "$ERROR_LOG_FILE"
    if [[ "$BACKUP_DONE" == true ]]; then
      set +e
      rollback
      set -e
    else
      "${RUNNER[@]}" failed --tenant-id "$TENANT_ID" --history-id "$HISTORY_ID" --task-id "$TASK_ID" --error-log-file "$ERROR_LOG_FILE"
    fi
  fi
}
trap on_exit EXIT

step "Verificando pré-requisitos"
mkdir -p "$BACKUP_DIR"
AVAILABLE_KB=$(df -Pk "$REPO_ROOT" | awk 'NR==2 {print $4}')
if [[ "$AVAILABLE_KB" -lt 2097152 ]]; then # 2GB
  echo "Espaço em disco insuficiente (menos de 2GB livres)" >> "$ERROR_LOG_FILE"
  exit 1
fi

step "Buscando referência $REF"
git fetch --tags origin >> "$ERROR_LOG_FILE" 2>&1
if ! git rev-parse --verify "$REF" >/dev/null 2>>"$ERROR_LOG_FILE"; then
  echo "Referência $REF não encontrada" >> "$ERROR_LOG_FILE"
  exit 1
fi

PRE_UPDATE_REF="$(git rev-parse HEAD)"

if [[ "$DRY_RUN" == true ]]; then
  echo "[dry-run] pré-requisitos OK, referência $REF encontrada, HEAD atual $PRE_UPDATE_REF - parando aqui (dry-run, nada foi alterado)"
  exit 0
fi

step "Fazendo backup (banco de dados + .env)"
docker exec "$DOCKER_POSTGRES_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" > "$BACKUP_DIR/$BACKUP_REF.sql" 2>>"$ERROR_LOG_FILE"
cp .env "$BACKUP_DIR/$BACKUP_REF.env"
chmod 600 "$BACKUP_DIR/$BACKUP_REF.env" "$BACKUP_DIR/$BACKUP_REF.sql"
find "$BACKUP_DIR" -name '*.sql' -mtime "+$BACKUP_RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name '*.env' -mtime "+$BACKUP_RETENTION_DAYS" -delete
BACKUP_DONE=true

step "Aplicando atualização: checkout $REF"
git checkout "$REF" >> "$ERROR_LOG_FILE" 2>&1

step "Instalando dependências (npm ci)"
npm ci >> "$ERROR_LOG_FILE" 2>&1

step "Aplicando migrações"
npx prisma migrate deploy >> "$ERROR_LOG_FILE" 2>&1

step "Compilando build de produção"
npm run build >> "$ERROR_LOG_FILE" 2>&1

step "Reiniciando serviço"
restart_app >> "$ERROR_LOG_FILE" 2>&1

step "Verificando saúde pós-atualização"
if ! health_check; then
  echo "Health check falhou após a atualização" >> "$ERROR_LOG_FILE"
  exit 1
fi

echo "Atualização concluída com sucesso"
"${RUNNER[@]}" success --tenant-id "$TENANT_ID" --history-id "$HISTORY_ID" --task-id "$TASK_ID" --backup-ref "$BACKUP_REF"
SUCCEEDED=true
