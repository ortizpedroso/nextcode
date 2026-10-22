import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseVitestJson, depsStamp, runTestBench, setTestBenchRunnerForTests } from "@/core/execution/test-bench";

// Mudança 43.1 — bancada de testes: o JSON do vitest vira resultado por caso, com a falha legível.
const VITEST_JSON = JSON.stringify({
  numFailedTests: 1,
  testResults: [
    {
      name: "/tmp/app/.nextcode-repro/REQ-026-pagador.test.ts",
      status: "failed",
      message: "",
      assertionResults: [
        {
          fullName: "criarCobranca recusa pagador sem contato",
          title: "recusa pagador sem contato",
          status: "failed",
          failureMessages: ["\u001b[31mAssertionError: expected [Function] to throw error including 'Informe ao menos um contato'\u001b[39m\n    at /tmp/app/src/lib/cobrancas-service.ts:198:11"],
        },
        { fullName: "aceita pagador com e-mail", title: "aceita pagador com e-mail", status: "passed", failureMessages: [] },
      ],
    },
    {
      name: "/tmp/app/.nextcode-repro/REQ-033-valor-livre.test.ts",
      status: "failed",
      message: "Error: Cannot find module '@/lib/checkout' imported from /tmp/app/.nextcode-repro/REQ-033-valor-livre.test.ts",
      assertionResults: [],
    },
    { name: "/tmp/app/tests/taxas.test.ts", status: "passed", assertionResults: [{ fullName: "calcula taxa", status: "passed", failureMessages: [] }] },
  ],
});

describe("43.1 — bancada de testes", () => {
  it("lê casos, falhas sem cor e arquivos que nem carregaram", () => {
    const r = parseVitestJson(VITEST_JSON);
    expect(r.cases).toHaveLength(3);
    const falha = r.cases.find((c) => c.status === "failed")!;
    expect(falha.file).toBe(".nextcode-repro/REQ-026-pagador.test.ts");
    expect(falha.failure).toContain("Informe ao menos um contato");
    expect(falha.failure).toContain("src/lib/cobrancas-service.ts:198");
    expect(falha.failure).not.toContain("\u001b[");
    const carga = r.files.find((f) => f.file === ".nextcode-repro/REQ-033-valor-livre.test.ts")!;
    expect(carga.loadError).toContain("Cannot find module");
    expect(r.files.find((f) => f.file === "tests/taxas.test.ts")?.status).toBe("passed");
  });

  it("o carimbo do cache muda com o package.json ou o schema, e só com eles", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-"));
    fs.writeFileSync(path.join(dir, "package.json"), '{"name":"a"}');
    const s1 = depsStamp(dir);
    fs.writeFileSync(path.join(dir, "README.md"), "x");
    expect(depsStamp(dir)).toBe(s1);
    fs.mkdirSync(path.join(dir, "prisma"));
    fs.writeFileSync(path.join(dir, "prisma", "schema.prisma"), "model A { id Int @id }");
    expect(depsStamp(dir)).not.toBe(s1);
  });

  it("nos testes automáticos não sobe contêiner; o executor injetado é usado", async () => {
    expect((await runTestBench("C:/p", {})).stage).toBe("skipped");
    setTestBenchRunnerForTests(async () => ({ ok: true, stage: "run", files: [], cases: [], durationMs: 1 }));
    expect((await runTestBench("C:/p", {})).ok).toBe(true);
    setTestBenchRunnerForTests(null);
  });
});
