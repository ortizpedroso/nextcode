# TESTE-E5 — Frentes 5, 7, 8 e 9 (Completude)

**Data:** 24/10/2026
**Auditor:** Claude Opus 5.5 (sessão atual)
**Hash base:** HEAD atual (pós-D-M9)
**Escopo:** Completar as frentes pendentes do TESTE-E5 (§9.4 da referência única)

---

## Frente 5 — Dados que saem na T7 (pesquisa oficial)

**Veredito:** ✅ ACEITO

**Evidência:**
- `src/core/intake/official-docs-research.ts:80` — o fetcher recebe apenas `${p.nome} ${tema}` (nome do serviço + tema). Nenhum trecho da Spec, conversa ou código-fonte é enviado.
- `src/core/security/safe-fetch.ts:11-24` — anti-SSRF ativo: blockPrivateIPs, allowlist local deliberada (localhost, host.docker.internal), proteção contra DNS rebinding.
- `src/core/intake/official-docs-research.ts:88-95` — governança T7 rejeita páginas fora do domínio oficial do servico (`host.includes(p.host)`).
- Orçamento T7: 3 buscas, 5 páginas por sessão (`createDefaultResearchBudget`).

**Conclusão:** A pesquisa T7 envia somente o nome do serviço e o tema ao buscador externo. Nenhum dado sensível da Spec ou da conversa vaza.

---

## Frente 7 — Skills (papel desconhecido e permissões)

**Veredito:** ✅ ACEITO

**Evidência:**
- `src/core/skills/skill-runtime.ts:186-189` — `loadRoleSkill` recusa papel desconhecido com erro explícito: `papel "${papelRaw}" não é um papel do harness`. Lista branca: `elicitador, analista, executor, avaliador, testador`.
- Skills de avaliação (`avaliador-*`, `analista`, `elicitador`, `testador`): todas declaram `ferramentas: []` e `permissoes.escrever: nunca`.
- Skills de execução (`executor-*`): únicas com ferramentas e permissão de escrita, conforme desenho do harness.
- Skill `conferente-macrobrief` (nova, D-M9): `ferramentas: []`, `escrever: nunca`, papel `conferente` — **NOTA:** esta skill usa papel `conferente` que NÃO está na lista branca de `skill-runtime.ts:188`. Se carregada via `loadRoleSkill`, falhará. Porém, a orquestração atual chama `runConferenteMacrobriefSkill` diretamente no intake-engine (função interna), não via `loadRoleSkill`. Portanto, não há risco em runtime.

**Recomendação:** Adicionar `"conferente"` à lista branca de `skill-runtime.ts:188` quando a skill for usada via `loadRoleSkill` no futuro.

---

## Frente 8 — npm audit + portas/digest do compose

**Veredito:** ✅ ACEITO COM RESSALVA

**Evidência:**
- `docker-compose.yml` — todas as portas vinculadas a `127.0.0.1`:
  - nextcode-app: `127.0.0.1:3001:3001`
  - nextcode-omniroute: `127.0.0.1:20128:20128`
  - nextcode-freellmapi: `127.0.0.1:3100:3001`
- Imagens fixadas por digest SHA256:
  - omniroute: `sha256:b08a12e876baa8a5ccadd1ebbe346fe7267dba3b1c9f4fd6bb02070fae41ab6c`
  - freellmapi: `sha256:7d0334cb683aa693d3743549da914bf8500aaf3cdc091c73b5b508c21c7b4aab`
- `npm audit --omit=dev`: bloqueado pela rede do ambiente sandbox (HTTP 403). **Ressalva:** verificação de vulnerabilidades de produção requer execução local pelo fundador.

**Conclusão:** Portas seguras (loopback only), imagens com digest fixo. npm audit pendente de execução local.

---

## Frente 9 — Travas que afrouxaram (E5-D2 e E5-D21)

**Veredito:** ✅ ACEITO COM RESSALVA

**E5-D2 (só reprova com prova):**
- `delivery-diagnosis.ts:46` — `splitDefectsByEvidence`: defeitos `critico` (segurança/dinheiro) entram em `bloqueiam` MESMO sem teste reproduzido (`d.defeito.startsWith("revisão final [critico]")`).
- Defeitos `importante` sem prova viram `leitura` (ressalva), não bloqueiam.
- **Cenário de risco:** defeito crítico identificado apenas por leitura (sem bancada) BLOQUEIA a entrega. Isso é correto para segurança/dinheiro. Para outros tipos de defeito crítico sem prova possível (ex.: tela), a entrega fica bloqueada até que alguém prove ou desclassifique.

**E5-D21 (discordância na última tentativa):**
- `node-executor.ts:1956-1961` — na última tentativa (`wouldReachBlockThreshold`), se o avaliador aprova e só o teste de aceite falha (`falhas.length === 0`), a etapa NÃO trava: vai com ressalva e a revisão final decide.
- Se houver outras falhas além dos testes de aceite, os testes de aceite são somados às falhas normais.
- **Cenário de risco:** se o teste de aceite estiver errado (falso positivo) e o código estiver correto, a etapa segue com ressalva na última tentativa. A revisão final (com código real e bancada) é a barreira definitiva.

**Ressalva:** Recomenda-se que o prompt do avaliador final (J3) marque qualquer violação de segurança/cripto como `"critico"` para garantir que E5-D2 a capture mesmo sem teste.

---

## Resumo das Frentes

| Frente | Veredito | Observação |
|--------|----------|------------|
| 5 (T7 dados) | ✅ ACEITO | Só nome+tema sai; anti-SSRF ativo |
| 7 (Skills) | ✅ ACEITO | Papel desconhecido recusado; conferente via função interna |
| 8 (npm/portas) | ✅ ACEITO COM RESSALVA | Portas loopback, digest fixo; npm audit requer execução local |
| 9 (E5-D2/D21) | ✅ ACEITO COM RESSALVA | Crítico sem prova bloqueia; discordância última tentativa segue com ressalva |

## Desvios do Prompt

Nenhum desvio. As frentes foram verificadas por leitura de código e evidência colada, conforme R3.

## Checklist das Travas

- [x] T-A: escopo verificado
- [x] R1: apenas este relatório criado
- [x] R2: veredito + evidência por item
- [x] R3: só dado colado
- [x] T-F: prisma/dev.db intocado (23/10/2026 18:29:41)
- [x] T-G: nenhum segredo exposto
