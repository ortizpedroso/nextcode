# Relatório de Auditoria e Consolidação — Tarefa A1 (Contratos do Macrobrief)

## 1. Lista dos Commits (A1.0 a A1.5)

| Passo | Hash | Mensagem de Commit | Escopo Principal |
|---|---|---|---|
| **A1.0** | `06045ac` | `fix(politica): A1.0 - sem reserva antiga da politica em docs/` | `src/core/config/orchestration-policy.ts` (remove leitura de `docs/rascunhos/politicas-orquestracao.yaml`); remoção do arquivo de rascunho residual; teste de regressão. |
| **A1.1** | `dd47375` | `feat(a1): A1.1 - template do contrato e conferencia mecanica` | `src/core/orchestrator/project-contract.ts` (`ContratoProjeto`, `validateContract`, `renderContractTs`, `renderConformance`); `tests/orchestrator/a1-contrato.test.ts` (validação mecânica, criação em memória com `ts.createProgram`, controle do Gateway em `os.tmpdir()` com `tsc`). |
| **A1.2** | `aca39bd` | `feat(a1): A1.2 - analista escreve o contrato do Macrobrief` | `skills/analista/SKILL.md` (regras e formato de contrato); `src/core/skills/spec-decomposer.ts` (`parseAnalystPlan`, `decomposeWithAnalistaSkill`, loop de 3 rodadas, `ANALISTA_PLAN_APPROVED` com contagens, fatias de contrato em `interfacesProduz`/`interfacesConsome`); `tests/orchestrator/analista-plan.test.ts`. |
| **A1.3** | `9eeff21` | `feat(a1): A1.3 - contrato gravado, travado e conferido pelo tsc` | `src/core/skills/skill-runtime.ts` (`src/contracts/**` protegido contra escrita do executor); `src/core/orchestrator/execution-trigger.ts` (gravação de `src/contracts/index.ts`, alias `@/` no tsconfig, telemetria `CONTRATO_GRAVADO`); `src/core/orchestrator/node-executor.ts` (geração de `src/contracts/conformidade/<etapaId>.ts` na quarentena e conferência obrigatória no porteiro `tsc`); `tests/orchestrator/a1-contrato-travado.test.ts`. |
| **A1.4** | `1d7d687` | `feat(a1): A1.4 - testador, executor e avaliador usam o contrato` | `skills/testador/SKILL.md` e `skills/avaliador/SKILL.md` (divergência de contrato é crítica e reprova); `src/core/governance/acceptance-tests.ts` (prompt do testador recebe a fatia); `src/core/governance/dual-lens-auditor.ts` (avaliador cego recebe a fatia e regra crítica de contrato); `src/core/orchestrator/node-executor.ts` (fatia do contrato enviada no prompt do executor). |
| **A1.5** | `b4e2242` | `test(a1): A1.5 - prova (bench e replay do servico)` | `scripts/bench.ts` executado com 4/4 ENTREGUE e 47/47 aceite hermético Docker; `scripts/replay-contrato-a1.ts` executado com aprovação em 0 erros mecânicos na Spec canônica do Gateway `4d019f00` (`ANALISTA_PLAN_APPROVED` na 3ª rodada); `docs/relatorios/REPLAY-GATEWAY-A1.json` e relatórios de bench. |

---

## 2. Testes Novos Criados

