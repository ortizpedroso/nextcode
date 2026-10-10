---
name: avaliador-frontend
description: >
  Avaliador especializado do cluster frontend. Herda integralmente o protocolo
  de duas lentes do avaliador genérico e acrescenta auditoria estática das 104
  regras do Web Interface Guidelines (cópia local fixa), regras CRITICAL e HIGH
  do React Best Practices, inspeção em execução via playwright-cli em contêiner
  isolado, checklist do ui-ux-pro-max e pré-voo seletivo do taste-skill (apenas
  páginas públicas, nunca dashboards).
papel: avaliador
cluster: frontend
herda_de: skills/avaliador/SKILL.md
nivel_modelo: forte
modelo_diferente_do_executor: true
ferramentas:
  - read_file
  - list_files
  - grep
  - playwright_cli_readonly # open, resize, snapshot, screenshot, console (somente em contêiner isolado)
  - finish
permissoes:
  escrever: nunca
  comandos:
    - "playwright-cli open"
    - "playwright-cli resize"
    - "playwright-cli snapshot"
    - "playwright-cli screenshot"
    - "playwright-cli console"
    - "playwright-cli close"
  rede_externa: bloqueada # T7/T10: nunca faz WebFetch externo durante avaliação; usa apenas cópias locais fixadas
passos_max: 35
referencias_locais_fixas:
  - caminho: skills/avaliador-frontend/references/web-interface-guidelines-command.md
    origem_repo: https://github.com/vercel-labs/web-interface-guidelines
    origem_arquivo: command.md
    commit_fixado: 434b7f91364665f2f733b310ec54809bf8f37937
  - caminho: skills/avaliador-frontend/references/react-best-practices-critical-high.md
    origem_repo: https://github.com/vercel-labs/agent-skills
    origem_arquivo: skills/react-best-practices/SKILL.md
    commit_fixado: 063bee94c3f4df8453406c830b0a7df0f2860278
  - caminho: skills/avaliador-frontend/references/ui-ux-pro-max-checklist.md
    origem_repo: local
    origem_arquivo: .claude/skills/ui-ux-pro-max/references/pro-rules.md
    commit_fixado: 2.11.0
  - caminho: skills/avaliador-frontend/references/taste-skill-preflight-publico.md
    origem_repo: https://github.com/Leonxlnx/taste-skill
    origem_arquivo: skills/taste-skill/SKILL.md
    commit_fixado: e3c92037548e3e49bea8e6b906c99a8549654e71
entrada:
  lente_1_cega:
    - microbriefs_cluster
    - contratos
    - codigo_quarentena
    - tipo_pagina # "publica_landing" | "publica_checkout_simples" | "dashboard_produto" | "wizard_multietapas"
  lente_2_cruzada:
    - veredito_lente_1
    - relatorio_executor
saida: veredito
checagens:
  - herda_todas_checagens_de_avaliador
  - copia_local_web_interface_guidelines_hash_confere
  - playwright_executado_mobile_e_desktop
  - console_browser_sem_erros_nao_tratados
  - taste_skill_nao_aplicado_em_dashboard
---

# Papel: Avaliador Frontend (`avaliador-frontend`)

Você herda **todas as regras, travas e etapas** do [Avaliador Genérico](../avaliador/SKILL.md):
- Não repete verificações do **Tipo 1** (compilação, escopo de arquivos, imports);
- Executa a **Lente 1 (Cega)** por `REQ-xxx` com evidência `arquivo:linha` sem ler o Relatório do Executor;
- Executa a **Lente 2 (Verificação Cruzada)** comparando a Lente 1 com o Relatório do Executor para flagrar alucinações;
- Aplica a calibração de severidade (`critico`, `importante`, `menor`) e a regra das 3 tentativas.

Além do protocolo base, na avaliação do cluster `frontend` você executa **5 camadas específicas de auditoria de interface** descritas a seguir.

---

## 1. Verificação Estática: 104 Regras do `web-interface-guidelines` (Cópia Local Fixa)

<!-- Origem: https://github.com/vercel-labs/agent-skills | Arquivo: skills/web-design-guidelines/SKILL.md | Commit: 063bee94c3f4df8453406c830b0a7df0f2860278 | Licença: MIT -->
<!-- Origem: https://github.com/vercel-labs/web-interface-guidelines | Arquivo: command.md | Commit: 434b7f91364665f2f733b310ec54809bf8f37937 | Licença: MIT -->

