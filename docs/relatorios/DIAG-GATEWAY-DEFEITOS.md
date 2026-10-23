# Relatório DG1 — Diagnóstico dos Defeitos do Gateway Asaas

**Tarefa:** DG1 — Diagnóstico: por que os defeitos do Gateway só aparecem na revisão final (só leitura, nenhum conserto)  
**Sessão auditada:** `4d019f00-eca9-43d4-adf8-2217988fc57e` ("Sessão - Gateway")  
**Data:** 23/10/2026 (22/10/2026 local)  

---

## Trava T-F — Integridade do Banco de Dados (`prisma/dev.db`)
- Horário de modificação antes do diagnóstico: `22/10/2026 18:54:59` (Length: `784777216` bytes)
- Horário de modificação após execução dos scripts: `22/10/2026 18:54:59` (Length: `784777216` bytes)
- **Status:** **100% Intocado** (execução isolada em cópia temporária `%TEMP%\nc-dg1\dev.db`).

---

## Passo 0 — Fechar a Marcação Pendente
- **O que foi feito:** Na linha 1 da §3.1 de `docs/NEXTCODE-REFERENCIA.md`, o texto foi atualizado exatamente para `relatório entregue (ACEITO COM RESSALVA) — aguarda auditoria do Claude`.
- **Commit realizado:** `0bb33c9` — `docs(referencia): TESTE-E5 entregue, aguarda auditoria`
- **Desvios:** Nenhum.
- **O que não foi feito:** Nenhum.

---

## Passo 1 — Leitura da Trilha e Histórico da Sessão `4d019f00`