| Arquivo de Teste | Teste / Cenário | O que Prova |
|---|---|---|
| `tests/harness/orchestration-policy-and-skills.test.ts` | `A1.0: sem config/politicas-orquestracao.yaml...` | Prova que diretórios sem arquivo de política utilizam `DEFAULT_ORCHESTRATION_POLICY` do código e nunca buscam caminhos legados em `docs/rascunhos/`. |
| `tests/orchestrator/a1-contrato.test.ts` | (a) contrato válido | Prova que um contrato sintática e semanticamente íntegro retorna 0 erros no `validateContract`. |
| `tests/orchestrator/a1-contrato.test.ts` | (b) erros individuais de validação mecânica | Prova que o `validateContract` detecta cada classe de erro: dono inexistente, arquivo de função fora do dono, consumidor em `usadoPor` sem dependência declarada em `dependeDe`, nomes repetidos, tipos desconhecidos e rota fora de `route.ts`. |
| `tests/orchestrator/a1-contrato.test.ts` | (c) renderContractTs compila em memória | Prova que `renderContractTs` gera arquivo TypeScript autossuficiente e válido (`ts.createProgram` sem erros). |
| `tests/orchestrator/a1-contrato.test.ts` | (d) controle do Gateway: tsc reprova o defeito real e passa quando corrigido | Prova a tese central do DG1: em um mini-projeto em `os.tmpdir()`, o código defeituoso real do Gateway (`sessao.papel === "admin"` e `criarSessao(usuario.id)`) é reprovado pelo compilador TypeScript estrito contra o contrato gerado; quando corrigido (`"ADMIN"` e 2 parâmetros), compila limpo. |
| `tests/orchestrator/analista-plan.test.ts` | Plano com contrato válido aprovado | Prova que o analista emite o contrato, a T8b valida, `ANALISTA_PLAN_APPROVED` registra contagens e os Microbriefs recebem as fatias em `interfacesProduz` e `interfacesConsome`. |
| `tests/orchestrator/analista-plan.test.ts` | Contrato com erro retorna na 2ª rodada | Prova que erros de contrato retornam na rodada seguinte ao analista para autocorreção. |
| `tests/orchestrator/analista-plan.test.ts` | 3 rodadas inválidas culminam em `PLANO_REPROVADO` | Prova que planos sem contrato válido não avançam para execução em produção, disparando `PLANO_REPROVADO` com dono `analista`. |
| `tests/orchestrator/analista-plan.test.ts` | `skipModel: true` emite `CONTRATO_AUSENTE` | Prova que rotinas de teste simulado continuam operando enquanto registram o evento `CONTRATO_AUSENTE` na telemetria. |
| `tests/orchestrator/a1-contrato-travado.test.ts` | 1. Tentativa de escrita em `src/contracts/**` negada | Prova que o runtime de skills do executor bloqueia qualquer gravação manual em `src/contracts/index.ts` ou arquivos de conformidade. |
| `tests/orchestrator/a1-contrato-travado.test.ts` | 2. Reprovação mecânica por divergência de assinatura | Prova que se uma etapa implementar função com assinatura divergente da acordada no contrato, o arquivo de conformidade `src/contracts/conformidade/<etapaId>.ts` falha no `tsc` durante o porteiro e a etapa é rejeitada com rollback. |
| `tests/orchestrator/a1-contrato-travado.test.ts` | 3. Promoção com conformidade promovida junto | Prova que etapa aderente ao contrato é aprovada e seu arquivo de conformidade é promovido ao projeto principal como guarda perene. |
| `tests/governance/e5-testes-de-aceite.test.ts` | Fatias de contrato no prompt do testador | Prova que o testador de aceite recebe as seções `interfacesProduz` e `interfacesConsome` do contrato para gerar cobranças estritas de interface. |
| `tests/governance/dual-lens-auditor.test.ts` | Divergência de contrato é crítica no avaliador cego | Prova que qualquer divergência de tipos, nomes ou assinaturas do contrato é classificada com severidade crítica e reprova a etapa. |

---

## 3. Nomes de Arquivos e Funções Conferidos (`git grep`)

- **`validateContract`**:
  - Declarada em: `src/core/orchestrator/project-contract.ts:168`
  - Utilizada em: `src/core/skills/spec-decomposer.ts:517`
- **`renderContractTs`**:
  - Declarada em: `src/core/orchestrator/project-contract.ts:370`
  - Utilizada em: `src/core/skills/spec-decomposer.ts:905`, `src/core/orchestrator/execution-trigger.ts:468`
- **`renderConformance`**:
  - Declarada em: `src/core/orchestrator/project-contract.ts:500`
  - Utilizada em: `src/core/orchestrator/node-executor.ts:1587`
- **`renderContractSliceTs`**:
  - Declarada em: `src/core/orchestrator/project-contract.ts:435`
  - Utilizada em: `src/core/skills/spec-decomposer.ts:850`
- **`parseAnalystPlan`**:
  - Declarada em: `src/core/skills/spec-decomposer.ts:285`
  - Utilizada em: `src/core/skills/spec-decomposer.ts:503`, `scripts/replay-contrato-a1.ts:94`
- **`CONTRATO_GRAVADO`**:
  - Registrado em: `src/core/orchestrator/execution-trigger.ts:518`
- **`CONTRATO_AUSENTE`**:
  - Registrado em: `src/core/skills/spec-decomposer.ts:410`
- **Caminho Protegido `src/contracts`**:
  - Travado em: `src/core/skills/skill-runtime.ts:312-314`

---

## 4. Custo Total da Prova (Passo A1.5)

