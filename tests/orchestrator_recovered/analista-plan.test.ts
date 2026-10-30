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

const GOOD_CONTRACT = {
  entidades: [
    {
      nome: "LinkItem",
      campos: [{ nome: "id", tipo: "string" }, { nome: "url", tipo: "string" }],
      dono: "mb-1",
    },
  ],
  enums: [],
  funcoes: [
    {
      nome: "validarLink",
      arquivo: "src/lib/validacao.ts",
      assinatura: "(url: string) => boolean",
      dono: "mb-1",
      usadoPor: ["mb-2"],
    },
  ],
  rotas: [
    {
      metodo: "POST",
      caminho: "/api/v1/links",
      arquivo: "src/app/api/v1/links/route.ts",
      entrada: "{ url: string }",
      saida: "LinkItem",
      erros: [{ status: 400, corpo: "{ erro: string }" }],
      dono: "mb-2",
      usadoPor: [],
    },
  ],
};

const planJson = (mbs: unknown[], contrato: unknown = GOOD_CONTRACT) =>
  "```json\n" + JSON.stringify(contrato ? { microbriefs: mbs, contrato } : { microbriefs: mbs }) + "\n```";
const GOOD = [
  { id: "mb-1", cluster: "core", arquivos: ["src/lib/validacao.ts"], reqs: ["REQ-001"], dependeDe: [] },
  { id: "mb-2", cluster: "backend", arquivos: ["src/app/api/v1/links/route.ts", "src/app/api/cobrancas/route.ts"], reqs: ["REQ-002", "REQ-003"], dependeDe: ["mb-1"] },
];
const BAD = [
  { id: "mb-1", cluster: "core", arquivos: ["src/lib/validacao.ts"], reqs: ["REQ-001", "REQ-002"], dependeDe: [] },
  { id: "mb-2", cluster: "backend", arquivos: ["src/app/api/v1/links/route.ts", "src/app/api/cobrancas/route.ts"], reqs: ["REQ-003"], dependeDe: ["mb-1"] },
];

