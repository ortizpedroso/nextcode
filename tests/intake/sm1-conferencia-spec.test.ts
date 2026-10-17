import { describe, it, expect } from "vitest";
import { isConcreteFilePath, autoHealSpecDocument, specDateToday } from "@/core/intake/spec-auto-heal";
import { checkSpecStructure, citedFilePaths } from "@/core/intake/spec-check";
import { REMOVAL_INTENT_REGEX } from "@/core/orchestrator/spec-draft";
import { renderCanonicalSpecDocument, parseSpecDocument } from "@/core/intake/spec-format";

const FILES = ["src/lib/a.ts", ".env.example"];
const spec = (extra: Partial<Record<string, unknown>> = {}) =>
  renderCanonicalSpecDocument({
    titulo: "SM1",
    status: "aguardando_aprovacao",
    data: "2025-10-16",
    objetivo: "Testar a conferência mecânica da Spec.",
    stack: ["TypeScript"],
    modulos: [{ id: "MOD-01", nome: "base", resumo: "base", arquivos: FILES }],
    entidades: [],
    rotas: [],
    arquivosAfetados: FILES,
    requisitos: [
      { id: "REQ-001", titulo: "A", criterio: "src/lib/a.ts exporta a()" },
      { id: "REQ-002", titulo: "Env", criterio: ".env.example lista as variáveis" },
    ],
    ...extra,
  } as any);

describe("SM1 — conferência mecânica da Spec", () => {
  it("(a) arquivo com ponto no início e extensão é arquivo de verdade; pasta e '.env' sozinho não", () => {
    expect(isConcreteFilePath(".env.example")).toBe(true);
    expect(isConcreteFilePath("config/.eslintrc.json")).toBe(true);
    expect(isConcreteFilePath(".env")).toBe(false);
    expect(isConcreteFilePath("src/app/api")).toBe(false);
    expect(isConcreteFilePath("src/lib/a.ts")).toBe(true);
  });

  it("(a) auto-cura mantém .env.example em arquivos_afetados (antes sumia calado)", () => {
    const healed = autoHealSpecDocument(spec());
    expect(healed.parsed.arquivosAfetados).toContain(".env.example");
    expect(healed.fixesApplied.some((f) => f.includes(".env.example") && f.startsWith("Removido"))).toBe(false);
  });

  it("(b) REQ que cita arquivo fora de arquivos_afetados vira problema da conferência", () => {
    const parsed = parseSpecDocument(
      spec({
        requisitos: [
          { id: "REQ-001", titulo: "A", criterio: "src/lib/a.ts exporta a() e vitest.config.ts roda os testes" },
          { id: "REQ-002", titulo: "Env", criterio: ".env.example lista as variáveis" },
        ],
      })
    )!;
    const problems = checkSpecStructure(parsed);
    expect(problems.some((p) => p.includes('"REQ-001" cita o arquivo "vitest.config.ts"'))).toBe(true);
    expect(problems.some((p) => p.includes('cita o arquivo "src/lib/a.ts"'))).toBe(false);
    expect(citedFilePaths("usa src/lib/a.ts e vitest.config.ts")).toEqual(["src/lib/a.ts", "vitest.config.ts"]);
  });

  it("(c) data da Spec é carimbada pelo NextCode, e a troca é registrada", () => {
    const healed = autoHealSpecDocument(spec());
    expect(healed.parsed.data).toBe(specDateToday());
    expect(healed.fixesApplied.some((f) => f.includes("Data da Spec corrigida") && f.includes("2025-10-16"))).toBe(true);
    expect(specDateToday(new Date(2026, 9, 5))).toBe("2026-10-05");
  });

  it("(d) pedido de troca/substituição/remoção conta como intenção de tirar o item antigo", () => {
    for (const msg of [
      "Remova o REQ-001",
      "troque o .env.example por config.example",
      "substitua o módulo X",
      "use Y em vez de X",
      "coloque Z no lugar do W",
      "não quero o relatório",
      "pode tirar a tela",
    ]) {
      expect(REMOVAL_INTENT_REGEX.test(msg), msg).toBe(true);
    }
    expect(REMOVAL_INTENT_REGEX.test("acrescente a tela de login")).toBe(false);
  });
});
