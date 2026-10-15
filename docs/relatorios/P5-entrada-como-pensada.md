# Relatório P5 — Entrada como pensada: Jev na Spec sem segredo, sem chute e com conferência

## 0. Leitura feita
1. O passo P5.1 implementa a máscara de segredos em um ponto único (`postJev`) antes de enviar o payload ao Jev, gerando telemetria `JEV_STATE_MASKED` quando detecta candidatos a segredo.
2. O passo P5.2 faz a peneira de intake M0 consumir todo o histórico de mensagens do usuário com timeout de 10s, convertendo itens de média certeza em alertas `[A CONFIRMAR]` para a seção 7 da Spec.
3. O passo P5.3 expande o corte de texto da Spec em M2 para 22.000 caracteres e expõe a avaliação de clareza como aviso orientativo ao usuário no chat, preservando a aprovação humana.
4. O passo P5.4 conecta a conferência Macrobrief × Spec do `IntakeEngine` antes da transição `SPEC_APROVADA`, regulada pela política `conferencia_entrada`.
5. A suíte completa foi validada com 772 testes passando e 0 erros de tipagem no `tsc`, mantendo total conformidade com as Regras de Governança.

---

## 1. Identificação
- **Commit de partida:** `fb513ab`
- **HEAD atual:** `5b2f7aa`
- **Log dos commits do pacote:**
```
5b2f7aa feat(orquestracao): P5.4 - conferencia Macrobrief x Spec na aprovacao
822a38b docs: P5.4 conferencia entra em sombra (diario 41, decisoes, referencia)
7505dd3 feat(intake): P5.3 - clareza da Spec (M2) vira aviso ao usuario
6e6e267 feat(intake): P5.2 - peneira M0 le a conversa inteira e incerteza vira pergunta
76da16f feat(seguranca): P5.1 - mascara segredos antes de qualquer envio ao Jev
```

---

## 2. Por commit: `git show --stat`, `tsc`, `vitest`

### Commit P5.1: `76da16f`
```
commit 76da16ff40e2dd4a72eb1e7c14309bbf9d2d16d5
Author: ortizpedroso <ortizpedroso@hotmail.com>
Date:   Wed Oct 14 21:38:34 2026 -0400

    feat(seguranca): P5.1 - mascara segredos antes de qualquer envio ao Jev
    
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 src/core/decision/jev.ts                   |  25 +++++-
 src/core/governance/secret-guard.ts        |  23 +++++
 tests/decision/jev-mascara-segredo.test.ts | 131 +++++++++++++++++++++++++++++
 3 files changed, 178 insertions(+), 1 deletion(-)
```
- **`npx tsc --noEmit`**: 0 erros.
- **`npx vitest run`**:
```
 Test Files  117 passed (117)
      Tests  763 passed (763)
   Duration  194.21s
```

### Commit P5.2: `6e6e267`
```
commit 6e6e267ed6bc9ebb9c3317efaa32115ba7909be9
Author: ortizpedroso <ortizpedroso@hotmail.com>
Date:   Wed Oct 14 21:47:18 2026 -0400

    feat(intake): P5.2 - peneira M0 le a conversa inteira e incerteza vira pergunta
    
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 src/app/api/chat/route.ts                      |  16 +-
 src/core/decision/jev.ts                       |   9 +-
 src/core/intake/universal-funnel.ts            | 106 ++++++++++-
 tests/intake/universal-funnel-conversa.test.ts | 241 +++++++++++++++++++++++++
 4 files changed, 359 insertions(+), 13 deletions(-)
```
- **`npx tsc --noEmit`**: 0 erros.
- **`npx vitest run`**:
```
 Test Files  118 passed (118)
      Tests  769 passed (769)
   Duration  201.85s
```

### Commit P5.3: `7505dd3`
```
commit 7505dd3dbee814d694d5e5c3894af3671d6c09dd
Author: ortizpedroso <ortizpedroso@hotmail.com>
Date:   Wed Oct 14 21:52:57 2026 -0400

    feat(intake): P5.3 - clareza da Spec (M2) vira aviso ao usuario
    
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 src/app/api/chat/route.ts          | 6 +++++-
 src/core/decision/jev-decisions.ts | 2 +-
 2 files changed, 6 insertions(+), 2 deletions(-)
```
- **`npx tsc --noEmit`**: 0 erros.
- **`npx vitest run`**:
```
 Test Files  118 passed (118)
      Tests  769 passed (769)
   Duration  204.12s
```

