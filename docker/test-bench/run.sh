#!/usr/bin/env bash
# Chamada 2 (SEM rede: o contêiner sobe com --network none): copia o projeto (só leitura), liga as
# dependências do cache, junta os testes de reprodução (/repro) e roda o vitest com saída JSON.
# TB_FILES: lista JSON de arquivos de teste (caminhos relativos ao projeto); vazio = todos os incluídos.
set -uo pipefail
OUT=/out
mkdir -p "$OUT"
log() { echo "[test-bench] $*" | tee -a "$OUT/run.log"; }
fail() { log "FALHA: $1"; printf '{"ok":false,"stage":"run","error":"%s"}\n' "$1" > "$OUT/run.json"; exit 0; }

mkdir -p /tmp/app
tar -C /project --exclude=./node_modules --exclude=./.next --exclude=./.git --exclude=./.nextcode -cf - . | tar -C /tmp/app -xf - || fail "não consegui copiar o projeto"
[ -d /deps/node_modules ] || fail "dependências ausentes (rode a instalação antes)"
ln -s /deps/node_modules /tmp/app/node_modules
if [ -d /repro ]; then
  mkdir -p /tmp/app/.nextcode-repro
  cp -r /repro/. /tmp/app/.nextcode-repro/ 2>/dev/null || true
fi
cd /tmp/app

FILES=$(node -e 'try{const a=JSON.parse(process.env.TB_FILES||"[]");console.log(a.map(f=>JSON.stringify(f)).join(" "))}catch{console.log("")}')
log "vitest ${FILES:-(todos)}"
cp /opt/test-bench/vitest.config.mjs /tmp/vitest.config.mjs
eval "node /tmp/app/node_modules/vitest/vitest.mjs run --config /tmp/vitest.config.mjs --root /tmp/app --reporter=json --outputFile=$OUT/vitest.json $FILES" >>"$OUT/run.log" 2>&1
CODE=$?
[ -f "$OUT/vitest.json" ] || fail "o vitest terminou sem resultado (código $CODE; ver run.log)"
printf '{"ok":true,"stage":"run","exitCode":%s}\n' "$CODE" > "$OUT/run.json"
log "fim (código $CODE)"
