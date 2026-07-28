#!/usr/bin/env bash
# The ONE installer for a brand-new, real Presales installation. Run from the repo root after
# cloning: bash scripts/install.sh
#
# Does the whole thing end to end: brings up Postgres/Redis (Docker, with a recovery policy so
# they survive a reboot), runs `npm install` + the interactive setup wizard (secrets, .env,
# migrations, tenant/admin/settings bootstrap, build), starts the app under PM2 (registered to
# come back on its own after a reboot), and puts Caddy in front of it with TLS from Caddy's
# built-in internal CA (the app itself stays bound to 127.0.0.1 only - see server.ts's Zero Trust
# comment - Caddy is the only thing that talks to it directly).
#
# Requires Docker and Node.js/npm already installed (this only manages the app's own stack, not
# the OS-level prerequisites).
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
DETECTED_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[[ -z "$DETECTED_IP" ]] && DETECTED_IP=$(curl -s --max-time 3 ifconfig.me || true)
read -rp "Nome da empresa/cliente: " COMPANY_NAME
read -rp "Nome do administrador: " ADMIN_NAME
read -rp "E-mail do administrador: " ADMIN_EMAIL
read -rp "Endereço (IP ou domínio) desta instalação [${DETECTED_IP:-SEU_IP}]: " ADDRESS_INPUT
ADDRESS="${ADDRESS_INPUT:-$DETECTED_IP}"
if [[ -z "$ADDRESS" ]]; then
  echo "Não consegui detectar um endereço e nenhum foi informado." >&2
  exit 1
fi
APP_URL="https://${ADDRESS}"

PG_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)

echo ""
echo "[1/6] Subindo Postgres e Redis..."
# Postgres only applies POSTGRES_PASSWORD when it initializes an EMPTY data directory - if
# presales-pgdata already has data (from a previous attempt), removing just the container and
# reusing the volume keeps the OLD password while this run generates a NEW one, causing a silent
# auth mismatch later. Ask before wiping instead of guessing.
if docker volume inspect presales-pgdata >/dev/null 2>&1 || docker volume inspect presales-redisdata >/dev/null 2>&1; then
  echo "Já existem dados de uma tentativa de instalação anterior neste servidor."
  read -rp "Apagar esses dados e recomeçar do zero? [s/N]: " WIPE_OLD
  if [[ "$WIPE_OLD" =~ ^[sSyY] ]]; then
    docker rm -f presales-postgres presales-redis >/dev/null 2>&1 || true
    docker volume rm -f presales-pgdata presales-redisdata >/dev/null 2>&1 || true
  else
    echo "Abortado - nada foi alterado. Remova os volumes manualmente (docker volume rm presales-pgdata presales-redisdata) se quiser recomeçar."
    exit 1
  fi
else
  docker rm -f presales-postgres presales-redis >/dev/null 2>&1 || true
fi
docker run -d --name presales-postgres --restart unless-stopped \
  -e POSTGRES_DB=commercial_assistant -e POSTGRES_USER=app_user -e POSTGRES_PASSWORD="$PG_PASSWORD" \
  -p 127.0.0.1:5432:5432 -v presales-pgdata:/var/lib/postgresql/data postgres:16-alpine >/dev/null
docker run -d --name presales-redis --restart unless-stopped \
  -p 127.0.0.1:6379:6379 -v presales-redisdata:/data redis:7-alpine --requirepass "$REDIS_PASSWORD" >/dev/null

echo "[2/6] Aguardando bancos ficarem prontos..."
for i in $(seq 1 30); do docker exec presales-postgres pg_isready -U app_user >/dev/null 2>&1 && break; sleep 1; done
for i in $(seq 1 30); do docker exec presales-redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping >/dev/null 2>&1 && break; sleep 1; done

export DATABASE_URL="postgresql://app_user:${PG_PASSWORD}@localhost:5432/commercial_assistant"
export REDIS_URL="redis://:${REDIS_PASSWORD}@localhost:6379/0"

echo "[3/6] Instalando dependências..."
# postinstall runs `prisma generate`, which needs DATABASE_URL in the environment already -
# exporting above (not just assigning) is what makes that visible to this child process.
npm install --silent

echo "[4/6] Rodando o instalador (segredos, .env, migrations, tenant/admin, build)..."
SUMMARY_FILE="$HOME/presales-instalacao-resumo.txt"
# setup-installation.ts has its own "already exists, overwrite?" prompt for a leftover .env from a
# previous attempt - only asked when .env is actually present, so it must only be answered here
# when that's the case, or it swallows the DATABASE_URL answer instead and aborts silently.
ANSWERS=()
[[ -f .env ]] && ANSWERS+=("s")
ANSWERS+=("$DATABASE_URL" "$REDIS_URL" "$APP_URL" "" "$COMPANY_NAME" "$ADMIN_NAME" "$ADMIN_EMAIL" "" "" "" "" "" "")
printf '%s\n' "${ANSWERS[@]}" | npm run setup 2>&1 | tee "$SUMMARY_FILE"
chmod 600 "$SUMMARY_FILE"

# The wizard exits 0 both when it finishes AND when a prompt is declined (e.g. the overwrite
# question above) - pipefail doesn't distinguish those, so check the actual output for the real
# completion marker instead of trusting the exit code.
if ! grep -q "Instalação concluída" "$SUMMARY_FILE"; then
  echo ""
  echo "=== A instalação NÃO foi concluída - veja o motivo acima ou em $SUMMARY_FILE ===" >&2
  exit 1
fi

echo ""
echo "[5/6] Subindo o processo com PM2..."
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2 --silent
fi
pm2 delete presales >/dev/null 2>&1 || true
pm2 start dist/server.cjs --name presales
pm2 save
# Registers PM2 to relaunch this app after a reboot without a copy/paste step - `pm2 startup`
# normally just prints a sudo command for the operator to run by hand; capturing and executing it
# here is the officially documented way to do that non-interactively.
STARTUP_CMD=$(pm2 startup systemd -u "$(whoami)" --hp "$HOME" | tail -1)
if [[ "$STARTUP_CMD" == sudo* ]]; then
  eval "$STARTUP_CMD" >/dev/null
fi

echo "[6/6] Configurando Caddy (proxy reverso com TLS via CA interna)..."
if ! command -v caddy >/dev/null 2>&1; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y caddy
fi
sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
https://${ADDRESS} {
	tls internal
	reverse_proxy 127.0.0.1:3000
}

http://${ADDRESS} {
	redir https://${ADDRESS}{uri} permanent
}
EOF
sudo systemctl enable caddy >/dev/null 2>&1 || true
sudo systemctl restart caddy

CA_ROOT="/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt"
echo ""
echo "=== Instalação concluída de ponta a ponta ==="
echo "Acesse: https://${ADDRESS}"
echo "Resumo (login/senha) salvo em: $SUMMARY_FILE"
echo "Certificado é de uma CA interna do Caddy - navegadores avisam 'não confiável' até"
echo "confiarem nessa CA. Raiz da CA, se quiser instalar nas máquinas clientes:"
echo "  sudo cat ${CA_ROOT}"
echo ""
echo "Sobrevive a reboot: Postgres/Redis (Docker --restart unless-stopped), app (PM2 startup),"
echo "Caddy (systemd enable)."
