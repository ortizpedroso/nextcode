import { describe, it, expect } from "vitest";
import {
  renderMacrobriefMarkdown,
  type MacrobriefDocument,
} from "@/core/templates/artifact-templates";

describe("Renderizador de Macrobrief em Markdown + YAML", () => {
  it("renderiza o frontmatter YAML e o corpo Markdown conforme o template canônico", () => {
    const macro: MacrobriefDocument = {
      documento: "macrobrief",
      idMacrobrief: "macro-123456",
      idProjeto: "api-tarefas",
      specVersao: 1,
      requisitosTotais: ["REQ-001", "REQ-002"],
      clustersAtivos: ["core", "backend"],
      microbriefs: [
        {
          id: "task-core-1",
          cluster: "core",
          dependeDe: [],
          arquivos: ["src/lib/types.ts"],
          reqs: ["REQ-001"],
        },
        {
          id: "task-backend-2",
          cluster: "backend",
          dependeDe: ["task-core-1"],
          arquivos: ["src/app/api/tasks/route.ts"],
          reqs: ["REQ-002"],
        },
      ],
      contratosTypescript: "export interface Task { id: string; title: string; }",
    };

    const rendered = renderMacrobriefMarkdown(macro);

    expect(rendered).toContain("documento: macrobrief");
    expect(rendered).toContain("id: \"macro-123456\"");
    expect(rendered).toContain("projeto: \"api-tarefas\"");
    expect(rendered).toContain("spec_versao: 1");
    expect(rendered).toContain("  - REQ-001");
    expect(rendered).toContain("  - REQ-002");
    expect(rendered).toContain("  - core");
    expect(rendered).toContain("  - backend");
    expect(rendered).toContain("# Macrobrief: api-tarefas (macro-123456)");
    expect(rendered).toContain("### Etapa `task-core-1` [core]");
    expect(rendered).toContain("### Etapa `task-backend-2` [backend] (depende de: task-core-1)");
    expect(rendered).toContain("export interface Task { id: string; title: string; }");
  });
});
