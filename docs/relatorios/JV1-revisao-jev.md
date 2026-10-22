# JV1 — Revisão do Jev ponto a ponto (mudança 44.7, 22/10/2026)

**Regra (referência §5.0, JV1):** toda pergunta ao Jev tem dono da resposta (o que o código faz com cada valor) ou sai.
**Fonte da medição:** trilha real em `prisma/dev.db` (todas as sessões) e do Gateway `4d019f00` (65 REQ, 40 etapas), lida por script em 22/10. Custo total do Jev em toda a base: **US$ 0,033 em 327 chamadas** — o custo não decide nada aqui; o que decide é o efeito.

## Veredito

De 12 usos, **3 mudaram com a medição**:
- 2 desligados (não mudavam nenhuma decisão e, num deles, mudariam para pior);
- 1 consertado (a pergunta existia, mas a resposta nunca chegava).

Os outros ficam como estão, com o motivo abaixo.

## Tabela

| Uso | Onde | Pergunta | O que o código faz com a resposta | Medição real | Decisão |
|---|---|---|---|---|---|
| J1/fan-out do chat | `evaluateChatFanOutWithJev` (`chat/route.ts`) | intenção da mensagem, aprovação sem condições, precisa de grafo, guardrail de entrada, perfil | roteia a mensagem (intenção), confirma aprovação, sugere Graphify só com código (P11) | 28 chamadas; intenção certa nas amostras (`criar_novo` 1,0 na abertura do Gateway) | **mantém** |
| M2 clareza da Spec | `decideSpecClarity` | Spec clara / escopo fechado / sem contradição | só registra `SPEC_CLARITY_SHADOW` (P11 tirou o aviso) | 5 registros, nenhum efeito | **mantém em sombra até a E2** — o redesenho por item (J8/J11, mudança 25) substitui esta pergunta larga; desligar antes não ganha nada |
| M3 planejamento | `decideMicrobriefsPlanningBatch` (`execution-trigger.ts`) | nível do modelo, dividir, cluster, skill de apoio | grava `nivelModeloSugerido` e `jevPlan` no Microbrief | **Gateway: `JEV_STATE_TOO_LARGE` 30.115 > 24.000 → as 40 etapas no nível de reserva** | **consertado:** lotes de até 8 e 12 mil caracteres (`chunkPlanningInputs`) |
| J24 diagnóstico de falha | `diagnoseStageFailureWithJev` (`node-executor.ts`) | causa da falha (código errado, saída incompleta, ambiente, Spec ambígua, avaliador) | acrescenta a linha de diagnóstico ao retorno da próxima tentativa | 23 no Gateway: 12 `wrong_code`, 10 `incomplete_output`, 1 `environment`; o único caso com causa conhecida (middleware fora do escopo da etapa = plano) veio `wrong_code` 0,70 | **diagnóstico mantém** (só dá uma dica); **A3 roteamento continua em sombra** (errou o dono no caso conferido) |
| J25 bloqueio por Spec ambígua | `bloqueio_spec_ambigua: ativo` | a falha é da Spec? | bloqueia e pergunta | 0 casos no Gateway (a revisão com bancada passou a fazer a pergunta objetiva) | **mantém** |
| J23 evidência por REQ | `verifyStageEvidenceWithJev` | a citação apoia / contradiz / não tem relação com o REQ | nada (o "ativo" registrava como sombra por um TODO) | 211 checagens, **15 divergências, todas falsas**: REQ-009/013/023/032/040 "não relacionado", e a revisão final com bancada provou os 65 REQ implementados | **desligado** (ativo teria dado 15 reprovações indevidas) |
| J2 auditoria final do Jev | `verifyProjectDeliveryWithJev` (`job-queue.ts`) | requisitos, regras, stubs, contratos, segurança, integração | sombra: só registro | **nunca rodou num projeto real**: estado de 284–292 mil caracteres > 28 mil → `fallback_sem_jev` "aprovado" | **desligado** — a revisão final com bancada (J3, mudança 43) faz este papel com prova |
| J6/J21 segredos | `secret-guard.ts` (`askJevBatch`) | o trecho é segredo? | bloqueia o trecho (código e chat) | ativo, sem falso positivo conhecido | **mantém** |
| J27 instalação de skill | `checkSkillInstallWithJev` | risco na skill do GitHub | recusa a instalação | ativo | **mantém** |
| J12/J13 fonte oficial T7 | `decideExternalDocsSafetyT7` | a fonte é oficial e segura? | aceita/bloqueia o trecho (fail closed) | sem uso real ainda (T7 entra na E2) | **mantém** (a E2 mede) |
| P5 conferência de entrada | `verifyMacrobriefCoverageWithJev` | o Macrobrief cobre cada REQ? | sombra | 3 `CONFERENCIA_ENTRADA` | **sombra** até a porta da E2 (≥ 5 aprovações reais sem reprovação indevida) |
| Código morto | `decideSpecReviewMessageIntent` (M1), `decideSdeCascadeEscalation` (M4), `measureJevSelectorComparison`, `askJevChoice` | — | nenhum chamador (`git grep`) | — | **removidos na 44.9** (decisão por delegação) |
