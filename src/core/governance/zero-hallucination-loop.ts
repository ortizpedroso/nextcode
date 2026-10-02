/**
 * Zero Hallucination Engine (NextCode v5)
 * Inspirado nas melhores práticas de Harness de IAs de Engenharia (DeepSeek Harness, SWE-bench, Devin).
 * Garante que a IA NUNCA afirme ter corrigido ou atualizado um arquivo a menos que o patch
 * tenha sido validado por um compilador/auditor determinístico de 0 erros.
 */

import { QuarantineManager } from "./quarantine-manager";
import { DualLensAuditor, ValidationType1Result } from "./dual-lens-auditor";
import { EnvironmentWorkspaceAdapter, WorkspaceWriteResult } from "../execution/environment-adapter";
import { extractFilePathsFromText } from "../skills/spec-decomposer";

export interface ZeroHallucinationExecutionResult {
  passed: boolean;
  promotedFiles: string[];
  auditorResult: ValidationType1Result;
  groundedMessage: string;
  workspaceResult?: WorkspaceWriteResult;
}

export class ZeroHallucinationEngine {
  /**
   * Valida, executa e ancora (grounding) a resposta da IA com prova empírica de compilação antes de entregar ao usuário.
   */
  public static processAndVerifyResponse(
    taskId: string,
    rawAiResponse: string,
    userPrompt: string,
    projectPath: string | null
  ): ZeroHallucinationExecutionResult {
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
    const promptFiles = extractFilePathsFromText(userPrompt);
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
    const type1Res = DualLensAuditor.validateType1(codeMap, [], projectPath || undefined);

    // 2. Se a validação FALHAR: Invalida a alegação da IA e exibe o erro real de compilação (Grounding Enforcement)
    if (!type1Res.passed) {
      qm.purgeWorkspace(taskId);
      const allErrors = [
        ...type1Res.compilationErrors,
        ...type1Res.securityViolations,
        ...type1Res.testFailures,
      ];

      // Remove frases triunfantes alucinadas da IA (ex: "Corrigi com sucesso") e substitui por aviso real
      const sanitizedAiText = cleanResponse
        .replace(/^(?:Corrigi|Corrigido|Sucesso|Apliquei|Atualizei|Resolvi|O arquivo|O erro)[\s\S]*?(?=```)/gi, "")
        .trim();

      const groundedMessage = `${sanitizedAiText ? `${sanitizedAiText}\n\n` : ""}⚠️ **[NextCode Anti-Hallucination Guard]** O patch proposto pela IA falhou na verificação de sintaxe/compilação e **NÃO** foi promovido para o disco:\n\n${allErrors.map((e) => `- \`${e}\``).join("\n")}`;

      return {
        passed: false,
        promotedFiles: [],
        auditorResult: type1Res,
        groundedMessage,
      };
    }

    // 3. Se a validação PASSSAR: Promove fisicamente e anexa o selo de verificação empírica
    const promotedFiles = Object.keys(codeMap);
    const envAdapter = new EnvironmentWorkspaceAdapter({
      taskId,
      projectPath: projectPath || "",
    });

    const workspaceResult = envAdapter.writeFilesToWorkspace(codeMap);

    let executionBadge = "";
    if (workspaceResult.mode === "LOCAL" && projectPath) {
      qm.promoteToMainRepo(taskId, projectPath, promotedFiles);
      executionBadge = `\n\n⚡ **[NextCode Anti-Hallucination Guard] (0 Erros - Modo Local)** ${promotedFiles.length} arquivo(s) auditado(s), validados e salvos no disco em \`${projectPath}\`: ${promotedFiles.map((f) => `\`${f}\``).join(", ")}`;
    } else {
      executionBadge = `\n\n☁️ **[NextCode Anti-Hallucination Guard] (0 Erros - Modo Nuvem / Quarentena)** ${promotedFiles.length} arquivo(s) auditado(s) e salvos no workspace isolado: ${promotedFiles.map((f) => `\`${f}\``).join(", ")}`;
    }

    return {
      passed: true,
      promotedFiles,
      auditorResult: type1Res,
      groundedMessage: `${cleanResponse}${executionBadge}`,
      workspaceResult,
    };
  }
}
