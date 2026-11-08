import { describe, it, expect, afterAll } from "vitest";
import prisma from "../../src/lib/prisma.js";
import { closeProject, reopenProject } from "../../src/core/orchestrator/project-lifecycle.js";
import { claimJob, enqueueSessionQueueJob } from "../../src/core/orchestrator/job-queue.js";
import { supervisePausedSessions } from "../../src/core/orchestrator/job-worker.js";

// PJ2b (fundador 18/10): fechar projeto de verdade — guarda onde parou; ao abrir de novo, mostra e continua.
const projects: string[] = [];
const sessions: string[] = [];
afterAll(async () => {
  await prisma.job.deleteMany({ where: { sessionId: { in: sessions } } }).catch(() => {});
  await prisma.message.deleteMany({ where: { sessionId: { in: sessions } } }).catch(() => {});
  await prisma.telemetryLog.deleteMany({ where: { sessionId: { in: sessions } } }).catch(() => {});
  await prisma.taskNode.deleteMany({ where: { sessionId: { in: sessions } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { id: { in: sessions } } }).catch(() => {});
  await prisma.project.deleteMany({ where: { id: { in: projects } } }).catch(() => {});
});

async function projectWith(phase: string, phaseContext?: object) {
  const p = await prisma.project.create({ data: { name: "PJ2b" } });
  projects.push(p.id);
  const s = await prisma.session.create({
    data: { title: "PJ2b", phase, projectId: p.id, ...(phaseContext ? { phaseContext: JSON.stringify(phaseContext) } : {}) },
  });
  sessions.push(s.id);
  await prisma.taskNode.create({ data: { id: `${s.id}-1`, sessionId: s.id, title: "Etapa 1/2", status: "completed" } });
  await prisma.taskNode.create({ data: { id: `${s.id}-2`, sessionId: s.id, title: "Etapa 2/2", status: "running" } });
  return { p, s };
}

describe("PJ2b — fechar e reabrir projeto", () => {
  it("fechado: o worker não pega o job; reaberto: o chat diz onde parou e a execução volta à fila", async () => {
    const { p, s } = await projectWith("EXECUCAO");
    const jobId = await enqueueSessionQueueJob(s.id);
    const onde = await closeProject(p.id);
    expect(onde).toMatchObject({ fase: "EXECUCAO", concluidas: 1, total: 2, rodando: ["Etapa 2/2"] });
    expect(await claimJob(jobId, "w-teste")).toBe(false);
    expect((await prisma.job.findUnique({ where: { id: jobId } }))?.status).toBe("queued");
    expect(await prisma.telemetryLog.count({ where: { sessionId: s.id, action: "PROJECT_CLOSED" } })).toBe(1);

    await reopenProject(p.id);
    expect((await prisma.project.findUnique({ where: { id: p.id } }))?.isArchived).toBe(false);
    const msg = (await prisma.message.findMany({ where: { sessionId: s.id } })).map((m) => m.content).join("\n");
    expect(msg).toContain("Projeto reaberto");
    expect(msg).toContain("etapas concluídas 1/2");
    expect(msg).toContain("A execução continua");
    expect(await claimJob(jobId, "w-teste")).toBe(true);
  });

  it("fechado e pausado: o supervisor não retoma a sessão", async () => {
    const { p, s } = await projectWith("PAUSADA", { rodadasSemClareza: 0, voltasConferencia: 0, faseAntesDaPausa: "EXECUCAO" });
    await closeProject(p.id);
    await supervisePausedSessions(async () => true, new Date(), { onlySessionIds: [s.id] });
    expect((await prisma.session.findUnique({ where: { id: s.id } }))?.phase).toBe("PAUSADA");
    await reopenProject(p.id);
    await supervisePausedSessions(async () => true, new Date(), { onlySessionIds: [s.id] });
    expect((await prisma.session.findUnique({ where: { id: s.id } }))?.phase).toBe("EXECUCAO");
  });
});
