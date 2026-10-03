import { describe, it, expect } from "vitest";
import { renderCanonicalSpecDocument, parseSpecDocument } from "@/core/intake/spec-format";

describe("spec-format — YAML Frontmatter + Markdown enxuto", () => {
  it("renderiza e re-interpreta todos os campos (stack, modulos, entidades com campos, rotas, arquivos, notas)", () => {
    const doc = renderCanonicalSpecDocument({
      titulo: "NoCode Folio",
      status: "aguardando_aprovacao",
      data: "2026-10-03",
      objetivo: "Link-in-bio com grid modular e blocos polimórficos via JSONB.",
      stack: ["React", "Vite", "Supabase"],
      modulos: [{ id: "m1", nome: "Perfil público", resumo: "Renderiza a grid de blocos" }],
      entidades: [
        {
          nome: "perfis",
          campos: [
            { nome: "id", tipo: "int8" },
            { nome: "slug", tipo: "text" },
          ],
        },
        { nome: "blocos", campos: [{ nome: "tipo", tipo: "text" }] },
      ],
      arquivosAfetados: ["src/app/[slug]/page.tsx"],
      rotas: [{ caminho: "/:slug", descricao: "Perfil público do usuário" }],
      notasImplementacao: ["Verificar chaves do JSONB antes de renderizar para evitar undefined"],
    });

    expect(doc.startsWith("---\n")).toBe(true);
    expect(doc).toContain("# NoCode Folio");

    const parsed = parseSpecDocument(doc);
    expect(parsed).not.toBeNull();
    expect(parsed!.titulo).toBe("NoCode Folio");
    expect(parsed!.status).toBe("aguardando_aprovacao");
    expect(parsed!.data).toBe("2026-10-03");
    expect(parsed!.objetivo).toBe("Link-in-bio com grid modular e blocos polimórficos via JSONB.");
    expect(parsed!.stack).toEqual(["React", "Vite", "Supabase"]);
    expect(parsed!.modulos).toEqual([
      { id: "m1", nome: "Perfil público", resumo: "Renderiza a grid de blocos" },
    ]);
    expect(parsed!.entidades).toEqual([
      {
        nome: "perfis",
        campos: [
          { nome: "id", tipo: "int8" },
          { nome: "slug", tipo: "text" },
        ],
      },
      { nome: "blocos", campos: [{ nome: "tipo", tipo: "text" }] },
    ]);
    expect(parsed!.rotas).toEqual([{ caminho: "/:slug", descricao: "Perfil público do usuário" }]);
    expect(parsed!.arquivosAfetados).toEqual(["src/app/[slug]/page.tsx"]);
    expect(parsed!.notasImplementacao).toEqual([
      "Verificar chaves do JSONB antes de renderizar para evitar undefined",
    ]);
  });

  it("omite seções vazias no documento renderizado (sem 'modulos:'/'rotas:' quando listas vazias)", () => {
    const doc = renderCanonicalSpecDocument({
      titulo: "Spec mínima",
      status: "aguardando_aprovacao",
      data: "2026-10-03",
      objetivo: "Objetivo curto.",
      stack: [],
      modulos: [],
      entidades: [],
      arquivosAfetados: [],
    });

    expect(doc).not.toContain("stack:");
    expect(doc).not.toContain("modulos:");
    expect(doc).not.toContain("entidades:");
    expect(doc).not.toContain("rotas:");
    expect(doc).not.toContain("arquivos_afetados:");
    expect(doc).not.toContain("notas_implementacao:");

    const parsed = parseSpecDocument(doc);
    expect(parsed!.stack).toEqual([]);
    expect(parsed!.modulos).toEqual([]);
    expect(parsed!.entidades).toEqual([]);
    expect(parsed!.rotas).toEqual([]);
    expect(parsed!.arquivosAfetados).toEqual([]);
    expect(parsed!.notasImplementacao).toEqual([]);
  });

  it("escapa aspas e barras invertidas nos valores YAML sem corromper o parse", () => {
    const doc = renderCanonicalSpecDocument({
      titulo: 'Título com "aspas" e \\barra',
      status: "aguardando_aprovacao",
      data: "2026-10-03",
      objetivo: "Objetivo.",
      stack: [],
      modulos: [],
      entidades: [],
      arquivosAfetados: [],
    });

    const parsed = parseSpecDocument(doc);
    expect(parsed!.titulo).toBe('Título com "aspas" e \\barra');
  });

  it("interpreta especificação legada com 'entidades' como lista de strings (formato antigo)", () => {
    const legacy = `---
titulo: "Spec legada"
status: aprovada
data: "2026-01-01"
entidades:
  - "User"
  - "Payment"
---

# Spec legada

Texto do objetivo.`;

    const parsed = parseSpecDocument(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed!.entidades).toEqual([
      { nome: "User", campos: [] },
      { nome: "Payment", campos: [] },
    ]);
    expect(parsed!.rotas).toEqual([]);
    expect(parsed!.notasImplementacao).toEqual([]);
  });

  it("retorna null para conteúdo em prosa livre (sem YAML frontmatter)", () => {
    expect(parseSpecDocument("# Apenas um título\n\nSem frontmatter nenhum.")).toBeNull();
    expect(parseSpecDocument("")).toBeNull();
  });

  it("interpreta 'stack' emitido como escalar único separado por vírgulas (desvio comum do LLM)", () => {
    const doc = `---
titulo: "Gateway de Pagamento"
status: "aguardando_aprovacao"
data: "2026-10-03"
stack: "Next.js App Router, TypeScript, Tailwind CSS, Prisma ORM, SQLite"
---

# Gateway de Pagamento

Objetivo.`;

    const parsed = parseSpecDocument(doc);
    expect(parsed).not.toBeNull();
    expect(parsed!.stack).toEqual([
      "Next.js App Router",
      "TypeScript",
      "Tailwind CSS",
      "Prisma ORM",
      "SQLite",
    ]);
  });
});
