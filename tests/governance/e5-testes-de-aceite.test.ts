import { describe, it, expect } from "vitest";
import { generateAcceptanceTests, parseTesterAnswer, buildTesterPrompt } from "@/core/governance/acceptance-tests";
import type { EvaluatorCallResult } from "@/core/llm/evaluator-models";
import type { TestBenchReport, TestBenchRequest } from "@/core/execution/test-bench";

// E5 — autoteste: o testador escreve pelo Microbrief, sem ver o código; o harness faz o teste do teste.
const t = (req: string, arquivo: string) => ({ req, arquivo, conteudo: `import { it, expect } from 'vitest'; it('${req} ${arquivo}', () => expect(1).toBe(1));` });
const answer = (testes: object[], julgamento: string[] = []): EvaluatorCallResult => ({
  content: JSON.stringify({ testes, julgamento }),
  provider: "claude",
  model: "claude-sonnet-5-5",
  independent: true,
  failures: [],
});
const benchWith = (passam: (file: string) => boolean) => async (_p: string, req: TestBenchRequest): Promise<TestBenchReport> => {
  const files = (req.files ?? []).map((file) => ({ file, status: (passam(file) ? "passed" : "failed") as "passed" | "failed" }));
  return { ok: true, stage: "run", durationMs: 1, files, cases: files.map((f) => ({ file: f.file, name: f.file, status: f.status, ...(f.status === "failed" ? { failure: "AssertionError: x" } : {}) })) };
};
const input = { microbriefId: "MB-1", arquivos: ["src/app/api/tarefas/route.ts"], criteriosPorReq: { "REQ-001": ["POST sem titulo devolve 400"], "REQ-002": ["GET lista"] } };

describe("E5 — testes de aceite", () => {
  it("o prompt leva critérios e arquivos, e nunca código", () => {
    const p = buildTesterPrompt({ ...input, contrato: "rota /api/tarefas" }).map((m) => m.content).join("\n");
    expect(p).toContain("REQ-001: POST sem titulo devolve 400");
    expect(p).toContain("src/app/api/tarefas/route.ts");
    expect(p).not.toContain("export async function");
  });

  it("etapa que CRIA: teste que já passa sem o código sai; 2 testes do mesmo REQ → o último fica escondido", async () => {
    const r = await generateAcceptanceTests({
      projectPath: "C:/p",
      input,
      dispatch: async () => answer([t("REQ-001", "a"), t("REQ-001", "b"), t("REQ-002", "c")], ["REQ-003"]),
      bench: benchWith((f) => f.includes("-c")),
    });
    expect(r.testes.map((x) => [x.req, x.visivel])).toEqual([
      ["REQ-001", true],
      ["REQ-001", false],
    ]);
    expect(r.descartados).toHaveLength(1);
    expect(r.julgamento).toEqual(["REQ-003"]);
  });

  it("etapa que MODIFICA: teste que já passa vira regressão (controle P4: 'o que funciona continua funcionando')", async () => {
    const r = await generateAcceptanceTests({
      projectPath: "C:/p",
      input: { ...input, arquivosExistentes: input.arquivos },
      dispatch: async () => answer([t("REQ-001", "a"), t("REQ-002", "c")]),
      bench: benchWith((f) => f.includes("-c")),
    });
    expect(r.testes.map((x) => [x.req, Boolean(x.regressao)])).toEqual([
      ["REQ-001", false],
      ["REQ-002", true],
    ]);
    expect(r.descartados).toEqual([]);
  });

  it("bancada fora → nenhum teste (a etapa segue como antes); resposta sem JSON → nenhum teste", async () => {
    const fora = await generateAcceptanceTests({
      projectPath: "C:/p",
      input,
      dispatch: async () => answer([t("REQ-001", "a")]),
      bench: async () => ({ ok: false, stage: "docker", error: "parado", files: [], cases: [], durationMs: 0 }),
    });
    expect(fora).toMatchObject({ testes: [], bancadaFora: true });
    expect(parseTesterAnswer("não sei")).toBeNull();
    expect(parseTesterAnswer('{"testes":[{"req":"REQ-1","conteudo":"sem o runner"}]}')?.testes).toEqual([]);
  });
});
