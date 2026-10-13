import type { SpecFrontmatterInput } from "@/core/intake/spec-format";

// Spec do P1 — cópia literal do objeto `p1Spec` de scripts/bench.ts (régua do auditor, 13/10). Mudou lá → mude aqui.
export const P1_SPEC: SpecFrontmatterInput = {
  titulo: "API de Tarefas em Memória (P1)",
  status: "aguardando_aprovacao",
  data: "2026-10-08",
  stack: ["Next.js", "TypeScript"],
  modulos: [
    {
      id: "mod-store",
      nome: "Repositório de Tarefas em Memória",
      resumo: "Funções puras e tipadas para listar, criar, atualizar e remover tarefas em memória.",
      arquivos: ["src/lib/tarefas.ts"],
    },
    {
      id: "mod-api",
      nome: "Rotas REST de Tarefas",
      resumo: "Endpoints GET/POST em /api/tarefas e PATCH/DELETE em /api/tarefas/[id].",
      arquivos: ["src/app/api/tarefas/route.ts", "src/app/api/tarefas/[id]/route.ts"],
    },
  ],
  entidades: [
    {
      nome: "Tarefa",
      campos: [
        { nome: "id", tipo: "string" },
        { nome: "titulo", tipo: "string" },
        { nome: "concluida", tipo: "boolean" },
        { nome: "criadaEm", tipo: "string" },
      ],
    },
  ],
  rotas: [
    { caminho: "/api/tarefas", descricao: "GET lista tarefas; POST cria tarefa validando titulo." },
    { caminho: "/api/tarefas/[id]", descricao: "PATCH atualiza titulo/concluida; DELETE remove tarefa por id." },
  ],
  arquivosAfetados: [
    "src/lib/tarefas.ts",
    "src/app/api/tarefas/route.ts",
    "src/app/api/tarefas/[id]/route.ts",
  ],
  objetivo:
    "Implementar API de tarefas em memória em Next.js App Router com store tipado e duas rotas REST.",
  requisitosIds: ["REQ-001", "REQ-002", "REQ-003"],
  requisitos: [
    {
      id: "REQ-001",
      titulo: "Store em memória em src/lib/tarefas.ts",
      criterio:
        "Definir interface Tarefa (id, titulo, concluida, criadaEm) e exportar listarTarefas, criarTarefa, atualizarTarefa e removerTarefa.",
    },
    {
      id: "REQ-002",
      titulo: "Listagem e criação em src/app/api/tarefas/route.ts",
      criterio:
        "Exportar GET retornando 200 com array de tarefas e POST validando titulo não vazio (400 se inválido, 201 com a tarefa criada).",
    },
    {
      id: "REQ-003",
      titulo: "Atualização e remoção em src/app/api/tarefas/[id]/route.ts",
      criterio:
        "Exportar PATCH e DELETE recebendo context com params Promise<{ id: string }>, retornando 404 quando o id não existir.",
    },
  ],
};
