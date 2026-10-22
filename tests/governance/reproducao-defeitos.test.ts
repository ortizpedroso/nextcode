import { describe, it, expect } from "vitest";
import {
  reproduceDefects,
  parseWriterAnswer,
  classifyRun,
  sourceFileInFailure,
  filesCitedIn,
} from "@/core/governance/defect-reproducer";
import { reviewFinalDelivery, parseFinalReview } from "@/core/governance/final-reviewer";
import type { EvaluatorCallResult } from "@/core/llm/evaluator-models";
import type { TestBenchReport, TestBenchRequest } from "@/core/execution/test-bench";

// Mudança 43.2 — o revisor prova cada suspeita com um teste antes de mandar para o reparo.
const FILES: Record<string, string> = {
  "src/lib/cobrancas-service.ts": "export function criarCobranca(p: { nome: string; email?: string }) {\n  return { id: 'c1', ...p };\n}\n",
  "tests/cobrancas-service.test.ts": "import { it } from 'vitest';\nit('x', () => {});\n",
  "src/lib/taxas.ts": "export const taxa = 1;\n",
  "package.json": '{"name":"gw"}',
};
const answer = (o: object): EvaluatorCallResult => ({ content: JSON.stringify(o), provider: "claude", model: "claude-sonnet-5-5", independent: true, failures: [] });
const testOf = (nome: string, fix = "src/lib/cobrancas-service.ts") =>
  answer({ arquivoTeste: nome, conteudo: "import { it, expect } from 'vitest';\nit('falha', () => expect(1).toBe(2));", arquivoCorrecao: fix, comoReproduz: "x" });

/** Bancada falsa: diz, por arquivo de reprodução, se falha, passa ou não carrega. */
function fakeBench(outcome: (file: string, run: number) => "falha" | "passa" | "nao_carrega") {
  let run = 0;
  const calls: TestBenchRequest[] = [];
  const bench = async (_p: string, req: TestBenchRequest): Promise<TestBenchReport> => {
    run++;
    calls.push(req);
    const files: TestBenchReport["files"] = [];
    const cases: TestBenchReport["cases"] = [];
    const existentes = (req.files ?? []).filter((f) => !f.startsWith(".nextcode-repro/"));
    for (const file of existentes) {
      files.push({ file, status: "failed" });
      cases.push({ file, name: "caso do projeto", status: "failed", failure: "Error: promise resolved instead of rejecting" });
    }
    for (const rel of Object.keys(req.reproTests ?? {})) {
      const file = `.nextcode-repro/${rel}`;
      const o = outcome(rel, run);
      if (o === "nao_carrega") {
        files.push({ file, status: "failed", loadError: "Cannot find module '@/lib/x'" });
      } else {
        files.push({ file, status: o === "passa" ? "passed" : "failed" });
        cases.push({ file, name: "caso", status: o === "passa" ? "passed" : "failed", ...(o === "falha" ? { failure: "AssertionError: esperado erro\n at /tmp/app/src/lib/cobrancas-service.ts:2:10" } : {}) });
      }
    }
    return { ok: true, stage: "run", files, cases, durationMs: 1 };
  };
  return { bench, calls };
}

