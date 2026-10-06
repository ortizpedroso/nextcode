import { describe, it, expect } from "vitest";
import { parseSpecDocument } from "@/core/intake/spec-format";
import { applyCumulativeSpecGuard } from "@/core/orchestrator/spec-draft";

// Reproduz a resposta real de 06/10 (mistral-code via FreeLLMAPI) na sessão gateway:
// stack em lista JSON numa linha e o corpo com a implementação inteira em blocos de código.
const real = [
  "---",
  'titulo: "Gateway de Pagamento Transparente e Whitelabel"',
  "status: aguardando_aprovacao",
  'stack: ["Next.js", "TypeScript", "Prisma", "Tailwind CSS"]',
  "modulos:",
  "  - id: checkout",
  '    nome: "Checkout Transparente"',
  '    resumo: "Integração com o Asaas"',
  "---",
  "",
  "# Gateway de Pagamento Transparente e Whitelabel",
  "",
  "Implementação de um gateway transparente.",
  "",
  "```typescript",
  "// src/lib/prisma.ts",
  "export const prisma = 1;",
  "```",
].join("\n");

describe("Spec real com lista JSON e código no corpo", () => {
  it("stack em lista JSON vira itens limpos", () => {
    expect(parseSpecDocument(real)?.stack).toEqual(["Next.js", "TypeScript", "Prisma", "Tailwind CSS"]);
  });

  it("código no corpo é descartado do objetivo e da Spec gravada", () => {
    expect(parseSpecDocument(real)?.objetivo).toBe("Implementação de um gateway transparente.");
    const res = applyCumulativeSpecGuard(null, real, "quero um gateway");
    expect(res.finalSpec).not.toContain("```");
    expect(res.finalSpec).not.toContain("src/lib/prisma.ts");
  });

  it("itens já gravados quebrados ('[\"Next.js\"') são limpos na leitura", () => {
    const broken = ["---", 'titulo: "X"', "stack:", '  - "[\\"Next.js\\""', '  - "\\"Prisma\\"]"', "---", "", "# X"].join("\n");
    expect(parseSpecDocument(broken)?.stack).toEqual(["Next.js", "Prisma"]);
  });
});

describe("Modelo com raciocínio antes da Spec (nemotron via FreeLLMAPI, 06/10)", () => {
  const withReasoning = [
    "We need to produce a Spec in NextCode format. Must follow exact format:",
    "",
    "---",
    'titulo: "<título>"',
    "status: aguardando_aprovacao",
    "---",
    "",
    "# <título>",
    "",
    "Now the real document:",
    "",
    "---",
    'titulo: "Gateway de Pagamento Asaas"',
    "status: aguardando_aprovacao",
    "modulos:",
    "  - id: checkout",
    '    nome: "Checkout"',
    '    resumo: "Pagamento"',
    "---",
    "",
    "# Gateway de Pagamento Asaas",
    "",
    "Gateway whitelabel.",
  ].join("\n");

  it("usa o último documento com título real, ignorando o raciocínio e o modelo com <placeholders>", () => {
    const parsed = parseSpecDocument(withReasoning);
    expect(parsed?.titulo).toBe("Gateway de Pagamento Asaas");
    expect(parsed?.modulos.map((m) => m.id)).toEqual(["checkout"]);
  });

  it("só raciocínio + modelo com placeholders → não é Spec", () => {
    const onlyTemplate = withReasoning.split("Now the real document:")[0];
    expect(parseSpecDocument(onlyTemplate)).toBeNull();
  });
});

describe("Frontmatter aberto e nunca fechado (gpt-oss-20b via FreeLLMAPI, 06/10)", () => {
  const unclosed = [
    "---",
    'titulo: "Gateway"',
    "status: aguardando_aprovacao",
    "modulos:",
    "  - id: auth",
    '    nome: "Auth"',
    '    resumo: "Login"',
    "arquivos_afetados:",
    '  - "lib/db.ts"',
    "",
    "# Gateway",
    "",
    "Objetivo do gateway.",
  ].join("\n");

  it("fecha o bloco antes do primeiro título e reconhece a Spec", () => {
    const p = parseSpecDocument(unclosed);
    expect(p?.modulos.map((m) => m.id)).toEqual(["auth"]);
    expect(p?.arquivosAfetados).toEqual(["lib/db.ts"]);
    expect(p?.objetivo).toBe("Objetivo do gateway.");
  });
});
