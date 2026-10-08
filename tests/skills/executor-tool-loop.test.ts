import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { SmartRouter, type DispatchResult } from "@/core/router/smart-router";
import { approveSpecAndStart } from "@/core/orchestrator/execution-trigger";
import { runOnce } from "@/core/orchestrator/job-worker";
import {
  executeTaskNode,
  readNodeMicrobrief,
  setExecutorModeForTests,
  setPaidOnlyRoutingForTests,
  setScaffoldInstallerForTests,
} from "@/core/orchestrator/node-executor";
import { renderCanonicalSpecDocument } from "@/core/intake/spec-format";
import { TerminalExecutionEngine } from "@/core/execution/terminal-execution-engine";
import { promoteWithEmpiricalGate } from "@/core/governance/empirical-gate";
import { QuarantineManager } from "@/core/governance/quarantine-manager";
import {
  defaultRunTypecheckInQuarantine,
  parseExecutorToolAction,
} from "@/core/skills/executor-tool-loop";

const createdSessionIds: string[] = [];
const createdProjectIds: string[] = [];
const tempDirs: string[] = [];

function makeTempProjectDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-tool-loop-"));
  tempDirs.push(d);
  return d;
}

function makeOkDispatch(
  content: string,
  provider = "omniroute",
  model = "auto:smart"
): DispatchResult {
  return {
    response: new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ),
    providerUsed: provider,
    badge: provider,
    tierTag: "heavy",
    modelUsed: model,
  };
}

function makeExhaustedDispatch(): DispatchResult {
  return {
    response: new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: "⚠️ Cotas e Serviços Indisponíveis",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ),
    providerUsed: "none",
    badge: "Sem Provedor",
    tierTag: "exhausted",
    modelUsed: "none",
  };
}

function toolTurn(ferramenta: string, args: Record<string, unknown>): string {
  return "```json acao\n" + JSON.stringify({ ferramenta, args }, null, 2) + "\n```";
}

const VALID_REPORT_YAML = [
  "reqs:",
  "  - id: REQ-001",
  "    status: atendido",
  '    arquivo_linha: "src/greet.ts:1-3"',
  '    como: "Funcao greet implementada em src/greet.ts"',
].join("\n");

const EVALUATOR_PASS_JSON = JSON.stringify({
  implemented: true,
  missingRequirements: [],
  justification: "Todos os requisitos implementados.",
  reqVerdicts: [
    {
      id: "REQ-001",
      status: "implementado",
      evidencia: "src/greet.ts:1 implementa greet",
    },
  ],
});

async function setupSingleTaskSession(projectDir: string) {
  fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify({ name: "test-proj", version: "1.0.0" }),
    "utf-8"
  );
  fs.mkdirSync(path.join(projectDir, "node_modules"), { recursive: true });

  const project = await prisma.project.create({
    data: { name: "Projeto Tool Loop", path: projectDir },
  });
  createdProjectIds.push(project.id);

  const spec = renderCanonicalSpecDocument({
    titulo: "Saudacao Tool Loop",
    status: "aprovada",
    data: "2026-10-07",
    objetivo: "Implementar saudacao em src/greet.ts",
    stack: ["TypeScript"],
    modulos: [{ id: "M1", nome: "Core", resumo: "Saudacao" }],
    entidades: [],
    arquivosAfetados: ["src/greet.ts"],
    requisitos: [
      {
        id: "REQ-001",
        titulo: "Funcao greet",
        criterio: "Exportar greet(name: string): string em src/greet.ts",
      },
    ],
  });

  const session = await prisma.session.create({
    data: {
      title: "Sessao Tool Loop",
      projectId: project.id,
      phase: "SPEC_REVISAO",
      specApproved: false,
      canonicalSpec: spec,
    },
  });
  createdSessionIds.push(session.id);

  const startRes = await approveSpecAndStart(session.id, spec);
  if (!startRes.ok) throw new Error("approveSpecAndStart falhou");

  const tasks = await prisma.taskNode.findMany({
    where: { sessionId: session.id },
    include: { session: { include: { project: true } } },
  });
  const microbriefTask = tasks.find((t) => readNodeMicrobrief(t.payload) != null);
  expect(microbriefTask).toBeDefined();

  for (const other of tasks) {
    if (other.id !== microbriefTask!.id) {
      await prisma.taskNode.update({
        where: { id: other.id },
        data: { status: "completed", result: JSON.stringify({ success: true }) },
      });
    }
  }

  return { project, session, task: microbriefTask!, jobId: startRes.jobId! };
}