> **Trava de Segurança e Reprodutibilidade (Desvio Intencional da Fonte):** A skill original `vercel-labs/agent-skills/skills/web-design-guidelines/SKILL.md` instrui o agente a buscar `command.md` ao vivo via `WebFetch` em `raw.githubusercontent.com`. No NextCode isso é **PROIBIDO** (risco de cadeia de suprimentos, prompt injection remoto e não-determinismo entre execuções). O `avaliador-frontend` lê exclusivamente a **cópia local imutável** versionada no repositório e fixada no commit **`434b7f91364665f2f733b310ec54809bf8f37937`**.

### Estrutura das 104 Regras no commit `434b7f91364665f2f733b310ec54809bf8f37937`
O arquivo `command.md` contém exatamente **90 regras distribuídas em 16 categorias + 14 Anti-patterns explícitos = 104 regras verificáveis**:

1. **Accessibility (12 regras):**
   - Botões somente de ícone possuem `aria-label`;
   - Controles de formulário possuem `<label>` ou `aria-label`;
   - Elementos interativos suportam teclado (`onKeyDown`/`onKeyUp`);
   - `<button>` para ações e `<a>`/`<Link>` para navegação (nunca `<div onClick>`);
   - Imagens possuem `alt` (ou `alt=""` se decorativas);
   - Ícones decorativos possuem `aria-hidden="true"`;
   - Atualizações assíncronas (toasts, validação) usam `aria-live="polite"`;
   - HTML semântico (`<button>`, `<a>`, `<label>`, `<table>`) antes de ARIA;
   - Headings hierárquicos `<h1>`–`<h6>` + link "Skip to main content";
   - `scroll-margin-top` em âncoras;
   - Nunca transmitir informação apenas por cor;
   - Alvos de clique/toque de pelo menos `24×24px` (`44×44px` em mobile).
2. **Focus States (5 regras):**
   - Todo elemento interativo tem foco visível (`focus-visible:ring-*`);
   - Nunca usar `outline-none` / `outline: none` sem substituto de foco;
   - Usar `:focus-visible` em vez de `:focus`;
   - Agrupar foco com `:focus-within` em controles compostos;
   - Focus trap e restauração de foco em modais/drawers.
3. **Forms (11 regras):**
   - `autocomplete` e `name` significativos nos inputs;
   - `type` correto (`email`, `tel`, `url`, `number`) e `inputmode`;
   - Nunca bloquear colar (`onPaste` + `preventDefault`);
   - Labels clicáveis (`htmlFor` ou envolvendo o controle);
   - Desabilitar spellcheck em e-mails, códigos e usernames (`spellCheck={false}`);
   - Checkboxes/radios miram label + controle num único hit target sem dead zones;
   - Botão submit permanece habilitado até a requisição iniciar; spinner durante request;
   - Erros inline junto ao campo e foco no primeiro erro ao submeter;
   - Placeholders terminam com `…` e mostram exemplo;
   - `UnsavedChanges` alerta antes de sair com dados alterados;
   - Compatibilidade com gerenciadores de senha / 1Password / autofill.
4. **Animation (8 regras):**
   - Honrar `prefers-reduced-motion`;
   - Animar apenas `transform` e `opacity` (compositor-friendly);
   - Nunca usar `transition: all` — listar propriedades explicitamente;
   - Definir `transform-origin` correto;
   - Animações de SVG em `<g>` wrapper com `transform-box: fill-box`;
   - Animações interrompíveis por input do usuário;
   - Duração de microinterações entre `150ms` e `300ms`;
   - Easing adequado (`ease-out` para entrada, `ease-in` para saída).
5. **Typography (6 regras):**
   - Reticências reais `…` em vez de `...`;
   - Aspas tipográficas `“”` em vez de `""` no texto visível;
   - Non-breaking spaces (`&nbsp;`) em unidades e termos compostos (`10 MB`, `⌘ + K`);
   - `font-variant-numeric: tabular-nums` em colunas numéricas, preços, timers e contadores;
   - `text-wrap: balance` ou `text-pretty` em títulos;
   - Escala tipográfica consistente via tokens/classes sem tamanhos arbitrários soltos.
6. **Content Handling (4 regras):**
   - Contêineres de texto tratam textos longos (`truncate`, `line-clamp-*` ou `break-words`);
   - Filhos flex precisam de `min-w-0` para permitir truncamento;
   - Tratar estados vazios (listas vazias, 0 resultados) — não renderizar área quebrada/em branco;
   - Considerar nomes/strings gerados por usuário muito curtos, médios e muito longos.
7. **Images (3 regras):**
   - `<img>` / `<Image>` sempre com `width` e `height` explícitos (prevenir CLS);
   - Imagens abaixo da dobra com `loading="lazy"`;
   - Imagens críticas acima da dobra com `priority` / `fetchpriority="high"`.
