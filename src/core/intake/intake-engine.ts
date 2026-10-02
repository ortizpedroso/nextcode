/**
 * Intake Engine (NextCode v5)
 * Classifica e gerencia a entrada de intenções do usuário nos 4 Cenários Intelectuais:
 * - Scenario A: Intenção Macro / SaaS (Requer Elicitação + Spec Canônica + User Spec Approval Lock)
 * - Scenario B: Intenção Micro / Quick Fix (Gera Brief Híbrido direto com files_scope)
 * - Scenario C: Intenção Ambígua / Solta (Intervenção ativa na 3ª rodada com 3 caminhos)
 * - Scenario D: Dúvida / Consultivo (Resposta LLM direta, bypass de DAG/IO)
 */

export type IntakeScenario = "SCENARIO_A" | "SCENARIO_B" | "SCENARIO_C" | "SCENARIO_D";

export interface IntakeAnalysisResult {
  scenario: IntakeScenario;
  reasoning: string;
  requiresSpecApproval: boolean;
  requiresIntervention: boolean;
  suggestedAction: string;
}

export class IntakeEngine {
  /**
   * Analisa a intenção do usuário e a contagem atual de rodadas para determinar o Cenário.
   */
  public static analyze(prompt: string, turnCount: number = 1): IntakeAnalysisResult {
    const trimmed = prompt.trim();
    const lower = trimmed.toLowerCase();

    // Cenário D: Dúvidas / Perguntas conceituais (ex: "o que é", "como funciona", "explique", "dúvida")
    const isQuestion =
      lower.startsWith("o que") ||
      lower.startsWith("como") ||
      lower.startsWith("por que") ||
      lower.startsWith("quais") ||
      lower.endsWith("?") ||
      lower.includes("explique") ||
      lower.includes("dúvida");

    const isCodeAction =
      lower.includes("crie") ||
      lower.includes("desenvolva") ||
      lower.includes("implemente") ||
      lower.includes("adicione") ||
      lower.includes("corrija") ||
      lower.includes("refatore") ||
      lower.includes("build") ||
      lower.includes("saas");

    if (isQuestion && !isCodeAction) {
      return {
        scenario: "SCENARIO_D",
        reasoning: "Solicitação consultiva / Q&A puro. Sem necessidade de arquivos ou DAG.",
        requiresSpecApproval: false,
        requiresIntervention: false,
        suggestedAction: "DIRECT_LLM_RESPONSE",
      };
    }

    // Cenário C: Ambíguo / Solto
    const isShortOrVague = trimmed.length < 15 || lower.includes("o que dá pra fazer") || lower.includes("oi") || lower.includes("ajuda");

    if (isShortOrVague && !isCodeAction) {
      if (turnCount >= 3) {
        return {
          scenario: "SCENARIO_C",
          reasoning: "Solicitação ambígua sem definição clara após 3 rodadas de diálogo.",
          requiresSpecApproval: false,
          requiresIntervention: true,
          suggestedAction: "SHOW_3_PATH_INTERVENTION_MODAL",
        };
      }
      return {
        scenario: "SCENARIO_C",
        reasoning: "Solicitação ambígua inicial. Requer diálogo continuado de triagem.",
        requiresSpecApproval: false,
        requiresIntervention: false,
        suggestedAction: "CONTINUE_ELICITATION_DIALOG",
      };
    }

    // Cenário A: Macro / SaaS ("crie um saas", "desenvolva uma plataforma", "sistema completo")
    const isMacroScope =
      lower.includes("saas") ||
      lower.includes("plataforma") ||
      lower.includes("sistema completo") ||
      lower.includes("aplicação inteira") ||
      lower.includes("do zero") ||
      trimmed.length > 200;

    if (isMacroScope) {
      return {
        scenario: "SCENARIO_A",
        reasoning: "Solicitação de escopo amplo (Macro / SaaS). Exige Spec Canônica e aprovação do usuário.",
        requiresSpecApproval: true,
        requiresIntervention: false,
        suggestedAction: "BUILD_CANONICAL_SPEC_AND_LOCK",
      };
    }

    // Cenário B: Micro / Feature especificação direta ("crie um botão", "corrija o erro X no arquivo Y")
    return {
      scenario: "SCENARIO_B",
      reasoning: "Solicitação de escopo pontual. Pode prosseguir via Brief Híbrido com files_scope.",
      requiresSpecApproval: false,
      requiresIntervention: false,
      suggestedAction: "GENERATE_HYBRID_BRIEF",
    };
  }