### Commit P5.4: `5b2f7aa`
```
commit 5b2f7aaa5c3c5ef0d7b9929a406bed1d5e8e2de1
Author: ortizpedroso <ortizpedroso@hotmail.com>
Date:   Wed Oct 14 22:46:17 2026 -0400

    feat(orquestracao): P5.4 - conferencia Macrobrief x Spec na aprovacao
    
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 config/politicas-orquestracao.yaml                 |   1 +
 src/app/api/chat/route.ts                          |   4 +
 src/core/config/orchestration-policy.ts            |  11 ++
 src/core/orchestrator/execution-trigger.ts         |  39 ++++++
 .../orchestration-policy-and-skills.test.ts        |   3 +
 .../orchestrator/conferencia-na-aprovacao.test.ts  | 145 +++++++++++++++++++++
 6 files changed, 203 insertions(+)
 create mode 100644 tests/orchestrator/conferencia-na-aprovacao.test.ts
```
- **`npx tsc --noEmit`**: 0 erros.
- **`npx vitest run`**:
```
 Test Files  119 passed (119)
      Tests  772 passed (772)
   Duration  212.00s
```

---

## 3. O que mudou, com arquivo:linha, passo a passo

### Passo P5.1
- `src/core/governance/secret-guard.ts:354`: Adicionada a função exportada `maskSecretsForJev(text: string): { text: string; count: number }`, que descobre candidatos a segredo com `findSecretCandidatesInText("jev_state", text)` e substitui cada ocorrência pelo formato descrito por `describeSecretShape(valorSegredo)`.
- `src/core/decision/jev.ts:17, 95-108`: No método `postJev`, antes do loop de tentativas e antes de `safeFetch`, se o body contiver `state: string`, o payload é clonado com `state` mascarado por `maskSecretsForJev`. Se `count > 0`, registra telemetria `JEV_STATE_MASKED` com `purpose` e `count` (sem os valores).
- `tests/decision/jev-mascara-segredo.test.ts:1-131`: Criado teste cobrindo: (a) detecção e substituição com `«valor oculto:`; (b) payload limpo inalterado; (c) telemetria `JEV_STATE_MASKED` registrada com `count: 1` e sem expor credenciais.

### Passo P5.2
- `src/core/decision/jev.ts:85, 275`: `postJev` e `askJevBatch` ganharam parâmetro opcional `timeoutMs?: number`, usado prioritariamente frente a `jevTimeoutMs()`.
- `src/core/intake/universal-funnel.ts:17`: `IntakeFunnelResult` recebeu o campo `aConfirmar: string[]`.
- `src/core/intake/universal-funnel.ts:127`: Limite de caracteres do prompt expandido para 16.000 (`prompt.slice(0, 16000)`).
- `src/core/intake/universal-funnel.ts:133`: Chamada a `askJevBatch` passando `timeoutMs: 10000`.
- `src/core/intake/universal-funnel.ts:146-175`: População de `aConfirmar` com perguntas `noul` entre 0.25 e 0.75 ou perguntas `choice` com confiança < 0.6.
- `src/core/intake/universal-funnel.ts:200-213`: Em fallback, `aConfirmar` é preenchido com as 7 perguntas booleanas do intake.
- `src/core/intake/universal-funnel.ts:225-275`: `formatIntakeFunnelBrief` atualizado para prefixar aviso de itens a confirmar e formatar cada linha com `[A CONFIRMAR] (o Jev não tem certeza — perguntar ao usuário)`.
- `src/app/api/chat/route.ts:578-592`: Na chamada de funnel M0, busca mensagens do usuário com role "user", concatena com `\n---\n` e injeta no prompt do funil.
- `tests/intake/universal-funnel-conversa.test.ts:1-241`: Teste novo cobrindo os 6 cenários exigidos (noul incerto, noul certo, choice com baixa confiança, fallback com 7 itens, múltiplas mensagens do usuário no body e timeout de 10s no AbortSignal).

### Passo P5.3
- `src/core/decision/jev-decisions.ts:179`: Em `decideSpecClarity`, expandido `params.rascunhoSpec.slice(0, 12000)` para `slice(0, 22000)`.
- `src/app/api/chat/route.ts:800-815`: Captura o retorno de `decideSpecClarity`. Se `clareza.source === "jev"` e `!clareza.readyForUserApproval`, concatena ao final de `guardRes.finalMessageContent` o aviso informativo ao usuário com pontuação e probabilidades, sem alterar a `canonicalSpec` salva no banco.

