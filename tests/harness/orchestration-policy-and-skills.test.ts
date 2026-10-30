import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect } from "vitest";
import {
  DEFAULT_ORCHESTRATION_POLICY,
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

  it("A1.0: sem config/politicas-orquestracao.yaml, usa o padrão do código (DEFAULT_ORCHESTRATION_POLICY) e não lê docs/rascunhos/", () => {
    const tmpEmpty = fs.mkdtempSync(path.join(os.tmpdir(), "nc-policy-empty-"));
    try {
      // Cria docs/rascunhos/politicas-orquestracao.yaml fake com valor diferente
      const fakeDocsDir = path.join(tmpEmpty, "docs", "rascunhos");
      fs.mkdirSync(fakeDocsDir, { recursive: true });
      fs.writeFileSync(
        path.join(fakeDocsDir, "politicas-orquestracao.yaml"),
        'versao_politica: "9.9.9-obsoleta"\n',
        "utf8"
      );

      // Sem config/, deve retornar DEFAULT_ORCHESTRATION_POLICY e ignorar docs/rascunhos
      const policy = loadOrchestrationPolicy(tmpEmpty);
      expect(policy.versaoPolitica).toBe(DEFAULT_ORCHESTRATION_POLICY.versaoPolitica);
      expect(policy.versaoPolitica).not.toBe("9.9.9-obsoleta");
      expect(policy).toEqual(DEFAULT_ORCHESTRATION_POLICY);
    } finally {
      fs.rmSync(tmpEmpty, { recursive: true, force: true });
    }
  });

  it("10.1: lê o bloco jev_execucao do arquivo e aplica os padrões exatos quando chaves estão ausentes", () => {
    const confEnv = process.env.NEXTCODE_CONFERENCIA_ENTRADA;
    delete process.env.NEXTCODE_CONFERENCIA_ENTRADA;
    const policy = loadOrchestrationPolicy();
    if (confEnv === undefined) delete process.env.NEXTCODE_CONFERENCIA_ENTRADA;
    else process.env.NEXTCODE_CONFERENCIA_ENTRADA = confEnv;
    expect(policy.jevExecucao).toEqual({
      diagnosticoFalha: "ativo",
      bloqueioSpecAmbigua: "ativo",
      roteamentoFalha: "sombra",
      // JV1 (mudança 44): desligados com medição na trilha real do Gateway.
      verificacaoEvidencia: "desligado",
      auditoriaEntrega: "desligado",
      triagemEntrega: "sombra",
      conferenciaEntrada: "sombra",
      guardaSegredosCodigo: "ativo",
      guardaSegredosChat: "ativo",
      guardaInstalacaoSkill: "ativo",
      limiarConfiancaDiagnostico: 0.8,
      limiarEvidenciaContradiz: 0.8,
      limiarSegredoNoul: 0.7,
      limiarRiscoSkillNoul: 0.7,
    });

    // Chave ausente em arquivo YAML parcial → devolve os padrões exatos acima
    const tmpRootMissing = fs.mkdtempSync(path.join(os.tmpdir(), "nc-policy-missing-"));
    try {
      fs.mkdirSync(path.join(tmpRootMissing, "config"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpRootMissing, "config", "politicas-orquestracao.yaml"),
        'versao_politica: "1.0.0"\nexecucao:\n  modo_executor: laco\n',
        "utf8"
      );
      const fallbackPolicy = loadOrchestrationPolicy(tmpRootMissing);
      expect(fallbackPolicy.jevExecucao).toEqual({
        diagnosticoFalha: "ativo",
        bloqueioSpecAmbigua: "ativo",
        roteamentoFalha: "sombra",
        verificacaoEvidencia: "sombra",
        auditoriaEntrega: "sombra",
        triagemEntrega: "desligado",
        conferenciaEntrada: "desligado",
        guardaSegredosCodigo: "ativo",
        guardaSegredosChat: "ativo",
        guardaInstalacaoSkill: "ativo",
        limiarConfiancaDiagnostico: 0.8,
        limiarEvidenciaContradiz: 0.8,
        limiarSegredoNoul: 0.7,
        limiarRiscoSkillNoul: 0.7,
      });
    } finally {
      fs.rmSync(tmpRootMissing, { recursive: true, force: true });
    }

    // Valores explícitos no arquivo são lidos
    const tmpRootCustom = fs.mkdtempSync(path.join(os.tmpdir(), "nc-policy-custom-"));
    try {
      fs.mkdirSync(path.join(tmpRootCustom, "config"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpRootCustom, "config", "politicas-orquestracao.yaml"),
        [
          "jev_execucao:",
          "  diagnostico_falha: desligado",
          "  bloqueio_spec_ambigua: ativo",
          "  verificacao_evidencia: desligado",
          "  auditoria_entrega: desligado",
          "  guarda_segredos_codigo: desligado",
          "  guarda_segredos_chat: desligado",
          "  guarda_instalacao_skill: desligado",
          "  limiar_confianca_diagnostico: 0.85",
          "  limiar_evidencia_contradiz: 0.90",
          "  limiar_segredo_noul: 0.75",
          "  limiar_risco_skill_noul: 0.65",
        ].join("\n"),
        "utf8"
      );
      const customPolicy = loadOrchestrationPolicy(tmpRootCustom);
      expect(customPolicy.jevExecucao).toEqual({
        diagnosticoFalha: "desligado",
        bloqueioSpecAmbigua: "ativo",
        roteamentoFalha: "sombra",
        verificacaoEvidencia: "desligado",
        auditoriaEntrega: "desligado",
        triagemEntrega: "desligado",
        conferenciaEntrada: "desligado",
        guardaSegredosCodigo: "desligado",
        guardaSegredosChat: "desligado",
        guardaInstalacaoSkill: "desligado",
        limiarConfiancaDiagnostico: 0.85,
        limiarEvidenciaContradiz: 0.9,
        limiarSegredoNoul: 0.75,
        limiarRiscoSkillNoul: 0.65,
      });
    } finally {
      fs.rmSync(tmpRootCustom, { recursive: true, force: true });
    }
  });

  it("R1.1: lê roteamento_papeis_criticos do YAML e usa os padrões quando as chaves faltam", () => {
    const policy = loadOrchestrationPolicy();
    expect(policy.roteamentoPapeisCriticos).toMatchObject({
      somentePago: true,
      modeloPagoBarato: "deepseek-flash",
      confiancaMinimaModeloBarato: 0.85,
    });

    const tmpRootMissing = fs.mkdtempSync(path.join(os.tmpdir(), "nc-policy-r1-missing-"));
    try {
      fs.mkdirSync(path.join(tmpRootMissing, "config"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpRootMissing, "config", "politicas-orquestracao.yaml"),
        'versao_politica: "1.0.0"\n',
        "utf8"
      );
      const fallbackPolicy = loadOrchestrationPolicy(tmpRootMissing);
      expect(fallbackPolicy.roteamentoPapeisCriticos).toMatchObject({
        somentePago: true,
        modeloPagoBarato: "deepseek-flash",
        confiancaMinimaModeloBarato: 0.85,
      });
    } finally {
      fs.rmSync(tmpRootMissing, { recursive: true, force: true });
    }

    const tmpRootCustom = fs.mkdtempSync(path.join(os.tmpdir(), "nc-policy-r1-custom-"));
    try {
      fs.mkdirSync(path.join(tmpRootCustom, "config"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpRootCustom, "config", "politicas-orquestracao.yaml"),
        [
          "roteamento_papeis_criticos:",
          "  somente_pago: false",
          '  modelo_pago_barato: "deepseek-chat-custom"',
          "  confianca_minima_modelo_barato: 0.92",
        ].join("\n"),
        "utf8"
      );
      const customPolicy = loadOrchestrationPolicy(tmpRootCustom);
      expect(customPolicy.roteamentoPapeisCriticos).toMatchObject({
        somentePago: false,
        modeloPagoBarato: "deepseek-chat-custom",
        confiancaMinimaModeloBarato: 0.92,
      });
    } finally {
      fs.rmSync(tmpRootCustom, { recursive: true, force: true });
    }
  });

  it("R1.3b: lê modelo forte, perfis e prefixos_rota_paga, com padrões", () => {
    const policy = loadOrchestrationPolicy();
    expect(policy.roteamentoPapeisCriticos).toEqual({
      somentePago: true,
      modeloPagoBarato: "deepseek-flash",
      confiancaMinimaModeloBarato: 0.85,
      modeloPagoForte: "deepseek-v4-pro",
      perfilFreellmapiForte: "",
      perfilFreellmapiBarato: "",
      prefixosRotaPaga: ["custom/"],
    });

    const tmpRootMissing = fs.mkdtempSync(path.join(os.tmpdir(), "nc-policy-r1-3b-missing-"));
    try {
      fs.mkdirSync(path.join(tmpRootMissing, "config"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpRootMissing, "config", "politicas-orquestracao.yaml"),
        'versao_politica: "1.0.0"\n',
        "utf8"
      );
      const fallbackPolicy = loadOrchestrationPolicy(tmpRootMissing);
      expect(fallbackPolicy.roteamentoPapeisCriticos).toEqual({
        somentePago: true,
        modeloPagoBarato: "deepseek-flash",
        confiancaMinimaModeloBarato: 0.85,
        modeloPagoForte: "deepseek-v4-pro",
        perfilFreellmapiForte: "",
        perfilFreellmapiBarato: "",
        prefixosRotaPaga: ["custom/"],
      });
    } finally {
      fs.rmSync(tmpRootMissing, { recursive: true, force: true });
    }

    const tmpRootCustom = fs.mkdtempSync(path.join(os.tmpdir(), "nc-policy-r1-3b-custom-"));
    try {
      fs.mkdirSync(path.join(tmpRootCustom, "config"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpRootCustom, "config", "politicas-orquestracao.yaml"),
        [
          "roteamento_papeis_criticos:",
          '  modelo_pago_forte: "deepseek-r1"',
          '  perfil_freellmapi_forte: "paid-strong"',
          '  perfil_freellmapi_barato: "paid-fast"',
          '  prefixos_rota_paga: "custom/ , paid/ , "',
        ].join("\n"),
        "utf8"
      );
      const customPolicy = loadOrchestrationPolicy(tmpRootCustom);
      expect(customPolicy.roteamentoPapeisCriticos.modeloPagoForte).toBe("deepseek-r1");
      expect(customPolicy.roteamentoPapeisCriticos.perfilFreellmapiForte).toBe("paid-strong");
      expect(customPolicy.roteamentoPapeisCriticos.perfilFreellmapiBarato).toBe("paid-fast");
      expect(customPolicy.roteamentoPapeisCriticos.prefixosRotaPaga).toEqual(["custom/", "paid/"]);
    } finally {
      fs.rmSync(tmpRootCustom, { recursive: true, force: true });
    }
  });

  it("P1.4: lê os 14 limiares de jev_limiares do YAML e usa os padrões quando faltam", () => {
    const policy = loadOrchestrationPolicy();
    expect(policy.jevLimiares).toEqual({
      intencaoMensagem: {
        confiancaMinimaChoice: 0.75,
        probabilidadeMinimaAprovacaoIncondicionalNoul: 0.8,
        acaoAbaixoDoLimiar: "pedir_confirmacao_explicita_ao_usuario",
      },
      clarezaSpec: {
        scoreMinimoClareza: 2.0,
        confiancaMinimaScore: 0.65,
        probabilidadeMinimaEscopoFechadoNoul: 0.75,
        probabilidadeMinimaSemContradicoesNoul: 0.8,
        acaoAbaixoDoLimiar: "elicitador_refina_ou_pergunta_ao_usuario",
      },
      planejamentoMicrobrief: {
        confiancaMinimaComplexidade: 0.65,
        acaoBaixaConfiancaComplexidade: "subir_um_nivel_de_modelo",
        probabilidadeDividirMicrobriefNoul: 0.7,
        confiancaMinimaCluster: 0.7,
      },
      sugestaoSkills: {
        probabilidadeMinimaTasteSkillPublicoNoul: 0.75,
        probabilidadeMinimaReactPerfNoul: 0.3,
      },
      cascataSde: {
        limiarDisparoFireT: 0.7,
      },
      segurancaPesquisaT7: {
        probabilidadeMinimaFonteOficialNoul: 0.8,
        probabilidadeMaximaPromptInjectionNoul: 0.8,
        acaoViolacaoOuErroJev: "bloquear_trecho_fail_closed",
      },
    });

    const tmpRootMissing = fs.mkdtempSync(path.join(os.tmpdir(), "nc-policy-p1-4-missing-"));
    try {
      fs.mkdirSync(path.join(tmpRootMissing, "config"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpRootMissing, "config", "politicas-orquestracao.yaml"),
        'versao_politica: "1.0.0"\n',
        "utf8"
      );
      const fallbackPolicy = loadOrchestrationPolicy(tmpRootMissing);
      expect(fallbackPolicy.jevLimiares).toEqual(policy.jevLimiares);
    } finally {
      fs.rmSync(tmpRootMissing, { recursive: true, force: true });
    }

    const tmpRootCustom = fs.mkdtempSync(path.join(os.tmpdir(), "nc-policy-p1-4-custom-"));
    try {
      fs.mkdirSync(path.join(tmpRootCustom, "config"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpRootCustom, "config", "politicas-orquestracao.yaml"),
        [
          "jev_limiares:",
          "  intencao_mensagem:",
          "    confianca_minima_choice: 0.81",
          "    probabilidade_minima_aprovacao_incondicional_noul: 0.82",
          "  clareza_spec:",
          "    score_minimo_clareza: 2.5",
          "    confianca_minima_score: 0.71",
          "    probabilidade_minima_escopo_fechado_noul: 0.78",
          "    probabilidade_minima_sem_contradicoes_noul: 0.84",
          "  planejamento_microbrief:",
          "    confianca_minima_complexidade: 0.69",
          "    probabilidade_dividir_microbrief_noul: 0.73",
          "    confianca_minima_cluster: 0.76",
          "  sugestao_skills:",
          "    probabilidade_minima_taste_skill_publico_noul: 0.79",
          "    probabilidade_minima_react_perf_noul: 0.35",
          "  cascata_sde:",
          "    limiar_disparo_fire_t: 0.74",
          "  seguranca_pesquisa_t7:",
          "    probabilidade_minima_fonte_oficial_noul: 0.88",
          "    probabilidade_maxima_prompt_injection_noul: 0.11",
        ].join("\n"),
        "utf8"
      );
      const customPolicy = loadOrchestrationPolicy(tmpRootCustom);
      expect(customPolicy.jevLimiares).toEqual({
        intencaoMensagem: {
          confiancaMinimaChoice: 0.81,
          probabilidadeMinimaAprovacaoIncondicionalNoul: 0.82,
          acaoAbaixoDoLimiar: "pedir_confirmacao_explicita_ao_usuario",
        },
        clarezaSpec: {
          scoreMinimoClareza: 2.5,
          confiancaMinimaScore: 0.71,
          probabilidadeMinimaEscopoFechadoNoul: 0.78,
          probabilidadeMinimaSemContradicoesNoul: 0.84,
          acaoAbaixoDoLimiar: "elicitador_refina_ou_pergunta_ao_usuario",
        },
        planejamentoMicrobrief: {
          confiancaMinimaComplexidade: 0.69,
          acaoBaixaConfiancaComplexidade: "subir_um_nivel_de_modelo",
          probabilidadeDividirMicrobriefNoul: 0.73,
          confiancaMinimaCluster: 0.76,
        },
        sugestaoSkills: {
          probabilidadeMinimaTasteSkillPublicoNoul: 0.79,
          probabilidadeMinimaReactPerfNoul: 0.35,
        },
        cascataSde: {
          limiarDisparoFireT: 0.74,
        },
        segurancaPesquisaT7: {
          probabilidadeMinimaFonteOficialNoul: 0.88,
          probabilidadeMaximaPromptInjectionNoul: 0.11,
          acaoViolacaoOuErroJev: "bloquear_trecho_fail_closed",
        },
      });
    } finally {
      fs.rmSync(tmpRootCustom, { recursive: true, force: true });
    }
  });

  it("P3: ollama/nemotron e nvidia/nemotron são família nvidia, independente de deepseek", () => {
    expect(isEvaluatorModelIndependent("custom/deepseek-v4-pro", "ollama/nemotron-3-ultra")).toBe(true);
    expect(isEvaluatorModelIndependent("custom/deepseek-v4-pro", "nvidia/nvidia/nemotron-3-ultra-550b-a55b")).toBe(true);
    expect(isEvaluatorModelIndependent("nvidia/nemotron", "ollama/nemotron")).toBe(false);
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
      "testador",
    ];

    for (const name of skillNames) {
      const skill = loadRoleSkill(name);
      expect(skill.name).toBe(name);
      // S3 (mudança 44): só o executor tem ferramentas de verdade (laço); o chat do elicitador não dá nenhuma.
      if (name.startsWith("executor-")) {
        expect(skill.ferramentas.length).toBeGreaterThan(0);
      } else {
        expect(skill.ferramentas.length).toBe(0);
      }
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

    // Avaliador nunca pode usar ferramentas nem escrever
    const denyEvalTool = enforceSkillToolPermission({
      skill: avaliador,
      toolName: "read_file",
      currentStep: 1,
    });
    expect(denyEvalTool.allowed).toBe(false);
    expect(denyEvalTool.violationReason).toContain("não está autorizada");

    const denyEvalEdit = enforceSkillToolPermission({
      skill: avaliador,
      toolName: "write_file",
      targetFile: "src/app/api/tarefas/route.ts",
      currentStep: 1,
    });
    expect(denyEvalEdit.allowed).toBe(false);

    // Executor backend possui ferramentas de leitura
    const allowExecRead = enforceSkillToolPermission({
      skill: executorBackend,
      toolName: "read_file",
      currentStep: 1,
    });
    expect(allowExecRead.allowed).toBe(true);

    // Executor só pode escrever dentro do escopo do Microbrief e nunca em prisma/dev.db ou .env
    const allowInScope = enforceSkillToolPermission({
      skill: executorBackend,
      toolName: "write_file",
      targetFile: "src/app/api/tarefas/route.ts",
      allowedScopeFiles: ["src/app/api/tarefas/route.ts"],
      currentStep: 3,
    });
    expect(allowInScope.allowed).toBe(true);

    const allowNextAuthCatchAll = enforceSkillToolPermission({
      skill: executorBackend,
      toolName: "write_file",
      targetFile: "src/app/api/auth/[...nextauth]/route.ts",
      allowedScopeFiles: ["src/app/api/auth/[...nextauth]/route.ts"],
      currentStep: 3,
    });
    expect(allowNextAuthCatchAll.allowed).toBe(true);

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

    // Teste real 18/10: `.env.example` (modelo sem segredo) é permitido; `.env` e `.env.local` continuam proibidos.
    for (const [file, ok] of [
      [".env.example", true],
      ["./.env.example", true],
      [".env.sample", true],
      [".env", false],
      [".env.local", false],
      [".env.production", false],
    ] as const) {
      const r = enforceSkillToolPermission({
        skill: executorBackend,
        toolName: "write_file",
        targetFile: file,
        allowedScopeFiles: [file.replace(/^\.\//, "")],
        currentStep: 3,
      });
      expect(r.allowed, file).toBe(ok);
      if (!ok) expect(r.violationReason).toContain("[SKILL PROTECTED PATH]");
    }

    const denyMaxSteps = enforceSkillToolPermission({
      skill: executorBackend,
      toolName: "read_file",
      currentStep: executorBackend.passosMax + 1,
    });
    expect(denyMaxSteps.allowed).toBe(false);
    expect(denyMaxSteps.violationReason).toContain("[SKILL STEP LIMIT]");
  });
});
