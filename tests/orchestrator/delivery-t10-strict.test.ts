import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { TaskNode } from "@prisma/client";
import { verifyProjectDeliveryT10 } from "@/core/orchestrator/node-executor";

const SPEC = `---
titulo: "API de Tarefas"
status: aprovada
stack:
  - "Next.js"
requisitos:
  - id: REQ-001
    descricao: "Listar tarefas"
    criterios: ["GET /api/tarefas devolve a lista"]
arquivos_afetados:
  - "src/lib/tarefas-store.ts"
---

# API de Tarefas

Lista tarefas em memória.`;

function node(result: unknown, files = ["src/lib/tarefas-store.ts"]): TaskNode {
  return {
    role: "backend",
    status: "completed",
    filesScope: JSON.stringify(files),
    payload: JSON.stringify({ goal: "x", nodeFiles: files, reqsCobertos: ["REQ-001"] }),
    result: JSON.stringify(result),
  } as unknown as TaskNode;
}

describe("Entrega estrita (T10, decisão do fundador 07/10)", () => {
  it("sem tsconfig/package.json e sem o arquivo da Spec no disco → NÃO entrega", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "t10-"));
    const res = verifyProjectDeliveryT10({
      canonicalSpec: SPEC,
      projectPath: root,
      tasks: [node({ success: true, auditVerdict: "APPROVED" })],
      requireFullBuild: true,
    });
    expect(res.passed).toBe(false);
    expect(res.buildVerified).toBe(false);
  });

  it("REQ reprovado pelo avaliador → NÃO entrega, mesmo com build e arquivos ok", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "t10-"));
    fs.writeFileSync(path.join(root, "tsconfig.json"), "{}");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { next: "15" } }));
    fs.mkdirSync(path.join(root, "src/lib"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/lib/tarefas-store.ts"), "export const t = [];\n");
    const res = verifyProjectDeliveryT10({
      canonicalSpec: SPEC,
      projectPath: root,
      tasks: [node({ success: true, reqVerdicts: [{ id: "REQ-001", status: "parcial", evidencia: "x:1" }] })],
      requireFullBuild: true,
    });
    expect(res.passed).toBe(false);
    expect(res.unapprovedReqs).toContain("REQ-001");
  });

  it("build ok, arquivos no disco e REQ aprovado → entrega", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "t10-"));
    fs.writeFileSync(path.join(root, "tsconfig.json"), "{}");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { next: "15" } }));
    fs.mkdirSync(path.join(root, "src/lib"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/lib/tarefas-store.ts"), "export const t = [];\n");
    const res = verifyProjectDeliveryT10({
      canonicalSpec: SPEC,
      projectPath: root,
      tasks: [node({ success: true, reqVerdicts: [{ id: "REQ-001", status: "implementado", evidencia: "src/lib/tarefas-store.ts:1" }] })],
      requireFullBuild: true,
    });
    expect(res.gaps).toEqual([]);
    expect(res.passed).toBe(true);
  });
});