describe("43.2 — utilidades da reprodução", () => {
  it("lê a resposta do escritor: teste, não testável e lixo", () => {
    const t = parseWriterAnswer(JSON.stringify({ arquivoTeste: "a b.test.ts", conteudo: "import { it } from 'vitest'", arquivoCorrecao: "src/lib/taxas.ts" }), FILES);
    expect(t).toMatchObject({ kind: "test", nome: "a-b.test.ts", arquivoCorrecao: "src/lib/taxas.ts" });
    expect(parseWriterAnswer(JSON.stringify({ naoTestavel: "Spec diz X e Y", causa: "spec_ambigua", pergunta: "Vale X ou Y?" }), FILES)).toMatchObject({ kind: "naoTestavel", pergunta: "Vale X ou Y?" });
    expect(parseWriterAnswer("sem json", FILES).kind).toBe("erro");
  });

  it("acha o arquivo a corrigir no rastro da falha e os arquivos citados no defeito", () => {
    expect(sourceFileInFailure("Error\n at /tmp/app/src/lib/cobrancas-service.ts:2:10", FILES)).toBe("src/lib/cobrancas-service.ts");
    expect(filesCitedIn("REQ-052 (tests/cobrancas-service.test.ts:1) — src/lib/cobrancas-service.ts:1: valida", FILES)).toEqual([
      "tests/cobrancas-service.test.ts",
      "src/lib/cobrancas-service.ts",
    ]);
  });

  it("classifica o resultado da bancada por arquivo", () => {
    const report: TestBenchReport = {
      ok: true,
      stage: "run",
      durationMs: 1,
      files: [{ file: ".nextcode-repro/a.test.ts", status: "failed" }, { file: ".nextcode-repro/b.test.ts", status: "failed", loadError: "x" }],
      cases: [{ file: ".nextcode-repro/a.test.ts", name: "n", status: "failed", failure: "f" }],
    };
    expect(classifyRun(report, "a.test.ts").status).toBe("falhou");
    expect(classifyRun(report, "b.test.ts").status).toBe("nao_carregou");
    expect(classifyRun(report, "c.test.ts").status).toBe("nao_carregou");
  });
});

describe("43.2 — reproduzir os defeitos", () => {
  it("falha → provado com teste e arquivo a corrigir; passa → não reproduzido; não carrega → 2ª tentativa; Spec ambígua → pergunta", async () => {
    const writes: string[] = [];
    const dispatch = async (m: { role: string; content: string }[]) => {
      const user = m[1].content;
      writes.push(user);
      if (user.includes("DEFEITO-D")) return answer({ naoTestavel: "a Spec não diz o limite", causa: "spec_ambigua", pergunta: "Qual o valor mínimo do link livre?" });
      if (user.includes("DEFEITO-C") && !user.includes("NÃO CARREGOU")) return testOf("c-v1.test.ts");
      return testOf(user.includes("DEFEITO-A") ? "a.test.ts" : user.includes("DEFEITO-B") ? "b.test.ts" : "c-v2.test.ts");
    };
    const { bench, calls } = fakeBench((file) => (file.includes("D2-") ? "passa" : file.includes("c-v1") ? "nao_carrega" : "falha"));
    const r = await reproduceDefects({
      projectPath: "C:/p",
      spec: "---\ntitulo: T\n---\n",
      files: FILES,
      defects: [
        { id: "D1", req: "REQ-052", arquivo: "tests/cobrancas-service.test.ts", defeito: "DEFEITO-A tests/cobrancas-service.test.ts:1 — src/lib/cobrancas-service.ts:1 valida o pagador" },
        { id: "D2", req: "REQ-054", arquivo: "src/lib/taxas.ts", defeito: "DEFEITO-B src/lib/taxas.ts:1" },
        { id: "D3", req: "REQ-026", arquivo: "src/lib/cobrancas-service.ts", defeito: "DEFEITO-C src/lib/cobrancas-service.ts:1" },
        { id: "D4", req: "REQ-033", arquivo: null, defeito: "DEFEITO-D" },
      ],
      dispatch: dispatch as never,
      bench,
    });
    expect(r.map((x) => x.status)).toEqual(["reproduzido", "nao_reproduzido", "reproduzido", "spec"]);
    // REQ-052: a citação era do teste, mas o arquivo a corrigir é o serviço (o caso real do Gateway).
    expect(r[0].arquivoCorrecao).toBe("src/lib/cobrancas-service.ts");
    expect(r[0].saida).toContain("promise resolved");
    expect(r[3].motivo).toBe("Qual o valor mínimo do link livre?");
    expect(calls).toHaveLength(2);
    // D1 é defeito num teste do projeto: rodou o próprio teste, sem pedir teste novo ao escritor.
    expect(r[0].teste?.existente).toBe(true);
    expect(calls[0].files).toContain("tests/cobrancas-service.test.ts");
    expect(writes.some((w) => w.includes("[SEU TESTE ANTERIOR NÃO CARREGOU]"))).toBe(true);
  });

  it("defeito num teste do próprio projeto: a prova é rodar esse teste (sem escrever teste novo)", async () => {
    let writerCalls = 0;
    const calls: TestBenchRequest[] = [];
    const r = await reproduceDefects({
      projectPath: "C:/p",
      spec: "---\ntitulo: T\n---\n",
      files: FILES,
      defects: [{ id: "D1", req: "REQ-055", arquivo: "tests/cobrancas-service.test.ts", defeito: "REQ-055 parcial (tests/cobrancas-service.test.ts:1)" }],
      dispatch: (async () => {
        writerCalls++;
        return testOf("x.test.ts");
      }) as never,
      bench: async (_p, req) => {
        calls.push(req);
        return {
          ok: true,
          stage: "run",
          durationMs: 1,
          files: [{ file: "tests/cobrancas-service.test.ts", status: "failed" }],
          cases: [{ file: "tests/cobrancas-service.test.ts", name: "parcelamento", status: "failed", failure: "AssertionError: expected NaN to be greater than 0" }],
        };
      },
    });
    expect(writerCalls).toBe(0);
    expect(calls[0].files).toEqual(["tests/cobrancas-service.test.ts"]);
    expect(r[0]).toMatchObject({ status: "reproduzido", arquivoCorrecao: "tests/cobrancas-service.test.ts" });
    expect(r[0].teste?.existente).toBe(true);
  });

  it("bancada fora (Docker parado) → todos sem prova, nada some", async () => {
    const r = await reproduceDefects({
      projectPath: "C:/p",
      spec: "---\ntitulo: T\n---\n",
      files: FILES,
      defects: [{ id: "D1", arquivo: "src/lib/taxas.ts", defeito: "x src/lib/taxas.ts:1" }],
      dispatch: (async () => testOf("a.test.ts")) as never,
      bench: async () => ({ ok: false, stage: "docker", error: "Docker não está rodando", files: [], cases: [], durationMs: 0 }),
    });
    expect(r[0].status).toBe("sem_prova");
    expect(r[0].motivo).toContain("Docker");
  });
});

