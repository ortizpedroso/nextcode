#!/usr/bin/env bash
# /project: código gerado, montado SOMENTE LEITURA. /out: relatório e prints.
set -uo pipefail
OUT=/out
mkdir -p "$OUT"
log() { echo "[ui-check] $*" | tee -a "$OUT/run.log"; }
fail() { log "FALHA: $1"; printf '{"ok":false,"stage":"%s","error":"%s"}\n' "$2" "$1" > "$OUT/report.json"; exit 0; }

# Copia só o código: node_modules/.next do Windows não servem no Linux e a cópia pelo volume é lenta.
mkdir -p /tmp/app
tar -C /project --exclude=./node_modules --exclude=./.next --exclude=./.git -cf - . | tar -C /tmp/app -xf -   || fail "não consegui copiar o projeto" "copy"
cd /tmp/app

log "npm install"
npm install --no-audit --no-fund --loglevel=error >>"$OUT/run.log" 2>&1 || fail "npm install falhou (ver run.log)" "install"

log "next build"
npx next build >>"$OUT/run.log" 2>&1 || fail "next build falhou (ver run.log)" "build"

log "next start"
npx next start -p 3000 >>"$OUT/server.log" 2>&1 &
for i in $(seq 1 60); do
  curl -s -o /dev/null http://127.0.0.1:3000/ && break
  sleep 1
done
curl -s -o /dev/null http://127.0.0.1:3000/ || fail "o servidor não subiu em 60 s (ver server.log)" "start"

log "navegador: ${UI_CHECK_PAGES:-[\"/\"]}"
node /opt/ui-check/check.mjs || fail "o roteiro do navegador quebrou (ver run.log)" "browser"
log "fim"
