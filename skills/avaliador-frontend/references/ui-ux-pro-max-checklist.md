<!-- Origem: ui-ux-pro-max (plugin local v2.11.0) | Arquivo: .claude/skills/ui-ux-pro-max/references/pro-rules.md | Versão: 2.11.0 | Licença: MIT -->

# UI/UX Pro Max — Pre-Delivery Checklist (32 Itens Adaptados para Web)

## Process & Craft (6)
- [ ] Hierarquia reconhecível de produto.
- [ ] Cobertura dos 4 estados: Loading, Empty, Error e Success.
- [ ] Orçamento de complexidade: máx. 2 famílias de fonte e 1 cor de destaque principal por superfície.
- [ ] Orçamento de movimento: máx. 1 transição coordenada por seção; zero loops decorativos em telas operacionais.
- [ ] Proibido usar emojis como ícones de UI (usar SVGs consistentes).
- [ ] Feedback visual imediato em ações (`active:scale-[0.98]`, estado `loading`, `aria-live`).

## Visual Quality (5)
- [ ] Ícones da mesma família, `stroke-width` e viewBox (`20x20` ou `24x24`).
- [ ] SVGs/imagens nítidas sem distorção de aspect-ratio.
- [ ] Superfícies sólidas para leitura (sem empilhar múltiplos `backdrop-blur` ilegíveis).
- [ ] Elevação consistente (em dark mode, diferenciar por luminosidade de superfície e borda sutil).
- [ ] Alinhamento óptico de ícones e textos em botões e inputs.

## Interaction & Ergonomics (6)
- [ ] Alvos de toque mínimos de `44x44px` em mobile (`375x812`).
- [ ] Ações primárias visíveis e alcançáveis em mobile.
- [ ] Estados completos: `default`, `hover`, `focus-visible`, `active`, `disabled`.
- [ ] Botão de submit desabilitado/loading durante mutação em voo.
- [ ] Toda interação por gesto possui alternativa por botão clicável.
- [ ] Navegação previsível com `<Link>`/`<a>` e suporte ao botão Voltar.

## Light / Dark Mode & Color (5)
- [ ] Contraste WCAG AA (`4.5:1` texto normal, `3:1` texto grande e controles).
- [ ] Evitar preto puro `#000000` com texto `#FFFFFF` puro em grandes áreas.
- [ ] Tokens semânticos (`bg-background`, `text-foreground`, `border-border`).
- [ ] Cores de status (erro, sucesso, alerta) legíveis em light e dark mode.
- [ ] Bordas e divisores visíveis em ambos os temas.

## Layout & Spacing (6)
- [ ] Ritmo espacial em múltiplos de `4px`/`8px`.
- [ ] Padding horizontal mínimo de `16px` (`px-4`) em mobile (`375px`).
- [ ] Largura de texto corrido entre `60ch` e `75ch`.
- [ ] Sem sobreposição ou scroll horizontal acidental entre `1440px` e `375px`.
- [ ] Cards na mesma linha com alinhamento consistente.
- [ ] Barras fixas não encobrem conteúdo nem botões de ação.

## Accessibility (4)
- [ ] Tamanhos de fonte em `rem` sem cortar texto em contêineres de altura fixa.
- [ ] Ordem lógica de foco via `Tab`.
- [ ] Controles anunciam nome, `role` e estado (`aria-*`).
- [ ] Respeito a `prefers-reduced-motion: reduce`.
