import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { SkillMiner } from "@/core/telemetry/skill-miner";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";

export async function GET() {
  try {
    // Roda análise de telemetria para verificar se há novos candidatos
    await SkillMiner.analyzeAndPropose(3).catch(() => {});

    const proposals = await prisma.candidateSkillProposal.findMany({
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ proposals });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao listar propostas de skills", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { proposalId, action } = body;

    if (!proposalId) {
      return NextResponse.json({ error: "ID da proposta é obrigatório" }, { status: 400 });
    }

    if (action === "approve") {
      // REGRA DE GOVERNANÇA: A Skill só é gravada no disco após o clique explícito do usuário neste endpoint
      const result = await SkillMiner.approveAndInstallSkill(proposalId);
      
      TelemetryLogger.log({
        action: "USER_APPROVED_SKILL_INSTALLATION",
        details: { proposalId, skillPath: result.skillPath },
      });

      return NextResponse.json({
        success: true,
        message: "Skill autorizada e instalada com sucesso pelo usuário!",
        skillPath: result.skillPath,
      });
    }

    if (action === "reject") {
      await SkillMiner.rejectProposal(proposalId);
      
      TelemetryLogger.log({
        action: "USER_REJECTED_SKILL_INSTALLATION",
        details: { proposalId },
      });

      return NextResponse.json({
        success: true,
        message: "Proposta de Skill rejeitada pelo usuário.",
      });
    }

    return NextResponse.json({ error: "Ação não suportada" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: "Erro ao processar autorização de Skill", details: String(error) },
      { status: 500 }
    );
  }
}
