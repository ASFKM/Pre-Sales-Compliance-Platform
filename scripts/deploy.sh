#!/usr/bin/env bash
# Deploy manual local (dev/produção compartilhada) - substitui a sequência manual de
# `git ... && npm run build && systemctl restart` usada durante toda a sessão de 2026-07-20/21.
#
# Diferente de scripts/update.sh: aquele resolve "aplicar um release específico vindo do CMSaaS
# numa instalação de cliente" (checkout de um ref remoto + rollback via backup). Este resolve
# "eu, trabalhando direto neste checkout, quero implantar o que já está no disco" - o caso deste
# host (home-comercial-01), que também é tratado como a instalação "PreSales Demo" em produção.
#
# Núcleo da correção (incidente real, 2026-07-21): algo trocou a branch deste checkout mais de uma
# vez durante a sessão, sem aviso nenhum, e um build+restart manual implantou silenciosamente
# código da branch errada (uma vez aqui, uma vez no CMSaaS - lá custou ~9 minutos de 24 commits de
# correções reais fora do ar). Isso não impede que algo externo troque a branch de novo (host
# compartilhado, fora de controle) - mas garante que o PRÓPRIO deploy aborte alto em vez de
# construir e implantar silenciosamente a coisa errada.
#
# Uso: scripts/deploy.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Editar esta linha é a forma deliberada e explícita de mudar qual branch é "a de verdade" (ex.:
# no dia em que este trabalho for mesclado em main) - nunca implícito.
EXPECTED_BRANCH="main"
SERVICE_NAME="commercial-assistant-ai.service"
HEALTH_URL="http://localhost:3000/api/health"
DEPLOY_LOG="$REPO_ROOT/deploy.log"

echo "==> Verificando branch atual..."
CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ABORTADO: branch atual é '$CURRENT_BRANCH', esperada '$EXPECTED_BRANCH'." >&2
  echo "Algo trocou o checkout deste repositório - confirme antes de continuar:" >&2
  echo "  git checkout $EXPECTED_BRANCH" >&2
  echo "(nunca 'git checkout -f' sem investigar - pode haver trabalho local intencional em outra branch)" >&2
  exit 1
fi
echo "    OK: branch '$CURRENT_BRANCH'."

DIRTY="limpo"
if [[ -n "$(git status --short)" ]]; then
  DIRTY="com alterações não commitadas"
  echo "    Aviso: working tree $DIRTY (normal em meio de edição, não bloqueia o deploy)."
fi

COMMIT_SHA="$(git rev-parse --short HEAD)"

echo "==> Verificação de tipos (tsc --noEmit)..."
npx tsc --noEmit -p .

echo "==> Build..."
npm run build

if [[ ! -s "$REPO_ROOT/dist/server.cjs" ]]; then
  echo "ABORTADO: dist/server.cjs não existe ou está vazio depois do build." >&2
  exit 1
fi
echo "    OK: dist/server.cjs gerado."

echo "==> Reiniciando $SERVICE_NAME..."
sudo systemctl restart "$SERVICE_NAME"
sleep 2

echo "==> Checando saúde ($HEALTH_URL)..."
HEALTH_RESPONSE="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" || echo "000")"
if [[ "$HEALTH_RESPONSE" != "200" ]]; then
  echo "ABORTADO: health check retornou HTTP $HEALTH_RESPONSE (esperado 200)." >&2
  echo "O serviço foi reiniciado mas não respondeu saudável - investigue os logs:" >&2
  echo "  sudo journalctl -u $SERVICE_NAME -n 50 --no-pager" >&2
  exit 1
fi
echo "    OK: health check HTTP 200."

TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "$TIMESTAMP branch=$CURRENT_BRANCH commit=$COMMIT_SHA dirty=$DIRTY health=OK" >> "$DEPLOY_LOG"

echo ""
echo "==> Deploy concluído."
echo "    Branch:  $CURRENT_BRANCH"
echo "    Commit:  $COMMIT_SHA"
echo "    Estado:  $DIRTY"
echo "    Saúde:   OK"
echo "    Log:     $DEPLOY_LOG"