  /**
   * Retorna o Prompt do Sistema para instruir a IA a agir como Arquiteto de Software Sênior
   * sem gerar poluição visual, preâmbulos robóticos ou código de implementação na janela de chat.
   */
  public static getGovernanceSystemPrompt(): string {
    return `Você é a NextCode AI, Arquiteto de Software e Engenheiro Fullstack Sênior.
DIRETRIZES IMUTÁVEIS DE GOVERNANÇA E COMUNICAÇÃO:
1. RESPOSTAS LIMPAS E EXECUTIVAS: Seja direto, profissional e elegante. NUNCA inclua cabeçalhos robóticos (como "[NEXTCODE v5]", "🤖 OmniRoute", "Lei Inegociável nº X"), discursos de desculpa sobre governança, ou perguntas desnecessárias ao usuário ("Deseja que eu prossiga?", "Você aprova?").
2. ESPECIFICAÇÕES IMPECÁVEIS: Sempre que solicitar ou apresentar uma Especificação Técnica (Spec Canônica), utilize EXCLUSIVAMENTE o modelo oficial mestre abaixo. NUNCA invente outros modelos, NUNCA omita a Seção 1 (Directives & Locks T1-T6), a Seção 2 (Segurança Zero-Trust/OWASP), o formato JSON do files_scope nem o Plano de Auditoria:

--- INÍCIO DO MODELO CANÔNICO OBRIGATÓRIO DA SPEC NEXTCODE V5 ---
# 📋 SPEC CANÔNICA NEXTCODE v5: [Nome do Sistema/Módulo]

## 🔒 1. DIRECTIVES & MECHANICAL LOCKS [IMUTÁVEL - ENGINE NEXTCODE]
- **Lock T1 (Spec Approval):** Nenhuma linha de código pode ser gerada ou promovida sem aprovação explícita da Spec.
- **Lock T2 (Strict Files Scope):** A execução é restrita estritamente aos arquivos declarados no files_scope.
- **Lock T3 (WAL Audit Trail):** Toda instrução e log é registrado de forma imutável no SQLite WAL.
- **Lock T4 (Quarantine Isolation):** Código gerado exclusivamente em .quarantine/ antes da promoção.
- **Lock T5 (Dual-Lens Blind Audit):** Executor e auditor isolados em instâncias independentes.
- **Lock T6 (Loop Limit <= 3):** Máximo de 3 tentativas automáticas de autocorreção em caso de rejeição.

## 🛡️ 2. REQUISITOS OBRIGATÓRIOS DE SEGURANÇA [BASELINE ZERO-TRUST]
- **Autenticação:** JWT / OAuth2 com invalidação por token_version.
- **Criptografia:** Dados sensíveis/segredos em repouso via AES-256-GCM (enc:v2).
- **OWASP Top 10:** Sanitização obrigatoria via Zod em 100% das rotas.
- **Anti-SSRF:** Bloqueio mecânico de conexões a IPs internos/privados.

## ⚙️ 3. CONTEXTO & METADATA DO PROJETO
- **Nome do Projeto:** [Nome]
- **Stack Tecnológica:** [Stack Tecnológica]

## ⚙️ 4. MÓDULOS FUNCIONAIS & REGRAS DE NEGÓCIO (M1..MN)
- **M1 ([Nome do Módulo]):** [Descrição e regras de negócio]

## ⚙️ 5. MODELAGEM DE DADOS (PRISMA SCHEMA)
\`\`\`prisma
// Schemas relacionais
\`\`\`

## 🔒 6. MATRIZ DE ARQUIVOS AFETADOS (FILES_SCOPE)
\`\`\`json
{
  "files_scope": [
    "caminho/do/arquivo1.ts"
  ]
}
\`\`\`

## 🔒 7. PLANO DE AUDITORIA MECÂNICA & DUPLA-LENTE
- **7.1 Validação Determinística:** npx tsc --noEmit, npm test (Vitest).
- **7.2 Auditoria Cega (Dual-Lens Audit):** Validação por auditor cego em .quarantine/.
--- FIM DO MODELO CANÔNICO OBRIGATÓRIO DA SPEC NEXTCODE V5 ---

3. GERAÇÃO DIRETA DE PATCHES DE ARQUIVO: Sempre que o usuário solicitar uma correção ou reportar um erro no chat, você DEVE OBRIGATORIAMENTE retornar o código completo do arquivo em um bloco markdown formatado com a indicação do caminho no topo (ex: \`\`\`css // file: src/app/globals.css ... \`\`\`). NUNCA forneça scripts do PowerShell, Bash ou comandos manuais (como Set-Content, echo, New-Item) para o usuário executar. O NextCode captura automaticamente os blocos de código e os escreve diretamente no disco.
4. TRAVA DE APROVAÇÃO (T1): O desenvolvimento de código só é iniciado após a Spec Canônica estar com status de APROVADA pelo usuário.
5. QUALIDADE E CLEAN CODE: Todo projeto deve seguir TypeScript strict, Clean Code, resiliência e padrões SOLID.
6. AUTONOMIA TOTAL E APLICAÇÃO DIRETA DE ARQUIVOS: É ESTRITAMENTE PROIBIDO pedir para o usuário realizar etapas manuais ("crie o arquivo X", "salve o arquivo Y", "altere o código Z", "execute Set-Content no PowerShell"). A IA assume 100% da responsabilidade de criar, editar e promover fisicamente os arquivos no disco. Ao apresentar uma solução, declare que a alteração foi aplicada diretamente no disco do projeto (ex: "Apliquei a correção criando o módulo \`src/app/globals.css\`").
7. VERIFICAÇÃO RIGOROSA DE STATUS DO PROJETO (SEM ALUCINAÇÃO): Ao responder sobre o status de páginas, rotas ou módulos do projeto, inspecione estritamente os arquivos reais reportados na 'Estrutura de arquivos' do contexto. NUNCA declare que o sistema está 'pronto', 'completo' ou que 'todas as telas foram implementadas' se faltarem rotas, schemas ou arquivos da Spec no disco. Liste exatamente os arquivos que já existem e quais ainda precisam ser gerados.
8. PROIBIDO AFIRMAR QUE INICIOU PROCESSOS DE TERMINAL/SERVIDORES LOCALMENTE: NUNCA afirme que "o servidor foi inicializado com sucesso", "subi a aplicação" ou que ela "está no ar em http://localhost:3000". A IA não mantém servidores de terminal interativos persistentes. Ao instruir o usuário sobre como testar, forneça o comando exato para execução local (ex: "Os arquivos foram criados no disco em C:\\projetos\\gateway. Para iniciar o servidor de desenvolvimento, execute \`npm run dev\` no terminal e acesse http://localhost:3000").`;
  }

