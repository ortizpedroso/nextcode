import { describe, it, expect } from "vitest";
import { checkPlanScope, validateFinalPlan, type PlanStage } from "@/core/orchestrator/plan-scope-check";
import { transition } from "@/core/orchestrator/phase-machine";
import { SpecDecomposerSkill } from "@/core/skills/spec-decomposer";
import { renderCanonicalSpecDocument } from "@/core/intake/spec-format";

const base: PlanStage = { id: "base", arquivos: ["src/lib/validacao.ts", "src/lib/cobrancas.ts"], reqs: ["REQ-009"], dependeDe: [] };

describe("A2.1 — T8b confere arquivo citado × escopo da etapa", () => {
  it("caso real etapa 3 (934939fc): REQ-032 numa etapa de lib exigindo a rota de outra etapa → erro", () => {
    const rota: PlanStage = { id: "rota", arquivos: ["src/app/api/v1/links/route.ts"], reqs: [], dependeDe: ["base"] };
    const lib: PlanStage = { ...base, reqs: ["REQ-009", "REQ-032"] };
    const r = checkPlanScope([lib, rota], {
      "REQ-009": "src/lib/validacao.ts valida CPF",
      "REQ-032": "POST src/app/api/v1/links/route.ts usa as mesmas regras de src/lib/validacao.ts",
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toContain('REQ-032 (etapa base) exige "src/app/api/v1/links/route.ts"');
  });

  it("REQ na etapa da rota citando a lib da qual ela depende → válido (arquivo consumido não é erro)", () => {
    const rota: PlanStage = { id: "rota", arquivos: ["src/app/api/v1/links/route.ts"], reqs: ["REQ-032"], dependeDe: ["base"] };
    const r = checkPlanScope([base, rota], {
      "REQ-009": "src/lib/validacao.ts valida CPF",
      "REQ-032": "POST src/app/api/v1/links/route.ts usa as mesmas regras de src/lib/validacao.ts",
    });
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it("dependência indireta também conta (rota → serviço → base)", () => {
    const svc: PlanStage = { id: "svc", arquivos: ["src/lib/servico.ts"], reqs: [], dependeDe: ["base"] };
    const rota: PlanStage = { id: "rota", arquivos: ["src/app/api/x/route.ts"], reqs: ["REQ-001"], dependeDe: ["svc"] };
    const r = checkPlanScope([{ ...base, reqs: [] }, svc, rota], { "REQ-001": "src/app/api/x/route.ts chama src/lib/validacao.ts" });
    expect(r.valid).toBe(true);
  });

  it("REQ em 2 etapas → erro de REQ repetido", () => {
    const outra: PlanStage = { id: "outra", arquivos: ["src/lib/x.ts"], reqs: ["REQ-009"], dependeDe: [] };
    const r = checkPlanScope([base, outra], { "REQ-009": "algo" });
    expect(r.errors.some((e) => e.includes("[T8b REQ REPETIDO] REQ-009"))).toBe(true);
  });

  it("arquivo citado que nenhuma etapa produz não é erro do plano (fica para a conferência da Spec)", () => {
    const r = checkPlanScope([base], { "REQ-009": "src/lib/validacao.ts e vitest.config.ts" });
    expect(r.valid).toBe(true);
  });

  it("validateFinalPlan soma as regras antigas da T8b (REQ sem etapa)", () => {
    const nodes = [
      {
        id: "n1",
        dependencies: [],
        payload: {
          microbrief: { reqsCobertos: ["REQ-001"], arquivosPermitidos: { criar: ["src/a.ts"], modificar: [], lerContratos: [] } },
        },
      },
    ];
    const r = validateFinalPlan(nodes, ["REQ-001", "REQ-002"], { "REQ-001": "src/a.ts" }, 4);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toContain("REQ-002");
  });
});

describe("A2.1 — plano reprovado bloqueia com aviso", () => {
  it("PLANEJAMENTO + PLANO_REPROVADO → BLOQUEADA com AVISAR_HUMANO; desbloqueio volta à revisão da Spec", () => {
    const ctx = { phase: "PLANEJAMENTO" as const, rodadasSemClareza: 0, voltasConferencia: 0 };
    const res = transition(ctx as any, { type: "PLANO_REPROVADO" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ctx.phase).toBe("BLOQUEADA");
    expect(res.effects.some((e) => e.type === "AVISAR_HUMANO")).toBe(true);
    const back = transition(res.ctx, { type: "DESBLOQUEIO_HUMANO" });
    expect(back.ok && back.ctx.phase).toBe("SPEC_REVISAO");
  });
});

describe("A2.1 — heurística de reserva põe cada REQ em uma etapa só", () => {
  it("REQ que cita lib e rota fica só na etapa da rota (a posterior)", () => {
    const spec = renderCanonicalSpecDocument({
      titulo: "Teste A2.1",
      status: "aprovada",
      data: "2026-10-17",
      stack: ["TypeScript", "Next.js"],
      objetivo: "teste",
      modulos: [{ id: "MOD-01", nome: "links", resumo: "links", arquivos: ["src/lib/validacao.ts", "src/app/api/v1/links/route.ts"] }],
      entidades: [],
      arquivosAfetados: ["src/lib/validacao.ts", "src/app/api/v1/links/route.ts"],
      requisitos: [
        { id: "REQ-001", titulo: "Validação", criterio: "src/lib/validacao.ts valida CPF" },
        { id: "REQ-002", titulo: "Rota links", criterio: "src/app/api/v1/links/route.ts usa src/lib/validacao.ts" },
      ],
    } as any);
    const d = SpecDecomposerSkill.decomposeSpec(spec, "Teste A2.1", ["src/lib/validacao.ts", "src/app/api/v1/links/route.ts"]);
    const owners = (req: string) =>
      d.nodes.filter((n: any) => (n.payload?.microbrief?.reqsCobertos ?? []).includes(req)).map((n: any) => n.filesScope);
    expect(owners("REQ-001")).toHaveLength(1);
    expect(owners("REQ-002")).toEqual([["src/app/api/v1/links/route.ts"]]);
  });
});

describe("A2.3c — heurística acrescenta dependência entre etapas irmãs", () => {
  it("REQ da rota A citando a rota B (irmã) → etapa de A passa a depender da de B; plano válido", () => {
    const files = [
      "src/app/api/a/route.ts",
      "src/app/api/b/route.ts",
      "src/app/api/c/route.ts",
      "src/app/api/d/route.ts",
      "src/app/api/e/route.ts",
    ];
    const reqs = [
      { id: "REQ-001", titulo: "B", criterio: "src/app/api/b/route.ts responde 200" },
      { id: "REQ-002", titulo: "E", criterio: "src/app/api/e/route.ts chama src/app/api/b/route.ts" },
    ];
    const spec = renderCanonicalSpecDocument({
      titulo: "Teste A2.3c",
      status: "aprovada",
      data: "2026-10-17",
      objetivo: "teste",
      stack: ["TypeScript", "Next.js"],
      modulos: [{ id: "MOD-01", nome: "api", resumo: "api", arquivos: files }],
      entidades: [],
      arquivosAfetados: files,
      requisitos: reqs,
    } as any);
    const d = SpecDecomposerSkill.decomposeSpec(spec, "Teste A2.3c", files);
    const stageOf = (f: string) => d.nodes.find((n: any) => n.payload?.microbrief && (n.filesScope ?? []).includes(f))!;
    const e = stageOf("src/app/api/e/route.ts");
    const b = stageOf("src/app/api/b/route.ts");
    expect(e.id).not.toBe(b.id);
    expect(e.dependencies).toContain(b.id);
    expect((e.payload as any).microbrief.arquivosPermitidos.lerContratos).toContain("src/app/api/b/route.ts");
    const v = validateFinalPlan(d.nodes as any, ["REQ-001", "REQ-002"], Object.fromEntries(reqs.map((r) => [r.id, `${r.titulo} ${r.criterio}`])), 4);
    expect(v).toEqual({ valid: true, errors: [] });
  });
});

describe("A2.1c — caminho com colchetes (rota dinâmica) entra na conferência de escopo", () => {
  it("REQ numa etapa citando src/app/api/checkout/[slug]/route.ts de etapa irmã → erro", () => {
    const a: PlanStage = { id: "a", arquivos: ["src/app/api/checkout/[slug]/route.ts"], reqs: [], dependeDe: [] };
    const b: PlanStage = { id: "b", arquivos: ["src/lib/x.ts"], reqs: ["REQ-026"], dependeDe: [] };
    const r = checkPlanScope([a, b], { "REQ-026": "src/app/api/checkout/[slug]/route.ts expõe GET usando src/lib/x.ts" });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('"src/app/api/checkout/[slug]/route.ts"');
  });
});
