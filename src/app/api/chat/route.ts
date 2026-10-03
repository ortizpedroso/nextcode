import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import * as fs from "fs";
import * as path from "path";
import prisma from "@/lib/prisma";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { readSecret } from "@/core/security/crypto";
import { SmartRouter, AvailableKeys, DispatchMessage } from "@/core/router/smart-router";
import { pruneContextWithHeadroom } from "@/core/headroom/context-pruner";
import { buildProjectContextBlock } from "@/core/project/project-context";
import { resolveSkillOrCommand } from "@/core/skills/skill-resolver";

import { resolveAvailableGeminiModel, invalidateGeminiModelCache } from "@/core/router/gemini-client";
import { IntakeEngine } from "@/core/intake/intake-engine";
import { InputPreprocessorEngine } from "@/core/intake/input-preprocessor";
import { EnvironmentWorkspaceAdapter } from "@/core/execution/environment-adapter";
import { TerminalExecutionEngine } from "@/core/execution/terminal-execution-engine";
import { QuarantineManager } from "@/core/governance/quarantine-manager";
import { DualLensAuditor, LLMDispatchFn } from "@/core/governance/dual-lens-auditor";
import { ZeroHallucinationEngine } from "@/core/governance/zero-hallucination-loop";
import type { Setting } from "@prisma/client";

