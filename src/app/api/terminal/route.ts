import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";
import { SandboxedTerminalSkill } from "@/core/skills/sandboxed-terminal";

export async function POST(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;

  try {
    const body = await request.json();
    const { command, sessionId, projectId } = body;

    if (!command || typeof command !== "string") {
      return NextResponse.json({ error: "Comando é obrigatório" }, { status: 400 });
    }

    const trimmedCmd = command.trim();

    // Trava de Segurança Antidestrutiva (Jail Guard) — blacklist compartilhada
    // com as demais rotas de terminal (ver SandboxedTerminalSkill).
    const blockReason = SandboxedTerminalSkill.checkBlacklist(trimmedCmd);
    if (blockReason) {
      return NextResponse.json(
        {
          error: "Comando Proibido (Jail Guard)",
          details: blockReason,
        },
        { status: 403 }
      );
    }

    // Resolve o diretório de execução (pasta do projeto ou diretório atual)
    let executionCwd = process.cwd();
    if (projectId) {
      const proj = await prisma.project.findUnique({ where: { id: projectId } });
      if (proj && proj.path) {
        executionCwd = proj.path;
      }
    } else if (sessionId) {
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: { project: true },
      });
      if (session?.project?.path) {
        executionCwd = session.project.path;
      }
    }

    // Executa o comando com timeout de 15s e limite de buffer de 2MB (via sandbox compartilhada)
    const result = await SandboxedTerminalSkill.execute(trimmedCmd, executionCwd, 15000);

    return NextResponse.json({
      success: result.success,
      command: trimmedCmd,
      cwd: executionCwd,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha na execução do terminal", details: String(error) },
      { status: 500 }
    );
  }
}
