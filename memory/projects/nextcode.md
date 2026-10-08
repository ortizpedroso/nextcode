# NextCode

**Status:** em construção desde 27/09/2026 (~260 commits). Etapa 1 da arquitetura começou sem a Etapa 0 fechada (falta bench real).

## Documentos
| Arquivo | Papel |
|---|---|
| `docs/NEXTCODE-REFERENCIA.md` | **Fonte única** (status conferido, orquestração final, plano A–F, Jev) |
| `docs/ARQUITETURA-ORQUESTRACAO.md` | Desenho detalhado v4 (fases, templates, travas) — histórico/detalhe |
| `docs/PLANO-DE-ACAO.md` | Itens 1–10 — histórico |
| `docs/PLANO-ETAPA-0.md`, `PLAN-OMNIRHARDENING.md`, `LLM-GATEWAYS.md` | histórico |
| `docs/SPEC-TEMPLATE-NEXTCODE-V5.md` | obsoleto (sem REQ) |
| `config/politicas-orquestracao.yaml` | Política: limiares, modos do Jev (`jev_execucao`) |

## Arquivos-chave do código
| Peça | Onde |
|---|---|
| Fases | `src/core/orchestrator/phase-machine.ts` |
| Chat | `src/app/api/chat/route.ts` |
| Disparo da execução / planejamento | `src/core/orchestrator/execution-trigger.ts`, `src/core/skills/spec-decomposer.ts` |
| Execução de uma etapa | `src/core/orchestrator/node-executor.ts` (`executeTaskNode`) |
| Laço do executor | `src/core/skills/executor-tool-loop.ts` |
| Skills | `src/core/skills/skill-runtime.ts`, `skills/*/SKILL.md` |
| Avaliador | `src/core/governance/dual-lens-auditor.ts` |
| Fila | `src/core/orchestrator/job-queue.ts`, `job-worker.ts` |
| Jev | `src/core/decision/jev.ts`, `jev-decisions.ts`, `jev-execution-checks.ts`, `governance/secret-guard.ts` |
| Intake não ligado | `src/core/intake/intake-engine.ts` (ciclo elicitador × analista) |

## Ambiente
- Banco SQLite `prisma/dev.db` — **nunca escrever em teste**; usar cópia temporária.
- Gateways: FreeLLMAPI (3100) → OmniRoute (20128) → DeepSeek pago / BYOK.
- Custo de referência: P1 ≈ US$ 0,04; P2 ≈ US$ 0,08–0,14.
