import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { requireAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import {
  runProjectSpecAudit,
  publishProjectSpecAuditArtifacts,
} from "@/core/intake/project-repository-survey";
import { reconcileProjectSpecDocument } from "@/core/intake/spec-sync";
import { assertRegisteredProjectDirectory } from "@/core/intake/project-audit-path-policy";

export async function POST(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;

  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, path: inputPath, force, sessionId } = body;

    let targetPath: string | null = null;
    let project = null;

    if (projectId) {
      project = await prisma.project.findUnique({
        where: { id: String(projectId) },
        include: {
          sessions: {
            orderBy: { updatedAt: "desc" },
            take: 1,
          },
        },
      });

      if (!project) {
        return NextResponse.json(
          { error: `Projeto não encontrado: "${projectId}".` },
          { status: 404 }
        );
      }
      targetPath = project.path;
    } else if (inputPath && typeof inputPath === "string" && inputPath.trim()) {
      targetPath = path.resolve(inputPath.trim());
      const policy = await assertRegisteredProjectDirectory(targetPath);
      if (!policy.ok) {
        return NextResponse.json({ error: policy.message }, { status: 403 });
      }
    }

    if (!targetPath) {
      return NextResponse.json(
        { error: "Informe projectId ou path de um projeto cadastrado." },
        { status: 400 }
      );
    }

    if (!fs.existsSync(targetPath)) {
      return NextResponse.json(
        { error: `Caminho do repositório inexistente ou inválido: "${targetPath || ""}".` },
        { status: 400 }
      );
    }

    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      return NextResponse.json(
        { error: `O caminho informado não é um diretório: "${targetPath}".` },
        { status: 400 }
      );
    }

    const result = runProjectSpecAudit(targetPath, {
      force: Boolean(force),
      autoPublish: false,
    });
    const paths = publishProjectSpecAuditArtifacts(targetPath, result);

    // Opcional: sincronização com a sessão ativa
    const targetSessionId = sessionId || project?.sessions?.[0]?.id;
    if (targetSessionId && result.gravouSpec && (result.mode === "criar" || result.mode === "reconciliar") && result.specText) {
      try {
        await reconcileProjectSpecDocument(targetSessionId, targetPath, result.specText);
        await prisma.session.update({
          where: { id: targetSessionId },
          data: { specApproved: false },
        });
      } catch {
        // ignora falha de sincronização com sessão opcional
      }
    }

    // Telemetria
    TelemetryLogger.log({
      sessionId: targetSessionId || undefined,
      action: "PROJECT_SPEC_AUDIT",
      details: {
        mode: result.mode,
        gravouSpec: result.gravouSpec,
        lacunas: result.survey.lacunas.length,
      },
    });

    return NextResponse.json({
      success: true,
      mode: result.mode,
      gravouSpec: result.gravouSpec,
      checkErrors: result.checkErrors,
      contagens: {
        arquivosFonte: result.survey.arquivosFonte.length,
        rotasApi: result.survey.rotasApi.length,
        entidades: result.survey.entidades.length,
        modulos: result.survey.modulos.length,
        lacunas: result.survey.lacunas.length,
      },
      paths,
      delta: result.delta,
      motivoBloqueio: result.motivoBloqueio,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao auditar repositório", details: String(error) },
      { status: 500 }
    );
  }
}
