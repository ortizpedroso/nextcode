import { readCanonicalSpecFile } from "./spec-file";
import { parseSpecDocument, renderCanonicalSpecDocument } from "./spec-format";
import { checkSpecStructure } from "./spec-check";
import {
  extractProjectTitle,
  extractProjectStack,
  extractSourceFiles,
  extractApiRoutes,
  extractPrismaEntities,
  extractMacrobriefInfo,
  buildSurveyFromExtracted,
} from "./project-repository-survey-extract";
import {
  surveyToNewCanonicalSpec,
  reconcileParsedSpecWithSurvey,
  renderSurveyGapsMarkdown,
  renderReconcileMarkdown,
} from "./spec-reconcile-with-survey";
import { publishProjectSpecAuditArtifacts } from "./project-spec-audit-publish";

export type SurveyProvenance = "observado" | "derivado_macrobrief" | "inferido";

export type SpecAuditMode = "criar" | "reconciliar" | "sem_alteracao" | "bloqueado";

export interface ProjectRepositorySurvey {
  projectRoot: string;
  levantadoEm: string;
  titulo: string;
  stack: string[];
  arquivosFonte: string[];
  rotasApi: Array<{ caminho: string; arquivo: string }>;
  entidades: Array<{ nome: string; campos: Array<{ nome: string; tipo: string }> }>;
  modulos: Array<{
    id: string;
    nome: string;
    resumo: string;
    arquivos: string[];
    proveniencia: SurveyProvenance;
  }>;
  requisitosSugeridos: Array<{
    id: string;
    titulo: string;
    criterio: string;
    origem: string;
    proveniencia: SurveyProvenance;
  }>;
  macrobrief: {
    presente: boolean;
    specVersao: number | null;
    arquivosMacrobrief: string[];
    reqsMacrobrief: string[];
  };
  lacunas: Array<{
    codigo:
      | "arquivo_sem_modulo"
      | "arquivo_sem_req"
      | "req_sem_criterio"
      | "rota_sem_arquivo"
      | "entidade_vazia"
      | "spec_arquivo_inexistente_no_disco"
      | "modulo_sem_arquivo";
    detalhe: string;
  }>;
}

export interface SpecReconcileDelta {
  arquivosAdicionados: string[];
  arquivosRemovidosNaSpec: string[];
  rotasAdicionadas: string[];
  stackAlterada: { antes: string[]; depois: string[] } | null;
  modulosAjustados: string[];
  requisitosPreservados: string[];
  requisitosNovos: string[];
  avisos: string[];
}

export interface ProjectSpecAuditResult {
  mode: SpecAuditMode;
  survey: ProjectRepositorySurvey;
  specText: string | null;
  delta: SpecReconcileDelta | null;
  gapsMarkdown: string;
  reconcileMarkdown: string | null;
  checkErrors: string[];
  gravouSpec: boolean;
  gravouGaps: boolean;
  gravouReconcile: boolean;
  motivoBloqueio?: string;
}

// Re-export public API
export {
  surveyToNewCanonicalSpec,
  reconcileParsedSpecWithSurvey,
  renderSurveyGapsMarkdown,
  renderReconcileMarkdown,
  publishProjectSpecAuditArtifacts,
};

/**
 * Constrói o inventário mecânico completo do repositório a partir de projectRoot.
 */
export function buildProjectRepositorySurvey(projectRoot: string): ProjectRepositorySurvey {
  const titulo = extractProjectTitle(projectRoot);
  const stack = extractProjectStack(projectRoot);
  const arquivosFonte = extractSourceFiles(projectRoot);
  const rotasApi = extractApiRoutes(projectRoot, arquivosFonte);
  const entidades = extractPrismaEntities(projectRoot);
  const macrobriefData = extractMacrobriefInfo(projectRoot);

  return buildSurveyFromExtracted(
    projectRoot,
    titulo,
    stack,
    arquivosFonte,
    rotasApi,
    entidades,
    macrobriefData
  );
}

/**
 * Executa a auditoria completa da Spec contra o repositório:
 * - Modo "criar" se spec não existe ou parse falha
 * - Modo "reconciliar" se spec existe e difere
 * - Modo "sem_alteracao" se merged é byte-a-byte idêntico ao arquivo
 * - Modo "bloqueado" se spec tem status: aprovada e force !== true, ou se validação falhar
 */
