import { describe, it, expect, vi } from "vitest";
import { parseSpecDocument } from "@/core/intake/spec-format";
import { checkSpecStructure, routeFileCandidates } from "@/core/intake/spec-check";
import { applyCumulativeSpecGuard, buildSpecWriterSystemPrompt } from "@/core/orchestrator/spec-draft";
import { SpecDecomposerSkill } from "@/core/skills/spec-decomposer";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";

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
requisitos_ids: []
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
requisitos_ids:
  - REQ-001
  - REQ-002
  - REQ-003
requisitos:
  - id: REQ-001
    titulo: "Armazenamento em memória"
    criterio: "src/lib/task-store.ts exporta tipo Task e funções de listagem, criação e conclusão."
  - id: REQ-002
    titulo: "Listar e criar tarefas"
    criterio: "src/app/api/tasks/route.ts implementa GET (200) e POST (201/400)."
  - id: REQ-003
    titulo: "Concluir tarefa por ID"
    criterio: "src/app/api/tasks/[id]/route.ts implementa PATCH (200/404)."
---

# API de Tarefas

API em memória para criar, listar e concluir tarefas.`;

describe("Conferência mecânica da Spec (P12)", () => {
  it("buildSpecWriterSystemPrompt exige requisitos em sequência com caminho do arquivo no critério e inclui exemplo curto", () => {
    const prompt = buildSpecWriterSystemPrompt();
    expect(prompt).toContain("requisitos:");
    expect(prompt).toContain("REQ-001");
    expect(prompt).toContain("REQ-002");
    expect(prompt).toContain("Exemplo curto de `requisitos`");
    expect(prompt).toContain("arquivos_afetados");
  });

  it("pega os furos da Spec real do teste: módulos sem arquivo, objetivo vazio e ausência de requisitos", () => {
    const problems = checkSpecStructure(parseSpecDocument(realSpec)!);
    expect(problems.some((p) => p.includes('"TaskRepository" não tem arquivos'))).toBe(true);
    expect(problems.some((p) => p.includes("objetivo"))).toBe(true);
    expect(problems.some((p) => p.includes("não declara nenhum requisito em requisitos"))).toBe(true);
    // As rotas existem no Pages Router: não é problema.
    expect(problems.some((p) => p.includes("/api/tasks"))).toBe(false);
  });

  it("Spec consistente (módulo → arquivos, rotas com arquivo, requisitos completos, objetivo) não tem problemas", () => {
    expect(checkSpecStructure(parseSpecDocument(goodSpec)!)).toEqual([]);
  });

  it("aponta os 4 problemas de requisitos: sem requisitos, id fora de sequência ou duplicado, critério sem arquivo e arquivo não citado", () => {
    // 1. Spec sem requisitos
    const noReqsSpec = goodSpec.replace(/requisitos:[\s\S]*?---/, "---");
    const pNoReqs = checkSpecStructure(parseSpecDocument(noReqsSpec)!);
    expect(pNoReqs.some((p) => p.includes("não declara nenhum requisito em requisitos"))).toBe(true);

    // 2a. ID fora de sequência (REQ-001, REQ-003)
    const outOfSeqSpec = goodSpec.replace("id: REQ-002", "id: REQ-005");
    const pOutOfSeq = checkSpecStructure(parseSpecDocument(outOfSeqSpec)!);
    expect(pOutOfSeq.some((p) => p.includes("fora de sequência") && p.includes('esperado "REQ-002"'))).toBe(true);

    // 2b. ID duplicado (REQ-001, REQ-001, REQ-003)
    const dupIdSpec = goodSpec.replace("id: REQ-002", "id: REQ-001");
    const pDupId = checkSpecStructure(parseSpecDocument(dupIdSpec)!);
    expect(pDupId.some((p) => p.includes('"REQ-001" está duplicado'))).toBe(true);

    // 3. Requisito cujo critério não cita nenhum arquivo de arquivos_afetados + 4. Arquivo de arquivos_afetados que nenhum requisito cita
    const uncitedSpec = goodSpec.replace(
      'criterio: "src/app/api/tasks/[id]/route.ts implementa PATCH (200/404)."',
      'criterio: "O endpoint de conclusão deve devolver 200 ou 404 sem citar caminho."'
    );
    const pUncited = checkSpecStructure(parseSpecDocument(uncitedSpec)!);
    expect(
      pUncited.some((p) => p.includes('critério do requisito "REQ-003" não cita nenhum arquivo de arquivos_afetados'))
    ).toBe(true);
    expect(
      pUncited.some((p) =>
        p.includes('arquivo "src/app/api/tasks/[id]/route.ts" de arquivos_afetados não é citado por nenhum requisito')
      )
    ).toBe(true);
  });

  it("rota sem arquivo é apontada com o caminho esperado no App Router", () => {
    const noRoute = goodSpec.replace(
      `  - "src/app/api/tasks/route.ts"\n  - "src/app/api/tasks/[id]/route.ts"\nrequisitos_ids:`,
      `  - "src/app/api/tasks/route.ts"\nrequisitos_ids:`
    );
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

  it("applyCumulativeSpecGuard preserva requisitos entre versões da Spec", () => {
    const v2WithoutFirstReq = `---
