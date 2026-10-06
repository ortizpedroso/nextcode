import { describe, it, expect } from "vitest";
import { parseSpecDocument, unwrapSpecDocument } from "@/core/intake/spec-format";
import { applyCumulativeSpecGuard } from "@/core/orchestrator/spec-draft";

// Formatos reais devolvidos pelo FreeLLMAPI (GLM-5.2 / DeepSeek-V4) em 05/10/2026.
const fenced = [
  "Segue a Spec:",
  "```yaml",
  "---",
  'titulo: "Gateway"',
  'status: "aprovada"',
  "modulos:",
  "  - id: checkout",
  '    nome: "Checkout"',
  '    resumo: "Pagamento"',
  "---",
  "",
  "# Gateway",
  "```",
].join("\n");

// Só o YAML no bloco, sem os ---, e o Markdown depois do bloco.
const fencedNoDelims = [
  "```yaml",
  "titulo: Gateway de Pagamento",
  "status: aprovada",
  "modulos:",
  "  - id: auth",
  "    nome: Autenticação",
  "    resumo: Login",
  "```",
  "",
  "# Gateway de Pagamento",
  "Detalhes.",
].join("\n");

describe("Spec embrulhada em bloco de código", () => {
  it("bloco com o documento completo: extrai e o parser reconhece", () => {
    expect(unwrapSpecDocument(fenced).startsWith("---")).toBe(true);
    expect(parseSpecDocument(fenced)?.modulos.map((m) => m.id)).toEqual(["checkout"]);
  });

  it("bloco só com YAML (sem ---): vira documento com frontmatter e mantém o Markdown", () => {
    const doc = unwrapSpecDocument(fencedNoDelims);
    expect(doc.startsWith("---\ntitulo:")).toBe(true);
    expect(doc).toContain("# Gateway de Pagamento");
    expect(parseSpecDocument(fencedNoDelims)?.modulos.map((m) => m.id)).toEqual(["auth"]);
  });

  it("a guarda cumulativa grava o documento puro, sem a cerca, e com status aguardando_aprovacao", () => {
    for (const raw of [fenced, fencedNoDelims]) {
      const res = applyCumulativeSpecGuard(null, raw, "quero um gateway");
      expect(res.isValidSpec).toBe(true);
      expect(res.finalSpec!.startsWith("---")).toBe(true);
      expect(res.finalSpec).not.toContain("```");
      expect(parseSpecDocument(res.finalSpec!)?.status).toBe("aguardando_aprovacao");
    }
  });
});
