# Fase D — Teste real Gateway Asaas (primeira passagem)

**Data:** 2026-10-25  
**Projeto:** Gateway Multiplataforma (whitelabel Asaas)  
**Escopo da Spec:** 75 REQs, 12 módulos, ~90+ arquivos declarados  
**Status no harness:** Spec em `aguardando_aprovacao` após elicitação + conferência mecânica/LLM  

## O que aconteceu (observado)

| Evento | Detalhe |
|--------|---------|
| Conferência 1ª rodada | 13 problema(s) estruturais na Spec |
| Conferência 2ª rodada (correção modelo) | 0 problemas |
| Auto-cura mecânica (SM1) | 3 correções aplicadas antes da revisão humana |
| Data da Spec | Modelo escreveu data errada; carimbada para `2026-10-25` |
| Arquivos removidos | `Dockerfile`, `deploy/Caddyfile` de `arquivos_afetados` |
| Premissas | 10+ REQs marcados como `premissa:` pelo elicitador (esperado) |

## Problemas classificados

### P1 — Falso positivo da auto-cura (crítico para deploy)

**Sintoma:** Mensagens do tipo *"Removido diretório ou caminho inválido de arquivos_afetados: Dockerfile"*.

**Causa raiz:** `isConcreteFilePath()` em `src/core/intake/spec-auto-heal.ts` exigia ponto no último segmento do caminho. `Dockerfile` e `deploy/Caddyfile` são arquivos reais de build, mas não têm “extensão” no sentido da heurística.

**Impacto:** REQ-005, REQ-007 e REQ-008 citam Dockerfile / Caddyfile nos critérios, mas os caminhos sumiam da lista → risco de **nenhuma etapa** ser planejada para infra de container/proxy; conferência mecânica poderia reprovar de novo se o elicitador recolocasse os paths.

**Correção no NextCode (2026-10-25):** allowlist + padrão `Dockerfile.*` em `isConcreteFilePath`; prompt do rascunho (`spec-draft.ts`) atualizado; testes em `spec-auto-heal.test.ts`.

**Ação do fundador:** Reiniciar o dev server com o commit que contém a correção; pedir ao elicitador reincorporar os dois arquivos (texto abaixo) ou reabrir a Spec e salvar de novo.

### P2 — Data inventada pelo modelo

**Sintoma:** `data: 2025-06-10` (exemplo) em vez do dia atual.

**Causa:** Alucinação / template antigo do modelo.

**Mitigação existente:** `specDateToday()` na auto-cura carimba a data local.

**Melhoria sugerida:** Mostrar na UI *"data ajustada automaticamente"* junto com as outras auto-correções (hoje só aparece na lista genérica).

### P3 — Volume da 1ª conferência (13 itens)

**Sintoma:** Duas chamadas ao pipeline de correção antes de `aguardando_aprovacao`.

**Hipóteses (sem log exportado nesta sessão):** critérios de REQ sem substring de arquivo em `arquivos_afetados`; rotas sem `route.ts`/`page.tsx` correspondente; IDs REQ fora de sequência; arquivos de módulo não listados; objetivo placeholder.

**Melhoria sugerida:** Persistir em telemetria (`SPEC_CONFERENCE_PROBLEMS`) a lista completa de strings de `checkSpecStructure()` antes/depois de cada rodada, para relatórios Fase D sem depender de print do chat.

### P4 — Escopo massivo (75 REQs)

**Risco operacional:** Macrobrief e plano do analista com dezenas de clusters/etapas; tempo e custo altos; maior chance de flakiness na revisão final (como P3 no bench).

**Não é bug:** é característica do teste Gateway. Monitorar fase, `planoReprovado`, cluster gaps e bloqueios de conferência **sombra**.

### P5 — T7 Asaas ausente

**Esperado:** Spec declara em `notas_implementacao` que não houve bloco Documentação oficial (T7). Implementação da Asaas fica em premissa até pesquisa oficial.

**Melhoria:** Para projetos com `Asaas` na stack, o harness já pode pesquisar T7 na elicitação — garantir que a conversa dispare o fetch antes da Spec final (já previsto na skill elicitador).

## Melhorias recomendadas (backlog)

| Prioridade | Item | Onde |
|------------|------|------|
| Alta | Allowlist Dockerfile/Caddyfile/Makefile | `spec-auto-heal.ts` (feito) |
| Alta | Ao remover arquivo na auto-cura, se um REQ cita o basename, avisar: *"REQ-00X cita Dockerfile; inclua de novo ou ajuste o critério"* | `spec-auto-heal.ts` + `checkSpecStructure` |
| Média | Telemetria/export dos 13 problemas da conferência | `intake-engine.ts` |
| Média | Skill elicitador: exemplos explícitos `Dockerfile`, `deploy/Caddyfile` no módulo infra | `skills/elicitador/SKILL.md` |
| Média | UI: diff `arquivos_afetados` antes/depois da auto-cura | front Spec review |
| Baixa | Gate opcional: Specs com >40 REQs sugerem faseamento (MVP / v1) | produto |

## Configuração do teste

- `NEXTCODE_TETO_CUSTO=desligado` em `.env.local` (teto da DAG desligado para análise de custo real).
- Conferência: YAML `sombra` (laudo reprovado bloqueia), salvo override de env.
- Bench **não** representa este teste (`CONFERENCIA_ENTRADA=desligado` no bench).

## Próximas anotações (preencher após aprovar e rodar)

- [ ] sessionId / projectId  
- [ ] Aprovação humana da Spec (timestamp)  
- [ ] Resultado conferência Macrobrief (aprovado / voltas / bloqueio)  
- [ ] `planoReprovado`? (motivo)  
- [ ] Fase final, aceite, custo total (LLM_COST)  
- [ ] Incidentes: TETO (se reativar teto), cluster gap, revisão final  

## Referências de código

- Auto-cura: `src/core/intake/spec-auto-heal.ts`
- Conferência mecânica Spec: `src/core/intake/spec-check.ts`
- Prompt rascunho Spec: `src/core/orchestrator/spec-draft.ts`
- Replay histórico (não rodado local): `docs/relatorios/REPLAY-GATEWAY-A1.json`
