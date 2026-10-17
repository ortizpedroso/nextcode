# Perfil dos provedores — 17/10/2026

> Passo 0 do parêntese das skills (diário 95/106): antes de reescrever qualquer skill, saber como cada modelo se comporta **pela documentação oficial** e o que o NextCode **envia hoje**. Sem custo (só leitura). Nada de código ou skill alterado.
> Fontes: DeepSeek `api-docs.deepseek.com/guides/{json_mode,thinking_mode,tool_calls}`; Anthropic `platform.claude.com/docs/.../claude-prompting-best-practices` e `.../prompting-claude-opus-5`; NVIDIA model card `huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16`.

## 1. O que o NextCode envia hoje (código no HEAD `73663c4`)

| Caminho | Corpo enviado | Arquivo |
|---|---|---|
| FreeLLMAPI (executor, analista, avaliador Nemotron/DeepSeek) | só `model`, `messages`, `stream`, `max_tokens` | `src/core/llm/gateways.ts:218-223` |
| Elicitador (Opus 5.5 direto) | `model`, `max_tokens: 48000`, `stream: true`, `system`, `messages`; sem `effort` | `src/core/llm/elicitador-claude.ts:12,180-185` |
| Avaliador Claude direto | `max_tokens: 8000`, `system`, `messages`; modelo padrão `claude-sonnet-4-5-20250929` | `src/core/llm/evaluator-models.ts:203-218` |
| Ferramentas do executor | protocolo **em texto** ("EXATAMENTE UM bloco ```json acao") — não usa ferramentas nativas | `src/core/skills/executor-tool-loop.ts:168-193` |

Nenhum caminho usa: controle de raciocínio, `response_format` JSON, ferramentas nativas, saída estruturada.

## 2. Perfil por provedor

### 2.1 DeepSeek v4 pro (executor; via `custom/`)
- **Raciocínio ligado por padrão, esforço `high`.** Nós não mandamos nada → o executor já roda com raciocínio. Bom para código.
- **`temperature` não tem efeito** com raciocínio ligado (não dá erro, é ignorado).
- **JSON garantido existe** (`response_format: json_object`), com 3 exigências: a palavra "json" no prompt, um exemplo do formato e `max_tokens` folgado. **Aviso oficial: pode voltar vazio às vezes.**
- **Ferramentas nativas existem**, inclusive modo `strict` (beta, só em `api.deepseek.com/beta`: todo campo `required`, `additionalProperties: false`, sem `minLength`/`maxItems`). Com ferramentas + raciocínio, o `reasoning_content` tem de voltar em toda chamada seguinte, senão erro 400.
- **Leitura para as skills:** prompt direto, com exemplo do formato; o formato que hoje falha (relatório P12 inválido: 3 no teste real, 11 no B1 P4) é exatamente o caso que JSON garantido ou ferramenta nativa resolve no protocolo, não no texto da skill.

### 2.2 Claude Opus 5.5 (elicitador) e Claude como avaliador
- **Raciocínio sempre ligado** no Opus 5.5; o custo se controla por `effort` (low/medium/high/xhigh/max). Nós não mandamos `effort` → `high` (padrão).
- **Escopo:** o Opus 5 tende a **ampliar a tarefa** e aplicar o próprio juízo. A doc recomenda limitar o escopo explicitamente e "perguntar só quando leituras diferentes levam a trabalho diferente". Bate com o teste real: 4 "DÚVIDA" escritas na Spec em vez de perguntadas.
- **Não mandar "confira de novo"**: o Opus 5 já verifica sozinho; instrução extra de verificação gasta token sem ganho.
- **Respostas e documentos mais longos** que os modelos anteriores; controlar tamanho só por instrução explícita.
- **Linguagem agressiva** ("CRÍTICO: você DEVE…") faz o modelo exagerar; usar tom normal e explicar o porquê. Nossas skills têm 17 palavras em caixa alta desse tipo (contagem `grep`), pouco.
- **Revisão de código:** "só relate o grave" é obedecido ao pé da letra e esconde achado. Para o avaliador, pedir **tudo** e filtrar depois.
- **Pedir o raciocínio escrito pode ser recusado** (`reasoning_extraction`). Pedir "explicação curta da resposta".
- **Formato:** dizer o que fazer (não o que evitar); documentos primeiro e pergunta no fim (até 30% melhor em entradas longas); para JSON, a própria Anthropic indica **saída estruturada** ou ferramenta com schema, em vez de "responda só JSON".
- **Claude só direto na Anthropic** (no roteador dá 404 — medição 105).

