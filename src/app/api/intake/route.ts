import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { IntakeEngine } from "@/core/intake/intake-engine";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, prompt, sessionId, projectId } = body;

    let activeSessionId = sessionId;
    if (!activeSessionId) {
      const session = await prisma.session.create({
        data: {
          title: prompt && prompt.length > 30 ? `${prompt.substring(0, 30)}...` : "Nova Sessão v5",
          projectId: projectId || null,
        },
      });
      activeSessionId = session.id;
    }

    const currentSession = await prisma.session.findUnique({
      where: { id: activeSessionId },
    });

    if (!currentSession) {
      return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
    }

    // Ação: Aprovar Spec Canônica (Trava T1)
    if (action === "approve_spec") {
      const updatedSession = await prisma.session.update({
        where: { id: activeSessionId },
        data: { specApproved: true },
      });

      TelemetryLogger.log({
        sessionId: activeSessionId,
        action: "USER_SPEC_APPROVED",
        details: { canonicalSpec: currentSession.canonicalSpec },
      });

      return NextResponse.json({
        success: true,
        session: updatedSession,
        message: "Spec Canônica aprovada com sucesso! Trava T1 liberada.",
      });
    }

    // Ação: Analisar Entrada do Usuário via IntakeEngine
    const turnCount = (currentSession.turnCount || 0) + 1;
    await prisma.session.update({
      where: { id: activeSessionId },
      data: { turnCount },
    });

    const intakeResult = IntakeEngine.analyze(prompt || "", turnCount);
    
    // Se for Cenário A (Macro/SaaS), gera a Spec Canônica e grava no banco
    let canonicalSpec: string | undefined = undefined;
    if (intakeResult.scenario === "SCENARIO_A") {
      canonicalSpec = IntakeEngine.generateCanonicalSpec(
        prompt.substring(0, 40),
        prompt
      );
      await prisma.session.update({
        where: { id: activeSessionId },
        data: {
          intakeScenario: intakeResult.scenario,
          canonicalSpec,
          specApproved: false, // Força a trava T1
        },
      });
    } else {
      await prisma.session.update({
        where: { id: activeSessionId },
        data: { intakeScenario: intakeResult.scenario },
      });
    }

    TelemetryLogger.log({
      sessionId: activeSessionId,
      action: `INTAKE_ANALYSIS_${intakeResult.scenario}`,
      details: { prompt, turnCount, intakeResult },
    });

    return NextResponse.json({
      success: true,
      sessionId: activeSessionId,
      analysis: intakeResult,
      canonicalSpec,
      specApproved: currentSession.specApproved,
      turnCount,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao processar o Intake Engine", details: String(error) },
      { status: 500 }
    );
  }
}
