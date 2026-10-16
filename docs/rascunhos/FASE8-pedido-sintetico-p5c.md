# Fase 8 — Pedido sintético longo (smoke P5c, aprovação do fundador)

> **Uso:** colar **uma vez** no chat NextCode (nova sessão ou sessão de teste).  
> **Não** é Spec do Gateway; não contém segredos reais.  
> **Custo esperado:** ~US$ 0,60–0,75 (Claude Opus elicitador).  
> **Porta:** streaming sem `fetch failed`; Spec válida; trilha `LLM_COST` com papel `elicitador`.

---

## Texto do pedido (copiar abaixo)

Quero um sistema de **faturamento SaaS fictício** só para validar o harness — nome do produto **NextBill Demo**. Gere a Spec canônica completa (YAML com frontmatter `---` e corpo Markdown), com **pelo menos 40 requisitos** `REQ-001` … `REQ-040`, sem perguntas: trate tudo abaixo como decisão fechada.

**Stack:** Next.js 15 (App Router), TypeScript, Prisma, SQLite em dev, API Routes, sem autenticação real (mock de usuário fixo `demo@nextcode.local`).

**Regra de negócio obrigatória (precisa aparecer literalmente em REQ dedicados):** toda cobrança calcula taxas nesta ordem — (1) subtotal = quantidade × preço unitário; (2) desconto percentual aplicado **somente** sobre o subtotal; (3) base = subtotal − desconto; (4) imposto = 12,5% sobre a base; (5) taxa de processamento = R$ 0,39 fixos **por linha**; (6) total = base + imposto + (0,39 × número de linhas). Os dez exemplos numéricos abaixo devem constar na Spec como critérios de aceite e bater **exatamente**:

| # | qtd | preço | desc% | total esperado (R$) |
|---|-----|-------|-------|---------------------|
| 1 | 1 | 100,00 | 0 | 112,89 |
| 2 | 2 | 50,00 | 0 | 112,89 |
| 3 | 1 | 200,00 | 10 | 203,89 |
| 4 | 3 | 33,33 | 0 | 115,38 |
| 5 | 1 | 99,99 | 5 | 108,74 |
| 6 | 5 | 20,00 | 0 | 115,45 |
| 7 | 1 | 1000,00 | 15 | 1063,89 |
| 8 | 2 | 75,50 | 0 | 174,51 |
| 9 | 1 | 0,01 | 0 | 0,40 |
| 10 | 10 | 10,00 | 20 | 93,90 |

**Escopo mínimo por área (1+ REQ cada):** modelos Prisma (Invoice, LineItem, Customer); endpoints REST CRUD; página lista + detalhe; export CSV; validação Zod; testes de aceite citando os 10 totais; README; script seed.

**Proibições na Spec:** não inventar URLs de documentação externa; não citar Asaas, Stripe nem gateways reais; seção 7 (dúvidas) vazia se tudo acima estiver coberto.

---

## Checklist pós-geração (fundador ou auditor)

- [x] **Fase 8 aprovada pelo fundador** (16/10) — 「aprovado fase 8」.
- [ ] Resposta concluiu em &lt; 540 s sem erro `fetch failed` / timeout de cabeçalho *(registrar na trilha se quiser prova numérica)*.
- [ ] Trilha: evento `ELICITADOR_CLAUDE` ok; `LLM_COST` com `papel: elicitador`.
- [ ] Spec passa guarda cumulativa / estrutura (`REQ` numerados, frontmatter).
- [ ] (Opcional V2) Aprovar Spec, iniciar execução: 1º lote **não** bloqueia só porque elicitador gastou &gt; US$ 0,50.
