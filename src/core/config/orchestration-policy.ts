import * as fs from "fs";
import * as path from "path";

export type ClusterKind = "core" | "backend" | "frontend" | "integration";
export type ModelTierKind = "rapido" | "medio" | "pesado" | "avaliador_forte";
export type VerdictDecision = "APROVADO" | "APROVADO_COM_RESSALVA" | "REPROVADO";

export interface ModelTierPolicy {
  gateway: string;
  endpoint: string;
  modelo: string;
  fallbackGateway?: string;
  fallbackModelo?: string;
  regraIndependencia?: string;
  familiaProibidaSeExecutorDeepseek?: string;
}

export interface OrchestrationPolicy {
  versaoPolitica: string;
  papeis: {
    elicitador: { skillPrincipal: string; nivelModeloPadrao: string };
    analista: { skillPrincipal: string; nivelModeloPadrao: string };
    executores: Record<ClusterKind, { skillPrincipal: string; skillsApoioPermitidas: string[] }>;
    avaliadores: {
      baseGenerica: string;
      porCluster: Record<
        ClusterKind,
        { skillPrincipal: string; herdaDe: string; referenciasObrigatorias: string[] }
      >;
    };
  };
  niveisModelo: {
    decisorJev: {
      gateway: string;
      endpoint: string;
      modelo: string;
      precoEntradaPorMilhaoUsd: number;
      precoSaidaPorMilhaoUsd: number;
    };
    rapido: ModelTierPolicy;
    medio: ModelTierPolicy;
    pesado: ModelTierPolicy;
    avaliadorForte: ModelTierPolicy;
  };
  jevLimiares: {
    intencaoMensagem: {
      confiancaMinimaChoice: number;
      probabilidadeMinimaAprovacaoIncondicionalNoul: number;
      acaoAbaixoDoLimiar: string;
    };
    clarezaSpec: {
      scoreMinimoClareza: number;
      confiancaMinimaScore: number;
      probabilidadeMinimaEscopoFechadoNoul: number;
      probabilidadeMinimaSemContradicoesNoul: number;
      acaoAbaixoDoLimiar: string;
    };
    planejamentoMicrobrief: {
      confiancaMinimaComplexidade: number;
      acaoBaixaConfiancaComplexidade: string;
      probabilidadeDividirMicrobriefNoul: number;
      confiancaMinimaCluster: number;
    };
    sugestaoSkills: {
      probabilidadeMinimaTasteSkillPublicoNoul: number;
      probabilidadeMinimaReactPerfNoul: number;
    };
    cascataSde: {
      limiarDisparoFireT: number;
    };
    segurancaPesquisaT7: {
      probabilidadeMinimaFonteOficialNoul: number;
      probabilidadeMaximaPromptInjectionNoul: number;
      acaoViolacaoOuErroJev: string;
    };
  };
  tentativas: {
    maxTentativasPorExecutor: number;
    maxReenviosSoRelatorio: number;
    reenvioRelatorioContaComoTentativa: boolean;
    falhaProvedorContaComoTentativa: boolean;
    acaoFalhaProvedor: string;
    acaoAprovadoComRessalva: "polir_1_rodada_se_houver_tentativa_senao_promover" | "promover_imediatamente";
    maxRodadasPolimentoRessalva: number;
  };
  rodadasEEscalada: {
    maxRodadasInternasTipo1PorTentativa: number;
    escaladaPorTentativa: {
      tentativa1: string;
      tentativa2: string;
      tentativa3: string;
    };
    acaoAposEsgotarTentativas: string;
  };
  orcamento: {
    tetoCustoPorProjetoUsd: number;
    alertaCustoUsd: number;
    alertaPercentualTeto: number;
    acaoAoAtingirTeto: string;
  };
  execucaoParalela: {
    paralelismoMaximo: number;
    exigirConjuntosArquivosDisjuntos: boolean;
  };
  execucao: {
    modoExecutor: "laco" | "chamada_unica";
  };
  jevExecucao: {
    diagnosticoFalha: "ativo" | "desligado";
    bloqueioSpecAmbigua: "ativo" | "sombra" | "desligado";
    verificacaoEvidencia: "ativo" | "sombra" | "desligado";
    auditoriaEntrega: "ativo" | "sombra" | "desligado";
    guardaSegredosCodigo: "ativo" | "desligado";
    guardaSegredosChat: "ativo" | "desligado";
    guardaInstalacaoSkill: "ativo" | "desligado";
    limiarConfiancaDiagnostico: number;
    limiarEvidenciaContradiz: number;
    limiarSegredoNoul: number;
    limiarRiscoSkillNoul: number;
  };
  roteamentoPapeisCriticos: {
    somentePago: boolean;
    modeloPagoBarato: string;
    confiancaMinimaModeloBarato: number;
    modeloPagoForte: string;
    perfilFreellmapiForte: string;
    perfilFreellmapiBarato: string;
    prefixosRotaPaga: string[];
  };
}