- **O que foi feito:** Criado o script `scripts/diag-gateway-defeitos.ts` que copia `dev.db`, `dev.db-wal` e `dev.db-shm` para `%TEMP%\nc-dg1\`, redefine `DATABASE_URL` e extrai da trilha em JSON por linha:
  1. Revisões finais (`FINAL_REVIEW` e `FINAL_REVIEW_PROOFS`) em ordem cronológica;
  2. Rodadas de reparo (`DELIVERY_REPAIR_PLANNED`);
  3. Plano original de 40 `TaskNode`s (`ANALISTA_PLAN_APPROVED` e `PLANO_T8B_OK`);
  4. Resultados de avaliadores por etapa e eventos de autoteste.
- **Comandos de validação:**
  - `npx tsc --noEmit -p .`: 0 erros.
  - `npx vitest run`:
    ```
    Test Files  162 passed (162)
         Tests  1045 passed (1045)
      Start at  22:00:54
      Duration  183.94s (transform 2.64s, setup 1.60s, collect 20.37s, tests 121.53s, environment 29ms, prepare 13.66s)
    ```
- **Desvios:** Nenhum.
- **O que não foi feito:** Nenhum.

### Resumo dos Eventos Extraídos da Trilha
- **Sessão:** `4d019f00-eca9-43d4-adf8-2217988fc57e` criada em 21/10/2026.
- **Plano Original:** `ANALISTA_PLAN_APPROVED` em 21/10/2026 18:08:21 UTC (40 etapas, modelo `deepseek-v4-pro`, T8B validado).
- **Total de nós criados na sessão:** 73 nós (40 etapas originais + 33 etapas de reparo em 7 rodadas).
- **Revisões Finais Registradas:**
  1. `22/10/2026 00:54:23`: Aprovada indevidamente sem bancada (pré-J3, 0 defeitos).
  2. `22/10/2026 01:38:52`: 14 defeitos (primeira execução com J3).
  3. `22/10/2026 08:35:05`: 5 defeitos.
  4. `22/10/2026 10:41:55`: 9 defeitos.
  5. `22/10/2026 10:51:59`: 8 defeitos.
  6. `22/10/2026 11:34:03`: 1 defeito.
  7. `22/10/2026 11:45:47`: 0 defeitos.
  8. `22/10/2026 16:41:55`: 9 defeitos (retomada com bancada Docker 43.1/43.2).
  9. `22/10/2026 17:10:54`: 7 defeitos.
  10. `22/10/2026 17:24:54`: 13 defeitos.
  11. `22/10/2026 17:48:27`: 8 defeitos.
  12. `22/10/2026 18:04:06`: 9 defeitos.
  13. `22/10/2026 18:31:03`: 7 defeitos.
  14. `22/10/2026 22:41:30`: 12 defeitos (5 provados na rodada + 4 provas anteriores reexecutadas + 1 importante + 2 sem prova).

---

## Passo 2 — Tabela dos Defeitos Provados que Sobraram

Análise detalhada de cada defeito provado por teste na última revisão final (`22/10/2026 22:41:30.799Z`):

| REQ | Arquivo do Defeito | Etapa Dona no Plano Original | REQ no Microbrief da Etapa? | Autoteste E5 gerou teste? Passou? | O que o avaliador da etapa disse do REQ | O REQ depende de arquivo de outra etapa? Qual? | Apareceu em qual revisão final? | Causa e Evidência |
|---|---|---|---|---|---|---|---|---|
| **REQ-008** (e REQ-007) | `src/lib/tenant.ts:15-27` / `src/app/api/auth/login/route.ts:28-32` | `task-analista-1792606101497-4` (Etapa 4: `lib/auth.ts`, `lib/tenant.ts`) e `task-analista-1792606101497-16` (Etapa 16: `login/route.ts`) | Na Etapa 4: **SIM** (REQ-007 e REQ-008). Na Etapa 16: **NÃO** (só REQ-010 a REQ-013). | **Não gerou** (Autoteste E5 não existia em 21/10). | Na Etapa 4: marcou `implementado` (`src/lib/tenant.ts:15-23`). Na Etapa 16: marcou `implementado` (`login/route.ts:20-30`) sem ressalvas sobre o papel. | **SIM:** `tenant.ts` lê o cookie/JWT criado por `login/route.ts` (Etapa 16) usando `criarSessao` de `auth.ts` (Etapa 4). | 5ª revisão (e repetido como prova anterior na 6ª e 7ª). | **Plano e Avaliador:** O plano separou a biblioteca de sessão (Etapa 4) da rota que cria a sessão (Etapa 16). O avaliador da Etapa 16 não conferiu que `criarSessao` exigia o papel do usuário. |
| **REQ-035** | `src/lib/whitelabel.ts:24-54` | `task-analista-1792606101497-12` (Etapa 12: `lib/whitelabel.ts`) | **SIM** (REQ-035 estava no Microbrief). | **Não gerou** (Autoteste E5 não existia em 21/10). | Marcou `implementado` (`src/lib/whitelabel.ts:22-51`) com 0 ressalvas. | **SIM:** `obterMarca` é consumido por `src/app/api/checkout/[slug]/route.ts` (Etapa 26) e `src/app/api/whitelabel/route.ts` (Etapa 24). | 7ª revisão (provado pelo teste `D2-whitelabel-campos-marca.test.ts`). | **Executor e Avaliador:** O executor omitiu `mensagemCheckout`, `nomeMarca` e `emailSuporte` de `obterMarca`. O avaliador aprovou sem checar o schema do Prisma. |
| **REQ-053** | `tests/webhook-asaas.test.ts:59-99` / `src/app/api/webhooks/asaas/route.ts:246` | `task-analista-1792606101497-40` (Etapa 40: testes) e `task-analista-1792606101497-14` (Etapa 14: rota webhook) | Na Etapa 40: **SIM** (REQ-053). Na Etapa 14: **NÃO** (tinha o REQ-018). | **Não gerou** (Autoteste E5 não existia em 21/10). | Na Etapa 14: avaliador deu `implementado`, mas **avisou na ressalva** que eventos repetidos reenviam comprovante (`route.ts:296-313`). Na Etapa 40: aprovou o teste com mock falho sem rodar. | **SIM:** O teste mocka a rota da Etapa 14 e o serviço de comprovante da Etapa 13. | 4ª revisão (com bancada 43.1). | **Plano e Avaliador:** O avaliador da Etapa 14 identificou a falta de atomicidade no comprovante nas ressalvas, mas aprovou a etapa. O avaliador da Etapa 40 aprovou o teste unitário estaticamente sem execução na bancada. |
| **REQ-060** | `src/lib/admin.ts:13` | `task-analista-1792606101497-34` (Etapa 34: `lib/admin.ts`) | **SIM** (REQ-060 estava no Microbrief). | **Não gerou** (Autoteste E5 não existia em 21/10). | Marcou `implementado` (`src/lib/admin.ts:7-19`) com 0 ressalvas. | **SIM:** Depende de `src/lib/auth.ts` (Etapa 4), onde os papéis são `DONO`, `ADMIN` e `OPERADOR`, e o flag booleano é `adminPlataforma`. | 5ª revisão (e repetido na 6ª e 7ª). | **Plano e Avaliador:** `lib/admin.ts` (Etapa 34) comparou `sessao.papel === "admin"` (minúsculo), valor inexistente no enum de `auth.ts` (Etapa 4). O avaliador da Etapa 34 aprovou isoladamente sem conferir o enum da Etapa 4. |
| **REQ-063** | `src/app/admin/page.tsx:222` | `task-analista-1792606101497-36` (Etapa 36: `admin/page.tsx`) | **SIM** (REQ-063 estava no Microbrief). | **Não gerou** (Autoteste E5 não existia em 21/10). | Marcou `implementado` (`src/app/admin/page.tsx:138-143`), mas **registrou nas ressalvas** que `papel === 'admin'` era divergente de `adminPlataforma`. | **SIM:** Depende de `src/lib/admin.ts` (Etapa 34) e `src/lib/auth.ts` (Etapa 4). | 5ª revisão (e repetido na 6ª e 7ª). | **Avaliador:** O avaliador da Etapa 36 detectou expressamente o bug na ressalva da trilha, mas deu veredito `implementado` e aprovou a etapa em vez de reprovar. |
| **REQ-006** | `src/lib/validacoes.ts:85-91` | `task-analista-1792606101497-2` (Etapa 2: validações) | **SIM** (REQ-006 estava no Microbrief). | **Não gerou** (Autoteste E5 não existia em 21/10). | Marcou `implementado` (`src/lib/validacoes.ts:66-92`) sem ressalvas sobre WhatsApp. | **SIM:** Consumido por `cobrancas-service.ts` (Etapa 9) e `whatsapp.ts` (Etapa 11). | 7ª revisão (provado na bancada pelo teste `I1-pagador-whatsapp-invalido.test.ts`). | **Executor e Avaliador:** O executor fez schema frouxo aceitando qualquer string em whatsapp; o avaliador da Etapa 2 aprovou estaticamente sem validar formatos E.164. |

---

## Passo 3 — Padrão e Respostas Numéricas

1. **Quantos defeitos são de integração entre etapas e quantos são de uma etapa só?**
   - **Integração entre etapas:** **5 defeitos (83,3%)** (`REQ-008/007`, `REQ-035`, `REQ-053`, `REQ-060`, `REQ-063`).
   - **Uma etapa só:** **1 defeito (16,7%)** (`REQ-006` em `lib/validacoes.ts`).
2. **Quantos REQ desses defeitos tiveram teste do autoteste e passaram mesmo assim?**
   - **0 REQs (0%)**. Na data de execução do plano original (21/10/2026), o Autoteste E5 ainda não havia sido criado (commit `8c476c6` em 22/10/2026).
3. **Quantos o avaliador da etapa marcou como implementado?**
   - **6 de 6 (100%)**. Todos os REQs foram aprovados com status `implementado` pelos avaliadores de suas respectivas etapas individuais. Em **2 dos 6 casos** (`REQ-053/018` e `REQ-063`), o avaliador da etapa chegou a descrever o defeito exato no campo `ressalvas`, mas mesmo assim marcou o requisito como `implementado` e aprovou a etapa.
4. **Quantos defeitos já apareciam na 1ª revisão final e quantos surgiram depois de um reparo (regressão)?**
   - **Na 1ª revisão final (sem bancada de testes):** **0 defeitos** (falso positivo completo; tudo foi aprovado estaticamente).
   - **Na introdução da bancada de testes Docker J3 (Rodadas 4 e 5):** **4 defeitos** foram provados (`REQ-008`, `REQ-053`, `REQ-060`, `REQ-063`).
   - **Surgiram após rodadas de reparo (regressões / aprofundamento das provas):** **2 defeitos** (`REQ-035` na rodada 6 e `REQ-006` na rodada 7).

---

## Conclusão da Causa-Raiz
Os defeitos do Gateway **só apareceram na revisão final** por 3 motivos estruturais:
1. **Ausência de Execução Real Durante as Etapas:** Antes da Mudança 43, nenhuma etapa rodava testes em contêiner. O código era avaliado apenas por leitura estática do LLM avaliador.
2. **Visão Fragmentada e Isolada do Avaliador por Etapa:** Cada etapa avaliava apenas seus 1 a 3 arquivos declarados no `filesScope`. Inconsistências de contrato entre enums, tipos e assinaturas geradas em etapas distintas passavam invisíveis.
3. **Avaliador Tolerante (Falso Verde):** O avaliador anotava problemas críticos nas `ressalvas` (como em `admin/page.tsx:138-143` e `asaas/route.ts:296-313`), mas não reprovava a etapa, concedendo `status: "implementado"`.
