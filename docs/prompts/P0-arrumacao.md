# Prompt P0 — Arrumação (para o Antigravity)

> Pacote P0 de `docs/NEXTCODE-REFERENCIA.md` §5.3. Escrito pelo Claude em 08/10/2026.
> Copie TUDO abaixo da linha e cole no Antigravity.

---

# Tarefa P0 — Arrumação: segredo do MCP cifrado, teste intermitente, OmniRoute com versão fixa

## OBJETIVO
Três correções pequenas e independentes, uma por commit. Nada além disto.

## TRAVAS (obrigatórias; violar qualquer uma = PARAR e relatar)
- **T-A Pré-condição.** Rode `git status --short` (só pode aparecer `.claude/`) e `git log -1 --format=%H -- docs/prompts/P0-arrumacao.md`. O `HEAD` (`git rev-parse HEAD`) deve ser igual a esse hash. Diferente → PARE.
- **T-B Escopo fechado.** Só altere os arquivos da seção PODE ALTERAR do passo em curso. Precisou de outro → PARE e relate. **Nunca** aumente timeout, nunca envolva código em `try {} catch {}` vazio e nunca use `.skip`/`.only` para um teste passar.
- **T-C Literalidade.** Faça exatamente o que está escrito; nada de refatoração, renomeação ou "melhoria" extra. Ambiguidade → PARE e pergunte. Não decida pelo fundador.
- **T-D Nomes reais.** Todo nome que citar (arquivo, função, tipo) deve existir: confira com `git grep -n "<nome>"`. Nomes novos: só os escritos neste prompt.
- **T-E Um passo = um commit.** Antes de CADA commit: `npx tsc --noEmit` (0 erros) e `npx vitest run` completo (tudo verde), **nesse estado do código**. Cole as duas saídas no relatório. **Proibido**: `git commit --amend`, `rebase`, `reset`, `push --force`, `--no-verify`.
- **T-F Banco.** Nunca escreva em `prisma/dev.db`. Teste com cópia em pasta temporária (`DATABASE_URL`).
- **T-G Segredos.** Nenhuma chave em código, log, trilha, relatório ou saída de comando colada.
- **T-H Dependências.** Nenhum pacote novo.
- **T-I Fim de linha.** Preserve o fim de linha de cada arquivo (confira com `git ls-files --eol <arquivo>` antes e depois).
- **T-J Paradas obrigatórias.** Teste antigo quebrando por motivo fora do passo; arquivo fora do escopo; contradição entre este prompt e o código. Ao parar: relatório parcial com o motivo.
- **T-K Commits** terminam com a linha: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## LEITURA OBRIGATÓRIA (antes de qualquer edição)
- `src/core/security/crypto.ts` (`writeSecret`, `readSecret`, `isEncrypted`, `maskSecret`)
- `src/app/api/mcp/servers/route.ts` (GET, POST — linha `env: typeof env === "object" ...`)
- `src/app/api/mcp/servers/[id]/route.ts` (PATCH — linha `if (env !== undefined) dataToUpdate.env = ...`)
- `prisma/schema.prisma` (`model McpServer`, campo `env String?  // JSON object string`)
- `scripts/encrypt-stored-secrets.ts`
- `tests/harness/end-to-end-harness-plan.test.ts`
- `docker-compose.yml` (serviço `omniroute`, `image: diegosouzapw/omniroute:latest`)

---

## PASSO 0.1 — `McpServer.env` cifrado em repouso

**Problema:** `McpServer.env` (objeto JSON com variáveis do servidor MCP, que podem ser chaves) é gravado em texto puro e devolvido inteiro pela API. Viola a regra "nenhum segredo em texto puro".

**PODE ALTERAR:**
- `src/core/security/mcp-env.ts` (NOVO)
- `src/app/api/mcp/servers/route.ts`
- `src/app/api/mcp/servers/[id]/route.ts`
- `scripts/encrypt-stored-secrets.ts`
- `tests/security/mcp-env.test.ts` (NOVO)

