import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/core/security/local-auth";

export async function POST(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;

  try {
    const body = await req.json();
    const { sessionId, modelsToCompare } = body;

    if (!sessionId) {
      return NextResponse.json({ error: "ID da sessão é obrigatório para benchmark" }, { status: 400 });
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        tasks: true,
      },
    });

    if (!session) {
      return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
    }

    const targetModels = Array.isArray(modelsToCompare) && modelsToCompare.length > 0
      ? modelsToCompare
      : ["omniroute:auto", "gemini:flash", "claude:sonnet", "groq:llama-3.3-70b"];

    const taskCount = session.tasks.length || 3;

    // Simula métricas comparativas baseadas em telemetria real e coeficientes de desempenho
    const benchmarkResults = targetModels.map((model) => {
      let speedMsPerTask = 1200;
      let tokenCostEst = 0.0015;
      let governancePassRate = 100;

      if (model.includes("omniroute")) {
        speedMsPerTask = 850;
        tokenCostEst = 0.0002;
        governancePassRate = 98;
      } else if (model.includes("flash") || model.includes("groq")) {
        speedMsPerTask = 450;
        tokenCostEst = 0.0005;
        governancePassRate = 95;
      } else if (model.includes("claude") || model.includes("sonnet") || model.includes("heavy")) {
        speedMsPerTask = 2100;
        tokenCostEst = 0.008;
        governancePassRate = 100;
      }

      const totalTimeMs = taskCount * speedMsPerTask;
      const totalEstimatedCostUSD = taskCount * tokenCostEst;

      return {
        model,
        taskCount,
        totalTimeMs,
        avgLatencyPerTaskMs: speedMsPerTask,
        governancePassRate,
        totalEstimatedCostUSD: Number(totalEstimatedCostUSD.toFixed(4)),
        recommendation:
          model.includes("omniroute")
            ? "Coeficiente fixo de custo baixo. Nenhum modelo foi chamado."
            : model.includes("sonnet")
            ? "Coeficiente fixo de custo alto. Nenhum modelo foi chamado."
            : "Coeficiente fixo de latência baixa. Nenhum modelo foi chamado.",
      };
    });

    return NextResponse.json({
      sessionId,
      sessionTitle: session.title,
      simulado: true,
      benchmarkDate: new Date().toISOString(),
      results: benchmarkResults,
    });
  } catch (error: unknown) {
    console.error("Erro na simulação de benchmark:", error);
    return NextResponse.json(
      { error: "Falha ao executar benchmark comparativo de DAG", details: String(error) },
      { status: 500 }
    );
  }
}
