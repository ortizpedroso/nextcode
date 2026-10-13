# Prompt D1b — Correção do D1 (§7 fora do texto, provas quebradas, relatório incompleto)

> Auditoria do D1 em 13/10 (`memory/diario.md`, entrada 30). Só documentação. Copie do marcador INÍCIO até FIM.

===== INÍCIO DO PROMPT =====

# Tarefa D1b — corrigir o que o D1 fez diferente do prompt

## REGRA ZERO — LEIA ANTES DE QUALQUER COMANDO
1. Leia este prompt inteiro antes de alterar qualquer coisa. Na seção 0 do complemento do relatório, escreva em 3 linhas o que vai mudar.
2. **Faça exatamente o que está escrito, nada além.** Os textos abaixo são para copiar **caractere por caractere**. Não reescreva, não "melhore", não resuma, não acrescente descrições.
3. Não mexa no que está funcionando: nenhum arquivo além dos de PODE ALTERAR; nenhuma outra linha da referência.
4. Achou outro problema? Não conserte: anote em "Sugestões de melhoria".
5. Precisou mexer em algo não descrito, ou o texto a substituir não existe exatamente como descrito → **PARE** e relate. Dúvida → **PARE e pergunte.**

## POR QUE ESTE PACOTE EXISTE (achados da auditoria do D1)
- A tabela da §7 **não** foi escrita com o texto exigido e tem erros de fato: chama `rascunhos/politicas-orquestracao.yaml` de "rascunho a consolidar" (é a **reserva lida pelo código**, `orchestration-policy.ts:342` — esse rótulo convida a apagar um arquivo em uso), chama `TERCEIROS.md` de "catálogo de APIs" (são licenças), `TEMPLATES.md` de "templates de prompt" (é a base de `artifact-templates.ts`), cita OmniRoute/FreeLLMAPI em `docs/terceiros/` (só existe `jev-docs/`), omite `specs/` e `prompts/`, e diz "15 diagramas Mermaid" (há 1).
- 8 provas da §9 apontam para arquivos que não existem (`docs/relatorios/P0.md` etc. e o `SPEC-TEMPLATE` apagado).
- Na §9.2, três tópicos têm `docs/PLANO-DE-ACAO.md` no lugar do hash.
- O relatório omitiu checklist das travas, pendências dos documentos apagados e dúvidas, e declarou "Nenhum desvio".

## TRAVAS
- **T-A** `git status --short` só mostra `.claude/`; `git rev-parse --short HEAD` = `git log -1 --format=%h -- docs/prompts/D1b-correcao-d1.md`. Diferente → PARE.
- **T-B** PODE ALTERAR: `docs/NEXTCODE-REFERENCIA.md` (só as linhas indicadas em D1b.1 a D1b.4) e `docs/relatorios/D1-documento-unico.md` (só acrescentar ao fim, D1b.5). Mais nada.
- **T-C** Literalidade total. **T-D** todo hash conferido com `git log --oneline -1 <hash>`; todo caminho com `git ls-files`.
- **T-E** um commit só, com `npx tsc --noEmit` e `npx vitest run` completos, saídas coladas. Proibido `--amend`, `rebase`, `reset`, `revert`, `restore`, `stash`, `push --force`, `--no-verify`.
- **T-I** preservar o fim de linha da referência. **T-K** commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **T-L** relatório fiel; "Desvios" é obrigatório e verdadeiro. **T-O** nenhum documento novo.

---

