# Prompt D1 — Documento único: registro de evolução na referência e limpeza de `docs/`

> Decisão do fundador de 13/10 (`memory/decisoes.md`). Diagnóstico: `docs/relatorios/diagnostico-docs-2026-10-13.md`.
> Ordem: **só roda depois do C1 auditado e aceito.** Só documentação; nenhum código muda.
> Copie do marcador **INÍCIO DO PROMPT** até **FIM DO PROMPT**.

===== INÍCIO DO PROMPT =====

# Tarefa D1 — criar o registro de evolução (§9) na referência e apagar os documentos que ele substitui

## REGRA ZERO — LEIA ANTES DE QUALQUER COMANDO
1. **Leia este prompt inteiro e todos os arquivos de LEITURA OBRIGATÓRIA antes de alterar qualquer coisa.** Na seção 0 do relatório, escreva em 5 linhas, com suas palavras, o que cada passo vai mudar. Sem essa seção o pacote é rejeitado.
2. **Faça exatamente o que está escrito, nada além.** Proibido melhorar, reescrever, reorganizar, renomear ou "atualizar" qualquer seção da referência que não seja as indicadas; proibido mexer em código, testes, skills, config, `memory/`, `CLAUDE.md`.
3. **Não mexa no que está funcionando.** Nenhum arquivo fora da lista de PODE ALTERAR/APAGAR. Comentário de código citando documento apagado **fica como está** (anote em Sugestões).
4. **Achou algo errado ou que parece faltar? Não conserte.** Anote em "Sugestões de melhoria". Quem decide é o fundador.
5. **Precisou mexer em algo não descrito** → **PARE** e escreva o relatório parcial explicando o quê e por quê. Dúvida → **PARE e pergunte.**
6. **Você não inventa história.** Todo tópico da §9 vem de um documento lido ou de `git log`, com o hash do commit. Sem fonte, não escreva. Afirmação que o documento de origem faz sem prova (sem relatório de bench ou saída citada) entra marcada `⚠️ sem prova`.

## OBJETIVO
Deixar `docs/NEXTCODE-REFERENCIA.md` como documento único: plano e estado (como já é) + nova §9 "Registro de evolução" em tópicos com tudo o que foi feito; depois apagar os 8 documentos e a pasta listados, que passam a estar resumidos na §9 e recuperáveis pelo git.

## TRAVAS
- **T-A Pré-condição.** `git status --short` só mostra arquivos em `.claude/`. A entrada do topo de `memory/diario.md` registra a auditoria do **C1** com veredito **aceito** (ou "aceito com ressalvas"). Sem isso → PARE.
- **T-B Escopo fechado.** PODE ALTERAR: `docs/NEXTCODE-REFERENCIA.md` (só acrescentar a §9 no fim e trocar a tabela da §7, como descrito) e `docs/relatorios/D1-documento-unico.md` (NOVO). PODE APAGAR: só a lista do passo D1.2. Qualquer outro arquivo → PARE.
- **T-C Literalidade.** Títulos e formatos exatamente como escritos. Ambiguidade → PARE e pergunte.
- **T-D Nomes reais.** Todo hash citado conferido com `git log --oneline` (deve existir); todo arquivo citado conferido com `git ls-files`.
- **T-E Um passo = um commit**, com `npx tsc --noEmit` (0) e `npx vitest run` completo verde nesse estado; saídas coladas. Proibido `--amend`, `rebase`, `reset`, `revert`, `restore`, `stash`, `push --force`, `--no-verify`. Apagar só com `git rm`.
- **T-G Segredos.** Nenhuma chave copiada para a §9 (se um documento antigo tiver algo parecido com chave, não copie e relate).
- **T-I Fim de linha.** Preservar o fim de linha da referência (`git ls-files --eol docs/NEXTCODE-REFERENCIA.md`).
- **T-K Commits** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-L Relatório fiel.** Números e status copiados da fonte, nunca resumidos como "sucesso"/"100%"/"homologado" sem o arquivo que prova.
- **T-N Histórico conferido.** Comando git fora de `status`, `diff`, `add`, `commit`, `show`, `log`, `ls-files`, `rev-parse`, `grep`, `rm` → declarar em Desvios.
- **T-O Sem documento paralelo.** Não crie nenhum outro documento (plano, log, índice, README).

