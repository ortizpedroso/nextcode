import { describe, expect, it } from "vitest";
import { renderCanonicalSpecDocument, parseSpecDocument } from "@/core/intake/spec-format";
import {
  classificarTextoDeMacrobrief,
  errosDePlanoContraMacrobrief,
  macrobriefFixoDaSpec,
  parseElicitadorMacrobrief,
  renderElicitadorMacrobrief,
  textoParaOConferente,
  validarElicitadorMacrobrief,
} from "@/core/intake/macrobrief-elicitador";
import { parseAnalystPlan } from "@/core/skills/spec-decomposer";

const spec = parseSpecDocument(
  renderCanonicalSpecDocument({
    titulo: "Tarefas",
    status: "aprovada",
    data: "2026-10-25",
    objetivo: "Lista de tarefas.",
    stack: ["TypeScript"],
    modulos: [{ id: "mod", nome: "Tarefas", resumo: "CRUD", arquivos: ["src/lib/tarefas.ts", "src/app/api/tarefas/route.ts"] }],
    entidades: [{ nome: "Tarefa", campos: [{ nome: "id", tipo: "string" }] }],
    arquivosAfetados: ["src/lib/tarefas.ts", "src/app/api/tarefas/route.ts"],
    requisitosIds: ["REQ-001", "REQ-002"],
    requisitos: [
      { id: "REQ-001", titulo: "Store", criterio: "src/lib/tarefas.ts exporta listar." },
      { id: "REQ-002", titulo: "Rota", criterio: "src/app/api/tarefas/route.ts devolve 200." },
    ],
  })
)!;

describe("Macrobrief do elicitador", () => {
  it("o documento fixo da Spec cobre cada arquivo e cada REQ, e o texto é Markdown com YAML", () => {
    const { doc, texto } = macrobriefFixoDaSpec(spec);
    expect(texto.startsWith("---\n")).toBe(true);
    expect(texto).toContain("documento: macrobrief");
    expect(texto).not.toContain("Contratos TypeScript serão gerados");
    expect(validarElicitadorMacrobrief(doc, spec.arquivosAfetados, ["REQ-001", "REQ-002"])).toEqual([]);
    const deNovo = parseElicitadorMacrobrief(texto);
    expect(deNovo?.clusters.map((c) => c.id)).toEqual(doc.clusters.map((c) => c.id));
    expect(deNovo?.requisitos.sort()).toEqual(["REQ-001", "REQ-002"]);
  });

  it("arquivo fora da Spec reprova; texto vazio pausa sem virar falha de conferência", () => {
    const { doc } = macrobriefFixoDaSpec(spec);
    doc.clusters[0].arquivos.push("src/inventado.ts");
    const erros = validarElicitadorMacrobrief(doc, spec.arquivosAfetados, ["REQ-001", "REQ-002"]);
    expect(erros.some((e) => e.includes("src/inventado.ts"))).toBe(true);

    expect(classificarTextoDeMacrobrief("", spec.arquivosAfetados, ["REQ-001"]).tipo).toBe("pausa");
    expect(classificarTextoDeMacrobrief("sem frontmatter", spec.arquivosAfetados, ["REQ-001"]).tipo).toBe("pausa");
  });

  it("o conferente recebe o Markdown do Macrobrief", () => {
    const { texto } = macrobriefFixoDaSpec(spec);
    const mensagem = textoParaOConferente(spec.raw, texto);
    expect(mensagem).toContain("SPEC APROVADA");
    expect(mensagem).toContain("documento: macrobrief");
    expect(mensagem).toContain("REQ-002");
  });

  it("plano YAML do analista preserva o cluster do Macrobrief", () => {
    const { doc } = macrobriefFixoDaSpec(spec);
    const yaml = `---
documento: plano
microbriefs:
  - id: mb-1
    cluster: core
    arquivos:
      - src/lib/tarefas.ts
    reqs:
      - REQ-001
    depende_de: []
  - id: mb-2
    cluster: backend
    arquivos:
      - src/app/api/tarefas/route.ts
    reqs:
      - REQ-002
    depende_de:
      - mb-1
entidades:
  - nome: Tarefa
    campos:
      - nome: id
        tipo: string
    dono: mb-1
enums: []
funcoes: []
rotas:
  - metodo: GET
    caminho: /api/tarefas
    arquivo: src/app/api/tarefas/route.ts
    entrada: void
    saida: Tarefa[]
    erros:
      - status: 400
        corpo: "{ erro: string }"
    dono: mb-2
    usado_por: []
---
# Plano
`;
    const parsed = parseAnalystPlan(yaml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.stages.map((s) => s.id)).toEqual(["mb-1", "mb-2"]);
    expect(parsed.contrato?.entidades[0]?.nome).toBe("Tarefa");
    expect(parsed.contrato?.rotas[0]?.erros[0]?.status).toBe(400);
    expect(errosDePlanoContraMacrobrief(parsed.stages, parsed.clusters, doc)).toEqual([]);

    const trocado = parsed.stages.map((s) =>
      s.id === "mb-2" ? { ...s, arquivos: ["src/lib/tarefas.ts"], reqs: ["REQ-001"] } : { ...s, arquivos: [], reqs: [] }
    );
    const erros = errosDePlanoContraMacrobrief(trocado, { "mb-1": "core", "mb-2": "backend" }, doc);
    expect(erros.some((e) => e.includes("src/lib/tarefas.ts") && e.includes("core"))).toBe(true);
  });

  it("render e parse devolvem o mesmo texto de clusters", () => {
    const doc = parseElicitadorMacrobrief(renderElicitadorMacrobrief(macrobriefFixoDaSpec(spec).doc));
    expect(doc?.clustersAtivos).toContain("core");
    expect(doc?.clustersAtivos).toContain("backend");
  });
});
