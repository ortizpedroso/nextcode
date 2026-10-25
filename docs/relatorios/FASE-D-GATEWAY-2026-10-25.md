# Fase D — Teste real Gateway Asaas (primeira passagem)

**Data do teste:** 2026-10-25  
**Projeto:** Gateway Multiplataforma (whitelabel Asaas)  
**Escopo da Spec:** 75 REQs, 12 módulos, ~90+ arquivos declarados  
**Status no harness:** Spec em `aguardando_aprovacao` após elicitação + conferência mecânica/LLM  

---

## Itens para correção (colar no NextCode antes de aprovar)

**Pré-requisito:** dev server na `main` ≥ commit `59bdb5d` (Dockerfile/Caddyfile não são mais apagados pela auto-cura).

```
Correção da Spec antes da aprovação:

1) Módulo `infra` — incluir em `arquivos`:
   - Dockerfile
   - deploy/Caddyfile

2) `arquivos_afetados` — incluir:
   - Dockerfile
   - deploy/Caddyfile

3) Conferir critérios:
   - REQ-005 cita Dockerfile
   - REQ-008 cita deploy/Caddyfile

4) Manter notas T7 Asaas e premissas que você aceita.

5) Regenerar Spec canônica + conferência. Aprovar só se:
   - não aparecer “Removido … Dockerfile/Caddyfile”;
   - os dois paths constam em `arquivos_afetados` e no módulo `infra`.
```

**Status das correções no produto**

| Item | Status |
|------|--------|
| Allowlist `Dockerfile` / `Caddyfile` na auto-cura | ✅ `59bdb5d` |
| Prompt rascunho cita arquivos sem extensão permitidos | ✅ `59bdb5d` |
| Data: carimbo automático (modelo não precisa acertar) | ✅ já existia; ver RCA abaixo |
| Aviso se auto-cura remove arquivo citado em REQ | ⏳ backlog |
| Telemetria lista dos 13 problemas da 1ª conferência | ⏳ backlog (ver abaixo como recuperar) |
| Elicitador: exemplo infra com Dockerfile no módulo | ⏳ backlog |

---

## O que aconteceu (observado)

| Evento | Detalhe |
|--------|---------|
| Conferência 1ª rodada | 13 problema(s) (`checkSpecStructure`) |
| Conferência 2ª rodada (LLM) | 0 problemas (`SPEC_FIX_CALL`, spec adotada se melhorou) |
| Auto-cura mecânica (SM1) | 3 correções (`SPEC_AUTO_HEAL` na telemetria) |
| Data | Modelo escreveu data errada (ex.: `2025-06-10`); **texto final** carimbado `2026-10-25` |
| Arquivos removidos | `Dockerfile`, `deploy/Caddyfile` (antes do fix `59bdb5d`) |
| Premissas | Vários REQs com `origem: premissa:` (comportamento esperado do elicitador) |

---

## RCA — Por que a **data** da Spec “sempre vem errada”?

### O que o usuário vê

- Na mensagem do chat: *“Data da Spec corrigida para 2026-10-25 (o modelo escreveu …)”*.
- No YAML exibido **depois** da auto-cura: `data: 2026-10-25` (correto).
- Sensação de “sempre errada” vem do **aviso repetido**, não do artefato final gravado.

### De onde a data **não** vem

- Não é relógio do banco, timezone da VPS, nem `prisma`.
- Não é a data do pedido do usuário copiada automaticamente.

### De onde a data **vem** (cadeia no código)

1. **Prompt do escritor da Spec** (`buildSpecWriterSystemPrompt` em `src/core/orchestrator/spec-draft.ts`, ~linha 45) manda o modelo preencher literalmente:
   ```yaml
   data: "<AAAA-MM-DD>"
   ```
   Ou seja, o LLM **tem que inventar** uma data. Modelos não recebem “hoje” de forma confiável no prompt (salvo injeção explícita); tendem a datas de exemplos de treino (2024, 2025, datas aleatórias como `2025-06-10`).

2. **Resposta do elicitador / 2ª chamada de correção** (`src/app/api/chat/route.ts`): o YAML parseado traz `data` do texto do modelo.

3. **Guarda cumulativa** (`applyCumulativeSpecGuard`, `spec-draft.ts` ~300): ao mesclar rascunhos, usa `newParsed.data || prevParsed?.data || new Date()…` — ainda pode propagar data errada **até** a auto-cura.

4. **Auto-cura** (`autoHealSpecDocument`, `spec-auto-heal.ts` ~181–191):
   - Compara `spec.data` com `specDateToday()` (data local do **servidor Node**, formato `YYYY-MM-DD`).
   - Se diferente, adiciona item em `fixesApplied` (mensagem no chat).
   - **Sempre** grava no documento canônico `data: specDateToday()` — independente do que o modelo escreveu.

5. **Persistência** (`chat/route.ts` ~1047–1050): `canonicalSpec` gravada **depois** da auto-cura → DB deve ter a data carimbada.