## LEITURA OBRIGATÓRIA
- `docs/NEXTCODE-REFERENCIA.md` inteira (principalmente §0, §3, §5, §7, §8).
- `docs/relatorios/diagnostico-docs-2026-10-13.md` e `docs/relatorios/auditoria-completa-2026-10-12.md`.
- Os 10 arquivos a apagar (lista em D1.2), inteiros.
- `memory/diario.md` inteiro e `memory/decisoes.md`.
- `git log --reverse --format='%h %ad %s' --date=short` completo.

---

## PASSO D1.1 — Criar a §9 "Registro de evolução"

**PODE ALTERAR:** `docs/NEXTCODE-REFERENCIA.md` (só acrescentar ao fim).

Acrescentar ao fim do arquivo, depois da §8, exatamente esta estrutura:

```
---

## 9. Registro de evolução (o que já foi feito)

> Resumo em tópicos de tudo o que foi entregue, do mais antigo ao mais novo. Fonte: commits, diário e os documentos antigos
> listados em §9.0 (apagados em D1; recuperáveis com `git show <hash>:<caminho>`). `⚠️ sem prova` = o documento de origem
> afirmou sem relatório ou saída que comprove.

### 9.0 Documentos antigos consolidados aqui
| Documento apagado | Recuperar com | O que tinha | Tópicos em §9 |
|---|---|---|---|

### 9.1 <período> — <tema>
- **dd/mm** — <o que foi feito, 1 linha> · `<hash>` · prova: `<arquivo de relatório/bench>` ou `⚠️ sem prova`
```

Regras do conteúdo:
1. **§9.0:** uma linha por item apagado (os 10 de D1.2). "Recuperar com" = `git show <hash do commit anterior ao D1.2>:<caminho>` — use o hash do commit do D1.1. "Tópicos em §9" = números das subseções que resumem aquele documento.
2. **Subseções 9.1, 9.2…** por período, nesta ordem e com estes títulos (preencha só com o que existir nas fontes):
   - `9.1 Até 04/10 — fundação (arquitetura v4, etapa 0, hardening do OmniRoute)`
   - `9.2 05/10–08/10 — plano de ação itens 1–10, gateways, roteamento pago (R1)`
   - `9.3 08/10–09/10 — pacotes P0–P3, bench (régua do auditor), P2b, auditoria das skills S0/S1`
   - `9.4 10/10–12/10 — fases E1–E12, P4–P6, cascata (Antigravity sem prompt do auditor)`
   - `9.5 12/10–13/10 — auditoria completa, C1, D1`
3. Cada tópico: **uma linha**, data, o que foi feito, hash, prova. Juntar commits do mesmo assunto num tópico (vários hashes separados por vírgula). Máximo de **160 linhas** na §9 inteira.
4. Em 9.4, as afirmações já corrigidas pelo auditor entram com a correção ao lado, copiada do `JEV-LOG-DE-IMPLANTACAO.md` §4.24 (escrita no C1.3): §4.19 (economia de 57,2%), §4.20 (Gateway), §4.23 (P3 12/12).
5. Último tópico de 9.5: "13/10 — D1: documentos antigos consolidados em §9 e apagados" (sem hash; o auditor completa).
6. **Pendências que estavam só nos documentos apagados:** se um documento a apagar tiver item **não concluído** que não aparece em §5 nem em §6 da referência, **não** o acrescente lá: liste no relatório (seção 9), com o texto original e o arquivo de origem. O fundador decide.

**Pronto quando:** §9 existe com §9.0 completa (10 linhas) e 9.1–9.5; todo hash existe no `git log`; nenhuma outra linha da referência mudou (`git diff` só com linhas acrescentadas no fim — cole o `git diff --stat` e confirme 0 linhas removidas).
Commit: `docs(referencia): D1.1 - secao 9 registro de evolucao`.

---

## PASSO D1.2 — Apagar o que a §9 substitui e atualizar a §7

