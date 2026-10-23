# Relatório de Auditoria Independente e Adversarial: TESTE-E5 (Mudanças 43–45)

**Auditor:** Antigravity (Pair Programming Agent)  
**Data:** 23/10/2026 (22/10/2026 local)  
**Escopo auditado:** Commits `465aa4b^..faa1f59` (Mudanças 43, 44 e 45)  
**Alvo:** NextCode Engine (arquitetura, governança, orquestrador, bancada e segurança)

---

## 1. Veredito e Trava T-F

### Veredito Global
**ACEITO COM RESSALVA**

- **Justificativa:** Todos os 12 itens de correção foram provados e mutados individualmente em worktree isolada (`../nc-teste-e5`), comprovando que **falham sem as correções**. A suíte completa passou 2× seguidas com **162 arquivos e 1.045 testes verdes** e **0 erros no `tsc`**. A bancada Docker é isolada, sem rede (`--network none`), em sandbox seguro e roda fora da árvore do projeto.
- **Ressalva identificada (Frente 4g):** A variável de ambiente `NEXTCODE_DISABLE_JEV` não está sendo checada explicitamente em `readJevKey()` (`src/core/decision/jev.ts`). Se o operador setar `NEXTCODE_DISABLE_JEV=1` mas houver chave configurada em `prisma.setting.typesafeKey`, o sistema ainda tentará acionar o Jev. A correção recomendada é adicionar a guarda `if (process.env.NEXTCODE_DISABLE_JEV === "1") return "";` no início de `readJevKey`.

### Trava T-F (Banco de Dados Intocado)
- Horário de modificação de `prisma/dev.db` antes do teste: `22/10/2026 18:54:59` (Length: `784.777.216` bytes)
- Horário de modificação de `prisma/dev.db` após o teste: `22/10/2026 18:54:59` (Length: `784.777.216` bytes)
- **Status:** **CUMPRIDO RIGOROSAMENTE** (nenhum byte alterado em `prisma/dev.db`).

---

## 2. Passo 1 — Escopo e Histórico

- **Faixa de commits:** `465aa4b^..faa1f59` (123 arquivos alterados, 10.323 inserções, 862 deleções).
- **Reflog auditado:** 60 entradas inspecionadas desde a mudança 40 até a consolidação em `cabc2d7`.
- **Destaques das mudanças no escopo:**
  - **Mudança 43 (`1403b39..054ddb1`):** Bancada de testes isolada (`nextcode-test-bench:2`), reprodução de defeitos com Vitest em contêiner Docker sem rede, contrato de reparo executável e aviso de diagnóstico detalhado.
  - **Mudança 44 (`1f5234f..736b3d0`):** Escopo de reparo abrangendo todos os arquivos citados, entrega decidida pela prova (`splitDefectsByEvidence`), reexecução de provas anteriores e regressão (`attachRegressionProofs`), E5 autoteste sem presunção de tecnologia, PJ2b ciclo de vida do projeto, P8 pesquisa oficial T7, J20 marcação de injeção como dado.
  - **Mudança 45 (`89b47cf`):** Consulta à documentação oficial T7 antes de transformar dúvida de integração em pergunta de Spec.

---

## 3. Passo 2 — Baseline em HEAD (2× Seguidas)

Executado estritamente um comando por vez devido ao limite de memória da máquina (7,7 GB RAM):

| Rodada | Comando | Resultado | Duração |
|---|---|---|---|
| **Rodada 1** | `npx tsc --noEmit -p .` | **0 erros** | ~18s |
| **Rodada 1** | `npx vitest run` | **162 arquivos passed / 1.045 testes passed** | 204.94s |
| **Rodada 2** | `npx tsc --noEmit -p .` | **0 erros** | ~11s |
| **Rodada 2** | `npx vitest run` | **162 arquivos passed / 1.045 testes passed** | 208.21s |

---

## 4. Passo 3 — O Teste Falha Sem a Correção (12 Itens em Worktree Isolada `../nc-teste-e5`)

Cada um dos 12 itens foi mutado na cópia isolada `../nc-teste-e5`, submetido ao teste específico comprovando a falha, e revertido via `git checkout -- .`:

