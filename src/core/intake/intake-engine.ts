/**
 * Intake Engine (NextCode v5)
 * Classifica e gerencia a entrada de intenções do usuário nos 4 Cenários Intelectuais:
 * - Scenario A: Intenção Macro / SaaS (Requer Elicitação + Spec Canônica + User Spec Approval Lock)
 * - Scenario B: Intenção Micro / Quick Fix (Gera Brief Híbrido direto com files_scope)
 * - Scenario C: Intenção Ambígua / Solta (Intervenção ativa na 3ª rodada com 3 caminhos)
 * - Scenario D: Dúvida / Consultivo (Resposta LLM direta, bypass de DAG/IO)
 */

import { renderCanonicalSpecDocument, parseSpecDocument } from "./spec-format";
import { checkSpecStructure } from "./spec-check";
import { loadRoleSkill, buildSkillSystemPrompt } from "@/core/skills/skill-runtime";
import type { DecompositionResult } from "@/core/skills/spec-decomposer";
import {
  validateSpecMechanical,
  type MacrobriefDocument,
  type MicrobriefAndReportDocument,
} from "@/core/templates/artifact-templates";
import {
  transition,
  type PhaseContext,
  type ConferenceCulprit,
} from "@/core/orchestrator/phase-machine";
import { decideMacrobriefUncertainty } from "@/core/decision/jev-decisions";
import { SmartRouter, type DispatchMessage } from "@/core/router/smart-router";
import prisma from "@/lib/prisma";
import { readSecret } from "@/core/security/crypto";
import { detectClusterGaps, type ClusterException } from "@/core/intake/cluster-gaps";
import { callElicitadorClaude } from "@/core/llm/elicitador-claude";
import { recordLlmCost } from "@/core/llm/cost";
import {
  classificarTextoDeMacrobrief,
  documentoDeMacrobrief,
  macrobriefFixoDaSpec,
  textoParaOConferente,
  type ElicitadorMacrobrief,
} from "@/core/intake/macrobrief-elicitador";

export type IntakeScenario = "SCENARIO_A" | "SCENARIO_B" | "SCENARIO_C" | "SCENARIO_D";

export interface IntakeAnalysisResult {
  scenario: IntakeScenario;
  reasoning: string;
  requiresSpecApproval: boolean;
  requiresIntervention: boolean;
  suggestedAction: string;
}

export interface ElicitadorAnalistaCycleOptions {
  sessionId?: string;
  initialSpec: string;
  /** Lacunas já devolvidas uma vez ao elicitador (não contam em voltasConferencia). */
  clusterGapsJaDevolvidos?: string[];
  excecoesCluster?: ClusterException[];
  onRepairCycle?: (
    cycleNumber: number,
    culprit: ConferenceCulprit,
    problems: string[],
    currentSpec: string
  ) => Promise<string> | string;
  /** Laudo pronto, só em teste: o ciclo não chama o modelo do conferente. */
  laudoInjetado?: {
    aprovado: boolean;
    falhas: Array<{ req: string; tipo: string; descricao: string; correcao: string }>;
    incertos: Array<{ req: string; pergunta: string }>;
  };
}

export interface ElicitadorAnalistaCycleResult {
  ok: boolean;
  cyclesUsed: number;
  elicitadorSkillLoaded: string;
  analistaSkillLoaded: string;
  finalPhaseContext: PhaseContext;
  finalSpec: string;
  macrobrief?: MacrobriefDocument;
  /** Texto único do Macrobrief, Markdown com YAML, o que o conferente leu. */
  macrobriefTexto?: string;
  macrobriefElicitador?: ElicitadorMacrobrief;
  microbriefs?: MicrobriefAndReportDocument[];
  decomposition?: DecompositionResult;
  problems: string[];
  /** Jev não respondeu o incerto: pergunta ao humano, sem gastar volta. */
  pausaSemTentativa?: boolean;
  /** A mesma lacuna de cluster voltou: o humano precisa nomear o cluster. */
  perguntaHumana?: boolean;
  clusterGaps?: string[];
}

