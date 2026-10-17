import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import * as fs from "fs";
import * as path from "path";
import prisma from "@/lib/prisma";
import { readSecret } from "@/core/security/crypto";
import { SmartRouter, AvailableKeys, DispatchMessage } from "@/core/router/smart-router";
import { pruneContextWithHeadroom } from "@/core/headroom/context-pruner";
import { buildProjectContextBlock } from "@/core/project/project-context";
import { resolveSkillOrCommand } from "@/core/skills/skill-resolver";
import { IntakeEngine } from "@/core/intake/intake-engine";
import { InputPreprocessorEngine } from "@/core/intake/input-preprocessor";
import { isExplicitSpecApproval } from "@/core/intake/approval-intent";
import { parseSpecDocument } from "@/core/intake/spec-format";
import { checkSpecStructure } from "@/core/intake/spec-check";
import { IncidentReporter, type FailureAttemptRecord } from "@/core/governance/incident-reporter";
import {
  approveSpecAndStart,
  type ApproveSpecResult,
} from "@/core/orchestrator/execution-trigger";
import { SpecDecomposerSkill } from "@/core/skills/spec-decomposer";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { callElicitadorClaude } from "@/core/llm/elicitador-claude";
import { recordLlmCost } from "@/core/llm/cost";
import {
  decideSpecReviewMessageIntent,
  decideSpecClarity,
  decideGraphifyEligibilityWithJev,
  evaluateChatFanOutWithJev,
  type ChatFanOutDecision,
} from "@/core/decision/jev-decisions";
import { runUniversalIntakeFunnel, formatIntakeFunnelBrief } from "@/core/intake/universal-funnel";
import { autoHealSpecDocument } from "@/core/intake/spec-auto-heal";
import {
  checkSpecCompletenessOnDisk,
  describeUnverifiedBuild,
} from "@/core/orchestrator/node-executor";
import { applyPhaseEvent } from "@/core/orchestrator/session-phase";
import {
  classifyMessage,
  parseInterventionChoice,
} from "@/core/orchestrator/message-intent";
import {
  applyCumulativeSpecGuard,
  buildElicitadorSpecSystemPrompt,
  buildCumulativeSpecSystemPrompt,
} from "@/core/orchestrator/spec-draft";
import { maskSecretsForJev } from "@/core/governance/secret-guard";
import { loadOrchestrationPolicy } from "@/core/config/orchestration-policy";
import { redactSecretsInChatWithJev } from "@/core/governance/secret-guard";
import type { Phase } from "@/core/orchestrator/phase-machine";

/**
 * Monta deterministamente o status da sessão a partir do banco e do disco, SEM chamar LLM (§3, regra 2 / 4b.2).
 */
async function buildDeterministicStatusResponse(sessionId: string): Promise<string> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      project: true,
      tasks: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!session) {
    return "Sessão não encontrada.";
  }

  const currentPhase = (session.phase as Phase) || "ENTRADA";
  const allTasks = session.tasks || [];
  const currentSpecVersion = (session as { specVersion?: number }).specVersion ?? 0;
  const tasks =
    currentSpecVersion > 0
      ? allTasks.filter(
          (t) => ((t as { specVersion?: number }).specVersion ?? 0) === currentSpecVersion
        )
      : allTasks;

  const lines: string[] = [
    `📊 **Status Determinístico da Sessão**`,
    `- **Fase atual:** \`${currentPhase}\``,
    `- **Spec aprovada:** ${session.specApproved ? "Sim" : "Não"}`,
  ];

  if (tasks.length === 0) {
    lines.push(`\n### Nós da DAG\nNenhum nó de execução criado para a versão atual.`);
  } else {
    lines.push(`\n### Nós da DAG (${tasks.length})`);
    for (const t of tasks) {
      lines.push(
        `- **${t.title}** — status: \`${t.status}\` (tentativas: ${t.attempts}/${t.maxAttempts})`
      );
    }
  }

  const completeness = checkSpecCompletenessOnDisk(
    session.canonicalSpec,
    session.project?.path
  );
  if (completeness) {
    lines.push(`\n### Arquivos da Spec × Disco (${completeness.declaredFiles.length} declarados)`);
    const missingSet = new Set(completeness.missingFiles);
    for (const file of completeness.declaredFiles) {
      const exists = !missingSet.has(file);
      lines.push(`- ${exists ? "✅" : "❌"} \`${file}\` (${exists ? "presente no disco" : "faltante no disco"})`);
    }
    if (completeness.missingFiles.length > 0) {
      lines.push(
        `\n⚠️ **Faltam ${completeness.missingFiles.length} arquivo(s) no disco:** ${completeness.missingFiles
          .map((f) => `\`${f}\``)
          .join(", ")}`
      );
    } else {
      lines.push(`\n✅ Todos os arquivos declarados na Spec estão presentes no disco.`);
    }
  } else {
    lines.push(`\n### Arquivos da Spec × Disco\nNenhum arquivo declarado na Spec atual.`);
  }

  const unverifiedWarning = describeUnverifiedBuild(tasks, session.project?.path);
  if (unverifiedWarning) {
    lines.push(unverifiedWarning);
  }

  if (currentPhase === "BLOQUEADA") {
    const blockedDetails = await buildBlockedIncidentSection(sessionId);
    if (blockedDetails) {
      lines.push(`\n${blockedDetails}`);
    }
  }

  return lines.join("\n");
}

/**
 * Monta o relatório de incidente mais recente e as opções para a fase BLOQUEADA (§3, regras 7 e 8 / 4b.2).
 */
