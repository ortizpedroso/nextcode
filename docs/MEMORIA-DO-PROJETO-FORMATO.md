---
name: project-memory
description: >
  Formato da memória do projeto (`.nextcode/MEMORY.md`). NÃO é um papel carregado pelo harness: a memória
  é escrita por código (`consolidateMemoryFromSpec` em `src/core/memory/project-memory.ts`) ao aprovar a Spec.
  Este arquivo documenta o formato para quem lê ou edita a memória à mão.
tipo: documentacao (não é skill; antes ficava em skills/project-memory/SKILL.md)
---

# Memória do projeto (`.nextcode/MEMORY.md`) — formato

Escrita pelo harness, sem LLM, a partir da Spec aprovada. Antes ficava em `skills/project-memory/` e o carregador o transformava calado em "executor"; saiu de lá na mudança 44 (S3).

## Seções (sempre as 3, nesta ordem)
1. **Diretrizes e Regras do Fundador** — o que não se discute no projeto.
2. **Decisões de Arquitetura e Contratos** — stack, rotas, entidades, contratos entre módulos.
3. **Armadilhas e Lições Aprendidas** — o que já deu errado e como se evita.

## Tetos
- No máximo 50 linhas e 6.000 bytes. O teto é dividido entre as 3 seções; o que passar vira `(+N omitido(s) — ver a Spec)` na própria seção.
- Corte nunca é calado: se ainda sobrar, a última linha diz quantas linhas ficaram de fora.
