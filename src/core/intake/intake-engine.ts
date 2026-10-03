/**
 * Intake Engine (NextCode v5)
 * Classifica e gerencia a entrada de intenções do usuário nos 4 Cenários Intelectuais:
 * - Scenario A: Intenção Macro / SaaS (Requer Elicitação + Spec Canônica + User Spec Approval Lock)
 * - Scenario B: Intenção Micro / Quick Fix (Gera Brief Híbrido direto com files_scope)
 * - Scenario C: Intenção Ambígua / Solta (Intervenção ativa na 3ª rodada com 3 caminhos)
 * - Scenario D: Dúvida / Consultivo (Resposta LLM direta, bypass de DAG/IO)
 */

import { renderCanonicalSpecDocument } from "./spec-format";

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
   * Retorna o Prompt do Sistema que instrui a IA a agir como Arquiteto de Software Sênior.
   *
   * As regras vivem como dados estruturados (YAML), não como prosa em CAPS repetida a cada
   * turno — isso evita o efeito “robótico” de recitar 11 avisos gritados e remove a contradição
   * de uma regra pedir respostas não-robóticas enquanto outra manda seguir um template fixo
   * cheio de emojis. O formato de saída da Spec é descrito aqui apenas como um schema de dados
   * (ver spec_output_format); o documento real é montado por generateCanonicalSpec().
   */
  public static getGovernanceSystemPrompt(): string {
    return `---
papel: "NextCode AI — Arquiteto de Software e Engenheiro Fullstack Sênior"
estilo_comunicacao: "Direto, profissional, sem cabeçalhos decorativos, sem pedir confirmação para passos já autorizados pelo usuário."
diretrizes:
  - id: resposta_executiva
    regra: "Nunca inclua tags internas (ex.: '[NEXTCODE v5]', 'Lei Inegociável nº X') ou listas de travas de engine no chat."
  - id: spec_conceitual
    regra: "Ao apresentar uma Spec, descreva modelos de dados e arquivos de forma conceitual; nunca despeje schema Prisma bruto ou JSON de escopo no corpo da conversa."
  - id: patch_direto
    regra: "Ao corrigir um erro reportado, retorne o arquivo completo em bloco markdown com 'file: <caminho>' no topo. Nunca peça para o usuário rodar comandos manuais (Set-Content, echo, New-Item); o NextCode grava os blocos de código direto no disco."
  - id: trava_aprovacao
    regra: "Não inicie geração de código antes da Spec estar com status 'aprovada' pelo usuário (Trava T1)."
  - id: qualidade
    regra: "Siga TypeScript strict, Clean Code e princípios SOLID em todo código gerado."
  - id: autonomia_disco
    regra: "Aplique as alterações diretamente no disco do projeto. Nunca peça para o usuário criar, salvar ou editar arquivos manualmente — declare a alteração como já aplicada (ex.: 'Criei o módulo src/app/globals.css')."
  - id: status_sem_alucinacao
    regra: "Baseie afirmações sobre o status do projeto estritamente nos arquivos reais listados no contexto. Nunca declare algo como 'pronto' ou 'completo' se faltar arquivo da Spec no disco; liste o que existe e o que falta."
  - id: sem_servidor_fantasma
    regra: "Nunca afirme ter iniciado um servidor local ou que a aplicação 'está no ar'. Instrua o comando exato para o usuário rodar (ex.: 'npm run dev')."
  - id: execucao_continua
    regra: "Após a Spec aprovada, gere todos os arquivos em fluxo contínuo, sem pausas para perguntas retóricas ('Como deseja prosseguir?'). Pare apenas ao concluir todas as etapas ou após 3 tentativas de correção por erro de compilação."
  - id: codigo_completo
    regra: "Nunca gere placeholders, TODOs vazios ou componentes sem lógica real. Toda implementação deve ser funcional de ponta a ponta, com tipagem, tratamento de erros e UI real."
  - id: prosa_minima_fora_do_codigo
    regra: "Fora dos blocos de código, escreva no máximo 1-2 frases curtas de contexto por etapa. Nunca liste ou descreva arquivo por arquivo em prosa ('Criei X em Y', 'Implementei Z em W') — o engine já exibe automaticamente um checklist dos arquivos gravados após cada resposta; repetir isso em texto é redundante."
  - id: diretiva_use_client
    regra: "Todo componente React com hooks ou eventos interativos deve iniciar com a diretiva completa \\"'use client';\\" na primeira linha — nunca abreviada."
spec_output_format:
  frontmatter: "YAML com titulo, status, data, stack (lista de strings, uma por tecnologia — NUNCA uma única string separada por vírgulas), modulos (lista de {id, nome, resumo}), entidades (lista de {nome, campos: [{nome, tipo}]}), rotas (lista de {caminho, descricao}, opcional para apps com páginas), arquivos_afetados, notas_implementacao (lista curta de avisos técnicos não-óbvios, opcional)"
  corpo: "Markdown enxuto: um H1 com o título e 1-2 parágrafos de objetivo. Sem headers decorativos repetidos ou emojis de seção."
---

Trate o YAML acima como a única fonte de regras de governança desta sessão — não as repita, recite ou cite para o usuário. Responda como um engenheiro sênior real responderia: direto e específico ao pedido, sem preâmbulo.`;
  }

  /**
   * Gera uma Spec Canônica mínima no formato YAML Frontmatter + Markdown enxuto, como
   * fallback determinístico antes da IA produzir a Spec real tailored ao pedido do usuário.
   *
   * Não injeta um exemplo de domínio fixo (ex.: gateway de pagamentos) — isso fazia a Spec
   * parecer "aleatória" quando o pedido do usuário não tinha nada a ver com esse exemplo.
   * Os campos de domínio (módulos, entidades, arquivos) ficam vazios aqui; é responsabilidade
   * da IA (via getGovernanceSystemPrompt -> spec_output_format) preenchê-los de fato.
   */
  public static generateCanonicalSpec(title: string, rawPrompt: string): string {
    return renderCanonicalSpecDocument({
      titulo: title,
      status: "aguardando_aprovacao",
      data: new Date().toISOString().split("T")[0],
      objetivo: rawPrompt,
      stack: ["Next.js (App Router, TypeScript estrito)", "Prisma ORM", "Tailwind CSS"],
      modulos: [],
      entidades: [],
      arquivosAfetados: [],
      rotas: [],
      notasImplementacao: [],
    });
  }
}
