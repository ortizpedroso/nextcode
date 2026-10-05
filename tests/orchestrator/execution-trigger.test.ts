import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { approveSpecAndStart } from "@/core/orchestrator/execution-trigger";
import { claimJob, executeClaimedJob } from "@/core/orchestrator/job-queue";
import * as nodeExecutorModule from "@/core/orchestrator/node-executor";
import { PATCH as patchSession } from "@/app/api/sessions/[id]/route";
import { POST as postChat } from "@/app/api/chat/route";
import { POST as postDag } from "@/app/api/dag/route";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: () => ({ response: null }),
  requireReadAuth: () => ({ response: null }),
}));

const createdSessionIds: string[] = [];

async function createTestSession(
  data: {
    title?: string;
    canonicalSpec?: string | null;
    phase?: string;
    phaseContext?: string;
  } = {}
) {
  const session = await prisma.session.create({
    data: {
      title: data.title ?? "Sessão Teste Gatilho Único",
      canonicalSpec: data.canonicalSpec ?? null,
      ...(data.phase ? { phase: data.phase } : {}),
      ...(data.phaseContext ? { phaseContext: data.phaseContext } : {}),
    },
  });
  createdSessionIds.push(session.id);
  return session;
}

const VALID_CANONICAL_SPEC = `# Spec Canônica — Módulo de Pagamentos

## Objetivo
Implementar gateway de pagamentos seguro com validação.

## Arquivos Afetados
- \`src/payments/gateway.ts\`
- \`src/payments/validator.ts\`
`;

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Ignora componentes puramente visuais de cliente (Passo 6 cuidará da UI)
      if (entry.name === "components") continue;
      results.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("Gatilho Único de Execução e Fase Persistida (Passo 4a — 4.2 e 4.3)", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    if (createdSessionIds.length > 0) {
      await prisma.job.deleteMany({ where: { sessionId: { in: createdSessionIds } } });
      await prisma.taskNode.deleteMany({ where: { sessionId: { in: createdSessionIds } } });
      await prisma.message.deleteMany({ where: { sessionId: { in: createdSessionIds } } });
      await prisma.session.deleteMany({ where: { id: { in: createdSessionIds } } });
      createdSessionIds.length = 0;
    }
  });

  it('3. Aprovar sem canonicalSpec (via PATCH ou frase "aprovo" no chat) → { ok: false, reason: "SPEC_AUSENTE" }, specApproved continua false, fase não avança, zero nós, zero jobs', async () => {
    const session = await createTestSession({
      title: "Sessão Sem Spec",
      canonicalSpec: null,
    });

    // 3a. Via PATCH /api/sessions/:id
    const patchReq = new NextRequest(`http://localhost/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ specApproved: true }),
    });
    const patchRes = await patchSession(patchReq, {
      params: Promise.resolve({ id: session.id }),
    });
    expect(patchRes.status).toBe(400);
    const patchData = await patchRes.json();
    expect(patchData.ok).toBe(false);
    expect(patchData.reason).toBe("SPEC_AUSENTE");

    let afterPatch = await prisma.session.findUnique({ where: { id: session.id } });
    expect(afterPatch?.specApproved).toBe(false);
    expect(afterPatch?.phase).toBe("ENTRADA");
    expect(await prisma.taskNode.count({ where: { sessionId: session.id } })).toBe(0);
    expect(await prisma.job.count({ where: { sessionId: session.id } })).toBe(0);

    // 3b. Via frase explícita "aprovo" no POST /api/chat
    const chatReq = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        prompt: "aprovo a spec",
      }),
    });
    const chatRes = await postChat(chatReq);
    const chatData = await chatRes.json();
    expect(chatData.ok).toBe(false);
    expect(chatData.reason).toBe("SPEC_AUSENTE");
    expect(chatData.specApproved).toBe(false);
    expect(chatData.assistantMessage.content).toContain("painel da Spec");

    afterPatch = await prisma.session.findUnique({ where: { id: session.id } });
    expect(afterPatch?.specApproved).toBe(false);
    expect(afterPatch?.phase).toBe("ENTRADA");
    expect(await prisma.taskNode.count({ where: { sessionId: session.id } })).toBe(0);
    expect(await prisma.job.count({ where: { sessionId: session.id } })).toBe(0);
  });

  describe("4. Gatilho único e sem DAG antes da aprovação", () => {
    it("4a) create_dag com Spec não aprovada → 200, tasks: [], zero TaskNode no banco", async () => {
      const session = await createTestSession({
        title: "Sessão create_dag inofensivo",
        canonicalSpec: VALID_CANONICAL_SPEC,
      });

      const req = new NextRequest("http://localhost/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_dag",
          sessionId: session.id,
          prompt: "Implementar gateway de pagamentos",
        }),
      });

      const res = await postDag(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.tasks).toEqual([]);

      const taskCount = await prisma.taskNode.count({ where: { sessionId: session.id } });
      expect(taskCount).toBe(0);
    });

    it("4b) approveSpecAndStart(s, spec) → fase em EXECUCAO, specApproved === true, nós criados a partir da canonicalSpec, um Job ativo, trilha PHASE_TRANSITION completa", async () => {
      const session = await createTestSession({
        title: "Sessão approveSpecAndStart completo",
      });

      const res = await approveSpecAndStart(session.id, VALID_CANONICAL_SPEC);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.alreadyStarted).toBe(false);
        expect(res.phase).toBe("EXECUCAO");
      }

      const updatedSession = await prisma.session.findUnique({ where: { id: session.id } });
      expect(updatedSession?.phase).toBe("EXECUCAO");
      expect(updatedSession?.specApproved).toBe(true);
      expect(updatedSession?.canonicalSpec).toBe(VALID_CANONICAL_SPEC);

      const tasks = await prisma.taskNode.findMany({ where: { sessionId: session.id } });
      expect(tasks.length).toBeGreaterThan(0);

      const jobs = await prisma.job.findMany({
        where: { sessionId: session.id, status: { in: ["queued", "running"] } },
      });
      expect(jobs).toHaveLength(1);

      const transitions = await prisma.telemetryLog.findMany({
        where: { sessionId: session.id, action: "PHASE_TRANSITION" },
        orderBy: { createdAt: "asc" },
      });
      const steps = transitions.map((t) => {
        const d = JSON.parse(t.details!);
        return `${d.from}->${d.to}`;
      });
      expect(steps).toEqual([
        "ENTRADA->ELICITACAO",
        "ELICITACAO->SPEC_REVISAO",
        "SPEC_REVISAO->PLANEJAMENTO",
        "PLANEJAMENTO->EXECUCAO",
      ]);
    });

    it("4c) Promise.all([approveSpecAndStart(s), approveSpecAndStart(s)]) → exatamente um conjunto de TaskNode (não 2x) e exatamente um Job ativo", async () => {
      const refSession = await createTestSession({
        title: "Sessão referência contagem nós",
      });
      await approveSpecAndStart(refSession.id, VALID_CANONICAL_SPEC);
      const expectedNodeCount = await prisma.taskNode.count({
        where: { sessionId: refSession.id },
      });
      expect(expectedNodeCount).toBeGreaterThan(0);

      const session = await createTestSession({
        title: "Sessão concorrente approveSpecAndStart",
        canonicalSpec: VALID_CANONICAL_SPEC,
      });

      const [r1, r2] = await Promise.all([
        approveSpecAndStart(session.id, VALID_CANONICAL_SPEC),
        approveSpecAndStart(session.id, VALID_CANONICAL_SPEC),
      ]);

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);

      const tasks = await prisma.taskNode.findMany({ where: { sessionId: session.id } });
      expect(tasks).toHaveLength(expectedNodeCount);

      const activeJobs = await prisma.job.findMany({
        where: { sessionId: session.id, status: { in: ["queued", "running"] } },
      });
      expect(activeJobs).toHaveLength(1);
    });

    it("4d) approveSpecAndStart em sessão já em EXECUCAO ou ENTREGUE → { ok: true, alreadyStarted: true }, sem novos nós, sem novo job e sem PHASE_TRANSITION_REFUSED na trilha", async () => {
      const session = await createTestSession({
        title: "Sessão idempotente EXECUCAO e ENTREGUE",
        canonicalSpec: VALID_CANONICAL_SPEC,
      });

      await approveSpecAndStart(session.id);
      const nodesBefore = await prisma.taskNode.count({ where: { sessionId: session.id } });
      const jobsBefore = await prisma.job.count({ where: { sessionId: session.id } });

      // Chamada em EXECUCAO
      const resExec = await approveSpecAndStart(session.id, VALID_CANONICAL_SPEC);
      expect(resExec).toEqual({
        ok: true,
        alreadyStarted: true,
        phase: "EXECUCAO",
      });

      // Muda para ENTREGUE e chama novamente
      await prisma.session.update({
        where: { id: session.id },
        data: { phase: "ENTREGUE" },
      });
      const resEntregue = await approveSpecAndStart(session.id, VALID_CANONICAL_SPEC);
      expect(resEntregue).toEqual({
        ok: true,
        alreadyStarted: true,
        phase: "ENTREGUE",
      });

      expect(await prisma.taskNode.count({ where: { sessionId: session.id } })).toBe(nodesBefore);
      expect(await prisma.job.count({ where: { sessionId: session.id } })).toBe(jobsBefore);

      const refused = await prisma.telemetryLog.findMany({
        where: { sessionId: session.id, action: "PHASE_TRANSITION_REFUSED" },
      });
      expect(refused).toHaveLength(0);
    });

    it("4e) Grep automatizado no teste: nenhuma ocorrência de specApproved: true ou specApproved = true fora de execution-trigger.ts", () => {
      const srcDir = path.resolve(process.cwd(), "src");
      const files = collectTsFiles(srcDir);
      const pattern = /specApproved\s*[:=]\s*true/;
      const matches: string[] = [];

      for (const file of files) {
        const content = fs.readFileSync(file, "utf-8");
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith("//") || line.startsWith("*")) continue;
          if (pattern.test(line)) {
            matches.push(path.relative(srcDir, file).replace(/\\/g, "/"));
          }
        }
      }

      expect(matches).toEqual(["core/orchestrator/execution-trigger.ts"]);
    });
  });

  it("5. Quando processSessionQueue termina todos os nós → fase passa por VERIFICACAO e chega a ENTREGUE; quando bloqueia → fase vai a BLOQUEADA; retry_node → volta a EXECUCAO e enfileira job", async () => {
    // Parte A: Todos os nós concluídos -> EXECUCAO -> VERIFICACAO -> ENTREGUE
    const sessionDone = await createTestSession({
      title: "Sessão fila concluída",
      canonicalSpec: VALID_CANONICAL_SPEC,
    });
    const startDone = await approveSpecAndStart(sessionDone.id);
    expect(startDone.ok).toBe(true);
    const jobDoneId = startDone.ok ? startDone.jobId! : "";

    vi.spyOn(nodeExecutorModule, "executeTaskNode").mockImplementation(async (taskDb) => {
      const updated = await prisma.taskNode.update({
        where: { id: taskDb.id },
        data: { status: "completed", result: JSON.stringify({ success: true }) },
      });
      return {
        success: true,
        executedTask: updated,
        finalStatus: "completed",
        promotionTarget: null,
      };
    });

    const claimedDone = await claimJob(jobDoneId, "worker-test-done");
    expect(claimedDone).toBe(true);
    await executeClaimedJob(jobDoneId, "worker-test-done");

    const refreshedDone = await prisma.session.findUnique({ where: { id: sessionDone.id } });
    expect(refreshedDone?.phase).toBe("ENTREGUE");

    const doneTransitions = await prisma.telemetryLog.findMany({
      where: { sessionId: sessionDone.id, action: "PHASE_TRANSITION" },
      orderBy: { createdAt: "asc" },
    });
    const doneSteps = doneTransitions.map((t) => {
      const d = JSON.parse(t.details!);
      return `${d.from}->${d.to}`;
    });
    expect(doneSteps.slice(-2)).toEqual([
      "EXECUCAO->VERIFICACAO",
      "VERIFICACAO->ENTREGUE",
    ]);
    const lastTransitionDetails = JSON.parse(doneTransitions[doneTransitions.length - 1].details!);
    expect(lastTransitionDetails.specCompleteness).toBeDefined();

    // Parte B: Nó bloqueado -> EXECUCAO -> BLOQUEADA; depois retry_node -> EXECUCAO + enfileira job
    const sessionBlock = await createTestSession({
      title: "Sessão fila bloqueada",
      canonicalSpec: VALID_CANONICAL_SPEC,
    });
    const startBlock = await approveSpecAndStart(sessionBlock.id);
    expect(startBlock.ok).toBe(true);
    const jobBlockId = startBlock.ok ? startBlock.jobId! : "";

    vi.spyOn(nodeExecutorModule, "executeTaskNode").mockImplementation(async (taskDb) => {
      const updated = await prisma.taskNode.update({
        where: { id: taskDb.id },
        data: {
          status: "blocked",
          attempts: 3,
          result: JSON.stringify({ success: false, rejectionReason: "Falha persistente" }),
        },
      });
      return {
        success: false,
        executedTask: updated,
        finalStatus: "blocked",
        promotionTarget: null,
      };
    });

    const claimedBlock = await claimJob(jobBlockId, "worker-test-block");
    expect(claimedBlock).toBe(true);
    await executeClaimedJob(jobBlockId, "worker-test-block");

    const refreshedBlock = await prisma.session.findUnique({ where: { id: sessionBlock.id } });
    expect(refreshedBlock?.phase).toBe("BLOQUEADA");

    const blockedTask = await prisma.taskNode.findFirstOrThrow({
      where: { sessionId: sessionBlock.id, status: "blocked" },
    });

    const retryReq = new NextRequest("http://localhost/api/dag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "retry_node",
        nodeId: blockedTask.id,
      }),
    });
    const retryRes = await postDag(retryReq);
    expect(retryRes.status).toBe(200);

    const afterRetrySession = await prisma.session.findUnique({
      where: { id: sessionBlock.id },
    });
    expect(afterRetrySession?.phase).toBe("EXECUCAO");

    const queuedJobsAfterRetry = await prisma.job.findMany({
      where: { sessionId: sessionBlock.id, status: "queued" },
    });
    expect(queuedJobsAfterRetry.length).toBeGreaterThanOrEqual(1);
  });
});