## D1b.1 — Substituir a §7 inteira
Tudo entre a linha `## 7. Documentos antigos (mantidos)` e o `---` seguinte (exclusive) passa a ser **exatamente** (sem as 4 linhas de recuo):

    ## 7. Documentos antigos (mantidos)

    | Documento | Situação |
    |---|---|
    | `ARQUITETURA-ORQUESTRACAO.md` | detalhe do desenho (fases, templates, travas); vale onde não contradiz este |
    | `rascunhos/JEV-DECISOES.md` | catálogo do Jev do projeto |
    | `rascunhos/TEMPLATES.md` | base de `src/core/templates/artifact-templates.ts` |
    | `rascunhos/TERCEIROS.md` | licenças e origem do material de terceiros |
    | `rascunhos/politicas-orquestracao.yaml` | **reserva lida pelo código** se `config/` faltar (`orchestration-policy.ts:342`); não mover |
    | `terceiros/jev-docs/` | documentação oficial do Jev (cópia local) |
    | `specs/gatway-system-spec.md` | Spec do Gateway (formato antigo, sem `REQ`) |
    | `prompts/`, `relatorios/` | prompts ao Antigravity e relatórios/auditorias — são a prova dos números |

    Documentos apagados em D1 (13/10): ver §9.0 (com o comando para recuperar cada um).

## D1b.2 — Provas quebradas na §9 (trocar só o caminho, nada mais na linha)
| Troque | Por |
|---|---|
| `docs/relatorios/R1.md` | `docs/relatorios/R1-roteamento-pago-primeiro.md` |
| `docs/relatorios/P0.md` | `docs/relatorios/P0-arrumacao.md` |
| `docs/relatorios/P1.md` | `docs/relatorios/P1-nucleo-jev.md` |
| `docs/relatorios/P3.md` | `docs/relatorios/P3-avaliador-freellmapi.md` |
| `docs/relatorios/P2.md` | `docs/relatorios/P2-bench-real.md` |
| `docs/relatorios/P2b.md` | `docs/relatorios/P2b-bench-dificil.md` |
| `docs/relatorios/S1.md` | `docs/relatorios/S1-skills.md` |
| `docs/SPEC-TEMPLATE-NEXTCODE-V5.md` (prova do tópico de 30/09) | `git show 54e08bd:docs/SPEC-TEMPLATE-NEXTCODE-V5.md` |

## D1b.3 — Hash no lugar do documento (§9.2; trocar só o trecho entre crases que hoje é `docs/PLANO-DE-ACAO.md`)
| Tópico (início da linha) | `docs/PLANO-DE-ACAO.md` vira |
|---|---|
| `- **06/10** — Definição do plano de 10 itens` | `4153633` |
| `- **07/10** — Runtime de skills` | `7f1c5c8, d3c90f4` |
| `- **07/10** — Avaliador Lente Cega` | `1d4f331, f31c375, 7308bd2` |

## D1b.4 — Fechar o tópico do D1 (§9.5, última linha)
A linha `- **13/10** — D1: documentos antigos consolidados em §9 e apagados` passa a ser **exatamente** (sem o recuo):

    - **13/10** — D1: documentos antigos consolidados em §9 e apagados; §7 e provas corrigidas em D1b · `bc63e09, 98beb93, 0664efc` · prova: `docs/relatorios/D1-documento-unico.md`

## D1b.5 — Completar o relatório do D1
Acrescentar ao fim de `docs/relatorios/D1-documento-unico.md` a seção `## 11. Complemento D1b (13/10)` com:
0. **Leitura feita:** 3 linhas (Regra Zero).
1. **Desvios do D1 (corrigindo a seção 7, que dizia "nenhum"):** os quatro achados da seção "POR QUE ESTE PACOTE EXISTE", copiados.
2. **Checklist T-A…T-O do D1** (sim/não com evidência).
3. **Pendências encontradas só nos documentos apagados** (regra 6 do D1.1): leia `git show 54e08bd:<caminho>` dos 8 documentos; liste item não concluído que não está em §5/§6 da referência, com texto original e origem. Nenhuma → escreva "nenhuma".
4. **Conferência D1b:** `git show --stat` do commit (só os 2 arquivos); cada caminho de prova da §9 conferido (`git ls-files` ou `git show`), saída colada.
5. **Desvios do D1b:** obrigatório; "nenhum" só se for verdade.
6. **Dúvidas abertas** para o fundador.

Commit: `docs: D1b - corrige secao 7, provas da secao 9 e relatorio do D1`.

Ao terminar, PARE: não edite `memory/diario.md` e não inicie outro pacote.

===== FIM DO PROMPT =====
