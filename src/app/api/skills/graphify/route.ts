import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import { requireAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";
import { parseSkillContent, writeParsedSkillToDisk } from "@/core/skills/skill-installer";
import { GRAPHIFY_SKILL_CONTENT } from "@/core/skills/graphify-skill-template";
import { runGraphifyPipeline } from "@/core/graphify/graphify-runner";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { buildErrorSignature } from "@/core/telemetry/error-signature";

/**
 * Rota dedicada para a Telemetria "graphify" (instalar + rodar em 1 clique). Não reaproveita
 * /api/skills/proposals porque o branch de approve ali, para source != "github"/"bug_pattern",
 * grava em um diretório HOME fixo (~/.gemini/config/skills/<nome>/SKILL.md) — errado aqui, pois
 * o graphify precisa ser instalado e executado dentro da pasta do PROJETO do usuário.
 */
export async function POST(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;

  try {
    const body = await request.json();
    const { projectId, sessionId } = body;

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json({ error: "projectId é obrigatório." }, { status: 400 });
    }

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project?.path || !fs.existsSync(project.path)) {
      return NextResponse.json(
        {
          error:
            "Projeto sem pasta local válida cadastrada — cadastre o caminho absoluto em Projetos → Editar Projeto antes de usar o graphify.",
        },
        { status: 400 }
      );
    }

    TelemetryLogger.log({
      sessionId,
      action: "GRAPHIFY_INSTALL_CLICKED",
      details: { projectId, projectPath: project.path },
    });

    // 1. Instala a skill no projeto (idempotente — sobrescreve com a mesma versão a cada clique).
    const parsed = parseSkillContent(GRAPHIFY_SKILL_CONTENT);
    const { installedPath } = writeParsedSkillToDisk(parsed, GRAPHIFY_SKILL_CONTENT, project.path);

    const existingProposal = await prisma.candidateSkillProposal.findFirst({
      where: { name: parsed.skillName, source: "graphify", targetPath: project.path },
    });

    if (existingProposal) {
      await prisma.candidateSkillProposal.update({
        where: { id: existingProposal.id },
        data: { status: "approved", installedPath },
      });
    } else {
      await prisma.candidateSkillProposal.create({
        data: {
          name: parsed.skillName,
          description: parsed.description,
          triggerPattern: "/graphify",
          sampleContent: GRAPHIFY_SKILL_CONTENT,
          status: "approved",
          source: "graphify",
          detectedType: parsed.detectedType,
          targetPath: project.path,
          installedPath,
        },
      });
    }

    // 2. Roda o pipeline (extração AST, sem LLM) sobre a pasta do projeto.
    const runResult = await runGraphifyPipeline(project.path);

    if (!runResult.success) {
      TelemetryLogger.log({
        sessionId,
        action: "GRAPHIFY_RUN_FAILED",
        details: {
          projectId,
          error: runResult.error,
          errorSignature: buildErrorSignature("graphify", runResult.error || "erro desconhecido"),
        },
      });
      return NextResponse.json(
        { success: false, installedPath, error: runResult.error || "Falha ao executar o pipeline do graphify." },
        { status: 500 }
      );
    }

    TelemetryLogger.log({
      sessionId,
      action: "GRAPHIFY_RUN_SUCCESS",
      details: {
        projectId,
        nodes: runResult.nodes,
        edges: runResult.edges,
        communities: runResult.communities,
      },
    });

    return NextResponse.json({ success: true, installedPath, result: runResult });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao instalar/executar o graphify.", details: String(error) },
      { status: 500 }
    );
  }
}
