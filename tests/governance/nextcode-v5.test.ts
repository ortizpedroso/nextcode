import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IntakeEngine } from "@/core/intake/intake-engine";
import { BriefBuilder } from "@/core/brief/brief-builder";
import { QuarantineManager } from "@/core/governance/quarantine-manager";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";
import { IncidentReporter } from "@/core/governance/incident-reporter";
import { DAGEngine, DAGNode } from "@/core/dag/dag-engine";
import * as path from "path";
import * as fs from "fs";

describe("NextCode v5 Governance & Multi-Agent Architecture", () => {
  const testQuarantineDir = path.join(process.cwd(), ".test-quarantine");

  afterEach(() => {
    if (fs.existsSync(testQuarantineDir)) {
      fs.rmSync(testQuarantineDir, { recursive: true, force: true });
    }
  });

  describe("1. Intake Engine & Triagem de Cenários", () => {
    it("deve classificar solicitações de escopo amplo como Cenário A (Macro/SaaS)", () => {
      const res = IntakeEngine.analyze("Quero desenvolver um SaaS completo de gestão financeira com multi-tenancy");
      expect(res.scenario).toBe("SCENARIO_A");
      expect(res.requiresSpecApproval).toBe(true);
      expect(res.suggestedAction).toBe("BUILD_CANONICAL_SPEC_AND_LOCK");
    });

    it("deve classificar alterações pontuais como Cenário B (Micro/Quick Fix)", () => {
      const res = IntakeEngine.analyze("Adicione um botão de exportação no componente Header.tsx");
      expect(res.scenario).toBe("SCENARIO_B");
      expect(res.requiresSpecApproval).toBe(false);
      expect(res.suggestedAction).toBe("GENERATE_HYBRID_BRIEF");
    });

    it("deve acionar intervenção ativa na 3ª rodada de solicitações ambíguas (Cenário C)", () => {
      const res = IntakeEngine.analyze("oi me ajuda", 3);
      expect(res.scenario).toBe("SCENARIO_C");
      expect(res.requiresIntervention).toBe(true);
      expect(res.suggestedAction).toBe("SHOW_3_PATH_INTERVENTION_MODAL");
    });

    it("deve responder diretamente a dúvidas conceituais sem criar DAG (Cenário D)", () => {
      const res = IntakeEngine.analyze("O que é o SQLite em modo WAL e como ele funciona?");
      expect(res.scenario).toBe("SCENARIO_D");
      expect(res.requiresSpecApproval).toBe(false);
      expect(res.suggestedAction).toBe("DIRECT_LLM_RESPONSE");
    });

    it("deve exportar o prompt de governança obrigatório contendo a regra 'NADA É CRIADO SEM SPEC E BRIEF'", () => {
      const sysPrompt = IntakeEngine.getGovernanceSystemPrompt();
      expect(sysPrompt).toContain("NADA É CRIADO OU ALTERADO SEM SPEC CANÔNICA E SEM BRIEF HÍBRIDO APROVADOS");
      expect(sysPrompt).toContain("É ESTRITAMENTE PROIBIDO sugerir, oferecer ou concordar em pular a etapa de Spec");
    });
  });

  describe("2. Hybrid Brief Engine & Scope Lock (Trava T2)", () => {
    it("deve gerar Brief Híbrido válido com YAML Frontmatter e Markdown", () => {
      const brief = BriefBuilder.createBrief(
        "TASK-001",
        "backend",
        "Implementar Auth JWT",
        ["src/backend/auth.ts"],
        []
      );

      expect(brief.metadata.taskId).toBe("TASK-001");
      expect(brief.contentMarkdown).toContain("---");
      expect(brief.contentMarkdown).toContain("files_scope:");
      expect(brief.contentMarkdown).toContain('src/backend/auth.ts');
    });

    it("deve disparar erro ao tentar criar Brief sem files_scope (Trava T2)", () => {
      expect(() => {
        BriefBuilder.createBrief("TASK-002", "backend", "Sem Escopo", []);
      }).toThrow("[TRAVA T2 VIOLADA]");
    });
  });

  describe("3. Quarantine Manager & Dual-Lens Auditor (Trava T5)", () => {
    it("deve isolar a gravação de código no workspace de quarentena", () => {
      const qm = new QuarantineManager(testQuarantineDir);
      qm.prepareWorkspace("TASK-TEST");
      const filePath = qm.writeFile("TASK-TEST", "src/auth.ts", "export const auth = true;");

      expect(fs.existsSync(filePath)).toBe(true);
      expect(qm.readFile("TASK-TEST", "src/auth.ts")).toBe("export const auth = true;");
    });

    it("deve reprovar no Validador Tipo 1 se houver vulnerabilidade ou tipo 'any'", () => {
      const codeMap = {
        "src/bad.ts": "const x: any = eval('1+1');",
      };
      const res1 = DualLensAuditor.validateType1(codeMap);

      expect(res1.passed).toBe(false);
      expect(res1.securityViolations.length).toBeGreaterThan(0);
      expect(res1.compilationErrors.length).toBeGreaterThan(0);
    });

    it("deve aprovar no Validador Tipo 2 Auditor Cego quando o código está limpo e o worker reporta sucesso", () => {
      const codeMap = {
        "src/good.ts": "export const sum = (a: number, b: number): number => a + b;",
      };
      const res1 = DualLensAuditor.validateType1(codeMap);
      expect(res1.passed).toBe(true);

      const res2 = DualLensAuditor.validateType2(
        res1,
        "# Brief Test",
        "Tarefa concluída com sucesso e testes validados.",
        codeMap
      );

      expect(res2.verdict).toBe("APPROVED");
      expect(res2.lens1BlindReport).toContain("Conformidade mecânica: PASS");
    });
  });

  describe("4. DAG Engine Refinado & Política D-RANHO", () => {
    it("deve detectar colisão de filesScope entre tarefas", () => {
      const engine = new DAGEngine();
      const nodeA: DAGNode = {
        id: "A",
        title: "Task A",
        role: "worker",
        status: "pending",
        dependencies: [],
        filesScope: ["src/shared.ts"],
      };
      const nodeB: DAGNode = {
        id: "B",
        title: "Task B",
        role: "worker",
        status: "pending",
        dependencies: [],
        filesScope: ["src/shared.ts", "src/other.ts"],
      };

      expect(engine.hasScopeCollision(nodeA, nodeB)).toBe(true);
    });

    it("deve incrementar tentativas e aplicar D-RANHO (nó bloqueado) na 3ª falha", () => {
      const engine = new DAGEngine([
        {
          id: "FAIL-TASK",
          title: "Failing Task",
          role: "worker",
          status: "pending",
          dependencies: [],
          attempts: 2,
          maxAttempts: 3,
        },
      ]);

      const node = engine.updateNodeStatus("FAIL-TASK", "failed");
      expect(node.attempts).toBe(3);
      expect(node.status).toBe("blocked");
    });

    it("deve compilar o Relatório de Incidente de Evolução ao bloquear a tarefa", () => {
      const report = IncidentReporter.generateIncidentReport(
        "TASK-FAIL-101",
        "Falha de Autenticação",
        "backend",
        [
          {
            attemptNumber: 3,
            rejectionReason: "Testes unitários falharam na Lente 1.",
            filesScope: ["src/auth.ts"],
            timestamp: new Date().toISOString(),
          },
        ]
      );

      expect(report).toContain("Relatório de Incidente de Evolução");
      expect(report).toContain("TASK-FAIL-101");
      expect(report).toContain("Severidade:");
    });
  });

  describe("5. Promoção Física de Projetos & Quarentena", () => {
    it("deve extrair código formatado em markdown e promover fisicamente para a pasta do projeto", () => {
      const qm = new QuarantineManager(testQuarantineDir);
      const testProjectRoot = path.join(process.cwd(), ".test-project-dest");
      const taskId = "TASK-PROMOTE-999";

      const markdownOutput = `Aqui está o código:
\`\`\`ts filepath="src/services/api.service.ts"
export const fetchApi = () => true;
\`\`\`
`;

      // Extrai e grava na quarentena
      const codeMap = qm.extractAndWriteCodeBlocks(taskId, markdownOutput, ["src/services/api.service.ts"]);
      expect(codeMap["src/services/api.service.ts"]).toBe("export const fetchApi = () => true;\n");

      // Promove da quarentena para a pasta do projeto
      const promoted = qm.promoteToMainRepo(taskId, testProjectRoot, ["src/services/api.service.ts"]);
      expect(promoted).toBe(true);

      const destFile = path.join(testProjectRoot, "src/services/api.service.ts");
      expect(fs.existsSync(destFile)).toBe(true);
      expect(fs.readFileSync(destFile, "utf-8")).toBe("export const fetchApi = () => true;\n");

      // Limpa os arquivos de teste
      fs.rmSync(testProjectRoot, { recursive: true, force: true });
    });
  });
});
