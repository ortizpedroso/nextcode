import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import * as fs from "fs";
import prisma from "@/lib/prisma";
import { readSecret } from "@/core/security/crypto";
import { SmartRouter, AvailableKeys, DispatchMessage } from "@/core/router/smart-router";
import { pruneContextWithHeadroom } from "@/core/headroom/context-pruner";
import { buildProjectContextBlock } from "@/core/project/project-context";
import { resolveSkillOrCommand } from "@/core/skills/skill-resolver";

import { resolveAvailableGeminiModel, invalidateGeminiModelCache } from "@/core/router/gemini-client";
import { IntakeEngine } from "@/core/intake/intake-engine";
import { extractFilePathsFromText } from "@/core/skills/spec-decomposer";
import { QuarantineManager } from "@/core/governance/quarantine-manager";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";

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

    // Auto-aprovação inteligente de Spec (Trava T1) se houver comando de execução/implementação
    const lowerPrompt = targetPrompt.toLowerCase();
    const isExecutionCommand =
      lowerPrompt.includes("implementar") ||
      lowerPrompt.includes("implemente") ||
      lowerPrompt.includes("executar") ||
      lowerPrompt.includes("execute") ||
      lowerPrompt.includes("só pare quando") ||
      lowerPrompt.includes("so pare quando") ||
      lowerPrompt.includes("aprovo") ||
      lowerPrompt.includes("aprovar") ||
      lowerPrompt.includes("iniciar dag") ||
      lowerPrompt.includes("validar e aprovar") ||
      lowerPrompt.includes("pode rodar") ||
      lowerPrompt.includes("pode fazer");

    if (isExecutionCommand) {
      await prisma.session.update({
        where: { id: activeSessionId },
        data: { specApproved: true },
      });
      console.log(`[CHAT_INTENT] Trava T1 liberada na sessão ${activeSessionId} por intenção de execução/implementação.`);
    }

    // 2. Registra mensagem do usuário no banco SQLite
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

    // 4.5 Injeta as Leis Inegociáveis de Governança NextCode v5 (NADA É CRIADO SEM SPEC E BRIEF)
    const dispatchMessages: DispatchMessage[] = [
      { role: "system", content: IntakeEngine.getGovernanceSystemPrompt() },
      ...headroomRes.messages,
    ];
    let projectContextInjected = false;
    let contextDiagnostics: string | null = null;
    let ctxProject: { name: string; path: string | null } | null = null;
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
      const skillRes = resolveSkillOrCommand(targetPrompt, targetDir);
      if (skillRes.isSkillOrCommand && skillRes.skillBlock) {
        dispatchMessages.unshift({ role: "system", content: skillRes.skillBlock });
        console.log(`[SKILL_INJECTOR] Skill "/${skillRes.commandName}" injetada com sucesso no contexto!`);
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
    const rawAnalysis = smartRouter.routeTask({ prompt: targetPrompt });
    const intent = smartRouter.resolveFallback(rawAnalysis, availableKeys);

    const activeTier = modelOverride || intent.tier;
    const modelName = intent.actualModelUsed;

    // 6. Geração da Resposta da IA via Cascata de Fallback (OmniRoute -> Gemini Direto -> Esgotamento)
    let aiResponseContent = "";
    let effectiveTier = activeTier;

    const dispatchRes = await smartRouter.dispatchWithFallback({
      messages: dispatchMessages,
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

    try {
      const resJson = await dispatchRes.response.json().catch(() => ({}));
      if (resJson.choices?.[0]?.message?.content) {
        aiResponseContent = resJson.choices[0].message.content;
      } else if (resJson.candidates?.[0]?.content?.parts?.[0]?.text) {
        aiResponseContent = resJson.candidates[0].content.parts[0].text;
      } else {
        aiResponseContent = "A resposta do modelo foi retornada sem conteúdo legível.";
      }

      // FIX (vínculo sessão↔projeto): quando o contexto NÃO pôde ser montado,
      // dizemos honestamente o motivo em vez de a IA "alucinar" pedindo anexos.
      // Não altera nada quando o contexto foi injetado com sucesso.
      if (!projectContextInjected && contextDiagnostics) {
        aiResponseContent += `\n\nℹ️ _Análise do projeto indisponível: ${contextDiagnostics}. Cadastre a pasta local em Projetos → Editar Projeto._`;
      }

      // 6.5 Se a resposta da IA contiver blocos de código e houver um projeto vinculado com caminho local,
      // extrai e promove fisicamente os arquivos alterados para o disco do usuário!
      if (ctxProject?.path && fs.existsSync(ctxProject.path) && aiResponseContent.includes("```")) {
        try {
          const qm = new QuarantineManager();
          const taskId = `chat-exec-${Date.now()}`;
          const promptFiles = extractFilePathsFromText(targetPrompt);
          const codeMap = qm.extractAndWriteCodeBlocks(taskId, aiResponseContent, promptFiles);

          if (Object.keys(codeMap).length > 0) {
            const type1Res = DualLensAuditor.validateType1(codeMap);
            if (type1Res.passed) {
              const promotedFiles = Object.keys(codeMap);
              qm.promoteToMainRepo(taskId, ctxProject.path, promotedFiles);
              console.log(
                `[CHAT_FILE_PROMOTION] ${promotedFiles.length} arquivo(s) promovido(s) no disco em ${ctxProject.path}:`,
                promotedFiles
              );
              aiResponseContent += `\n\n⚡ **[NextCode Auto-Patch]** ${promotedFiles.length} arquivo(s) atualizado(s) no disco em \`${ctxProject.path}\`: ${promotedFiles.map((f) => `\`${f}\``).join(", ")}`;
            } else {
              qm.purgeWorkspace(taskId);
              console.warn(
                `[CHAT_FILE_PROMOTION] Validação falhou para os arquivos do chat:`,
                [...type1Res.compilationErrors, ...type1Res.securityViolations]
              );
            }
          } else {
            qm.purgeWorkspace(taskId);
          }
        } catch (patchErr) {
          console.warn(`[CHAT_FILE_PROMOTION] Erro ao aplicar patch do chat no disco:`, String(patchErr));
        }
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
        tokensSaved: headroomRes.tokensSaved,
        projectContextInjected,
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
