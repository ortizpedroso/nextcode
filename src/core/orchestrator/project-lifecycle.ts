import prisma from "@/lib/prisma";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { enqueueSessionQueueJob } from "@/core/orchestrator/job-queue";

/**
 * PJ2b (fundador 18/10: "fechar projeto de verdade: tira da área de trabalho e guarda onde parou; ao abrir de
 * novo, mostra onde parou e continua"). Fechar = arquivar: o worker não pega job do projeto, a fila para
 * depois do lote atual e o supervisor não retoma nem vigia as sessões dele (`OPEN_PROJECT_SESSION`).
 * Onde parou já está gravado (fase e etapas da sessão); o fechamento só registra o retrato na trilha.
 */
export interface WhereStopped {
  sessionId: string;
  titulo: string;
  fase: string;
  concluidas: number;
  total: number;
  rodando: string[];
  bloqueadas: string[];
}

export async function whereStopped(projectId: string): Promise<WhereStopped | null> {
  const session = await prisma.session.findFirst({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, phase: true, specVersion: true },
  });
  if (!session) return null;
  const tasks = await prisma.taskNode.findMany({
    where: { sessionId: session.id, specVersion: session.specVersion },
    select: { title: true, status: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    sessionId: session.id,
    titulo: session.title,
    fase: session.phase,
    concluidas: tasks.filter((t) => t.status === "completed").length,
    total: tasks.length,
    rodando: tasks.filter((t) => t.status === "running").map((t) => t.title),
    bloqueadas: tasks.filter((t) => t.status === "blocked").map((t) => t.title),
  };
}

export async function closeProject(projectId: string): Promise<WhereStopped | null> {
  await prisma.project.update({ where: { id: projectId }, data: { isArchived: true } });
  const onde = await whereStopped(projectId);
  if (onde) TelemetryLogger.log({ sessionId: onde.sessionId, action: "PROJECT_CLOSED", details: { projectId, ...onde } });
  return onde;
}

/** Reabre: desarquiva, diz no chat onde parou e, se a sessão estava executando, volta à fila. */
export async function reopenProject(projectId: string): Promise<WhereStopped | null> {
  await prisma.project.update({ where: { id: projectId }, data: { isArchived: false, isClosed: false } });
  const onde = await whereStopped(projectId);
  if (!onde) return null;
  TelemetryLogger.log({ sessionId: onde.sessionId, action: "PROJECT_REOPENED", details: { projectId, fase: onde.fase } });
  const continua = onde.fase === "EXECUCAO" || onde.fase === "VERIFICACAO" || onde.fase === "PLANEJAMENTO";
  const linhas = [
    "📂 **Projeto reaberto — você parou aqui:**",
    `- Fase: **${onde.fase}**${onde.total ? ` · etapas concluídas ${onde.concluidas}/${onde.total}` : ""}`,
    ...(onde.rodando.length ? [`- Em andamento quando fechou: ${onde.rodando.join(", ")}`] : []),
    ...(onde.bloqueadas.length ? [`- Bloqueadas: ${onde.bloqueadas.join(", ")}`] : []),
    continua
      ? "\nA execução continua de onde parou."
      : onde.fase === "BLOQUEADA"
        ? "\nA sessão está bloqueada: veja o último aviso acima para o que fazer."
        : "",
  ];
  await prisma.message.create({ data: { sessionId: onde.sessionId, role: "assistant", content: linhas.filter(Boolean).join("\n") } });
  if (continua) await enqueueSessionQueueJob(onde.sessionId);
  return onde;
}
