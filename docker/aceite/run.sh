#!/bin/sh
set -eu

if [ $# -lt 1 ]; then
  echo "Uso: run.sh <p1|p2>" >&2
  exit 2
fi

PROJETO="$1"

# Copiar /project para /tmp/w com tar excluindo node_modules, .next, .git
mkdir -p /tmp/w
tar -C /project --exclude=./node_modules --exclude=./.next --exclude=./.git -cf - . | tar -C /tmp/w -xf -

# Configurar stub do Next.js sem rede e sem npm install
mkdir -p /tmp/w/node_modules/next
cp -r /aceite/stub-next/* /tmp/w/node_modules/next/

cd /tmp/w
tsx /aceite/rodar.mjs /tmp/w "$PROJETO"