| Item da Prova | Descrição | Custo Medido (US$) | Resultado |
|---|---|---|---|
| **Bench P1–P4** | `npx tsx scripts/bench.ts --projetos p1,p2,p3,p4 --variantes padrao --repeticoes 1` | US$ 0.8304 | **4/4 ENTREGUE**, 100% `tsc`, **47/47 aceite hermético** |
| **Replay Gateway** | `scripts/replay-contrato-a1.ts` na Spec canônica `4d019f00` | US$ 0.3537 | **Plano aprovado com 0 erros mecânicos** (`ANALISTA_PLAN_APPROVED` rodada 3) |
| **TOTAL A1.5** | Soma consolidada das provas | **US$ 1.1841** | **Abaixo do teto autorizado de US$ 2,00** |

### Tabela de Resultados do Benchmark P1–P4 (`2026-10-23-1921.md`)

| Projeto | Variante | Rep | Teto (US$) | Fase | Tempo (s) | Etapas | 1ª Tent. | Tent. Totais | tsc | UI Check | Aceite | Reprovados | Custo Total (US$) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **P1** | padrao | 1 | 3.00 | **ENTREGUE** | 186.9 | 4 | 4 | 0 | 0 (ok) | ausente | **10/10** | — | US$ 0.1836 |
| **P2** | padrao | 1 | 3.00 | **ENTREGUE** | 362.7 | 4 | 4 | 0 | 0 (ok) | UI_CHECK_PASSED | **13/13** | — | US$ 0.2842 |
| **P3** | padrao | 1 | 3.00 | **ENTREGUE** | 239.3 | 3 | 3 | 0 | 0 (ok) | ausente | **12/12** | — | US$ 0.2127 |
| **P4** | padrao | 1 | 3.00 | **ENTREGUE** | 199.9 | 2 | 2 | 0 | 0 (ok) | ausente | **12/12** | — | US$ 0.1500 |

### Amostra de Telemetria e Contrato Gerado no Bench (Projeto P2)

**Evento `CONTRATO_GRAVADO` na trilha:**
```json
{
  "projectRoot": "C:\\Users\\ortiz\\AppData\\Local\\Temp\\nc-bench-p2-padrao-1\\project-p2",
  "arquivo": "src/contracts/index.ts",
  "hash": "d36d56ede9191838c14d596fc7336ce5b39f00387e2d73f73f8cfacb743f495b",
  "entidades": 1,
  "enums": 0,
  "funcoes": 4,
  "rotas": 4
}
```

**Arquivo `src/contracts/index.ts` gerado no P2:**
```ts
/* eslint-disable */
// Contrato Canônico do Projeto (gerado mecanicamente pelo harness do NextCode)
// TRAVADO PARA O EXECUTOR: não edite manualmente este arquivo.

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

// === Entidades ===
export interface Tarefa {
  id: string;
  titulo: string;
  concluida: boolean;
  criadaEm: string;
}

// === Assinaturas de Funções ===
export type FnListarTarefas = () => Tarefa[];
export type FnCriarTarefa = (titulo: string) => Tarefa;
export type FnAtualizarTarefa = (id: string, dados: { titulo?: string; concluida?: boolean }) => Tarefa | null;
export type FnRemoverTarefa = (id: string) => boolean;

// === Rotas e I/O ===
export type Route_get_api_tarefas_Entrada = void;
export type Route_get_api_tarefas_Saida = Tarefa[];
export type Route_post_api_tarefas_Entrada = { titulo: string };
export type Route_post_api_tarefas_Saida = Tarefa;
export type Route_patch_api_tarefas_id__Entrada = { titulo?: string; concluida?: boolean };
export type Route_patch_api_tarefas_id__Saida = Tarefa;
export type Route_delete_api_tarefas_id__Entrada = void;
export type Route_delete_api_tarefas_id__Saida = void;
```

---

## 5. Replay do Analista na Spec Real do Gateway (`4d019f00`)

- **Porta:** Plano aprovado com `validateContract` retornando **0 erros** (`ANALISTA_PLAN_APPROVED` na 3ª rodada).
- **Contagem de elementos extraídos:**
  - **Entidades:** 11 (`Lojista`, `Usuario`, `WhitelabelConfig`, `ApiKey`, `ConfigTaxa`, `Produto`, `LinkPagamento`, `Cliente`, `Cobranca`, `WebhookEvento`, `Notificacao`)
  - **Enums:** 9 (`StatusOnboarding`, `PapelUsuario`, `MetodoPagamento`, `TipoProduto`, `OrigemCobranca`, `StatusCobranca`, `DestinatarioNotificacao`, `CanalNotificacao`, `StatusNotificacao`)
  - **Funções:** 37
  - **Rotas:** 41