export const DEFAULT_ORCHESTRATION_POLICY: OrchestrationPolicy = {
  versaoPolitica: "1.0.0",
  papeis: {
    elicitador: {
      skillPrincipal: "skills/elicitador/SKILL.md",
      nivelModeloPadrao: "forte",
    },
    analista: {
      skillPrincipal: "skills/analista/SKILL.md",
      nivelModeloPadrao: "forte",
    },
    executores: {
      core: {
        skillPrincipal: "skills/executor-core/SKILL.md",
        skillsApoioPermitidas: ["apoio_dominio_typescript"],
      },
      backend: {
        skillPrincipal: "skills/executor-backend/SKILL.md",
        skillsApoioPermitidas: ["apoio_api_rest_validation", "apoio_dominio_typescript"],
      },
      frontend: {
        skillPrincipal: "skills/executor-frontend/SKILL.md",
        skillsApoioPermitidas: [
          "apoio_ui_web_guidelines",
          "react_best_practices_critical_high",
          "ui_ux_pro_max_rules",
          "taste_skill_publico_selecionado",
        ],
      },
      integration: {
        skillPrincipal: "skills/executor-integration/SKILL.md",
        skillsApoioPermitidas: ["apoio_api_rest_validation"],
      },
    },
    avaliadores: {
      baseGenerica: "skills/avaliador/SKILL.md",
      porCluster: {
        core: {
          skillPrincipal: "skills/avaliador-core/SKILL.md",
          herdaDe: "skills/avaliador/SKILL.md",
          referenciasObrigatorias: [],
        },
        backend: {
          skillPrincipal: "skills/avaliador-backend/SKILL.md",
          herdaDe: "skills/avaliador/SKILL.md",
          referenciasObrigatorias: [],
        },
        frontend: {
          skillPrincipal: "skills/avaliador-frontend/SKILL.md",
          herdaDe: "skills/avaliador/SKILL.md",
          referenciasObrigatorias: [
            "skills/avaliador-frontend/references/web-interface-guidelines-command.md",
            "skills/avaliador-frontend/references/react-best-practices-critical-high.md",
            "skills/avaliador-frontend/references/ui-ux-pro-max-checklist.md",
            "skills/avaliador-frontend/references/taste-skill-preflight-publico.md",
          ],
        },
        integration: {
          skillPrincipal: "skills/avaliador-integration/SKILL.md",
          herdaDe: "skills/avaliador/SKILL.md",
          referenciasObrigatorias: [],
        },
      },
    },
  },
  niveisModelo: {
    decisorJev: {
      gateway: "typesafe_systemone",
      endpoint: "https://api.typesafe.ai/v1/systemone",
      modelo: "jev-1.13.0",
      precoEntradaPorMilhaoUsd: 0.042,
      precoSaidaPorMilhaoUsd: 0.0,
    },
    rapido: {
      gateway: "freellmapi",
      endpoint: "http://localhost:3100/v1",
      modelo: "auto:fast",
    },
    medio: {
      gateway: "deepseek",
      endpoint: "https://api.deepseek.com/v1",
      modelo: "deepseek-v4-pro",
      fallbackGateway: "freellmapi",
      fallbackModelo: "auto:smart",
    },
    pesado: {
      gateway: "deepseek",
      endpoint: "https://api.deepseek.com/v1",
      modelo: "deepseek-v4-pro",
    },
    avaliadorForte: {
      regraIndependencia: "forte_e_diferente_do_executor",
      familiaProibidaSeExecutorDeepseek: "deepseek",
      gateway: "freellmapi",
      endpoint: "http://localhost:3100/v1",
      modelo: "auto:smart",
    },
  },
  jevLimiares: {
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
      probabilidadeMaximaPromptInjectionNoul: 0.15,
      acaoViolacaoOuErroJev: "bloquear_trecho_fail_closed",
    },
  },
  tentativas: {
    maxTentativasPorExecutor: 3,
    maxReenviosSoRelatorio: 2,
    reenvioRelatorioContaComoTentativa: false,
    falhaProvedorContaComoTentativa: false,
    acaoFalhaProvedor: "pausar_backoff_ou_trocar_gateway_sem_incrementar_tentativa",
    acaoAprovadoComRessalva: "polir_1_rodada_se_houver_tentativa_senao_promover",
    maxRodadasPolimentoRessalva: 1,
  },
  rodadasEEscalada: {
    maxRodadasInternasTipo1PorTentativa: 2,
    escaladaPorTentativa: {
      tentativa1: "usar_nivel_sugerido_pelo_jev",
      tentativa2: "subir_no_minimo_para_medio",
      tentativa3: "forcar_nivel_pesado",
    },
    acaoAposEsgotarTentativas: "interromper_cluster_e_escalar_para_humano",
  },
  orcamento: {
    tetoCustoPorProjetoUsd: 0.5,
    alertaCustoUsd: 0.4,
    alertaPercentualTeto: 80,
    acaoAoAtingirTeto: "pausar_orquestracao_e_exigir_autorizacao_humana",
  },
  execucaoParalela: {
    paralelismoMaximo: 3,
    exigirConjuntosArquivosDisjuntos: true,
  },
  execucao: {
    modoExecutor: "laco",
  },
  jevExecucao: {
    diagnosticoFalha: "ativo",
    bloqueioSpecAmbigua: "ativo",
    verificacaoEvidencia: "sombra",
    auditoriaEntrega: "sombra",
    guardaSegredosCodigo: "ativo",
    guardaSegredosChat: "ativo",
    guardaInstalacaoSkill: "ativo",
    limiarConfiancaDiagnostico: 0.8,
    limiarEvidenciaContradiz: 0.8,
    limiarSegredoNoul: 0.7,
    limiarRiscoSkillNoul: 0.7,
  },
  roteamentoPapeisCriticos: {
    somentePago: true,
    modeloPagoBarato: "deepseek-flash",
    confiancaMinimaModeloBarato: 0.85,
    modeloPagoForte: "deepseek-v4-pro",
    perfilFreellmapiForte: "",
    perfilFreellmapiBarato: "",
    prefixosRotaPaga: ["custom/"],
  },
};

