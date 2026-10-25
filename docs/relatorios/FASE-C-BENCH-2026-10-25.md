# Fase C — Prova automatizada (2026-10-25)

## Bench P1–P4 (variante `padrao`, 1 repetição cada)

| Projeto | Fase | Aceite | Custo (US$) | Relatório |
|---------|------|--------|-------------|-----------|
| P1 | ENTREGUE | 10/10 | 0,20 | `bench/resultados/2026-10-25-1024.md` |
| P2 | ENTREGUE | 13/13 | 0,28 | `bench/resultados/2026-10-25-1043.md` |
| P3 | ENTREGUE (2ª tentativa) | 12/12 | 0,23 | `bench/resultados/2026-10-25-1052.md` |
| P4 | ENTREGUE | 12/12 | 0,11 | `bench/resultados/2026-10-25-1043.md` |

A 1ª execução de P3 terminou `BLOQUEADA` com aceite 12/12 (revisão final ou reparo); a repetição imediata entregou. Custo total do bench desta fase ≈ **US$ 1,13** (abaixo do teto de US$ 2).

Ajustes no runner: critérios P1/P2 citam arquivos da Spec (SM1); `NEXTCODE_CONFERENCIA_ENTRADA=desligado` no subprocesso do bench (mesma trilha J4 / vitest).

## Replay Gateway (`scripts/replay-contrato-a1.ts`)

**Não executado:** a cópia local de `prisma/dev.db` não contém a sessão `4d019f00` nem Spec equivalente ao Gateway histórico. Maior Spec local: `18467c9a` (~47 KB). A prova pesada fica na **Fase D** (pedido real do fundador).

## Próximo passo

Fase D — teste real com o prompt guardado pelo fundador (fora desta entrega).