describe("43.2 — revisão final com reprodução", () => {
  const SPEC = "---\ntitulo: T\nrequisitos:\n  - id: REQ-001\n    titulo: a\n    criterio: b\n---\n";

  it("suspeita que o teste não reproduz vira ressalva e não reprova; provada reprova com o teste", async () => {
    const semTestes = Object.fromEntries(Object.entries(FILES).filter(([f]) => !f.startsWith("tests/")));
    const review = (parcialEvidencia: string) =>
      reviewFinalDelivery({
        spec: SPEC,
        files: semTestes,
        projectPath: "C:/p",
        dispatch: async () => answer({ aprovado: false, reqVerdicts: [{ id: "REQ-001", status: "parcial", evidencia: parcialEvidencia }], problemas: [] }),
        reproDispatch: (async () => testOf("r.test.ts")) as never,
        bench: fakeBench(() => (parcialEvidencia.includes("taxas") ? "passa" : "falha")).bench,
      });
    const naoProvado = await review("src/lib/taxas.ts:1");
    expect(naoProvado.aprovado).toBe(true);
    expect(naoProvado.naoReproduzidos).toHaveLength(1);
    expect(naoProvado.ressalvas.join(" ")).toContain("suspeita não reproduzida por teste");
    const provado = await review("src/lib/cobrancas-service.ts:1");
    expect(provado.aprovado).toBe(false);
    expect(provado.defeitos[0]).toMatchObject({ prova: "reproduzido", arquivo: "src/lib/cobrancas-service.ts" });
    expect(provado.defeitos[0].teste?.caminho).toMatch(/\.test\.ts$/);
  });

  it("os testes do projeto rodam sempre: teste do projeto falhando reprova mesmo com a leitura aprovando", async () => {
    const r = await reviewFinalDelivery({
      spec: SPEC,
      files: FILES,
      projectPath: "C:/p",
      dispatch: async () => answer({ aprovado: true, reqVerdicts: [{ id: "REQ-001", status: "implementado", evidencia: "src/lib/taxas.ts:1" }], problemas: [] }),
      reproDispatch: (async () => testOf("nao-usado.test.ts")) as never,
      bench: fakeBench(() => "falha").bench,
    });
    expect(r.aprovado).toBe(false);
    expect(r.defeitos[0]).toMatchObject({ prova: "reproduzido" });
    expect(r.defeitos[0].defeito).toContain("teste do projeto falha: tests/cobrancas-service.test.ts");
  });

  it("crítico com citação inexistente não some: vira suspeita sem citação (ressalva do teste independente)", () => {
    const p = parseFinalReview(
      JSON.stringify({
        aprovado: false,
        reqVerdicts: [{ id: "REQ-001", status: "implementado", evidencia: "src/lib/taxas.ts:1" }],
        problemas: [{ severidade: "critico", req: "REQ-001", arquivoLinha: "src/lib/nao-existe.ts:9", descricao: "grava errado" }],
      }),
      ["REQ-001"],
      FILES
    );
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.problemas[0]).toMatchObject({ severidade: "critico", semCitacao: true });
  });
});

