import { describe, it, expect } from "vitest";
import { parseSpecDocument } from "@/core/intake/spec-format";
import { checkSpecStructure, routeFileCandidates } from "@/core/intake/spec-check";
import { applyCumulativeSpecGuard } from "@/core/orchestrator/spec-draft";

// A Spec real do teste de 06/10 (API de tarefas), resumida: módulo sem arquivo e corpo vazio.
const realSpec = `---
titulo: "API de Lista de Tarefas em Next.js"
status: aguardando_aprovacao
stack:
  - "Next.js"
  - "TypeScript"
modulos:
  - id: 1
    nome: "TaskRepository"
    resumo: "Gerencia a lista de tarefas em memória."
  - id: 2
    nome: "TaskAPI"
    resumo: "Rotas HTTP."
rotas:
  - caminho: "/api/tasks"
    descricao: "POST cria, GET lista."
  - caminho: "/api/tasks/:id"
    descricao: "PATCH conclui."
arquivos_afetados:
  - "pages/api/tasks/index.ts"
  - "pages/api/tasks/[id].ts"
---

# API de Lista de Tarefas em Next.js

Especificação atualizada.`;

const goodSpec = `---
titulo: "API de Tarefas"
status: aguardando_aprovacao
stack:
  - "Next.js"
modulos:
  - id: store
    nome: "Armazenamento"
    resumo: "Lista em memória compartilhada."
    arquivos:
      - "src/lib/task-store.ts"
  - id: api
    nome: "Rotas"
    resumo: "Criar, listar e concluir."
    arquivos:
      - "src/app/api/tasks/route.ts"
      - "src/app/api/tasks/[id]/route.ts"
rotas:
  - caminho: "/api/tasks"
    descricao: "POST cria, GET lista."
  - caminho: "/api/tasks/:id"
    descricao: "PATCH conclui."
arquivos_afetados:
  - "src/lib/task-store.ts"
  - "src/app/api/tasks/route.ts"
  - "src/app/api/tasks/[id]/route.ts"
---

# API de Tarefas

API em memória para criar, listar e concluir tarefas.`;

describe("Conferência mecânica da Spec (P12)", () => {
  it("pega os furos da Spec real do teste: módulos sem arquivo e objetivo vazio", () => {
    const problems = checkSpecStructure(parseSpecDocument(realSpec)!);
    expect(problems.some((p) => p.includes('"TaskRepository" não tem arquivos'))).toBe(true);
    expect(problems.some((p) => p.includes("objetivo"))).toBe(true);
    // As rotas existem no Pages Router: não é problema.
    expect(problems.some((p) => p.includes("/api/tasks"))).toBe(false);
  });

  it("Spec consistente (módulo → arquivos, rotas com arquivo, objetivo) não tem problemas", () => {
    expect(checkSpecStructure(parseSpecDocument(goodSpec)!)).toEqual([]);
  });

  it("rota sem arquivo é apontada com o caminho esperado no App Router", () => {
    const noRoute = goodSpec.replace('  - "src/app/api/tasks/[id]/route.ts"\n---', "---");
    const problems = checkSpecStructure(parseSpecDocument(noRoute)!);
    expect(problems.some((p) => p.includes('"/api/tasks/:id"') && p.includes("src/app/api/tasks/[id]/route.ts"))).toBe(true);
  });

  it("caminhos de rota: :param e {param} viram [param]", () => {
    expect(routeFileCandidates("/api/tasks/:id")).toContain("src/app/api/tasks/[id]/route.ts");
    expect(routeFileCandidates("/api/tasks/{id}")).toContain("pages/api/tasks/[id].ts");
  });

  it("arquivos dos módulos sobrevivem à gravação e entram em arquivos_afetados", () => {
    const missingInList = goodSpec.replace('  - "src/lib/task-store.ts"\n  - "src/app/api/tasks/route.ts"', '  - "src/app/api/tasks/route.ts"');
    const res = applyCumulativeSpecGuard(null, missingInList, "x");
    const parsed = parseSpecDocument(res.finalSpec!)!;
    expect(parsed.modulos[0].arquivos).toEqual(["src/lib/task-store.ts"]);
    expect(parsed.arquivosAfetados).toContain("src/lib/task-store.ts");
  });
});
