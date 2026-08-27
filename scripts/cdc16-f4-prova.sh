#!/usr/bin/env bash
# CDC 16 — Fase 4. Sobe um PreSales de verdade num banco dedicado e roda a ETAPA 2 contra ele.
#
# Mesmas duas regras da F1, e pelos mesmos acidentes:
#  - o ambiente é montado com cada valor CITADO (`scripts/cdc16-f1-env.py`), e não com
#    `set -a; . .env`: um valor com `&` faz o `source` cortar a linha e a aplicação cai em outro
#    banco, sem erro nenhum;
#  - o servidor sobe em sessão própria (setsid) e é derrubado pelo GRUPO.
#
# Uma regra a mais, desta fase: `NODE_EXTRA_CA_CERTS` é exportado AQUI, no shell que lança o
# processo, e não no `.env`. O Node lê essa variável no início; `dotenv` a popularia depois do
# boot e o efeito seria nenhum — o sintoma é um `fetch failed` com DEPTH_ZERO_SELF_SIGNED_CERT
# num caminho que o serviço publicado percorre sem problema. Está registrado no §10 da F3.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

PORTA="${PORTA:-3010}"
LOG="${LOG:-/tmp/cdc16-f4-servidor.log}"
ENVGEN="${ENVGEN:-scripts/cdc16-f1-env.py}"

eval "$(python3 "$ENVGEN" .env --db commercial_assistant_cdc16f1 --redis-db 4)"
export PORT="$PORTA"
export NODE_ENV=development
# O endereço PÚBLICO desta instalação, que é o que viaja no `link` da proposta. Sem ele o link
# sairia apontando para um endereço que ninguém alcança de fora — o defeito que só a publicação da
# F3 revelou.
export APP_URL="${APP_URL_PROVA:-https://192.168.3.166}"
export NODE_EXTRA_CA_CERTS="${CA_BUNDLE:-$HOME/cdc16-f3-ca-bundle.crt}"

export PROVA_PASSWORD="${PROVA_PASSWORD:-$(openssl rand -base64 24)}"

ARQUIVO_CHAVE="${ARQUIVO_CHAVE:-$HOME/cdc16-pair-key}"
if [ -z "${PAIR_KEY:-}" ] && [ -s "$ARQUIVO_CHAVE" ]; then
  PAIR_KEY="$(tr -d "\r\n" < "$ARQUIVO_CHAVE")"
  export PAIR_KEY
fi

echo "== migrations no banco de prova"
npx prisma migrate deploy > /dev/null 2>&1 || echo "(migrate deploy não aplicou nada novo)"

echo "== subindo o PreSales na porta $PORTA"
: > "$LOG"
setsid npx tsx server.ts >> "$LOG" 2>&1 &
PID=$!
sleep 1
GRUPO="$(ps -o pgid= -p "$PID" 2>/dev/null | tr -d ' ')"

derrubar() {
  if [ -n "${GRUPO:-}" ]; then
    kill -TERM -"$GRUPO" 2>/dev/null
    sleep 2
    kill -KILL -"$GRUPO" 2>/dev/null
  fi
}
trap derrubar EXIT

PRONTO=0
for _ in $(seq 1 60); do
  if curl -s -f "http://127.0.0.1:$PORTA/api/health" > /dev/null 2>&1; then PRONTO=1; break; fi
  sleep 1
done
if [ "$PRONTO" != "1" ]; then
  echo "o servidor não subiu; últimas linhas do log:"
  tail -40 "$LOG"
  exit 1
fi
echo "no ar (pid $PID, grupo $GRUPO)"

if [ "${SO_SUBIR:-0}" = "1" ]; then
  echo "== SO_SUBIR=1: servidor no ar, aguardando o sinal para descer"
  # Espera DENTRO do próprio processo, para que o trap derrube o servidor no fim.
  while [ ! -f "${SINAL:-/tmp/cdc16-f4-parar}" ]; do sleep 2; done
  rm -f "${SINAL:-/tmp/cdc16-f4-parar}"
  exit 0
fi

BASE_URL="http://127.0.0.1:$PORTA" npx tsx scripts/cdc16-f4-provar-proposta.ts
RESULTADO=$?

echo "== erros do servidor durante a prova (se houver)"
grep -iE '"level":50|"level":60|ERROR|FATAL' "$LOG" | tail -10 || true

exit $RESULTADO