function extractScalarNumber(yamlText: string, key: string, fallback: number): number {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`, "m");
  const m = yamlText.match(re);
  if (!m) return fallback;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : fallback;
}

function extractScalarBoolean(yamlText: string, key: string, fallback: boolean): boolean {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(true|false)\\b`, "m");
  const m = yamlText.match(re);
  if (!m) return fallback;
  return m[1] === "true";
}

function extractScalarString(yamlText: string, key: string, fallback: string): string {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*["']?([^"'#\\r\\n]+?)["']?\\s*(?:#.*)?$`, "m");
  const m = yamlText.match(re);
  return m && m[1].trim() ? m[1].trim() : fallback;
}

/**
 * Carrega e interpreta `config/politicas-orquestracao.yaml` (ou `docs/rascunhos/politicas-orquestracao.yaml`
 * como fallback), aplicando tipagem estrita sobre os parâmetros do harness.
 */
export function loadOrchestrationPolicy(rootDir: string = process.cwd()): OrchestrationPolicy {
  const primaryPath = path.join(rootDir, "config", "politicas-orquestracao.yaml");
  const fallbackPath = path.join(rootDir, "docs", "rascunhos", "politicas-orquestracao.yaml");
  const targetPath = fs.existsSync(primaryPath)
    ? primaryPath
    : fs.existsSync(fallbackPath)
      ? fallbackPath
      : null;

  if (!targetPath) {
    return structuredClone(DEFAULT_ORCHESTRATION_POLICY);
  }

  const raw = fs.readFileSync(targetPath, "utf8");
  const policy = structuredClone(DEFAULT_ORCHESTRATION_POLICY);

  policy.versaoPolitica = extractScalarString(raw, "versao_politica", policy.versaoPolitica);
  policy.tentativas.maxTentativasPorExecutor = extractScalarNumber(
    raw,
    "max_tentativas_por_executor",
    policy.tentativas.maxTentativasPorExecutor
  );
  policy.tentativas.maxReenviosSoRelatorio = extractScalarNumber(
    raw,
    "max_reenvios_so_relatorio",
    policy.tentativas.maxReenviosSoRelatorio
  );
  policy.tentativas.reenvioRelatorioContaComoTentativa = extractScalarBoolean(
    raw,
    "reenvio_relatorio_conta_como_tentativa",
    policy.tentativas.reenvioRelatorioContaComoTentativa
  );
  policy.tentativas.falhaProvedorContaComoTentativa = extractScalarBoolean(
    raw,
    "falha_provedor_conta_como_tentativa",
    policy.tentativas.falhaProvedorContaComoTentativa
  );
  const ressalvaMode = extractScalarString(
    raw,
    "acao_aprovado_com_ressalva",
    policy.tentativas.acaoAprovadoComRessalva
  );
  if (
    ressalvaMode === "polir_1_rodada_se_houver_tentativa_senao_promover" ||
    ressalvaMode === "promover_imediatamente"
  ) {
    policy.tentativas.acaoAprovadoComRessalva = ressalvaMode;
  }
  policy.tentativas.maxRodadasPolimentoRessalva = extractScalarNumber(
    raw,
    "max_rodadas_polimento_ressalva",
    policy.tentativas.maxRodadasPolimentoRessalva
  );

  policy.jevLimiares.intencaoMensagem.confiancaMinimaChoice = extractScalarNumber(
    raw,
    "confianca_minima_choice",
    policy.jevLimiares.intencaoMensagem.confiancaMinimaChoice
  );
  policy.jevLimiares.intencaoMensagem.probabilidadeMinimaAprovacaoIncondicionalNoul =
    extractScalarNumber(
      raw,
      "probabilidade_minima_aprovacao_incondicional_noul",
      policy.jevLimiares.intencaoMensagem.probabilidadeMinimaAprovacaoIncondicionalNoul
    );

  policy.jevLimiares.clarezaSpec.scoreMinimoClareza = extractScalarNumber(
    raw,
    "score_minimo_clareza",
    policy.jevLimiares.clarezaSpec.scoreMinimoClareza
  );
  policy.jevLimiares.clarezaSpec.confiancaMinimaScore = extractScalarNumber(
    raw,
    "confianca_minima_score",
    policy.jevLimiares.clarezaSpec.confiancaMinimaScore
  );
  policy.jevLimiares.clarezaSpec.probabilidadeMinimaEscopoFechadoNoul = extractScalarNumber(
    raw,
    "probabilidade_minima_escopo_fechado_noul",
    policy.jevLimiares.clarezaSpec.probabilidadeMinimaEscopoFechadoNoul
  );
  policy.jevLimiares.clarezaSpec.probabilidadeMinimaSemContradicoesNoul = extractScalarNumber(
    raw,
    "probabilidade_minima_sem_contradicoes_noul",
    policy.jevLimiares.clarezaSpec.probabilidadeMinimaSemContradicoesNoul
  );

  policy.jevLimiares.planejamentoMicrobrief.confiancaMinimaComplexidade = extractScalarNumber(
    raw,
    "confianca_minima_complexidade",
    policy.jevLimiares.planejamentoMicrobrief.confiancaMinimaComplexidade
  );
  policy.jevLimiares.planejamentoMicrobrief.probabilidadeDividirMicrobriefNoul = extractScalarNumber(
    raw,
    "probabilidade_dividir_microbrief_noul",
    policy.jevLimiares.planejamentoMicrobrief.probabilidadeDividirMicrobriefNoul
  );
  policy.jevLimiares.planejamentoMicrobrief.confiancaMinimaCluster = extractScalarNumber(
    raw,
    "confianca_minima_cluster",
    policy.jevLimiares.planejamentoMicrobrief.confiancaMinimaCluster
  );

  policy.jevLimiares.sugestaoSkills.probabilidadeMinimaTasteSkillPublicoNoul = extractScalarNumber(
    raw,
    "probabilidade_minima_taste_skill_publico_noul",
    policy.jevLimiares.sugestaoSkills.probabilidadeMinimaTasteSkillPublicoNoul
  );
  policy.jevLimiares.sugestaoSkills.probabilidadeMinimaReactPerfNoul = extractScalarNumber(
    raw,
    "probabilidade_minima_react_perf_noul",
    policy.jevLimiares.sugestaoSkills.probabilidadeMinimaReactPerfNoul
  );

  policy.jevLimiares.cascataSde.limiarDisparoFireT = extractScalarNumber(
    raw,
    "limiar_disparo_fire_t",
    policy.jevLimiares.cascataSde.limiarDisparoFireT
  );
  policy.jevLimiares.segurancaPesquisaT7.probabilidadeMinimaFonteOficialNoul = extractScalarNumber(
    raw,
    "probabilidade_minima_fonte_oficial_noul",
    policy.jevLimiares.segurancaPesquisaT7.probabilidadeMinimaFonteOficialNoul
  );
  policy.jevLimiares.segurancaPesquisaT7.probabilidadeMaximaPromptInjectionNoul =
    extractScalarNumber(
      raw,
      "probabilidade_maxima_prompt_injection_noul",
      policy.jevLimiares.segurancaPesquisaT7.probabilidadeMaximaPromptInjectionNoul
    );

  policy.orcamento.tetoCustoPorProjetoUsd = extractScalarNumber(
    raw,
    "teto_custo_por_projeto_usd",
    policy.orcamento.tetoCustoPorProjetoUsd
  );
  policy.orcamento.alertaCustoUsd = extractScalarNumber(
    raw,
    "alerta_custo_usd",
    policy.orcamento.alertaCustoUsd
  );
  policy.orcamento.alertaPercentualTeto = extractScalarNumber(
    raw,
    "alerta_percentual_teto",
    policy.orcamento.alertaPercentualTeto
  );

  policy.execucaoParalela.paralelismoMaximo = extractScalarNumber(
    raw,
    "paralelismo_maximo",
    policy.execucaoParalela.paralelismoMaximo
  );
  policy.execucaoParalela.exigirConjuntosArquivosDisjuntos = extractScalarBoolean(
    raw,
    "exigir_conjuntos_arquivos_disjuntos",
    policy.execucaoParalela.exigirConjuntosArquivosDisjuntos
  );

  const modoExecutorRaw = extractScalarString(raw, "modo_executor", policy.execucao.modoExecutor);
  if (modoExecutorRaw === "laco" || modoExecutorRaw === "chamada_unica") {
    policy.execucao.modoExecutor = modoExecutorRaw;
  }

  const diagFalhaRaw = extractScalarString(
    raw,
    "diagnostico_falha",
    policy.jevExecucao.diagnosticoFalha
  );
  if (diagFalhaRaw === "ativo" || diagFalhaRaw === "desligado") {
    policy.jevExecucao.diagnosticoFalha = diagFalhaRaw;
  }

  const bloqSpecRaw = extractScalarString(
    raw,
    "bloqueio_spec_ambigua",
    policy.jevExecucao.bloqueioSpecAmbigua
  );
  if (bloqSpecRaw === "ativo" || bloqSpecRaw === "sombra" || bloqSpecRaw === "desligado") {
    policy.jevExecucao.bloqueioSpecAmbigua = bloqSpecRaw;
  }

  const verifEvidRaw = extractScalarString(
    raw,
    "verificacao_evidencia",
    policy.jevExecucao.verificacaoEvidencia
  );
  if (verifEvidRaw === "ativo" || verifEvidRaw === "sombra" || verifEvidRaw === "desligado") {
    policy.jevExecucao.verificacaoEvidencia = verifEvidRaw;
  }

  const auditEntrRaw = extractScalarString(
    raw,
    "auditoria_entrega",
    policy.jevExecucao.auditoriaEntrega
  );
  if (auditEntrRaw === "ativo" || auditEntrRaw === "sombra" || auditEntrRaw === "desligado") {
    policy.jevExecucao.auditoriaEntrega = auditEntrRaw;
  }

  const guardaCodigoRaw = extractScalarString(
    raw,
    "guarda_segredos_codigo",
    policy.jevExecucao.guardaSegredosCodigo
  );
  if (guardaCodigoRaw === "ativo" || guardaCodigoRaw === "desligado") {
    policy.jevExecucao.guardaSegredosCodigo = guardaCodigoRaw;
  }

  const guardaChatRaw = extractScalarString(
    raw,
    "guarda_segredos_chat",
    policy.jevExecucao.guardaSegredosChat
  );
  if (guardaChatRaw === "ativo" || guardaChatRaw === "desligado") {
    policy.jevExecucao.guardaSegredosChat = guardaChatRaw;
  }

  const guardaSkillRaw = extractScalarString(
    raw,
    "guarda_instalacao_skill",
    policy.jevExecucao.guardaInstalacaoSkill
  );
  if (guardaSkillRaw === "ativo" || guardaSkillRaw === "desligado") {
    policy.jevExecucao.guardaInstalacaoSkill = guardaSkillRaw;
  }

  policy.jevExecucao.limiarConfiancaDiagnostico = extractScalarNumber(
    raw,
    "limiar_confianca_diagnostico",
    policy.jevExecucao.limiarConfiancaDiagnostico
  );
  policy.jevExecucao.limiarEvidenciaContradiz = extractScalarNumber(
    raw,
    "limiar_evidencia_contradiz",
    policy.jevExecucao.limiarEvidenciaContradiz
  );
  policy.jevExecucao.limiarSegredoNoul = extractScalarNumber(
    raw,
    "limiar_segredo_noul",
    policy.jevExecucao.limiarSegredoNoul
  );
  policy.jevExecucao.limiarRiscoSkillNoul = extractScalarNumber(
    raw,
    "limiar_risco_skill_noul",
    policy.jevExecucao.limiarRiscoSkillNoul
  );

  policy.roteamentoPapeisCriticos.somentePago = extractScalarBoolean(
    raw,
    "somente_pago",
    policy.roteamentoPapeisCriticos.somentePago
  );
  policy.roteamentoPapeisCriticos.modeloPagoBarato = extractScalarString(
    raw,
    "modelo_pago_barato",
    policy.roteamentoPapeisCriticos.modeloPagoBarato
  );
  policy.roteamentoPapeisCriticos.confiancaMinimaModeloBarato = extractScalarNumber(
    raw,
    "confianca_minima_modelo_barato",
    policy.roteamentoPapeisCriticos.confiancaMinimaModeloBarato
  );
  policy.roteamentoPapeisCriticos.modeloPagoForte = extractScalarString(
    raw,
    "modelo_pago_forte",
    policy.roteamentoPapeisCriticos.modeloPagoForte
  );
  policy.roteamentoPapeisCriticos.perfilFreellmapiForte = extractScalarString(
    raw,
    "perfil_freellmapi_forte",
    policy.roteamentoPapeisCriticos.perfilFreellmapiForte
  );
  policy.roteamentoPapeisCriticos.perfilFreellmapiBarato = extractScalarString(
    raw,
    "perfil_freellmapi_barato",
    policy.roteamentoPapeisCriticos.perfilFreellmapiBarato
  );
  policy.roteamentoPapeisCriticos.prefixosRotaPaga = extractScalarString(
    raw,
    "prefixos_rota_paga",
    policy.roteamentoPapeisCriticos.prefixosRotaPaga.join(",")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return policy;
}

/**
 * Resolve o nível de modelo efetivo do Executor considerando a tentativa atual (1..3)
 * e a regra de escalada progressiva do Superpowers.
 */
export function resolveExecutorTierForAttempt(
  suggestedTier: "rapido" | "medio" | "pesado",
  attemptNumber: number
): "rapido" | "medio" | "pesado" {
  if (attemptNumber <= 1) {
    return suggestedTier;
  }
  if (attemptNumber === 2) {
    return suggestedTier === "rapido" ? "medio" : "pesado";
  }
  return "pesado";
}

/**
 * Verifica mecanicamente se o modelo do Avaliador cumpre a Trava T4
 * (modelo forte e de família diferente do Executor).
 */
export function isEvaluatorModelIndependent(
  executorModelOrGateway: string,
  evaluatorModelOrGateway: string
): boolean {
  const execNorm = executorModelOrGateway.trim().toLowerCase();
  const evalNorm = evaluatorModelOrGateway.trim().toLowerCase();
  if (!execNorm || !evalNorm) return false;
  if (execNorm === evalNorm) return false;

  const detectFamily = (val: string): string => {
    if (val.includes("deepseek")) return "deepseek";
    if (val.includes("claude") || val.includes("anthropic")) return "anthropic";
    if (val.includes("gemini") || val.includes("google")) return "google";
    if (val.includes("gpt") || val.includes("openai") || val.includes("o1") || val.includes("o3")) return "openai";
    if (val.includes("freellmapi") || val.includes("auto:")) return "freellmapi_pool";
    if (val.includes("nemotron") || val.includes("nvidia")) return "nvidia";
    return val.split("/")[0] || val;
  };

  return detectFamily(execNorm) !== detectFamily(evalNorm);
}

/**
 * Decide a ação do harness diante de um Veredito do Avaliador (`APROVADO`, `APROVADO_COM_RESSALVA`, `REPROVADO`),
 * respeitando a política aprovada pelo fundador:
 * - `APROVADO` -> promove imediatamente sem gastar tentativa.
 * - `APROVADO_COM_RESSALVA` -> se ainda houver tentativas disponíveis (`attemptNumber < maxAttempts`)
 *   e ainda não tiver feito a rodada de polimento (`polishRoundsUsed < maxRodadasPolimentoRessalva`),
 *   solicita 1 rodada rápida de polimento (sem reprovar o cluster em definitivo); caso contrário,
 *   promove com as ressalvas registradas no resumo final.
 * - `REPROVADO` -> consome 1 tentativa; se `attemptNumber >= maxAttempts`, bloqueia e escala para o humano.
 */
export function resolveVerdictAction(params: {
  decisao: VerdictDecision;
  attemptNumber: number;
  maxAttempts?: number;
  polishRoundsUsed?: number;
  policy?: OrchestrationPolicy;
}): {
  action: "promover" | "promover_com_ressalvas" | "polir_uma_rodada" | "retentar_executor" | "bloquear_escalar_humano";
  consumesAttempt: boolean;
} {
  const policy = params.policy ?? DEFAULT_ORCHESTRATION_POLICY;
  const maxAttempts = params.maxAttempts ?? policy.tentativas.maxTentativasPorExecutor;
  const polishUsed = params.polishRoundsUsed ?? 0;

  if (params.decisao === "APROVADO") {
    return { action: "promover", consumesAttempt: false };
  }

  if (params.decisao === "APROVADO_COM_RESSALVA") {
    if (
      policy.tentativas.acaoAprovadoComRessalva === "polir_1_rodada_se_houver_tentativa_senao_promover" &&
      params.attemptNumber < maxAttempts &&
      polishUsed < policy.tentativas.maxRodadasPolimentoRessalva
    ) {
      return { action: "polir_uma_rodada", consumesAttempt: false };
    }
    return { action: "promover_com_ressalvas", consumesAttempt: false };
  }

  // REPROVADO
  if (params.attemptNumber >= maxAttempts) {
    return { action: "bloquear_escalar_humano", consumesAttempt: true };
  }
  return { action: "retentar_executor", consumesAttempt: true };
}

/**
 * Verifica o orçamento acumulado do projeto contra o teto em USD (Trava T8: US$ 0.50, alerta em US$ 0.40).
 */
export function evaluateProjectBudget(
  spentUsd: number,
  policy: OrchestrationPolicy = DEFAULT_ORCHESTRATION_POLICY
): {
  status: "ok" | "alerta_80_porcento" | "teto_excedido_pausar";
  spentUsd: number;
  limitUsd: number;
  alertThresholdUsd: number;
  remainingUsd: number;
} {
  const limitUsd = policy.orcamento.tetoCustoPorProjetoUsd;
  const alertThresholdUsd = policy.orcamento.alertaCustoUsd;
  const remainingUsd = Math.max(0, Number((limitUsd - spentUsd).toFixed(6)));

  if (spentUsd >= limitUsd) {
    return {
      status: "teto_excedido_pausar",
      spentUsd,
      limitUsd,
      alertThresholdUsd,
      remainingUsd: 0,
    };
  }
  if (spentUsd >= alertThresholdUsd) {
    return {
      status: "alerta_80_porcento",
      spentUsd,
      limitUsd,
      alertThresholdUsd,
      remainingUsd,
    };
  }
  return {
    status: "ok",
    spentUsd,
    limitUsd,
    alertThresholdUsd,
    remainingUsd,
  };
}
