import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;

  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    const format = searchParams.get("format") || "markdown"; // "markdown" | "json"

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId é obrigatório" }, { status: 400 });
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        project: true,
        tasks: { orderBy: { createdAt: "asc" } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!session) {
      return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
    }

    const completedTasks = session.tasks.filter((t) => t.status === "completed");
    const failedTasks = session.tasks.filter((t) => t.status === "failed" || t.status === "blocked");

    if (format === "json") {
      return NextResponse.json({
        sessionId: session.id,
        sessionTitle: session.title,
        project: session.project?.name || null,
        specApproved: session.specApproved,
        summary: {
          totalTasks: session.tasks.length,
          completed: completedTasks.length,
          failedOrBlocked: failedTasks.length,
        },
        tasks: session.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          role: t.role,
          status: t.status,
          attempts: t.attempts,
          filesScope: t.filesScope ? JSON.parse(t.filesScope) : [],
          result: t.result ? JSON.parse(t.result) : null,
        })),
        exportedAt: new Date().toISOString(),
      });
    }

    // Formato Markdown Canônico de Governança
    const mdLines = [
      `# 🛡️ Relatório de Auditoria de Governança — NextCode v5`,
      ``,
      `**Sessão:** ${session.title}  `,
      `**ID da Sessão:** \`${session.id}\`  `,
      `**Projeto:** ${session.project?.name || "Ad-hoc"}  `,
      `**Data de Exportação:** ${new Date().toLocaleString("pt-BR")}  `,
      `**Spec Canônica Aprovada (Trava T1):** ${session.specApproved ? "✅ SIM" : "❌ NÃO"}  `,
      ``,
      `---`,
      ``,
      `## 📊 Resumo Executivo da DAG`,
      `- **Total de Tarefas:** ${session.tasks.length}`,
      `- **Concluídas & Auditadas:** ${completedTasks.length}`,
      `- **Falhas/Bloqueios:** ${failedTasks.length}`,
      ``,
      `---`,
      ``,
      `## 🔍 Detalhes das Etapas Auditadas (Dual-Lens Audit Trail)`,
      ``,
    ];

    for (const task of session.tasks) {
      const resultData = task.result ? JSON.parse(task.result) : {};
      const verdict = resultData.auditVerdict || "N/A";
      const promoted = resultData.promotedPath || "Nenhum";

      mdLines.push(`### 📌 Etapa: ${task.title}`);
      mdLines.push(`- **ID:** \`${task.id}\``);
      mdLines.push(`- **Papel:** \`${task.role}\``);
      mdLines.push(`- **Status:** \`${task.status.toUpperCase()}\``);
      mdLines.push(`- **Veredito Dual-Lens:** **${verdict}**`);
      mdLines.push(`- **Tentativas Executadas:** ${task.attempts}/${task.maxAttempts}`);
      mdLines.push(`- **Destino da Promoção:** \`${promoted}\``);
      mdLines.push(`- **Escopo de Arquivos:** \`${task.filesScope || "[]"}\``);
      mdLines.push(``);
    }

    const markdownText = mdLines.join("\n");

    return new NextResponse(markdownText, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="auditoria-nextcode-${sessionId.substring(0, 8)}.md"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao gerar relatório de governança", details: String(error) },
      { status: 500 }
    );
  }
}