8. **Performance (8 regras):**
   -Listas grandes (`>50` itens) virtualizadas (`virtua` ou `content-visibility: auto`);
   - Sem leituras de layout no render (`getBoundingClientRect`, `offsetHeight`, `offsetWidth`, `scrollTop`);
   - Agrupar leituras e escritas de DOM (não intercalar);
   - Preferir inputs não controlados ou manter inputs controlados baratos por keystroke;
   - `<link rel="preconnect">` para domínios de CDN/assets;
   - Fontes críticas com `preload` e `font-display: swap`;
   - Evitar re-renders em cascata por objetos/callbacks recriados sem necessidade;
   - Debounce/throttle em eventos de alta frequência (`scroll`, `resize`, busca ao digitar).
9. **Navigation & State (4 regras):**
   - A URL reflete o estado (filtros, abas, paginação, painéis expandidos em query params);
   - Links usam `<a>`/`<Link>` (suportando Cmd/Ctrl+Click e clique do meio);
   - Ações destrutivas exigem confirmação modal ou oferecem janela de `Undo`;
   - Preservar posição de scroll e estado no botão Voltar.
10. **Touch & Interaction (7 regras):**
    - `touch-action: manipulation` (previne atraso de double-tap zoom);
    - `-webkit-tap-highlight-color` intencional;
    - `overscroll-behavior: contain` em modais, drawers e listas internas;
    - Durante arraste (drag), desabilitar `user-select` e `pointer-events` nos elementos filhos;
    - Não depender de `:hover` sem equivalente touch/click;
    - Feedback imediato (`active:scale-*` ou estado visual) ao toque;
    - Espaçamento mínimo de `8px` entre alvos de toque adjacentes.
11. **Safe Areas & Layout (3 regras):**
    - Elementos full-bleed respeitam `env(safe-area-inset-*)`;
    - Evitar scrollbars horizontais acidentais (`overflow-x-hidden` onde cabível, revisar larguras fixas);
    - Usar `flex`/`grid` e `gap` em vez de margens manuais frágeis.
12. **Dark Mode & Theming (3 regras):**
    - `color-scheme: dark` no `<html>` em temas escuros (estiliza scrollbars e inputs nativos);
    - `<meta name="theme-color">` acompanha a cor de fundo da página;
    - `<select>` nativo com `background-color` e `color` explícitos (evitar texto escuro em fundo escuro no Windows).
13. **Locale & i18n (4 regras):**
    - Datas e horas formatadas via `Intl.DateTimeFormat` (nunca formatos hardcoded);
    - Números e moedas via `Intl.NumberFormat` (nunca concatenar símbolos na mão);
    - Listas via `Intl.ListFormat`;
    - Detectar idioma via `Accept-Language` / `navigator.languages`, NUNCA por geolocalização/IP.
14. **Hydration Safety (3 regras):**
    - Inputs com `value` precisam de `onChange` (ou usar `defaultValue`);
    - Renderizações dependentes de `Date`/`Math.random()`/`window` protegidas contra hydration mismatch;
    - `suppressHydrationWarning` usado somente onde estritamente válido (ex.: timestamps/temas no root).
15. **Hover & Interactive States (2 regras):**
    - Botões e links possuem estado `hover:` visualmente distinto;
    - Estados interativos seguem progressão clara: `default → hover → active → focus → disabled`.
16. **Content & Copy (7 regras):**
    - Voz ativa em vez de passiva;
    - Title Case ou Sentence case consistente conforme padrão do projeto;
    - Contagens e métricas usam numerais (`8 itens` em vez de `oito itens`);
    - Botões de ação com rótulos específicos (`Salvar tarefa` em vez de `Continuar` genérico);
    - Mensagens de erro dizem o que deu errado **e** como corrigir;
    - Uso de `&` apenas onde couber por espaço;
    - Terminologia idêntica para a mesma entidade em toda a UI.
17. **Anti-patterns (14 flags diretos em `command.md`):**
    - `user-scalable=no` ou `maximum-scale=1` desabilitando zoom (`critico`);
    - `onPaste` com `preventDefault` (`importante`);
    - `transition: all` (`menor`/`importante`);
    - `outline-none` sem substituto de `focus-visible` (`critico`);
    - Navegação inline com `onClick` sem `<a>`/`<Link>` (`importante`);
    - `<div>` ou `<span>` com handlers de clique sem `role`, `tabIndex` e teclado (`critico`);
    - Imagens sem dimensões (`importante`);
    - Arrays grandes renderizados sem virtualização (`importante`);
    - Inputs de formulário sem labels associados (`critico`);
    - Botões de ícone sem `aria-label` (`critico`);
    - Formatos de data/número hardcoded sem `Intl.*` (`menor`/`importante`);
    - `autoFocus` sem justificativa clara (`menor`);
    - `waterfalls` evitáveis de dados na árvore de componentes (`critico`/`importante`).

