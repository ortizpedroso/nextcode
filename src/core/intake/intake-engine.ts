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
   * sem gerar poluição visual, preâmbulos robóticos ou diálogos burocráticos sobre regras internas.
   */
  public static getGovernanceSystemPrompt(): string {
    return `Você é a NextCode AI, Arquiteto de Software e Engenheiro Fullstack Sênior.
DIRETRIZES DE COMUNICAÇÃO E EXECUÇÃO:
1. RESPOSTAS LIMPAS E EXECUTIVAS: Seja direto, profissional e elegante. NUNCA inclua cabeçalhos robóticos (como "[NEXTCODE v5]", "🤖 OmniRoute", "Lei Inegociável nº X"), discursos de desculpa sobre governança, ou perguntas desnecessárias ao usuário ("Deseja que eu prossiga?", "Você aprova?").
2. ESPECIFICAÇÕES IMPECÁVEIS: Apresente especificações técnicas (Specs) em Markdown elegante, limpo e estruturado (usando tabelas, badges, seções de Arquitetura, Entidades, Módulos e Endpoints). NUNCA exiba blocos YAML crus ou metadados de governança que poluem a leitura.
3. DESENVOLVIMENTO AUTÔNOMO: Quando o usuário solicitar a criação de um projeto ou feature, projete a arquitetura completa e implemente os arquivos funcionais sem travar a conversa pedindo autorização a cada sub-etapa.
4. QUALIDADE E CLEAN CODE: Todo código produzido deve seguir TypeScript strict, Clean Code e padrões SOLID.`;
  }

  /**
   * Gera o modelo textual da Spec Canônica formatada elegantemente.
   */
  public static generateCanonicalSpec(title: string, rawPrompt: string): string {
    return `# 📐 Especificação Técnica: ${title}

> **Projeto:** \`${title.toLowerCase()}\` | **Status:** Especificado & Pronto para Execução

---

### 1. 🎯 Visão Geral & Objetivos
${rawPrompt}

---

### 2. 🏗️ Arquitetura & Stack Tecnológica

| Camada | Tecnologia | Função |
| :--- | :--- | :--- |
| **Backend API** | Node.js + Express (TypeScript) | API RESTful modular e escalável |
| **Persistência** | Prisma ORM + SQLite | Banco de dados com migrations e relacional |
| **Integração** | Asaas API v3 Client | Processamento de Pix, Boleto e Recorrência |
| **Validação & Testes** | Zod + Vitest | Validação de schemas e suíte de testes unitários |

---

### 3. 📦 Módulos Principais

1. **Clientes (\`customers\`):** Cadastro e sincronização de autônomos e pagadores.
2. **Cobranças Avulsas (\`charges\`):** Emissão imediata via Pix (QR Code), Boleto e Cartão.
3. **Assinaturas & Mensalidades (\`subscriptions\`):** Planos recorrentes automatizados.
4. **Webhooks (\`webhooks\`):** Recepção e conciliação de eventos de pagamento do Asaas.

---

### 4. 🚀 Próximos Passos
O desenvolvimento será iniciado via pipeline autônomo.`;
  }
}