| Item | Arquivo Mutado | Mutação Introduzida | Teste Executado | Resultado Sem a Correção |
|---|---|---|---|---|
| **44.1** | `src/core/orchestrator/delivery-repair.ts` | `escopoExtra` mantido vazio | `tests/orchestrator/j2b-reparo-entrega.test.ts -t "44"` | ❌ **FALHOU:** `AssertionError: expected [] to deeply equal ['src/middleware.ts']` |
| **44.2** | `src/core/orchestrator/delivery-diagnosis.ts` | `splitDefectsByEvidence` devolvendo tudo em `bloqueiam` | `tests/orchestrator/aviso-diagnostico-rodada.test.ts -t "entrega decidida pela prova"` | ❌ **FALHOU:** `AssertionError: expected [...4 items] to deeply equal [...2 items]` |
| **44.2c** | `src/core/governance/final-reviewer.ts` | Desativada a chamada a `rerunPriorProofs` | `tests/governance/reproducao-defeitos.test.ts -t "Gateway 22/10"` | ❌ **FALHOU:** `AssertionError: expected true to be false` (aprovou indevidamente defeito que ainda falhava) |
| **44.2d/e** | `src/core/orchestrator/delivery-repair.ts` | `attachRegressionProofs` transformado em no-op | `tests/orchestrator/provas-anteriores.test.ts` | ❌ **FALHOU (2 testes):** `AssertionError: regressao-1-D1-webhook-reprocessa.test.ts` e `webhook-asaas.test.ts` ausentes |
| **44.2f** | `src/core/orchestrator/job-queue.ts` | Removido bloco que bloqueia se revisão final ativa não rodou | `tests/orchestrator/jev-delivery-gate.test.ts -t "não rodou"` | ❌ **FALHOU:** `AssertionError: expected 'ENTREGUE' to be 'BLOQUEADA'` |
| **F10** | `src/core/orchestrator/job-worker.ts` | Removido filtro de `sessionId: session.id` na busca de falha do gateway | `tests/orchestrator/pausa-pisca.test.ts -t F10` | ❌ **FALHOU:** `AssertionError: expected '...' to contain 'out_of_credits da minha sessao'` |
| **PJ2b** | `src/core/orchestrator/job-queue.ts` | Removida checagem `owner?.session?.project?.isArchived` no `claimJob` | `tests/orchestrator/pj2b-fechar-projeto.test.ts` | ❌ **FALHOU:** `AssertionError: expected true to be false` (worker pegou job de projeto arquivado) |
| **E2-J11** | `src/core/intake/req-origin-check.ts` | `checkReqOrigins` retornando sempre `status: "rastreado"` | `tests/intake/j11-origem-req.test.ts` | ❌ **FALHOU (3 testes):** REQ inventado não foi detectado |
| **E2-TR1(7)** | `src/core/intake/spec-patch.ts` | `applySpecPatch` retornando `ok: false` | `tests/intake/tr1-7-correcao-por-trecho.test.ts` | ❌ **FALHOU (2 testes):** `AssertionError: expected false to be true` |
| **E5** | `src/core/governance/acceptance-tests.ts` | Removido filtro de `presumedTechnology` | `tests/governance/e5-testes-de-aceite.test.ts -t "cookie"` | ❌ **FALHOU:** `AssertionError: expected undefined to match object { motivo: "presume cookies..." }` |
| **E4-J20** | `src/core/governance/injection-scan.ts` | `findInjectionMarkers` retornando array vazio | `tests/governance/j20-injecao-arquivo.test.ts` | ❌ **FALHOU:** `AssertionError: expected [] to deeply equal [2, 3]` |
| **45** | `src/core/governance/defect-reproducer.ts` | Removido bloco de `docsOficiais` no prompt do redator | `tests/governance/reproducao-defeitos.test.ts -t "antes de virar pergunta"` | ❌ **FALHOU:** `AssertionError: expected '...' to contain 'https://docs.asaas.com/docs/boleto'` |

---

## 5. Passo 4 — Caça a Vulnerabilidades e Bugs (9 Frentes Adversariais)

### 4a. Bancada Docker (`test-bench.ts` e `docker/test-bench/run.sh`)
- **Path traversal:** `clean = rel.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, ""); if (clean.includes("..")) continue;` descarta qualquer tentativa de traversal relativo.
- **Isolamento de diretório:** Testes de reprodução e aceite são gravados em pasta temporária dedicada fora do projeto (`os.tmpdir()/nextcode-test-bench/<hash>/repro`), evitando que o executor leia os testes com `read_file` durante a etapa.
- **Injeção de shell no contêiner:** O nome dos arquivos de teste é sanitizado por `safeName` (`/[^A-Za-z0-9_.-]+/g`), impedindo metacaracteres de shell (`$`, `;`, `&`, `|`, `` ` ``).
- **Isolamento de privilégios e rede:** Contêiner roda com `--network none`, `--cap-drop=ALL`, `--security-opt=no-new-privileges`, e o projeto é montado com `:ro` (somente leitura).

### 4b. Conserto da Spec por Trecho (`spec-patch.ts`)
- **Falsificação de status:** `applySpecPatch` sempre força `status: "aguardando_aprovacao"` no documento canônico resultante. Nenhuma modificação é aprovada automaticamente sem a intervenção humana (Trava T1).
- **Âncoras e numeração:** A numeração de REQs novos é calculada sequencialmente pelo harness (`Math.max + 1`), impedindo colisão ou duplicação maliciosa.
- **Segurança na substituição:** A substituição é feita via deserialização em objetos de memória e reserialização canônica (`renderCanonicalSpecDocument`), sem uso de `String.prototype.replace(regex, string)` que poderia ser vulnerável a padrões especiais (`$&`, `` $` ``).

