#!/usr/bin/env bash
# CDC 16 — Fase 1. Sobe um PreSales de verdade num banco dedicado, roda a prova
# por HTTP contra ele e o derruba.
#
# Duas regras vindas de acidentes já registrados:
#  - o ambiente é montado com cada valor CITADO (scripts/../tmp/cdc16env.py), e
#    não com `set -a; . .env`: um valor com `&` faz o `source` cortar a linha e a
#    aplicação cai em outro banco, sem erro nenhum (F0, §10);
#  - o servidor sobe em sessão própria (setsid) e é derrubado pelo GRUPO: matar
#    só o pid do `npx` deixa o processo real vivo, escrevendo por cima do log da
#    execução seguinte.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

PORTA="${PORTA:-3010}"
LOG="${LOG:-/tmp/cdc16-f1-servidor.log}"
ENVGEN="${ENVGEN:-scripts/cdc16-f1-env.py}"

eval "$(python3 "$ENVGEN" .env --db commercial_assistant_cdc16f1 --redis-db 4)"
export PORT="$PORTA"
# development, e não production: em production o servidor entrega o `dist/`, que
# é o bundle da branch publicada - a tela nova não estaria nele, e capturar ali
# mostraria a interface antiga. Rebuildar o dist deste checkout publicaria o
# front da branch na instalação viva de desenvolvimento, que não é o que esta
# fase pede. Em desenvolvimento o Vite compila da fonte, e a API é a mesma.
export NODE_ENV=development

# Senha do usuário da prova: gerada a cada execução e nunca impressa. O usuário
# do seed não serve - em runtime de produção o login recusa a senha padrão.
export PROVA_PASSWORD="$(openssl rand -base64 24)"

# A chave do par entra por arquivo, e não por argumento nem por variável escrita
# na linha de comando: argumento aparece em `ps` para qualquer usuário do host.
# O arquivo é o caminho de entrega combinado - o administrador pareia pela tela
# do CMSaaS, que mostra a chave uma vez, e a grava aqui com umask 077.
ARQUIVO_CHAVE="${ARQUIVO_CHAVE:-$HOME/cdc16-pair-key}"
if [ -z "${PAIR_KEY:-}" ] && [ -s "$ARQUIVO_CHAVE" ]; then
  PAIR_KEY="$(tr -d "\r\n" < "$ARQUIVO_CHAVE")"
  export PAIR_KEY
  echo "chave do par lida de $ARQUIVO_CHAVE (${#PAIR_KEY} caracteres)"
fi

echo "== preparando o cenário"
npx tsx scripts/cdc16-f1-preparar-prova.ts || exit 1

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
for _ in $(seq 1 40); do
  if curl -s -f "http://127.0.0.1:$PORTA/api/health" > /dev/null 2>&1; then PRONTO=1; break; fi
  sleep 1
done
if [ "$PRONTO" != "1" ]; then
  echo "o servidor não subiu; últimas linhas do log:"
  tail -30 "$LOG"
  exit 1
fi
echo "no ar (pid $PID, grupo $GRUPO)"

if [ "${CAPTURAS:-0}" = "1" ]; then
  echo "== capturando a fila (antes de a prova mexer no estado dela)"
  BASE_URL="http://127.0.0.1:$PORTA" SAIDA="${SAIDA:-/tmp/cdc16-f1}" npx tsx scripts/cdc16-f1-capturar-fila.ts || exit 1
fi

BASE_URL="http://127.0.0.1:$PORTA" npx tsx scripts/cdc16-f1-provar-porta-e-fila.ts
RESULTADO=$?

echo "== erros do servidor durante a prova (se houver)"
grep -iE '"level":50|"level":60|ERROR|FATAL' "$LOG" | tail -10 || true

exit $RESULTADO