function fakeRouter(replies: (string | Error)[], finishReason = "stop") {
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
        response: { json: async () => ({ choices: [{ message: { content: r }, finish_reason: finishReason }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) },
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

  it("3 rodadas ruins → PLANO_REPROVADO sem heurística (0 etapas)", async () => {
    const router = fakeRouter([planJson(BAD)]);
    const d = await SpecDecomposerSkill.decomposeWithAnalistaSkill({
      specText: SPEC,
      titulo: "Teste A2.2",
      files: FILES,
      smartRouter: router,
    });
    expect(router.calls).toHaveLength(3);
    expect(d.nodes).toHaveLength(0);
    expect(d.planoReprovado?.motivo).toBe("rodadas_esgotadas");
    expect(logSpy.mock.calls.some((c: any) => c[0].action === "ANALISTA_PLAN_FALLBACK")).toBe(false);
    expect(actions()).toContain("PLANO_REPROVADO");
  });

  it("modelo fora do ar → PLANO_REPROVADO (sem heurística)", async () => {
    const router = fakeRouter([new Error("timeout")]);
    const d = await SpecDecomposerSkill.decomposeWithAnalistaSkill({
      specText: SPEC,
      titulo: "Teste A2.2",
      files: FILES,
      smartRouter: router,
    });
    expect(d.planoReprovado?.motivo).toBe("exception_or_offline");
    expect(d.nodes).toHaveLength(0);
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

  it("A2.3b: resposta cortada no teto de tokens → erro [CORTADA] (não 'sem JSON') e prazo do gateway repassado", async () => {
    const router = fakeRouter(['{"microbriefs": [ {"id": "mb-1"'], "length");
    await SpecDecomposerSkill.decomposeWithAnalistaSkill({ specText: SPEC, titulo: "Teste A2.2", files: FILES, smartRouter: router });
    expect(router.calls[1].at(-1).content).toContain("[CORTADA]");
    const args = router.dispatchWithFallback.mock.calls[0][0] as any;
    expect(args.gatewayTimeoutMs).toBe(600_000);
    expect(args.maxTokens).toBe(32000);
  });
  it("R2: corpo cortado pelo prazo (sem choices) → repete o mesmo pedido, trilha 'sem_resposta' (não [FORMATO])", async () => {
    const calls: any[] = [];
    let n = 0;
    const router = {
      dispatchWithFallback: vi.fn(async (args: any) => {
        calls.push(JSON.parse(JSON.stringify(args.messages)));
        n++;
        return {
          providerUsed: "deepseek",
          modelUsed: "deepseek-v4-pro",
          response: {
            json: async () => {
              if (n === 1) throw new Error("This operation was aborted");
              return { choices: [{ message: { content: planJson(GOOD) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
            },
          },
        };
      }),
    };
    await SpecDecomposerSkill.decomposeWithAnalistaSkill({ specText: SPEC, titulo: "Teste A2.2", files: FILES, smartRouter: router });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    const retry = logSpy.mock.calls.map((c: any) => c[0]).find((e: any) => e.action === "ANALISTA_PLAN_RETRY");
    expect(retry.details).toMatchObject({ rodada: 1, motivo: "sem_resposta", custoNaoMedido: true });
    expect(actions()).toContain("ANALISTA_PLAN_APPROVED");
  });

  describe("A1.2 — O analista escreve o contrato do Macrobrief", () => {
    it("plano com contrato válido → aprovado, e o Microbrief recebe a fatia", async () => {
      const router = fakeRouter([planJson(GOOD, GOOD_CONTRACT)]);
      const d = await SpecDecomposerSkill.decomposeWithAnalistaSkill({
        specText: SPEC,
        titulo: "Teste A1.2",
        files: FILES,
        smartRouter: router,
      });

      expect(actions()).toContain("ANALISTA_PLAN_APPROVED");
      const approvedLog = logSpy.mock.calls
        .map((c: any) => c[0])
        .find((e: any) => e.action === "ANALISTA_PLAN_APPROVED");

      expect(approvedLog.details).toMatchObject({
        entidades: 1,
        enums: 0,
        funcoes: 1,
        rotas: 1,
      });

      // Macrobrief possui contratosTypescript renderizado
      expect(d.macrobrief?.contratosTypescript).toContain("export interface LinkItem");
      expect(d.macrobrief?.contratosTypescript).toContain("export type FnValidarLink");

      // Microbriefs recebem as fatias correspondentes
      const impl = d.nodes.filter((n: any) => n.payload?.microbrief);
      const mb1 = (impl[0].payload as any).microbrief;
      const mb2 = (impl[1].payload as any).microbrief;

      // mb-1 produz LinkItem e validarLink
      expect(mb1.interfacesProduz).toContain("export interface LinkItem");
      expect(mb1.interfacesProduz).toContain("export type FnValidarLink");

      // mb-2 consome o contrato produzido por mb-1
      expect(mb2.interfacesConsome.some((c: string) => c.includes("export type FnValidarLink"))).toBe(true);
    });

    it("contrato com erro → a 2ª rodada recebe o erro de contrato", async () => {
      const badContract = {
        entidades: [],
        enums: [],
        funcoes: [
          {
            nome: "funcaoSemDonoValido",
            arquivo: "src/lib/validacao.ts",
            assinatura: "() => void",
            dono: "mb-fantasma",
            usadoPor: [],
          },
        ],
        rotas: [],
      };

      const router = fakeRouter([
        planJson(GOOD, badContract),
        planJson(GOOD, GOOD_CONTRACT),
      ]);

      await SpecDecomposerSkill.decomposeWithAnalistaSkill({
        specText: SPEC,
        titulo: "Teste A1.2",
        files: FILES,
        smartRouter: router,
      });

      expect(router.calls).toHaveLength(2);
      const secondPrompt = router.calls[1].at(-1).content;
      expect(secondPrompt).toContain('[DONO INEXISTENTE] Função "funcaoSemDonoValido" tem dono inexistente "mb-fantasma"');
      expect(actions()).toEqual(expect.arrayContaining(["ANALISTA_PLAN_RETRY", "ANALISTA_PLAN_APPROVED"]));
    });

    it("3 rodadas inválidas de contrato → PLANO_REPROVADO registrado na trilha", async () => {
      const badContract = {
        entidades: [],
        enums: [],
        funcoes: [
          {
            nome: "funcaoErroEterno",
            arquivo: "src/lib/validacao.ts",
            assinatura: "() => void",
            dono: "mb-fantasma",
            usadoPor: [],
          },
        ],
        rotas: [],
      };

      const router = fakeRouter([
        planJson(GOOD, badContract),
        planJson(GOOD, badContract),
        planJson(GOOD, badContract),
      ]);

      await SpecDecomposerSkill.decomposeWithAnalistaSkill({
        specText: SPEC,
        titulo: "Teste A1.2",
        files: FILES,
        smartRouter: router,
      });

      expect(router.calls).toHaveLength(3);
      expect(actions()).toContain("PLANO_REPROVADO");
      const reprovadoLog = logSpy.mock.calls
        .map((c: any) => c[0])
        .find((e: any) => e.action === "PLANO_REPROVADO");
      expect(reprovadoLog.details).toMatchObject({
        motivo: "rodadas_esgotadas",
        dono: "analista",
      });
    });

    it("skipModel em teste registra CONTRATO_AUSENTE na trilha de auditoria", async () => {
      await SpecDecomposerSkill.decomposeWithAnalistaSkill({
        specText: SPEC,
        titulo: "Teste A1.2",
        files: FILES,
        skipModel: true,
      });

      expect(actions()).toContain("CONTRATO_AUSENTE");
      const ausenteLog = logSpy.mock.calls
        .map((c: any) => c[0])
        .find((e: any) => e.action === "CONTRATO_AUSENTE");
      expect(ausenteLog.details).toMatchObject({ motivo: "skip_model_teste" });
    });
  });
});
