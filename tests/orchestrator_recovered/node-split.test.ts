import { describe, it, expect } from "vitest";
import type { DAGNode } from "@/core/dag/dag-engine";
import { splitNodesByJev } from "@/core/orchestrator/node-split";

function node(id: string, files: string[], criterios: Record<string, string[]>, deps: string[] = []): DAGNode {
  return {
    id, title: `Etapa ${id}`, role: "implementation", status: "pending", dependencies: deps, filesScope: files,
    payload: {
      nodeFiles: files, reqsCobertos: Object.keys(criterios),
      microbrief: {
        documento: "microbrief", idMicrobrief: id, idMacrobrief: "m", idProjeto: "p", cluster: "backend",
        nivelModeloSugerido: "medio", dependeDe: deps, reqsCobertos: Object.keys(criterios),
        arquivosPermitidos: { criar: files, modificar: [], lerContratos: [] }, statusExecucao: "PENDENTE",
        tentativaAtual: 0, medidoPeloHarness: { compilou: null, testes: null, arquivosAlterados: [] },
        interfacesConsome: [], interfacesProduz: "", criteriosAceitePorReq: criterios,
        registroCumprimento: Object.keys(criterios).map((r) => ({ reqId: r, statusDeclarado: "PENDENTE", arquivoLinha: "", comoFoiImplementado: "" })),
      },
    },
  };
}

describe("Divisão de etapa pelo Jev", () => {
  it("divide em uma parte por arquivo, em sequência; quem dependia passa a depender da última parte", () => {
    const a = node("a", ["src/lib/store.ts", "src/app/api/x/route.ts"], {
      "REQ-001": ["store.ts exporta listar"],
      "REQ-002": ["src/app/api/x/route.ts: GET devolve 200"],
    });
    const b = node("b", ["src/app/page.tsx"], { "REQ-003": ["page.tsx mostra a lista"] }, ["a"]);
    const res = splitNodesByJev([a, b], (id) => id === "a");
    expect(res.nodes.map((n) => n.id)).toEqual(["a-p1", "a-p2", "b"]);
    expect(res.nodes[0].filesScope).toEqual(["src/lib/store.ts"]);
    expect((res.nodes[0].payload as any).microbrief.reqsCobertos).toEqual(["REQ-001"]);
    expect(res.nodes[1].dependencies).toEqual(["a-p1"]);
    expect((res.nodes[1].payload as any).microbrief.reqsCobertos).toEqual(["REQ-002"]);
    expect(res.nodes[2].dependencies).toEqual(["a-p2"]);
  });

  it("REQ que cita dois arquivos (ou nenhum) → não divide, para o avaliador não julgar meio REQ", () => {
    const a = node("a", ["src/lib/store.ts", "src/app/api/x/route.ts"], {
      "REQ-001": ["route.ts usa store.ts para listar"],
    });
    const res = splitNodesByJev([a], () => true);
    expect(res.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(res.skipped[0].reason).toContain("REQ-001");
  });

  it("Jev não pediu divisão → etapa intacta", () => {
    const a = node("a", ["src/lib/a.ts", "src/lib/b.ts"], { "REQ-001": ["a.ts"], "REQ-002": ["b.ts"] });
    expect(splitNodesByJev([a], () => false).nodes.map((n) => n.id)).toEqual(["a"]);
  });
});
