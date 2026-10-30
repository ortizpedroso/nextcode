# Memória de trabalho — NextCode

> Lida em toda sessão. **Antes de qualquer tarefa, leia nesta ordem:**
> 1. `memory/diario.md` — onde paramos;
> 2. `memory/decisoes.md` — o que o fundador já decidiu (não contradizer; em dúvida, perguntar);
> 3. `memory/medicoes.md` — números reais já medidos (não estimar de novo);
> 4. `docs/NEXTCODE-REFERENCIA.md` — documento único: o que foi feito, **o que falta (§3, fila por relevância)**, protocolo Antigravity implementa / Claude audita (§9). Histórico antigo: `git show cabc2d7:<caminho>` (§10).
> **Ao terminar qualquer passo:** atualize o diário. Histórico bruto: transcrições em `~/.claude/projects/C--projetos-nextcode/*.jsonl`.

## Regras do fundador (obrigatórias)
1. **Fonte única:** `docs/NEXTCODE-REFERENCIA.md`. Melhoria aprovada entra nela **antes** de ser executada.
2. **Tudo documentado:** cada sessão registra em `memory/diario.md` o que foi feito, onde parou e o próximo passo. **Ao terminar um item da §3:** relatório do pacote + auditoria do Claude com veredito no diário — **obrigatório, não negociável** (referência §9).
3. **Não alucinar:** só citar arquivo/função que existe (`git grep`); "funciona" só com a saída real colada.
4. **Documento único:** `docs/NEXTCODE-REFERENCIA.md` (plano e estado; registro do que foi feito na §2). Documento antigo só é apagado com aprovação do fundador e **depois** de resumido nele com o hash para recuperar (§10, `git show <hash>:<caminho>`). Antigravity não cria plano/log paralelo (trava T-O).
5. Um passo por vez; commit por passo com `tsc` e `vitest` **daquele commit**.
6. Discordar com veredito técnico quando a ideia estiver errada (ver memória `push-back-honestly`).
7. Nenhum segredo em texto puro e nenhum segredo sai da máquina (nem para LLM, nem para o Jev).
8. **Modelos (08/10 tarde):** o Jev escolhe modelo e divisão de todos os papéis; elicitador, executor e avaliador não economizam se precisar; gratuito só sem prejuízo (regra 8 da referência §1.2).

## Projeto
| Nome | O que é |
|---|---|
| **NextCode** | Harness que transforma pedido em software entregue: fases, fila, travas, skills, Jev, gateways |
| **Gateway** | Projeto real do fundador (pagamentos Asaas) — sessão real `4d019f00` (referência §7.2) |
| **P1 / P2** | Projetos de teste: P1 API de tarefas; P2 CRUD com tela |
→ Detalhes: `memory/projects/nextcode.md`

## Termos
| Termo | Significado |
|---|---|
| **Jev** | Modelo de decisão da TypeSafe (`jev-1.13.0`): choice / score / noul com confiança |
| **Skill** | Papel em `skills/<nome>/SKILL.md` (elicitador, analista, executor-*, avaliador-*) |
| **Cluster** | core · backend · frontend · integration |
| **REQ-nnn** | Código de requisito da Spec; tudo é conferido por ele |
| **Microbrief / Macrobrief** | Pedaço de trabalho de um executor / resumo da Spec para o analista |
| **T1–T10** | Travas do harness (aprovação, escopo, trilha, quarentena, 2 lentes, 3 tentativas, pesquisa, conferência, fase, entrega) |
| **Lente Cega / Lente 2** | Avaliação por REQ sem ler o relatório / comparação com o relatório do executor |
| **Modo sombra** | Decisão do Jev só registrada na trilha, sem agir |
| **Antigravity** | Outro agente que executa prompts escritos aqui; o trabalho dele é auditado antes de aceitar |
→ Glossário completo: `memory/glossary.md`

## Preferências
- Português do Brasil, linguagem simples; veredito antes do detalhe.
- Fundador quer usar o Jev ao máximo, mas com prova (bench) — não por suposição.
