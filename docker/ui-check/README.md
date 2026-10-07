# Verificação de tela (cluster frontend)

Abre o projeto gerado num navegador real (Chromium, Playwright 1.63.0), dentro de um contêiner.
O código gerado pela IA **só roda aqui dentro**, nunca na máquina do usuário.

O que faz, sem IA (roteiro fixo em `check.mjs`):
1. copia o código (sem `node_modules`/`.next`) do projeto montado **somente leitura**;
2. `npm install` → `next build` → `next start`;
3. para cada página e viewport (celular 390×844, desktop 1440×900): abre, espera a rede acalmar,
   tira print de página inteira e coleta erros de console, exceções, requisições com erro (≥ 400)
   e rolagem horizontal no celular;
4. grava `report.json` (`ok`, `stage`, `problems`, `results`) e os `.png` em `/out`.

```bash
docker build -t nextcode-ui-check:1.63.0 docker/ui-check
docker run --rm --memory=3g --cpus=2 --pids-limit=512 --cap-drop=ALL --security-opt=no-new-privileges \
  -v <projeto>:/project:ro -v <saida>:/out -e UI_CHECK_PAGES='["/contatos"]' nextcode-ui-check:1.63.0
```

Primeiro uso real (P2, 07/10): pegou que o projeto "Entregue" com `tsc` 0 erros **não passava no
`next build`** (faltava o layout raiz do App Router).

Limites atuais: ainda não está ligado à fila (roda à mão); o contêiner tem rede (o `npm install`
precisa); não clica nem preenche formulários (só abre e observa).