- **Conferência de Símbolos Críticos do DG1:**
  - `PapelUsuario`: Formalizado como enum canônico `export type PapelUsuario = "DONO" | "ADMIN" | "OPERADOR";` (Dono: `mb-1`).
  - `criarSessao`: Formalizado como assinatura exportada `export type FnCriarSessao = (usuario: Usuario) => Promise<void>;` (Dono: `mb-4`, Consome: `mb-5`).
  - `obterMarca`: Formalizado como assinatura exportada `export type FnObterMarca = (lojistaId: string) => Promise<WhitelabelConfig>;` (Dono: `mb-18`, Consome: `mb-19`, `mb-20`, `mb-22`, `mb-27`).
  - `exigirAdminPlataforma`: Formalizado como `() => Promise<Usuario>` (Dono: `mb-37`, Consome: `mb-38`).

---

## 6. Desvios Encontrados

1. **Cooldown Temporário de Modelo:** Durante as primeiras tentativas, o modelo `custom/deepseek-flash` no FreeLLMAPI estava temporariamente em rate-limit (~20m). O sistema pausou com segurança (`SESSION_PAUSED_NO_LLM`). Após expirar o cooldown, o benchmark executou de forma 100% autônoma, atingindo 4/4 ENTREGUE.
2. **Normalização de Expressões de Tipo em Rotas:** Modelos LLM podem omitir chaves externas ao descrever parâmetros de rota (ex: `busca?: string`). Adicionou-se uma normalização defensiva em `extractReferencedTypeNames` para envolver propriedades soltas em `{ ... }`, evitando falsos positivos de tipos desconhecidos sem relaxar as regras do TypeScript.
3. **MIME Types e Tipo Json:** Adicionou-se `Json`, `Blob`, `FormData` e utilitários web à lista de tipos conhecidos, e gerou-se o tipo canônico `export type Json` em `renderContractTs`.

---

## 7. Checklist das Travas Afetadas (T1 a T10)

| Trava | Nome | Afetada no A1? | Como Foi Fortalecida |
|---|---|---|---|
| **T1** | Aprovação Humana da Spec | Não | Mantida íntegra. |
| **T2** | Escopo de Arquivos por Etapa | **Sim** | `src/contracts/**` agora é escopo protegido do executor. O arquivo de conformidade `src/contracts/conformidade/<etapaId>.ts` é injetado no escopo efetivo da etapa dona. |
| **T3** | Trilha TelemetryLog | **Sim** | Adicionados os eventos `CONTRATO_GRAVADO` e `CONTRATO_AUSENTE`. `ANALISTA_PLAN_APPROVED` agora grava contagens de entidades, enums, funções e rotas. |
| **T4** | Quarentena e Porteiro | **Sim** | O porteiro empírico (`checkOnly: true`) agora valida obrigatoriamente a conformidade de assinatura do contrato via `tsc` antes de qualquer promoção ou avaliação. |
| **T5** | Duas Lentes e Avaliador | **Sim** | O avaliador cego agora recebe a fatia do contrato (`interfacesProduz`/`interfacesConsome`) e tem regra inegociável de que qualquer desvio do contrato é falha crítica. |
| **T6** | 3 Tentativas e Bloqueio | Não | Mantida íntegra. |
| **T7** | Pesquisa em Fonte Oficial | Não | Mantida íntegra. |
| **T8a/T8b** | Validação Spec x Plano | **Sim** | A Trava T8b agora inclui a validação mecânica estrita do contrato (`validateContract`) em até 3 rodadas; se reprovada, aciona `PLANO_REPROVADO` com dono `analista`. |
| **T9** | Papel da Fase | Não | Mantida íntegra. |
| **T10** | Entrega e Revisão Final | **Sim** | `src/contracts/index.ts` e arquivos de conformidade agora fazem parte da integridade permanente do projeto final entregue. |

---

## 8. O que Não Foi Feito

1. **A1.7 a A1.9:** Propostas sugeridas pelo Claude em diário 224 (gravação de `.nextcode/macrobrief.md`, comparação DeepSeek x Opus, conferência cruzada Jev REQ x Contrato) aguardam aprovação explícita do fundador e ficam para fases futuras.
2. **Alteração da base de dados:** `prisma/dev.db` permaneceu estritamente intocado durante todo o processo (replays e bench executados em cópias temporárias isoladas).