async function buildBlockedIncidentSection(sessionId: string): Promise<string> {
  const blockedTasks = await prisma.taskNode.findMany({
    where: { sessionId, status: "blocked" },
    orderBy: { updatedAt: "desc" },
  });

  let reportText = "";
  const latestBlocked = blockedTasks[0];
  if (latestBlocked) {
    let history: FailureAttemptRecord[] = [];
    try {
      history = JSON.parse(latestBlocked.failureHistory || "[]");
    } catch {
      history = [];
    }
    reportText = IncidentReporter.generateIncidentReport(
      latestBlocked.id,
      latestBlocked.title,
      latestBlocked.cluster,
      history,
      { maxAttempts: latestBlocked.maxAttempts }
    );
  } else {
    const lastIncidentMsg = await prisma.message.findFirst({
      where: {
        sessionId,
        role: "assistant",
        content: { contains: "intervenção humana necessária" },
      },
      orderBy: { createdAt: "desc" },
    });
    if (lastIncidentMsg) {
      reportText = lastIncidentMsg.content;
    }
  }

  return [
    "🛑 **Sessão em fase `BLOQUEADA` — intervenção humana necessária.**",
    reportText ? `\n${reportText}` : "",
    "\n### Opções disponíveis:",
    "1. **Retry (Re-tentar):** use o botão **Re-tentar** no painel da DAG para liberar o nó bloqueado mantendo a Spec atual (regra 7).",
    "2. **Ajuste da Spec:** envie no chat o ajuste desejado na Spec para suspender os executores pendentes e revisar uma nova versão da Spec (regra 8).",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Em dúvida avulsa, remove qualquer YAML frontmatter de Spec se o LLM desobedecer ao system prompt (4b.2).
 */
function stripSpecFrontmatterFromQuestionAnswer(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---") && parseSpecDocument(trimmed) === null) {
    return content;
  }
  const withoutFrontmatter = trimmed.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
  return withoutFrontmatter || "Explicação textual sobre o projeto (sem geração de Spec).";
}

export async function POST(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;
  try {
    const body = await request.json();
    const { sessionId, prompt, projectId, modelOverride, attachments } = body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ error: "Mensagem é obrigatória." }, { status: 400 });
    }

    let targetPrompt = prompt.trim();
    if (Array.isArray(attachments) && attachments.length > 0) {
      targetPrompt += `\n\n[ANEXO MULTIMODAL: ${attachments.length} imagem(ns) enviada(s) como contexto visual de interface/diagrama]`;
    }

    // 0. PRÉ-PROCESSADOR UNIVERSAL (Markdown + YAML Frontmatter)
    const preprocessedInput = InputPreprocessorEngine.preprocess(targetPrompt, {
      projectId: projectId || null,
    });

    let activeSessionId = sessionId;

    // 1. Garante uma sessão ativa
    if (!activeSessionId) {
      const session = await prisma.session.create({
        data: {
          title: targetPrompt.length > 30 ? `${targetPrompt.substring(0, 30)}...` : targetPrompt,
          projectId: projectId || null,
        },
      });
      activeSessionId = session.id;
    }

    // 2. Registra mensagem do usuário no banco SQLite
    const userMessage = await prisma.message.create({
      data: {
        sessionId: activeSessionId,
        role: "user",
        content: targetPrompt,
      },
    });

    // 3. Lê a sessão atual para contextualizar a intenção do usuário
    const sessionBefore = await prisma.session.findUnique({
      where: { id: activeSessionId },
      include: { project: true },
    });
    const phaseBefore = ((sessionBefore?.phase as Phase) || "ENTRADA");

    const ctxProjectEarly =
      sessionBefore?.project ??
      (projectId ? await prisma.project.findUnique({ where: { id: projectId } }) : null);

    const isPreExecutionPhase =
      phaseBefore === "SPEC_REVISAO" ||
      phaseBefore === "ELICITACAO" ||
      phaseBefore === "CONVERSA" ||
      phaseBefore === "ENTRADA";

    const smartRouter = new SmartRouter();
    const rawAnalysis = smartRouter.routeTask({ prompt: targetPrompt });

    // Helper para persistir resposta determinística (sem chamar LLM) e devolver o JSON padrão da rota
    const respondDeterministically = async (content: string) => {
      const assistantMessage = await prisma.message.create({
        data: {
          sessionId: activeSessionId,
          role: "assistant",
          content,
          tokens: 0,
          tier: "fast",
        },
      });
      const cleanMessages = await prisma.message.findMany({
        where: {
          sessionId: activeSessionId,
          role: { in: ["user", "assistant"] },
        },
        orderBy: { createdAt: "asc" },
      });
      const currentSession = await prisma.session.findUnique({
        where: { id: activeSessionId },
      });
      return NextResponse.json({
        success: true,
        sessionId: activeSessionId,
        specApproved: currentSession?.specApproved || false,
        phase: currentSession?.phase || phaseBefore,
        canonicalSpec: currentSession?.canonicalSpec ?? null,
        userMessage,
        assistantMessage,
        messages: cleanMessages,
        intent: rawAnalysis,
        graphifySuggestion: null,
        tokensSaved: 0,
        projectContextInjected: false,
      });
    };

    // 4. Pacote P4: Fan-Out Especulativo Unificado do Jev na Entrada do Chat (~100ms)
    const chatPolicy = loadOrchestrationPolicy();
    const fanOut = await evaluateChatFanOutWithJev({
      mensagem: targetPrompt,
      faseAtual: phaseBefore,
      temSpecEmRevisao: Boolean(sessionBefore?.canonicalSpec?.trim() && isPreExecutionPhase),
      resumoSpec: sessionBefore?.canonicalSpec ?? null,
      temCodigoExistente: Boolean(ctxProjectEarly?.path && fs.existsSync(ctxProjectEarly.path)),
      sessionId: activeSessionId,
      policy: chatPolicy,
    });

    // Guardrail de Entrada (J5): bloqueio preventivo de injeções adversariais
    if (fanOut.guardrailEntrada.inseguro) {
      TelemetryLogger.log({
        sessionId: activeSessionId,
        action: "GUARDRAIL_INPUT_BLOCKED",
        details: {
          motivo: fanOut.guardrailEntrada.motivo,
          probabilidade: fanOut.guardrailEntrada.probabilidadeInseguro,
        },
      });
      return respondDeterministically(
        "⚠️ **Aviso de Segurança (Guardrail de Entrada J5):** Sua mensagem contém instruções incompatíveis com as políticas de desenvolvimento seguro do NextCode. Por favor, reformule seu pedido focando nos requisitos da aplicação."
      );
    }

    // Avalia intenção de aprovação explícita da Spec (M1 / J2)
    let isExplicitApproval =
      fanOut.aprovacaoSpec.aprovadoParaFase2 || isExplicitSpecApproval(targetPrompt);

    if (isExplicitApproval) {
      if (!sessionBefore?.projectId || !sessionBefore.project?.path?.trim()) {
        const refusalText =
          "⚠️ Para executar, vincule esta sessão a um projeto com pasta (menu da sessão → mover para projeto). A Spec continua salva.";
        const assistantMessage = await prisma.message.create({
          data: {
            sessionId: activeSessionId,
            role: "assistant",
            content: refusalText,
            tokens: 0,
            tier: "fast",
          },
        });
        const cleanMessages = await prisma.message.findMany({
          where: {
            sessionId: activeSessionId,
            role: { in: ["user", "assistant"] },
          },
          orderBy: { createdAt: "asc" },
        });
        return NextResponse.json(
          {
            ok: false,
            reason: "SESSAO_SEM_PROJETO",
            success: false,
            sessionId: activeSessionId,
            phase: sessionBefore?.phase || "SPEC_REVISAO",
            specApproved: false,
            userMessage,
            assistantMessage,
            messages: cleanMessages,
          },
          { status: 200 }
        );
      }

      const approvalTriggerResult: ApproveSpecResult = await approveSpecAndStart(activeSessionId);
      if (!approvalTriggerResult.ok) {
        let refusalText = `⚠️ Aprovação recusada (${approvalTriggerResult.reason}).`;
        if (approvalTriggerResult.reason === "SPEC_AUSENTE") {
          refusalText = "⚠️ A Spec Canônica precisa ser revisada e salva no painel da Spec antes da aprovação.";
        } else if (approvalTriggerResult.reason === "SPEC_SEM_REQUISITOS") {
          refusalText = "⚠️ A Spec Canônica não possui requisitos funcionais verificáveis (REQ-001...). Forneça mais detalhes sobre o seu pedido para gerarmos os requisitos antes de aprovar.";
        } else if (approvalTriggerResult.reason === "SPEC_SEM_MODULOS") {
          refusalText = "⚠️ A Spec Canônica não declara nenhum módulo. Complete a especificação antes de aprovar.";
        } else if (approvalTriggerResult.reason === "SPEC_SEM_ARQUIVOS") {
          refusalText = "⚠️ A Spec Canônica não define arquivos afetados. Complete a arquitetura antes de aprovar.";
        } else if (approvalTriggerResult.reason === "SPEC_INVALIDA_OU_MALFORMATADA") {
          refusalText = "⚠️ O documento de Spec atual está com formatação inválida. Solicite ao assistente a regeneração da Spec antes de aprovar.";
        } else if (approvalTriggerResult.reason === "CONFERENCIA_REPROVADA") {
          refusalText =
            "⚠️ A conferência entre a Spec e o plano de execução encontrou problemas. Corrija e aprove de novo:\n" +
            (approvalTriggerResult.problems ?? []).map((p) => "- " + p).join("\n");
        }

        const assistantMessage = await prisma.message.create({
          data: {
            sessionId: activeSessionId,
            role: "assistant",
            content: refusalText,
            tokens: 0,
            tier: "fast",
          },
        });
        const cleanMessages = await prisma.message.findMany({
          where: {
            sessionId: activeSessionId,
            role: { in: ["user", "assistant"] },
          },
          orderBy: { createdAt: "asc" },
        });
        return NextResponse.json(
          {
            ok: false,
            reason: approvalTriggerResult.reason,
            success: false,
            sessionId: activeSessionId,
            phase: sessionBefore?.phase || "SPEC_REVISAO",
            specApproved: false,
            userMessage,
            assistantMessage,
            messages: cleanMessages,
          },
          { status: 200 }
        );
      }

      const approvedSession = await prisma.session.findUnique({
        where: { id: activeSessionId },
      });
      const approvalConfirmText =
        `✅ **Spec Canônica aprovada!** Fase atual: \`${approvalTriggerResult.phase}\`. ` +
        `A implementação será executada exclusivamente pela fila da DAG no servidor.`;
      const assistantMessage = await prisma.message.create({
        data: {
          sessionId: activeSessionId,
          role: "assistant",
          content: approvalConfirmText,
          tokens: 0,
          tier: "fast",
        },
      });
      const cleanMessages = await prisma.message.findMany({
        where: {
          sessionId: activeSessionId,
          role: { in: ["user", "assistant"] },
        },
        orderBy: { createdAt: "asc" },
      });

      const smartRouter = new SmartRouter();
      const rawAnalysis = smartRouter.routeTask({ prompt: targetPrompt });

      return NextResponse.json({
        ok: true,
        success: true,
        sessionId: activeSessionId,
        specApproved: approvedSession?.specApproved ?? true,
        phase: approvalTriggerResult.phase,
        canonicalSpec: approvedSession?.canonicalSpec ?? null,
        userMessage,
        assistantMessage,
        messages: cleanMessages,
        intent: rawAnalysis,
        graphifySuggestion: null,
        tokensSaved: 0,
        projectContextInjected: false,
      });
    }

    // 5. Na fase INTERVENCAO, verifica primeiro se a resposta do usuário escolhe um dos 3 caminhos por regex
    // TODO(passo-6): adicionar botões para ESCOLHA_INTERVENCAO (criar / corrigir / conversar) na interface
    const interventionChoice =
      phaseBefore === "INTERVENCAO" ? parseInterventionChoice(targetPrompt) : null;

    const classifiedIntention =
      interventionChoice !== null
        ? null
        : (fanOut.source === "jev"
            ? fanOut.intencao
            : await classifyMessage(targetPrompt, phaseBefore, activeSessionId));

    const transitionRes =
      interventionChoice !== null
        ? await applyPhaseEvent(activeSessionId, {
            type: "ESCOLHA_INTERVENCAO",
            escolha: interventionChoice,
          })
        : await applyPhaseEvent(activeSessionId, {
            type: "MENSAGEM_CLASSIFICADA",
            intencao: classifiedIntention!,
          });

    // 4a. Transição recusada -> responde com reason e allowedIntents / allowedEvents, SEM LLM (§3 regra 14 / Teste 11)
    if (!transitionRes.ok) {
      const allowedIntentsText =
        transitionRes.allowedIntents && transitionRes.allowedIntents.length > 0
          ? `Intenções permitidas nesta fase: ${transitionRes.allowedIntents.map((i) => `\`${i}\``).join(", ")}.`
          : "";
      const allowedEventsText =
        transitionRes.allowedEvents && transitionRes.allowedEvents.length > 0
          ? `Eventos permitidos: ${transitionRes.allowedEvents.map((e) => `\`${e}\``).join(", ")}.`
          : "";
      const blockedExtra =
        phaseBefore === "BLOQUEADA"
          ? `\n\n${await buildBlockedIncidentSection(activeSessionId)}`
          : "";

      const refusalMsg = [
        `⚠️ **Ação não permitida na fase \`${phaseBefore}\`.**`,
        `Motivo: ${transitionRes.reason}.`,
        allowedIntentsText,
        allowedEventsText,
        blockedExtra,
      ]
        .filter(Boolean)
        .join("\n");

      return respondDeterministically(refusalMsg);
    }

    const resultingPhase = transitionRes.ctx.phase;
    const effects = transitionRes.effects;

    // 4b. Effect MOSTRAR_STATUS ('status' em qualquer fase) -> resposta determinística do banco e do disco, SEM LLM
    if (effects.some((e) => e.type === "MOSTRAR_STATUS")) {
      const statusText = await buildDeterministicStatusResponse(activeSessionId);
      return respondDeterministically(statusText);
    }

    // 4c. Effect OFERECER_TRES_CAMINHOS (3ª rodada sem clareza -> INTERVENCAO) -> resposta determinística com os 3 caminhos
    if (effects.some((e) => e.type === "OFERECER_TRES_CAMINHOS") || resultingPhase === "INTERVENCAO") {
      // TODO(passo-6): exibir botões interativos para os três caminhos (criar, corrigir, conversar)
      const interventionText = [
        "🤔 Ainda não ficou claro qual caminho você deseja seguir. Escolha uma das três opções abaixo respondendo no chat:",
        "1. **criar** — Quero criar uma funcionalidade ou projeto novo (iniciar Spec);",
        "2. **corrigir** — Quero corrigir um problema ou bug existente (iniciar Spec de correção);",
        "3. **conversar** — Quero apenas conversar ou tirar uma dúvida.",
      ].join("\n");
      return respondDeterministically(interventionText);
    }

    // 4d. Resposta direta à escolha de intervenção (ESCOLHA_INTERVENCAO: criar -> ELICITACAO, corrigir -> ELICITACAO_CORRECAO, conversar -> CONVERSA)
    if (interventionChoice !== null) {
      const choiceConfirmText =
        interventionChoice === "criar"
          ? "Perfeito! Entramos na fase `ELICITACAO`. Descreva o que você deseja criar para montarmos a Spec Canônica."
          : interventionChoice === "corrigir"
            ? "Perfeito! Entramos na fase `ELICITACAO_CORRECAO`. Descreva o bug ou comportamento que precisa ser corrigido."
            : "Perfeito! Continuamos em `CONVERSA`. Qual é a sua dúvida?";
      return respondDeterministically(choiceConfirmText);
    }

    // 4e. Effect SUSPENDER_EXECUTORES_PENDENTES ('mudanca_durante_execucao' em EXECUCAO ou ajuste em BLOQUEADA -> SPEC_REVISAO)
    if (effects.some((e) => e.type === "SUSPENDER_EXECUTORES_PENDENTES")) {
      await prisma.session.update({
        where: { id: activeSessionId },
        data: { specApproved: false },
      });

      const suspendMsg =
        `⏸️ **Executores pendentes suspensos (fase atual: \`${resultingPhase}\`).**\n\n` +
        `O seu pedido de mudança foi registrado e abrirá uma **nova versão da Spec** para aprovação. ` +
        `O nó que já estava em execução termina normalmente e os nós pendentes aguardam a revisão e aprovação da nova versão da Spec.`;
      return respondDeterministically(suspendMsg);
    }

    // 4f. Se a sessão está em BLOQUEADA e permaneceu em BLOQUEADA, mostra o relatório de incidente mais recente e as opções
    if (phaseBefore === "BLOQUEADA" && resultingPhase === "BLOQUEADA") {
      const blockedReport = await buildBlockedIncidentSection(activeSessionId);
      return respondDeterministically(blockedReport);
    }

    // 4g. Se a sessão veio de ENTREGUE ou SPEC_REVISAO para ELICITACAO / ELICITACAO_CORRECAO, desmarca specApproved até nova aprovação
    if (
      (resultingPhase === "ELICITACAO" ||
        resultingPhase === "ELICITACAO_CORRECAO" ||
        resultingPhase === "CONVERSA") &&
      sessionBefore?.specApproved
    ) {
      await prisma.session.update({
        where: { id: activeSessionId },
        data: { specApproved: false },
      });
    }

    const isQuestionWithoutPhaseChange = effects.some(
      (e) => e.type === "RESPONDER_SEM_MUDAR_FASE"
    );

    // 4h. Em PLANEJAMENTO, EXECUCAO ou VERIFICACAO, o chat NÃO implementa e NÃO gera Spec
    if (
      !isQuestionWithoutPhaseChange &&
      (resultingPhase === "PLANEJAMENTO" ||
        resultingPhase === "EXECUCAO" ||
        resultingPhase === "VERIFICACAO")
    ) {
      const statusText = await buildDeterministicStatusResponse(activeSessionId);
      return respondDeterministically(statusText);
    }

    // 5. Monta o contexto e chama o LLM fast (para dúvida avulsa, conversa ou elicitação de Spec)
    // 5. Monta o contexto e chama o LLM fast (para dúvida avulsa, conversa ou elicitação de Spec)
    // Janela Deslizante (Pacote E1): limita aos últimos 6 turnos para estancar estouro de tokens
    const recentMessages = await prisma.message.findMany({
      where: {
        sessionId: activeSessionId,
        role: { in: ["user", "assistant"] },
      },
      orderBy: { createdAt: "desc" },
      take: 6,
    });
    const history = Array.isArray(recentMessages) ? [...recentMessages].reverse() : [];

    const headroomRes = pruneContextWithHeadroom(
      history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { maxLogLines: 50 }
    );

    if (headroomRes.messages.length > 0) {
      headroomRes.messages[headroomRes.messages.length - 1].content =
        preprocessedInput.fullFormattedPrompt;
    }

    const isSpecDraftingPhase =
      !isQuestionWithoutPhaseChange &&
      (resultingPhase === "ELICITACAO" ||
        resultingPhase === "ELICITACAO_CORRECAO" ||
        resultingPhase === "SPEC_REVISAO");

    let funnelBrief: string | undefined;
    if (isSpecDraftingPhase && !isQuestionWithoutPhaseChange) {
      try {
        const userMessages = await prisma.message.findMany({
          where: { sessionId: activeSessionId, role: "user" },
          orderBy: { createdAt: "asc" },
          select: { content: true },
        });
        const userContents = userMessages.map((m) => m.content);
        if (
          userContents.length === 0 ||
          userContents[userContents.length - 1] !== targetPrompt
        ) {
          userContents.push(targetPrompt);
        }
        const fullUserConversation = userContents.join("\n---\n");

        const funnel = await runUniversalIntakeFunnel({
          prompt: fullUserConversation,
          sessionId: activeSessionId,
        });
        funnelBrief = formatIntakeFunnelBrief(funnel);
      } catch {
        /* ignora falha do funnel */
      }
    }

    const systemPromptContent = isQuestionWithoutPhaseChange
      ? `DIRETIVA DE IDIOMA: Responda OBRIGATORIAMENTE em Português do Brasil (pt-BR).\n` +
        `Você está respondendo a uma dúvida avulsa do usuário no NextCode (fase atual: ${resultingPhase}). ` +
        `Responda apenas com explicação clara e objetiva. ` +
        `É ESTRITAMENTE PROIBIDO gerar Spec Canônica (YAML com frontmatter --- ... ---) e PROIBIDO gerar código de implementação para gravar em arquivos.`
      : isSpecDraftingPhase
        ? buildElicitadorSpecSystemPrompt(funnelBrief)
        : IntakeEngine.getGovernanceSystemPrompt();

    const dispatchMessages: DispatchMessage[] = [
      { role: "system", content: systemPromptContent },
      ...(isSpecDraftingPhase && sessionBefore?.canonicalSpec?.trim()
        ? [
            {
              role: "system" as const,
              content: buildCumulativeSpecSystemPrompt(sessionBefore.canonicalSpec),
            },
          ]
        : []),
      ...headroomRes.messages.map((m) =>
        m.role === "user" ? { ...m, content: maskSecretsForJev(m.content).text } : m
      ),
    ];

    let projectContextInjected = false;
    let contextDiagnostics: string | null = null;
    let ctxProject: { id: string; name: string; path: string | null } | null = null;
    try {
      ctxProject =
        sessionBefore?.project ??
        (projectId ? await prisma.project.findUnique({ where: { id: projectId } }) : null);
      if (!ctxProject) {
        contextDiagnostics = "sessao sem projeto vinculado e sem projectId no body";
      } else if (!ctxProject.path || !ctxProject.path.trim()) {
        contextDiagnostics = `projeto "${ctxProject.name}" cadastrado SEM o caminho da pasta local`;
      } else {
        const contextBlock = buildProjectContextBlock(ctxProject);
        if (contextBlock) {
          dispatchMessages.unshift({ role: "system", content: contextBlock });
          projectContextInjected = true;
        } else {
          contextDiagnostics = `caminho invalido ou ilegivel: "${ctxProject.path}"`;
        }
      }
    } catch (ctxErr) {
      contextDiagnostics = `excecao: ${String(ctxErr)}`;
    }

    // Injeção de skill quando aplicável (exceto em dúvida avulsa)
    if (!isQuestionWithoutPhaseChange) {
      try {
        const targetDir =
          ctxProject?.path && fs.existsSync(ctxProject.path) ? ctxProject.path : process.cwd();
        const skillRes = await resolveSkillOrCommand(targetPrompt, targetDir);
        if (skillRes.isSkillOrCommand && skillRes.skillBlock) {
          dispatchMessages.unshift({
            role: skillRes.untrustedSource ? "user" : "system",
            content: skillRes.skillBlock,
          });
        }
      } catch {
        /* ignora falha de skill */
      }
    }

    const setting = await prisma.setting.findUnique({ where: { id: "default" } });
    const availableKeys: AvailableKeys = {
      hasGeminiKey: Boolean(setting?.geminiKey),
      hasClaudeKey: Boolean(setting?.claudeKey),
      hasOpenaiKey: Boolean(setting?.openaiKey),
      hasGroqKey: Boolean((setting as any)?.groqKey),
      hasNvidiaKey: Boolean((setting as any)?.nvidiaKey),
      hasOmniRouteKey: Boolean(setting?.omniRouteKey),
      customEndpoint: setting?.customEndpoint,
    };
    const intent = smartRouter.resolveFallback(rawAnalysis, availableKeys);

    // 6. Remoção total da promoção de código no /api/chat (4b.2):
    // O /api/chat NUNCA grava arquivo no projeto (ZeroHallucinationEngine removido daqui; implementação só pela DAG).
    let aiResponseContent = "";
    let effectiveTier: string = modelOverride || intent.tier || "fast";

    // P5c (fundador, 15/10 — medicoes.md): na Spec, Claude Opus direto é o 1º modelo do elicitador; o gateway
    // fica de reserva. Uma falha do Claude desliga a tentativa nas chamadas seguintes deste mesmo pedido.
    const SPEC_GATEWAY_MAX_TOKENS = 32000;
    const elicitadorClaudeKey = isSpecDraftingPhase ? readSecret(setting?.claudeKey) : "";
    let elicitadorClaudeFalhou = false;
    const dispatchSpecWithClaude = async (messages: DispatchMessage[]): Promise<string | null> => {
      if (!elicitadorClaudeKey || elicitadorClaudeFalhou) return null;
      const res = await callElicitadorClaude({ messages, claudeKey: elicitadorClaudeKey });
      if (!res.ok) {
        elicitadorClaudeFalhou = true;
        TelemetryLogger.log({ sessionId: activeSessionId, action: "ELICITADOR_CLAUDE", details: { ok: false, detalhe: res.detail } });
        return null;
      }
      await recordLlmCost({
        sessionId: activeSessionId,
        papel: "elicitador",
        provider: "anthropic",
        model: res.model,
        usage: res.usage,
      });
      TelemetryLogger.log({
        sessionId: activeSessionId,
        action: "ELICITADOR_CLAUDE",
        details: { ok: true, modelo: res.model, ms: res.ms, stopReason: res.stopReason },
      });
      return res.text;
    };

    try {
      const claudeSpecText = isSpecDraftingPhase ? await dispatchSpecWithClaude(dispatchMessages) : null;
      const dispatchRes = claudeSpecText !== null ? null : await smartRouter.dispatchWithFallback({
        messages: dispatchMessages,
        tier: isSpecDraftingPhase ? "heavy" : "fast",
        // Spec: Claude Opus direto vem antes (P5c); aqui é a reserva (gateway pago forte, depois o gratuito), com teto de 32.000 tokens.
        ...(isSpecDraftingPhase ? { maxTokens: SPEC_GATEWAY_MAX_TOKENS } : {}),
        modelOverride,
        geminiKey: readSecret(setting?.geminiKey),
        groqKey: readSecret((setting as any)?.groqKey),
        nvidiaKey: readSecret((setting as any)?.nvidiaKey),
        deepseekKey: readSecret((setting as any)?.deepseekKey),
        omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
        omniRouteKey: readSecret(setting?.omniRouteKey),
        stream: false,
      });

      if (claudeSpecText !== null) {
        aiResponseContent = claudeSpecText;
        effectiveTier = "anthropic";
      } else if (dispatchRes) {
        effectiveTier = dispatchRes.tierTag;

        const resJson = await dispatchRes.response.json().catch(() => ({}));
        if (resJson.choices?.[0]?.message?.content) {
          aiResponseContent = resJson.choices[0].message.content;
        } else if (resJson.choices?.[0]?.message?.reasoning_content) {
          aiResponseContent = resJson.choices[0].message.reasoning_content;
        } else if (resJson.candidates?.[0]?.content?.parts?.[0]?.text) {
          aiResponseContent = resJson.candidates[0].content.parts[0].text;
        } else if (typeof resJson.choices?.[0]?.text === "string" && resJson.choices[0].text) {
          aiResponseContent = resJson.choices[0].text;
        } else {
          const errorDetail = resJson.error?.message ? ` (${resJson.error.message})` : "";
          aiResponseContent = `A resposta do modelo foi retornada sem conteúdo legível${errorDetail}.`;
        }
      }

      // Modelos com raciocínio às vezes não chegam ao documento (gastam a resposta "pensando").
      // Uma segunda tentativa, explícita, antes de desistir de gravar o rascunho.
      if (
        isSpecDraftingPhase &&
        (claudeSpecText !== null || dispatchRes?.providerUsed !== "none") &&
        !parseSpecDocument(aiResponseContent)
      ) {
        const retryMessages: DispatchMessage[] = [
          ...dispatchMessages,
          { role: "assistant", content: aiResponseContent.slice(0, 2000) },
          {
            role: "user",
            content:
              "A resposta acima não é a Spec. Responda AGORA somente com o documento da Spec, começando na primeira linha por --- e com valores reais (sem <placeholders>).",
          },
        ];
        let retryText: string = (await dispatchSpecWithClaude(retryMessages)) ?? "";
        let retryTier = "anthropic";
        if (!retryText) {
          const retryRes = await smartRouter.dispatchWithFallback({
            messages: retryMessages,
            tier: isSpecDraftingPhase ? "heavy" : "fast",
            maxTokens: SPEC_GATEWAY_MAX_TOKENS,
            geminiKey: readSecret(setting?.geminiKey),
            omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
            omniRouteKey: readSecret(setting?.omniRouteKey),
            stream: false,
          });
          const retryJson = await retryRes.response.json().catch(() => ({}));
          retryText = retryJson.choices?.[0]?.message?.content || "";
          retryTier = retryRes.tierTag;
        }
        if (parseSpecDocument(retryText)) {
          aiResponseContent = retryText;
          effectiveTier = retryTier;
        }
      }

      if (isQuestionWithoutPhaseChange) {
        // Se a resposta de dúvida avulsa vier com frontmatter de Spec, descarta o frontmatter e responde só o texto;
        // nunca altera a fase nem a canonicalSpec.
        aiResponseContent = stripSpecFrontmatterFromQuestionAnswer(aiResponseContent);
      } else if (isSpecDraftingPhase) {
        // 4b.3: Guarda cumulativa contra perda de módulos/arquivos + status: aguardando_aprovacao obrigatório
        let guardRes = applyCumulativeSpecGuard(
          sessionBefore?.canonicalSpec,
          aiResponseContent,
          targetPrompt
        );
        // Conferência mecânica (P12): módulo sem arquivo, rota sem arquivo, objetivo vazio.
        // Uma correção pedida à IA com a lista exata dos problemas antes de mostrar a Spec.
        let structureProblems =
          guardRes.isValidSpec && guardRes.finalSpec ? checkSpecStructure(parseSpecDocument(guardRes.finalSpec)!) : [];
        let specFixNotice = "";
        if (structureProblems.length > 0) {
          const fixMessages: DispatchMessage[] = [
            ...dispatchMessages,
            { role: "assistant", content: guardRes.finalSpec!.slice(0, 60000) },
            {
              role: "user",
              content:
                "A Spec acima tem problemas que impedem a implementação. Corrija TODOS e devolva a Spec completa:\n" +
                structureProblems.map((p) => `- ${p}`).join("\n"),
            },
          ];
          let fixText: string = (await dispatchSpecWithClaude(fixMessages)) ?? "";
          if (!fixText) {
            const fixRes = await smartRouter.dispatchWithFallback({
              messages: fixMessages,
              tier: isSpecDraftingPhase ? "heavy" : "fast",
              maxTokens: SPEC_GATEWAY_MAX_TOKENS,
              geminiKey: readSecret(setting?.geminiKey),
              omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
              omniRouteKey: readSecret(setting?.omniRouteKey),
              stream: false,
            });
            const fixJson = await fixRes.response.json().catch(() => ({}));
            fixText = fixJson.choices?.[0]?.message?.content || "";
          }
          const fixedGuard = applyCumulativeSpecGuard(sessionBefore?.canonicalSpec, fixText, targetPrompt);
          const problemasAntes = structureProblems;
          let adotada = false;
          if (fixedGuard.isValidSpec && fixedGuard.finalSpec) {
            const fixedProblems = checkSpecStructure(parseSpecDocument(fixedGuard.finalSpec)!);
            if (fixedProblems.length < structureProblems.length) {
              guardRes = fixedGuard;
              structureProblems = fixedProblems;
              adotada = true;
            }
          }
          // SM1 (e): a 2ª chamada ao modelo deixa de ser escondida — trilha própria e aviso ao usuário
          // (teste real 16/10: 1 mensagem = 2 chamadas ao Opus, US$ 1,02, sem registro nem aviso).
          TelemetryLogger.log({
            sessionId: activeSessionId,
            action: "SPEC_FIX_CALL",
            details: {
              problemasAntes: problemasAntes.slice(0, 20),
              problemasDepois: structureProblems.slice(0, 20),
              adotada,
            },
          });
          specFixNotice =
            `\n\n🔧 A conferência da Spec achou ${problemasAntes.length} problema(s) e pedi uma correção ao modelo (2ª chamada)` +
            (adotada ? `; ficaram ${structureProblems.length}.` : "; a correção não melhorou e mantive a versão anterior.");
        }
        if (guardRes.isValidSpec && guardRes.finalSpec) {
          // Auto-Cura Mecânica Determinística + Quality Gate do Jev (M2):
          // Elimina diretórios soltos, garante requisitos e preenche objetivo sem jogar erro no usuário
          try {
            const healed = autoHealSpecDocument(guardRes.finalSpec);
            guardRes.finalSpec = healed.healedSpec;
            const reinjectionNotice =
              guardRes.reinjectedCount > 0
                ? `\n\nMantive ${guardRes.reinjectedCount} itens da versão anterior que não apareceram na nova.`
                : "";
            // SM1 (a)/(d): correção automática e reinjeção nunca caladas — trilha e mensagem.
            if (healed.fixesApplied.length > 0) {
              TelemetryLogger.log({
                sessionId: activeSessionId,
                action: "SPEC_AUTO_HEAL",
                details: { correcoes: healed.fixesApplied.slice(0, 30) },
              });
            }
            if (guardRes.reinjectedCount > 0) {
              TelemetryLogger.log({
                sessionId: activeSessionId,
                action: "SPEC_REINJECTION",
                details: { itens: guardRes.reinjectedCount },
              });
            }
            const healNotice =
              healed.fixesApplied.length > 0
                ? `\n\n🛠️ Correções automáticas do NextCode (${healed.fixesApplied.length}):\n` +
                  healed.fixesApplied.slice(0, 10).map((f) => `- ${f}`).join("\n")
                : "";
            guardRes.finalMessageContent = `${healed.healedSpec}${reinjectionNotice}${specFixNotice}${healNotice}`;
            structureProblems = checkSpecStructure(healed.parsed);

            // Quality Gate do Jev (M2)
            const clareza = await decideSpecClarity({
              rascunhoSpec: guardRes.finalSpec,
              hasOpenQuestionsSection7: false,
              hasValidReqTable: Boolean(healed.parsed.requisitos && healed.parsed.requisitos.length > 0),
              sessionId: activeSessionId,
            }).catch(() => null);

            if (clareza && clareza.source === "jev" && !clareza.readyForUserApproval) {
              guardRes.finalMessageContent += `\n\n⚠️ O Jev avaliou que esta Spec ainda não está pronta para aprovar — clareza ${clareza.clarityScore}/3 (confiança ${clareza.clarityConfidence.toFixed(2)}), escopo fechado ${clareza.escopoFechadoProb.toFixed(2)}, sem contradições ${clareza.semContradicoesProb.toFixed(2)}. Revise os requisitos e a seção 7 antes de aprovar.`;
            }
          } catch {
            /* ignora falha de auto-cura */
          }

          aiResponseContent = guardRes.finalMessageContent;
          await prisma.session.update({
            where: { id: activeSessionId },
            data: {
              canonicalSpec: guardRes.finalSpec,
              specApproved: false,
            },
          });

          const currentParsed = parseSpecDocument(guardRes.finalSpec);

          // Item 7 do PLANO-DE-ACAO: Geração de Macrobrief e Conferência T8a (Elicitador × Analista)
          if (currentParsed) {
            try {
              const decompResult = SpecDecomposerSkill.decomposeSpec(
                guardRes.finalSpec,
                currentParsed.titulo,
                currentParsed.arquivosAfetados,
                currentParsed.stack,
                activeSessionId
              );
              if (decompResult.macrobrief) {
                TelemetryLogger.log({
                  sessionId: activeSessionId,
                  action: "MACROBRIEF_GENERATED",
                  details: {
                    idMacrobrief: decompResult.macrobrief.idMacrobrief,
                    clustersAtivos: decompResult.macrobrief.clustersAtivos,
                    requisitosTotais: decompResult.macrobrief.requisitosTotais,
                    microbriefsCount: decompResult.macrobrief.microbriefs.length,
                    t8bValid: decompResult.t8bCheck?.valid ?? true,
                  },
                });
                TelemetryLogger.log({
                  sessionId: activeSessionId,
                  action: decompResult.t8bCheck?.valid ? "CONFERENCIA_T8A_OK" : "CONFERENCIA_T8A_VERDICT",
                  details: {
                    errors: decompResult.t8bCheck?.errors ?? [],
                  },
                });
              }
            } catch {
              /* ignora falha secundária de telemetria */
            }
          }
          if (
            resultingPhase === "ELICITACAO" ||
            resultingPhase === "ELICITACAO_CORRECAO"
          ) {
            await applyPhaseEvent(activeSessionId, { type: "SPEC_PRONTA" });
          }
        }
      }

      if (!projectContextInjected && contextDiagnostics && !isSpecDraftingPhase) {
        aiResponseContent += `\n\nℹ️ _Análise do projeto indisponível: ${contextDiagnostics}. Cadastre a pasta local em Projetos → Editar Projeto._`;
      }
    } catch (err) {
      aiResponseContent = `⚠️ **Falha ao ler resposta da IA:** ${String(err)}`;
    }

    const chatSecretGuard = await redactSecretsInChatWithJev({
      sessionId: activeSessionId,
      text: aiResponseContent,
      modo: chatPolicy.jevExecucao.guardaSegredosChat,
      limiarSegredoNoul: chatPolicy.jevExecucao.limiarSegredoNoul,
    });
    aiResponseContent = chatSecretGuard.redactedText;

    // 7. Persiste APENAS a mensagem do assistente
    const assistantMessage = await prisma.message.create({
      data: {
        sessionId: activeSessionId,
        role: "assistant",
        content: aiResponseContent,
        tokens: intent.estimatedTokens,
        tier: effectiveTier,
      },
    });

    const cleanMessages = await prisma.message.findMany({
      where: {
        sessionId: activeSessionId,
        role: { in: ["user", "assistant"] },
      },
      orderBy: { createdAt: "asc" },
    });

    const currentSession = await prisma.session.findUnique({ where: { id: activeSessionId } });

    let graphifySuggestion: { reasoning: string; projectId: string } | null = null;
    if (ctxProject?.id && ctxProject?.path && fs.existsSync(ctxProject.path)) {
      try {
        const graphJsonPath = path.join(ctxProject.path, "graphify-out", "graph.json");
        const graphJaExiste = fs.existsSync(graphJsonPath);
        if (!graphJaExiste) {
          const graphifyDecision =
            fanOut.source === "jev"
              ? { elegivel: fanOut.graphify.elegivel, motivo: fanOut.graphify.motivo }
              : await decideGraphifyEligibilityWithJev({
                  prompt: targetPrompt,
                  temCodigoExistente: true,
                  sessionId: activeSessionId,
                });
          if (graphifyDecision.elegivel) {
            graphifySuggestion = {
              projectId: ctxProject.id,
              reasoning: graphifyDecision.motivo,
            };
          }
        }
      } catch {
        // Fallback defensivo: falha silenciosa para nunca quebrar a resposta do chat
      }
    }

    return NextResponse.json(
      {
        success: true,
        sessionId: activeSessionId,
        specApproved: currentSession?.specApproved || false,
        phase: currentSession?.phase || resultingPhase,
        canonicalSpec: currentSession?.canonicalSpec ?? null,
        userMessage,
        assistantMessage,
        messages: cleanMessages,
        intent,
        graphifySuggestion,
        tokensSaved:
          headroomRes.tokensSaved +
          (preprocessedInput.originalLength - preprocessedInput.processedLength),
        projectContextInjected,
        inputPreprocessorStats: {
          originalLength: preprocessedInput.originalLength,
          processedLength: preprocessedInput.processedLength,
          reductionRatio: preprocessedInput.tokenReductionPercent,
        },
      },
      {
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao processar mensagem do chat", details: String(error) },
      { status: 500 }
    );
  }
}
