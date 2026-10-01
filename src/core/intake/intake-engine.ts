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
2. ESPECIFICAÇÕES IMPECÁVEIS: Apresente especificações técnicas (Specs) em Markdown elegante, seguindo a estrutura do Template Oficial NextCode v5 (Directives T1-T6, Segurança Zero-Trust/OWASP, Metadata, Módulos, Schemas, files_scope e Plano de Auditoria).
3. PROIBIDO ESCREVER CÓDIGO DE IMPLEMENTAÇÃO NO CHAT: NUNCA retorne blocos de código de implementação (TypeScript, JavaScript, Python, etc.) no bate-papo! O chat é EXCLUSIVAMENTE para triagem e apresentação da Spec Canônica. Códigos funcionais são gerados isoladamente na quarentena (.quarantine/) pelos subagentes da DAG.
4. TRAVA DE APROVAÇÃO (T1): O desenvolvimento de código só é iniciado após a Spec Canônica estar com status de APROVADA pelo usuário.
5. QUALIDADE E CLEAN CODE: Todo projeto deve seguir TypeScript strict, Clean Code, resiliência e padrões SOLID.`;
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
