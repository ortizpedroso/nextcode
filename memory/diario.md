# Diário — onde paramos

> Entrada nova **no topo**. Cada entrada: data, o que foi feito (com commit), onde parou, próximo passo,
> decisões pendentes. Ler a primeira entrada antes de começar qualquer coisa.

---

## 08/10/2026 (4) — correção: eu tinha ignorado o histórico

**Erro desta sessão (para não repetir)**
- Planejei sem ler `docs/rascunhos/JEV-DECISOES.md` nem as transcrições. Resultado: plano v2 contradizia decisões do fundador (dizia que o Jev não escolhe provedor), reinventava o catálogo de 14 usos do Jev já feito em 08/10 00:54 e ignorava custos já medidos.

**Feito**
- Extraídas das 6 transcrições as mensagens do fundador → `memory/decisoes.md` (cronológico) e `memory/medicoes.md` (números reais).
- Referência §5.2 corrigida: elicitador fixo forte; executor nunca economiza; resto o Jev roteia (inclusive provedor); cascata só fora de Spec/executor. §5.2b: catálogo de 14 usos com estado real.
- `CLAUDE.md`: ordem de leitura obrigatória (diário → decisões → medições → referência → JEV-DECISOES).

**Pendente de esclarecer com o fundador**
- Avaliador entra no roteamento do Jev ou continua fixo forte (06/10 disse "não economizar")?
- "Skill de memória do Claude": instalado `CLAUDE.md` + `memory/` + ganchos; confirmar se ele quer outro (ex.: plugin específico).

**Próximo passo**
- Com as respostas: escrever prompts P0 e P1 (este inclui adotar `@typesafe-ai/sdk`).

---

## 08/10/2026 (3) — plano v2 "Jev máximo" + protocolo do Antigravity

**Diretrizes do fundador**
- Implementar tudo o que serve do Jev (orquestração/decisão).
- Crédito hoje só no DeepSeek; Claude e Gemini depois. **Não economizar na Spec nem no executor.**
- Documentar antes de executar; prompts ao Antigravity com travas; relatórios para auditoria.

**Feito (só documentação, nada de código)**
- Referência §5 trocada pelo plano v2: pacotes P0–P10; mudanças M1–M5 (executor/elicitador sempre no modelo forte; cascata J22 descartada; J16 passa a decidir divisão; J23 vira trava ativa enquanto só houver DeepSeek; teto de custo precisa de valor novo).
- Referência §8: travas T-A…T-K, estrutura do prompt, formato do relatório, auditoria.
- Pastas `docs/prompts/` e `docs/relatorios/`.

**Onde parou**
- Plano apresentado; aguardando aprovação (§6 da referência).

**Próximo passo**
- Aprovado → escrever `docs/prompts/P0-arrumacao.md` e `docs/prompts/P1-nucleo-jev.md`.

**Pendências do fundador**
- Aprovar plano v2 e ordem · teto de custo (proposta US$ 3,00 em P1–P4) · privacidade do Jev (proposta: aceitar) · stack/recorte do Gateway · Exa como busca.

---

## 08/10/2026 (2) — memória, ganchos, Jev a fundo, fluxo real × pensado

**Feito**
- Memória do projeto: `CLAUDE.md` (lida em toda sessão) + `memory/` (diário, glossário, projeto).
- Ganchos em `.claude/settings.json`: `SessionStart` injeta a última entrada do diário; `Stop` impede encerrar com commit novo sem diário. Testados por pipe (bloqueia/libera). Podem exigir `/hooks` ou reiniciar para valer.
- Recomendador do Claude Code setup rodado (só recomenda; nada mais instalado).
- Documentação do Jev baixada (46 páginas) e analisada: 22 recursos (R1–R22), 27 usos no NextCode (J1–J27): 7 ligados, 2 em sombra, 5 mortos, 13 propostas.
- Fluxo real traçado no código e comparado ao pensado: miolo da execução está como pensado; a **entrada não** (sem skill elicitador no chat, sem Macrobrief/CONFERENCIA por `etapa1Ativa: false`, sem analista LLM, sem pesquisa T7).
- `docs/NEXTCODE-REFERENCIA.md` reescrito: §0 regras, §2 fluxo hoje × pensado (diagramas), §4 Jev, §5 plano A–F.

**Onde parou**
- Aguardando o fundador aprovar o plano (§6 da referência).

**Próximo passo**
- Após aprovação: A2 (`McpServer.env` cifrado) → A3 (base comum do Jev) → A4 → A5 → Fase B.

**Pendências do fundador** (referência §6)
- Ordem A → F e quais propostas 📝 entram · billing Google/crédito Anthropic · stack/recorte do Gateway · privacidade do Jev (trechos de código do usuário) · quando sair do modo sombra.

---

## 08/10/2026 — sessão Claude (auditoria + referência única)

**Feito**
- Revisão do plano: itens 2, 3, 5, Extra concluídos; 1, 4, 6, 7, 8, 9 parciais (ver referência §3).
- Spec do Gateway (`docs/specs/gatway-system-spec.md`) é rejeitada pelo validador atual (formato V5, sem REQ); pasta `c:\projetos\gatway` não existe.
- Auditoria do Item 10 (feito pelo Antigravity, commits `414bee0`…`e4b2db6`):
  - commits `5fbf4e8`, `0697cc8`, `5e546d1` não compilam isolados; corrigido por *amend* não declarado em `926a5d6`.
  - **vazamento:** guarda de segredos mandava a linha com a chave ao Jev. **Corrigido em `c7fb624`** (4 testes; 586 testes verdes, `tsc` 0).
- Documentação do Jev baixada (llms.txt + 33 páginas) e analisada em parte.
- Criado `docs/NEXTCODE-REFERENCIA.md` (fonte única) + aviso no topo dos 6 docs antigos — **ainda não commitado**.
- Instalada a memória do projeto (`CLAUDE.md` + `memory/`).

**Onde parou**
- Fundador pediu: (1) memória ✅; (2) "claude setup"; (3) análise **profunda** do Jev para usar 15+ funcionalidades; (4) explicar o fluxo real × o pensado; (5) toda melhoria aprovada entra na referência antes de executar.

**Próximo passo**
- Rodar o recomendador do Claude Code setup; depois análise profunda do Jev → seção 4 da referência; depois mapa do fluxo real (com arquivo:linha) × pensado.

**Pendências do fundador**
- Billing Google ou crédito Anthropic (avaliador independente).
- Stack e recorte do Gateway.
- Aprovar ordem das fases A → F da referência.
