/**
 * Conteúdo da skill /graphify adaptado para instalação automática no projeto do usuário
 * pelo fluxo de telemetria "Instalar e Rodar graphify" (botão inline no chat). É uma
 * versão condensada da skill original (~/.claude/skills/graphify/SKILL.md), documentando
 * apenas o caminho rápido (AST-only, sem LLM) que o NextCode já executou automaticamente
 * — o pipeline completo (docs/papers/imagens, labels semânticas, exports extras) continua
 * disponível via CLI manual para quem instalar o pacote `graphifyy` e quiser ir além.
 */
export const GRAPHIFY_SKILL_CONTENT = `---
name: graphify
description: "Transforma o código do projeto em um grafo de conhecimento navegável (graphify-out/graph.json, GRAPH_REPORT.md e, quando possível, graph.html). Use para perguntas sobre arquitetura, dependências entre arquivos, módulos centrais ('god nodes') ou visão geral de um projeto grande/desconhecido."
---

# /graphify

Esta skill foi instalada automaticamente pelo NextCode (Telemetria "graphify") a partir do
pedido do usuário no chat. Ela já foi executada uma vez em modo automático (caminho rápido,
código-apenas, sem LLM) sobre a pasta do projeto, gerando em \`graphify-out/\`:

- \`graph.json\` — grafo completo (nós = arquivos/símbolos, arestas = relações estruturais extraídas via AST), pronto para consumo por ferramentas de GraphRAG.
- \`GRAPH_REPORT.md\` — relatório em linguagem natural: comunidades detectadas, nós centrais ("god nodes"), conexões surpreendentes entre módulos.
- \`graph.html\` (melhor esforço) — visualização interativa, quando o binário \`graphify\` suporta exportação HTML no ambiente.

## Quando esta skill faz sentido

- O usuário pergunta "como esse projeto está organizado?", "quais módulos dependem de quais?", "onde fica a lógica de X?" em uma base de código grande ou pouco familiar.
- Antes de uma refatoração ampla, para identificar módulos com alto acoplamento ("god nodes").
- Onboarding em um projeto existente sem documentação de arquitetura atualizada.

Não faz sentido para perguntas pontuais sobre um único arquivo já aberto, ou tarefas de
implementação direta sem necessidade de mapear a base inteira.

## Limitações do modo automático já executado

O NextCode roda apenas a extração estrutural (AST, determinística, sem custo de LLM) —
o mesmo caminho que a skill original do graphify documenta para corpora 100% código. Isso
significa:

- Rótulos de comunidade ficam como "Community 0", "Community 1", etc. (não há nomeação
  semântica em linguagem natural, que exigiria uma chamada de LLM adicional).
- Arquivos de documentação, PDFs, imagens e vídeo do projeto NÃO são incorporados ao grafo
  neste modo — apenas código-fonte.

## Para ir além (uso manual via CLI)

Com o pacote \`graphifyy\` instalado (o NextCode já tentou instalá-lo via pip ao rodar esta
skill), é possível rodar manualmente no terminal, dentro da pasta do projeto:

\`\`\`bash
graphify query "<pergunta sobre o código>"      # consulta o grafo já construído
graphify path "ModuloA" "ModuloB"               # caminho mais curto entre dois conceitos
graphify explain "NomeDoSimbolo"                # explicação em linguagem natural de um nó
graphify <caminho> --mode deep                  # reextração mais rica (INFERRED edges)
graphify <caminho> --update                     # reextrai apenas arquivos novos/alterados
graphify export html                            # (re)gera a visualização HTML interativa
graphify export obsidian                        # gera um vault Obsidian navegável
\`\`\`

Para incorporar documentação/papers/imagens com rotulagem semântica real, é necessário um
host capaz de despachar subagentes (ex.: Claude Code) seguindo a skill original completa,
ou configurar \`GEMINI_API_KEY\`/\`GOOGLE_API_KEY\` para extração semântica via Gemini.
`;
