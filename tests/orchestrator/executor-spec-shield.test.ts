import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { enforceExecutorSpecIsolation } from "@/core/orchestrator/node-executor";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import type { DispatchMessage } from "@/core/router/smart-router";

describe("Trava Mecânica T-SPEC-SHIELD: Executor Nunca Recebe Spec", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Suprime vazamento de 'SPEC CANÔNICA APROVADA' quando Microbrief estiver presente e registra telemetria", () => {
    const telemetrySpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});

    const messages: DispatchMessage[] = [
      { role: "system", content: "Você é um Engenheiro de Software Sênior (executor-backend)." },
      {
        role: "system",
        content: "MICROBRIEF DESTA ETAPA (contrato: o Avaliador julga cada REQ abaixo contra estes critérios):\n\n---\ndocumento: microbrief\nid: task-1\n---\n## Critérios de aceite\n- REQ-001: somar números",
      },
      {
        role: "system",
        content: "SPEC CANÔNICA APROVADA (fonte da verdade — implemente exatamente o que ela define):\n\n# Spec Canônica Completa com 50 páginas de regras irrelevantes para este nó...",
      },
      { role: "user", content: "Execute a etapa." },
    ];

    const sanitized = enforceExecutorSpecIsolation(
      messages,
      "executor-backend",
      "sess-test-shield",
      "node-test-shield"
    );

    expect(sanitized).toHaveLength(3);
    expect(sanitized.some((m) => String(m.content).includes("MICROBRIEF DESTA ETAPA"))).toBe(true);
    expect(sanitized.some((m) => String(m.content).includes("SPEC CANÔNICA APROVADA"))).toBe(false);

    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "EXECUTOR_SPEC_LEAK_BLOCKED",
        details: expect.objectContaining({
          nodeId: "node-test-shield",
          role: "executor-backend",
        }),
      })
    );
  });

  it("2. Não altera mensagens se não houver vazamento de Spec Canônica", () => {
    const telemetrySpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});

    const messages: DispatchMessage[] = [
      { role: "system", content: "Você é um Engenheiro de Software Sênior (executor-backend)." },
      {
        role: "system",
        content: "MICROBRIEF DESTA ETAPA:\n\n---\ndocumento: microbrief\nid: task-1\n---",
      },
      { role: "user", content: "Execute a etapa." },
    ];

    const sanitized = enforceExecutorSpecIsolation(
      messages,
      "executor-backend",
      "sess-test-clean",
      "node-test-clean"
    );

    expect(sanitized).toHaveLength(3);
    expect(telemetrySpy).not.toHaveBeenCalled();
  });

  it("3. Não barra mensagens de papéis não-executores (ex: avaliador ou analista)", () => {
    const telemetrySpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});

    const messages: DispatchMessage[] = [
      {
        role: "system",
        content: "MICROBRIEF DESTA ETAPA:\n\n---\ndocumento: microbrief\nid: task-1\n---",
      },
      {
        role: "system",
        content: "SPEC CANÔNICA APROVADA: texto de referência para o avaliador.",
      },
    ];

    const sanitized = enforceExecutorSpecIsolation(
      messages,
      "avaliador-backend",
      "sess-evaluator",
      "node-evaluator"
    );

    expect(sanitized).toHaveLength(2);
    expect(telemetrySpy).not.toHaveBeenCalled();
  });
});