**Referência de teste:** `tests/intake/sm1-conferencia-spec.test.ts` — caso “(c) data carimbada”.

### Causa raiz (data)

| Camada | Problema |
|--------|----------|
| Produto | Pedir ao LLM um campo que deve ser **determinístico** (data do dia). |
| UX | Tratar correção como “erro do usuário” em vez de “campo ignorado / preenchido pelo harness”. |
| Modelo | Preencher placeholder com data plausível mas incorreta. |

### Como evitar que “pareça errado” de novo

1. **Prompt:** remover `data` do template do modelo; instruir: *“Não escreva `data`; o NextCode carimba.”* (backlog).
2. **Auto-cura:** manter carimbo (já correto); opcional **não** listar na UI se a única mudança for data (ruído).
3. **Documentação:** na tela de revisão, nota fixa: *“A data é sempre a do dia em que a Spec passou pela auto-cura.”*

---

## RCA — Por que **faltaram** `Dockerfile` e `deploy/Caddyfile`?

### Sintoma

- Chat: *Removido diretório ou caminho inválido de arquivos_afetados: "Dockerfile"* (e idem Caddyfile).
- Módulo `infra` na Spec original listava `docker-compose.yml` etc., mas **não** listava Dockerfile/Caddyfile em `modulos[].arquivos` (só em REQs e possivelmente em `arquivos_afetados` até a auto-cura).

### Cadeia causal (ordem real no pipeline)

```
Elicitador (LLM)
  → YAML com arquivos_afetados incluindo Dockerfile / deploy/Caddyfile
  → applyCumulativeSpecGuard (1ª Spec: sem versão anterior para reinjetar)
  → checkSpecStructure → 13 problemas (2ª chamada LLM SPEC_FIX_CALL)
  → autoHealSpecDocument
       → isConcreteFilePath("Dockerfile") === false  [ANTES do 59bdb5d]
       → filter REMOVE paths “sem extensão”
       → fixesApplied + arquivos_afetados SEM Dockerfile/Caddyfile
  → canonicalSpec gravada sem esses paths
  → DAG / analista só enxergam arquivos_afetados → risco de não planejar REQ-005/008
```

### Causas raiz (arquivos)

| # | Causa | Evidência no código |
|---|--------|---------------------|
| R1 | Heurística SM1 tratava “arquivo concreto” = “tem ponto no basename” | `isConcreteFilePath()` em `spec-auto-heal.ts` (comentário original: eliminar pastas como `src/app/api`) |
| R2 | **Contradição de instruções** ao elicitador | `spec-draft.ts` dizia: só paths **com extensão**; REQs de deploy citam arquivos **sem** extensão |
| R3 | Modelo às vezes não coloca deploy no **módulo** `infra.arquivos` | Spec Gateway: infra com compose/health, sem Dockerfile no módulo — dependência só via REQ |
| R4 | Auto-cura **silenciosa** até SM1 (d): removia e avisava, mas não bloqueava aprovação nem cruzava com REQ | `chat/route.ts` healNotice lista remoções; `checkSpecStructure` pós-heal podia passar se critério citava `Dockerfile` como substring mas arquivo já tinha sido removido da lista → inconsistência REQ × lista |
| R5 | 2ª chamada LLM pode ter “consertado” os 13 problemas **sem** recolocar paths extensão-less | Telemetria `SPEC_FIX_CALL` guarda `problemasAntes` / `problemasDepois` (até 20 strings) — **recuperável por sessionId** |

### Correção aplicada (2026-10-25)

- `EXTENSIONLESS_FILE_BASENAMES` + regex `Dockerfile.*` em `isConcreteFilePath`.
- Prompt do rascunho atualizado para citar `Dockerfile`, `deploy/Caddyfile` como exemplos válidos.

### Backlog para não repetir

1. **Pós-auto-cura:** rodar `checkSpecStructure` e falhar se algum REQ cita path removido na mesma passagem.
2. **Ao remover path:** `fixesApplied` explícito: *“REQ-005 cita Dockerfile; path removido por heurística — revisar allowlist ou critério.”*
3. **Skill elicitador:** bloco “Infra Docker” obrigatório listar `Dockerfile`, `deploy/Caddyfile` no módulo `infra`.
4. **Conferência LLM:** incluir na 2ª chamada o diff de `arquivos_afetados` antes/depois da auto-cura (hoje auto-cura roda **depois** do fix estrutural — ordem em `chat/route.ts` ~929–959).

**Ordem atual no chat (importante para análise):**

1. `applyCumulativeSpecGuard`
2. `checkSpecStructure` → se problemas, `SPEC_FIX_CALL` (2ª LLM)
3. `autoHealSpecDocument` (pode remover paths **depois** que a 2ª LLM já “aprovou” estrutura)

Isso explica Dockerfile removido **com 0 problemas** na conferência mecânica final: a 2ª rodada zerou problemas **antes** da auto-cura destruir os paths.

---

## RCA — Os **13 problemas** da 1ª conferência

Sem export do chat, a lista exata não foi arquivada neste relatório. Origem no código:

- Função: `checkSpecStructure()` em `src/core/intake/spec-check.ts`.
- Disparo: `chat/route.ts` antes de `SPEC_FIX_CALL`.
- Telemetria: `TelemetryLogger.log({ action: "SPEC_FIX_CALL", details: { problemasAntes, problemasDepois, adotada } })`.

**Tipos mais prováveis em Spec com 75 REQs e ~90 arquivos:**

1. Critério de REQ sem substring de nenhum entry de `arquivos_afetados`.
2. Arquivo em `arquivos_afetados` não citado em nenhum critério.
3. REQ cita path (ex.: `vitest.config.ts`) fora da lista — regra SM1/T8a (`citedFilePaths`).
4. `id` fora de sequência (`REQ-001`, `REQ-002`, …).
5. Rota HTTP sem `src/app/.../route.ts` ou `page.tsx` correspondente.
6. Módulo sem `arquivos`.
7. Arquivo na lista global não pertencente a nenhum módulo.
8. Objetivo placeholder (“Especificação atualizada.”).

**Como recuperar na sessão Gateway:** consultar `TelemetryLog` onde `action IN ('SPEC_FIX_CALL', 'SPEC_AUTO_HEAL')` para o `sessionId` da Fase D.

---

## Problemas classificados (resumo)

| ID | Título | Severidade | Status mitigação |
|----|--------|------------|------------------|
| P1 | Auto-cura remove Dockerfile/Caddyfile | Alta (deploy) | ✅ allowlist `59bdb5d` |
| P2 | Data errada no texto do modelo | Média (UX) | Carimbo OK; prompt ainda pede data ao LLM |
| P3 | 13 problemas + 2ª chamada Opus | Média (custo/latência) | Telemetria existe; falta relatório automático |
| P4 | Escopo 75 REQs | Operacional | Monitorar execução |
| P5 | T7 Asaas ausente | Esperado | Premissas + pesquisa na execução |
| P6 | Auto-cura **depois** do fix LLM | Alta (design) | Backlog: reordenar ou re-validar pós-heal |

---

## Melhorias recomendadas (backlog priorizado)

| P | Item | Onde |
|---|------|------|
| P0 | Re-run `checkSpecStructure` após auto-cura; se falhar, não mostrar “0 problemas” | `chat/route.ts` |
| P0 | Cruzar paths removidos na auto-cura com `citedFilePaths` dos REQs | `spec-auto-heal.ts` |
| P1 | Remover campo `data` do template LLM; só `specDateToday()` | `spec-draft.ts` |
| P1 | Skill elicitador: módulo infra mínimo (Dockerfile, Caddyfile, compose) | `skills/elicitador/SKILL.md` |
| P2 | Export markdown automático de `SPEC_FIX_CALL.problemasAntes` | `chat/route.ts` ou script |
| P2 | UI: diff `arquivos_afetados` antes/depois auto-cura | front revisão Spec |
| P3 | Specs >40 REQs: sugestão de faseamento MVP | produto |

---

## Configuração do teste

- `NEXTCODE_TETO_CUSTO=desligado` em `.env.local` (teto DAG desligado).
- Conferência Macrobrief: YAML `conferencia_entrada: sombra` (salvo env).
- Bench P1–P4 **não** reproduz este cenário (`NEXTCODE_CONFERENCIA_ENTRADA=desligado` no bench).

---

## Diário de execução (preencher depois)

- [ ] sessionId / projectId  
- [ ] `SPEC_FIX_CALL.problemasAntes` (colar JSON da telemetria)  
- [ ] `SPEC_AUTO_HEAL.correcoes` (colar JSON)  
- [ ] Aprovação humana da Spec (timestamp)  
- [ ] Conferência Macrobrief (aprovado / voltas / bloqueio)  
- [ ] `planoReprovado`? (motivo)  
- [ ] Fase final, aceite, custo LLM  
- [ ] Incidentes (cluster gap, revisão final, teto se reativado)  

---

## Referências de código

| Tema | Arquivo |
|------|---------|
| Prompt pede `data: "<AAAA-MM-DD>"` | `src/core/orchestrator/spec-draft.ts` |
| Carimbo de data | `src/core/intake/spec-auto-heal.ts` (`specDateToday`) |
| Filtro de paths / allowlist | `src/core/intake/spec-auto-heal.ts` (`isConcreteFilePath`) |
| Conferência mecânica | `src/core/intake/spec-check.ts` |
| Ordem fix LLM → auto-cura | `src/app/api/chat/route.ts` (~900–960) |
| Telemetria | `SPEC_FIX_CALL`, `SPEC_AUTO_HEAL`, `SPEC_REQ_ORIGINS` |
| Replay histórico | `docs/relatorios/REPLAY-GATEWAY-A1.json` |

---

## Histórico deste documento

| Data | Alteração |
|------|-----------|
| 2026-10-25 | Registro inicial Fase D + P1/P2 |
| 2026-10-25 | RCA data + RCA arquivos + ordem pipeline + itens para correção + backlog P6 |