**PODE APAGAR (com `git rm`, só estes):**
`docs/PLANO-DE-ACAO.md`, `docs/PLANO-ETAPA-0.md`, `docs/PLAN-OMNIRHARDENING.md`, `docs/JEV-PLANO-DIRETOR.md`, `docs/PLANO-EVOLUCAO.md`, `docs/LLM-GATEWAYS.md`, `docs/SPEC-TEMPLATE-NEXTCODE-V5.md`, `docs/JEV-LOG-DE-IMPLANTACAO.md`, `docs/rascunhos/skills/avaliador/SKILL.md`, `docs/rascunhos/skills/avaliador-frontend/SKILL.md`.

**PROIBIDO APAGAR (estão em uso ou são prova):** `docs/ARQUITETURA-ORQUESTRACAO.md`, `docs/rascunhos/politicas-orquestracao.yaml` (lido pelo código — `orchestration-policy.ts:342`), `docs/rascunhos/JEV-DECISOES.md`, `docs/rascunhos/TEMPLATES.md`, `docs/rascunhos/TERCEIROS.md`, `docs/terceiros/`, `docs/specs/`, `docs/prompts/`, `docs/relatorios/` (inclusive `bench/`).

**PODE ALTERAR:** `docs/NEXTCODE-REFERENCIA.md` — só a tabela da §7 ("Documentos antigos (mantidos)") e a linha logo abaixo dela que começa com "Diagnóstico completo:".

1. `git rm` dos 10 arquivos acima. Cole a saída.
2. Na §7, a tabela passa a ter só os documentos **mantidos**, com estas linhas (texto exato na coluna Situação):
   | `ARQUITETURA-ORQUESTRACAO.md` | detalhe do desenho (fases, templates, travas); vale onde não contradiz este |
   | `rascunhos/JEV-DECISOES.md` | catálogo do Jev do projeto |
   | `rascunhos/TEMPLATES.md` | base de `src/core/templates/artifact-templates.ts` |
   | `rascunhos/TERCEIROS.md` | licenças e origem do material de terceiros |
   | `rascunhos/politicas-orquestracao.yaml` | **reserva lida pelo código** se `config/` faltar (`orchestration-policy.ts:342`); não mover |
   | `terceiros/jev-docs/` | documentação oficial do Jev (cópia local) |
   | `specs/gatway-system-spec.md` | Spec do Gateway (formato antigo, sem `REQ`) |
   | `prompts/`, `relatorios/` | prompts ao Antigravity e relatórios/auditorias — são a prova dos números |
   E a linha "Diagnóstico completo: …" é trocada por: `Documentos apagados em D1 (13/10): ver §9.0 (com o comando para recuperar cada um).`
3. Conferência (só relatar, **não corrigir**): `git grep -n` por cada nome apagado em todo o repositório; cole a saída e classifique cada ocorrência como `comentário`, `documento` ou `código que lê o arquivo`. Se aparecer **código ou teste que lê** um arquivo apagado → PARE antes do commit e relate.
4. `npx tsc --noEmit` e `npx vitest run` completos neste estado; colar.

**Pronto quando:** os 10 arquivos saíram; nada da lista proibida saiu (`git diff --stat <partida>..HEAD` colado); §7 atualizada; suíte verde.
Commit: `docs: D1.2 - apaga documentos consolidados na secao 9`.

---

## RELATÓRIO — `docs/relatorios/D1-documento-unico.md` (no último commit)
0. **Leitura feita:** 5 linhas (Regra Zero).
1. **Identificação:** hash de partida e `git log --oneline <partida>..HEAD`.
2. **Por commit:** `git show --stat`, `tsc`, resumo do `vitest`.
3. **Conferência da §9:** número de linhas da §9; lista de hashes citados com a saída de `git log --oneline` provando que existem; contagem de tópicos `⚠️ sem prova`.
4. **Apagados × mantidos:** `git diff --stat <partida>..HEAD` colado.
5. **Referências aos apagados:** saída do `git grep` com a classificação (D1.2 item 3).
6. **Desvios do prompt:** obrigatório; "nenhum" se nenhum.
7. **Checklist T-A…T-O:** sim/não com evidência.
8. **Sugestões de melhoria (opcional):** o que viu e **não** fez, com `arquivo:linha` e o risco de mexer.
9. **Pendências encontradas só nos documentos apagados** (D1.1 regra 6), com texto original e origem.
10. **Dúvidas abertas** para o fundador.

===== FIM DO PROMPT =====