### Passo P5.4
- `config/politicas-orquestracao.yaml:165`: Adicionada chave `conferencia_entrada: sombra` na seção `jev_execucao`.
- `src/core/config/orchestration-policy.ts:113, 299, 540-549`: Definição de `conferenciaEntrada: "ativo" | "sombra" | "desligado"`, padrão `"desligado"` no fallback e parser do YAML.
- `src/core/orchestrator/execution-trigger.ts:33, 228-261`: `ApproveSpecResult` ganhou `problems?: string[]`. Antes do passo 3 de aprovação, invoca `IntakeEngine.runElicitadorAndAnalistaCycle`, registrando telemetria `CONFERENCIA_ENTRADA`. Em modo `ativo`, se reprovado, recusa com `CONFERENCIA_REPROVADA`. Em modo `sombra` ou em caso de erro, segue o fluxo normal.
- `src/app/api/chat/route.ts:341-345`: Trata a recusa por `CONFERENCIA_REPROVADA`, formatando a lista de problemas encontrados na Spec para o usuário.
- `tests/harness/orchestration-policy-and-skills.test.ts:52, 77, 118`: Atualizadas as asserções de política no teste 10.1 com a autorização expressa do auditor.
- `tests/orchestrator/conferencia-na-aprovacao.test.ts:1-145`: Criado teste cobrindo modo `ativo` (recusa mecânica), modo `sombra` (continuação e log com `ok: false`) e modo `desligado` (espião confirma que o ciclo não é chamado).

---

## 4. Saídas do `git grep -n` dos nomes usados

