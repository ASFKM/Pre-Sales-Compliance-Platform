#!/usr/bin/env bash
# Dependências de SISTEMA que a aplicação precisa e o npm não instala.
#
# Hoje é uma só: o LibreOffice, de onde vem o binário `soffice` que converte template `.doc` em
# `.docx` no upload (server/utils/docConversion.ts, Fase 6). Sem ele o upload de `.doc` responde
# 400 com "o conversor não está disponível" — a funcionalidade inteira não existe naquela
# instalação, e o resto da aplicação sobe normalmente, o que é pior do que falhar alto: a falta
# só aparece quando alguém tenta usar.
#
# POR QUE AQUI, no `postinstall`, e não como um passo do `scripts/update.sh`:
#
# O `update.sh` é invocado de `REPO_ROOT/scripts/update.sh` e o `git checkout` do ref alvo
# acontece DENTRO dele. Ou seja, quem executa uma atualização é sempre o script da versão
# ANTERIOR — um passo novo acrescentado lá só entraria em vigor na atualização seguinte. O
# `npm ci`, ao contrário, roda DEPOIS do checkout, com o `package.json` já da versão nova. É a
# única janela em que código desta versão executa durante a própria atualização que a instala.
#
# NUNCA falha a instalação. Um `npm ci` que aborta aqui derruba a atualização inteira e dispara o
# rollback — trocar uma funcionalidade indisponível por uma atualização revertida é péssimo
# negócio. Toda saída é `|| true` e o resultado vai para a saída padrão, que o `update.sh` já
# grava no log de erro da tentativa.

set -uo pipefail

log() { echo "[dependencias-de-sistema] $*"; }

# --- Guardas: só age numa instalação real da aplicação, nunca em CI nem em container de build ---
if [[ -n "${CI:-}" ]]; then
  log "CI detectado, nada a fazer."
  exit 0
fi
if [[ "$(uname -s)" != "Linux" ]]; then
  log "Sistema não-Linux, nada a fazer."
  exit 0
fi
# Sem `.env` não é uma instalação em execução, é um checkout qualquer (clone de inspeção, build).
if [[ ! -f ".env" ]]; then
  log "Sem .env — não parece uma instalação em execução. Nada a fazer."
  exit 0
fi
if command -v soffice >/dev/null 2>&1; then
  log "LibreOffice já disponível ($(command -v soffice))."
  exit 0
fi
# `sudo -n` (non-interactive): se pedir senha, não há quem a digite num postinstall.
if ! sudo -n true 2>/dev/null; then
  log "AVISO: LibreOffice ausente e sudo indisponível sem senha. A conversão de template .doc"
  log "       ficará indisponível nesta instalação (o upload de .docx segue funcionando)."
  log "       Para habilitar: sudo apt-get install -y libreoffice-writer"
  exit 0
fi

# --- Instalação ---
# `libreoffice-writer` e não `libreoffice`: só o Writer sabe converter .doc/.docx, e o pacote
# completo traz Calc, Impress, Draw e Base — centenas de megabytes que esta aplicação nunca usa.
# `--no-install-recommends` pelo mesmo motivo.
log "LibreOffice ausente. Instalando libreoffice-writer…"
export DEBIAN_FRONTEND=noninteractive
sudo -n apt-get update -qq >/dev/null 2>&1 || log "AVISO: apt-get update falhou; seguindo com o índice existente."
if sudo -n apt-get install -y -qq --no-install-recommends libreoffice-writer >/dev/null 2>&1; then
  if command -v soffice >/dev/null 2>&1; then
    log "OK: LibreOffice instalado ($(command -v soffice))."
  else
    log "AVISO: apt-get terminou sem erro mas o binário `soffice` não apareceu no PATH."
  fi
else
  log "AVISO: não foi possível instalar o libreoffice-writer. A conversão de template .doc"
  log "       ficará indisponível (o upload de .docx segue funcionando)."
fi
exit 0
