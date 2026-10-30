import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import prisma from "@/lib/prisma";
import { buildDependencyContext } from "@/core/orchestrator/node-executor";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-depctx-"));
const ids = ["dep-scaffold", "dep-base", "dep-impl", "dep-sibling"];
let sessionId = "";
let projectId = "";

afterAll(async () => {
  await prisma.taskNode.deleteMany({ where: { id: { in: ids } } });
  await prisma.session.deleteMany({ where: { id: sessionId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Executor recebe o código real das etapas de que depende", () => {
  it("inclui arquivos de dependências diretas e indiretas concluídas; nunca de etapas irmãs", async () => {
    fs.mkdirSync(path.join(dir, "src/lib"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src/lib/asaas.ts"), "export interface AsaasCharge { id: string; invoiceUrl: string }\n");
    fs.writeFileSync(path.join(dir, "src/lib/irma.ts"), "export const irma = 1;\n");
    const proj = await prisma.project.create({ data: { name: "depctx", path: dir } });
    projectId = proj.id;
    const s = await prisma.session.create({ data: { projectId: proj.id } });
    sessionId = s.id;
    const mk = (id: string, deps: string[], files: string[], status: string) =>
      prisma.taskNode.create({ data: { id, sessionId, title: id, status, dependencies: JSON.stringify(deps), filesScope: JSON.stringify(files) } });
    await mk("dep-scaffold", [], ["package.json", "tsconfig.json"], "completed");
    await mk("dep-base", ["dep-scaffold"], ["src/lib/asaas.ts"], "completed");
    await mk("dep-sibling", ["dep-base"], ["src/lib/irma.ts"], "completed");
    const impl = await mk("dep-impl", ["dep-base"], ["src/app/api/charges/route.ts"], "pending");

    const ctx = await buildDependencyContext({ ...impl, session: { project: { path: dir } } } as any);
    expect(ctx).toContain("--- src/lib/asaas.ts ---");
    expect(ctx).toContain("export interface AsaasCharge { id: string; invoiceUrl: string }");
    expect(ctx).not.toContain("irma");
    expect(ctx).not.toContain("package.json");
  });
});