/** Adapta o SmartRouter (tier fast, mesmas chaves BYOK já resolvidas na requisição) para o formato de dispatchFn que o DualLensAuditor espera — mesmo padrão usado em dag/route.ts, mantendo o auditor desacoplado dos provedores. */
function makeBlindAuditDispatchFn(smartRouter: SmartRouter, setting: Setting | null): LLMDispatchFn {
  return async (messages) => {
    try {
      const res = await smartRouter.dispatchWithFallback({
        messages,
        tier: "fast",
        geminiKey: readSecret(setting?.geminiKey),
        groqKey: readSecret((setting as any)?.groqKey),
        nvidiaKey: readSecret((setting as any)?.nvidiaKey),
        deepseekKey: readSecret((setting as any)?.deepseekKey),
        omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
        omniRouteKey: readSecret(setting?.omniRouteKey),
        stream: false,
        signal: AbortSignal.timeout(10000),
      });
      const json = await res.response.json().catch(() => null);
      return (
        json?.choices?.[0]?.message?.content ??
        json?.candidates?.[0]?.content?.parts?.[0]?.text ??
        null
      );
    } catch {
      return null;
    }
  };
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

    // Trava T1: Garante que novas solicitações de Spec travem a sessão até aprovação explícita do usuário
    const lowerPrompt = targetPrompt.toLowerCase();
    const isNewSpecRequest =
      lowerPrompt.includes("spec") ||
      lowerPrompt.includes("quero criar") ||
      lowerPrompt.includes("crie um") ||
      lowerPrompt.includes("montar um") ||
      lowerPrompt.includes("reescreva") ||
      lowerPrompt.includes("nova spec");

    const isExplicitApproval =
      lowerPrompt.includes("aprovo") ||
      lowerPrompt.includes("aprovar") ||
      lowerPrompt.includes("aprova a spec") ||
      lowerPrompt.includes("iniciar dag") ||
      lowerPrompt.includes("validar e aprovar") ||
      lowerPrompt.includes("pode rodar") ||
      lowerPrompt.includes("pode executar");

    let specApprovedNow: boolean;
    if (isNewSpecRequest && !isExplicitApproval) {
      await prisma.session.update({
        where: { id: activeSessionId },
        data: { specApproved: false },
      });
      specApprovedNow = false;
      console.log(`[CHAT_INTENT] Trava T1 BLOQUEADA na sessão ${activeSessionId} para aguardar aprovação da nova Spec.`);
    } else if (isExplicitApproval) {
      await prisma.session.update({
        where: { id: activeSessionId },
        data: { specApproved: true },
      });
      specApprovedNow = true;
      console.log(`[CHAT_INTENT] Trava T1 liberada na sessão ${activeSessionId} por aprovação do usuário.`);
    } else {
      const sessionForLock = await prisma.session.findUnique({
        where: { id: activeSessionId },
        select: { specApproved: true },
      });
      specApprovedNow = sessionForLock?.specApproved ?? false;
    }

    // 2. Registra mensagem do usuário no banco SQLite (armazenando a entrada tratada com YAML + MD)
    const userMessage = await prisma.message.create({
      data: {
        sessionId: activeSessionId,
        role: "user",
        content: targetPrompt,
      },
    });

    // 3. Busca histórico da sessão
    const history = await prisma.message.findMany({
      where: {
        sessionId: activeSessionId,
        role: { in: ["user", "assistant"] },
      },
      orderBy: { createdAt: "asc" },
    });

    // 4. Sanitiza e trunca contexto com o Headroom Token Guard
    const headroomRes = pruneContextWithHeadroom(
      history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { maxLogLines: 50 }
    );

    // Substitui o último item do histórico pelo prompt pré-processado (YAML + Markdown) para a LLM
    if (headroomRes.messages.length > 0) {
      headroomRes.messages[headroomRes.messages.length - 1].content = preprocessedInput.fullFormattedPrompt;
    }

    // 4.5 Injeta as Leis Inegociáveis de Governança NextCode v5
    const dispatchMessages: DispatchMessage[] = [
      { role: "system", content: IntakeEngine.getGovernanceSystemPrompt() },
      ...headroomRes.messages,
    ];
    let projectContextInjected = false;
    let contextDiagnostics: string | null = null;
    let ctxProject: { id: string; name: string; path: string | null } | null = null;
    try {
      const sessionForCtx = await prisma.session.findUnique({
        where: { id: activeSessionId },
        include: { project: true },
      });
      ctxProject =
        sessionForCtx?.project ??
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
          console.log(`[PROJECT_CONTEXT] Contexto injetado p/ "${ctxProject.name}" (${ctxProject.path}) — ${contextBlock.length} chars.`);
        } else {
          contextDiagnostics = `caminho invalido ou ilegivel: "${ctxProject.path}"`;
        }
      }
      if (contextDiagnostics) {
        console.warn(`[PROJECT_CONTEXT] Sem contexto de projeto: ${contextDiagnostics}`);
      }
    } catch (ctxErr) {
      console.warn("[PROJECT_CONTEXT] Falha ao montar contexto (seguindo sem ele):", String(ctxErr));
      contextDiagnostics = `excecao: ${String(ctxErr)}`;
    }

    // 4.6 RESOLUÇÃO E INJEÇÃO DE SKILLS DE IA (/skill-name [pedido])
    try {
      const targetDir = ctxProject?.path && fs.existsSync(ctxProject.path) ? ctxProject.path : process.cwd();
      const skillRes = await resolveSkillOrCommand(targetPrompt, targetDir);
      if (skillRes.isSkillOrCommand && skillRes.skillBlock) {
        // SEGURANÇA: blocos de skills built-in (/plan, /goal, /help) são texto fixo do
        // próprio sistema e podem ir como role:"system" (confiança máxima). Já o conteúdo
        // de skills instaladas (untrustedSource) é DADO de um arquivo de terceiros — vai
        // como role:"user" para não herdar a autoridade máxima do system prompt, mitigando
        // prompt injection via skill instalada maliciosa (ver skill-resolver.ts).
        dispatchMessages.unshift({
          role: skillRes.untrustedSource ? "user" : "system",
          content: skillRes.skillBlock,
        });
        console.log(`[SKILL_INJECTOR] Skill "/${skillRes.commandName}" injetada com sucesso no contexto! (untrusted=${Boolean(skillRes.untrustedSource)})`);
      }
    } catch (skillErr) {
      console.warn("[SKILL_INJECTOR] Falha ao resolver skill:", String(skillErr));
    }

    // 5. Consulta chaves BYOK no banco SQLite e roda o SmartRouter
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

    const smartRouter = new SmartRouter();
    const rawAnalysis = await smartRouter.routeTaskSmart(
      { prompt: targetPrompt },
      {
        geminiKey: readSecret(setting?.geminiKey),
        groqKey: readSecret((setting as any)?.groqKey),
        nvidiaKey: readSecret((setting as any)?.nvidiaKey),
        deepseekKey: readSecret((setting as any)?.deepseekKey),
        omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
        omniRouteKey: readSecret(setting?.omniRouteKey),
      },
      activeSessionId
    );
    const intent = smartRouter.resolveFallback(rawAnalysis, availableKeys);

    const activeTier = modelOverride || intent.tier;
    const modelName = intent.actualModelUsed;

    // Telemetria "graphify": dispara em paralelo ao dispatch principal (nunca bloqueia a
    // resposta do chat) um classificador LLM barato que decide se este pedido se beneficiaria
    // de consultar/construir um grafo de conhecimento do projeto. Só roda quando há projeto com
    // pasta local válida, a mensagem não é trivial (mesmo threshold de routeTaskSmart) e a skill
    // ainda não foi instalada neste projeto — evita repetir a sugestão a cada turno.
    const graphifyAlreadyInstalled = Boolean(
      ctxProject?.path && fs.existsSync(path.join(ctxProject.path, ".gemini", "skills", "graphify", "SKILL.md"))
    );
    const graphifyEligibilityPromise: Promise<{ eligible: boolean; reasoning: string } | null> =
      ctxProject?.path && !graphifyAlreadyInstalled && rawAnalysis.estimatedTokens >= 15
        ? smartRouter
            .classifyGraphifyEligibility(
              { prompt: targetPrompt },
              {
                geminiKey: readSecret(setting?.geminiKey),
                groqKey: readSecret((setting as any)?.groqKey),
                nvidiaKey: readSecret((setting as any)?.nvidiaKey),
                deepseekKey: readSecret((setting as any)?.deepseekKey),
                omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
                omniRouteKey: readSecret(setting?.omniRouteKey),
              }
            )
            .catch(() => null)
        : Promise.resolve(null);

    // 6. Geração da Resposta da IA via Cascata de Fallback, com Auto-Healing Feedback Loop:
    // mesma lógica do DAG (dag/route.ts) — se a auditoria Anti-Hallucination rejeitar o
    // código gerado, o erro real é injetado de volta no prompt e a IA tenta de novo em vez
    // de simplesmente devolver o erro ao usuário e parar.
    const MAX_AUTO_HEAL_ATTEMPTS = 3;
    let aiResponseContent = "";
    let effectiveTier = activeTier;
    let graphifySuggestion: { reasoning: string; projectId: string } | null = null;
    let zeroEngineRes: Awaited<ReturnType<typeof ZeroHallucinationEngine.processAndVerifyResponse>> | null = null;

    try {
      for (let attempt = 1; attempt <= MAX_AUTO_HEAL_ATTEMPTS; attempt++) {
        const attemptMessages = [...dispatchMessages];
        if (attempt > 1 && zeroEngineRes && !zeroEngineRes.passed) {
          const empiricalErrorLines =
            zeroEngineRes.empiricalBuildResult && !zeroEngineRes.empiricalBuildResult.success
              ? `${zeroEngineRes.empiricalBuildResult.stdout}\n${zeroEngineRes.empiricalBuildResult.stderr}`
                  .split("\n")
                  .filter((l) => l.includes("error TS"))
                  .slice(0, 5)
                  .join(" | ")
              : "";
          const prevError =
            zeroEngineRes.type2Result?.rejectionReason ||
            [
              ...zeroEngineRes.auditorResult.compilationErrors,
              ...zeroEngineRes.auditorResult.securityViolations,
              ...zeroEngineRes.auditorResult.testFailures,
            ].join(" | ") ||
            empiricalErrorLines ||
            "Erros de compilação/sintaxe.";
          attemptMessages.push({
            role: "system",
            content: `⚠️ [AUTO-HEALING FEEDBACK - RE-TENTATIVA #${attempt}]\nA tentativa anterior foi REJEITADA pela auditoria com os seguintes erros:\n${prevError}\nVocê DEVE obrigatoriamente corrigir esses erros e garantir que todos os imports e módulos existam!`,
          });
        }

        const dispatchRes = await smartRouter.dispatchWithFallback({
          messages: attemptMessages,
          tier: activeTier === "heavy" ? "heavy" : "fast",
          modelOverride,
          geminiKey: readSecret(setting?.geminiKey),
          groqKey: readSecret((setting as any)?.groqKey),
          nvidiaKey: readSecret((setting as any)?.nvidiaKey),
          deepseekKey: readSecret((setting as any)?.deepseekKey),
          omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
          omniRouteKey: readSecret(setting?.omniRouteKey),
          stream: false,
        });

        effectiveTier = dispatchRes.tierTag;

        const resJson = await dispatchRes.response.json().catch(() => ({}));
        if (resJson.choices?.[0]?.message?.content) {
          aiResponseContent = resJson.choices[0].message.content;
        } else if (resJson.candidates?.[0]?.content?.parts?.[0]?.text) {
          aiResponseContent = resJson.candidates[0].content.parts[0].text;
        } else {
          aiResponseContent = "A resposta do modelo foi retornada sem conteúdo legível.";
        }

        // Trava T1 (enforcement): mesma trava já aplicada ao executor /autonomo (dag/route.ts)
        // — aqui ela cobria só a escrita da flag no banco, mas nunca bloqueava a promoção de
        // código no chat direto. Se a Spec Canônica não foi aprovada, qualquer bloco de código
        // retornado pela IA é descartado antes de chegar ao ZeroHallucinationEngine: nada é
        // extraído, auditado ou gravado em disco. Isso não bloqueia retomada do loop de
        // auto-healing, pois não é um erro de compilação — é uma decisão de política.
        if (!specApprovedNow && aiResponseContent.includes("```")) {
          zeroEngineRes = null;
          aiResponseContent = `⚠️ **[NextCode Anti-Hallucination Guard] Trava T1 Violada (Spec Approval Lock)** — nada foi promovido para o disco:\n\nA Spec Canônica precisa ser aprovada pelo usuário (botão "Aprovar Spec Canônica" ou aprovação explícita no chat) antes de qualquer alteração ser escrita no projeto.`;
          break;
        }

        // 6.5 PROMOÇÃO E EXECUÇÃO COM ANCORAGEM ANTI-ALUCINAÇÃO (ZeroHallucinationEngine)
        // Agora com Validador Tipo 2 (auditoria semântica cega), igual ao DAG: só promove
        // para o disco se a Lente Cega confirmar que o código implementa o pedido real.
        const taskId = `chat-exec-${Date.now()}-${attempt}`;
        zeroEngineRes = await ZeroHallucinationEngine.processAndVerifyResponse(
          taskId,
          aiResponseContent,
          targetPrompt,
          ctxProject?.path || null,
          makeBlindAuditDispatchFn(smartRouter, setting)
        );

        if (zeroEngineRes.passed) break;
      }

      aiResponseContent = zeroEngineRes
        ? `${zeroEngineRes.groundedMessage}${
            !zeroEngineRes.passed
              ? `\n\n_(Após ${MAX_AUTO_HEAL_ATTEMPTS} tentativas automáticas de autocorreção.)_`
              : ""
          }`
        : aiResponseContent;

      if (!projectContextInjected && contextDiagnostics) {
        aiResponseContent += `\n\nℹ️ _Análise do projeto indisponível: ${contextDiagnostics}. Cadastre a pasta local em Projetos → Editar Projeto._`;
      }

      const graphifyEligibility = await graphifyEligibilityPromise;
      if (graphifyEligibility?.eligible && ctxProject?.id) {
        graphifySuggestion = { reasoning: graphifyEligibility.reasoning, projectId: ctxProject.id };
        TelemetryLogger.log({
          sessionId: activeSessionId,
          action: "GRAPHIFY_SUGGESTION_SHOWN",
          details: { reasoning: graphifyEligibility.reasoning, projectId: ctxProject.id },
        });
      }
    } catch (err) {
      aiResponseContent = `⚠️ **Falha ao ler resposta da IA:** ${String(err)}`;
    }

    // 7. Persiste APENAS a mensagem do assistente (sem poluir com notificações técnicas de DAG)
    const assistantMessage = await prisma.message.create({
      data: {
        sessionId: activeSessionId,
        role: "assistant",
        content: aiResponseContent,
        tokens: intent.estimatedTokens,
        tier: effectiveTier,
      },
    });

    // 8. Busca histórico limpo (apenas user e assistant)
    const cleanMessages = await prisma.message.findMany({
      where: {
        sessionId: activeSessionId,
        role: { in: ["user", "assistant"] },
      },
      orderBy: { createdAt: "asc" },
    });

    const currentSession = await prisma.session.findUnique({ where: { id: activeSessionId } });

    return NextResponse.json(
      {
        success: true,
        sessionId: activeSessionId,
        specApproved: currentSession?.specApproved || false,
        userMessage,
        assistantMessage,
        messages: cleanMessages,
        intent,
        graphifySuggestion,
        tokensSaved: headroomRes.tokensSaved + (preprocessedInput.originalLength - preprocessedInput.processedLength),
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