### 2.3 NVIDIA Nemotron 3 Super 120B (avaliador gratuito; via `nvidia/`)
- **Raciocínio ligado por padrão**; controle por `chat_template_kwargs` (`enable_thinking`, `low_effort`) e `reasoning_budget`. Para agente de código a NVIDIA recomenda `force_nonempty_content: true`.
- **Amostragem recomendada: `temperature 1.0`, `top_p 0.95`** em tudo. Não mandamos → depende do padrão do servidor da NVIDIA.
- **Idiomas oficiais: inglês, francês, alemão, italiano, japonês, espanhol e chinês. Português não está na lista.** Nossas skills e prompts do avaliador são em português.
- **Sem modo JSON documentado.**
- Benchmarks oficiais: seguir instruções (IFBench 72,6; Multi-Challenge 55,2) abaixo do Qwen3.5-122B; forte em contexto longo (RULER 1M 91,8).

## 3. Consequências para o projeto (veredito)

1. **O maior ganho não está no texto das skills, está no protocolo.** Três falhas medidas são de formato — relatório P12 inválido (executor), JSON descartado → `EVALUATOR_UNAVAILABLE` (avaliador), JSON do analista não chega a tempo. Os três provedores oferecem forma oficial de garantir o formato (DeepSeek: `json_object`/ferramenta `strict`; Claude: saída estruturada/ferramenta). Hoje o `gateways.ts` não repassa nenhum desses campos. **Antes de mexer no texto, o harness precisa conseguir pedir formato garantido.**
2. **Desconhecido que precisa de prova (sem chute):** o FreeLLMAPI repassa `response_format`, `tools`, `thinking` e `chat_template_kwargs` para o `custom/` e o `nvidia/`? A documentação do provedor não responde isso; é preciso uma sonda de poucos tokens (custo ≈ 0) antes de qualquer decisão.
3. **Nemotron como avaliador ou analista em português é aposta fraca.** Português fora dos idiomas oficiais + instrução abaixo do concorrente. Isso reforça a mudança 15 (gratuito só no fim e não aprova sozinho) e pesa contra a ideia de "analista Nemotron" levantada antes. Se for usado, o prompt do papel deveria ser em inglês com saída em formato fixo — a medir no teste pesado, não assumir.
4. **Elicitador (Opus 5.5):** a skill deve limitar escopo e dizer quando perguntar × quando decidir, sem "verifique de novo". O modelo é o certo; o prompt é que precisa seguir o perfil.
5. **Avaliador Claude:** modelo padrão no código é `claude-sonnet-4-5-20250929` (antigo); o pedido "só relate o grave" deve ser evitado; o formato deve vir por saída estruturada.
6. **Achado lateral (registrar, não corrigir agora):** `src/app/api/chat/route.ts:783-784` usa `reasoning_content` como resposta quando `content` vem vazio — mostra ao usuário o raciocínio interno do modelo como se fosse a resposta. A doc da DeepSeek confirma que `content` vazio acontece no modo JSON.

## 4. Próximo passo proposto (decisão do fundador)

- **4a. Sonda de repasse (≈ US$ 0):** 1 chamada curta por provedor com `response_format`, `tools` e controle de raciocínio, para saber o que o FreeLLMAPI deixa passar. Sem isso, qualquer plano de protocolo é suposição.
- **4b.** Com o resultado, entra na §5.0 uma mudança de protocolo (formato garantido por papel) **antes** da reescrita das skills; depois os testes pesados (2 rodadas, com custo e OK).
