import { describe, it, expect, vi, afterEach } from "vitest";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";
import { readPlannedTier } from "@/core/orchestrator/node-executor";
import { resolveExecutorTierForAttempt } from "@/core/config/orchestration-policy";
import { dispatchStrongEvaluator, resetEvaluatorState } from "@/core/llm/evaluator-models";
import type { GatewayConfig } from "@/core/llm/gateways";

const type1Ok = { passed: true, compilationErrors: [], lintWarnings: [], securityViolations: [] } as never;
const code = { "src/lib/x.ts": "export const x = 1;\n" };

afterEach(() => {
  vi.restoreAllMocks();
  resetEvaluatorState();
});

describe("Veredito por REQ obrigatório", () => {
  it("avaliador aprova sem julgar todos os REQ → resposta descartada e a etapa NÃO é aprovada", async () => {
    const calls: number[] = [];
    const res = await DualLensAuditor.validateType2(type1Ok, "# brief", "ok", code, async () => {
      calls.push(1);
      return JSON.stringify({ implemented: true, missingRequirements: [], justification: "ok",
        reqVerdicts: [{ id: "REQ-001", status: "implementado", evidencia: "src/lib/x.ts:1" }] });
    }, { expectedReqs: ["REQ-001", "REQ-002"] });
    expect(calls.length).toBe(2); // perguntou de novo
    expect(res.verdict).toBe("REJECTED");
  });

  it("todos os REQ julgados como implementado → aprovado; REQ inventado é ignorado", async () => {
    const res = await DualLensAuditor.validateType2(type1Ok, "# brief", "ok", code, async () =>
      JSON.stringify({ implemented: true, missingRequirements: [], justification: "ok", reqVerdicts: [
        { id: "REQ-001", status: "implementado", evidencia: "src/lib/x.ts:1" },
        { id: "REQ-999", status: "ausente", evidencia: "-" },
      ] }), { expectedReqs: ["REQ-001"] });
    expect(res.verdict).toBe("APPROVED");
    expect(res.reqVerdicts?.map((r) => r.id)).toEqual(["REQ-001"]);
  });
});

describe("Nível de modelo do executor (Jev + escalada)", () => {
  it("lê o plano do Jev; nó antigo sem plano fica no pesado", () => {
    expect(readPlannedTier(JSON.stringify({ jevPlan: { nivelModelo: "rapido" } }))).toBe("rapido");
    expect(readPlannedTier(JSON.stringify({ goal: "x" }))).toBe("pesado");
  });

  it("rápido sobe a cada tentativa: rápido → médio → pesado", () => {
    expect([1, 2, 3].map((a) => resolveExecutorTierForAttempt("rapido", a))).toEqual(["rapido", "medio", "pesado"]);
  });
});

describe("AV1.1 — cadeia trocada (bench) ainda passa pelo FreeLLMAPI com a trava de rota", () => {
  const fakeGateway: GatewayConfig = {
    id: "freellmapi",
    enabled: true,
    priority: 0,
    baseUrl: "http://localhost:3100/v1",
    apiKey: "free-key",
    modelFast: "auto:fast",
    modelHeavy: "auto:smart",
  };
  const loader = async () => [fakeGateway];

  it("cadeia com Nemotron e executor DeepSeek → Nemotron via ollama/nemotron é aceito e independente", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "x-routed-via": "ollama/nemotron-3-ultra" },
      })
    );
    const r = await dispatchStrongEvaluator([{ role: "user", content: "x" }], {
      loader,
      chain: [{ provider: "nvidia", model: "nemotron-3-ultra", routedPrefixes: ["ollama/nemotron", "nvidia/"] }],
    });
    expect(r.provider).toBe("nvidia");
    expect(r.independent).toBe(true);
    expect(r.model).toBe("ollama/nemotron-3-ultra");
  });
});

describe("Tamanho do Microbrief", () => {
  it("critérios nunca são cortados, mesmo acima do limite; só o recorte da Spec encolhe", async () => {
    const { renderMicrobriefMarkdown } = await import("@/core/templates/artifact-templates");
    const longCrit = "x".repeat(3000);
    const mb = {
      documento: "microbrief", idMicrobrief: "n1", idMacrobrief: "m", idProjeto: "p", cluster: "core",
      nivelModeloSugerido: "medio", dependeDe: [], reqsCobertos: ["REQ-001", "REQ-002"],
      arquivosPermitidos: { criar: ["src/lib/a.ts"], modificar: [], lerContratos: [] },
      statusExecucao: "PENDENTE", tentativaAtual: 0,
      medidoPeloHarness: { compilou: null, testes: null, arquivosAlterados: [] },
      interfacesConsome: [], interfacesProduz: "",
      criteriosAceitePorReq: { "REQ-001": [longCrit + "FIM1"], "REQ-002": [longCrit + "FIM2"] },
      registroCumprimento: [],
    } as never;
    const out = renderMicrobriefMarkdown(mb, { maxChars: 2000 });
    expect(out).toContain("FIM1");
    expect(out).toContain("FIM2");
  });
});