async function escreverMacrobriefDoElicitador(spec: string, sessionId?: string): Promise<string | null> {
  const skill = loadRoleSkill("elicitador");
  const messages: DispatchMessage[] = [
    {
      role: "system",
      content:
        buildSkillSystemPrompt(skill) +
        "\n\nA Spec já foi aprovada. Escreva SOMENTE o Macrobrief, em Markdown com frontmatter YAML, no formato da skill. Sem contrato TypeScript e sem etapas.",
    },
    { role: "user", content: spec },
  ];
  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  const claudeKey = readSecret(setting?.claudeKey);
  if (claudeKey) {
    const claude = await callElicitadorClaude({ messages, claudeKey });
    if (claude.ok && claude.text.trim()) {
      await recordLlmCost({
        sessionId,
        papel: "elicitador",
        provider: "claude",
        model: claude.model,
        usage: claude.usage,
      }).catch(() => 0);
      return claude.text;
    }
  }
  try {
    const smartRouter = new SmartRouter();
    const dispatchRes = await smartRouter.dispatchWithFallback({
      messages,
      tier: "heavy",
      geminiKey: readSecret(setting?.geminiKey),
      omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
      omniRouteKey: readSecret(setting?.omniRouteKey),
      stream: false,
    });
    if (!dispatchRes) return null;
    const resJson = await dispatchRes.response.json().catch(() => ({}));
    const content = String(resJson.choices?.[0]?.message?.content || "");
    await recordLlmCost({
      sessionId,
      papel: "elicitador",
      provider: String(dispatchRes.providerUsed),
      model: String(dispatchRes.modelUsed || ""),
      usage: resJson.usage,
    }).catch(() => 0);
    return content.trim() ? content : null;
  } catch {
    return null;
  }
}

