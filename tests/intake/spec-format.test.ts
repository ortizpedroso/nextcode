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

  it("recupera e interpreta Bare YAML sem '---' e com quebras de linha duplas (caso real DeepSeek)", () => {
    const raw = `
titulo: "Gateway de Pagamento Whitelabel"

status: aguardando_aprovacao

data: "2025-04-04"

stack:

- "Next.js (App Router)"

- "TypeScript"

- "Asaas API"

modulos:

- id: dashboard

nome: "Dashboard do Prestador"

resumo: "Painel administrativo para gerenciar produtos, cobranças e visualizar status de pagamentos."

arquivos:

- "src/app/dashboard/page.tsx"

- "src/lib/dashboard-store.ts"
`;

    const parsed = parseSpecDocument(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.titulo).toBe("Gateway de Pagamento Whitelabel");
    expect(parsed!.status).toBe("aguardando_aprovacao");
    expect(parsed!.stack).toEqual(["Next.js (App Router)", "TypeScript", "Asaas API"]);
    expect(parsed!.modulos.length).toBe(1);
    expect(parsed!.modulos[0].id).toBe("dashboard");
    expect(parsed!.modulos[0].nome).toBe("Dashboard do Prestador");
    expect(parsed!.modulos[0].arquivos).toEqual([
      "src/app/dashboard/page.tsx",
      "src/lib/dashboard-store.ts",
    ]);
  });

  it("repara frontmatter truncado no meio de aspas por limite de tokens", () => {
    const truncated = `---
titulo: "Gateway Resiliente"
status: aguardando_aprovacao
data: "2026-10-05"
notas_implementacao:
  - "As credenciais do Asaas devem ser armazenadas em variáveis de ambiente (ex.: ASAAS_API_KEY) e nunca no códig`;

    const parsed = parseSpecDocument(truncated);
    expect(parsed).not.toBeNull();
    expect(parsed!.titulo).toBe("Gateway Resiliente");
    expect(parsed!.notasImplementacao.length).toBe(1);
    expect(parsed!.notasImplementacao[0]).toContain("As credenciais do Asaas");
  });
});
