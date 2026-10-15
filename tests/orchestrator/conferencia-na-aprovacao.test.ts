import { describe, it, expect, afterEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { approveSpecAndStart } from "@/core/orchestrator/execution-trigger";
import * as orchestrationPolicyModule from "@/core/config/orchestration-policy";
import { IntakeEngine } from "@/core/intake/intake-engine";
import { stopJobWorker } from "@/core/orchestrator/job-worker";

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
  } = {}
) {
  const session = await prisma.session.create({
    data: {
      title: data.title ?? "Sessão Teste Conferência Entrada",
      canonicalSpec: data.canonicalSpec ?? null,
      phase: data.phase ?? "SPEC_REVISAO",
    },
  });
  createdSessionIds.push(session.id);
  return session;
}

const SPEC_FALHA_MECANICA = `# Spec Canônica — Teste Sem Frontmatter

## Objetivo
Funcionalidade sem frontmatter YAML para reprovar na conferência mecânica.

## Arquivos Afetados
- src/test-mecanico.ts
`;

describe("P5.4 — Conferência Macrobrief x Spec na Aprovação", () => {
  afterEach(async () => {
    await stopJobWorker();
    vi.restoreAllMocks();
    if (createdSessionIds.length > 0) {
      await prisma.job.deleteMany({ where: { sessionId: { in: createdSessionIds } } });
      await prisma.taskNode.deleteMany({ where: { sessionId: { in: createdSessionIds } } });
      await prisma.message.deleteMany({ where: { sessionId: { in: createdSessionIds } } });
      await prisma.session.deleteMany({ where: { id: { in: createdSessionIds } } });
      createdSessionIds.length = 0;
    }
  });

  it("(a) modo ativo: Spec com falha mecânica → ok: false, reason: CONFERENCIA_REPROVADA, problems não vazio, fase continua SPEC_REVISAO, nenhum TaskNode criado", async () => {
    vi.spyOn(orchestrationPolicyModule, "loadOrchestrationPolicy").mockReturnValue({
      ...orchestrationPolicyModule.DEFAULT_ORCHESTRATION_POLICY,
      jevExecucao: {
        ...orchestrationPolicyModule.DEFAULT_ORCHESTRATION_POLICY.jevExecucao,
        conferenciaEntrada: "ativo",
      },
    });

    const session = await createTestSession({
      phase: "SPEC_REVISAO",
      canonicalSpec: SPEC_FALHA_MECANICA,
    });

    const res = await approveSpecAndStart(session.id);

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("CONFERENCIA_REPROVADA");
    if (!res.ok) {
      expect(Array.isArray(res.problems)).toBe(true);
      expect(res.problems!.length).toBeGreaterThan(0);
      expect(res.problems![0]).toContain("Frontmatter YAML da Spec inválido ou ausente.");
    }

    const sessionDb = await prisma.session.findUnique({ where: { id: session.id } });
    expect(sessionDb?.phase).toBe("SPEC_REVISAO");
    expect(sessionDb?.specApproved).toBe(false);

    const taskCount = await prisma.taskNode.count({ where: { sessionId: session.id } });
    expect(taskCount).toBe(0);
  });

  it("(b) modo sombra: mesma Spec → segue o fluxo normal e registra CONFERENCIA_ENTRADA com ok: false", async () => {
    vi.spyOn(orchestrationPolicyModule, "loadOrchestrationPolicy").mockReturnValue({
      ...orchestrationPolicyModule.DEFAULT_ORCHESTRATION_POLICY,
      jevExecucao: {
        ...orchestrationPolicyModule.DEFAULT_ORCHESTRATION_POLICY.jevExecucao,
        conferenciaEntrada: "sombra",
      },
    });

    const session = await createTestSession({
      phase: "SPEC_REVISAO",
      canonicalSpec: SPEC_FALHA_MECANICA,
    });

    const res = await approveSpecAndStart(session.id);

    // No modo sombra, segue o fluxo normal de aprovação
    expect(res.ok).toBe(true);

    const sessionDb = await prisma.session.findUnique({ where: { id: session.id } });
    expect(sessionDb?.specApproved).toBe(true);

    const log = await prisma.telemetryLog.findFirst({
      where: { sessionId: session.id, action: "CONFERENCIA_ENTRADA" },
    });
    expect(log).not.toBeNull();
    const details = JSON.parse(log!.details!);
    expect(details.modo).toBe("sombra");
    expect(details.ok).toBe(false);
    expect(details.problemas).toBeGreaterThan(0);
  });

  it("(c) modo desligado: runElicitadorAndAnalistaCycle não é chamado", async () => {
    vi.spyOn(orchestrationPolicyModule, "loadOrchestrationPolicy").mockReturnValue({
      ...orchestrationPolicyModule.DEFAULT_ORCHESTRATION_POLICY,
      jevExecucao: {
        ...orchestrationPolicyModule.DEFAULT_ORCHESTRATION_POLICY.jevExecucao,
        conferenciaEntrada: "desligado",
      },
    });

    const spyCycle = vi.spyOn(IntakeEngine, "runElicitadorAndAnalistaCycle");

    const session = await createTestSession({
      phase: "SPEC_REVISAO",
      canonicalSpec: SPEC_FALHA_MECANICA,
    });

    const res = await approveSpecAndStart(session.id);

    expect(spyCycle).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);

    const log = await prisma.telemetryLog.findFirst({
      where: { sessionId: session.id, action: "CONFERENCIA_ENTRADA" },
    });
    expect(log).toBeNull();
  });
});
