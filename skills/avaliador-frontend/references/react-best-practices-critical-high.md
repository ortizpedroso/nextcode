<!-- Origem: https://github.com/vercel-labs/agent-skills | Arquivo: skills/react-best-practices/SKILL.md | Commit: 063bee94c3f4df8453406c830b0a7df0f2860278 | Licença: MIT -->

# React Best Practices — Regras `CRITICAL` e `HIGH` (22 Regras)

## Prioridade 1 — Eliminating Waterfalls (`CRITICAL` — 6 regras)
1. **`async-cheap-condition-before-await`**: Avalie condições síncronas/locais antes de disparar `await` de I/O.
2. **`async-defer-await`**: Mova `await` para dentro das ramificações onde o resultado é efetivamente usado.
3. **`async-parallel`**: Use `Promise.all()` para operações assíncronas independentes.
4. **`async-dependencies`**: Inicie Promises independentes imediatamente e dê `await` apenas quando necessário.
5. **`async-api-routes`**: Em Route Handlers e Server Actions, inicie Promises cedo e dê `await` o mais tarde possível.
6. **`async-suspense-boundaries`**: Use `<Suspense>` para streaming de conteúdo lento sem bloquear o layout.

## Prioridade 2 — Bundle Size Optimization (`CRITICAL` — 6 regras)
7. **`bundle-barrel-imports`**: Importe diretamente dos módulos de origem; evite barrel files gigantes.
8. **`bundle-analyzable-paths`**: Nunca construa caminhos de `import()` dinâmicos opacos ao bundler.
9. **`bundle-dynamic-imports`**: Use `next/dynamic` para componentes pesados fora da pintura inicial.
10. **`bundle-defer-third-party`**: Carregue scripts não críticos de terceiros após a hidratação.
11. **`bundle-conditional`**: Carregue módulos pesados sob demanda apenas quando a feature é ativada.
12. **`bundle-preload`**: Faça preload em hover/focus para rotas/componentes pesados acionados pelo usuário.

## Prioridade 3 — Server-Side Performance (`HIGH` — 10 regras)
13. **`server-auth-actions`**: Autentique e valide inputs dentro de cada Server Action como em rota pública.
14. **`server-cache-react`**: Use `React.cache()` para deduplicação por requisição em Server Components.
15. **`server-cache-lru`**: Use cache LRU controlado apenas quando seguro entre requisições.
16. **`server-dedup-props`**: Evite passar objetos grandes duplicados em props Server -> Client.
17. **`server-hoist-static-io`**: Mova I/O estático e schemas para fora do render por requisição.
18. **`server-no-shared-module-state`**: Proibido usar estado mutável em escopo de módulo para dados de requisição/usuário (`critico`).
19. **`server-serialization`**: Minimize dados serializados na fronteira Server -> Client Component.
20. **`server-parallel-fetching`**: Busque dados em paralelo em componentes Server irmãos.
21. **`server-parallel-nested-fetching`**: Encadeie buscas aninhadas independentes em paralelo.
22. **`server-after-nonblocking`**: Use `after()` para operações não bloqueantes após responder.
