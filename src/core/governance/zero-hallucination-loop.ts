/**
 * Zero Hallucination Engine (NextCode v5)
 * Inspirado nas melhores práticas de Harness de IAs de Engenharia (DeepSeek Harness, SWE-bench, Devin).
 * Garante que a IA NUNCA afirme ter corrigido ou atualizado um arquivo a menos que o patch
 * tenha sido validado por um compilador/auditor determinístico de 0 erros.
 */

import { QuarantineManager } from "./quarantine-manager";
import { DualLensAuditor, ValidationType1Result, ValidationType2Result, LLMDispatchFn } from "./dual-lens-auditor";
import { EnvironmentWorkspaceAdapter, WorkspaceWriteResult } from "../execution/environment-adapter";
import { CommandResult } from "../execution/terminal-execution-engine";
import { extractFilePathsFromText } from "../skills/spec-decomposer";
import { stripErrorLogLines } from "../intake/input-preprocessor";
import { TelemetryLogger } from "../telemetry/telemetry-logger";
import { buildErrorSignature } from "../telemetry/error-signature";
import { SkillMiner } from "../telemetry/skill-miner";
import { promoteWithEmpiricalGate, firstBuildErrorLine } from "./empirical-gate";

/** Minera telemetria em plano de fundo (retrabalho recorrente -> proposta de skill; erro
 * recorrente do próprio NextCode -> proposta de bug_pattern). Nunca bloqueia a resposta ao
 * usuário: falhas aqui são só logadas no console. */
function mineTelemetryInBackground(): void {
  SkillMiner.analyzeAndPropose().catch((err) => console.error("[SkillMiner] analyzeAndPropose falhou:", err));
  SkillMiner.detectRecurringBugs().catch((err) => console.error("[SkillMiner] detectRecurringBugs falhou:", err));
}

export interface ZeroHallucinationExecutionResult {
  passed: boolean;
  promotedFiles: string[];
  auditorResult: ValidationType1Result;
  type2Result?: ValidationType2Result;
  groundedMessage: string;
  workspaceResult?: WorkspaceWriteResult;
  empiricalBuildResult?: CommandResult | null;
}

/** Monta um bloco curto (não um dump) com o resultado real do type-check pós-promoção. */
function formatEmpiricalBuildBadge(result: CommandResult): string {
  if (result.success) {
    return "\n\n🔧 _Verificação empírica adicional (type-check real do projeto): ✅ sem erros._";
  }
  const errorLines = `${result.stdout}\n${result.stderr}`
    .split("\n")
    .filter((l) => l.includes("error TS"))
    .slice(0, 5);
  return `\n\n⚠️ **Verificação empírica adicional (type-check real do projeto) encontrou problemas após a promoção:**\n${
    errorLines.length > 0
      ? errorLines.map((l) => `- ❌ ${l.trim()}`).join("\n")
      : "- ❌ Comando de type-check falhou (ver logs do servidor)."
  }`;
}

/** Monta um Brief mínimo a partir do pedido bruto do usuário no chat — o pipeline de chat não tem a decomposição rica em Goal/Context que o DAG gera via SpecDecomposerSkill, então o próprio prompt serve de proxy para a Lente 1 (Cega) comparar contra o código real gerado. */
function buildChatBriefMarkdown(userPrompt: string): string {
  return `# Pedido original do usuário (chat)\n\n${userPrompt.slice(0, 4000)}`;
}

/**
 * Remove os blocos de código ```...``` do texto exibido no chat. O conteúdo já foi
 * extraído e gravado em disco pelo QuarantineManager — repeti-lo na conversa só poluía
 * a resposta com centenas de linhas que o usuário não precisa ler para saber o que mudou.
 */
function stripCodeBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export class ZeroHallucinationEngine {
  /**
   * Valida, executa e ancora (grounding) a resposta da IA com prova empírica de compilação antes de entregar ao usuário.
   */
  public static async processAndVerifyResponse(
    taskId: string,
    rawAiResponse: string,
    userPrompt: string,
    projectPath: string | null,
    dispatchFn?: LLMDispatchFn
  ): Promise<ZeroHallucinationExecutionResult> {
    let cleanResponse = rawAiResponse;

    if (!rawAiResponse.includes("```")) {
      return {
        passed: true,
        promotedFiles: [],
        auditorResult: {
          passed: true,
          compilationErrors: [],
          securityViolations: [],
          testFailures: [],
        },
        groundedMessage: cleanResponse,
      };
    }

    const qm = new QuarantineManager();
    // Nunca deriva nomes de arquivo de linhas com cara de stacktrace/log colado pelo
    // usuário — só do texto "limpo" do pedido (ver stripErrorLogLines).
    const promptFiles = extractFilePathsFromText(stripErrorLogLines(userPrompt));
    const codeMap = qm.extractAndWriteCodeBlocks(taskId, rawAiResponse, promptFiles);

    if (Object.keys(codeMap).length === 0) {
      qm.purgeWorkspace(taskId);
      return {
        passed: true,
        promotedFiles: [],
        auditorResult: {
          passed: true,
          compilationErrors: [],
          securityViolations: [],
          testFailures: [],
        },
        groundedMessage: cleanResponse,
      };
    }

    // 1. Executa a Auditoria Mecânica / Determinística Tipo 1
    const type1Res = DualLensAuditor.validateType1(codeMap, [], projectPath || undefined, undefined, qm.extractionIssues);

    // 2. Se a validação FALHAR: Invalida a alegação da IA e exibe o erro real de compilação (Grounding Enforcement)
    if (!type1Res.passed) {
      qm.purgeWorkspace(taskId);
      const allErrors = [
        ...type1Res.compilationErrors,
        ...type1Res.securityViolations,
        ...type1Res.testFailures,
      ];

      // Descarta inteiramente a prosa da IA: ela está relatando uma alteração que foi
      // rejeitada, então suas alegações de sucesso não são confiáveis. O usuário recebe
      // apenas o relatório determinístico do que falhou e por quê (sem o dump de código).
      const groundedMessage = `⚠️ **[NextCode Anti-Hallucination Guard]** Falha na verificação de sintaxe/compilação — nada foi promovido para o disco:\n\n${allErrors.map((e) => `- ❌ ${e}`).join("\n")}`;

      TelemetryLogger.log({
        sessionId: taskId,
        action: "AUDIT_REJECTED",
        details: {
          errorSignature: buildErrorSignature("type1", allErrors[0] || "erro desconhecido"),
          sample: allErrors.slice(0, 3).join(" | "),
        },
      });
      mineTelemetryInBackground();

      return {
        passed: false,
        promotedFiles: [],
        auditorResult: type1Res,
        groundedMessage,
      };
    }

    // 3. Validador Tipo 2 (Semântico / Auditor Cego): só promove se a Lente Cega confirmar,
    // lendo o Brief real (proxy = prompt do usuário) e o código gerado — a mesma trava que
    // o DAG já aplica. Sem isso, o chat promovia para o disco só com base na checagem
    // mecânica do Tipo 1, o que foi exatamente a falha que permitiu o caso gatewaynovo.
    const type2Res = await DualLensAuditor.validateType2(
      type1Res,
      buildChatBriefMarkdown(userPrompt),
      rawAiResponse,
      codeMap,
      dispatchFn
    );

    // Sinal de telemetria (não afeta o verdict, que já é decidido só pela Lente Cega):
    // a IA alegou um resultado (sucesso/falha) desalinhado com a leitura real do código.
    // Divergência recorrente do mesmo worker/modelo é o próprio padrão de alucinação que
    // esta trava existe para flagar, mesmo quando o código final acaba aprovado.
    if (type2Res.divergenceDetected) {
      TelemetryLogger.log({
        sessionId: taskId,
        action: "WORKER_SELF_REPORT_DIVERGENCE",
        details: {
          errorSignature: buildErrorSignature("divergence", `verdict=${type2Res.verdict}`),
          sample: type2Res.lens2CrossVerification,
        },
      });
    }

    if (type2Res.verdict !== "APPROVED") {
      qm.purgeWorkspace(taskId);
      const groundedMessage = `⚠️ **[NextCode Anti-Hallucination Guard]** Auditoria semântica (Tipo 2) reprovou a alteração — nada foi promovido para o disco:\n\n${
        type2Res.rejectionReason || "Divergência entre o código gerado e o pedido original."
      }\n\n${type2Res.lens1BlindReport}\n\n${type2Res.lens2CrossVerification}`;

      TelemetryLogger.log({
        sessionId: taskId,
        action: "AUDIT_REJECTED",
        details: {
          errorSignature: buildErrorSignature("type2", type2Res.rejectionReason || "divergência semântica"),
          sample: type2Res.rejectionReason || "",
        },
      });
      mineTelemetryInBackground();

      return {
        passed: false,
        promotedFiles: [],
        auditorResult: type1Res,
        type2Result: type2Res,
        groundedMessage,
      };
    }

    // 4. Se as duas validações PASSAREM: Promove fisicamente e anexa o selo de verificação empírica
    const promotedFiles = Object.keys(codeMap);
    const envAdapter = new EnvironmentWorkspaceAdapter({
      taskId,
      projectPath: projectPath || "",
    });

    // Checklist curto por arquivo em vez de repetir o conteúdo gerado na conversa —
    // o código já está no disco; o chat só precisa confirmar o que foi feito.
    const checklist = promotedFiles.map((f) => `- ✅ \`${f}\``).join("\n");

    let executionBadge = "";
    let empiricalBuildResult: CommandResult | null = null;
    let empiricalPassed = true;
    let workspaceResult: WorkspaceWriteResult;
    if (envAdapter.getMode() === "LOCAL" && projectPath) {
      // Trava T4: em modo local a ÚNICA escrita no projeto é a promoção da quarentena (o
      // conteúdo auditado). Antes o adapter gravava o texto bruto no projeto antes da
      // promoção, e a prova empírica só reportava a falha — o código quebrado ficava no disco.
      // Agora a promoção é desfeita quando o type-check real acusa erros novos.
      const gate = await promoteWithEmpiricalGate(qm, taskId, projectPath, promotedFiles);
      empiricalBuildResult = gate.buildResult;
      empiricalPassed = gate.passed;
      workspaceResult = {
        mode: "LOCAL",
        writtenFiles: gate.rolledBack ? [] : promotedFiles,
        targetPath: projectPath,
      };

      if (gate.rolledBack) {
        executionBadge = `⚠️ **[NextCode Anti-Hallucination Guard] (Modo Local)** — o type-check real do projeto reprovou a alteração e a promoção foi DESFEITA; nenhum dos ${promotedFiles.length} arquivo(s) permaneceu no disco.`;
      } else {
        executionBadge = `⚡ **[NextCode Anti-Hallucination Guard] (0 Erros - Modo Local)** — ${promotedFiles.length} arquivo(s) validado(s) e salvo(s) no disco:\n${checklist}`;
      }
      if (empiricalBuildResult) {
        executionBadge += formatEmpiricalBuildBadge(empiricalBuildResult);
        if (gate.preexistingFailure) {
          executionBadge += `\n\nℹ️ _Os erros acima já existiam no projeto antes desta alteração — ela não introduziu nenhum erro novo._`;
        }
        if (!gate.passed) {
          const firstErrorLine = firstBuildErrorLine(empiricalBuildResult, gate.newErrors);
          TelemetryLogger.log({
            sessionId: taskId,
            action: "EMPIRICAL_BUILD_FAILED",
            details: {
              errorSignature: buildErrorSignature("build", firstErrorLine),
              sample: firstErrorLine,
              rolledBack: gate.rolledBack,
            },
          });
        }
      }
    } else {
      workspaceResult = envAdapter.writeFilesToWorkspace(codeMap);
      executionBadge = `☁️ **[NextCode Anti-Hallucination Guard] (0 Erros - Modo Nuvem / Quarentena)** — ${promotedFiles.length} arquivo(s) validado(s) e salvo(s) no workspace isolado:\n${checklist}`;
    }

    const strippedProse = stripCodeBlocks(cleanResponse);
    mineTelemetryInBackground();

    // Item (B): a verificação empírica (type-check real pós-promoção) afeta o veredito final —
    // o loop de auto-healing no chat/route.ts vê o build quebrado como motivo de retry.
    return {
      passed: empiricalPassed,
      promotedFiles,
      auditorResult: type1Res,
      type2Result: type2Res,
      groundedMessage: `${strippedProse ? `${strippedProse}\n\n` : ""}${executionBadge}`,
      workspaceResult,
      empiricalBuildResult,
    };
  }
}