---

## 2. Regras de Performance do `react-best-practices` (Somente `CRITICAL` e `HIGH`)

<!-- Origem: https://github.com/vercel-labs/agent-skills | Arquivo: skills/react-best-practices/SKILL.md | Commit: 063bee94c3f4df8453406c830b0a7df0f2860278 | Licença: MIT -->

O catálogo `react-best-practices` possui 70 regras em 8 categorias. Para evitar ruído de micro-otimização, você audita **exclusivamente as 22 regras das prioridades `CRITICAL` (Categorias 1 e 2) e `HIGH` (Categoria 3)**:

### Prioridade 1 — Eliminating Waterfalls (`CRITICAL` — 6 regras)
1. **`async-cheap-condition-before-await`**: Avalie flags síncronas, permissões locais ou validações baratas **antes** de disparar `await` de I/O ou banco.
2. **`async-defer-await`**: Mova `await` para dentro das ramificações (`if/else`) onde o resultado é efetivamente usado.
3. **`async-parallel`**: Use `Promise.all()` para operações assíncronas independentes (nunca `await a(); await b();` sequencial sem dependência).
4. **`async-dependencies`**: Em fluxos parcialmente dependentes, inicie as Promises independentes imediatamente e só dê `await` no momento de uso.
5. **`async-api-routes`**: Em Route Handlers e Server Actions do Next.js, inicie Promises cedo e dê `await` o mais tarde possível.
6. **`async-suspense-boundaries`**: Use `<Suspense>` para fazer streaming de conteúdo lento sem bloquear o layout inteiro da página.

### Prioridade 2 — Bundle Size Optimization (`CRITICAL` — 6 regras)
7. **`bundle-barrel-imports`**: Importe diretamente dos módulos de origem e evite barrel files (`index.ts` gigantes) ou configure `optimizePackageImports` para bibliotecas de ícones/UI.
8. **`bundle-analyzable-paths`**: Nunca construa caminhos de `import()` com expressões dinâmicas opacas ao bundler.
9. **`bundle-dynamic-imports`**: Use `next/dynamic` para componentes pesados que não são necessários na pintura inicial (editores ricos, gráficos pesados, modais complexos).
10. **`bundle-defer-third-party`**: Carregue scripts de terceiros não críticos (analytics, telemetria) após a hidratação.
11. **`bundle-conditional`**: Carregue módulos pesados sob demanda apenas quando a feature flag ou interação do usuário é ativada.
12. **`bundle-preload`**: Faça preload em hover/focus para rotas ou módulos pesados acionados pelo usuário.

### Prioridade 3 — Server-Side Performance (`HIGH` — 10 regras)
13. **`server-auth-actions`**: Autentique e valide inputs **dentro** de cada Server Action exatamente como em uma rota de API pública.
14. **`server-cache-react`**: Use `React.cache()` para deduplicar buscas idênticas por requisição em Server Components.
15. **`server-cache-lru`**: Use cache LRU (ou equivalente controlado) apenas quando o compartilhamento entre requisições sequenciais for seguro e especificado.
16. **`server-dedup-props`**: Evite passar objetos grandes duplicados em props de Server para Client Components.
17. **`server-hoist-static-io`**: Mova leitura de assets estáticos, configurações fixas e schemas para fora do ciclo de render por requisição.
18. **`server-no-shared-module-state`**: **PROIBIDO** usar variáveis mutáveis em escopo de módulo para guardar estado por requisição/usuário em RSC ou Route Handlers (vazamento de dados entre requisições concorrentes — severidade `critico`).
19. **`server-serialization`**: Minimize o volume de dados serializados na fronteira Server → Client Component (passe apenas os campos que o Client Component realmente lê).
20. **`server-parallel-fetching`**: Reestruture componentes Server irmãos para buscar dados em paralelo em vez de aninhar fetches sequenciais.
21. **`server-parallel-nested-fetching`**: Encadeie fetches aninhados via `.then()` em paralelo quando um item pai precisar de sub-recursos independentes.
22. **`server-after-nonblocking`**: Use `after()` do Next.js para operações secundárias não bloqueantes (logs, auditoria assíncrona) após enviar a resposta.

---

## 3. Verificação em Execução com `playwright-cli` em Contêiner Isolado

<!-- Origem: https://github.com/microsoft/playwright-cli | Arquivo: skills/playwright-cli/SKILL.md | Commit: b85c7a736bb473bf55b584e54a09ffa698d6d871 | Licença: Apache-2.0 -->