**O que fazer:**
1. Criar `src/core/security/mcp-env.ts` com exatamente estas 3 funções exportadas:
   - `encryptMcpEnv(input: unknown, stored?: string | null): string`
     - `input` `undefined`/`null`/`""` → devolve `"{}"`.
     - `input` string → `JSON.parse`; objeto → usa direto. Resultado que não seja objeto simples (array, número, texto) → `throw new Error("env deve ser um objeto JSON")`.
     - Para cada par chave/valor: valor convertido para string; se o valor **começar com `"****"`** e `stored` tiver essa mesma chave, mantém o valor cifrado guardado (o usuário não alterou); senão grava `writeSecret(valor)`. Valor vazio → chave omitida.
     - Devolve `JSON.stringify` do objeto resultante.
   - `maskMcpEnv(stored?: string | null): string` — devolve JSON com as **mesmas chaves** e cada valor substituído por `maskSecret(valor)` (que já devolve `"****"` para cifrado). JSON inválido ou vazio → `"{}"`.
   - `readMcpEnv(stored?: string | null): Record<string, string>` — devolve as chaves com `readSecret(valor)`. JSON inválido → `{}`. (Sem uso no código ainda; existe para o futuro cliente MCP.)
2. `src/app/api/mcp/servers/route.ts`:
   - POST (criar): trocar a expressão do campo `env` por `encryptMcpEnv(env)`. Erro de `encryptMcpEnv` → resposta **400** `{ error: "env deve ser um objeto JSON" }`.
   - Toda resposta que devolve servidor(es) (`GET` lista e `POST` criação) passa a devolver `env: maskMcpEnv(<env guardado>)` no lugar do valor guardado.
3. `src/app/api/mcp/servers/[id]/route.ts` (PATCH): ler o registro atual antes de atualizar; `dataToUpdate.env = encryptMcpEnv(env, atual.env)`; erro → 400 como acima; a resposta devolve `env` mascarado com `maskMcpEnv`.
4. `scripts/encrypt-stored-secrets.ts`: depois do laço de `customProvider`, acrescentar um laço sobre `prisma.mcpServer.findMany()` que, para cada servidor com `env` não vazio, cifra **cada valor ainda não cifrado com a chave ativa** usando a mesma função `convert` já existente (rótulo `McpServer.<id>.<chave>`), regrava o JSON e soma ao contador. Valor já cifrado com a chave ativa fica como está.

**Testes (arquivo `tests/security/mcp-env.test.ts`):** chave mestra de teste como em `tests/governance/secret-guard.test.ts` (`process.env.NEXTCODE_MASTER_KEY = process.env.NEXTCODE_MASTER_KEY || Buffer.alloc(32, 21).toString("base64")`), restaurada no `afterEach`.
- `encryptMcpEnv cifra todo valor e mantém as chaves` → nenhum valor original aparece no JSON resultante; `readMcpEnv` devolve os originais.
- `encryptMcpEnv aceita string JSON e objeto` → mesmo resultado para as duas formas.
- `encryptMcpEnv rejeita array e texto` → lança `"env deve ser um objeto JSON"`.
- `valor mascarado mantém o segredo guardado` → `encryptMcpEnv({ API_KEY: "****" }, guardado)` devolve o mesmo valor cifrado de `guardado`.
- `maskMcpEnv nunca devolve o valor` → todas as chaves com `"****"`.
- `API: POST /api/mcp/servers grava env cifrado e responde mascarado` (com `prisma.mcpServer.create` simulado por `vi.spyOn`, no mesmo estilo de `tests/mcp/tools-api.test.ts`) → o `data.env` enviado ao Prisma não contém o valor; a resposta não contém o valor.
- `API: PATCH com env mascarado preserva o segredo`.
- `API: env inválido responde 400`.

**Pronto quando:** testes acima verdes; `tsc` 0; suíte completa verde; 1 commit `fix(security): P0.1 - McpServer.env cifrado em repouso e mascarado nas respostas`.

---

## PASSO 0.2 — Causa do teste intermitente

**Problema:** a suíte completa falhou 1 vez em 4 execuções no commit `c7fb624` e passou nas outras 3. Antes disso, o commit `9e88b59` alterou `tests/harness/end-to-end-harness-plan.test.ts` para **aumentar o timeout para 60000** e **silenciar o erro** de `fs.rmSync` com `try {} catch {}` — isso esconde o sintoma.