async function waitForTelemetryLogs(sessionId: string, action: string) {
  for (let i = 0; i < 30; i++) {
    const rows = await prisma.telemetryLog.findMany({
      where: { sessionId, action },
      orderBy: { createdAt: "asc" },
    });
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 30));
  }
  return prisma.telemetryLog.findMany({
    where: { sessionId, action },
    orderBy: { createdAt: "asc" },
  });
}

describe("Laço de ferramentas do executor (Item 2)", () => {
  beforeEach(() => {
    setExecutorModeForTests("laco");
    setPaidOnlyRoutingForTests(false);
    setScaffoldInstallerForTests(async (cwd) => {
      fs.mkdirSync(path.join(cwd, "node_modules"), { recursive: true });
      return {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        executionTimeMs: 1,
      };
    });
    vi.spyOn(TerminalExecutionEngine, "verifyProjectLint").mockResolvedValue(null);
  });

  afterEach(async () => {
    setExecutorModeForTests(null);
    setPaidOnlyRoutingForTests(null);
    setScaffoldInstallerForTests(null);
    vi.restoreAllMocks();
    if (createdSessionIds.length > 0) {
      await prisma.job
        .deleteMany({ where: { sessionId: { in: createdSessionIds } } })
        .catch(() => {});
      await prisma.taskNode
        .deleteMany({ where: { sessionId: { in: createdSessionIds } } })
        .catch(() => {});
      await prisma.message
        .deleteMany({ where: { sessionId: { in: createdSessionIds } } })
        .catch(() => {});
      await prisma.session
        .deleteMany({ where: { id: { in: createdSessionIds } } })
        .catch(() => {});
      createdSessionIds.length = 0;
    }
    if (createdProjectIds.length > 0) {
      await prisma.project
        .deleteMany({ where: { id: { in: createdProjectIds } } })
        .catch(() => {});
      createdProjectIds.length = 0;
    }
    for (const d of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("a) caminho feliz: list_files → read_file → write_file → run_check → finish ⇒ etapa completed; executorReport validado; o arquivo existe no projeto depois da promoção", async () => {
    const projectDir = makeTempProjectDir();
    const { task } = await setupSingleTaskSession(projectDir);
    fs.writeFileSync(
      path.join(projectDir, "src", "greet.ts"),
      "// rascunho inicial\n",
      "utf-8"
    );

    vi.spyOn(TerminalExecutionEngine, "verifyProjectBuild").mockResolvedValue({
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      executionTimeMs: 1,
    });

    const executorTurns = [
      toolTurn("list_files", { pasta: "src" }),
      toolTurn("read_file", { caminho: "src/greet.ts" }),
      toolTurn("write_file", {
        caminho: "src/greet.ts",
        conteudo:
          'export function greet(name: string): string {\n  return `Ola, ${name}!`;\n}\n',
      }),
      toolTurn("run_check", { comando: "typecheck" }),
      toolTurn("finish", { relatorio_executor: VALID_REPORT_YAML }),
    ];
    let turnIdx = 0;

    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockImplementation(
      async (opts) => {
        const sys = opts.messages.map((m) => m.content).join("\n");
        if (sys.includes("Auditor Cego")) {
          return makeOkDispatch(EVALUATOR_PASS_JSON, "groq", "llama-3.3-70b");
        }
        const reply =
          executorTurns[Math.min(turnIdx, executorTurns.length - 1)];
        turnIdx++;
        return makeOkDispatch(reply, "deepseek", "deepseek-chat");
      }
    );

    const res = await executeTaskNode(task);
    expect(res.success).toBe(true);
    expect(res.finalStatus).toBe("completed");
    expect(turnIdx).toBe(5);

    const updatedTask = await prisma.taskNode.findUniqueOrThrow({
      where: { id: task.id },
    });
    const parsedResult = JSON.parse(updatedTask.result!);
    expect(parsedResult.executorReport).toBeTruthy();
    expect(parsedResult.executorReport.documento).toBe("relatorio_executor");
    expect(parsedResult.executorReport.registroCumprimento[0].reqId).toBe("REQ-001");
    expect(parsedResult.executorReport.registroCumprimento[0].statusDeclarado).toBe("atendido");

    const promotedPath = path.join(projectDir, "src", "greet.ts");
    expect(fs.existsSync(promotedPath)).toBe(true);
    expect(fs.readFileSync(promotedPath, "utf-8")).toContain(
      "export function greet"
    );
  });

  it("b) write_file fora do escopo ⇒ SKILL_TOOL_DENIED, nada gravado, laço continua", async () => {
    const projectDir = makeTempProjectDir();
    const { session, task } = await setupSingleTaskSession(projectDir);

    vi.spyOn(TerminalExecutionEngine, "verifyProjectBuild").mockResolvedValue({
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      executionTimeMs: 1,
    });

    const executorTurns = [
      toolTurn("write_file", {
        caminho: "src/fora-do-escopo.ts",
        conteudo: "export const hack = true;\n",
      }),
      toolTurn("write_file", {
        caminho: "src/greet.ts",
        conteudo:
          'export function greet(name: string): string {\n  return `Ola, ${name}!`;\n}\n',
      }),
      toolTurn("finish", { relatorio_executor: VALID_REPORT_YAML }),
    ];
    let turnIdx = 0;

    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockImplementation(
      async (opts) => {
        const sys = opts.messages.map((m) => m.content).join("\n");
        if (sys.includes("Auditor Cego")) {
          return makeOkDispatch(EVALUATOR_PASS_JSON, "groq", "llama-3.3-70b");
        }
        const reply =
          executorTurns[Math.min(turnIdx, executorTurns.length - 1)];
        turnIdx++;
        return makeOkDispatch(reply, "deepseek", "deepseek-chat");
      }
    );

    const res = await executeTaskNode(task);
    expect(res.success).toBe(true);
    expect(res.finalStatus).toBe("completed");
    expect(
      fs.existsSync(path.join(projectDir, "src", "fora-do-escopo.ts"))
    ).toBe(false);

    const deniedLogs = await waitForTelemetryLogs(session.id, "SKILL_TOOL_DENIED");
    expect(deniedLogs.length).toBeGreaterThanOrEqual(1);
    const details = JSON.parse(deniedLogs[0].details!);
    expect(details.ferramenta).toBe("write_file");
    expect(details.motivo).toContain("[SKILL SCOPE VIOLATION]");
  });

  it('c) write_file em ".env" ⇒ negado ([SKILL PROTECTED PATH])', async () => {
    const projectDir = makeTempProjectDir();
    const { session, task } = await setupSingleTaskSession(projectDir);

    vi.spyOn(TerminalExecutionEngine, "verifyProjectBuild").mockResolvedValue({
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      executionTimeMs: 1,
    });

    let secondTurnReceivedProtectedPathError = false;
    const executorTurns = [
      toolTurn("write_file", {
        caminho: ".env",
        conteudo: "SECRET=123\n",
      }),
      toolTurn("write_file", {
        caminho: "src/greet.ts",
        conteudo:
          'export function greet(name: string): string {\n  return `Ola, ${name}!`;\n}\n',
      }),
      toolTurn("finish", { relatorio_executor: VALID_REPORT_YAML }),
    ];
    let turnIdx = 0;

    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockImplementation(
      async (opts) => {
        const sys = opts.messages.map((m) => m.content).join("\n");
        if (sys.includes("Auditor Cego")) {
          return makeOkDispatch(EVALUATOR_PASS_JSON, "groq", "llama-3.3-70b");
        }
        if (turnIdx === 1) {
          const lastUserMsg = opts.messages[opts.messages.length - 1]?.content ?? "";
          if (lastUserMsg.includes("[SKILL PROTECTED PATH]")) {
            secondTurnReceivedProtectedPathError = true;
          }
        }
        const reply =
          executorTurns[Math.min(turnIdx, executorTurns.length - 1)];
        turnIdx++;
        return makeOkDispatch(reply, "deepseek", "deepseek-chat");
      }
    );

    const res = await executeTaskNode(task);
    expect(res.success).toBe(true);
    expect(secondTurnReceivedProtectedPathError).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".env"))).toBe(false);

    const deniedLogs = await waitForTelemetryLogs(session.id, "SKILL_TOOL_DENIED");
    expect(deniedLogs.length).toBeGreaterThanOrEqual(1);
    expect(deniedLogs[0].details).toContain("[SKILL PROTECTED PATH]");
  });

  it("d) ferramenta fora da lista da skill ⇒ negado ([SKILL TOOL DENIED])", async () => {
    const projectDir = makeTempProjectDir();
    const { session, task } = await setupSingleTaskSession(projectDir);

    vi.spyOn(TerminalExecutionEngine, "verifyProjectBuild").mockResolvedValue({
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      executionTimeMs: 1,
    });

    let receivedToolDenied = false;
    const executorTurns = [
      toolTurn("drop_table", { tabela: "users" }),
      toolTurn("write_file", {
        caminho: "src/greet.ts",
        conteudo:
          'export function greet(name: string): string {\n  return `Ola, ${name}!`;\n}\n',
      }),
      toolTurn("finish", { relatorio_executor: VALID_REPORT_YAML }),
    ];
    let turnIdx = 0;

    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockImplementation(
      async (opts) => {
        const sys = opts.messages.map((m) => m.content).join("\n");
        if (sys.includes("Auditor Cego")) {
          return makeOkDispatch(EVALUATOR_PASS_JSON, "groq", "llama-3.3-70b");
        }
        if (turnIdx === 1) {
          const lastUserMsg = opts.messages[opts.messages.length - 1]?.content ?? "";
          if (lastUserMsg.includes("[SKILL TOOL DENIED]")) {
            receivedToolDenied = true;
          }
        }
        const reply =
          executorTurns[Math.min(turnIdx, executorTurns.length - 1)];
        turnIdx++;
        return makeOkDispatch(reply, "deepseek", "deepseek-chat");
      }
    );

    const res = await executeTaskNode(task);
    expect(res.success).toBe(true);
    expect(receivedToolDenied).toBe(true);

    const deniedLogs = await waitForTelemetryLogs(session.id, "SKILL_TOOL_DENIED");
    expect(deniedLogs.length).toBeGreaterThanOrEqual(1);
    expect(deniedLogs[0].details).toContain("[SKILL TOOL DENIED]");
  });

  it("e) passos_max estourado sem finish ⇒ falha da tentativa com [SKILL STEP LIMIT]", async () => {
    const projectDir = makeTempProjectDir();
    const { task } = await setupSingleTaskSession(projectDir);

    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockImplementation(
      async () => {
        return makeOkDispatch(
          toolTurn("list_files", { pasta: "src" }),
          "deepseek",
          "deepseek-chat"
        );
      }
    );

    const res = await executeTaskNode(task);
    expect(res.success).toBe(false);

    const updatedTask = await prisma.taskNode.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(updatedTask.attempts).toBe(1);
    expect(updatedTask.result).toContain("[SKILL STEP LIMIT]");
  });

  it("f) 3 turnos inválidos seguidos ⇒ falha da tentativa", async () => {
    const projectDir = makeTempProjectDir();
    const { task } = await setupSingleTaskSession(projectDir);

    let callCount = 0;
    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockImplementation(
      async () => {
        callCount++;
        return makeOkDispatch(
          "Resposta livre sem bloco json acao valido",
          "deepseek",
          "deepseek-chat"
        );
      }
    );

    const res = await executeTaskNode(task);
    expect(res.success).toBe(false);
    expect(callCount).toBe(3);

    const updatedTask = await prisma.taskNode.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(updatedTask.attempts).toBe(1);
    expect(updatedTask.result).toContain("3 turnos inválidos seguidos");
  });

  it("g) edit_file com trecho_antigo ausente e com 2 ocorrências ⇒ erro, arquivo inalterado", async () => {
    const projectDir = makeTempProjectDir();
    const { task } = await setupSingleTaskSession(projectDir);
    const initialContent =
      'export const prefix = "Ola";\nexport const suffix = "Ola";\n';
    fs.writeFileSync(
      path.join(projectDir, "src", "greet.ts"),
      initialContent,
      "utf-8"
    );

    vi.spyOn(TerminalExecutionEngine, "verifyProjectBuild").mockResolvedValue({
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      executionTimeMs: 1,
    });

    const toolFeedback: string[] = [];
    const executorTurns = [
      // 1) trecho_antigo ausente (0 ocorrencias)
      toolTurn("edit_file", {
        caminho: "src/greet.ts",
        trecho_antigo: "TRECHO_QUE_NAO_EXISTE",
        trecho_novo: "novo",
      }),
      // 2) trecho_antigo duplicado (2 ocorrencias de "Ola")
      toolTurn("edit_file", {
        caminho: "src/greet.ts",
        trecho_antigo: '"Ola"',
        trecho_novo: '"Oi"',
      }),
      // 3) leitura para confirmar que o arquivo permaneceu inalterado após os 2 erros
      toolTurn("read_file", {
        caminho: "src/greet.ts",
      }),
      // 4) edicao valida com 1 ocorrencia exata
      toolTurn("edit_file", {
        caminho: "src/greet.ts",
        trecho_antigo: 'export const suffix = "Ola";',
        trecho_novo:
          'export function greet(name: string): string {\n  return `${prefix}, ${name}!`;\n}',
      }),
      toolTurn("finish", { relatorio_executor: VALID_REPORT_YAML }),
    ];
    let turnIdx = 0;

    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockImplementation(
      async (opts) => {
        const sys = opts.messages.map((m) => m.content).join("\n");
        if (sys.includes("Auditor Cego")) {
          return makeOkDispatch(EVALUATOR_PASS_JSON, "groq", "llama-3.3-70b");
        }
        if (turnIdx > 0) {
          const lastUserMsg = opts.messages[opts.messages.length - 1]?.content ?? "";
          toolFeedback.push(lastUserMsg);
        }
        const reply =
          executorTurns[Math.min(turnIdx, executorTurns.length - 1)];
        turnIdx++;
        return makeOkDispatch(reply, "deepseek", "deepseek-chat");
      }
    );

    const res = await executeTaskNode(task);
    expect(res.success).toBe(true);
    expect(res.finalStatus).toBe("completed");

    // Feedback do turno 1 (0 ocorrencias)
    expect(toolFeedback[0]).toContain("0 vez(es)");
    // Feedback do turno 2 (2 ocorrencias)
    expect(toolFeedback[1]).toContain("2 vez(es)");
    // Feedback do turno 3 (read_file mostra arquivo inalterado)
    expect(toolFeedback[2]).toContain('export const prefix = "Ola";');
    expect(toolFeedback[2]).toContain('export const suffix = "Ola";');

    const finalFile = fs.readFileSync(
      path.join(projectDir, "src", "greet.ts"),
      "utf-8"
    );
    expect(finalFile).toContain("export function greet(name: string): string");
  });

  it("h) run_check devolve os erros do tsc e o modelo corrige no turno seguinte ⇒ completed", async () => {
    const projectDir = makeTempProjectDir();
    const { task } = await setupSingleTaskSession(projectDir);

    let buildCheckCount = 0;
    vi.spyOn(TerminalExecutionEngine, "verifyProjectBuild").mockImplementation(
      async () => {
        buildCheckCount++;
        if (buildCheckCount === 1) {
          return {
            success: false,
            exitCode: 2,
            stdout:
              "src/greet.ts(1,46): error TS2322: Type 'number' is not assignable to type 'string'.",
            stderr: "",
            executionTimeMs: 1,
          };
        }
        return {
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          executionTimeMs: 1,
        };
      }
    );

    let sawTscErrorInPrompt = false;
    const executorTurns = [
      toolTurn("write_file", {
        caminho: "src/greet.ts",
        conteudo: "export function greet(name: string): string { return 123 as any; }\n",
      }),
      toolTurn("run_check", { comando: "typecheck" }),
      toolTurn("write_file", {
        caminho: "src/greet.ts",
        conteudo:
          'export function greet(name: string): string {\n  return `Ola, ${name}!`;\n}\n',
      }),
      toolTurn("run_check", { comando: "typecheck" }),
      toolTurn("finish", { relatorio_executor: VALID_REPORT_YAML }),
    ];
    let turnIdx = 0;

    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockImplementation(
      async (opts) => {
        const sys = opts.messages.map((m) => m.content).join("\n");
        if (sys.includes("Auditor Cego")) {
          return makeOkDispatch(EVALUATOR_PASS_JSON, "groq", "llama-3.3-70b");
        }
        if (turnIdx === 2) {
          const lastUserMsg = opts.messages[opts.messages.length - 1]?.content ?? "";
          if (
            lastUserMsg.includes("[RESULTADO run_check]") &&
            lastUserMsg.includes("error TS2322")
          ) {
            sawTscErrorInPrompt = true;
          }
        }
        const reply =
          executorTurns[Math.min(turnIdx, executorTurns.length - 1)];
        turnIdx++;
        return makeOkDispatch(reply, "deepseek", "deepseek-chat");
      }
    );

    const res = await executeTaskNode(task);
    expect(res.success).toBe(true);
    expect(res.finalStatus).toBe("completed");
    expect(sawTscErrorInPrompt).toBe(true);
    expect(buildCheckCount).toBeGreaterThanOrEqual(2);
  });

  it("i) cada turno gera exatamente 1 LLM_COST", async () => {
    const projectDir = makeTempProjectDir();
    const { session, task } = await setupSingleTaskSession(projectDir);

    vi.spyOn(TerminalExecutionEngine, "verifyProjectBuild").mockResolvedValue({
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      executionTimeMs: 1,
    });

    const executorTurns = [
      toolTurn("list_files", { pasta: "src" }),
      toolTurn("write_file", {
        caminho: "src/greet.ts",
        conteudo:
          'export function greet(name: string): string {\n  return `Ola, ${name}!`;\n}\n',
      }),
      toolTurn("run_check", { comando: "typecheck" }),
      toolTurn("finish", { relatorio_executor: VALID_REPORT_YAML }),
    ];
    let turnIdx = 0;

    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockImplementation(
      async (opts) => {
        const sys = opts.messages.map((m) => m.content).join("\n");
        if (sys.includes("Auditor Cego")) {
          return makeOkDispatch(EVALUATOR_PASS_JSON, "groq", "llama-3.3-70b");
        }
        const reply =
          executorTurns[Math.min(turnIdx, executorTurns.length - 1)];
        turnIdx++;
        return makeOkDispatch(reply, "deepseek", "deepseek-chat");
      }
    );

    const res = await executeTaskNode(task);
    expect(res.success).toBe(true);
    expect(turnIdx).toBe(4);

    const costLogs = await prisma.telemetryLog.findMany({
      where: { sessionId: session.id, action: "LLM_COST" },
    });
    const executorCostLogs = costLogs.filter((log) => {
      const d = JSON.parse(log.details!);
      return d.papel === "executor";
    });
    expect(executorCostLogs).toHaveLength(4);
  });

  it('j) provedor "none" no meio do laço ⇒ sessão PAUSADA e attempts inalterado', async () => {
    const projectDir = makeTempProjectDir();
    const { session, task } = await setupSingleTaskSession(projectDir);

    let turnIdx = 0;
    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockImplementation(
      async () => {
        turnIdx++;
        if (turnIdx === 1) {
          return makeOkDispatch(
            toolTurn("list_files", { pasta: "src" }),
            "deepseek",
            "deepseek-chat"
          );
        }
        return makeExhaustedDispatch();
      }
    );

    await runOnce("worker-tool-loop-pause");

    const updatedSession = await prisma.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    const updatedTask = await prisma.taskNode.findUniqueOrThrow({
      where: { id: task.id },
    });

    expect(updatedSession.phase).toBe("PAUSADA");
    expect(updatedTask.attempts).toBe(0);
    expect(updatedTask.status).toBe("pending");
  });

  it("k) o lock do 2.4: dois run_check concorrentes no mesmo projeto rodam em série, e um promoteWithEmpiricalGate concorrente espera o lock", async () => {
    const projectDir = makeTempProjectDir();
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "lock-test", version: "1.0.0" }),
      "utf-8"
    );

    const qm = new QuarantineManager();
    const task1 = "lock-task-1";
    const task2 = "lock-task-2";
    const task3 = "lock-task-3";

    qm.prepareWorkspace(task1);
    qm.writeFile(task1, "src/a.ts", "export const a = 1;\n");
    qm.prepareWorkspace(task2);
    qm.writeFile(task2, "src/b.ts", "export const b = 2;\n");
    qm.prepareWorkspace(task3);
    qm.writeFile(task3, "src/c.ts", "export const c = 3;\n");

    let activeBuilds = 0;
    let maxConcurrentBuilds = 0;
    const timeline: string[] = [];

    vi.spyOn(TerminalExecutionEngine, "verifyProjectBuild").mockImplementation(
      async () => {
        activeBuilds++;
        if (activeBuilds > maxConcurrentBuilds) {
          maxConcurrentBuilds = activeBuilds;
        }
        const callNum = timeline.filter((e) => e.startsWith("enter-")).length + 1;
        timeline.push(`enter-${callNum}`);
        await new Promise((r) => setTimeout(r, 40));
        timeline.push(`exit-${callNum}`);
        activeBuilds--;
        return {
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          executionTimeMs: 1,
        };
      }
    );

    try {
      await Promise.all([
        defaultRunTypecheckInQuarantine({
          qm,
          taskId: task1,
          projectRoot: projectDir,
          allowedScopeFiles: ["src/a.ts"],
          quarantinedFiles: new Map([["src/a.ts", "export const a = 1;\n"]]),
        }),
        defaultRunTypecheckInQuarantine({
          qm,
          taskId: task2,
          projectRoot: projectDir,
          allowedScopeFiles: ["src/b.ts"],
          quarantinedFiles: new Map([["src/b.ts", "export const b = 2;\n"]]),
        }),
        promoteWithEmpiricalGate(qm, task3, projectDir, ["src/c.ts"]),
      ]);

      expect(maxConcurrentBuilds).toBe(1);
      expect(timeline).toEqual([
        "enter-1",
        "exit-1",
        "enter-2",
        "exit-2",
        "enter-3",
        "exit-3",
      ]);
      // run_check de task1 e task2 fizeram rollback; promoteWithEmpiricalGate de task3 promoveu src/c.ts
      expect(fs.existsSync(path.join(projectDir, "src", "a.ts"))).toBe(false);
      expect(fs.existsSync(path.join(projectDir, "src", "b.ts"))).toBe(false);
      expect(fs.existsSync(path.join(projectDir, "src", "c.ts"))).toBe(true);
    } finally {
      qm.purgeWorkspace(task1);
      qm.purgeWorkspace(task2);
      qm.purgeWorkspace(task3);
    }
  });

  it("parseExecutorToolAction a) formato oficial com quebra de linha → ok", () => {
    const res = parseExecutorToolAction(
      '```json acao\n{"ferramenta": "list_files", "args": {"pasta": "src"}}\n```'
    );
    expect(res).toEqual({
      ok: true,
      action: { ferramenta: "list_files", args: { pasta: "src" } },
    });
  });

  it('parseExecutorToolAction b) "```json acao{...}```" sem quebra → ok', () => {
    const res = parseExecutorToolAction(
      '```json acao{"ferramenta": "list_files", "args": {"pasta": "src"}}```'
    );
    expect(res).toEqual({
      ok: true,
      action: { ferramenta: "list_files", args: { pasta: "src" } },
    });
  });

  it('parseExecutorToolAction c) "```json\\n{...}```" sem "acao" → ok', () => {
    const res = parseExecutorToolAction(
      '```json\n{"ferramenta": "read_file", "args": {"caminho": "src/greet.ts"}}\n```'
    );
    expect(res).toEqual({
      ok: true,
      action: { ferramenta: "read_file", args: { caminho: "src/greet.ts" } },
    });
  });

  it("parseExecutorToolAction d) resposta que é só o objeto JSON → ok", () => {
    const res = parseExecutorToolAction(
      '  {"ferramenta": "run_check", "args": {"comando": "typecheck"}}  '
    );
    expect(res).toEqual({
      ok: true,
      action: { ferramenta: "run_check", args: { comando: "typecheck" } },
    });
  });

  it("parseExecutorToolAction e) dois blocos válidos → erro", () => {
    const res1 = parseExecutorToolAction(
      '```json acao\n{"ferramenta": "list_files", "args": {"pasta": "src"}}\n```\n```json acao\n{"ferramenta": "read_file", "args": {"caminho": "src/a.ts"}}\n```'
    );
    expect(res1.ok).toBe(false);
    if (!res1.ok) {
      expect(res1.error).toContain("```json acao");
    }

    const res2 = parseExecutorToolAction(
      '```json\n{"ferramenta": "list_files", "args": {"pasta": "src"}}\n```\n```json\n{"ferramenta": "read_file", "args": {"caminho": "src/a.ts"}}\n```'
    );
    expect(res2.ok).toBe(false);
    if (!res2.ok) {
      expect(res2.error).toContain("```json acao");
    }
  });

  it("parseExecutorToolAction f) prosa sem JSON → erro", () => {
    const res = parseExecutorToolAction(
      "Vou primeiro verificar os arquivos existentes no diretório src."
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("```json acao");
    }
  });

  it('parseExecutorToolAction g) bloco ```json com objeto SEM "ferramenta" (ex.: o relatorio_executor) → erro', () => {
    const res = parseExecutorToolAction(
      '```json\n{"reqs": [{"id": "REQ-001", "status": "atendido", "arquivo_linha": "src/a.ts:1-2", "como": "ok"}]}\n```'
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("```json acao");
    }
  });

  it("turno inválido registra a amostra com no máximo 300 caracteres e o tamanho total em EXECUTOR_TOOL_CALL", async () => {
    const projectDir = makeTempProjectDir();
    const { session, task } = await setupSingleTaskSession(projectDir);

    const longInvalidResponse = "PROSA_SEM_JSON_".repeat(30); // 450 caracteres
    expect(longInvalidResponse.length).toBe(450);

    vi.spyOn(SmartRouter.prototype, "dispatchWithFallback").mockImplementation(
      async () => {
        return makeOkDispatch(longInvalidResponse, "freellmapi", "dots-3-note-preview:free");
      }
    );

    const res = await executeTaskNode(task);
    expect(res.success).toBe(false);

    const toolLogs = await waitForTelemetryLogs(session.id, "EXECUTOR_TOOL_CALL");
    const invalidLogs = toolLogs
      .map((l) => JSON.parse(l.details!))
      .filter((d) => d.ferramenta === "invalido");

    expect(invalidLogs.length).toBe(3);
    expect(invalidLogs[0].amostra).toHaveLength(300);
    expect(invalidLogs[0].amostra).toBe(longInvalidResponse.slice(0, 300));
    expect(invalidLogs[0].tamanho).toBe(450);
  });
});