export function runProjectSpecAudit(
  projectRoot: string,
  opts?: { force?: boolean; autoPublish?: boolean }
): ProjectSpecAuditResult {
  const survey = buildProjectRepositorySurvey(projectRoot);
  const diskText = readCanonicalSpecFile(projectRoot);
  const diskParsed = diskText ? parseSpecDocument(diskText) : null;

  let result: ProjectSpecAuditResult;

  if (!diskText || !diskParsed) {
    // Modo CRIAR
    const specText = surveyToNewCanonicalSpec(survey);
    const parsedNew = parseSpecDocument(specText);
    const checkErrors = parsedNew ? checkSpecStructure(parsedNew) : ["Erro ao parsear Spec gerada."];
    const gapsMarkdown = renderSurveyGapsMarkdown(survey);

    if (checkErrors.length > 0) {
      result = {
        mode: "bloqueado",
        survey,
        specText: null,
        delta: null,
        gapsMarkdown,
        reconcileMarkdown: null,
        checkErrors,
        gravouSpec: false,
        gravouGaps: false,
        gravouReconcile: false,
        motivoBloqueio: `Erros estruturais impedem a criação da Spec: ${checkErrors.join("; ")}`,
      };
    } else {
      result = {
        mode: "criar",
        survey,
        specText,
        delta: null,
        gapsMarkdown,
        reconcileMarkdown: null,
        checkErrors: [],
        gravouSpec: true,
        gravouGaps: false,
        gravouReconcile: false,
      };
    }
  } else {
    // Spec existente no disco
    const { merged, delta } = reconcileParsedSpecWithSurvey(diskParsed, survey);
    const gapsMarkdown = renderSurveyGapsMarkdown(survey);
    const reconcileMarkdown = renderReconcileMarkdown(survey, delta);

    // Verificação de bloqueio: status aprovada sem force
    const isApproved = diskParsed.status === "aprovada";
    if (isApproved && opts?.force !== true) {
      result = {
        mode: "bloqueado",
        survey,
        specText: null,
        delta,
        gapsMarkdown,
        reconcileMarkdown,
        checkErrors: [],
        gravouSpec: false,
        gravouGaps: false,
        gravouReconcile: false,
        motivoBloqueio:
          "Spec atual possui status: aprovada no disco. Reconciliação bloqueada para proteger o documento central. Utilize force: true para reabrir aprovação via harness.",
      };
    } else {
      const mergedText = renderCanonicalSpecDocument(merged);
      const normMerged = mergedText.replace(/\r\n/g, "\n").trim();
      const normDisk = diskText.replace(/\r\n/g, "\n").trim();
      const hasMaterialDelta =
        delta.arquivosAdicionados.length > 0 ||
        delta.arquivosRemovidosNaSpec.length > 0 ||
        delta.rotasAdicionadas.length > 0 ||
        delta.stackAlterada !== null ||
        delta.modulosAjustados.length > 0 ||
        delta.requisitosNovos.length > 0;

      // Critério sem_alteracao:
      // O brief (§4, §6) exige sem_alteracao quando a Spec resultante é byte-a-byte idêntica ao arquivo no disco
      // (normalizado LF e trim) ou quando sua representação canônica serializada é estritamente equivalente sem delta material.
      const isIdentical =
        normMerged === normDisk ||
        (!hasMaterialDelta && canonicalizeSpecDocument(mergedText) === canonicalizeSpecDocument(diskText));

      if (isIdentical) {
        result = {
          mode: "sem_alteracao",
          survey,
          specText: diskText,
          delta,
          gapsMarkdown,
          reconcileMarkdown,
          checkErrors: [],
          gravouSpec: false,
          gravouGaps: false,
          gravouReconcile: false,
        };
      } else {
        const parsedMerged = parseSpecDocument(mergedText);
        const checkErrors = parsedMerged
          ? checkSpecStructure(parsedMerged, {
              reqCriteriaPathsAbsentFromArquivos: delta.arquivosRemovidosNaSpec,
            })
          : ["Erro ao parsear Spec reconciliada."];

        if (checkErrors.length > 0) {
          result = {
            mode: "bloqueado",
            survey,
            specText: null,
            delta,
            gapsMarkdown,
            reconcileMarkdown,
            checkErrors,
            gravouSpec: false,
            gravouGaps: false,
            gravouReconcile: false,
            motivoBloqueio: `Erros estruturais impedem a gravação da Spec reconciliada: ${checkErrors.join("; ")}`,
          };
        } else {
          result = {
            mode: "reconciliar",
            survey,
            specText: mergedText,
            delta,
            gapsMarkdown,
            reconcileMarkdown,
            checkErrors: [],
            gravouSpec: true,
            gravouGaps: false,
            gravouReconcile: false,
          };
        }
      }
    }
  }

  // Publica artefatos no disco por padrão
  if (opts?.autoPublish !== false) {
    publishProjectSpecAuditArtifacts(projectRoot, result);
  }

  return result;
}