**PODE ALTERAR:** somente o arquivo de teste onde a causa for encontrada **e** `tests/harness/end-to-end-harness-plan.test.ts`. Se a causa estiver em código de produção (`src/`), **PARE** e relate o arquivo, a linha e a causa (não corrija).

**O que fazer:**
1. Rodar `npx vitest run` completo **10 vezes seguidas** (com o banco em cópia temporária), guardando a saída de cada uma. Para cada falha anotar: arquivo do teste, nome do teste, mensagem de erro.
2. Se nenhuma falha em 10: relatar "não reproduzido em 10 execuções", **não alterar nada** e seguir para o passo 0.3 (sem commit neste passo).
3. Se houver falha: achar a **causa** (ex.: estado compartilhado entre testes, porta fixa, arquivo temporário com o mesmo nome, `vi.spyOn` sem restauração, ordem de execução). Corrigir a causa no arquivo de teste.
4. Em `tests/harness/end-to-end-harness-plan.test.ts`: **desfazer** o `{ timeout: 60000 }` e o `try {} catch {}` em volta de `fs.rmSync`, voltando ao que era antes de `9e88b59` (`git show 9e88b59 -- tests/harness/end-to-end-harness-plan.test.ts`), **somente se** a suíte passar 10 vezes seguidas depois disso. Se não passar, manter como está e relatar.
5. Rodar a suíte completa 10 vezes seguidas de novo: todas verdes.

**Pronto quando:** causa identificada com evidência (saída da falha) e corrigida, 10 execuções verdes coladas em resumo (`Test Files … | Tests …` de cada uma); 1 commit `test: P0.2 - causa do teste intermitente`. Se não reproduzido: sem commit, só o relatório.

---

## PASSO 0.3 — OmniRoute com versão fixa

**Problema:** `docker-compose.yml` usa `diegosouzapw/omniroute:latest`; a arquitetura (§12) exige versão fixa e testada.

**PODE ALTERAR:** `docker-compose.yml` (somente a linha `image:` do serviço `omniroute` e um comentário acima dela).

**O que fazer:**
1. Rodar `docker image inspect diegosouzapw/omniroute:latest --format "{{index .RepoDigests 0}}"`. Se o Docker não estiver disponível ou a imagem não existir localmente → **PARE este passo** (sem commit) e relate a saída do comando. **Não** faça `docker pull` (isso trocaria a versão em uso).
2. Trocar `image: diegosouzapw/omniroute:latest` pelo valor devolvido (formato `diegosouzapw/omniroute@sha256:...`). Comentário acima: `# Versão fixa (digest da imagem em uso em <data de hoje>). Atualizar só após rodar o bench (NEXTCODE-REFERENCIA §8).`
3. Rodar `docker compose config --quiet` (valida o arquivo). Não suba nem derrube containers.

**Pronto quando:** `docker compose config --quiet` sem erro; `tsc` e suíte verdes; 1 commit `chore(docker): P0.3 - OmniRoute fixado por digest`.

---

## RELATÓRIO (obrigatório) — gravar em `docs/relatorios/P0-arrumacao.md` e incluir no último commit do pacote
(se o último passo não tiver commit, fazer um commit só com o relatório: `docs(relatorio): P0`)

1. **Identificação:** hash de partida; `git log --oneline <partida>..HEAD`.
2. **Por commit:** `git show --stat <hash>`; saída do `npx tsc --noEmit`; linha final do `npx vitest run` (`Test Files … Tests …`) **daquele commit**.
3. **Testes novos:** tabela `arquivo › nome do teste › o que prova`.
4. **Evidência de nomes:** tabela `nome › saída de git grep -n` para todo nome citado no relatório.
5. **Passo 0.2:** resultado das 10 + 10 execuções; falha encontrada (arquivo, teste, mensagem); causa; correção.
6. **Passo 0.3:** saída do `docker image inspect` (só o digest) e do `docker compose config --quiet`.
7. **Desvios do prompt:** obrigatório. Escreva "nenhum" se nenhum. Inclua qualquer coisa feita a mais ou a menos.
8. **Checklist das travas T-A…T-K:** cumprida sim/não, com a evidência.
9. **Dúvidas abertas** para o fundador.
