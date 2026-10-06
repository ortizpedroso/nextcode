# Plano de ação — NextCode como harness de skills

> **Fonte única do trabalho a partir de 06/10/2026.** Substitui as listas M1–M6 e R1–R7.
> Um item por vez; só se começa o próximo quando o anterior está **pronto** (definição abaixo).

## O modelo (decisão do fundador, D5)

O NextCode é **um harness**: máquina de fases, fila, ferramentas, quarentena, compilação, trilha,
roteamento de modelos. Os **papéis são skills** — arquivos que o harness carrega e executa, como os
agentes do opencode (`.opencode/agent/*.md`: frontmatter com `model`, `tools`, `permission`, `steps`
+ instruções) e as skills (`SKILL.md`: conhecimento carregado sob demanda).

| Papel (skill) | Faz | Entra | Sai (template) |
|---|---|---|---|
| `elicitador` | Triagem, perguntas, pesquisa oficial, escreve a Spec e o Macrobrief | conversa | Spec (com `REQ`), Macrobrief |
| `analista` | Confere Spec × Macrobrief (até 3 ciclos) e divide em Microbriefs por cluster | Spec, Macrobrief | Microbriefs |
| `executor-{core,backend,frontend,integration}` | Implementa um Microbrief, se autotesta, corrige até passar | Microbrief + código das dependências | arquivos + Relatório (template do Microbrief) |
| `avaliador-{core,backend,frontend,integration}` | Lente Cega por `REQ`; Lente 2 contra o relatório | Microbriefs, código, relatório | Veredito por `REQ` |

**Formato de uma skill** (`skills/<nome>/SKILL.md`):

```yaml
---
name: executor-backend
papel: executor
cluster: backend
nivel_modelo: forte          # o roteador/Jev escolhe o provedor dentro do nível
ferramentas: [read_file, list_files, grep, write_file, edit_file, run_check, finish]
permissoes:
  escrever: escopo           # só os arquivos do Microbrief — APLICADO PELO HARNESS
  comandos: [typecheck, test]
passos_max: 25
entrada: microbrief          # template validado antes de chamar
saida: relatorio_executor    # template validado depois
checagens: [compila, escopo, relatorio_bate_com_microbrief]
---
<instruções do papel, regras do cluster, exemplos>
```

**Travas:** a skill **declara**; o harness **aplica**. Uma regra só no texto do prompt é um pedido ao
modelo, não uma trava. Por isso `permissoes` e `checagens` viram código do runtime, e as travas
globais (T1 aprovação, T3 trilha, T4 quarentena + compilação + rollback, T6 3 tentativas) continuam
no harness para todas as skills.

## Itens

| # | Entrega | Pronto quando |
|---|---|---|
| **1** | **Fila nunca para**: falta de IA pausa a sessão (`PAUSADA`) sem consumir tentativa, aviso no chat em 1 min, retoma sozinha; supervisor periódico (sessão sem job, job travado, nó preso em `running`) | Teste com gateway falso fora do ar: nenhuma tentativa gasta, sessão volta a `EXECUCAO` e termina |
| **2** | **Runtime de skills**: carrega `SKILL.md`, monta o prompt, laço com ferramentas (ler, escrever 1 arquivo por chamada, editar trecho, rodar checagem, finalizar), aplica `permissoes`, `passos_max`, valida entrada/saída contra o template, roda `checagens`. O executor atual vira a skill `executor-backend` | P1 (API de tarefas) entregue pela skill, com `tsc` 0 erros |
| **3** | **Templates + `REQ` + clusters**: Spec com `REQ-001…`; templates de Macrobrief, Microbrief, Relatório do Executor e Veredito (YAML + Markdown) com validadores mecânicos; cada arquivo com cluster | Validadores com testes; Spec do P1 sai com `REQ` |
| **4** | **Skill `analista`** + Microbriefs por cluster (cada arquivo em exatamente um executor, sem ciclo, todos os `REQ` cobertos — T8b) → DAG paralela por dependência | P1 e P2 divididos pelo analista, conferência T8b verde |
| **5** | **Executores por cluster** (`core`, `backend`, `frontend`, `integration`): autoteste, ciclo de correção, Relatório no template do Microbrief (2 reenvios só do relatório; código errado conta nas 3 tentativas) | P2 (CRUD com tela) entregue, relatório bate com o Microbrief |
| **6** | **Avaliadores por cluster**: Lente Cega por `REQ` (não lê o relatório), Lente 2 contra o relatório, **modelo forte e diferente do executor** | Divergência plantada em teste é pega; P2 aprovado |
| **7** | **Skill `elicitador`** completa: triagem (3ª rodada), Spec com `REQ`, **Macrobrief**, ciclo com o analista (3 ciclos — T8a); pesquisa oficial com orçamento (T7) por último | Conversa real → Spec + Macrobrief aprovados pelo analista |
| **8** | **Jev como seletor**: por chamada, decide nível de modelo e se divide a tarefa; roteador escolhe o provedor (FreeLLMAPI, DeepSeek, …) | Medição com e sem Jev: custo, tempo, aprovação na 1ª |
| **9** | **Entrega (T10)**: build do projeto inteiro + todos os `REQ` aprovados para dizer "Entregue" | Gateway do fundador entregue com build ok |

## Projetos de teste (sempre os mesmos, do menor ao maior)

- **P1** — API de tarefas em memória (Next.js): 1 lib + 2 rotas.
- **P2** — CRUD com tela (backend + frontend): exercita clusters e paralelismo.
- **Gateway** — só no item 9.

## Regras de trabalho

1. **Um item por vez, até o fim**: código + testes automáticos + execução real no P1/P2 + commit.
2. Nada de tópico novo no meio de um item; o que aparecer vira linha nova nesta tabela.
3. Toda afirmação de "funciona" vem com a saída real (teste ou execução), nunca de memória.
4. Dúvida de desenho → consultar opencode, deepseek-harness, FreeLLMAPI antes de inventar.

## Pendências do fundador

- **Avaliador forte e diferente do executor** (item 6): ativar o *billing* do projeto da chave Google
  (hoje no nível gratuito, 20 pedidos/dia) **ou** colocar crédito na API da Anthropic. O executor
  usa DeepSeek (pago, com crédito).
