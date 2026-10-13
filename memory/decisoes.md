# Decisões do fundador (registro cronológico)

> Extraídas das transcrições das sessões (`~/.claude/projects/C--projetos-nextcode/*.jsonl`) em 08/10/2026.
> Nova decisão → acrescentar aqui **antes** de executar. Em conflito, vale a mais recente.

| Data | Decisão | Origem |
|---|---|---|
| 03/10 | O NextCode orquestra a IA de qualquer provedor (OmniRoute, Gemini, Claude…), "como o harness faz, tudo é skill", com travas; não pode alucinar nem dar respostas evasivas | sessão b233d208 |
| 03/10 | "Quero que o NextCode tenha a habilidade do Jev de fazer a seleção e mandar para o modelo mais caro ou mais barato de acordo com a complexidade" | b233d208 |
| 03/10 | Tudo que entra no chat vira Markdown + YAML | b233d208 |
| 04/10 | NextCode focado em desenvolvimento, para leigo e engenheiro; definir papéis, permissões, briefs, telemetria (o que vira skill × melhoria) | abe3a903 |
| 04/10 | **Usar o Jev**: "o custo-benefício é enorme"; só há desenvolvimento com Spec **e** Macrobrief | abe3a903 |
| 04/10 | Checklist por REQ ticado durante a execução; humano só nos critérios da lista fechada; automatizar o resto | abe3a903 |
| 04/10 | Menor quantidade de tokens; OmniRoute ou skill fazendo o roteamento; usuário pode pôr suas chaves (BYOK) | abe3a903 |
| 05/10 | Gateways: FreeLLMAPI e OmniRoute; "não reinventar a roda": consultar deepseek-harness, opencode, FreeLLMAPI | f9358986 |
| 06/10 | Jev decide: tarefa simples → modelo simples; se não couber, divide em lotes; tarefa complexa → divide e manda para o modelo mais caro; **tudo orquestrado pelo NextCode** | f9358986 10:28 |
| 06/10 | Executor faz autoteste + ciclo de 3 tentativas + relatório no template do analista; avaliador não muda | f9358986 10:37 |
| 06/10 | Fluxo: elicitador faz triagem (3ª rodada pergunta), **pesquisa oficial**, Spec **sem economizar**; Macrobrief MD+YAML; analista confere (3 ciclos); Microbriefs por cluster | f9358986 11:45 |
| 06/10 | **Executor: não se pode economizar. Avaliador: refinar ao máximo, não economizar tokens.** Cada cluster tem executor e avaliador; trabalho paralelo | f9358986 17:54 |
| 06/10 | Harness: tudo é skill (elicitador, analista, executor, avaliador); **Jev escolhendo os melhores provedores**; travas podem ficar nas skills | f9358986 22:52 |
| 06/10 | "O Jev escolhe o melhor provedor: tarefa simples → barato, complexa → caro"; estudar a documentação, sem achismo | f9358986 23:20 |
| 07/10 | Avaliador pode ser o Gemini (crédito posto); se falhar, outro pago (DeepSeek ou Claude) | f9358986 10:08 |
| 07/10 | Aplicar teto de custo e preparar Playwright | f9358986 16:39 |
| 08/10 00:24 | Ideia: modelos **pagos** para eficiência; **gratuitos para outras atividades** | f9358986 |
| 08/10 00:44 | Usar o Jev ao máximo (Claude listou 14 usos, grupos A–E); caveman, ScrapeGraphAI, agent-reach: **não** | f9358986 |
| 08/10 01:04 | Ordem: fechar item 2 → item 10 (grupo A do Jev) → item 7 → item 1 → item 8 → item 9 | f9358986 |
| 08/10 manhã | Crédito hoje só no **DeepSeek** (Claude e Gemini depois). **Elicitador fixo no modelo forte; executor não economiza; o restante o Jev gerencia (inclusive a escolha do provedor)**. Já houve testes de custo e de divisão da execução | esta sessão |
| 08/10 manhã | Documentar tudo antes de executar; memória obrigatória; prompts ao Antigravity com travas e relatórios para auditoria | esta sessão |
| 08/10 tarde | **Elicitador (Spec, Macrobrief), executor e avaliador: não economizar se precisar — quem decide é o Jev**, inclusive a divisão. Modelo gratuito só quando não prejudicar o projeto; observado: gratuitos dão respostas incompletas/erradas na execução. Ordem de implementação: Claude decide | esta sessão |
| 08/10 tarde (2) | **Pago primeiro**: o Jev analisa o que precisa de provedor pago e manda para o pago; o resto o próprio Jev decide se **divide** a tarefa para caber no gratuito. Revisar código e documentação antes de decidir | esta sessão |
| 08/10 tarde (3) | Fundador pede análise crítica ("não concorde comigo") e delega a melhor direção. **Claude recomenda e adota no R1:** papéis críticos só pago (sem queda para gratuito; sem pago → pausa); Jev escolhe Flash (barato) × Pro; divisão só por qualidade; gratuito só no resto. "Dividir para caber no gratuito" **rejeitado** com dados (referência §5.2) | esta sessão |
| 08/10 tarde (4) | **OmniRoute pausado; só o FreeLLMAPI é o direcionamento**, com o Jev decidindo. Claude: papéis críticos via perfis pagos do FreeLLMAPI (`auto:nextcode-pago-forte`/`-barato`), DeepSeek direto só como último recurso (D3). R1.2 corrigido; P0.3 descartado | esta sessão |
| 08/10 tarde (5) | **DeepSeek direto fora; DeepSeek pago agora pelo FreeLLMAPI.** Gratuitos quebram em tarefas grandes (motivo histórico da divisão). Claude: só FreeLLMAPI nos papéis críticos (perfil pago → modelo pago fixo), trava `X-Routed-Via` com prefixo pago, divisão pelos gatilhos existentes; gratuito no executor só reavaliado com o bench | esta sessão |
| 08/10 noite | Claude: **não adotar o SDK `@typesafe-ai/sdk` agora** (revisa a recomendação de 08/10 00:34): o adaptador próprio usa `safeFetch` e a trilha; nova tentativa em 429/529 são ~20 linhas. Reavaliar se o adaptador crescer | esta sessão |
| 08/10 noite (2) | **Avaliador pelo FreeLLMAPI: 1º `nemotron-3-ultra` (NVIDIA, gratuito, outra família) → 2º DeepSeek pago → 3º Claude.** Só o avaliador; executor segue só pago. Claude sugeriu (aceito como sugestão, não decidido): quando houver crédito, Claude antes do DeepSeek | esta sessão |
| 09/10 | Fundador: implementar o que fizer mais sentido, **passo a passo e sempre testando; nunca confiar só na documentação**. Pediu, ao fim das rodadas, **auditoria das skills** (se fazem o que prometem). Claude propôs: ligar (não remover) a referência de página pública usando a decisão do Jev que hoje é descartada; ordem P2 (bench) → auditoria das skills | esta sessão |
| 09/10 | Claude: **a régua do bench (testes de aceite) é escrita pelo auditor, não pelo Antigravity** (quem implementa não escreve a própria régua — arquitetura §14.1). Variantes do 1º bench: padrão, sem Jev, avaliador DeepSeek | esta sessão |
| 09/10 | Fundador aprovou: **ligar do jeito certo** a referência de página pública (usar a resposta `aplicarTasteSkillPublico` do Jev, gravar no plano da etapa, passar `isPublicPage` ao avaliador; tirar o checklist duplicado do corpo do `avaliador-frontend`) e **reaproveitar** `skillApoioPrincipal` e `aplicarReactPerfCritico`. Método da auditoria das skills aprovado (6 checagens, inclui controle com código correto). Entra no prompt da auditoria das skills | esta sessão |
| 09/10 | Fundador aprovou o **P2b** ("escreva e eu rodo no antigraphity"): projetos P3 (login) e P4 (correção com bug plantado) + 3 repetições antes da auditoria das skills. Régua/Spec/base escritas pelo auditor | esta sessão |
| 09/10 | Fundador: **manter o Jev** (custo irrisório, ~0,3% da execução); auditor concorda em manter, com ressalva: benefício ainda não medido (aceite no teto) e executor saiu mais caro com Jev no P3 — instrumentar custo por etapa e criar caso no bench onde a decisão importa. Fundador aprovou seguir com o prompt da auditoria das skills (S1) | esta sessão |
| 13/10 | Fundador pediu o prompt de correção da auditoria de 12/10 para o Antigravity, com a máxima **"não se mexe no que está funcionando; se precisar mexer, reportar antes"**, leitura obrigatória antes de agir, literalidade total e relatório com sugestões ao final. Claude limitou o C1 ao que está quebrado (C1, C2, C3, C6, C7); o resto fica para decisão do fundador | esta sessão |