```
$ git grep -n "maskSecretsForJev"
src/core/decision/jev.ts:17:import { maskSecretsForJev } from "@/core/governance/secret-guard";
src/core/decision/jev.ts:98:    const masked = maskSecretsForJev(rawState);
src/core/governance/secret-guard.ts:354:export function maskSecretsForJev(text: string): { text: string; count: number } {

$ git grep -n "JEV_STATE_MASKED"
src/core/decision/jev.ts:106:        action: "JEV_STATE_MASKED",
tests/decision/jev-mascara-segredo.test.ts:96:  it("(c) JEV_STATE_MASKED registrado com count: 1 e sem o valor em details", async () => {
tests/decision/jev-mascara-segredo.test.ts:121:    const maskCall = logSpy.mock.calls.find((c) => c[0]?.action === "JEV_STATE_MASKED");

$ git grep -n "aConfirmar"
src/core/intake/universal-funnel.ts:17:  aConfirmar: string[];
src/core/intake/universal-funnel.ts:146:    const aConfirmar: string[] = [];
src/core/intake/universal-funnel.ts:152:          aConfirmar.push(qId);
src/core/intake/universal-funnel.ts:156:          aConfirmar.push(qId);
src/core/intake/universal-funnel.ts:175:      aConfirmar,
src/core/intake/universal-funnel.ts:211:    aConfirmar: fallbackAConfirmar,
src/core/intake/universal-funnel.ts:228:  const aConf = new Set(funnel.aConfirmar ?? []);
tests/intake/universal-funnel-conversa.test.ts:34:  it("(a) Jev responde has_database com noul: 0.58 → aConfirmar contém has_database e brief mostra Banco de Dados: [A CONFIRMAR]", async () => {
tests/intake/universal-funnel-conversa.test.ts:64:    expect(res.aConfirmar).toContain("has_database");
tests/intake/universal-funnel-conversa.test.ts:70:  it("(b) noul: 0.95 → fora de aConfirmar, linha igual à de hoje", async () => {
tests/intake/universal-funnel-conversa.test.ts:100:    expect(res.aConfirmar).not.toContain("has_database");
tests/intake/universal-funnel-conversa.test.ts:105:  it("(c) notification_channels com confidence: 0.4 → em aConfirmar", async () => {
tests/intake/universal-funnel-conversa.test.ts:135:    expect(res.aConfirmar).toContain("notification_channels");
tests/intake/universal-funnel-conversa.test.ts:140:  it("(d) Jev indisponível → source: 'fallback', 7 itens em aConfirmar e a linha de estimativa", async () => {
tests/intake/universal-funnel-conversa.test.ts:149:    expect(res.aConfirmar).toEqual([

$ git grep -n "CONFERENCIA_ENTRADA"
src/core/orchestrator/execution-trigger.ts:237:        action: "CONFERENCIA_ENTRADA",
src/core/orchestrator/execution-trigger.ts:256:        action: "CONFERENCIA_ENTRADA",
tests/orchestrator/conferencia-na-aprovacao.test.ts:87:  it("(b) modo sombra: mesma Spec → segue o fluxo normal e registra CONFERENCIA_ENTRADA com ok: false", async () => {
tests/orchestrator/conferencia-na-aprovacao.test.ts:110:      where: { sessionId: session.id, action: "CONFERENCIA_ENTRADA" },
tests/orchestrator/conferencia-na-aprovacao.test.ts:141:      where: { sessionId: session.id, action: "CONFERENCIA_ENTRADA" },

$ git grep -n "CONFERENCIA_REPROVADA"
src/app/api/chat/route.ts:341:        } else if (approvalTriggerResult.reason === "CONFERENCIA_REPROVADA") {
src/core/orchestrator/execution-trigger.ts:248:          reason: "CONFERENCIA_REPROVADA",
tests/orchestrator/conferencia-na-aprovacao.test.ts:55:  it("(a) modo ativo: Spec com falha mecânica → ok: false, reason: CONFERENCIA_REPROVADA, problems não vazio, fase continua SPEC_REVISAO, nenhum TaskNode criado", async () => {
tests/orchestrator/conferencia-na-aprovacao.test.ts:72:    expect(res.reason).toBe("CONFERENCIA_REPROVADA");

$ git grep -n "conferenciaEntrada"
src/core/config/orchestration-policy.ts:113:    conferenciaEntrada: "ativo" | "sombra" | "desligado";
src/core/config/orchestration-policy.ts:299:    conferenciaEntrada: "desligado",
src/core/config/orchestration-policy.ts:546:    policy.jevExecucao.conferenciaEntrada
src/core/config/orchestration-policy.ts:549:    policy.jevExecucao.conferenciaEntrada = confEntrRaw;
src/core/orchestrator/execution-trigger.ts:228:  const policyConf = loadOrchestrationPolicy().jevExecucao.conferenciaEntrada;
tests/harness/orchestration-policy-and-skills.test.ts:52:      conferenciaEntrada: "sombra",
tests/harness/orchestration-policy-and-skills.test.ts:77:        conferenciaEntrada: "desligado",
tests/harness/orchestration-policy-and-skills.test.ts:118:        conferenciaEntrada: "desligado",
tests/orchestrator/conferencia-na-aprovacao.test.ts:60:        conferenciaEntrada: "ativo",
tests/orchestrator/conferencia-na-aprovacao.test.ts:92:        conferenciaEntrada: "sombra",
tests/orchestrator/conferencia-na-aprovacao.test.ts:124:        conferenciaEntrada: "desligado",

$ git grep -n "conferencia_entrada"
config/politicas-orquestracao.yaml:165:  conferencia_entrada: sombra         # ativo | sombra | desligado (P5, 14/10: sombra até medir com Specs reais — Specs no formato antigo seriam recusadas)
src/core/config/orchestration-policy.ts:545:    "conferencia_entrada",
```

---

## 5. Escopo: `git diff --stat fb513ab..HEAD` real

```
 config/politicas-orquestracao.yaml                 |   1 +
 docs/NEXTCODE-REFERENCIA.md                        |   2 +-
 memory/decisoes.md                                 |   1 +
 memory/diario.md                                   |   9 +
 src/app/api/chat/route.ts                          |  26 ++-
 src/core/config/orchestration-policy.ts            |  11 +
 src/core/decision/jev-decisions.ts                 |   2 +-
 src/core/decision/jev.ts                           |  34 ++-
 src/core/governance/secret-guard.ts                |  23 ++
 src/core/intake/universal-funnel.ts                | 106 ++++++++-
 src/core/orchestrator/execution-trigger.ts         |  39 ++++
 tests/decision/jev-mascara-segredo.test.ts         | 131 +++++++++++
 .../orchestration-policy-and-skills.test.ts        |   3 +
 tests/intake/universal-funnel-conversa.test.ts     | 241 +++++++++++++++++++++
 .../orchestrator/conferencia-na-aprovacao.test.ts  | 145 +++++++++++++
 15 files changed, 757 insertions(+), 17 deletions(-)
```
*(Nota: as alterações em `memory/` e `docs/NEXTCODE-REFERENCIA.md` foram efetuadas pelo auditor no commit intermediário `822a38b`).*

