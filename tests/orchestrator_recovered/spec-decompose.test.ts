import { describe, it, expect } from "vitest";
import { SpecDecomposerSkill } from "@/core/skills/spec-decomposer";
import { buildBriefMarkdown } from "@/core/orchestrator/node-executor";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";

const files = [
  "prisma/schema.prisma",
  "src/lib/asaas.ts",
  "src/lib/prisma.ts",
  "src/app/api/charges/route.ts",
  "src/app/api/products/route.ts",
  "src/app/api/webhooks/asaas/route.ts",
  "src/app/checkout/[id]/page.tsx",
  "src/app/dashboard/page.tsx",
  "src/app/dashboard/products/page.tsx",
  "src/app/dashboard/reports/page.tsx",
];
const spec = "---\ntitulo: \"Gateway\"\n---\n\n# Gateway\n\nGateway Asaas.";

describe("DAG a partir da Spec: uma etapa por grupo de arquivos", () => {
  const { nodes: allNodes } = SpecDecomposerSkill.decomposeSpec(spec, "Gateway", files, ["Next.js", "TypeScript"]);
  const scaffold = allNodes[0];
  const nodes = allNodes.slice(1);

  it("M1: primeira etapa é a base do projeto, sem IA, com a stack da Spec; todas dependem dela", () => {
    expect(scaffold.role).toBe("scaffold");
    expect((scaffold.payload as any).step).toBe("scaffold");
    expect((scaffold.payload as any).stack).toEqual(["Next.js", "TypeScript"]);
    expect(scaffold.dependencies).toEqual([]);
    expect(nodes[0].dependencies).toEqual([scaffold.id]);
  });

  it("sem etapa de 'Análise' que gera .md e sem teste de fachada; todo arquivo em exatamente uma etapa", () => {
    const scoped = nodes.flatMap((n) => n.filesScope);
    expect(scoped.sort()).toEqual([...files].sort());
    expect(scoped).not.toContain("docs/spec-architecture.md");
    expect(scoped).not.toContain("tests/verification.spec.ts");
    expect(nodes.every((n) => n.filesScope.length <= 4)).toBe(true);
  });

  it("base (schema, lib) primeiro; as demais etapas dependem da base", () => {
    const base = nodes[0];
    expect(base.filesScope).toEqual(expect.arrayContaining(["prisma/schema.prisma", "src/lib/prisma.ts"]));
    expect(base.dependencies).toEqual([scaffold.id]);
    for (const n of nodes.slice(1)) {
      expect(n.dependencies[0]).toBe(base.id);
      // A tela espera a API (contrato real das rotas); as demais etapas só dependem da base.
      const apiIds = nodes.filter((x) => x.cluster === "backend" || x.cluster === "integration").map((x) => x.id);
      expect(n.dependencies.slice(1)).toEqual(n.cluster === "frontend" ? apiIds : []);
    }
  });

  it("títulos legíveis (sem YAML cru) e Spec inteira no payload de cada etapa", () => {
    for (const n of nodes) {
      expect(n.title).toMatch(/^Etapa \d+\/\d+: /);
      expect(n.title).not.toContain("---");
      expect((n.payload as any).goal).toBe(spec);
    }
  });

  it("o Brief do Auditor Cego restringe a avaliação aos arquivos da etapa", () => {
    const n = nodes[1];
    const brief = buildBriefMarkdown({
      title: n.title,
      role: n.role,
      filesScope: JSON.stringify(n.filesScope),
      payload: JSON.stringify(n.payload),
    });
    // Microbrief (YAML + Markdown): só os arquivos e REQ da etapa, sem a Spec inteira.
    expect(brief.startsWith("---\ndocumento: microbrief")).toBe(true);
    expect(brief).toContain(`Somente ${n.filesScope.join(", ")} pertencem a esta etapa`);
    expect(brief).toContain("NÃO são pendência aqui");
    expect(brief).not.toContain("arquivos_afetados");
  });
});

describe("Validador Tipo 1 em texto", () => {
  it("Markdown com parênteses de prosa não é erro de sintaxe", () => {
    const res = DualLensAuditor.validateType1({ "docs/notas.md": "Passos: 1) criar conta; 2) gerar link." }, [], process.cwd(), ["docs/notas.md"], []);
    expect(res.compilationErrors.join("\n")).not.toContain("parênteses");
  });
});
