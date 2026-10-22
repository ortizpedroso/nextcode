# Relatórios — índice

Um arquivo por pacote ou fase, no formato de `docs/NEXTCODE-REFERENCIA.md` §8.4. Ordem e estado do trabalho estão **só** na referência (§5.0); aqui está a prova. Veredito das auditorias no `memory/diario.md`.

**Regra (referência §8.1):** ao fechar uma fase de implementação, relatório consolidado `AUDITORIA-<escopo>.md` é obrigatório. Execução autônoma (o Claude decide pelo fundador) → também `DECISOES-AUTONOMAS-<escopo>.md`.

## Agora — execução autônoma 5, mudança 44 (22/10)
- `AUDITORIA-E5.md` — **consolidado**: commits por item, provas medidas, o que não foi verificado e como continuar.
- `IMPLEMENTADO-E5.md` — o mesmo em linguagem simples, para o fundador.
- `DECISOES-AUTONOMAS-E5.md` — o que o Claude decidiu pelo fundador (E5-D1…D35).
- `JV1-revisao-jev.md` — tabela uso × pergunta × ação × medição do Jev.
- `bench/2026-10-22-1538.*` e `bench/2026-10-22-44-5-*.json` — J4 (P1/P2) e esforço.

## Mudança 43, revisor com bancada de testes (22/10)
- `AUDITORIA-43-revisor-bancada.md` — **consolidado** da mudança 43 (43.1–43.4): bancada, reprodução de defeitos, contrato do reparo, aviso pelo diagnóstico, rodada extra no Gateway, decisões H1–H10.
- `TESTE-E1-4-antigravity.md` — teste independente da execução 4 pelo Antigravity (aceito com ressalvas; ressalvas conferidas na auditoria 43 §5).
- `bench/2026-10-22-43-2-reproducao-gateway.json` — revisão com reprodução no Gateway (8 de 10 suspeitas provadas).

## Fim da E1 (21–22/10)
- `AUDITORIA-E1-4.md` — **consolidado** da execução autônoma 4 (mudanças 35–40): commits, testes, retomada real do Gateway, revisão final.
- `IMPLEMENTADO-E1-4.md` — o mesmo em linguagem simples, para o fundador.
- `DECISOES-AUTONOMAS-E1-4.md` — o que o Claude decidiu pelo fundador (D1–D33) e, a partir da 2ª rodada, a seção "rodada final".
- `TESTE-REAL-GATEWAY-4d019f00.md` — teste real do fundador (Gateway whitelabel sobre Asaas): execução, bloqueios, retomadas.
- `DECISOES-AUTONOMAS-E1-3.md` — execução autônoma 3 (mudança 27): D23, TS1, desenho do J2b (J1–J8).
- `TESTE-PESADO-E1.md` — teste pesado sintético (3 tentativas paradas por ambiente; substituído como porta da E1 pela mudança 37).
- Prompt para outro LLM testar a execução 4: `docs/prompts/TESTE-E1-4.md`.

## Execução autônoma 2 — produção (19–20/10, mudança 26)
- `IMPLEMENTADO-E1-producao.md`, `DECISOES-AUTONOMAS-E1-2.md` (D1–D42), `AUDITORIA-E1-producao.md` (consolidado), `AUDITORIA-E1-producao-cursor.md` (auditoria do Cursor).

## Execução autônoma 1 (17–18/10, mudança 23)
- `DECISOES-AUTONOMAS-E1.md`, `AUDITORIA-E1-autonoma.md` (consolidado), `AUDITORIA-E1-autonoma-cursor.md`.
- `A2-analista-planeja.md`, `A3-falha-roteada-ao-dono.md`.

## Auditorias de subsistema (16–17/10)
- `AUDITORIA-SKILLS.md`, `AUDITORIA-JEV.md`, `PERFIL-PROVEDORES.md`, `PESQUISADOR-REFERENCIAS.md`.

## E1 parcial — entrada, elicitador, projetos (14–16/10)
- `AUDITORIA-E1-FASES-1-8-implementacao.md` (consolidado Fases 1–8 + P5c.4); `STATUS-implementacao-2026-10-16.md` (status em `7c564a3`).
- `HANDOFF-E1-P5c-F8-para-auditoria.md`, `HANDOFF-E1-P5c-F8-fechamento.md`, `F8-smoke-P5c-fechamento.md`.
- `P5-entrada-como-pensada.md`, `P5.5-mascara-json-asaas.md`, `P5.5b-mascara-duas-passadas.md`, `P5c-elicitador-opus-teto.md`, `P5c.3-elicitador-claude-stream.md`, `P5c.4-indicador-spec-chat.md`.
- `B1-bench-avaliador-claude.md`, `B1c-PJ1.md`.

## E0 — base (08–14/10)
- `P0-arrumacao.md`, `P1-nucleo-jev.md`, `P2-bench-real.md`, `P2b-bench-dificil.md`, `P3-avaliador-freellmapi.md`, `R1-roteamento-pago-primeiro.md`, `S1-skills.md`, `auditoria-skills-S0.md`.
- `auditoria-completa-2026-10-12.md`, `C1-correcoes-auditoria.md`, `D1-documento-unico.md`, `diagnostico-docs-2026-10-13.md`.
- `J1-diagnostico-entrega-jev.md`, `J2-nenhuma-parada-silenciosa.md`, `I1-inventario-ligado-desligado.md`.

## Medições
- `bench/` — rodadas do bench P1–P4 (`AAAA-MM-DD-HHMM.md` + `.yaml`) e as provas em JSON do J3 (`2026-10-21-j3-controles-avaliador-final.json`, `2026-10-22-j3-controles-sonnet-linhas-numeradas.json`, `2026-10-22-j3-gateway-4d019f00.json`).

## Apagados (recuperáveis)
Ver referência §9.0 (`git show <hash>:<caminho>`).
