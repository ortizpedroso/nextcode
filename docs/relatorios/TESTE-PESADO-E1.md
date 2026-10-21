# Teste pesado E1 — Spec real `8e2f2052` (Multi_Gateway), código de 2026-10-21

Sessão (cópia do banco): `6897a372-7304-4f2a-a0c4-fe3e89f1de99` · fim: **relatório refeito** · fase final: **EXECUCAO** · duração: 0.4 h
Cópia do banco e projeto: `C:\Users\ortiz\AppData\Local\Temp\nc-teste-pesado` (prisma/dev.db não é escrito).

## Comparação com a 1ª execução

| medida | 1ª execução (18–19/10) | agora |
|---|---|---|
| etapas concluídas | 49/55 | 6/56 |
| custo total (US$) | 18.78 | 0.71 |
| chamadas do executor | 1724 | 22 |
| pausas SEM_LLM | 548 | 28 |

## Porta (decidida em DECISOES-AUTONOMAS-E1-3.md)

- ENTREGUE: **não**
- ≤ 10 chamadas do executor em **cada** etapa com IA: **sim** — média 3.1, máximo 6
- custo abaixo de US$ 18.78: **sim**
- aprovadas na 1ª tentativa: 5/6

## Custo por papel

| papel | chamadas | US$ |
|---|---|---|
| analista | 2 | 0.2129 |
| executor | 22 | 0.3421 |
| avaliador | 7 | 0.1508 |
| jev | 8 | 0.0004 |
| **total** | 39 | **0.7061** |


Teto do sistema (P9): US$ 29.40 · gasto contado no teto: US$ 0.71

## Eventos da trilha

| evento | vezes |
|---|---|
| SESSION_PAUSED_NO_LLM | 28 |
| EXECUTOR_TURN_RETRY | 68 |
| HARNESS_RULE_BLOCK | 0 |
| EXECUTOR_REPORT_INVALID | 1 |
| SKILL_TOOL_DENIED | 0 |
| EVALUATOR_UNAVAILABLE | 0 |
| EVALUATOR_OUTAGE_PAUSED | 0 |
| BUDGET_AUTHORIZED | 0 |
| NODE_EXECUTION_COMPLETED | 6 |

## Etapas

