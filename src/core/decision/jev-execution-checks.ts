import { askJevBatch, type JevQuestionSpec } from "@/core/decision/jev";
import { TelemetryLogger } from "@/core/telemetry/telemetry-logger";

export type JevExecutionMode = "ativo" | "sombra" | "desligado";

export type JevFailureCause =
  | "wrong_code"
  | "environment"
  | "ambiguous_spec"
  | "evaluator_error"
  | "incomplete_output";

export interface JevFailureDiagnosis {
  causa: JevFailureCause;
  confianca: number;
  probabilidades: Record<string, number>;
}

export const FAILURE_CAUSE_CRITERIA: Record<JevFailureCause, string> = {
  wrong_code:
    "the generated code does not do what the criteria require or does not compile because of its own logic",
  environment:
    "missing package, missing types, tooling or build setup problem not caused by the code logic",
  ambiguous_spec:
    "the criteria are contradictory, incomplete or impossible to satisfy as written",
  evaluator_error:
    "the rejection reason contradicts itself or blames files outside this stage",
  incomplete_output:
    "the response was cut, empty, or missing files of the stage",
};

export const FAILURE_CAUSE_LABELS_PT: Record<JevFailureCause, string> = {
  wrong_code: "código incorreto",
  environment: "ambiente/dependências",
  ambiguous_spec: "especificação ambígua",
  evaluator_error: "erro do avaliador",
  incomplete_output: "saída incompleta",
};

export const FAILURE_CAUSE_GUIDANCE_PT: Record<JevFailureCause, string> = {
  wrong_code:
    "corrija a lógica e os tipos nos arquivos do escopo para atender exatamente aos requisitos e passar no compilador.",
  environment:
    "ajuste apenas imports e tipos disponíveis no projeto, sem depender de pacotes ou configurações externas ausentes.",
  ambiguous_spec:
    "implemente a interpretação mais direta e compatível com os contratos existentes sem extrapolar o escopo.",
  evaluator_error:
    "mantenha a implementação estritamente nos arquivos desta etapa e torne explícito no código e no relatório o atendimento de cada requisito.",
  incomplete_output:
    "entregue todos os arquivos do escopo completos do início ao fim e finalize com o relatório exigido.",
};

export function formatFailureDiagnosisFeedbackLine(
  diagnostico: JevFailureDiagnosis | null | undefined,
  limiarConfiancaDiagnostico: number
): string | null {
  if (!diagnostico || typeof diagnostico.confianca !== "number") return null;
  if (diagnostico.confianca < limiarConfiancaDiagnostico) return null;
  const label = FAILURE_CAUSE_LABELS_PT[diagnostico.causa];
  const guidance = FAILURE_CAUSE_GUIDANCE_PT[diagnostico.causa];
  if (!label || !guidance) return null;
  return `Diagnóstico provável: ${label} — ${guidance}`;
}

export async function diagnoseStageFailureWithJev(params: {
  sessionId?: string | null;
  nodeId: string;
  etapa: {
    titulo: string;
    cluster: string;
    reqs_cobertos: string[];
  };
  motivoRejeicao: string;
  tentativa: number;
  historicoMotivos: string[];
  modo: JevExecutionMode;
}): Promise<JevFailureDiagnosis | null> {
  if (params.modo === "desligado") {
    return null;
  }

  const stateObj = {
    etapa: {
      titulo: params.etapa.titulo,
      cluster: params.etapa.cluster,
      reqs_cobertos: params.etapa.reqs_cobertos,
    },
    motivo_rejeicao: (params.motivoRejeicao || "").slice(0, 4000),
    tentativa: params.tentativa,
    historico_motivos: params.historicoMotivos.slice(-3).map((m) => m.slice(0, 2000)),
  };

  const stateJson = JSON.stringify(stateObj).slice(0, 24000);
  const questions: Record<string, JevQuestionSpec> = {
    failure_cause: {
      type: "choice",
      instructions:
        "Examine `etapa`, `motivo_rejeicao`, `tentativa`, and `historico_motivos`. What is the primary cause of this stage failure?",
      criteria: FAILURE_CAUSE_CRITERIA,
    },
  };

  const answers = await askJevBatch({
    purpose: "failure_diagnosis",
    state: stateJson,
    questions,
    sessionId: params.sessionId,
    maxStateChars: 24000,
  });

  const ans = answers?.failure_cause;
  if (!ans || ans.type !== "choice" || !(ans.choice in FAILURE_CAUSE_CRITERIA)) {
    TelemetryLogger.log({
      sessionId: params.sessionId ?? undefined,
      action: "JEV_FAILURE_DIAGNOSIS",
      details: {
        nodeId: params.nodeId,
        tentativa: params.tentativa,
        modo: params.modo,
        available: false,
      },
    });
    return null;
  }

  const diagnosis: JevFailureDiagnosis = {
    causa: ans.choice as JevFailureCause,
    confianca: ans.confidence,
    probabilidades: ans.probabilities,
  };

  TelemetryLogger.log({
    sessionId: params.sessionId ?? undefined,
    action: "JEV_FAILURE_DIAGNOSIS",
    details: {
      nodeId: params.nodeId,
      tentativa: params.tentativa,
      modo: params.modo,
      causa: diagnosis.causa,
      confianca: diagnosis.confianca,
      probabilidades: diagnosis.probabilidades,
    },
  });

  return diagnosis;
}
