#!/usr/bin/env bash
# Chamada 1 (COM rede): instala as dependências do projeto no volume /deps, uma vez por versão do
# package.json + schema do Prisma (carimbo em /deps/.stamp). Sem scripts de instalação dos pacotes
# (--ignore-scripts); o client do Prisma é gerado à parte. vitest entra se o projeto não tiver.
set -uo pipefail
OUT=/out
mkdir -p "$OUT"
log() { echo "[test-bench] $*" | tee -a "$OUT/install.log"; }
fail() { log "FALHA: $1"; printf '{"ok":false,"stage":"install","error":"%s"}\n' "$1" > "$OUT/install.json"; exit 0; }

STAMP="${TB_STAMP:-sem-carimbo}"
if [ -f /deps/.stamp ] && [ "$(cat /deps/.stamp)" = "$STAMP" ] && [ -d /deps/node_modules ]; then
  log "dependências em cache ($STAMP)"
  printf '{"ok":true,"stage":"install","cache":true}\n' > "$OUT/install.json"
  exit 0
fi

mkdir -p /tmp/app
tar -C /project --exclude=./node_modules --exclude=./.next --exclude=./.git --exclude=./.nextcode -cf - . | tar -C /tmp/app -xf - || fail "não consegui copiar o projeto"
cd /tmp/app

log "npm install"
npm install --no-audit --no-fund --ignore-scripts --loglevel=error >>"$OUT/install.log" 2>&1 || fail "npm install falhou (ver install.log)"
if [ ! -d node_modules/vitest ]; then
  log "vitest ${TB_VITEST_VERSION:-2.1.9} (o projeto não tem)"
  npm install --no-save --no-audit --no-fund --ignore-scripts --loglevel=error "vitest@${TB_VITEST_VERSION:-2.1.9}" >>"$OUT/install.log" 2>&1 || fail "instalar vitest falhou (ver install.log)"
fi
if [ -f prisma/schema.prisma ]; then
  log "prisma generate"
  npx prisma generate >>"$OUT/install.log" 2>&1 || fail "prisma generate falhou (ver install.log)"
fi

rm -rf /deps/node_modules
cp -a node_modules /deps/node_modules || fail "não consegui gravar o cache de dependências"
echo "$STAMP" > /deps/.stamp
log "fim"
printf '{"ok":true,"stage":"install","cache":false}\n' > "$OUT/install.json"
