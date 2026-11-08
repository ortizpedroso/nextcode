import { describe, expect, it } from "vitest";
import { EXECUTION_STOPPED_LABEL, executionLooksStopped } from "../../src/lib/execution-presence";

describe("executionLooksStopped", () => {
  it("diz parada quando a etapa está running e o servidor não responde", () => {
    expect(
      executionLooksStopped({
        serverReachable: false,
        taskMarkedRunning: true,
        phase: "EXECUCAO",
      })
    ).toBe(true);
    expect(EXECUTION_STOPPED_LABEL).toBe("Execução parada — servidor fora do ar");
  });

  it("volta a executar quando o servidor responde, mesmo com a etapa ainda running", () => {
    expect(
      executionLooksStopped({
        serverReachable: true,
        taskMarkedRunning: true,
        phase: "EXECUCAO",
      })
    ).toBe(false);
  });

  it("não marca sessão ociosa como parada", () => {
    expect(
      executionLooksStopped({
        serverReachable: false,
        taskMarkedRunning: false,
        phase: "BLOQUEADA",
      })
    ).toBe(false);
  });
});