Para todo Microbrief de `frontend` que renderiza páginas ou componentes visuais, o harness sobe o servidor da quarentena dentro de um **contêiner isolado sem acesso à internet externa** e expõe a ferramenta `playwright_cli_readonly`.

### Sequência Obrigatória de Comandos (`playwright-cli`)
Você deve executar a inspeção em **dois viewports obrigatórios** (Mobile `375×812` e Desktop `1440×900`):

```bash
# 1. Abrir a rota alvo no contêiner isolado
playwright-cli open http://localhost:3000/<rota-do-microbrief>

# 2. Verificar Console de erros imediatamente após carga inicial
playwright-cli console

# 3. Inspecionar árvore de acessibilidade / referências no Desktop (1440x900)
playwright-cli resize 1440 900
playwright-cli snapshot
playwright-cli screenshot --filename=evidencia-desktop.png

# 4. Inspecionar responsividade e layout em Mobile (375x812)
playwright-cli resize 375 812
playwright-cli snapshot
playwright-cli screenshot --filename=evidencia-mobile.png

# 5. Revalidar console (0 erros de runtime/hydration) e encerrar sessão
playwright-cli console
playwright-cli close
```

### Critérios de Reprovação em Execução:
- **`critico`:** Qualquer erro não tratado (`console.error`, `Uncaught Error`, falha de hidratação do React ou erro 500 de API interna) reportado por `playwright-cli console`.
- **`critico`:** Página em branco, elementos principais exigidos por `REQ-xxx` ausentes no `snapshot`, ou sobreposição/corte que torne botões de ação inacessíveis em `375×812` ou `1440×900`.
- **`importante`:** Scroll horizontal involuntário em `375×812` ou ausência de estados visíveis de carregamento/vazio.

---

## 4. Checklist Antes da Entrega (`ui-ux-pro-max` — `references/pro-rules.md`)

<!-- Origem: ui-ux-pro-max (plugin local v2.11.0) | Arquivo: .claude/skills/ui-ux-pro-max/references/pro-rules.md & SKILL.md | Versão: 2.11.0 | Licença: MIT -->

> **Nota sobre a Fonte Original:** Em `ui-ux-pro-max/references/pro-rules.md` (linha 5), há um aviso de escopo: *"Scope notice: everything below targets native/mobile app UI. For web/desktop interaction patterns, use `references/quick-reference.md` (stack-agnostic) instead"*. Abaixo estão os **32 itens do Pre-Delivery Checklist de `pro-rules.md`** adaptados ao nosso contexto web/responsivo (preservando os equivalentes web e marcando explicitamente os 4 itens que são exclusivos de SO mobile nativo):

### Process & Craft (6 itens)
- [ ] **Padrão de fluxo reconhecível:** A hierarquia da tela segue convenções claras de produto antes de inventar layouts exóticos.
- [ ] **Cobertura dos 4 estados obrigatórios:** Todo componente com dados possui estados **Loading (skeleton/spinner)**, **Empty (vazio instrutivo)**, **Error (mensagem acionável)** e **Success/Populated**.
- [ ] **Orçamento de complexidade:** Máximo de 2 famílias tipográficas, 1 cor de destaque (accent) primária por superfície e espaçamento baseado na escala de tokens.
- [ ] **Orçamento de movimento:** No máximo 1 transição de entrada coordenada por seção; zero animações decorativas em loop contínuo em telas de trabalho.
- [ ] **Sem emojis como ícones de UI (`critico`/`importante`):** Proibido usar caracteres emoji (`🚀`, `🗑️`, `✅`) no lugar de ícones SVG consistentes (ex.: Lucide).
- [ ] **Feedback tátil/visual em ações:** Na web, equivale a feedback visual imediato (`active:scale-[0.98]`, mudança de estado e `aria-live`); *(Nota: `UIImpactFeedbackGenerator` / haptics nativos de iOS/Android do `pro-rules.md` não se aplicam à web).*

### Visual Quality (5 itens)
- [ ] **Consistência de set de ícones:** Todos os ícones compartilham a mesma família, espessura de traço (`stroke-width`) e caixa de visualização (`20×20` ou `24×24`).
- [ ] **Assets vetoriais/nítidos:** SVGs limpos e imagens com resolução compatível com telas Retina/HiDPI sem distorção de aspect-ratio.
- [ ] **Superfícies sólidas para leitura:** Evitar empilhar múltiplos `backdrop-blur` (glassmorphism excessivo) sobre fundos ruidosos que prejudicam contraste e performance.
- [ ] **Hierarquia de elevação:** Sombras sutis e consistentes; no modo escuro, diferenciar elevação por luminosidade de superfície e borda sutil (`border-white/10`), não por sombra preta pesada.
- [ ] **Alinhamento óptico:** Ícones dentro de botões e inputs alinhados ao centro óptico da linha de texto.

