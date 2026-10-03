import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import { SandboxedTerminalSkill } from "@/core/skills/sandboxed-terminal";
import prisma from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;

  try {
    const body = await request.json();
    const { command, projectId, timeoutMs } = body;

    if (!command || typeof command !== "string" || !command.trim()) {
      return NextResponse.json({ error: "Comando é obrigatório." }, { status: 400 });
    }

    let targetCwd = process.cwd();
    if (projectId) {
      const proj = await prisma.project.findUnique({ where: { id: projectId } });
      if (proj?.path && require("fs").existsSync(proj.path)) {
        targetCwd = proj.path;
      }
    }

    const startedAt = Date.now();
    const result = await SandboxedTerminalSkill.execute(command, targetCwd, timeoutMs || 30000);

    return NextResponse.json({
      success: result.success,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      executionTimeMs: Date.now() - startedAt,
      cwd: targetCwd,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao executar comando no terminal", details: String(error) },
      { status: 500 }
    );
  }
}
