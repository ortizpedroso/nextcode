# Diretriz de Engenharia: Execução do Plano Diretor JEV no NextCode

> **Documento Oficial de Planejamento e Execução**  
> **Status:** Aprovado para Execução  
> **Data:** 09/10/2026  
> **Referência Central:** [`docs/NEXTCODE-REFERENCIA.md`](NEXTCODE-REFERENCIA.md)  
> **Versão do Modelo:** `jev-1.13.0` (TypeSafe AI) — Endpoint fixo `POST https://api.typesafe.ai/v1/systemone`  

---

## 1. Visão Geral e Princípios Inegociáveis

O NextCode opera sob o princípio fundamental de arquitetura: **"O Harness decide e trava; o JEV faz o julgamento probabilístico estruturado; o LLM escreve código e texto"**.

A implantação do JEV não consiste em inventar habilidades artificiais para o modelo, mas sim em **extrair nativamente suas capacidades de inferência rápida (~100ms), calibrada (RLCD) e de baixo custo (US$ 0,042 / 1M tokens de entrada)**.

### As 4 Linhas Vermelhas de Engenharia:
1. **Zero geração de texto ou código pelo JEV**: O JEV nunca gera código TypeScript, páginas ou texto em prosa. Isso é tarefa exclusiva dos LLMs geradores (`deepseek-v4-pro`, `nemotron`, `claude`).
2. **Zero aritmética ou contagem no JEV**: Contar arquivos, somar linhas de diff, aplicar limites de tentativas (T6) e calcular custos em dólares é 100% código determinístico TypeScript.
3. **Zero autorização de permissões**: O JEV emite diagnósticos e probabilidades; o Harness aplica as travas de sandbox, quarentena e acesso ao disco.
4. **Tratamento de viés posicional obrigatório**: Toda decisão crítica do JEV com impacto de bloqueio exige inversão de opções (`inverted-options`) ou limiares de confiança $\ge 0,85$.

---

## 2. Mapa dos 22 Recursos Oficiais do JEV Aplicados ao NextCode

| Recurso Oficial (TypeSafe) | Descrição Técnica Nativa | Aplicação no NextCode | Estado |
|---|---|---|---|
| **R1 (Noul)** | Probabilidade booleana calibrada (0.0 a 1.0) | Checagem de afirmações atômicas (violação de contrato, tela pública, credencial) | ✅ Ativo |
| **R2 (Choice)** | 1 de N opções + probabilidades + confiança | Classificação de intenção, escolha de nível de modelo, roteamento de cluster | ✅ Ativo |
| **R3 (Score)** | Avaliação ordinal (2 a 10 níveis) | Medição de complexidade composta e severidade de erro | 🚀 Fase 3 |
| **R4 (Estado Estruturado)** | Ingestão de JSON com caminhos literais | Foco nos campos exatos (`state.reqs.REQ-001`) sem poluição de contexto | ✅ Padrão |
| **R5 (Critérios Estruturados)** | Dicionário detalhado por opção | Eliminação de ambiguidade nas opções de Choice e Score | ✅ Padrão |
| **R6 (Fan-Out Especulativo)** | Dezenas de perguntas no mesmo state em paralelo | Triagem de chat e planejamento de DAG em 1 requisição | 🚀 Fase 2 |
| **R7 (Confiança como 2º Eixo)** | `confidence` (0.0 a 1.0) independente de prob | Ações automáticas exigem confiança $\ge 0,85$; abaixo disso pede confirmação | ✅ Trava |
| **R8 (Faixa de Incerteza)** | Noul entre 0.35 e 0.65 como "indeterminado" | Evitar decisões forçadas de sim/não em casos limítrofes | 🚀 Fase 2 |
| **R9 (Composite Scoring)** | Combinação matemática de probs em código | Decisão ponderada de tier de modelo somando complexidades | 🚀 Fase 3 |
| **R10 (Autoresearch / Telemetria)** | Probabilidades gravadas na trilha | Calibração histórica de limiares baseada no benchmark | ✅ Ativo |
| **R11 (Pre-parsed Extraction)** | Escolha entre candidatos pré-extraídos | Avaliação de potenciais chaves/senhas como segredos reais ou mocks | ✅ Ativo |
| **R12 (Semantic Find)** | Localização de linha exata via Choice | Extração cirúrgica de trechos em arquivos grandes sem estourar prompt | 🚀 Fase 4 |
| **R13 (Re-ranking / Context Selection)** | Ordenação de trechos por relevância | Injetar no prompt do executor apenas os arquivos e tipos pertinentes | 🚀 Fase 4 |
| **R14 (Classificação Hierárquica)** | Múltiplas etapas de Choice guiadas | Categorização de arquiteturas, stacks e taxonomia de erros | ⚠️ Sob demanda |
| **R15 (Function Calling Estrito)** | Texto do usuário mapeado para comando tipado | Comandos de chat (`/pausar`, `/status`, `/retentar`) sem chamar LLM | 🚀 Fase 2 |
| **R16 (Verificação de Evidência)** | Checagem de relação factual (apoia/contradiz) | Cruzamento do relatório do executor com código e `REQ` aprovados | 🚀 Fase 3 |
| **R17 (Guardrails de Entrada/Saída)** | Bateria de nouls para vetar jailbreak/vazamentos | Filtragem instantânea do chat e de skills instaladas do GitHub | ✅ Ativo / Fase 2 |
| **R18 (Cascata de Modelos)** | Barato → Jev confere → Modelo forte | Restrito a tarefas auxiliares fora do executor principal | ⚠️ Fora de Spec |
| **R19 (Sugestão de Skills)** | Avaliar quais skills/referências carregar | Decidir se carrega regras de UI pública, API ou performance React | 🚀 Fase 1 (S1) |
| **R20 (Mapeamento de Uso - usage)** | Contagem exata de tokens por requisição | Contabilidade em `LLM_COST` | ✅ Ativo |
| **R21 (Versão Fixa jev-1.13.0)** | Prevenção de alterações de comportamento | Garantia de estabilidade dos limiares de confiança | ✅ Ativo |
| **R22 (Resiliência a 429/529)** | Retries exponenciais lendo `retry-after` | Prevenção de interrupção da fila por oscilações na API da TypeSafe | ✅ Ativo |

