import { describe, it, expect } from "vitest";
import { parseSpecDocument, unwrapSpecDocument } from "@/core/intake/spec-format";
import { applyCumulativeSpecGuard } from "@/core/orchestrator/spec-draft";

// Formato real devolvido pelo FreeLLMAPI (GLM/DeepSeek) em 05/10/2026: Spec dentro de ```yaml.
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

// Formato real visto com GLM-5.2 via FreeLLMAPI: só o YAML no bloco, sem os ---, Markdown depois.
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
].join("
");

describe("Spec embrulhada em bloco de código", () => {
  it("bloco só com YAML (sem ---) vira documento com frontmatter e mantém o Markdown", () => {
    const doc = unwrapSpecDocument(fencedNoDelims);
    expect(doc.startsWith("---
titulo:")).toBe(true);
    expect(doc).toContain("# Gateway de Pagamento");
    expect(parseSpecDocument(fencedNoDelims)?.modulos.map((m) => m.id)).toEqual(["auth"]);
  });

  it("unwrap extrai o documento e o parser reconhece", () => {
    expect(unwrapSpecDocument(fenced).startsWith("---")).toBe(true);
    expect(parseSpecDocument(fenced)?.modulos.map((m) => m.id)).toEqual(["checkout"]);
  });

  it("a guarda cumulativa grava o documento puro, sem a cerca, e com status aguardando_aprovacao", () => {
    const res = applyCumulativeSpecGuard(null, fenced, "quero um gateway");
    expect(res.isValidSpec).toBe(true);
    expect(res.finalSpec!.startsWith("---")).toBe(true);
    expect(res.finalSpec).not.toContain("```");
    expect(parseSpecDocument(res.finalSpec!)?.status).toBe("aguardando_aprovacao");
  });
});
