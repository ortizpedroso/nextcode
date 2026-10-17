import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/core/llm/cost", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/core/llm/cost")>();
  return { ...orig, recordLlmCost: vi.fn(async () => 0) };
});

import { SpecDecomposerSkill, parseAnalystPlan } from "@/core/skills/spec-decomposer";
import { renderCanonicalSpecDocument } from "@/core/intake/spec-format";
import { validateFinalPlan } from "@/core/orchestrator/plan-scope-check";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";
import { loadRoleSkill } from "@/core/skills/skill-runtime";

const FILES = ["src/lib/validacao.ts", "src/app/api/v1/links/route.ts", "src/app/api/cobrancas/route.ts"];
const SPEC = renderCanonicalSpecDocument({
  titulo: "Teste A2.2",
  status: "aprovada",
  data: "2026-10-17",
  objetivo: "teste",
  stack: ["TypeScript", "Next.js"],
  modulos: [{ id: "MOD-01", nome: "api", resumo: "api", arquivos: FILES }],
  entidades: [],
  arquivosAfetados: FILES,
  requisitos: [
    { id: "REQ-001", titulo: "Validação", criterio: "src/lib/validacao.ts valida CPF" },
    { id: "REQ-002", titulo: "Links", criterio: "src/app/api/v1/links/route.ts usa src/lib/validacao.ts" },
    { id: "REQ-003", titulo: "Cobranças", criterio: "src/app/api/cobrancas/route.ts e src/app/api/v1/links/route.ts" },
  ],
} as any);

const planJson = (mbs: unknown[]) => "```json\n" + JSON.stringify({ microbriefs: mbs }) + "\n```";
const GOOD = [
  { id: "mb-1", cluster: "core", arquivos: ["src/lib/validacao.ts"], reqs: ["REQ-001"], dependeDe: [] },
  { id: "mb-2", cluster: "backend", arquivos: ["src/app/api/v1/links/route.ts", "src/app/api/cobrancas/route.ts"], reqs: ["REQ-002", "REQ-003"], dependeDe: ["mb-1"] },
];
const BAD = [
  { id: "mb-1", cluster: "core", arquivos: ["src/lib/validacao.ts"], reqs: ["REQ-001", "REQ-002"], dependeDe: [] },
  { id: "mb-2", cluster: "backend", arquivos: ["src/app/api/v1/links/route.ts", "src/app/api/cobrancas/route.ts"], reqs: ["REQ-003"], dependeDe: ["mb-1"] },
];

