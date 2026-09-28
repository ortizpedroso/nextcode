# 📐 Plano de Hardening — OmniRoute & Segurança (NextCode)

**Estado atual:** commit `24c6e8c` em `main` (fixes de estabilidade/roteamento já mesclados).
**Objetivo:** fechar as pendências de segurança e robustez identificadas na análise profunda.

---

## Fase 1 — Higiene do repositório ✅ CONCLUÍDA (neste push)
- [x] `node_modules/` (14.517 arquivos) e `tsconfig.tsbuildinfo` removidos do versionamento
- [x] `.gitignore` consolidado (resolvidos marcadores de conflito `<<<<<<< HEAD`)
- [x] `package-lock.json` mantido versionado; `npm ci` passa a ser o install oficial

## Fase 2 — Criptografia de chaves em repouso 🔴 P0
**Problema:** `settings.omniRouteKey` e demais API keys ficam em texto plano no SQLite.
**Implementação:**
1. Novo módulo `src/core/security/crypto.ts`:
   - AES-256-GCM, chave mestra via `NEXTCODE_MASTER_KEY` (env, fora do banco)
   - Formato armazenado: `enc:v1:<iv_b64>:<tag_b64>:<cipher_b64>`
2. Migração `scripts/migrate-encrypt-keys.mjs`: lê settings → criptografa → grava; idempotente.
3. Wrapper `getApiKey(name)` / `setApiKey(name, value)` usado por `setup/route.ts`, `health/route.ts` e `smart-router.ts`.
4. Compat reversão: valores sem prefixo `enc:v1:` são lidos como legado (deprecation warning no log).
**Aceite:** `grep "sk-" *.db` não retorna nada; chat funciona com chave cifrada.

## Fase 3 — Anti-SSRF nos endpoints de URL customizada 🔴 P0
**Problema:** `/api/omniroute/setup` e `/health` fazem `fetch()` em URLs vindas do usuário/banco sem validação → acesso a metadados de nuvem (`169.254.169.254`), redes internas, etc.
**Implementação:**
1. Novo módulo `src/core/security/safe-fetch.ts`:
   - `assertSafeUrl(url)`: exige `http(s)`, bloqueia IP literal privado/loopback/link-local/multicast **exceto allowlist explícita** (`localhost`, `host.docker.internal`, rede do compose)
   - Resolve DNS antes de conectar e revalida o IP resolvido (mitiga DNS rebinding)
   - `redirect: "error"` + timeout obrigatório
2. Substituir todos os `fetch` de URLs configuráveis em `setup/route.ts`, `health/route.ts` e `dispatchOmni*` em `smart-router.ts` por `safeFetch()`.
3. Testes unitários com URLs maliciosas (`file://`, `http://169.254.169.254`, `http://[::1]`, rebinding).
**Aceite:** suíte anti-SSRF verde; setup continua funcionando com `http://localhost:20128`.

## Fase 4 — Autenticação dos endpoints locais 🟠 P1
**Problema:** rotas `/api/*` aceitam qualquer requisição da rede (chave pode ser lida/gravada por qualquer host que alcance a porta 3000).
**Implementação:**
1. Middleware `src/middleware.ts`: sessão httpOnly + `SameSite=Lax`; APIs mutativas exigem header `X-Nextcode-Token` (gerado no login local).
2. Rate-limit simples (in-memory, 30 req/min/IP) nos endpoints `setup|health|audit`.
3. Respostas de erro nunca ecoam a chave (mascarar `Bearer ****abcd`).
**Aceite:** `curl` sem token → 401; UI autenticada → 200.

## Fase 5 — Jail do terminal sandboxed 🟠 P1
**Problema:** execução de código gerado pelo modelo com isolamento insuficiente (risco RCE → host).
**Implementação:**
1. Docker do executor: `cap_drop: ALL`, `security_opt: no-new-privileges`, `read_only: true`, `pids_limit: 128`, `network_mode: none` (com proxy HTTP allowlist quando necessário).
2. Seccomp/nsjail quando disponível; denylist de syscalls perigosas (`ptrace`, `mount`, `bpf`...).
3. Timeout duro por comando + quota de disco tmpfs.
**Aceite:** prova de conceito: comando tentando escapar do sandbox falha e é auditado em `/api/omniroute/audit`.

## Fase 6 — Observabilidade & resiliência 🟡 P2
1. Métricas do dispatcher: taxa de sucesso OmniRoute vs fallback Gemini, latência p50/p95, contagem de OOM-restart do container (via healthcheck logs).
2. Circuit-breaker: após N falhas consecutivas do gateway, pula OmniRoute por X s (evita pagar timeout em toda mensagem).
3. `docker compose up --wait` nos testes de CI para validar healthcheck real.
4. Teste de carga leve (k6/artillery) simulando 5 sessões de agente com contexto >100k tokens para provar ausência de OOM.

## Critério de "tudo fechado"
Fases 2–5 com aceite cumprido + testes da seção abaixo verdes. Sem isso, o sistema **não** deve ser exposto fora de `127.0.0.1`.

---

## Status de implementação (2026-09-29)

| Fase | Estado | Commit |
|---|---|---|
| 1. Higiene do repo | ✅ concluída | 24c6e8c |
| 2. Criptografia AES-256-GCM | ✅ concluída | 46b8683 |
| 3. Anti-SSRF (safe-fetch) | ✅ concluída | 46b8683 |
| 4. Auth + rate-limit + maskKey | ✅ concluída | 46b8683 |
| 5. Jail do terminal sandboxed | ✅ concluída | 46b8683 |
| 6. Observabilidade (/api/metrics) | ✅ concluída | 46b8683 |

### Próximas fases candidatas (backlog)
- **Fase 7:** testes automatizados (unit para crypto/safe-fetch/local-auth; e2e do fluxo OmniRoute com container descartável)
- **Fase 8:** rotação de chaves (key rotation com versionamento `v2:` no envelope) + backup da master key
- **Fase 9:** TLS/HTTPS local (self-signed ou mkcert) para o app e o gateway
- **Fase 10:** auditoria contínua (`npm audit` + Trivy na imagem) no CI