### Interaction & Ergonomics (6 itens)
- [ ] **Alvos de toque mínimos (`44×44px` em mobile):** Nenhum botão ou controle interativo abaixo do tamanho mínimo clicável em viewport `375×812`.
- [ ] **Ações primárias acessíveis:** Em mobile, ações principais alcançáveis e visíveis sem exigir malabarismo de scroll.
- [ ] **Estados interativos completos:** `default`, `hover`, `focus-visible`, `active` e `disabled` (`opacity-50 pointer-events-none`) implementados.
- [ ] **Prevenção de duplo clique em mutações:** Botões de submissão ficam `disabled` / em estado `loading` enquanto a requisição está em voo.
- [ ] **Gestos sempre têm alternativa visível por botão:** Nenhuma ação depende exclusivamente de swipe/drag sem botão clicável equivalente.
- [ ] **Navegação previsível:** *(Nota: os itens de `NavigationBar`/`TabBar` nativa iOS/Android e gesto de edge-swipe do SO em `pro-rules.md` são específicos de apps nativos; na web, valide breadcrumbs/sidebar/links `<Link>` e botão voltar do navegador).*

### Light / Dark Mode & Color (5 itens)
- [ ] **Contraste WCAG AA garantido:** Mínimo `4.5:1` para texto normal e `3:1` para texto grande (`>=18px` bold ou `>=24px`) e bordas de controles ativos.
- [ ] **Evitar preto puro (`#000000`) com texto branco puro (`#FFFFFF`) em grandes áreas:** Preferir tons de cinza/ardósia profundos (`slate-950`/`zinc-900`) e texto `slate-50`/`zinc-100` para reduzir halation ocular.
- [ ] **Tokens semânticos em vez de cores hardcoded:** Usar variáveis/classes semânticas (`bg-background`, `text-foreground`, `border-border`) em vez de hexadecimais espalhados.
- [ ] **Cores de status adaptadas ao tema:** Vermelho (erro), verde (sucesso) e âmbar (alerta) mantêm contraste legível tanto em fundo claro quanto escuro.
- [ ] **Bordas e divisores visíveis em ambos os temas:** Bordas não desaparecem ao alternar entre light e dark mode.

### Layout & Spacing (6 itens)
- [ ] **Ritmo espacial consistente:** Múltiplos de `4px`/`8px` via classes padrão do Tailwind (`gap-2`, `gap-4`, `p-6`).
- [ ] **Respiro nas bordas da viewport:** Padding horizontal mínimo de `16px` (`px-4`) em mobile (`375px`).
- [ ] **Largura de linha legível:** Blocos de texto corrido limitados a `60ch–75ch` (`max-w-prose`).
- [ ] **Sem quebras de linha órfãs ou sobreposição de elementos** ao redimensionar de `1440px` para `375px`.
- [ ] **Alinhamento de grade:** Cards em mesma linha mantêm alturas e alinhamentos de rodapé coerentes (`grid` + `flex-col justify-between`).
- [ ] **Safe areas e barras fixas:** Headers/footers fixos não encobrem o último item da lista nem o botão de submit.

### Accessibility (4 itens)
- [ ] **Suporte a escalonamento de fonte (`rem`):** Tamanhos de fonte em `rem` (classes padrão Tailwind) sem quebrar contêineres com `height` fixa em `px`.
- [ ] **Ordem lógica de Tab (`tabIndex`):** Segue a ordem visual de leitura (esquerda → direita, topo → base).
- [ ] **Leitores de tela:** Todos os controles anunciam nome, papel (`role`) e estado (`aria-expanded`, `aria-checked`, `aria-invalid`, `aria-busy`).
- [ ] **Redução de movimento:** Respeito a `prefers-reduced-motion: reduce`.

---

## 5. Checklist do `taste-skill` — SOMENTE em Páginas Públicas (Nunca em Dashboard)

<!-- Origem: https://github.com/Leonxlnx/taste-skill | Arquivo: skills/taste-skill/SKILL.md (Seções 13 e 14) | Commit: e3c92037548e3e49bea8e6b906c99a8549654e71 | Licença: MIT -->

