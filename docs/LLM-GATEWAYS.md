# Gateways de LLM

> Decisão D3 (revisada em 05/10/2026): ver `docs/ARQUITETURA-ORQUESTRACAO.md` §D3.

## Princípio

O NextCode **não roteia entre provedores**. Quem faz isso são os gateways, que já resolvem o
problema melhor do que o nosso router fazia: fallback entre provedores, cooldown por chave,
controle de cota e catálogo de modelos atualizado.

O NextCode só faz três coisas:

1. escolhe o gateway pela ordem configurada;
2. classifica a falha (mesma taxonomia do opencode, `packages/opencode/src/session/retry.ts`) e
   passa ao próximo gateway;
3. registra qual modelo realmente respondeu (`X-Routed-Via`) na telemetria
   (`llm.gateway_call` / `llm.gateway_failure`).

## Ordem de uso

| # | Rota | Papel |
|---|---|---|
| 1 | **FreeLLMAPI** (`http://localhost:3100/v1`) | Primária. 34 provedores gratuitos, fallback com cooldown e cota por chave, `X-Routed-Via` em toda resposta. |
| 2 | **OmniRoute** (`http://localhost:20128/v1`) | Secundária. Útil para provedores com assinatura/credencial própria configurados no painel dele. |
| 3 | Chaves BYOK diretas (Groq, NVIDIA, DeepSeek, Gemini) | Último recurso, código legado do router. |

A ordem e a ativação de cada gateway ficam em **Configurações → Gateways LLM** (tabela `LlmGateway`).
FreeLLMAPI só entra na rota com a chave unificada salva.

## Classificação de falha

| Resposta do gateway | Tipo | O que o NextCode faz |
|---|---|---|
| Conexão recusada / DNS | `network` | marca o gateway como fora por 15 s e passa ao próximo |
| Sem resposta no prazo | `timeout` | passa ao próximo |
| 401 / 403 | `auth` | passa ao próximo; o diagnóstico mostra "chave inválida" |
| 402 / 429 / 5xx | `exhausted` | passa ao próximo (o gateway já esgotou o próprio fallback) |
| 400 / 404 / 413 / 422 | `bad_request` | passa ao próximo; o diagnóstico mostra "modelo recusado" |

Nenhuma nova tentativa no mesmo gateway: ele já tentou todos os provedores dele.

## Diagnóstico ("verde" significa que funciona)

`POST /api/llm/health` (botão **Diagnosticar**) faz, para cada gateway:

1. ping (`/api/ping` no FreeLLMAPI, `/api/health` no OmniRoute);
2. `GET /v1/models` com a chave → separa "fora do ar" de "chave inválida";
3. **uma conversa real** com o modelo configurado (`max_tokens: 16`).

Só a etapa 3 deixa o gateway "Pronto". Cada falha vem com a ação para resolver.

## Modelos

| Gateway | Rápido (chat, DAG) | Pesado |
|---|---|---|
| FreeLLMAPI | `auto` (estratégia balanced: confiabilidade primeiro) | `auto:smart` |
| OmniRoute | vazio = cascata do router (`OMNIROUTE_MODEL` → modelos verificados → combos `auto/*`) | idem |

No OmniRoute, preencher o modelo em Configurações fixa um **modelo exato** (recomendado: os combos
gratuitos `auto/*` dependem de provedores que mudam sem aviso).

## Subir e configurar

```bash
docker compose up -d freellmapi omniroute
```

1. Abra http://localhost:3100, crie a conta (o setup é liberado para o navegador desta máquina).
2. Em **Keys**, cadastre chaves gratuitas dos provedores (Groq, Google AI Studio, Cerebras,
   OpenRouter, Mistral, NVIDIA...). Quanto mais provedores, mais cota.
3. Copie a **chave unificada** (cabeçalho da página Keys) para **Configurações → Gateways LLM →
   FreeLLMAPI** e clique em **Salvar e testar**.
4. OmniRoute (opcional): gere uma API key em http://localhost:20128, salve e defina um modelo exato.

O FreeLLMAPI guarda as chaves cifradas com `ENCRYPTION_KEY` de `.env.freellmapi` (fora do git).
Perder esse arquivo = recadastrar as chaves.

## Container `nextcode-app`

Fica no perfil `app` do compose e **não sobe** com `docker compose up`. Ele monta o mesmo
`prisma/dev.db` do `npm run dev`; rodar os dois juntos coloca dois workers de fila no mesmo banco.