function fakeRouter(replies: (string | Error)[]) {
  const calls: any[] = [];
  return {
    calls,
    dispatchWithFallback: vi.fn(async (args: any) => {
      calls.push(JSON.parse(JSON.stringify(args.messages)));
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (r instanceof Error) throw r;
      return {
        providerUsed: "deepseek",
        modelUsed: "deepseek-v4-pro",
        response: { json: async () => ({ choices: [{ message: { content: r } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) },
      };
    }),
  };
}

const reqsSpec = [
  { id: "REQ-001", titulo: "Validação", criterio: "src/lib/validacao.ts valida CPF" },
  { id: "REQ-002", titulo: "Links", criterio: "src/app/api/v1/links/route.ts usa src/lib/validacao.ts" },
  { id: "REQ-003", titulo: "Cobranças", criterio: "src/app/api/cobrancas/route.ts e src/app/api/v1/links/route.ts" },
];
const textoPorReq = Object.fromEntries(reqsSpec.map((r) => [r.id, `${r.titulo} ${r.criterio}`]));

describe("A2.2 — analista planeja e o código confere", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    logSpy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
  });
  const actions = () => logSpy.mock.calls.map((c: any) => c[0].action);

  it("plano bom na 1ª rodada → nós com Microbrief completo (critérios da Spec), plano final válido", async () => {
    const router = fakeRouter([planJson(GOOD)]);
    const d = await SpecDecomposerSkill.decomposeWithAnalistaSkill({ specText: SPEC, titulo: "Teste A2.2", files: FILES, smartRouter: router });
    expect(actions()).toContain("ANALISTA_PLAN_APPROVED");
    const impl = d.nodes.filter((n: any) => n.payload?.microbrief);
    expect(impl).toHaveLength(2);
    const mb2 = (impl[1].payload as any).microbrief;
    expect(mb2.criteriosAceitePorReq["REQ-002"][0]).toBe("Links: src/app/api/v1/links/route.ts usa src/lib/validacao.ts");
    expect(mb2.arquivosPermitidos.lerContratos).toEqual(["src/lib/validacao.ts"]);
    expect(impl[1].dependencies).toEqual([impl[0].id]);
    expect(validateFinalPlan(d.nodes as any, ["REQ-001", "REQ-002", "REQ-003"], textoPorReq, 4).valid).toBe(true);
  });

  it("plano ruim → erros voltam ao modelo; aprovado na 2ª rodada", async () => {
    const router = fakeRouter([planJson(BAD), planJson(GOOD)]);
    const d = await SpecDecomposerSkill.decomposeWithAnalistaSkill({ specText: SPEC, titulo: "Teste A2.2", files: FILES, smartRouter: router });
    expect(router.calls).toHaveLength(2);
    const second = router.calls[1];
    expect(second.at(-2).role).toBe("assistant");
    expect(second.at(-1).content).toContain('REQ-002 (etapa mb-1) exige "src/app/api/v1/links/route.ts"');
    expect(actions()).toEqual(expect.arrayContaining(["ANALISTA_PLAN_RETRY", "ANALISTA_PLAN_APPROVED"]));
    expect(d.nodes.filter((n: any) => n.payload?.microbrief)).toHaveLength(2);
  });

  it("3 rodadas ruins → reserva (heurística) registrada como rodadas_esgotadas", async () => {
    const router = fakeRouter([planJson(BAD)]);
    await SpecDecomposerSkill.decomposeWithAnalistaSkill({ specText: SPEC, titulo: "Teste A2.2", files: FILES, smartRouter: router });
    expect(router.calls).toHaveLength(3);
    const fb = logSpy.mock.calls.find((c: any) => c[0].action === "ANALISTA_PLAN_FALLBACK");
    expect(fb?.[0].details.reason).toBe("rodadas_esgotadas");
  });

  it("modelo fora do ar → reserva registrada (antes voltava calado)", async () => {
    const router = fakeRouter([new Error("timeout")]);
    await SpecDecomposerSkill.decomposeWithAnalistaSkill({ specText: SPEC, titulo: "Teste A2.2", files: FILES, smartRouter: router });
    const fb = logSpy.mock.calls.find((c: any) => c[0].action === "ANALISTA_PLAN_FALLBACK");
    expect(fb?.[0].details.reason).toBe("exception_or_offline");
  });

  it("resposta sem JSON → erro de formato devolvido ao modelo (não volta calado)", async () => {
    const router = fakeRouter(["não sei", planJson(GOOD)]);
    await SpecDecomposerSkill.decomposeWithAnalistaSkill({ specText: SPEC, titulo: "Teste A2.2", files: FILES, smartRouter: router });
    expect(router.calls[1].at(-1).content).toContain("[FORMATO]");
    expect(actions()).toContain("ANALISTA_PLAN_APPROVED");
  });

  it("arquivo esquecido ou inventado reprova o plano", async () => {
    const router = fakeRouter([
      planJson([{ id: "mb-1", cluster: "core", arquivos: ["src/lib/validacao.ts", "src/lib/inventado.ts"], reqs: ["REQ-001", "REQ-002", "REQ-003"], dependeDe: [] }]),
      planJson(GOOD),
    ]);
    await SpecDecomposerSkill.decomposeWithAnalistaSkill({ specText: SPEC, titulo: "Teste A2.2", files: FILES, smartRouter: router });
    const msg = router.calls[1].at(-1).content;
    expect(msg).toContain("[T8b ARQUIVO INVENTADO]");
    expect(msg).toContain("[T8b ARQUIVO SEM ETAPA]");
  });

  it("parseAnalystPlan recusa cluster inválido e id repetido", () => {
    expect(parseAnalystPlan(planJson([{ id: "a", cluster: "banco", arquivos: [], reqs: [], dependeDe: [] }]))).toMatchObject({ ok: false });
    expect(parseAnalystPlan(planJson([GOOD[0], GOOD[0]]))).toMatchObject({ ok: false });
  });

  it("skill analista diz a verdade: sem ferramentas e 1 passo", () => {
    const s = loadRoleSkill("analista");
    expect(s.ferramentas).toEqual([]);
    expect(s.passosMax).toBe(1);
  });
});
