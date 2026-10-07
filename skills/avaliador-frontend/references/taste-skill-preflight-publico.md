<!-- Origem: https://github.com/Leonxlnx/taste-skill | Arquivo: skills/taste-skill/SKILL.md (Seções 13 e 14) | Commit: e3c92037548e3e49bea8e6b906c99a8549654e71 | Licença: MIT -->

# Taste-Skill — Extrato de Pré-Voo para Páginas Públicas (39 de 63 Itens)

> **PROIBIDO aplicar em dashboards, painéis administrativos, tabelas de dados ou wizards multi-etapas (Seção 13 `OUT OF SCOPE`).**
> Aplicar exclusivamente quando `aplicar_taste_skill_publico === true` (landing pages e páginas públicas de etapa única).

## Core Quality (16 itens)
1. Identidade visual alinhada à proposta da página pública.
2. Intensidade de movimento proporcional ao pedido na Spec.
3. Densidade visual de página pública com respiro generoso entre seções.
4. Server Components por padrão; `"use client"` isolado nas folhas interativas.
5. Ícones de destaque com envoltório visual consistente.
6. Sombras ambientais sutis em vez de sombra preta pesada.
7. Tipografia fluida e hierárquica no Hero.
8. Largura de leitura (`60ch-70ch`) nos subtítulos e blocos de texto.
9. Fundo neutro calibrado, alto contraste e 1 cor de acento primária para o CTA.
10. Zero gradientes roxo/azul neon genéricos ("AI slop") não pedidos.
11. Estados vazios, de erro e de loading nos formulários públicos.
12. Zero imagens quebradas ou placeholders banidos.
13. Zero erros de hidratação SSR (`Math.random()` / `new Date()` no render).
14. Responsividade mobile (`375px`) em 1 coluna sem corte nem vazamento horizontal.
15. Feedback visual e foco visível em todos os CTAs e links.
16. Zero texto falso ("Lorem ipsum", "Acme Corp", "John Doe") não previsto na Spec.

## Anti-Bloat Scan (17 itens)
17. Evitar repetição monótona de cards genéricos sem hierarquia.
18. Sem badge falso "✨ Powered by AI" não pedido na Spec.
19. Sem prova social fabricada ("Joined by 10,000+ users") sem requisito.
20. Sem depoimentos inventados pelo modelo.
21. Sem faixa de logos falsos ("Trusted by...").
22. Sem gráficos SVG decorativos falsos sem dados.
23. Sem botões flutuantes extras não solicitados.
24. Sem menus inchados com links mortos (`href="#"`).
25. Sem popups automáticos de newsletter ao abrir a página.
26. Sem contadores regressivos falsos (dark pattern).
27. Sem excesso de tags coloridas competindo com o CTA principal.
28. Sem múltiplos blobs animados pesados no fundo.
29. Sem parágrafos longos (`>3` linhas) centralizados.
30. Sem bordas neon grossas em todos os cards.
31. Sem mistura de famílias de ícones distintas.
32. Sem campos extras não solicitados no formulário de conversão/checkout.
33. Sem rodapé gigante com links fictícios.

## Motion Quality (6 itens — apenas quando animação for solicitada)
34. Animar apenas `transform` e `opacity`.
35. Respeitar `prefers-reduced-motion`.
36. `stagger <= 80ms` sem atrasar leitura do CTA.
37. Cleanup correto de observers/listeners em `useEffect`.
38. Zero bibliotecas pesadas de animação para efeitos simples de CSS.
39. Em página de checkout, zero distrações de movimento ao redor do pagamento.
