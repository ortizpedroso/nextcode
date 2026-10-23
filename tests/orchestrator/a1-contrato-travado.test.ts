import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { enforceSkillToolPermission, loadRoleSkill } from "@/core/skills/skill-runtime";
import { QuarantineManager } from "@/core/governance/quarantine-manager";
import { promoteWithEmpiricalGate } from "@/core/governance/empirical-gate";
import { renderContractTs, renderConformance, type ContratoProjeto } from "@/core/orchestrator/project-contract";

function makeTestProject(): { root: string; qm: QuarantineManager; cleanup: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-a1-test-"));
  const root = path.join(base, "project");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "CommonJS",
        moduleResolution: "Node",
        baseUrl: ".",
        paths: {
          "@/*": ["src/*"],
        },
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["src/**/*"],
    })
  );
  const qm = new QuarantineManager(path.join(base, ".quarantine"));
  return { root, qm, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

describe("A1.3 — Contrato travado, protegido e conferido mecanicamente pelo porteiro", () => {
  it("1. Executor tenta escrever em src/contracts/index.ts e toma negação de permissão [SKILL PROTECTED PATH]", () => {
    const skill = loadRoleSkill("executor-backend")!;
    expect(skill).toBeDefined();

    const resWriteIndex = enforceSkillToolPermission({
      skill,
      toolName: "write_file",
      targetFile: "src/contracts/index.ts",
      allowedScopeFiles: ["src/contracts/index.ts", "src/auth.ts"],
      currentStep: 1,
    });
    expect(resWriteIndex.allowed).toBe(false);
    expect(resWriteIndex.violationReason).toContain("[SKILL PROTECTED PATH]");

    const resEditConformance = enforceSkillToolPermission({
      skill,
      toolName: "edit_file",
      targetFile: "src/contracts/conformidade/etapa_1.ts",
      allowedScopeFiles: ["src/contracts/conformidade/etapa_1.ts"],
      currentStep: 1,
    });
    expect(resEditConformance.allowed).toBe(false);
    expect(resEditConformance.violationReason).toContain("[SKILL PROTECTED PATH]");

    const resWriteOther = enforceSkillToolPermission({
      skill,
      toolName: "write_file",
      targetFile: "src/contracts/outro.ts",
      allowedScopeFiles: ["src/contracts/outro.ts"],
      currentStep: 1,
    });
    expect(resWriteOther.allowed).toBe(false);
    expect(resWriteOther.violationReason).toContain("[SKILL PROTECTED PATH]");
  });

  it("2. Uma etapa que implementa função com assinatura diferente do contrato toma reprovação mecânica do porteiro pelo tsc do arquivo de conformidade", async () => {
    const { root, qm, cleanup } = makeTestProject();
    try {
      const contrato: ContratoProjeto = {
        entidades: [
          {
            nome: "Sessao",
            campos: [
              { nome: "id", tipo: "string", opcional: false, descricao: "ID da sessão" },
              { nome: "userId", tipo: "string", opcional: false, descricao: "ID do usuário" },
              { nome: "papel", tipo: "PapelUsuario", opcional: false, descricao: "Papel" },
            ],
            dono: "etapa_1",
            usadoPor: [],
          },
        ],
        enums: [
          {
            nome: "PapelUsuario",
            valores: ["admin", "usuario"],
            dono: "etapa_1",
            usadoPor: [],
          },
        ],
        funcoes: [
          {
            nome: "criarSessao",
            arquivo: "src/auth.ts",
            assinatura: "(userId: string, papel: PapelUsuario) => Promise<Sessao>",
            dono: "etapa_1",
            usadoPor: [],
          },
        ],
        rotas: [],
      };

      // 1. Grava src/contracts/index.ts no projeto (harness gravou antes de disparar o grafo)
      fs.mkdirSync(path.join(root, "src", "contracts"), { recursive: true });
      fs.writeFileSync(path.join(root, "src", "contracts", "index.ts"), renderContractTs(contrato), "utf8");

      // 2. Executor implementou src/auth.ts com assinatura divergente (sem o parâmetro `papel`)
      const taskId = "task-etapa-1-invalida";
      qm.writeFile(
        taskId,
        "src/auth.ts",
        `export async function criarSessao(userId: string) {\n  return { id: "sess-1", userId };\n}\n`
      );

      // 3. Harness gera em quarentena o arquivo de conformidade src/contracts/conformidade/etapa_1.ts
      const conformanceRelPath = "src/contracts/conformidade/etapa_1.ts";
      const conformanceContent = renderConformance(contrato, "etapa_1");
      qm.writeFile(taskId, conformanceRelPath, conformanceContent);

      const effectiveScope = ["src/auth.ts", conformanceRelPath];

      // 4. Porteiro roda em modo checkOnly: true
      const gate = await promoteWithEmpiricalGate(qm, taskId, root, effectiveScope, { checkOnly: true });

      expect(gate.passed).toBe(false);
      expect(gate.failedStage).toBe("typecheck");
      expect(gate.rolledBack).toBe(true);
      // Confirma que os arquivos foram desfeitos do projeto devido ao rollback
      expect(fs.existsSync(path.join(root, "src", "auth.ts"))).toBe(false);
      expect(fs.existsSync(path.join(root, "src", "contracts", "conformidade", "etapa_1.ts"))).toBe(false);
    } finally {
      cleanup();
    }
  }, 90000);

  it("3. Uma etapa válida passa pelo porteiro e tem o arquivo de conformidade promovido", async () => {
    const { root, qm, cleanup } = makeTestProject();
    try {
      const contrato: ContratoProjeto = {
        entidades: [
          {
            nome: "Sessao",
            campos: [
              { nome: "id", tipo: "string", opcional: false, descricao: "ID da sessão" },
              { nome: "userId", tipo: "string", opcional: false, descricao: "ID do usuário" },
              { nome: "papel", tipo: "PapelUsuario", opcional: false, descricao: "Papel" },
            ],
            dono: "etapa_1",
            usadoPor: [],
          },
        ],
        enums: [
          {
            nome: "PapelUsuario",
            valores: ["admin", "usuario"],
            dono: "etapa_1",
            usadoPor: [],
          },
        ],
        funcoes: [
          {
            nome: "criarSessao",
            arquivo: "src/auth.ts",
            assinatura: "(userId: string, papel: PapelUsuario) => Promise<Sessao>",
            dono: "etapa_1",
            usadoPor: [],
          },
        ],
        rotas: [],
      };

      // 1. Grava src/contracts/index.ts no projeto
      fs.mkdirSync(path.join(root, "src", "contracts"), { recursive: true });
      fs.writeFileSync(path.join(root, "src", "contracts", "index.ts"), renderContractTs(contrato), "utf8");

      // 2. Executor implementou src/auth.ts com a assinatura exata do contrato
      const taskId = "task-etapa-1-valida";
      qm.writeFile(
        taskId,
        "src/auth.ts",
        `import type { Sessao, PapelUsuario } from "@/contracts";\n\nexport async function criarSessao(userId: string, papel: PapelUsuario): Promise<Sessao> {\n  return { id: "sess-1", userId, papel };\n}\n`
      );

      // 3. Harness gera em quarentena o arquivo de conformidade src/contracts/conformidade/etapa_1.ts
      const conformanceRelPath = "src/contracts/conformidade/etapa_1.ts";
      const conformanceContent = renderConformance(contrato, "etapa_1");
      qm.writeFile(taskId, conformanceRelPath, conformanceContent);

      const effectiveScope = ["src/auth.ts", conformanceRelPath];

      // 4. Porteiro checkOnly: true passa
      const porteiro = await promoteWithEmpiricalGate(qm, taskId, root, effectiveScope, { checkOnly: true });
      expect(porteiro.passed).toBe(true);

      // 5. Promoção real promove o arquivo de conformidade e o arquivo da etapa
      const realPromotion = await promoteWithEmpiricalGate(qm, taskId, root, effectiveScope);
      expect(realPromotion.passed).toBe(true);
      expect(realPromotion.rolledBack).toBe(false);

      expect(fs.existsSync(path.join(root, "src", "auth.ts"))).toBe(true);
      expect(fs.existsSync(path.join(root, "src", "contracts", "conformidade", "etapa_1.ts"))).toBe(true);
      const promotedContent = fs.readFileSync(
        path.join(root, "src", "contracts", "conformidade", "etapa_1.ts"),
        "utf8"
      );
      expect(promotedContent).toContain("export const _c_criarSessao: FnCriarSessao = criarSessao;");
    } finally {
      cleanup();
    }
  }, 90000);
});