titulo: "API de Tarefas v2"
status: aguardando_aprovacao
stack:
  - "Next.js"
modulos:
  - id: api
    nome: "Rotas"
    resumo: "Criar, listar e concluir."
    arquivos:
      - "src/app/api/tasks/route.ts"
      - "src/app/api/tasks/[id]/route.ts"
arquivos_afetados:
  - "src/app/api/tasks/route.ts"
  - "src/app/api/tasks/[id]/route.ts"
requisitos:
  - id: REQ-001
    titulo: "Auditoria de tarefas"
    criterio: "src/app/api/tasks/route.ts registra data de criação."
---

# API de Tarefas v2

API atualizada.`;

    const res = applyCumulativeSpecGuard(goodSpec, v2WithoutFirstReq, "adicionar auditoria");
    const parsed = parseSpecDocument(res.finalSpec!)!;
    expect(parsed.requisitos).toBeDefined();
    expect(parsed.requisitos!.map((r) => r.id)).toEqual(["REQ-001", "REQ-002", "REQ-003", "REQ-004"]);
    expect(parsed.requisitos!.map((r) => r.titulo)).toEqual([
      "Armazenamento em memória",
      "Listar e criar tarefas",
      "Concluir tarefa por ID",
      "Auditoria de tarefas",
    ]);
  });

  it("spec-decomposer registra REQ_SINTETIZADOS na trilha quando a Spec antiga não tem requisitos", () => {
    const spy = vi.spyOn(TelemetryLogger, "log").mockImplementation(() => {});
    try {
      const legacySpecNoReqs = goodSpec.replace(/requisitos:[\s\S]*?---/, "---");
      SpecDecomposerSkill.decomposeSpec(
        legacySpecNoReqs,
        "API de Tarefas",
        ["src/lib/task-store.ts", "src/app/api/tasks/route.ts"],
        ["Next.js"],
        "sess-legacy-1"
      );
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "sess-legacy-1",
          action: "REQ_SINTETIZADOS",
        })
      );

      spy.mockClear();
      SpecDecomposerSkill.decomposeSpec(
        goodSpec,
        "API de Tarefas",
        ["src/lib/task-store.ts", "src/app/api/tasks/route.ts", "src/app/api/tasks/[id]/route.ts"],
        ["Next.js"],
        "sess-with-reqs-1"
      );
      expect(spy).not.toHaveBeenCalledWith(
        expect.objectContaining({
          action: "REQ_SINTETIZADOS",
        })
      );
    } finally {
      spy.mockRestore();
    }
  });
});

