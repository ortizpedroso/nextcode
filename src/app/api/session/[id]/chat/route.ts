import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { readSecret } from "@/core/security/crypto";
import { SmartRouter, DispatchMessage } from "@/core/router/smart-router";
import { pruneContextWithHeadroom } from "@/core/headroom/context-pruner";
import { buildProjectContextBlock } from "@/core/project/project-context";

function extractTextFromChunk(rawChunk: string): string {
  let extracted = "";
  const lines = rawChunk.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data:")) {
      const jsonStr = trimmed.replace(/^data:\s*/, "");
      if (jsonStr === "[DONE]") continue;
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.choices?.[0]?.delta?.content) {
          extracted += parsed.choices[0].delta.content;
        } else if (parsed.choices?.[0]?.message?.content) {
          extracted += parsed.choices[0].message.content;
        } else if (parsed.candidates?.[0]?.content?.parts?.[0]?.text) {
          extracted += parsed.candidates[0].content.parts[0].text;
        }
      } catch {
        if (jsonStr) extracted += jsonStr;
      }
    }
  }
  return extracted;
}

function createPrismaBufferStream(
  sourceStream: ReadableStream<Uint8Array> | null,
  onComplete: (fullContent: string) => Promise<void>
): ReadableStream<Uint8Array> {
  if (!sourceStream) {
    return new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
  }

  const decoder = new TextDecoder();
  let accumulatedText = "";

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      const textChunk = decoder.decode(chunk, { stream: true });
      accumulatedText += extractTextFromChunk(textChunk);
    },
    async flush() {
      if (accumulatedText.trim()) {
        await onComplete(accumulatedText).catch((err) =>
          console.error("[PRISMA_BUFFER_ERROR] Falha ao persistir mensagem final:", err)
        );
      }
    },
  });

  return sourceStream.pipeThrough(transformStream);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await Promise.resolve(params);

    const body = await req.json().catch(() => ({}));
    const userContent = body.message || body.prompt || body.content;

    if (!userContent || typeof userContent !== "string" || !userContent.trim()) {
      return NextResponse.json(
        { error: "Mensagem é obrigatória." },
        { status: 400 }
      );
    }

    const targetPrompt = userContent.trim();

    // 1. Busca configurações de chaves no SQLite
    const setting = await prisma.setting.findFirst();

    // 2. Persiste a mensagem do usuário na tabela Message
    await prisma.message.create({
      data: {
        sessionId,
        role: "user",
        content: targetPrompt,
        tier: "fast",
      },
    });

    // 3. Recupera histórico da sessão e higieniza contexto
    const history = await prisma.message.findMany({
      where: {
        sessionId,
        role: { in: ["user", "assistant"] },
      },
      orderBy: { createdAt: "asc" },
    });

    const headroomRes = pruneContextWithHeadroom(
      history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { maxLogLines: 50 }
    );

    // 3.5 FASE 14.2 — Injeta o contexto do projeto local (se a sessão pertence a um).
    // Fail-open: caminho inexistente/ilegível => null => comportamento idêntico ao anterior.
    const sessionWithProject = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { project: true },
    });
    const dispatchMessages: DispatchMessage[] = [...headroomRes.messages];
    let projectContextInjected = false;
    if (sessionWithProject?.project) {
      try {
        const contextBlock = buildProjectContextBlock(sessionWithProject.project);
        if (contextBlock) {
          dispatchMessages.unshift({ role: "system", content: contextBlock });
          projectContextInjected = true;
        }
      } catch (ctxErr) {
        console.warn("[PROJECT_CONTEXT] Falha ao montar contexto (seguindo sem ele):", String(ctxErr));
      }
    }

    // 4. Executa o despacho com a cascata de fallback silenciosa (Gemini Direto -> OmniRoute -> Esgotamento)
    const smartRouter = new SmartRouter();
    const result = await smartRouter.dispatchWithFallback({
      messages: dispatchMessages,
      tier: "fast",
      geminiKey: readSecret(setting?.geminiKey),
      omniRouteUrl: setting?.omniRouteUrl || setting?.customEndpoint,
      omniRouteKey: readSecret(setting?.omniRouteKey),
      stream: true,
    });

    // 5. Separa o stream com tee() (OpenCode Pattern): streamForClient vai direto para o HTTP sem delay, streamForBuffer acumula para o Prisma
    if (result.response.body) {
      const [streamForClient, streamForBuffer] = result.response.body.tee();

      // Grava no SQLite UMA ÚNICA VEZ ao finalizar a transmissão do stream (Zero locks no banco durante o streaming)
      (async () => {
        try {
          const reader = streamForBuffer.getReader();
          const decoder = new TextDecoder();
          let fullText = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const textChunk = decoder.decode(value, { stream: true });
            fullText += extractTextFromChunk(textChunk);
          }

          if (fullText.trim()) {
            await prisma.message.create({
              data: {
                sessionId,
                role: "assistant",
                content: fullText,
                tier: result.tierTag,
              },
            });
          }
        } catch (err) {
          console.error("[PRISMA_BUFFER_ERROR] Falha ao persistir mensagem final:", err);
        }
      })();

      // 6. Retorna o stream nativo com os cabeçalhos essenciais SSE anti-buffering do OpenCode
      return new Response(streamForClient, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
          "X-Provider-Badge": result.badge,
          "X-Provider-Tier": result.tierTag,
          "X-Provider-Used": result.providerUsed,
          "X-Project-Context": projectContextInjected ? "1" : "0",
        },
      });
    }

    return NextResponse.json(
      { error: "Nenhum stream retornado pelo provedor." },
      { status: 500 }
    );
  } catch (error) {
    console.error("[CHAT_API_ERROR] Falha ao processar rota de chat:", error);
    return NextResponse.json(
      { error: "Falha interna ao processar requisição de chat", details: String(error) },
      { status: 500 }
    );
  }
}
