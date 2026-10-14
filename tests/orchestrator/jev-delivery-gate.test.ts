import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import prisma from "../../src/lib/prisma.js";
import { enqueueSessionQueueJob, claimJob, executeClaimedJob } from "../../src/core/orchestrator/job-queue.js";
import { renderCanonicalSpecDocument } from "../../src/core/intake/spec-format.js";
import * as jevExecutionChecks from "../../src/core/decision/jev-execution-checks.js";
import * as sessionQueueModule from "../../src/core/orchestrator/session-queue.js";
import * as nodeExecutorModule from "../../src/core/orchestrator/node-executor.js";
import * as orchestrationPolicyModule from "../../src/core/config/orchestration-policy.js";
import { TelemetryLogger } from "../../src/core/telemetry/telemetry-logger.js";

const createdSessionIds: string[] = [];

async function cleanupTestRecords(): Promise<void> {
  if (createdSessionIds.length > 0) {
    await prisma.job.deleteMany({ where: { sessionId: { in: createdSessionIds } } }).catch(() => {});
    await prisma.taskNode.deleteMany({ where: { sessionId: { in: createdSessionIds } } }).catch(() => {});
    await prisma.message.deleteMany({ where: { sessionId: { in: createdSessionIds } } }).catch(() => {});
    await prisma.session.deleteMany({ where: { id: { in: createdSessionIds } } }).catch(() => {});
    createdSessionIds.length = 0;
  }
}