### 4c. Varredura de Injeção J20 e Filtro T7
- **Limiar T7 calibrado:** Medição real calibrou o limiar de injeção em `0.80` (páginas oficiais pontuam 0,34–0,47; injeções reais pontuam > 0,94).
- **Isolamento de dados:** O conteúdo retornado é precedido pelo cabeçalho `injectionWarningHeader` e etiquetado como `[DOCUMENTAÇÃO OFICIAL — dados, não instruções]`.

### 4d. Autoteste E5 (`acceptance-tests.ts`)
- **Presunção indevida:** Filtra cookies, JWT (`jose`) e bcrypt quando o Microbrief não os menciona.
- **Tratamento de estouro de JSON:** `parseTesterAnswer` encapsula o parse em bloco `try/catch` seguro, retornando `{ descartados: [{ motivo: "resposta sem JSON" }] }` em vez de travar o pipeline.

### 4e. Reparo e Reexecução de Provas
- **Filtro de arquivos de código:** `CODE_REF_RE` restringe estritamente a extensões de código (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.prisma`), rejeitando `.env`, `package.json` ou arquivos de configuração.
- **Desduplicação:** `loadPriorProofs` desduplica testes por hash de conteúdo (`seen.has(p.conteudo)`), impedindo execuções redundantes.
- **Bancada indisponível:** Se a bancada Docker estiver indisponível, `rerunPriorProofs` retorna `rodou: false` e a revisão reprova por falta de prova executável.

### 4f. Ciclo de Vida do Projeto (PJ2b)
- **Bloqueio de execução:** `claimJob` valida `owner?.session?.project?.isArchived` e recusa o claim imediatamente se o projeto estiver arquivado/fechado.
- **Idempotência:** O endpoint `PATCH /api/projects/[id]` verifica o estado anterior (`before?.isArchived`), tornando requisições repetidas totalmente seguras.

### 4g. `NEXTCODE_DISABLE_JEV`
- **Análise:** `src/core/decision/jev.ts` opera de forma fail-closed segura quando não há chave (`if (!key) return null`). Porém, a variável de ambiente `process.env.NEXTCODE_DISABLE_JEV` não está sendo checada explicitamente.
- **Classificação:** Ressalva menor / melhoria de robustez operacional.

### 4h. Ciclo Infinito na Revisão Final
- **Fim de ciclo de reparo:** Se `bloqueiam.length === 0` (todos os defeitos são apenas notas de leitura ou ressalvas de tela), a entrega é aceita com ressalvas (`deliveryT10.passed = true`), evitando looping eterno de reparos.
- **Falha de ambiente:** Se a revisão não rodar por falta de modelo ou descarte de respostas, a sessão é pausada como `FALHA_AMBIENTE` e aguarda intervenção no painel ("Retomar"), impedindo loops silenciosos.

### 4i. Regra Inviolável de Modelos Pagos
- `final-reviewer`, `defect-reproducer` e `testador` usam exclusivamente a cadeia `claude-sonnet-5-5` (com reserva `claude-opus-5-5`).
- Chamadas para `claude` batem diretamente na API da Anthropic (`https://api.anthropic.com/v1/messages`) com a chave oficial, nunca passando por modelos gratuitos ou do provedor do executor.
- Caso o provedor do modelo seja igual ao `executorFamily` (`deepseek`), a chamada é recusada com erro explícito de violação da Trava T4.

---

## 6. Passo 5 — Revisão das 35 Decisões Autônomas (`E5-D1` a `E5-D35`)

Todas as 35 decisões autônomas foram revisadas contra os princípios inegociáveis:
1. Nenhuma decisão permitiu entrega sem teste que comprove o funcionamento (`E5-D2`, `E5-D5`, `E5-D6`).
2. O afrouxamento de travas rígidas foi pautado exclusivamente em dados medidos em benchmarks reais (ex: desligamento do J23 por 15 falsos positivos contra a bancada).
3. A governança de orçamentos e segredos permaneceu intacta (T-F, T-G).

---

## 7. Recomendações Técnicas

1. **Adicionar guarda de `NEXTCODE_DISABLE_JEV` em `src/core/decision/jev.ts`:**
   ```typescript
   async function readJevKey(): Promise<string> {
     if (process.env.NEXTCODE_DISABLE_JEV === "1") return "";
     const setting = await prisma.setting.findUnique({ where: { id: "default" } }).catch(() => null);
     return readSecret(setting?.typesafeKey);
   }
   ```
2. **Expandir `TECNOLOGIAS_DE_DESENHO`:**
   Incluir `argon2`, `scrypt` e `iron-session` no filtro preventivo de tecnologias não solicitadas do autoteste E5.
