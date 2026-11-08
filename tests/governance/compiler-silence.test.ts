import { describe, expect, it } from "vitest";
import { compilerSilenceErrors, DualLensAuditor, stripCompilerSilence } from "@/core/governance/dual-lens-auditor";

describe("SILENCIO — código novo não esconde o compilador", () => {
  it("aponta diretiva, cast e import variável com arquivo e linha", () => {
    const src = [
      "import { x } from '@/lib/asaas'; // @ts-expect-error módulo ausente",
      "const caminho = '@/lib/asaas/subcontas';",
      "const mod = await import(caminho);",
      "const row = await prisma.lojista.update({ data: { asaasSubcontaId: '1' } as any });",
      "const outro = valor as unknown as { id: string };",
    ].join("\n");
    const errors = compilerSilenceErrors("src/app/api/lojista/onboarding/route.ts", src);
    expect(errors.some((e) => e.includes(":1") && e.includes("@ts-expect-error"))).toBe(true);
    expect(errors.some((e) => e.includes(":3") && e.includes("import dinâmico"))).toBe(true);
    expect(errors.some((e) => e.includes(":4") && e.includes("as any"))).toBe(true);
    expect(errors.some((e) => e.includes(":5") && e.includes("as unknown as"))).toBe(true);
    const type1 = DualLensAuditor.validateType1(
      { "src/app/api/lojista/onboarding/route.ts": src },
      [],
      process.cwd(),
      ["src/app/api/lojista/onboarding/route.ts"],
      []
    );
    expect(type1.passed).toBe(false);
    expect(type1.compilationErrors.some((e) => e.startsWith("[SILENCIO]"))).toBe(true);
  });

  it("a cópia sem silêncio usa o caminho fixo e tira o cast, sem alterar o comentário", () => {
    const src = [
      "import { x } from '@/lib/asaas'; // @ts-expect-error módulo ausente",
      "const caminho = '@/lib/asaas/subcontas';",
      "const mod = await import(caminho);",
      "const row = await prisma.lojista.update({ data: { asaasSubcontaId: '1' } as any });",
      "// não usar as any aqui",
    ].join("\n");
    const stripped = stripCompilerSilence(src);
    expect(stripped).not.toContain("@ts-expect-error");
    expect(stripped).toContain("import('@/lib/asaas/subcontas')");
    expect(stripped.split("\n")[3]).not.toContain("as any");
    expect(stripped).toContain("// não usar as any aqui");
  });

  it("pega cast duplo com parêntese e <any> fora de JSX", () => {
    const src = [
      "const x = (valor as unknown) as Destino;",
      "const y = <any>valor;",
    ].join("\n");
    const errors = compilerSilenceErrors("src/lib/x.ts", src);
    expect(errors.some((e) => e.includes("cast duplo"))).toBe(true);
    expect(errors.some((e) => e.includes("<any>"))).toBe(true);
    expect(compilerSilenceErrors("src/lib/x.tsx", src).some((e) => e.includes("<any>"))).toBe(false);
  });

  it("aceita import estático e não lê menção dentro de comentário de linha", () => {
    const src = [
      "import { criarSubconta } from '@/lib/asaas/subcontas';",
      "// não usar as any aqui",
      "export async function POST() { return criarSubconta(); }",
    ].join("\n");
    expect(compilerSilenceErrors("src/app/api/lojista/onboarding/route.ts", src)).toEqual([]);
  });
});