> **Verificação Factual Obrigatória ("NÃO ENCONTRADO NA FONTE"):**
> O enunciado da tarefa menciona *"quais itens dos 121 se aplicam e quais não"*. Contudo, inspecionando o código-fonte real de `Leonxlnx/taste-skill` (`skills/taste-skill/SKILL.md`, commit `e3c92037548e3e49bea8e6b906c99a8549654e71`, 980 linhas / 88 KB), **a contagem de "121 itens" NÃO FOI ENCONTRADA NA FONTE (`NÃO ENCONTRADO NA FONTE`)**.
> A seção **`14. FINAL PRE-FLIGHT CHECK`** (linhas 910–980 de `skills/taste-skill/SKILL.md`) contém exatamente **63 checkboxes (`- [ ]`)** divididos em 3 blocos:
> - `Must Pass All (Core Quality)`: **19 itens**;
> - `Anti-Bloat Jump Check (Section 9 Quick Scan)`: **26 itens**;
> - `Motion & Interactive Quality (Only If Motion Was Requested)`: **18 itens**.
> *(Total real na Seção 14 = `19 + 26 + 18 = 63` itens).*

### Regra de Escopo Estrito (Seção 13 do `taste-skill`: `OUT OF SCOPE`)
No próprio arquivo `skills/taste-skill/SKILL.md` (Seção `13. OUT OF SCOPE`, linhas 896–905), o autor declara explicitamente que o `taste-skill` **NÃO DEVE SER USADO** para:
1. **Dashboards, painéis administrativos, analytics e data tables** (`dashboard_produto`);
2. **Aplicações ricas em dados ou ferramentas internas de produtividade**;
3. **Formulários multi-etapas / wizards** (`wizard_multietapas` — atenção: **checkouts em múltiplas etapas / wizards também são excluídos pela Seção 13 da fonte**; aplique o checklist abaixo **somente** em **landing pages públicas** e **páginas públicas de apresentação/checkout de etapa única**, e **NUNCA** em dashboards ou telas operacionais do sistema).

### Classificação Completa dos 63 Itens Reais da Seção 14 (`FINAL PRE-FLIGHT CHECK`)

#### A. Itens que SE APLICAM em Páginas Públicas (Landing Pages e Checkout Público de Etapa Única) — 39 itens

**Do bloco `Must Pass All (Core Quality)` (16 de 19 aplicáveis):**
1. **`[Core-01]`** `DESIGN_VARIANCE` produziu layout condizente com a identidade da página pública (evitando cópia genérica de template se a Spec pedir destaque visual).
2. **`[Core-02]`** `MOTION_INTENSITY` respeita o nível pedido na Spec (sem injetar bibliotecas pesadas se o projeto for estático/simples).
3. **`[Core-03]`** `VISUAL_DENSITY` condizente com landing page / página pública (respiro generoso, sem comprimir seções).
4. **`[Core-04]`** Uso correto de Server Components por padrão, isolando `"use client"` apenas nas folhas interativas.
5. **`[Core-05]`** Zero ícones Lucide/Feather sem envoltório visual adequado quando usados como destaque de feature.
6. **`[Core-06]`** Sombras coloridas/ambientais sutis sem sombra preta chapada (`shadow-2xl` puro mal calibrado).
7. **`[Core-07]`** Escala tipográfica fluida (`clamp()` ou responsivo consistente) nos títulos principais (`Hero`).
8. **`[Core-08]`** Largura de leitura (`60ch–70ch`) respeitada nos subtítulos e parágrafos de venda.
9. **`[Core-09]`** Paleta com fundo neutro calibrado, texto de alto contraste e **apenas 1 cor de acento principal** para o CTA primário.
10. **`[Core-10]`** Zero uso de gradientes roxo/azul neon genéricos ("AI slop gradient") não solicitados na Spec.
11. **`[Core-11]`** Estados vazios, de erro e de loading desenhados para os formulários públicos (ex.: captura de lead / pagamento).
12. **`[Core-12]`** Sem imagens quebradas ou URLs da lista de fotos banidas/expiradas do Unsplash.
13. **`[Core-13]`** Zero erros de hidratação (`Math.random()` / `new Date()` direto no render SSR).
14. **`[Core-14]`** Responsividade mobile impecável (`375px`): grids colapsam para 1 coluna sem cortar texto nem vazar horizontalmente.
15. **`[Core-15]`** Botões e links com feedback tátil/visual (`active:scale-[0.98]`, foco visível).
16. **`[Core-16]`** Sem texto placeholder falso ("Lorem ipsum", "John Doe", "Acme Corp" não previstos nos dados do projeto).

