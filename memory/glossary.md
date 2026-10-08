# Glossário

## Fases da sessão
| Fase | Significado |
|---|---|
| ENTRADA / CONVERSA / INTERVENCAO | Classificação da intenção; 3 rodadas incertas → 3 caminhos |
| ELICITACAO / ELICITACAO_CORRECAO | Elicitador pergunta e escreve a Spec (criar / corrigir) |
| SPEC_REVISAO | Usuário revisa; aprovação explícita (T1) |
| MACROBRIEF / CONFERENCIA | Elicitador resume; analista confere (T8a) — **existe, não usado no fluxo real** |
| PLANEJAMENTO | Microbriefs por cluster + DAG (T8b) |
| EXECUCAO / VERIFICACAO / ENTREGUE | Etapas rodam; T10 confere; fim |
| PAUSADA / BLOQUEADA | Sem IA (não gasta tentativa) / 3 tentativas esgotadas ou humano necessário |

## Travas
| Trava | Garante |
|---|---|
| T1 | Nada roda sem Spec aprovada |
| T2 | Executor só escreve os arquivos do seu Microbrief |
| T3 | Trilha append-only (`TelemetryLog`) |
| T4 | Quarentena, compilação real, rollback |
| T5 | Duas lentes, avaliador diferente do executor |
| T6 | 3 tentativas por etapa |
| T7 | Pesquisa só em fonte oficial, com orçamento |
| T8a / T8b | Spec × Macrobrief / Macrobrief × Microbriefs |
| T9 | Só o papel da fase age |
| T10 | Entrega só com todos os REQ e build ok |

## Jev
| Termo | Significado |
|---|---|
| choice | Escolhe 1 opção; devolve probabilidades + confiança |
| score | Nota em níveis ordenados (2–10) |
| noul | Probabilidade de "sim" (0–1); perto de 0,5 = não sabe |
| state | O conteúdo avaliado (texto ou JSON) |
| fan-out | Várias perguntas num único pedido (mais barato e rápido) |
| jaggedness | Fraquezas conhecidas do jev-1.13 (conta, datas, ordem das opções, estado grande, injeção) |

## Outros
| Termo | Significado |
|---|---|
| FreeLLMAPI / OmniRoute | Gateways de LLM (primário / secundário) |
| BYOK | Chaves do próprio usuário |
| Laya | Motor de decisão local (adiado) |
| D1–D10 | Decisões tomadas na arquitetura §15 |
| Itens 1–10 | Linhas do `PLANO-DE-ACAO.md` |
| Fases A–F | Plano novo em `NEXTCODE-REFERENCIA.md` §5 |