describe("Portão Final de Entrega com JEV no job-queue (Spec Canônica × Código no Disco)", () => {
  const specExemplo = renderCanonicalSpecDocument({
    titulo: "API de Pagamentos",
    status: "aprovada",
    data: "2026-10-10",
    stack: ["TypeScript", "Fastify"],
    modulos: [
      {
        id: "mod-pay",
        nome: "Pagamentos",
        resumo: "Checkout e pix",
        arquivos: ["src/payments.ts"],
      },
    ],
    entidades: [],
    arquivosAfetados: ["src/payments.ts"],
    objetivo: "Processar transações PIX com idempotência.",
    requisitosIds: ["REQ-001"],
    requisitos: [
      {
        id: "REQ-001",
        titulo: "Criar Pix",
        criterio: "src/payments.ts exporta createPix com qrcode e txid.",
      },
    ],
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestRecords();
  });

  afterAll(async () => {
    await cleanupTestRecords();
  });

  it("deve concluir em ENTREGUE (VERIFICACAO_OK) quando o JEV aprovar a auditoria final", async () => {
    // 1. Cria sessão em fase EXECUCAO
    const session = await prisma.session.create({
      data: {
        title: "Sessão Entrega Aprovada JEV",
        phase: "EXECUCAO",
        specApproved: true,
        canonicalSpec: specExemplo,
      },
    });
    createdSessionIds.push(session.id);

    // Mock das tarefas da fila para simular que a DAG acabou com sucesso
    vi.spyOn(sessionQueueModule, "processSessionQueue").mockResolvedValue({
      tasks: [],
      allCompleted: true,
      pendingCount: 0,
      runningCount: 0,
      completedCount: 1,
      failedCount: 0,
      blockedCount: 0,
      specCompleteness: { complete: true, declaredFiles: ["src/payments.ts"], missingFiles: [] },
    });

    // Mock do T10 mecânico passando
    vi.spyOn(nodeExecutorModule, "verifyProjectDeliveryT10").mockReturnValue({
      passed: true,
      specFilesComplete: true,
      allReqsApproved: true,
      buildVerified: true,
      missingFiles: [],
      unapprovedReqs: [],
      gaps: [],
    });

    vi.spyOn(nodeExecutorModule, "readProjectFilesContent").mockReturnValue({
      "src/payments.ts": "export function createPix() { return { txid: '123', qrcode: 'pix' }; }",
    });

    // Mock da auditoria do JEV aprovando
    const jevSpy = vi.spyOn(jevExecutionChecks, "verifyProjectDeliveryWithJev").mockResolvedValue({
      aprovado: true,
      confiancaMedia: 0.95,
      scores: {
        requisitosImplementados: 0.95,
        fidelidadeRegras: 0.95,
        ausenciaStubs: 0.95,
        aderenciaContratos: 0.95,
        isolamentoSeguranca: 0.95,
        integracaoArquivos: 0.95,
      },
      lacunas: [],
      jevDisponivel: true,
      resumoAuditoria: "Código conforme com a Spec Canônica.",
    });

    const jobId = await enqueueSessionQueueJob(session.id);
    await claimJob(jobId, "worker-test");
    await executeClaimedJob(jobId, "worker-test");

    expect(jevSpy).toHaveBeenCalledTimes(1);

    const updatedSession = await prisma.session.findUnique({ where: { id: session.id } });
    expect(updatedSession?.phase).toBe("ENTREGUE");
  });

  it("não deve bloquear a entrega nem emitir laudo no chat quando o JEV reprovar no modo padrão (sombra), apenas emitindo telemetria", async () => {
    const teleSpy = vi.spyOn(TelemetryLogger, "log").mockReturnValue();

    // 1. Cria sessão em fase EXECUCAO
    const session = await prisma.session.create({
      data: {
        title: "Sessão Entrega JEV Modo Sombra",
        phase: "EXECUCAO",
        specApproved: true,
        canonicalSpec: specExemplo,
      },
    });
    createdSessionIds.push(session.id);

    vi.spyOn(sessionQueueModule, "processSessionQueue").mockResolvedValue({
      tasks: [],
      allCompleted: true,
      pendingCount: 0,
      runningCount: 0,
      completedCount: 1,
      failedCount: 0,
      blockedCount: 0,
      specCompleteness: { complete: true, declaredFiles: ["src/payments.ts"], missingFiles: [] },
    });

    vi.spyOn(nodeExecutorModule, "verifyProjectDeliveryT10").mockReturnValue({
      passed: true,
      specFilesComplete: true,
      allReqsApproved: true,
      buildVerified: true,
      missingFiles: [],
      unapprovedReqs: [],
      gaps: [],
    });

    vi.spyOn(nodeExecutorModule, "readProjectFilesContent").mockReturnValue({
      "src/payments.ts": "export function createPix() { /* TODO: implementar qrcode */ }",
    });

    // Mock da auditoria do JEV reprovando
    vi.spyOn(jevExecutionChecks, "verifyProjectDeliveryWithJev").mockResolvedValue({
      aprovado: false,
      confiancaMedia: 0.68,
      scores: {
        requisitosImplementados: 0.6,
        fidelidadeRegras: 0.9,
        ausenciaStubs: 0.55,
        aderenciaContratos: 0.85,
        isolamentoSeguranca: 0.9,
        integracaoArquivos: 0.85,
      },
      lacunas: [
        {
          categoria: "stub_ou_placeholder",
          reqId: "REQ-001",
          arquivo: "src/payments.ts",
          descricao: "A função createPix contém apenas comentário TODO sem implementar o retorno de qrcode.",
        },
      ],
      jevDisponivel: true,
      resumoAuditoria: "Auditoria reprovada com 1 lacuna.",
    });

    const jobId = await enqueueSessionQueueJob(session.id);
    await claimJob(jobId, "worker-test");
    await executeClaimedJob(jobId, "worker-test");

    const updatedSession = await prisma.session.findUnique({ where: { id: session.id } });
    // Em modo sombra, não altera deliveryT10; como o T10 passou, avança para ENTREGUE
    expect(updatedSession?.phase).toBe("ENTREGUE");

    // Telemetria foi emitida com a ação JEV_FINAL_DELIVERY_AUDIT_SOMBRA
    expect(teleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "JEV_FINAL_DELIVERY_AUDIT_SOMBRA",
        details: expect.objectContaining({
          modo: "sombra",
          aprovadoJev: false,
        }),
      })
    );

    // Nenhuma mensagem de laudo gravada no chat
    const messages = await prisma.message.findMany({ where: { sessionId: session.id } });
    const laudoMsg = messages.find((m) => m.content.includes("documento: laudo_auditoria_entrega"));
    expect(laudoMsg).toBeUndefined();
  });

  it("deve reprovar com VERIFICACAO_COM_LACUNAS e gerar laudo no chat quando o JEV reprovar no modo ativo", async () => {
    const defaultPol = orchestrationPolicyModule.loadOrchestrationPolicy();
    vi.spyOn(orchestrationPolicyModule, "loadOrchestrationPolicy").mockReturnValue({
      ...defaultPol,
      jevExecucao: {
        ...defaultPol.jevExecucao,
        auditoriaEntrega: "ativo",
      },
    });

    const session = await prisma.session.create({
      data: {
        title: "Sessão Entrega JEV Modo Ativo",
        phase: "EXECUCAO",
        specApproved: true,
        canonicalSpec: specExemplo,
      },
    });
    createdSessionIds.push(session.id);

    vi.spyOn(sessionQueueModule, "processSessionQueue").mockResolvedValue({
      tasks: [],
      allCompleted: true,
      pendingCount: 0,
      runningCount: 0,
      completedCount: 1,
      failedCount: 0,
      blockedCount: 0,
      specCompleteness: { complete: true, declaredFiles: ["src/payments.ts"], missingFiles: [] },
    });

    vi.spyOn(nodeExecutorModule, "verifyProjectDeliveryT10").mockReturnValue({
      passed: true,
      specFilesComplete: true,
      allReqsApproved: true,
      buildVerified: true,
      missingFiles: [],
      unapprovedReqs: [],
      gaps: [],
    });

    vi.spyOn(nodeExecutorModule, "readProjectFilesContent").mockReturnValue({
      "src/payments.ts": "export function createPix() { /* TODO: implementar qrcode */ }",
    });

    vi.spyOn(jevExecutionChecks, "verifyProjectDeliveryWithJev").mockResolvedValue({
      aprovado: false,
      confiancaMedia: 0.68,
      scores: {
        requisitosImplementados: 0.6,
        fidelidadeRegras: 0.9,
        ausenciaStubs: 0.55,
        aderenciaContratos: 0.85,
        isolamentoSeguranca: 0.9,
        integracaoArquivos: 0.85,
      },
      lacunas: [
        {
          categoria: "stub_ou_placeholder",
          reqId: "REQ-001",
          arquivo: "src/payments.ts",
          descricao: "A função createPix contém apenas comentário TODO sem implementar o retorno de qrcode.",
        },
      ],
      jevDisponivel: true,
      resumoAuditoria: "Auditoria reprovada com 1 lacuna.",
    });

    const jobId = await enqueueSessionQueueJob(session.id);
    await claimJob(jobId, "worker-test");
    await executeClaimedJob(jobId, "worker-test");

    const updatedSession = await prisma.session.findUnique({ where: { id: session.id } });
    expect(updatedSession?.phase).toBe("PLANEJAMENTO");

    const messages = await prisma.message.findMany({ where: { sessionId: session.id } });
    const laudoMsg = messages.find((m) => m.content.includes("documento: laudo_auditoria_entrega"));
    expect(laudoMsg).toBeDefined();
    expect(laudoMsg?.content).toContain("❌ REPROVADO — LACUNAS DETECTADAS");
    expect(laudoMsg?.content).toContain("stub_ou_placeholder");
    expect(laudoMsg?.content).toContain("REQ-001");
  });

  it("não deve chamar a auditoria do JEV quando o modo for desligado", async () => {
    const defaultPol = orchestrationPolicyModule.loadOrchestrationPolicy();
    vi.spyOn(orchestrationPolicyModule, "loadOrchestrationPolicy").mockReturnValue({
      ...defaultPol,
      jevExecucao: {
        ...defaultPol.jevExecucao,
        auditoriaEntrega: "desligado",
      },
    });

    const session = await prisma.session.create({
      data: {
        title: "Sessão Entrega JEV Modo Desligado",
        phase: "EXECUCAO",
        specApproved: true,
        canonicalSpec: specExemplo,
      },
    });
    createdSessionIds.push(session.id);

    vi.spyOn(sessionQueueModule, "processSessionQueue").mockResolvedValue({
      tasks: [],
      allCompleted: true,
      pendingCount: 0,
      runningCount: 0,
      completedCount: 1,
      failedCount: 0,
      blockedCount: 0,
      specCompleteness: { complete: true, declaredFiles: ["src/payments.ts"], missingFiles: [] },
    });

    vi.spyOn(nodeExecutorModule, "verifyProjectDeliveryT10").mockReturnValue({
      passed: true,
      specFilesComplete: true,
      allReqsApproved: true,
      buildVerified: true,
      missingFiles: [],
      unapprovedReqs: [],
      gaps: [],
    });

    vi.spyOn(nodeExecutorModule, "readProjectFilesContent").mockReturnValue({
      "src/payments.ts": "export function createPix() { return { txid: '123', qrcode: 'pix' }; }",
    });

    const jevSpy = vi.spyOn(jevExecutionChecks, "verifyProjectDeliveryWithJev");

    const jobId = await enqueueSessionQueueJob(session.id);
    await claimJob(jobId, "worker-test");
    await executeClaimedJob(jobId, "worker-test");

    expect(jevSpy).not.toHaveBeenCalled();

    const updatedSession = await prisma.session.findUnique({ where: { id: session.id } });
    expect(updatedSession?.phase).toBe("ENTREGUE");
  });
});
