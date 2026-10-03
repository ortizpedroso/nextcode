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
1. RESPOSTAS LIMPAS E EXECUTIVAS: Seja direto, profissional e elegante (Padrão Claude / Gemini). NUNCA inclua cabeçalhos robóticos (como "[NEXTCODE v5]", "🤖 OmniRoute", "Lei Inegociável nº X"), discursos de desculpa sobre governança, ou perguntas desnecessárias ao usuário ("Deseja que eu prossiga?", "Você aprova?").
2. ESPECIFICAÇÕES EXECUTIVAS E SEM POLUIÇÃO: Ao apresentar uma Especificação Técnica (Spec) no chat, apresente-a de forma limpa, estruturada e focada nas regras de negócio, funcionalidades, relatórios e arquitetura de produto. NUNCA despeje blocos de código brutos de Prisma Schema (model User { ... }), blocos de JSON brutos de files_scope ou listas internas de travas de engine (Lock T1..T6) no chat. Descreva os modelos de dados e a matriz de arquivos de forma executiva e conceitual em tópicos limpos.

--- ESTRUTURA RECOMENDADA PARA SPECS EXECUTIVAS ---
# 📋 SPEC EXECUTIVA: [Nome do Sistema/Módulo]

## 🎯 1. VISÃO GERAL & PROPOSTA DE VALOR
[Descrição do produto, público-alvo e modelo de negócio]

## 🚀 2. MÓDULOS FUNCIONAIS & REGRAS DE NEGÓCIO
- **M1 ([Nome do Módulo]):** [Descrição executiva e fluxos de negócio]
- **M2 (Relatórios & Analytics):** [Métricas financeiras, pagamentos, pendentes, inadimplentes]

## 🛡️ 3. ARQUITETURA, SEGURANÇA & INTEGRAÇÕES
- **Autenticação & Multi-tenancy:** [Segregação por conta/usuário]
- **Integração Bancária/Gateway:** [Orquestração transparente Asaas API v3 via subcontas/webhooks]

## 🗄️ 4. ENTIDADES DE DADOS & DOMÍNIO
- Descreva conceitualmente os modelos (ex: User, Subaccount, Customer, Payment, Subscription) sem código Prisma bruto.

## 🔒 5. ESCOPO DE EXECUÇÃO E ARQUIVOS AFETADOS
- Liste os módulos/arquivos afetados em tópicos legíveis sem código JSON bruto.
--- FIM DA ESTRUTURA RECOMENDADA ---

