import { describe, it, expect } from "vitest";
import { montarDependenciasDaFila } from "@/core/orchestrator/session-queue";

describe("session-queue-deps - montarDependenciasDaFila (item 5c)", () => {
  it("duas etapas; a segunda depende de 'id-que-nao-existe' e a primeira está completed → bloqueios contém a segunda e 'id-que-nao-existe'; porId da segunda não é o id da primeira", () => {
    const tasks = [
      { id: "etapa-1", status: "completed", dependencies: "[]" },
      { id: "etapa-2", status: "pending", dependencies: JSON.stringify(["id-que-nao-existe"]) },
    ];

    const { porId, bloqueios } = montarDependenciasDaFila(tasks);

    expect(bloqueios).toHaveLength(1);
    expect(bloqueios[0].taskId).toBe("etapa-2");
    expect(bloqueios[0].idsDesconhecidos).toEqual(["id-que-nao-existe"]);
    expect(bloqueios[0].erro).toBe("DEPENDENCIA_DESCONHECIDA");

    const depsEtapa2 = porId.get("etapa-2");
    expect(depsEtapa2).toBeDefined();
    expect(depsEtapa2).not.toContain("etapa-1");
    expect(depsEtapa2).toEqual([]);
  });

  it("a segunda depende do id real da primeira → bloqueios vazio e porId traz esse id", () => {
    const tasks = [
      { id: "etapa-1", status: "completed", dependencies: "[]" },
      { id: "etapa-2", status: "pending", dependencies: JSON.stringify(["etapa-1"]) },
    ];

    const { porId, bloqueios } = montarDependenciasDaFila(tasks);

    expect(bloqueios).toHaveLength(0);
    expect(porId.get("etapa-1")).toEqual([]);
    expect(porId.get("etapa-2")).toEqual(["etapa-1"]);
  });

  it("id desconhecido com a etapa anterior ainda pending → também bloqueia, com o mesmo nome de erro na estrutura de bloqueios", () => {
    const tasks = [
      { id: "etapa-1", status: "pending", dependencies: "[]" },
      { id: "etapa-2", status: "pending", dependencies: JSON.stringify(["id-desconhecido"]) },
    ];

    const { porId, bloqueios } = montarDependenciasDaFila(tasks);

    expect(bloqueios).toHaveLength(1);
    expect(bloqueios[0].taskId).toBe("etapa-2");
    expect(bloqueios[0].idsDesconhecidos).toEqual(["id-desconhecido"]);
    expect(bloqueios[0].erro).toBe("DEPENDENCIA_DESCONHECIDA");

    const depsEtapa2 = porId.get("etapa-2");
    expect(depsEtapa2).toBeDefined();
    expect(depsEtapa2).not.toContain("etapa-1");
    expect(depsEtapa2).toEqual([]);
  });

  it("etapa que mistura dependência válida e id inexistente → bloqueia e mantém apenas o id que existe em porId", () => {
    const tasks = [
      { id: "etapa-1", status: "completed", dependencies: "[]" },
      { id: "etapa-2", status: "pending", dependencies: JSON.stringify(["etapa-1", "id-inexistente"]) },
    ];

    const { porId, bloqueios } = montarDependenciasDaFila(tasks);

    expect(bloqueios).toHaveLength(1);
    expect(bloqueios[0].taskId).toBe("etapa-2");
    expect(bloqueios[0].idsDesconhecidos).toEqual(["id-inexistente"]);
    expect(bloqueios[0].erro).toBe("DEPENDENCIA_DESCONHECIDA");
    expect(porId.get("etapa-2")).toEqual(["etapa-1"]);
  });

  it("dependencies vazia continua lista vazia sem bloqueio; JSON inválido entra em bloqueios", () => {
    const tasks = [
      { id: "etapa-1", status: "completed", dependencies: "" },
      { id: "etapa-2", status: "pending", dependencies: "json-invalido" },
    ];

    const { porId, bloqueios } = montarDependenciasDaFila(tasks);

    expect(porId.get("etapa-1")).toEqual([]);
    expect(porId.get("etapa-2")).toEqual([]);

    expect(bloqueios).toHaveLength(1);
    expect(bloqueios[0].taskId).toBe("etapa-2");
    expect(bloqueios[0].idsDesconhecidos).toEqual(["<dependencies ilegível>"]);
    expect(bloqueios[0].erro).toBe("DEPENDENCIA_DESCONHECIDA");
  });
});