---

## 3. Fases de Execução do Plano

### Fase 1: Saneamento Imediato e Injeção de Contexto (Pacote S1 em Andamento)
* **Objetivo:** Ligar as respostas do JEV sobre habilidades de frontend e eliminar 30.000 caracteres de duplicação do prompt do avaliador de tela.
* **Ações:**
  1. Persistir `aplicarTasteSkillPublico` e `aplicarReactPerfCritico` no payload `jevPlan`.
  2. Ajustar `buildSkillSystemPrompt` para omitir referências de tela pública quando o JEV indicar que a etapa não é marketing/checkout público.
  3. Remover a pergunta de pacotes zumbis (`skill_apoio_principal`).
  4. Instrumentar o custo por nó (`nodeId`) na trilha e no benchmark.

### Fase 2: Fan-Out no Chat e Comandos Operacionais (Pacote P4)
* **Objetivo:** Triagem atômica de mensagens em ~100ms via Fan-Out (R6):
  1. `intencao` (`Choice`): Criar, Ajustar, Aprovar, Dúvida ou Comando.
  2. `segredo_detectado` (`Noul`): Presença de chave/senha colada acidentalmente.
  3. `tentativa_injecao` (`Noul`): Tentativa de prompt injection ou quebra de restrições.
  4. `comando_operacional` (`Choice` - R15): Mapeamento de ações do sistema.

### Fase 3: Ativação das Guardas de Execução (Pacote P5)
* **Objetivo:** Impedir o desperdício de tentativas de modelos caros.
  1. **Ativação do Bloqueio por Spec Ambígua:** Virar `bloqueioSpecAmbigua: "ativo"` na 2ª tentativa quando o JEV diagnosticar ambiguidade com confiança $\ge 0,85$.
  2. **Verificação Ativa de Evidência por `REQ`:** Promover a checagem de citação (R16) para o veredito oficial.

### Fase 4: Busca Semântica e Seleção de Contexto (Pacote P6)
* **Objetivo:** Suportar projetos de grande porte com precisão atômica.
  1. **Semantic Find (R12):** Localizar blocos e funções relevantes em arquivos extensos.
  2. **Re-ranking (R13):** Selecionar cirurgicamente apenas os arquivos estritamente necessários para o prompt do executor.