---

## 6. Desvios (obrigatório)

1. **Parada no Passo P5.4 (Item 6):** Conforme previsto nas instruções de P5.4 item 6, ao configurar `conferencia_entrada: ativo` no YAML, a execução da suíte completa de testes acusou a quebra de 9 arquivos de testes (32 testes no total), devido a:
   - 8 arquivos de testes que aprovavam Specs em formato legado (sem frontmatter YAML ou sem requisitos estruturados) passaram a ser recusados por `CONFERENCIA_REPROVADA` com a mensagem `"Frontmatter YAML da Spec inválido ou ausente."`.
   - 1 arquivo (`tests/harness/orchestration-policy-and-skills.test.ts:47`) que realizava asserção estrita `toEqual` sobre `policy.jevExecucao`.
   - Conforme a Regra Zero e o item 6 de P5.4, a execução foi interrompida imediatamente sem tentar forçar a passagem dos testes.
2. **Autorização nº 1 do Auditor:** O auditor registrou no diário 41 e autorizou configurar `conferencia_entrada: sombra` em `config/politicas-orquestracao.yaml` (mantendo a gravação da telemetria `CONFERENCIA_ENTRADA` sem quebrar a aprovação em produção) e atualizar o `toEqual` da linha ~47 em `tests/harness/orchestration-policy-and-skills.test.ts`.
3. **Parada nº 2 e Autorização nº 2:** Ao rodar `tests/harness/orchestration-policy-and-skills.test.ts`, o mesmo teste 10.1 falhou nas asserções subsequentes das linhas ~72 e ~112 (`fallbackPolicy` e `customPolicy`), que validam a ausência da chave e esperavam o padrão `"desligado"`. Uma nova parada foi efetuada e o auditor autorizou a inclusão cirúrgica de `conferenciaEntrada: "desligado"` nas linhas 77 e 118 do mesmo arquivo de teste.

---

## 7. Checklist T-A a T-O

- [x] **T-A:** Ponto de partida conferido com HEAD (`fb513ab`).
- [x] **T-B:** Somente os arquivos listados foram alterados/criados (com a ampliação de escopo autorizada para as 3 linhas do teste 10.1 em `tests/harness/orchestration-policy-and-skills.test.ts`).
- [x] **T-C:** Literalidade seguida à risca; sem refatorações não solicitadas.
- [x] **T-D:** Nomes conferidos com `git grep -n` e saídas coladas na Seção 4.
- [x] **T-E:** 1 commit por passo (`76da16f`, `6e6e267`, `7505dd3`, `5b2f7aa`) e 1 commit R de relatório; todos com `tsc --noEmit` zerado e `vitest` completo verde; sem `rebase`, `reset` ou flags proibidas.
- [x] **T-F:** Nenhum dado gravado em `prisma/dev.db`.
- [x] **T-G:** Nenhum segredo inserido em código, teste ou relatório (valores dinâmicos/falsos utilizados).
- [x] **T-H:** Nenhuma dependência externa adicionada no `package.json`.
- [x] **T-I:** Fim de linha preservado; LF nos novos arquivos.
- [x] **T-J:** Sem chamadas reais a LLMs ou rede externa nos testes (mocks locais utilizados).
- [x] **T-K:** Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` presente em todos os commits.
- [x] **T-L:** Relatório fiel com saídas brutas reais coladas.
- [x] **T-O:** Nenhum plano ou log paralelo criado.

---

## 8. Sugestões de melhoria (nada implementado)

1. **Migração gradual de fixtures de teste de Spec:** Muitos testes em `tests/orchestrator/` usam strings de Spec simplificadas sem frontmatter YAML (`# Spec Canônica...`). Criar um utilitário de fixture que gere specs canônicas com frontmatter YAML completo de forma transparente facilitará a ativação de `conferencia_entrada: ativo` no futuro.
2. **Exibição visual estruturada de problemas na UI:** Na rota de chat, `approvalTriggerResult.problems` hoje é retornado em formato de lista textual (`- ...`). Poderia ser mapeado em um card de UI específico quando a Spec é recusada pelo analisador.

---

## 9. Dúvidas para o fundador

- Nenhuma dúvida em aberto no momento. O pacote P5 foi totalmente concluído dentro dos critérios e das autorizações emitidas pelo auditor.
