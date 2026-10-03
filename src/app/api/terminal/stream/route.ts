import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import { spawn } from "child_process";
import { SandboxedTerminalSkill } from "@/core/skills/sandboxed-terminal";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const authErr = requireAuth(req);
  if (authErr.response) return authErr.response;

  const searchParams = req.nextUrl.searchParams;
  const command = searchParams.get("command") || searchParams.get("cmd");
  // cwd é resolvido via projectId (caminho confiável vindo do banco), igual às
  // demais rotas de terminal — nunca aceito como path livre vindo do cliente.
  const projectId = searchParams.get("projectId");
  let cwd = process.cwd();
  if (projectId) {
    const proj = await prisma.project.findUnique({ where: { id: projectId } });
    if (proj?.path) cwd = proj.path;
  }

  if (!command) {
    return NextResponse.json({ error: "Parâmetro 'command' é obrigatório" }, { status: 400 });
  }

  const blockReason = SandboxedTerminalSkill.checkBlacklist(command);
  if (blockReason) {
    return NextResponse.json({ error: "Comando Proibido (Jail Guard)", details: blockReason }, { status: 403 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const isWin = process.platform === "win32";
      const shell = isWin ? "cmd.exe" : "/bin/sh";
      const args = isWin ? ["/c", command] : ["-c", command];

      const child = spawn(shell, args, { cwd });

      const sendEvent = (event: string, data: any) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(new TextEncoder().encode(payload));
        } catch {
          // Controller might be closed
        }
      };

      child.stdout.on("data", (chunk: Buffer) => {
        sendEvent("log", { type: "stdout", text: chunk.toString("utf-8") });
      });

      child.stderr.on("data", (chunk: Buffer) => {
        sendEvent("log", { type: "stderr", text: chunk.toString("utf-8") });
      });

      child.on("error", (err: Error) => {
        sendEvent("error", { message: err.message });
        try {
          controller.close();
        } catch {}
      });

      child.on("close", (code: number | null) => {
        sendEvent("done", { exitCode: code ?? 0 });
        try {
          controller.close();
        } catch {}
      });

      req.signal.addEventListener("abort", () => {
        child.kill();
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