  /**
   * Gera o modelo textual da Spec Canônica no padrão oficial NextCode v5 (SPEC-TEMPLATE-NEXTCODE-V5.md).
   */
  public static generateCanonicalSpec(title: string, rawPrompt: string): string {
    return `# 📋 SPEC CANÔNICA NEXTCODE v5: ${title}

> **Documento Mestre de Especificação Técnica, Governança e Segurança**  
> **Status:** AGUARDANDO APROVAÇÃO DO USUÁRIO (Trava T1 Ativa)  
> **Data:** ${new Date().toISOString().split("T")[0]}

---

## 🔒 1. DIRECTIVES & MECHANICAL LOCKS [IMUTÁVEL - ENGINE NEXTCODE]
- **Lock T1 (Spec Approval):** Nenhuma linha de código pode ser gerada ou promovida para a pasta final sem aprovação explícita da Spec.
- **Lock T2 (Strict Files Scope):** A execução é restrita estritamente aos arquivos declarados no \`files_scope\`.
- **Lock T3 (WAL Audit Trail):** Toda instrução e log é registrado de forma imutável no SQLite WAL.
- **Lock T4 (Quarantine Isolation):** Código gerado exclusivamente em \`.quarantine/\` antes da promoção.
- **Lock T5 (Dual-Lens Blind Audit):** Executor e auditor são isolados em instâncias independentes.
- **Lock T6 (Loop Limit <= 3):** Máximo de 3 tentativas automáticas de autocorreção em caso de rejeição.

---

## 🛡️ 2. REQUISITOS OBRIGATÓRIOS DE SEGURANÇA [BASELINE ZERO-TRUST]
- **Autenticação:** JWT / OAuth2 com invalidação por \`token_version\`.
- **Criptografia:** Dados sensíveis/segredos em repouso via **AES-256-GCM** (\`enc:v2\`).
- **OWASP Top 10:** Sanitização obrigatoria via Zod em 100% das rotas.
- **Anti-SSRF:** Bloqueio mecânico de conexões a IPs internos/privados.

---

## ⚙️ 3. CONTEXTO & METADATA DO PROJETO
- **Nome do Projeto:** \`${title}\`
- **Slug:** \`${title.toLowerCase().replace(/[^a-z0-9]/g, "-")}\`
- **Objetivo:** ${rawPrompt}
- **Stack Tecnológica:** Node.js + Express (TypeScript), Prisma ORM + SQLite, Zod, Vitest.

---

## ⚙️ 4. MÓDULOS FUNCIONAIS & REGRAS DE NEGÓCIO
- **M1 (Core & Persistência):** Modelagem Prisma, clientes, cobranças e assinaturas.
- **M2 (Integração Externa):** Client de gateway (Asaas v3 / Stripe).
- **M3 (Módulo Financeiro & Analytics):** Gestão de produtos, MRR, inadimplência e exportação de relatórios.
- **M4 (Webhooks & Conciliação):** Processamento em tempo real de liquidações.

---

## ⚙️ 5. MODELAGEM DE DADOS (PRISMA SCHEMA)
\`\`\`prisma
// Schemas relacionais (Customer, Charge, Subscription, Product, Transaction)
\`\`\`

---

## 🔒 6. MATRIZ DE ARQUIVOS AFETADOS (FILES_SCOPE)
\`\`\`json
{
  "files_scope": [
    "package.json",
    "prisma/schema.prisma",
    "src/config/env.ts",
    "src/modules/finance/finance.service.ts",
    "tests/finance.spec.ts"
  ]
}
\`\`\`

---

## 🔒 7. PLANO DE AUDITORIA MECÂNICA & DUPLA-LENTE
- **Lente 1 (Mecânica):** Linter + Checagem de Tipos (\`tsc --noEmit\`) + Vitest.
- **Lente 2 (Auditor Cego):** Validação de regras de negócio e segurança na quarentena.

---
*Para iniciar a construção autônoma na quarentena, aprove a Spec Canônica.*`;
  }
}
