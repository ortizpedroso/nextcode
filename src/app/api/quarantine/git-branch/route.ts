import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import { execSync } from "child_process";

export async function POST(req: NextRequest) {
  const authErr = requireAuth(req);
  if (authErr.response) return authErr.response;

  try {
    const body = await req.json().catch(() => ({}));
    const taskId = body.taskId || "staging";
    const rawBranchName = body.branchName || `nextcode/quarantine-${taskId}`;
    const cleanBranchName = rawBranchName.replace(/[^a-zA-Z0-9_\-\/]/g, "-");

    const cwd = process.cwd();

    // Check existing branches
    let branchExists = false;
    try {
      const branches = execSync("git branch --list", { cwd, encoding: "utf-8" });
      branchExists = branches.includes(cleanBranchName);
    } catch {}

    if (!branchExists) {
      try {
        execSync(`git branch ${cleanBranchName}`, { cwd, stdio: "pipe" });
      } catch (err: any) {
        return NextResponse.json(
          { success: false, error: `Falha ao criar branch git: ${err.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      branch: cleanBranchName,
      status: branchExists ? "already_exists" : "created",
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Erro interno ao processar requisição" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const authErr = requireAuth(req);
  if (authErr.response) return authErr.response;

  try {
    const cwd = process.cwd();
    const output = execSync("git branch --list 'nextcode/quarantine-*'", { cwd, encoding: "utf-8" });
    const branches = output
      .split("\n")
      .map((b) => b.trim().replace(/^\*\s*/, ""))
      .filter(Boolean);

    return NextResponse.json({
      success: true,
      quarantineBranches: branches,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Erro ao listar branches de quarentena" },
      { status: 500 }
    );
  }
}