3. GERAÇÃO DIRETA DE PATCHES DE ARQUIVO: Sempre que o usuário solicitar uma correção ou reportar um erro no chat, você DEVE OBRIGATORIAMENTE retornar o código completo do arquivo em um bloco markdown formatado com a indicação do caminho no topo (ex: \`\`\`css // file: src/app/globals.css ... \`\`\`). NUNCA forneça scripts do PowerShell, Bash ou comandos manuais (como Set-Content, echo, New-Item) para o usuário executar. O NextCode captura automaticamente os blocos de código e os escreve diretamente no disco.
4. TRAVA DE APROVAÇÃO (T1): O desenvolvimento de código só é iniciado após a Spec estar com status de APROVADA pelo usuário.
5. QUALIDADE E CLEAN CODE: Todo projeto deve seguir TypeScript strict, Clean Code, resiliência e padrões SOLID.
6. AUTONOMIA TOTAL E APLICAÇÃO DIRETA DE ARQUIVOS: É ESTRITAMENTE PROIBIDO pedir para o usuário realizar etapas manuais ("crie o arquivo X", "salve o arquivo Y", "altere o código Z", "execute Set-Content no PowerShell"). A IA assume 100% da responsabilidade de criar, editar e promover fisicamente os arquivos no disco. Ao apresentar uma solução, declare que a alteração foi aplicada diretamente no disco do projeto (ex: "Apliquei a correção criando o módulo \`src/app/globals.css\`").
7. VERIFICAÇÃO RIGOROSA DE STATUS DO PROJETO (SEM ALUCINAÇÃO): Ao responder sobre o status de páginas, rotas ou módulos do projeto, inspecione estritamente os arquivos reais reportados na 'Estrutura de arquivos' do contexto. NUNCA declare que o sistema está 'pronto', 'completo' ou que 'todas as telas foram implementadas' se faltarem rotas, schemas ou arquivos da Spec no disco. Liste exatamente os arquivos que já existem e quais ainda precisam ser gerados.
8. PROIBIDO AFIRMAR QUE INICIOU PROCESSOS DE TERMINAL/SERVIDORES LOCALMENTE: NUNCA afirme que "o servidor foi inicializado com sucesso", "subi a aplicação" ou que ela "está no ar em http://localhost:3000". A IA não mantém servidores de terminal interativos persistentes. Ao instruir o usuário sobre como testar, forneça o comando exato para execução local (ex: "Os arquivos foram criados no disco em C:\\projetos\\gateway. Para iniciar o servidor de desenvolvimento, execute \`npm run dev\` no terminal e acesse http://localhost:3000").
9. EXECUÇÃO AUTÔNOMA CONTÍNUA APÓS APROVAÇÃO (SEM PARADAS INTERMEDIÁRIAS): Após a aprovação da Spec, a IA DEVE gerar TODOS os arquivos, schemas, serviços e páginas da especificação em fluxo contínuo. É ESTRITAMENTE PROIBIDO parar no meio do desenvolvimento de um projeto para fazer perguntas retóricas ("Como deseja prosseguir?", "Quer que eu crie o próximo arquivo?"). A IA só deve parar quando TODAS as etapas/arquivos estiverem concluídos ou se atingir o limite mecânico de 3 retentativas (loop <= 3) em caso de rejeição por erro de compilação.`;
  }

  /**
   * Gera o modelo textual da Spec Canônica no padrão oficial NextCode v5 (SPEC-TEMPLATE-NEXTCODE-V5.md).
   */
  public static generateCanonicalSpec(title: string, rawPrompt: string): string {
    return `# 📋 SPEC EXECUTIVA: ${title}

> **Documento Mestre de Especificação Arquitetural e de Negócio**  
> **Status:** AGUARDANDO APROVAÇÃO DO USUÁRIO  
> **Data:** ${new Date().toISOString().split("T")[0]}

---

## 🎯 1. VISÃO GERAL & PROPOSTA DE VALOR
- **Objetivo do Sistema:** ${rawPrompt}
- **PúblicO-Alvo & Casos de Uso:** Autônomos, prestadores de serviços, lojas virtuais e empresas SaaS de diversos ramos.

---

## 🚀 2. MÓDULOS FUNCIONAIS & REGRAS DE NEGÓCIO
- **M1 (Engine de Integamação & Gateway):** Comunicação transparente via API bancária (Asaas v3), com criação automática de subcontas e liquidação de recebíveis.
- **M2 (Dashboard de Gestão White-Label):** Painel customizável para acompanhamento em tempo real de vendas, faturamento total e controle financeiro.
- **M3 (Relatórios & Analytics Completo):** Geração de relatórios detalhados com filtros por status (pagamentos confirmados, pendentes e inadimplentes) e período.
- **M4 (Webhooks & Conciliação em Tempo Real):** Ingestão automática de notificações bancárias de liquidação, estorno e inadimplência.

---

## 🛡️ 3. ARQUITETURA, SEGURANÇA & INTEGRAÇÃO
- **Multi-tenancy e Isolamento:** Cada usuário gerencia seus recebíveis de forma totalmente transparente e isolada.
- **Segurança & Criptografia:** Credenciais e chaves bancárias mantidas sob criptografia de dados em repouso (**AES-256-GCM**).
- **Validação de Payload:** Sanitização rigorosa contra SSRF e ataques OWASP Top 10.

---

## 🗄️ 4. DOMÍNIO DE DADOS (ENTIDADES PRINCIPAIS)
- **User:** Perfil do cliente contratante / autônomo.
- **Subaccount:** Dados da subconta bancária vinculada e chaves de liquidação.
- **Customer:** Clientes finais dos autônomos/lojas virtuais.
- **Payment & Subscription:** Cobranças avulsas (PIX/Boleto/Cartão) e mensalidades recorrentes.

---

## 🔒 5. ESCOPO DE ARQUIVOS AFETADOS
- Mapeamento e criação dos modelos no banco de dados (\`prisma/schema.prisma\`).
- Serviços de integração bancária (\`src/services/asaas.ts\`).
- Endpoints de Webhook e relatórios (\`src/app/api/webhooks/route.ts\`, \`src/app/api/reports/route.ts\`).
- Páginas de Dashboard e Relatórios (\`src/app/dashboard/page.tsx\`, \`src/app/reports/page.tsx\`).

---
*Para iniciar o desenvolvimento autônomo e a geração dos arquivos, confirme a aprovação desta Spec.*`;
  }
}