| # | etapa | cluster | status | tentativas gastas | chamadas do executor | executor US$ | avaliador US$ |
|---|---|---|---|---|---|---|---|
| 1 | Base do projeto: dependências e tsconfig (sem IA) | core | completed | 0 | 0 | 0.0000 | 0.0000 |
| 2 | Etapa 1/55: package.json, tsconfig.json, .env.example +1 | core | completed | 0 | 2 | 0.0242 | 0.0176 |
| 3 | Etapa 2/55: lib/env.ts | core | running | 2 | 6 | 0.1284 | 0.0000 |
| 4 | Etapa 3/55: lib/db.ts, lib/redis.ts, http/api-error.ts | core | pending | 0 | 0 | 0.0000 | 0.0000 |
| 5 | Etapa 4/55: next.config.mjs, vitest.config.ts | core | completed | 0 | 2 | 0.0200 | 0.0069 |
| 6 | Etapa 5/55: prisma/schema.prisma | core | pending | 0 | 0 | 0.0000 | 0.0000 |
| 7 | Etapa 6/55: lib/crypto.ts | core | pending | 0 | 0 | 0.0000 | 0.0000 |
| 8 | Etapa 7/55: validation/documento.ts, validation/schemas.ts, tests/documento.test.ts | core | completed | 1 | 6 | 0.1051 | 0.0784 |
| 9 | Etapa 8/55: auth/password.ts, auth/session.ts | core | pending | 0 | 0 | 0.0000 | 0.0000 |
| 10 | Etapa 9/55: lib/tenant.ts, tests/tenant-isolation.test.ts | core | pending | 0 | 0 | 0.0000 | 0.0000 |
| 11 | Etapa 10/55: lib/rate-limit.ts, auth/api-key.ts | core | pending | 0 | 0 | 0.0000 | 0.0000 |
| 12 | Etapa 11/55: billing/split.ts, tests/split.test.ts | core | completed | 0 | 2 | 0.0185 | 0.0231 |
| 13 | Etapa 12/55: billing/installments.ts, tests/installments.test.ts | core | completed | 0 | 3 | 0.0389 | 0.0249 |
| 14 | Etapa 13/55: asaas/types.ts, asaas/client.ts | integration | pending | 0 | 0 | 0.0000 | 0.0000 |
| 15 | Etapa 14/55: asaas/payments.ts | integration | pending | 0 | 0 | 0.0000 | 0.0000 |
| 16 | Etapa 15/55: queue/queues.ts, worker/index.ts | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 17 | Etapa 16/55: billing/charges-service.ts | core | pending | 0 | 0 | 0.0000 | 0.0000 |
| 18 | Etapa 17/55: billing/refunds-service.ts | core | pending | 0 | 0 | 0.0000 | 0.0000 |
| 19 | Etapa 18/55: app/layout.tsx, app/globals.css, app/page.tsx | frontend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 20 | Etapa 19/55: register/route.ts, cadastro/page.tsx | frontend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 21 | Etapa 20/55: login/route.ts, logout/route.ts, session/route.ts +1 | frontend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 22 | Etapa 21/55: src/middleware.ts | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 23 | Etapa 22/55: asaas/accounts.ts, subconta/route.ts | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 24 | Etapa 23/55: asaas/transfers.ts, saldo/route.ts, transferencias/route.ts +1 | frontend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 25 | Etapa 24/55: produtos/route.ts, [id]/route.ts, produtos/page.tsx | frontend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 26 | Etapa 25/55: links/route.ts, [id]/route.ts, links/page.tsx | frontend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 27 | Etapa 26/55: cobrancas/route.ts, cobrancas/page.tsx | frontend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 28 | Etapa 27/55: lib/whitelabel.ts, whitelabel/route.ts, regua/route.ts +1 | frontend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 29 | Etapa 28/55: [slug]/route.ts | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 30 | Etapa 29/55: pagar/route.ts | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 31 | Etapa 30/55: parcelas/route.ts | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 32 | Etapa 31/55: [cobrancaId]/route.ts | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 33 | Etapa 32/55: checkout/PixPayment.tsx, checkout/CardPayment.tsx, checkout/BoletoPayment.tsx | frontend | running | 0 | 1 | 0.0070 | 0.0000 |
| 34 | Etapa 33/55: [slug]/page.tsx, checkout/CheckoutForm.tsx | frontend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 35 | Etapa 34/55: hooks/usePaymentStatus.ts, sucesso/page.tsx | frontend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 36 | Etapa 35/55: asaas/route.ts, webhooks/idempotency.ts | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 37 | Etapa 36/55: webhooks/asaas-handler.ts, tests/webhooks.idempotency.test.ts | integration | pending | 0 | 0 | 0.0000 | 0.0000 |
| 38 | Etapa 37/55: notifications/types.ts, email/resend.ts, email/sendgrid.ts +1 | integration | pending | 0 | 0 | 0.0000 | 0.0000 |
| 39 | Etapa 38/55: whatsapp/z-api.ts, whatsapp/evolution.ts, notifications/factory.ts | integration | pending | 0 | 0 | 0.0000 | 0.0000 |
| 40 | Etapa 39/55: notifications/templates.ts | core | pending | 0 | 0 | 0.0000 | 0.0000 |
| 41 | Etapa 40/55: notifications/receipt-service.ts | core | pending | 0 | 0 | 0.0000 | 0.0000 |
| 42 | Etapa 41/55: notifications/dunning.ts, regua/route.ts | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 43 | Etapa 42/55: api-keys/route.ts, [id]/route.ts, tests/api-key.test.ts | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 44 | Etapa 43/55: webhooks/outbound.ts, webhooks-config/route.ts, integracoes/page.tsx | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 45 | Etapa 44/55: contracts/public-api.ts, docs/openapi.yaml | core | running | 0 | 0 | 0.0000 | 0.0000 |
| 46 | Etapa 45/55: lib/api-idempotency.ts | core | pending | 0 | 0 | 0.0000 | 0.0000 |
| 47 | Etapa 46/55: charges/route.ts | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 48 | Etapa 47/55: [id]/route.ts | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 49 | Etapa 48/55: payment-links/route.ts | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 50 | Etapa 49/55: refunds/route.ts | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 51 | Etapa 50/55: metrics/dashboard-metrics.ts, metricas/route.ts | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 52 | Etapa 51/55: dashboard/KpiCard.tsx, dashboard/RevenueChart.tsx, dashboard/MethodDonutChart.tsx +1 | frontend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 53 | Etapa 52/55: dashboard/DelinquencyCard.tsx | frontend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 54 | Etapa 53/55: dashboard/layout.tsx, dashboard/page.tsx | frontend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 55 | Etapa 54/55: reports/query.ts, relatorios/route.ts, reports/ReportsTable.tsx +1 | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
| 56 | Etapa 55/55: reports/export-csv.ts, reports/export-pdf.ts, export/route.ts | backend | pending | 0 | 0 | 0.0000 | 0.0000 |
