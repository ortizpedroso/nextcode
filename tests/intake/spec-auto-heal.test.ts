import { describe, it, expect } from "vitest";
import { autoHealSpecDocument, isConcreteFilePath } from "@/core/intake/spec-auto-heal";
import { parseSpecDocument } from "@/core/intake/spec-format";
import { checkSpecStructure } from "@/core/intake/spec-check";

describe("spec-auto-heal — Auto-Cura Mecânica da Spec", () => {
  it("valida caminhos concretos e rejeita diretórios", () => {
    expect(isConcreteFilePath("src/app/api/cobrancas/route.ts")).toBe(true);
    expect(isConcreteFilePath("prisma/schema.prisma")).toBe(true);
    expect(isConcreteFilePath("Dockerfile")).toBe(true);
    expect(isConcreteFilePath("deploy/Caddyfile")).toBe(true);
    expect(isConcreteFilePath("Dockerfile.prod")).toBe(true);
    expect(isConcreteFilePath("src/app/api")).toBe(false);
    expect(isConcreteFilePath("src/app/")).toBe(false);
    expect(isConcreteFilePath("")).toBe(false);
  });

  it("cura automaticamente spec com diretório solto, requisitos vazios e objetivo vazio", () => {
    const rawDefective = `---
titulo: "Gateway Asaas Defeituoso"
status: aguardando_aprovacao
data: "2026-10-11"
stack:
  - "Next.js"
modulos:
  - id: cobrancas
    nome: "Cobranças"
    resumo: "Módulo de cobranças"
    arquivos:
      - "src/app/api/cobrancas/route.ts"
arquivos_afetados:
  - "src/app/api"
  - "src/app/api/cobrancas/route.ts"
---

# Gateway Asaas Defeituoso

Especificação atualizada.`;

    const parsedBefore = parseSpecDocument(rawDefective)!;
    const problemsBefore = checkSpecStructure(parsedBefore);
    expect(problemsBefore.length).toBeGreaterThan(0);
    expect(problemsBefore.some((p) => p.includes("src/app/api"))).toBe(true);

    const { healedSpec, parsed: healedParsed, fixesApplied } = autoHealSpecDocument(rawDefective);

    expect(fixesApplied.length).toBeGreaterThan(0);
    // Diretório src/app/api foi purgado
    expect(healedParsed.arquivosAfetados).not.toContain("src/app/api");
    expect(healedParsed.arquivosAfetados).toContain("src/app/api/cobrancas/route.ts");

    // Requisitos foram auto-gerados
    expect(healedParsed.requisitos).toBeDefined();
    expect(healedParsed.requisitos!.length).toBeGreaterThan(0);
    expect(healedParsed.requisitos![0].id).toBe("REQ-001");

    // Objetivo foi preenchido
    expect(healedParsed.objetivo).not.toBe("Especificação atualizada.");
    expect(healedParsed.objetivo.length).toBeGreaterThan(20);

    // checkSpecStructure não encontra mais NENHUM problema!
    const problemsAfter = checkSpecStructure(healedParsed);
    expect(problemsAfter).toEqual([]);
  });

  it("associa arquivo solto ao módulo correspondente", () => {
    const rawUnassigned = `---
titulo: "Sistema com Arquivo Solto"
status: aguardando_aprovacao
data: "2026-10-11"
stack:
  - "Next.js"
modulos:
  - id: auth
    nome: "Autenticação"
    resumo: "Login e sessões"
    arquivos:
      - "src/lib/auth.ts"
arquivos_afetados:
  - "src/lib/auth.ts"
  - "src/app/login/page.tsx"
requisitos:
  - id: REQ-001
    titulo: "Auth"
    criterio: "src/lib/auth.ts e src/app/login/page.tsx implementam login."
---

# Sistema com Arquivo Solto

Objetivo completo e claro para o sistema.`;

    const { parsed, fixesApplied } = autoHealSpecDocument(rawUnassigned);
    const problems = checkSpecStructure(parsed);
    expect(problems).toEqual([]);
    expect(parsed.modulos[0].arquivos).toContain("src/app/login/page.tsx");
  });
});
