import { describe, it, expect } from "vitest";
import {
  loadOrchestrationPolicy,
  resolveExecutorTierForAttempt,
  isEvaluatorModelIndependent,
  resolveVerdictAction,
  evaluateProjectBudget,
} from "@/core/config/orchestration-policy";
import {
  loadRoleSkill,
  enforceSkillToolPermission,
  buildSkillSystemPrompt,
} from "@/core/skills/skill-runtime";

describe("Políticas de Orquestração (config/politicas-orquestracao.yaml) e Runtime de Skills", () => {
  it("carrega config/politicas-orquestracao.yaml com as decisões aprovadas pelo fundador", () => {
    const policy = loadOrchestrationPolicy();

    expect(policy.versaoPolitica).toBe("1.0.0");
    // 1. Avaliador em FreeLLMAPI (auto:smart), diferente do DeepSeek
    expect(policy.niveisModelo.avaliadorForte.gateway).toBe("freellmapi");
    expect(policy.niveisModelo.avaliadorForte.modelo).toBe("auto:smart");
    expect(policy.niveisModelo.avaliadorForte.familiaProibidaSeExecutorDeepseek).toBe("deepseek");

    // 2. Teto de custo por projeto = US$ 0.50 (alerta em 80% = US$ 0.40)
    expect(policy.orcamento.tetoCustoPorProjetoUsd).toBe(0.5);
    expect(policy.orcamento.alertaCustoUsd).toBe(0.4);
    expect(policy.orcamento.alertaPercentualTeto).toBe(80);

    // 3. APROVADO_COM_RESSALVA executa 1 rodada rápida de polimento se houver tentativa
    expect(policy.tentativas.acaoAprovadoComRessalva).toBe(
      "polir_1_rodada_se_houver_tentativa_senao_promover"
    );
    expect(policy.tentativas.maxRodadasPolimentoRessalva).toBe(1);
    expect(policy.tentativas.maxTentativasPorExecutor).toBe(3);
    expect(policy.tentativas.maxReenviosSoRelatorio).toBe(2);
    expect(policy.tentativas.reenvioRelatorioContaComoTentativa).toBe(false);
    expect(policy.tentativas.falhaProvedorContaComoTentativa).toBe(false);
    expect(policy.execucaoParalela.paralelismoMaximo).toBe(3);
  });

  it("aplica a regra de APROVADO_COM_RESSALVA (1 rodada de polimento se houver tentativa; senão promove)", () => {
    // Tentativa 1 (< 3) e 0 rodadas de polimento usadas -> polir 1 rodada sem gastar tentativa de falha
    const r1 = resolveVerdictAction({
      decisao: "APROVADO_COM_RESSALVA",
      attemptNumber: 1,
      maxAttempts: 3,
      polishRoundsUsed: 0,
    });
    expect(r1).toEqual({ action: "polir_uma_rodada", consumesAttempt: false });

    // Já usou a rodada de polimento (polishRoundsUsed = 1) -> promove com ressalvas
    const r2 = resolveVerdictAction({
      decisao: "APROVADO_COM_RESSALVA",
      attemptNumber: 1,
      maxAttempts: 3,
      polishRoundsUsed: 1,
    });
    expect(r2).toEqual({ action: "promover_com_ressalvas", consumesAttempt: false });

    // Na última tentativa (attemptNumber = 3) -> promove imediatamente com ressalvas sem arriscar bloqueio
    const r3 = resolveVerdictAction({
      decisao: "APROVADO_COM_RESSALVA",
      attemptNumber: 3,
      maxAttempts: 3,
      polishRoundsUsed: 0,
    });
    expect(r3).toEqual({ action: "promover_com_ressalvas", consumesAttempt: false });

    // REPROVADO consome tentativa e bloqueia na 3ª
    expect(
      resolveVerdictAction({ decisao: "REPROVADO", attemptNumber: 2, maxAttempts: 3 })
    ).toEqual({ action: "retentar_executor", consumesAttempt: true });
    expect(
      resolveVerdictAction({ decisao: "REPROVADO", attemptNumber: 3, maxAttempts: 3 })
    ).toEqual({ action: "bloquear_escalar_humano", consumesAttempt: true });
  });

  it("escala o nível de modelo do Executor entre as 3 tentativas (padrão Superpowers)", () => {
    expect(resolveExecutorTierForAttempt("rapido", 1)).toBe("rapido");
    expect(resolveExecutorTierForAttempt("rapido", 2)).toBe("medio");
    expect(resolveExecutorTierForAttempt("rapido", 3)).toBe("pesado");
    expect(resolveExecutorTierForAttempt("medio", 2)).toBe("pesado");
  });

  it("valida independência de família de modelo entre Executor e Avaliador (Trava T4)", () => {
    expect(isEvaluatorModelIndependent("deepseek/deepseek-v4-pro", "deepseek/deepseek-chat")).toBe(
      false
    );
    expect(isEvaluatorModelIndependent("deepseek/deepseek-v4-pro", "freellmapi/auto:smart")).toBe(
      true
    );
    expect(
      isEvaluatorModelIndependent("deepseek/deepseek-v4-pro", "anthropic/claude-sonnet-4-20250514")
    ).toBe(true);
    expect(isEvaluatorModelIndependent("deepseek/deepseek-v4-pro", "google/gemini-2.5-pro")).toBe(
      true
    );
  });

  it("monitora orçamento do projeto com alerta em 80% (US$ 0.40) e pausa em US$ 0.50 (Trava T8)", () => {
    expect(evaluateProjectBudget(0.12).status).toBe("ok");
    expect(evaluateProjectBudget(0.41).status).toBe("alerta_80_porcento");
    expect(evaluateProjectBudget(0.5).status).toBe("teto_excedido_pausar");
  });

  it("carrega todas as skills de papéis (avaliadores, executores, analista, elicitador) e referências locais", () => {
    const skillNames = [
      "avaliador",
      "avaliador-core",
      "avaliador-backend",
      "avaliador-frontend",
      "avaliador-integration",
      "executor-core",
      "executor-backend",
      "executor-frontend",
      "executor-integration",
      "analista",
      "elicitador",
    ];

    for (const name of skillNames) {
      const skill = loadRoleSkill(name);
      expect(skill.name).toBe(name);
      expect(skill.ferramentas.length).toBeGreaterThan(0);
    }

    const evalFront = loadRoleSkill("avaliador-frontend");
    expect(evalFront.papel).toBe("avaliador");
    expect(evalFront.cluster).toBe("frontend");
    expect(evalFront.modeloDiferenteDoExecutor).toBe(true);
    expect(evalFront.permissoes.escrever).toBe("nunca");
    expect(evalFront.permissoes.redeExternaBloqueada).toBe(true);
    expect(evalFront.inheritedBodyMarkdown).toContain("Lente 1");
    expect(
      evalFront.resolvedReferencesContent[
        "skills/avaliador-frontend/references/web-interface-guidelines-command.md"
      ]
    ).toContain("Anti-patterns");

    const promptDashboard = buildSkillSystemPrompt(evalFront, {
      includeLocalReferences: true,
      includeTasteSkillPublic: false,
    });
    expect(promptDashboard).toContain("React Best Practices");
    expect(promptDashboard).not.toContain("Taste-Skill — Extrato de Pré-Voo");
  });

  it("aplica mecanicamente as permissões de escrita, escopo e passos máximos das skills", () => {
    const avaliador = loadRoleSkill("avaliador");
    const executorBackend = loadRoleSkill("executor-backend");

    // Avaliador nunca pode escrever
    const denyEvalWrite = enforceSkillToolPermission({
      skill: avaliador,
      toolName: "read_file",
      currentStep: 1,
    });
    expect(denyEvalWrite.allowed).toBe(true);

    const denyEvalEdit = enforceSkillToolPermission({
      skill: avaliador,
      toolName: "write_file",
      targetFile: "src/app/api/tarefas/route.ts",
      currentStep: 1,
    });
    expect(denyEvalEdit.allowed).toBe(false);

    // Executor só pode escrever dentro do escopo do Microbrief e nunca em prisma/dev.db ou .env
    const allowInScope = enforceSkillToolPermission({
      skill: executorBackend,
      toolName: "write_file",
      targetFile: "src/app/api/tarefas/route.ts",
      allowedScopeFiles: ["src/app/api/tarefas/route.ts"],
      currentStep: 3,
    });
    expect(allowInScope.allowed).toBe(true);

    const denyOutOfScope = enforceSkillToolPermission({
      skill: executorBackend,
      toolName: "write_file",
      targetFile: "src/lib/outro-arquivo.ts",
      allowedScopeFiles: ["src/app/api/tarefas/route.ts"],
      currentStep: 3,
    });
    expect(denyOutOfScope.allowed).toBe(false);
    expect(denyOutOfScope.violationReason).toContain("[SKILL SCOPE VIOLATION]");

    const denyProtectedDb = enforceSkillToolPermission({
      skill: executorBackend,
      toolName: "write_file",
      targetFile: "prisma/dev.db",
      allowedScopeFiles: ["prisma/dev.db"],
      currentStep: 3,
    });
    expect(denyProtectedDb.allowed).toBe(false);
    expect(denyProtectedDb.violationReason).toContain("[SKILL PROTECTED PATH]");

    const denyMaxSteps = enforceSkillToolPermission({
      skill: executorBackend,
      toolName: "read_file",
      currentStep: executorBackend.passosMax + 1,
    });
    expect(denyMaxSteps.allowed).toBe(false);
    expect(denyMaxSteps.violationReason).toContain("[SKILL STEP LIMIT]");
  });
});
