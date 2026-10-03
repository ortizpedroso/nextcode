import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IntakeEngine } from "@/core/intake/intake-engine";
import { BriefBuilder } from "@/core/brief/brief-builder";
import { QuarantineManager } from "@/core/governance/quarantine-manager";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";
import { IncidentReporter } from "@/core/governance/incident-reporter";
import { DAGEngine, DAGNode } from "@/core/dag/dag-engine";
import { extractFilePathsFromText, SpecDecomposerSkill } from "@/core/skills/spec-decomposer";
import { stripErrorLogLines } from "@/core/intake/input-preprocessor";
import * as path from "path";
import * as fs from "fs";

describe("NextCode v5 Governance & Multi-Agent Architecture", () => {
  const testQuarantineDir = path.join(process.cwd(), ".test-quarantine");

  afterEach(() => {
    if (fs.existsSync(testQuarantineDir)) {
      try {
        fs.rmSync(testQuarantineDir, { recursive: true, force: true });
      } catch (err) {
        // Silencia erros transitórios de trava de diretório no Windows
      }
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

    it("deve exportar o prompt de governança como YAML estruturado, sem prosa em CAPS nem template de emojis", () => {
      const sysPrompt = IntakeEngine.getGovernanceSystemPrompt();
      expect(sysPrompt).toContain("diretrizes:");
      expect(sysPrompt).toContain("id: patch_direto");
      expect(sysPrompt).toContain("id: trava_aprovacao");
      expect(sysPrompt).toContain("spec_output_format:");
      // Não deve mais conter o template de emojis que contradizia a regra de "sem cabeçalhos robóticos"
      expect(sysPrompt).not.toContain("ESTRUTURA RECOMENDADA");
      expect(sysPrompt).not.toContain("📋");
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
      expect(qm.readFile("TASK-TEST", "src/auth.ts")).toBe("export const auth = true;\n");
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

    it("deve aprovar no Validador Tipo 2 (fallback heurístico) quando o código está limpo e o worker reporta sucesso", async () => {
      const codeMap = {
        "src/good.ts": "export const sum = (a: number, b: number): number => a + b;",
      };
      const res1 = DualLensAuditor.validateType1(codeMap);
      expect(res1.passed).toBe(true);

      // Sem dispatchFn: cai explicitamente no fallback heurístico (sem leitura semântica real).
      const res2 = await DualLensAuditor.validateType2(
        res1,
        "# Brief Test",
        "Tarefa concluída com sucesso e testes validados.",
        codeMap
      );

      expect(res2.verdict).toBe("APPROVED");
      expect(res2.method).toBe("heuristic_fallback");
      expect(res2.lens1BlindReport).toContain("Conformidade mecânica: PASS");
    });

    it("deve usar a Lente 1 (LLM) real quando um dispatchFn é fornecido e confiar no veredito dela, não no texto do worker", async () => {
      const codeMap = {
        "src/good.ts": "export const sum = (a: number, b: number): number => a + b;",
      };
      const res1 = DualLensAuditor.validateType1(codeMap);

      const dispatchFn = async () =>
        JSON.stringify({ implemented: true, missingRequirements: [], justification: "Soma implementada conforme Brief." });

      const res2 = await DualLensAuditor.validateType2(
        res1,
        "# Brief Test\nImplemente uma função de soma.",
        "Não sei se terminei tudo certo.",
        codeMap,
        dispatchFn
      );

      expect(res2.method).toBe("llm_blind");
      expect(res2.verdict).toBe("APPROVED");
    });

    it("deve REJEITAR via Lente 1 (LLM) mesmo quando o worker alega sucesso, se o código real não implementa o Brief (detecção de alucinação)", async () => {
      const codeMap = {
        "src/empty.ts": "export const placeholder = true;",
      };
      const res1 = DualLensAuditor.validateType1(codeMap);

      const dispatchFn = async () =>
        JSON.stringify({
          implemented: false,
          missingRequirements: ["Integração com Asaas", "Webhook de pagamento"],
          justification: "Arquivo apenas contém um placeholder, nenhuma lógica do Brief foi implementada.",
        });

      const res2 = await DualLensAuditor.validateType2(
        res1,
        "# Brief Test\nImplemente a integração completa com o gateway Asaas e o webhook de pagamento.",
        "Concluído com sucesso! Implementação finalizada.",
        codeMap,
        dispatchFn
      );

      expect(res2.method).toBe("llm_blind");
      expect(res2.verdict).toBe("REJECTED");
      expect(res2.lens2CrossVerification).toContain("Divergência detectada: SIM");
      expect(res2.rejectionReason).toContain("Integração com Asaas");
    });

    it("deve cair no fallback heurístico se o dispatchFn falhar ou retornar lixo não-parseável", async () => {
      const codeMap = {
        "src/good.ts": "export const sum = (a: number, b: number): number => a + b;",
      };
      const res1 = DualLensAuditor.validateType1(codeMap);

      const brokenDispatchFn = async () => "isso não é JSON válido";

      const res2 = await DualLensAuditor.validateType2(
        res1,
        "# Brief Test",
        "Tarefa concluída com sucesso.",
        codeMap,
        brokenDispatchFn
      );

      expect(res2.method).toBe("heuristic_fallback");
      expect(res2.verdict).toBe("APPROVED");
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

    it("deve extrair nomes de arquivos explicitamente citados no prompt do usuário via extractFilePathsFromText", () => {
      const files = extractFilePathsFromText("Por favor, altere o arquivo package.json e corrija o prisma/schema.prisma");
      expect(files).toContain("package.json");
      expect(files).toContain("prisma/schema.prisma");

      const decomposed = SpecDecomposerSkill.decompose("corrija o erro no arquivo package.json");
      const implNode = decomposed.nodes.find((n: any) => n.role === "developer");
      expect(implNode.filesScope).toEqual(["package.json"]);
    });

    it("deve ignorar Next.js como nome de arquivo e extrair caminhos válidos como src/core/engine.ts", () => {
      const qm = new QuarantineManager(testQuarantineDir);
      const text = `Next.js (14.2.0) is outdated
Crie o arquivo em src/core/engine.ts com o código:
\`\`\`ts
export const defaultEngine = {};
\`\`\`
`;
      const codeMap = qm.extractAndWriteCodeBlocks("TASK-TEST-NEXTJS", text, []);
      expect(codeMap["Next.js"]).toBeUndefined();
      expect(codeMap["src/core/engine.ts"]).toBe("export const defaultEngine = {};\n");
    });

    it("REGRESSÃO (incidente gatewaynovo): nunca promove bloco bash/shell/texto a arquivo sem caminho explícito, nem inventa 'generated-N.ts'", () => {
      const qm = new QuarantineManager(testQuarantineDir);
      const text = `Infraestrutura criada com sucesso.

\`\`\`bash
npm install
npm run dev
\`\`\`
`;
      const codeMap = qm.extractAndWriteCodeBlocks("TASK-REGRESSION-BASH", text, []);
      expect(Object.keys(codeMap)).toHaveLength(0);
      expect(codeMap["src/generated-1.ts"]).toBeUndefined();
    });

    it("bloco bash COM caminho explícito ainda pode ser gravado (ex.: script de deploy intencional)", () => {
      const qm = new QuarantineManager(testQuarantineDir);
      const text = `\`\`\`bash filepath="scripts/deploy.sh"
#!/bin/bash
npm run build
\`\`\`
`;
      const codeMap = qm.extractAndWriteCodeBlocks("TASK-REGRESSION-BASH-EXPLICIT", text, []);
      expect(codeMap["scripts/deploy.sh"]).toContain("npm run build");
    });

    it("não deriva fallbackFilesScope de linhas com cara de stacktrace colado pelo usuário", () => {
      const rawUserPrompt = `Deu esse erro ao rodar o projeto:
TypeError: Cannot read properties of undefined
    at Object.<anonymous> (src/generated-2.ts:4:1)
    at Module._compile (node:internal/modules/cjs/loader:1105:14)
corrija isso`;
      const cleaned = stripErrorLogLines(rawUserPrompt);
      const files = extractFilePathsFromText(cleaned);
      expect(files).not.toContain("src/generated-2.ts");
    });

    it("deve validar schemas do Prisma e relatar erro em modelos sem chave primária (@id)", () => {
      const codeMap = {
        "prisma/schema.prisma": `model User { name String }`
      };
      const res = DualLensAuditor.validateType1(codeMap);
      expect(res.passed).toBe(false);
      expect(res.compilationErrors.some(e => e.includes("[PRISMA SCHEMA ERROR]"))).toBe(true);
    });

    it("deve validar que componentes do App Router contêm export default e rotas de API contêm métodos HTTP", () => {
      const badPage = { "src/app/page.tsx": `const Page = () => null;` };
      const resPage = DualLensAuditor.validateType1(badPage);
      expect(resPage.passed).toBe(false);
      expect(resPage.compilationErrors.some(e => e.includes("[NEXT.JS APP ROUTER ERROR]"))).toBe(true);

      const goodPage = { "src/app/page.tsx": `export default function Page() { return null; }` };
      const resGood = DualLensAuditor.validateType1(goodPage);
      expect(resGood.passed).toBe(true);
    });

    it("deve auto-corrigir erros de digitação 'client' para 'use client' e auto-inserir em componentes com hooks", () => {
      const qm = new QuarantineManager(testQuarantineDir);
      
      // Teste 1: 'client' typo corrigido para 'use client'
      qm.prepareWorkspace("TASK-CLIENT-TYPO");
      qm.writeFile("TASK-CLIENT-TYPO", "src/components/button.tsx", "'client';\nimport { useState } from 'react';\nexport default function Btn() { const [x] = useState(0); return null; }");
      const content1 = qm.readFile("TASK-CLIENT-TYPO", "src/components/button.tsx");
      expect(content1).toContain("'use client';");
      expect(content1).not.toContain("'client';");

      // Teste 2: Componente com useState sem diretiva ganha 'use client' automaticamente
      qm.prepareWorkspace("TASK-HOOK-NO-CLIENT");
      qm.writeFile("TASK-HOOK-NO-CLIENT", "src/app/dashboard/page.tsx", "import { useState } from 'react';\nexport default function Dash() { const [s] = useState(1); return null; }");
      const content2 = qm.readFile("TASK-HOOK-NO-CLIENT", "src/app/dashboard/page.tsx");
      expect(content2?.startsWith("'use client';")).toBe(true);

      // Teste 3: DualLensAuditor detecta 'client' malformado caso chegue cru
      const badMap = {
        "src/app/test/page.tsx": "'client';\nexport default function Test() { return null; }"
      };
      const auditRes = DualLensAuditor.validateType1(badMap);
      expect(auditRes.passed).toBe(false);
      expect(auditRes.compilationErrors.some(e => e.includes("Diretiva de cliente malformada"))).toBe(true);
    });
  });
});
