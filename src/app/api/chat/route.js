import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { readSecret } from "@/core/security/crypto";
import { SmartRouter } from "@/core/router/smart-router";
import { pruneContextWithHeadroom } from "@/core/headroom/context-pruner";
export async function POST(request) {
    try {
        const body = await request.json();
        const { sessionId, prompt, projectId, modelOverride } = body;
        if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
            return NextResponse.json({ error: "Mensagem é obrigatória." }, { status: 400 });
        }
        const targetPrompt = prompt.trim();
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
        // 3. Busca histórico da sessão
        const history = await prisma.message.findMany({
            where: {
                sessionId: activeSessionId,
                role: { in: ["user", "assistant"] },
            },
            orderBy: { createdAt: "asc" },
        });
        // 4. Sanitiza e trunca contexto com o Headroom Token Guard
        const headroomRes = pruneContextWithHeadroom(history.map((m) => ({ role: m.role, content: m.content })), { maxLogLines: 50 });
        // 5. Consulta chaves BYOK no banco SQLite e roda o SmartRouter
        const setting = await prisma.setting.findUnique({ where: { id: "default" } });
        const availableKeys = {
            hasGeminiKey: Boolean(setting?.geminiKey),
            hasClaudeKey: Boolean(setting?.claudeKey),
            hasOpenaiKey: Boolean(setting?.openaiKey),
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
            messages: headroomRes.messages,
            tier: activeTier === "heavy" ? "heavy" : "fast",
            geminiKey: readSecret(setting?.geminiKey),
            omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
            omniRouteKey: readSecret(setting?.omniRouteKey),
            stream: false,
        });
        effectiveTier = dispatchRes.tierTag;
        try {
            const resJson = await dispatchRes.response.json().catch(() => ({}));
            if (resJson.choices?.[0]?.message?.content) {
                aiResponseContent = resJson.choices[0].message.content;
            }
            else if (resJson.candidates?.[0]?.content?.parts?.[0]?.text) {
                aiResponseContent = resJson.candidates[0].content.parts[0].text;
            }
            else {
                aiResponseContent = "A resposta do modelo foi retornada sem conteúdo legível.";
            }
        }
        catch (err) {
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
        return NextResponse.json({
            success: true,
            sessionId: activeSessionId,
            userMessage,
            assistantMessage,
            messages: cleanMessages,
            intent,
            tokensSaved: headroomRes.tokensSaved,
        }, {
            headers: {
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
            },
        });
    }
    catch (error) {
        return NextResponse.json({ error: "Falha ao processar mensagem do chat", details: String(error) }, { status: 500 });
    }
}
