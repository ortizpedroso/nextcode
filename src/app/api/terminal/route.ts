import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";
import { exec } from "child_process";
import * as util from "util";
import * as path from "path";

const execAsync = util.promisify(exec);

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

    // Trava de Segurança Antidestrutiva (Jail Guard)
    const dangerousPatterns = [
      /rm\s+-rf\s+\//i,
      /format\s+[c-z]:/i,
      /shutdown/i,
      /mkfs/i,
      /dd\s+if=/i,
      /:(){:|:&};:/i, // Fork bomb
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(trimmedCmd)) {
        return NextResponse.json(
          {
            error: "Comando Proibido (Jail Guard)",
            details: "O comando digitado contém instruções potencialmente destrutivas e foi bloqueado pelo sistema de governança.",
          },
          { status: 403 }
        );
      }
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

    // Executa o comando com timeout de 15s e limite de buffer de 2MB
    const { stdout, stderr } = await execAsync(trimmedCmd, {
      cwd: executionCwd,
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: "0" },
    }).catch((err: any) => {
      return {
        stdout: err.stdout || "",
        stderr: err.stderr || err.message || "Erro de execução de comando",
      };
    });

    return NextResponse.json({
      success: true,
      command: trimmedCmd,
      cwd: executionCwd,
      stdout: stdout || "",
      stderr: stderr || "",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha na execução do terminal", details: String(error) },
      { status: 500 }
    );
  }
}