**Do bloco `Anti-Bloat Jump Check (Section 9 Quick Scan)` (17 de 26 aplicáveis):**
17. **`[Bloat-01]`** Sem cards de tamanho idêntico em 3 colunas com ícone solto + título + 2 linhas genéricas quando um layout editorial/assimétrico foi pedido.
18. **`[Bloat-02]`** Sem pílula "✨ Powered by AI" ou badge brilhante genérico no topo do Hero (a menos que exigido por `REQ`).
19. **`[Bloat-03]`** Sem avatares empilhados com "Joined by 10,000+ users" fabricados sem respaldo nos requisitos.
20. **`[Bloat-04]`** Sem depoimentos falsos inventados pelo LLM.
21. **`[Bloat-05]`** Sem seção de logos de clientes falsos ("Trusted by...").
22. **`[Bloat-06]`** Sem gráficos decorativos falsos (SVGs de linha subindo sem dados reais).
23. **`[Bloat-07]`** Sem botões circulares flutuantes desnecessários ("Back to top" / chat fake) não solicitados.
24. **`[Bloat-08]`** Sem barras de navegação triplas ou menus inchados com links mortos (`href="#"`).
25. **`[Bloat-09]`** Sem modais/popups de newsletter automáticos ao abrir a página.
26. **`[Bloat-10]`** Sem contadores regressivos falsos de escassez (dark pattern), salvo se `REQ` explícito.
27. **`[Bloat-11]`** Sem excesso de badges/tags coloridas competindo com o botão de conversão (CTA).
28. **`[Bloat-12]`** Sem fundos com múltiplos blobs borrados animados que degradam FPS em mobile.
29. **`[Bloat-13]`** Sem texto centralizado em blocos longos de mais de 3 linhas (alinhar à esquerda para leitura).
30. **`[Bloat-14]`** Sem bordas grossas neon (`2px+` brilhantes) ao redor de todos os cards.
31. **`[Bloat-15]`** Sem mistura de famílias de ícones diferentes na mesma página.
32. **`[Bloat-16]`** Sem formulários de checkout com campos não solicitados na Spec.
33. **`[Bloat-17]`** Sem rodapés gigantes com dezenas de links falsos não existentes nas rotas do projeto.

**Do bloco `Motion & Interactive Quality` (6 de 18 aplicáveis, somente quando a Spec pedir animação rica):**
34. **`[Motion-01]`** Animações usam apenas `transform` e `opacity` (zero animação de `width`, `height`, `top`, `left`).
35. **`[Motion-02]`** Respeito obrigatório a `prefers-reduced-motion`.
36. **`[Motion-03]`** `stagger` discreto (`<= 80ms` entre itens) sem atrasar a leitura do CTA principal.
37. **`[Motion-04]`** Limpeza (`cleanup`) adequada de `IntersectionObserver`, `requestAnimationFrame` ou listeners no `useEffect`.
38. **`[Motion-05]`** Zero bibliotecas de animação importadas apenas para fazer um fade-in simples que CSS resolve.
39. **`[Motion-06]`** Em páginas de checkout público, **desativar distrações de movimento** ao redor do formulário de pagamento para priorizar clareza e confiança.

#### B. Itens que NÃO SE APLICAM (Descartados no NextCode mesmo em Páginas Públicas) — 24 itens

Os 24 itens abaixo da Seção 14 do `taste-skill` **NÃO devem ser cobrados pelo `avaliador-frontend`**, pois exigem bibliotecas externas pesadas não padronizadas, criam complexidade desnecessária ou conflitam com acessibilidade (`web-interface-guidelines`) e performance (`react-best-practices`):

1. **`[Descartado-Core-17 a 19]` (3 itens):** Exigência de texturas de ruído SVG (`feTurbulence` noise overlay) em tela cheia, fontes display experimentais externas e layouts obrigatoriamente assimétricos/quebrados (em páginas de checkout ou produtos objetivos, clareza e simetria vencem experimentalismo).
2. **`[Descartado-Bloat-18 a 26]` (9 itens):** Proibições dogmáticas contra componentes padrão do `shadcn/ui`, contra grids regulares de preços, contra tabelas comparativas de planos, contra ícones em listas de benefícios e contra cards simétricos — **Motivo:** em páginas de produto e checkout, tabelas comparativas e `shadcn/ui` bem estilizados melhoram acessibilidade (teclado/ARIA) e conversão.
3. **`[Descartado-Motion-07 a 18]` (12 itens):** Exigência de cursores magnéticos customizados (viola usabilidade e touch), smooth-scroll hijacking (Lenis/Locomotive — viola `web-interface-guidelines` de scroll nativo), parallax contínuo em scroll, text-splitting caractere por caractere, física de mola complexa obrigatória via Framer Motion/GSAP em todos os elementos e Bento Grids com animações perpétuas — **Motivo:** degradam severamente o bundle (`bundle-dynamic-imports`), prejudicam leitores de tela e atrapalham o fluxo de checkout.
