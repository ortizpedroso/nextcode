import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";
import { fetchSkillFromGithub } from "@/core/skills/skill-installer";

/**
 * Quarantine gate: importar uma skill via URL do GitHub não a ativa mais na hora.
 * O conteúdo é buscado, analisado (tipo, hash, SHA do commit, riscos heurísticos) e
 * registrado como uma CandidateSkillProposal pendente — só é gravado em disco quando
 * um operador aprova explicitamente em /api/skills/proposals (action=approve).
 */
export async function POST(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;
  try {
    const body = await request.json();
    const { githubUrl, projectId } = body;

    if (!githubUrl || typeof githubUrl !== "string" || !githubUrl.trim()) {
      return NextResponse.json(
        { error: "URL do GitHub é obrigatória" },
        { status: 400 }
      );
    }

    let projectPath: string | null = null;
    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { path: true },
      });
      projectPath = project?.path || null;
    }

    const { responseText, successfulUrl, parsed, contentHash, commitSha, riskFlags } =
      await fetchSkillFromGithub(githubUrl.trim());

    const proposal = await prisma.candidateSkillProposal.create({
      data: {
        name: parsed.skillName,
        description: parsed.description,
        triggerPattern: `/${parsed.skillName}`,
        sampleContent: responseText,
        status: "pending",
        source: "github",
        sourceUrl: githubUrl.trim(),
        resolvedUrl: successfulUrl,
        commitSha,
        contentHash,
        detectedType: parsed.detectedType,
        targetPath: projectPath,
        riskFlags: JSON.stringify(riskFlags),
      },
    });

    return NextResponse.json({
      success: true,
      pendingReview: true,
      proposalId: proposal.id,
      skillName: parsed.skillName,
      detectedType: parsed.detectedType,
      riskFlags,
      message: `Skill "${parsed.skillName}" foi enviada para revisão e aguarda aprovação antes de ser ativada.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao importar skill do GitHub", details: (error as Error).message },
      { status: 500 }
    );
  }
}