function extractJsonObject(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : trimmed).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("sem objeto JSON");
  return JSON.parse(raw.slice(start, end + 1));
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
  - id: idioma
    regra: "Todas as respostas, explicações, especificações e comunicações com o usuário DEVEM ser estritamente em Português do Brasil (pt-BR)."
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

  /**
   * Item 7 do PLANO-DE-ACAO.md (Trava T8a + T8b):
   * Executa o ciclo de conferência entre a skill `elicitador` e a skill `analista` (até 3 ciclos de reparo;
   * na 4ª falha bloqueia a sessão com AVISAR_HUMANO).
   */
  public static async runElicitadorAndAnalistaCycle(
    options: ElicitadorAnalistaCycleOptions
  ): Promise<ElicitadorAnalistaCycleResult> {
    const elicitadorSkill = loadRoleSkill("elicitador");
    const analistaSkill = loadRoleSkill("analista");

    let currentSpec = options.initialSpec;
    let ctx: PhaseContext = {
      phase: "SPEC_REVISAO",
      rodadasSemClareza: 0,
      voltasConferencia: 0,
    };

    const approveStep = transition(ctx, { type: "SPEC_APROVADA" }, { etapa1Ativa: true });
    if (approveStep.ok) ctx = approveStep.ctx;

    let cyclesUsed = 0;

    while (true) {
      if (ctx.phase === "MACROBRIEF" || ctx.phase === "SPEC_REVISAO") {
        if (ctx.phase === "SPEC_REVISAO") {
          const stepA = transition(ctx, { type: "SPEC_APROVADA" }, { etapa1Ativa: true });
          if (stepA.ok) ctx = stepA.ctx;
        }
        const stepM = transition(ctx, { type: "MACROBRIEF_PRONTO" }, { etapa1Ativa: true });
        if (stepM.ok) ctx = stepM.ctx;
      }

      cyclesUsed += 1;
      const parsed = parseSpecDocument(currentSpec);
      const specProblems: string[] = [];

      if (!parsed) {
        specProblems.push("Frontmatter YAML da Spec inválido ou ausente.");
      } else {
        specProblems.push(...checkSpecStructure(parsed));
        const reqIds = parsed.requisitosIds ?? [];
        if (reqIds.length === 0) {
          specProblems.push("A Spec deve declarar requisitos_ids (REQ-001...) no frontmatter.");
        } else {
          const validStatus =
            parsed.status === "rascunho" ||
            parsed.status === "aguardando_aprovacao" ||
            parsed.status === "aprovada"
              ? parsed.status
              : "aprovada";
          const reqTable = (parsed.requisitos ?? []).map((r) => ({
            id: r.id,
            titulo: r.titulo || `Requisito ${r.id}`,
            descricaoECriterio: `${r.titulo}: ${r.criterio} (Critério de aceite verificável para ${r.id})`,
          }));
          const mechSpec = validateSpecMechanical({
            documento: "spec",
            projeto: parsed.titulo || "projeto",
            versao: 1,
            status: validStatus,
            criadoEm: parsed.data || "2026-10-06",
            atualizadoEm: parsed.data || "2026-10-06",
            tipoInterface: "nenhuma_somente_api",
            requisitosIds: reqIds,
            duvidasEmAberto: [],
            requisitosTabela:
              reqTable.length > 0
                ? reqTable
                : reqIds.map((id) => ({
                    id,
                    titulo: `Requisito ${id}`,
                    descricaoECriterio: `Implementação completa e verificável do requisito ${id}.`,
                  })),
          });
          if (!mechSpec.valid) {
            specProblems.push(...mechSpec.errors);
          }
        }
      }

      if (specProblems.length === 0 && parsed) {
        const reqIds =
          parsed.requisitosIds && parsed.requisitosIds.length > 0
            ? parsed.requisitosIds
            : (parsed.requisitos ?? []).map((r) => r.id);
        const skipElicitador =
          process.env.NODE_ENV === "test" && process.env.ENABLE_ELICITADOR_MACROBRIEF !== "true";
        const textoGerado = skipElicitador
          ? macrobriefFixoDaSpec(parsed).texto
          : (await escreverMacrobriefDoElicitador(currentSpec, options.sessionId)) ?? "";
        const classificado = classificarTextoDeMacrobrief(textoGerado, parsed.arquivosAfetados ?? [], reqIds);
        if (classificado.tipo === "pausa") {
          return {
            ok: false,
            cyclesUsed,
            elicitadorSkillLoaded: elicitadorSkill.name,
            analistaSkillLoaded: analistaSkill.name,
            finalPhaseContext: ctx,
            finalSpec: currentSpec,
            pausaSemTentativa: true,
            problems: [classificado.motivo],
          };
        }
        if (classificado.tipo === "reprovado") {
          specProblems.push(...classificado.erros);
        }
        const macroDoc = classificado.tipo === "valido" ? classificado.doc : null;
        const macroTexto = classificado.tipo === "valido" ? classificado.texto : "";
        const macrobrief = macroDoc ? documentoDeMacrobrief(macroDoc, parsed.titulo) : undefined;

        if (macroDoc && macrobrief) {
          const gaps = detectClusterGaps({
            arquivos: parsed.arquivosAfetados ?? [],
            requisitosTexto: (parsed.requisitos ?? [])
              .map((r) => `${r.titulo} ${r.criterio}`)
              .join("\n"),
            notas: parsed.notasImplementacao ?? [],
            entidades: parsed.entidades?.length ?? 0,
            clustersPresentes: macroDoc.clustersAtivos,
            excecoes: options.excecoesCluster,
          });
          if (gaps.length > 0) {
            const already = new Set(options.clusterGapsJaDevolvidos ?? []);
            const novos = gaps.filter((g) => !already.has(g.gap));
            const perguntaHumana = novos.length === 0;
            return {
              ok: false,
              cyclesUsed,
              elicitadorSkillLoaded: elicitadorSkill.name,
              analistaSkillLoaded: analistaSkill.name,
              finalPhaseContext: ctx,
              finalSpec: currentSpec,
              macrobrief,
              macrobriefTexto: macroTexto,
              macrobriefElicitador: macroDoc,
              problems: gaps.map((g) => `[${g.gap}] ${g.pergunta}`),
              perguntaHumana,
              clusterGaps: gaps.map((g) => g.gap),
            };
          }

          // Gap 2: Chamada real à Skill Conferente via modelo
          const conferenteSkill = loadRoleSkill("conferente-macrobrief");
          const conferenteSystemPrompt = buildSkillSystemPrompt(conferenteSkill, { includeLocalReferences: true });

          interface ConferenteLaudo {
            aprovado: boolean;
            falhas: Array<{ req: string; tipo: string; descricao: string; correcao: string }>;
            incertos: Array<{ req: string; pergunta: string }>;
          }

          let laudoConferente: ConferenteLaudo = {
            aprovado: true,
            falhas: [],
            incertos: [],
          };
          let pausaConferente: string | null = null;

          // Em teste o laudo mecânico (lacunas + T8) vale, para a suíte não depender de chave.
          // Produção chama o modelo. ENABLE_CONFERENTE_LLM=true força a chamada também em teste.
          const skipConferenteLlm =
            options.laudoInjetado != null ||
            (process.env.NODE_ENV === "test" && process.env.ENABLE_CONFERENTE_LLM !== "true");

          if (options.laudoInjetado) {
            laudoConferente = options.laudoInjetado;
          } else if (!skipConferenteLlm) {
          // Gap 1 e 2: Chamar o conferente com as chaves do banco (não env), no tier forte, e extrair choices[0].message.content
          const setting = await prisma.setting.findUnique({ where: { id: "default" } });
          const smartRouter = new SmartRouter();
          const messages: DispatchMessage[] = [
            { role: "system", content: conferenteSystemPrompt },
            {
              role: "user",
              content: textoParaOConferente(currentSpec, macroTexto),
            },
          ];

          try {
            const dispatchRes = await smartRouter.dispatchWithFallback({
              messages,
              tier: "heavy", // Skill pede nivel_modelo: forte
              geminiKey: readSecret(setting?.geminiKey),
              omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
              stream: false,
            });

            if (dispatchRes) {
              const resJson = await dispatchRes.response.json().catch(() => ({}));
              const content = resJson.choices?.[0]?.message?.content || "";

              if (!content) {
                pausaConferente = "O conferente não devolveu o laudo.";
              } else {
                try {
                  const parsedLaudo = extractJsonObject(content) as {
                    aprovado?: unknown;
                    falhas?: unknown;
                    incertos?: unknown;
                  };
                  laudoConferente = {
                    aprovado: parsedLaudo.aprovado === true, // Ausente ≠ true
                    falhas: Array.isArray(parsedLaudo.falhas) ? parsedLaudo.falhas : [],
                    incertos: Array.isArray(parsedLaudo.incertos) ? parsedLaudo.incertos : [],
                  };
                } catch {
                  pausaConferente = "O laudo do conferente não é um JSON válido.";
                }
              }
            } else {
              pausaConferente = "O modelo do conferente não respondeu.";
            }
          } catch (err) {
            console.warn("[INTAKE] Exceção ao chamar conferente-macrobrief:", err);
            pausaConferente = "O modelo do conferente não respondeu.";
          }
          }

          if (pausaConferente) {
            return {
              ok: false,
              cyclesUsed,
              elicitadorSkillLoaded: elicitadorSkill.name,
              analistaSkillLoaded: analistaSkill.name,
              finalPhaseContext: ctx,
              finalSpec: currentSpec,
              macrobrief,
              macrobriefTexto: macroTexto,
              macrobriefElicitador: macroDoc,
              pausaSemTentativa: true,
              problems: [pausaConferente],
            };
          }

          // Se houver falhas, reprova imediatamente
          if (laudoConferente.falhas.length > 0 || laudoConferente.aprovado !== true) {
            const falhas =
              laudoConferente.falhas.length > 0
                ? laudoConferente.falhas
                : [{ req: "GERAL", tipo: "reprovado", descricao: "Laudo reprovado.", correcao: "Reescreva o Macrobrief." }];
            specProblems.push(
              ...falhas.map(
                (f) => `[CONFERENTE] REQ ${f.req} (${f.tipo}): ${f.descricao} → Correção: ${f.correcao}`
              )
            );
          }

          // Se houver incertezas, resolver via Jev — GAP 2 (Flow): decisão agora dirige o fluxo
          if (laudoConferente.incertos.length > 0) {
            const decisaoJev = await decideMacrobriefUncertainty({
              incertos: laudoConferente.incertos,
              sessionId: options.sessionId,
            });
            if (!decisaoJev.resolvido) {
              // Jev calado ou incerto: pergunta ao humano pela voz do elicitador.
              // Não gasta volta de conferência (o contexto local não avança).
              return {
                ok: false,
                cyclesUsed,
                elicitadorSkillLoaded: elicitadorSkill.name,
                analistaSkillLoaded: analistaSkill.name,
                finalPhaseContext: ctx,
                finalSpec: currentSpec,
                macrobrief,
                macrobriefTexto: macroTexto,
                macrobriefElicitador: macroDoc,
                pausaSemTentativa: true,
                problems: laudoConferente.incertos.map(
                  (i) => `[INCERTEZA] REQ ${i.req}: ${i.pergunta}`
                ),
              };
            }
          }

          if (laudoConferente.aprovado === true && laudoConferente.falhas.length === 0 && specProblems.length === 0) {
            const okStep = transition(ctx, { type: "CONFERENCIA_OK" }, { etapa1Ativa: true });
            if (okStep.ok) ctx = okStep.ctx;
            return {
              ok: true,
              cyclesUsed,
              elicitadorSkillLoaded: elicitadorSkill.name,
              analistaSkillLoaded: analistaSkill.name,
              finalPhaseContext: ctx,
              finalSpec: currentSpec,
              macrobrief,
              macrobriefTexto: macroTexto,
              macrobriefElicitador: macroDoc,
              problems: [],
            };
          }
        }
      }

      const culprit: ConferenceCulprit = specProblems.some(
        (p) =>
          p.includes("[CONFERENTE") ||
          p.includes("Macrobrief") ||
          p.includes("Microbrief") ||
          p.includes("Omissão de requisitos") ||
          p.includes("Invenção de escopo") ||
          p.includes("Insuficiência de arquivos") ||
          p.includes("Ordem de dependências invertida")
      )
        ? "macrobrief"
        : "spec";

      const failStep = transition(
        ctx,
        { type: "CONFERENCIA_FALHOU", culpa: culprit },
        { etapa1Ativa: true }
      );
      if (failStep.ok) {
        ctx = failStep.ctx;
      }

      if (ctx.phase === "BLOQUEADA" || !options.onRepairCycle) {
        return {
          ok: false,
          cyclesUsed,
          elicitadorSkillLoaded: elicitadorSkill.name,
          analistaSkillLoaded: analistaSkill.name,
          finalPhaseContext: ctx,
          finalSpec: currentSpec,
          problems: specProblems,
        };
      }

      currentSpec = await options.onRepairCycle(cyclesUsed, culprit, specProblems, currentSpec);
    }
  }
}