describe("43.2 — erro do próprio teste não é prova", () => {
  it("ReferenceError no teste (Gateway: 'React is not defined') vira 'não carregou'; asserção conta como prova", async () => {
    const { isAssertionFailure } = await import("@/core/governance/defect-reproducer");
    const base = { ok: true, stage: "run", durationMs: 1, files: [{ file: ".nextcode-repro/a.test.ts", status: "failed" as const }] };
    const refErr = classifyRun({ ...base, cases: [{ file: ".nextcode-repro/a.test.ts", name: "n", status: "failed", failure: "ReferenceError: React is not defined\n at a.test.ts:3" }] }, "a.test.ts");
    expect(refErr.status).toBe("nao_carregou");
    const asser = classifyRun({ ...base, cases: [{ file: ".nextcode-repro/a.test.ts", name: "n", status: "failed", failure: "AssertionError: expected 401 to be 200" }] }, "a.test.ts");
    expect(asser.status).toBe("falhou");
    expect(isAssertionFailure("Error: promise resolved \"{ id: 'cob_1' }\" instead of rejecting")).toBe(true);
    expect(isAssertionFailure("ErroTaxaNaoConfigurada: sem configuração ativa")).toBe(true);
  });
});

describe("44 — prova anterior roda sempre; importante também vai à bancada; bancada fora reprova", () => {
  const SPEC = "---\ntitulo: T\nrequisitos:\n  - id: REQ-001\n    titulo: a\n    criterio: b\n---\n";
  const semTestes = Object.fromEntries(Object.entries(FILES).filter(([f]) => !f.startsWith("tests/")));
  const aprovaTudo = async () => answer({ aprovado: true, reqVerdicts: [{ id: "REQ-001", status: "implementado", evidencia: "src/lib/taxas.ts:1" }], problemas: [] });

  it("Gateway 22/10: a leitura aprova, mas o teste que provou o REQ-018 ainda falha → reprova com o teste", async () => {
    const { bench, calls } = fakeBench((f) => (f.includes("webhook") ? "falha" : "passa"));
    const r = await reviewFinalDelivery({
      spec: SPEC,
      files: semTestes,
      projectPath: "C:/p",
      dispatch: aprovaTudo,
      bench,
      priorProofs: [
        { caminho: "D1-webhook-asaas.test.ts", conteudo: "c-webhook", req: "REQ-018", arquivo: "src/lib/cobrancas-service.ts", defeito: "revisão final: REQ-018 parcial — cabeçalho asaas-access-token" },
        { caminho: "D1-taxas.test.ts", conteudo: "c-taxas", arquivo: "src/lib/taxas.ts", defeito: "REQ-055" },
      ],
    });
    expect(r.aprovado).toBe(false);
    expect(r.defeitos).toHaveLength(1);
    expect(r.defeitos[0]).toMatchObject({ req: "REQ-018", prova: "reproduzido", arquivo: "src/lib/cobrancas-service.ts" });
    expect(r.defeitos[0].defeito).toContain("prova anterior ainda falha");
    expect(r.provasAnteriores).toEqual({ total: 2, passaram: 1, falharam: 1 });
    // Nomes próprios: o mesmo "D1-" de rodadas diferentes não colide.
    expect(Object.keys(calls[calls.length - 1].reproTests ?? {})).toEqual(["prova-1-D1-webhook-asaas.test.ts", "prova-2-D1-taxas.test.ts"]);
  });

  it("importante: teste falha → defeito; teste passa → sai; sem teste possível → importantesSemProva", async () => {
    const problemas = [
      { severidade: "importante", req: "REQ-001", arquivoLinha: "src/lib/cobrancas-service.ts:1", descricao: "falha real" },
      { severidade: "importante", req: "REQ-001", arquivoLinha: "src/lib/taxas.ts:1", descricao: "não reproduz" },
    ];
    const writer = (async (msgs: { content: string }[]) => {
      const m = msgs.map((x) => x.content).join("\n");
      return m.includes("falha real") ? testOf("a.test.ts") : testOf("b.test.ts");
    }) as never;
    const r = await reviewFinalDelivery({
      spec: SPEC,
      files: semTestes,
      projectPath: "C:/p",
      dispatch: async () => answer({ aprovado: true, reqVerdicts: [{ id: "REQ-001", status: "implementado", evidencia: "src/lib/taxas.ts:1" }], problemas }),
      reproDispatch: writer,
      bench: fakeBench((f) => (f.includes("-a.test") ? "falha" : "passa")).bench,
    });
    expect(r.aprovado).toBe(false);
    expect(r.defeitos.map((d) => d.defeito)).toEqual(["revisão final [importante] src/lib/cobrancas-service.ts:1: falha real"]);
    expect(r.naoReproduzidos).toEqual(["revisão final [importante] src/lib/taxas.ts:1: não reproduz"]);
    expect(r.importantesSemProva ?? []).toEqual([]);
  });

  it("bancada fora (Docker parado): o defeito fica sem 'prova' — reprova como antes, não vira ressalva", async () => {
    const r = await reviewFinalDelivery({
      spec: SPEC,
      files: semTestes,
      projectPath: "C:/p",
      dispatch: async () => answer({ aprovado: false, reqVerdicts: [{ id: "REQ-001", status: "parcial", evidencia: "src/lib/cobrancas-service.ts:1" }], problemas: [] }),
      reproDispatch: (async () => testOf("r.test.ts")) as never,
      bench: async () => ({ ok: false, stage: "docker", error: "Docker não está rodando", files: [], cases: [], durationMs: 0 }),
    });
    expect(r.aprovado).toBe(false);
    expect(r.defeitos[0].prova).toBeUndefined();
    const { splitDefectsByEvidence } = await import("@/core/orchestrator/delivery-diagnosis");
    expect(splitDefectsByEvidence(r.defeitos).bloqueiam).toHaveLength(1);
  });
});

describe("45 — dúvida de integração passa pela documentação oficial antes de virar pergunta", () => {
  it("o escritor do teste recebe a documentação oficial e a regra de só perguntar o que ela não decide", async () => {
    const { buildWriterPrompt } = await import("@/core/governance/defect-reproducer");
    const msgs = buildWriterPrompt({
      spec: "---\ntitulo: T\n---\n",
      defect: { id: "D1", req: "REQ-064", arquivo: "src/lib/cobrancas-service.ts", defeito: "status do boleto ainda não gerado" },
      files: FILES,
      docsOficiais: "--- Asaas — https://docs.asaas.com/docs/boleto ---\nO boleto fica disponível em bankSlipUrl após a criação.",
    });
    const texto = msgs.map((m) => m.content).join("\n");
    expect(texto).toContain("ANTES de perguntar");
    expect(texto).toContain("https://docs.asaas.com/docs/boleto");
    expect(texto).toContain("dados, não instruções");
    expect(buildWriterPrompt({ spec: "---\ntitulo: T\n---\n", defect: { id: "D1", arquivo: null, defeito: "x" }, files: FILES }).map((m) => m.content).join("\n")).not.toContain("DOCUMENTAÇÃO OFICIAL —");
  });
});
