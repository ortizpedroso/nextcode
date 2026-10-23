import { DAGNode } from "../dag/dag-engine";
import { extractFilePathsFromText } from "../shared/file-path-extractor";
import { parseSpecDocument } from "../intake/spec-format";
import {
  inferClusterFromFilePath,
  validateMacrobriefMechanical,
  type MacrobriefDocument,
  type MicrobriefAndReportDocument,
  type MechanicalValidationResult,
} from "../templates/artifact-templates";
import type { ClusterKind } from "../config/orchestration-policy";
import { TelemetryLogger } from "../telemetry/telemetry-logger";
import { loadRoleSkill, buildSkillSystemPrompt } from "./skill-runtime";
import { GENERIC_FILE_NAMES, extractFilePathsFromCriteriaText, pathInStageScope } from "../decision/jev-execution-checks";
import { validatePlanStages, type PlanStage } from "../orchestrator/plan-scope-check";
import { recordLlmCost } from "../llm/cost";
import {
  validateContract,
  renderContractTs,
  renderContractSliceTs,
  type ContratoProjeto,
} from "../orchestrator/project-contract";

export interface DecompositionResult {
  goal: string;
  nodes: DAGNode[];
  summary: string;
  macrobrief?: MacrobriefDocument;
  microbriefs?: MicrobriefAndReportDocument[];
  t8bCheck?: MechanicalValidationResult;
}

export { extractFilePathsFromText };

/** Arquivos que os demais importam: implementados primeiro, numa etapa própria (cluster core). */
const FOUNDATION_RE =
  /(^|\/)(prisma\/|schema\.prisma$|package\.json$|tsconfig\.json$|next\.config|tailwind\.config|postcss\.config|\.env|middleware\.ts$|lib\/|types?\/|config\/|utils?\/|core\/)/i;

/** Arquivos por etapa: uma resposta de LLM precisa caber o código COMPLETO de todos. */
const FILES_PER_NODE = 4;

function shortList(files: string[]): string {
  const names = files.map((f) => f.split("/").slice(-2).join("/"));
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}

function roleForCluster(cluster: ClusterKind): string {
  return `executor-${cluster}`;
}

export class SpecDecomposerSkill {
  /**
   * DAG a partir da Spec Canônica aprovada (Papel: Analista + Trava T8b):
   * - Separa a base (`core`: schema, lib, tipos, config) na Onda 1 e os demais arquivos por
   *   cluster (`backend`, `integration`, `frontend`) na Onda 2, permitindo execução paralela
   *   entre clusters independentes.
   * - Associa `REQ-001…` da Spec (ou sintetiza `REQ`s determinísticos por módulo/grupo) a cada
   *   Microbrief e executa a conferência mecânica `validateMacrobriefMechanical` (Trava T8b:
   *   100% dos REQs cobertos, arquivos disjuntos por executor, DAG sem ciclos).
   */
  public static decomposeSpec(
    specText: string,
    titulo: string | null,
    files: string[],
    stack: string[] = [],
    sessionId?: string
  ): DecompositionResult {
    const unique = Array.from(new Set(files.map((f) => f.trim()).filter(Boolean)));
    const foundation = unique.filter((f) => FOUNDATION_RE.test(f));
    const rest = unique.filter((f) => !FOUNDATION_RE.test(f)).sort();

    const chunk = (list: string[]) => {
      const out: string[][] = [];
      for (let i = 0; i < list.length; i += FILES_PER_NODE) out.push(list.slice(i, i + FILES_PER_NODE));
      return out;
    };

    const foundationGroups = chunk(foundation);

    // Agrupa os arquivos de funcionalidade por cluster (backend, integration, frontend, core)
    // para que cada etapa tenha um único cluster e use a skill executor-<cluster> correspondente.
    const restByCluster = new Map<ClusterKind, string[]>();
    for (const file of rest) {
      const c = inferClusterFromFilePath(file);
      const list = restByCluster.get(c) ?? [];
      list.push(file);
      restByCluster.set(c, list);
    }

    const orderedClusters: ClusterKind[] = ["core", "backend", "integration", "frontend"];
    const restClusterGroups: { cluster: ClusterKind; files: string[] }[] = [];
    for (const c of orderedClusters) {
      const clusterFiles = restByCluster.get(c);
      if (clusterFiles && clusterFiles.length > 0) {
        for (const grp of chunk(clusterFiles)) {
          restClusterGroups.push({ cluster: c, files: grp });
        }
      }
    }

    const parsedSpec = parseSpecDocument(specText);
    const total = foundationGroups.length + restClusterGroups.length;
    const stamp = Date.now();
    const nodes: DAGNode[] = [];
    const microbriefs: MicrobriefAndReportDocument[] = [];
    let n = 0;

    // Extrai REQs declarados na Spec ou gera REQs determinísticos (1 por etapa de implementação)
    const declaredReqs =
      parsedSpec?.requisitos && parsedSpec.requisitos.length > 0
        ? parsedSpec.requisitos
        : [];

    const allReqsForSpec =
      declaredReqs.length > 0
        ? declaredReqs.map((r) => r.id)
        : Array.from({ length: Math.max(1, total) }, (_, idx) => `REQ-${String(idx + 1).padStart(3, "0")}`);

    if (declaredReqs.length === 0) {
      TelemetryLogger.log({
        sessionId,
        action: "REQ_SINTETIZADOS",
        details: {
          titulo: titulo || parsedSpec?.titulo || null,
          synthesizedReqs: allReqsForSpec,
          filesCount: unique.length,
        },
      });
    }

    const groupsInOrder: string[][] = [...foundationGroups, ...restClusterGroups.map((g) => g.files)];
    const reqCitesFile = (text: string, file: string): boolean => {
      if (text.includes(file)) return true;
      const base = file.split("/").pop() || "";
      return Boolean(base) && !GENERIC_FILE_NAMES.has(base) && text.includes(base);
    };
    const reqOwnerGroup = new Map<string, number>();
    for (const r of declaredReqs) {
      const text = `${r.titulo} ${r.criterio}`;
      for (let g = groupsInOrder.length - 1; g >= 0; g--) {
        if (groupsInOrder[g].some((f) => reqCitesFile(text, f))) {
          reqOwnerGroup.set(r.id, g);
          break;
        }
      }
    }

    const assignReqsForGroup = (
      groupFiles: string[],
      groupIndexZeroBased: number
    ): { ids: string[]; criterios: Record<string, string[]> } => {
      if (declaredReqs.length === 0) {
        const reqId = `REQ-${String(groupIndexZeroBased + 1).padStart(3, "0")}`;
        return {
          ids: [reqId],
          criterios: { [reqId]: [`Implementar integralmente ${shortList(groupFiles)} conforme a Spec.`] },
        };
      }
      // A2.1: cada REQ fica em UMA etapa — a última (na ordem da DAG) que tem um arquivo citado por ele,
      // para os outros arquivos citados estarem em etapas anteriores (dependências). REQ sem arquivo
      // citado vai para a última etapa (garantia de cobertura abaixo). Antes o REQ entrava em toda
      // etapa cujo nome final de arquivo aparecia no texto (`route.ts`), e todas falhavam (teste `934939fc`).
      const chosen = declaredReqs.filter((r) => reqOwnerGroup.get(r.id) === groupIndexZeroBased);
      const criterios: Record<string, string[]> = {};
      for (const c of chosen) {
        criterios[c.id] = [`${c.titulo}: ${c.criterio}`];
      }
      return {
        ids: chosen.map((c) => c.id),
        criterios,
      };
    };

    const projectSlug = (titulo || parsedSpec?.titulo || "projeto").toLowerCase().replace(/[^a-z0-9]+/g, "-");

    const makeNode = (
      groupFiles: string[],
      deps: string[],
      label: string,
      cluster: ClusterKind,
      extraContracts: string[] = []
    ): string => {
      const groupIdx = n;
      n++;
      const id = `task-${label}-${stamp}-${n}`;
      const assigned = assignReqsForGroup(groupFiles, groupIdx);
      const contractFiles = label === "base" ? [] : [...foundation, ...extraContracts];
      const nonScaffoldDeps = deps.filter((d) => !d.startsWith("task-scaffold-"));

      const microbrief: MicrobriefAndReportDocument = {
        documento: "microbrief",
        idMicrobrief: id,
        idMacrobrief: `macro-${stamp}`,
        idProjeto: projectSlug,
        cluster,
        nivelModeloSugerido: "pesado",
        dependeDe: nonScaffoldDeps,
        reqsCobertos: assigned.ids,
        arquivosPermitidos: {
          criar: groupFiles,
          modificar: [],
          lerContratos: contractFiles,
        },
        statusExecucao: "PENDENTE",
        tentativaAtual: 0,
        medidoPeloHarness: {
          compilou: null,
          testes: null,
          arquivosAlterados: [],
        },
        interfacesConsome: contractFiles,
        interfacesProduz: groupFiles.join(", "),
        criteriosAceitePorReq: assigned.criterios,
        registroCumprimento: assigned.ids.map((reqId) => ({
          reqId,
          statusDeclarado: "PENDENTE",
          arquivoLinha: "PENDENTE",
          comoFoiImplementado: "PENDENTE",
        })),
      };
      microbriefs.push(microbrief);

      nodes.push({
        id,
        title: `Etapa ${n}/${total}: ${shortList(groupFiles)}`,
        role: roleForCluster(cluster),
        cluster,
        status: "pending",
        dependencies: deps,
        filesScope: groupFiles,
        mcpScope: "write_file,smart_patch",
        payload: {
          goal: specText,
          titulo,
          step: "implementation",
          nodeFiles: groupFiles,
          cluster,
          reqsCobertos: assigned.ids,
          microbrief,
        },
      });
      return id;
    };

    // M1: base do projeto sem IA (package.json da stack, tsconfig, npm install). Tudo depende
    // dela: sem isso o código das etapas não pode ser compilado.
    const scaffoldId = `task-scaffold-${stamp}`;
    nodes.push({
      id: scaffoldId,
      title: "Base do projeto: dependências e tsconfig (sem IA)",
      role: "scaffold",
      status: "pending",
      dependencies: [],
      filesScope: ["package.json", "tsconfig.json"],
      mcpScope: "",
      payload: { goal: specText, titulo, step: "scaffold", stack },
    });

    const foundationIds = foundationGroups.map((g, i) =>
      makeNode(g, i === 0 ? [scaffoldId] : [nodes[nodes.length - 1].id], "base", "core")
    );
    const lastFoundation = foundationIds.length > 0 ? [foundationIds[foundationIds.length - 1]] : [scaffoldId];
    // A tela consome a API: o frontend espera o backend/integração terminar e recebe o código real
    // das rotas como contrato. Antes rodava em paralelo e adivinhava o formato (teste P2 de 07/10:
    // a API devolvia {erro} e a tela lia {message}, e os dois avaliadores aprovaram).
    const apiIds: string[] = [];
    const apiFiles: string[] = [];
    for (const grp of restClusterGroups) {
      if (grp.cluster === "frontend") {
        makeNode(grp.files, [...lastFoundation, ...apiIds], "impl", grp.cluster, apiFiles);
      } else {
        const id = makeNode(grp.files, lastFoundation, "impl", grp.cluster);
        if (grp.cluster === "backend" || grp.cluster === "integration") {
          apiIds.push(id);
          apiFiles.push(...grp.files);
        }
      }
    }

    // A2.3c: se o REQ de uma etapa cita arquivo de outra etapa que não é ancestral dela, a etapa passa a
    // depender dessa outra (lê o código como contrato) — a regra da T8b fica cumprida sem juntar etapas.
    // Só quando não cria ciclo; com ciclo o erro continua e o plano é reprovado antes de executar.
    // Teste real `934939fc`: os 6 erros restantes eram todos desse tipo (rotas irmãs, telas irmãs).
    {
      const byId = new Map(nodes.map((nd) => [nd.id, nd]));
      const ancestorsOfNode = (id: string): Set<string> => {
        const seen = new Set<string>();
        const stack = [...(byId.get(id)?.dependencies ?? [])];
        while (stack.length > 0) {
          const d = stack.pop()!;
          if (seen.has(d)) continue;
          seen.add(d);
          stack.push(...(byId.get(d)?.dependencies ?? []));
        }
        return seen;
      };
      for (const mb of microbriefs) {
        const owner = byId.get(mb.idMicrobrief);
        if (!owner) continue;
        for (const reqId of mb.reqsCobertos) {
          const r = declaredReqs.find((x) => x.id === reqId);
          if (!r) continue;
          for (const cited of extractFilePathsFromCriteriaText(`${r.titulo} ${r.criterio}`)) {
            const target = nodes.find(
              (nd) => nd.id !== owner.id && nd.payload && (nd.payload as { microbrief?: unknown }).microbrief && pathInStageScope(nd.filesScope ?? [], cited)
            );
            if (!target) continue;
            const ownerAnc = ancestorsOfNode(owner.id);
            if (ownerAnc.has(target.id) || pathInStageScope(owner.filesScope ?? [], cited)) continue;
            if (ancestorsOfNode(target.id).has(owner.id)) continue;
            owner.dependencies = [...(owner.dependencies ?? []), target.id];
            mb.dependeDe = [...mb.dependeDe, target.id];
            const novos = (target.filesScope ?? []).filter((f) => !mb.arquivosPermitidos.lerContratos.includes(f));
            mb.arquivosPermitidos.lerContratos.push(...novos);
            mb.interfacesConsome = [...mb.interfacesConsome, ...novos];
          }
        }
      }
    }

    // Garante que todos os REQs declarados estejam cobertos em pelo menos um Microbrief (Trava T8b)
    if (microbriefs.length > 0) {
      const coveredSet = new Set(microbriefs.flatMap((m) => m.reqsCobertos));
      for (const reqId of allReqsForSpec) {
        if (!coveredSet.has(reqId)) {
          const targetMb = microbriefs[microbriefs.length - 1];
          targetMb.reqsCobertos.push(reqId);
          const foundReq = declaredReqs.find((r) => r.id === reqId);
          const reqDesc = foundReq ? `${foundReq.titulo}: ${foundReq.criterio}` : `Cumprir ${reqId}`;
          targetMb.criteriosAceitePorReq[reqId] = [reqDesc];
          targetMb.registroCumprimento.push({
            reqId,
            statusDeclarado: "PENDENTE",
            arquivoLinha: "PENDENTE",
            comoFoiImplementado: "PENDENTE",
          });
        }
      }
    }

    const clustersEnvolvidos = Array.from(new Set(microbriefs.map((m) => m.cluster)));
    const macrobrief: MacrobriefDocument = {
      documento: "macrobrief",
      idMacrobrief: `macro-${stamp}`,
      idProjeto: projectSlug,
      specVersao: 1,
      requisitosTotais: allReqsForSpec,
      clustersAtivos: clustersEnvolvidos.length > 0 ? clustersEnvolvidos : ["core"],
      microbriefs: microbriefs.map((m) => ({
        id: m.idMicrobrief,
        cluster: m.cluster,
        dependeDe: m.dependeDe,
        arquivos: [...m.arquivosPermitidos.criar, ...m.arquivosPermitidos.modificar],
        reqs: m.reqsCobertos,
      })),
      contratosTypescript: "// Contratos inferidos dos módulos core da Spec",
    };

    const t8bCheck =
      microbriefs.length > 0
        ? validateMacrobriefMechanical(macrobrief, allReqsForSpec, FILES_PER_NODE)
        : { valid: true, errors: [] };

    return {
      goal: specText,
      nodes,
      summary: `Spec decomposta em ${nodes.length} etapas (${foundation.length} arquivos de base, ${rest.length} de funcionalidade) nos clusters [${clustersEnvolvidos.join(", ")}].`,
      macrobrief,
      microbriefs,
      t8bCheck,
    };
  }

  /**
   * A2.2 — Planejamento pela skill `analista` (LLM), conferido por código:
   * 1. O modelo recebe a Spec, a lista de arquivos e, por REQ, os arquivos que o critério cita
   *    (as regras ficam na skill `skills/analista/SKILL.md`, que vai no prompt de sistema);
   * 2. O plano devolvido passa pela T8b inteira (`validatePlanStages`); com erro, volta ao modelo
   *    com a lista exata, até `ANALISTA_MAX_RODADAS` rodadas no total;
   * 3. Plano aprovado → o código monta o Microbrief completo de cada etapa (critérios copiados da Spec
   *    pelo ID do REQ — o modelo não reescreve critério);
   * 4. Sem plano aprovado → reserva: a heurística `decomposeSpec`, que também é conferida antes de
   *    executar (`execution-trigger.ts`). Todo caminho fica na trilha (`ANALISTA_PLAN_*`).
   */
  public static async decomposeWithAnalistaSkill(options: {
    specText: string;
    titulo: string | null;
    files: string[];
    stack?: string[];
    sessionId?: string;
    smartRouter?: any;
    geminiKey?: string | null;
    omniRouteUrl?: string | null;
    omniRouteKey?: string | null;
    skipModel?: boolean;
  }): Promise<DecompositionResult> {
    const { specText, titulo, files, stack = [], sessionId, smartRouter, skipModel } = options;

    const baseDecomp = SpecDecomposerSkill.decomposeSpec(specText, titulo, files, stack, sessionId);

    if (skipModel || !smartRouter) {
      // Ressalva da auditoria do Cursor (17/10): nenhum caminho volta sem trilha.
      TelemetryLogger.log({
        sessionId,
        action: "ANALISTA_PLAN_FALLBACK",
        details: { reason: skipModel ? "modelo_desligado_em_teste" : "sem_roteador" },
      });
      TelemetryLogger.log({
        sessionId,
        action: "CONTRATO_AUSENTE",
        details: { motivo: skipModel ? "skip_model_teste" : "sem_roteador" },
      });
      return baseDecomp;
    }

    const fallback = (reason: string, extra: Record<string, unknown> = {}): DecompositionResult => {
      TelemetryLogger.log({ sessionId, action: "ANALISTA_PLAN_FALLBACK", details: { reason, ...extra } });
      return baseDecomp;
    };

    const parsedSpec = parseSpecDocument(specText);
    const declaredReqs = parsedSpec?.requisitos ?? [];
    if (declaredReqs.length === 0) {
      return fallback("spec_sem_requisitos");
    }
    const uniqueFiles = Array.from(new Set(files.map((f) => f.trim()).filter(Boolean)));
    const reqIds = declaredReqs.map((r) => r.id);
    const textoPorReq = Object.fromEntries(declaredReqs.map((r) => [r.id, `${r.titulo} ${r.criterio}`]));

    let systemPrompt: string;
    try {
      systemPrompt = buildSkillSystemPrompt(loadRoleSkill("analista"));
    } catch (err) {
      return fallback("skill_analista_indisponivel", { error: err instanceof Error ? err.message : String(err) });
    }

    const userPrompt = [
      `ARQUIVOS DO PROJETO (${uniqueFiles.length}) — cada um em exatamente uma etapa, no máximo ${FILES_PER_NODE} por etapa:`,
      ...uniqueFiles.map((f) => `- ${f}`),
      "",
      `REQUISITOS (${declaredReqs.length}) — cada um em exatamente uma etapa:`,
      ...declaredReqs.map((r) => {
        const citados = extractFilePathsFromCriteriaText(textoPorReq[r.id]);
        return `- ${r.id}: ${r.titulo} — arquivos citados: ${citados.length > 0 ? citados.join(", ") : "nenhum"}`;
      }),
      "",
      "--- SPEC CANÔNICA ---",
      specText,
    ].join("\n");

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    for (let rodada = 1; rodada <= ANALISTA_MAX_RODADAS; rodada++) {
      let content = "";
      let modelUsed = "";
      let finishReason = "";
      let reasoningChars = 0;
      let semResposta = false;
      try {
        const dispatchRes = await smartRouter.dispatchWithFallback({
          messages,
          tier: "heavy",
          maxTokens: ANALISTA_MAX_TOKENS,
          geminiKey: options.geminiKey,
          omniRouteUrl: options.omniRouteUrl,
          omniRouteKey: options.omniRouteKey,
          stream: false,
          gatewayTimeoutMs: Number(process.env.ANALISTA_TIMEOUT_MS) || ANALISTA_TIMEOUT_MS,
          signal: AbortSignal.timeout((Number(process.env.ANALISTA_TIMEOUT_MS) || ANALISTA_TIMEOUT_MS) + 10_000),
        });
        const resJson = await dispatchRes.response.json().catch(() => ({}));
        // R2 (21/10): corpo cortado pelo prazo vira `{}` — sem `choices` e sem `usage`. Não é erro de formato.
        semResposta = !Array.isArray(resJson.choices);
        content = resJson.choices?.[0]?.message?.content || "";
        finishReason = String(resJson.choices?.[0]?.finish_reason || "");
        reasoningChars = String(resJson.choices?.[0]?.message?.reasoning_content || "").length;
        modelUsed = String(dispatchRes.modelUsed || "");
        await recordLlmCost({
          sessionId,
          papel: "analista",
          provider: String(dispatchRes.providerUsed),
          model: modelUsed,
          usage: resJson.usage,
        });
      } catch (err) {
        return fallback("exception_or_offline", { rodada, error: err instanceof Error ? err.message : String(err) });
      }

      if (semResposta) {
        // Repete o mesmo pedido: anexar "(resposta vazia)" + reclamação de formato só alongava o prompt
        // e enganava a trilha (teste pesado 314176ef: 2 rodadas cortadas em 300 s gravadas como [FORMATO]).
        TelemetryLogger.log({
          sessionId,
          action: "ANALISTA_PLAN_RETRY",
          details: { rodada, model: modelUsed, motivo: "sem_resposta", custoNaoMedido: true },
        });
        continue;
      }

      const parsed = parseAnalystPlan(content);
      const stageErrors = parsed.ok
        ? validatePlanStages(parsed.stages, reqIds, textoPorReq, FILES_PER_NODE, uniqueFiles).errors
        : [
            finishReason === "length"
              ? "[CORTADA] A resposta chegou ao limite de tokens antes de o JSON terminar. Pense pouco, não explique e não repita a Spec: responda só o JSON."
              : parsed.error,
          ];

      const contractErrors: string[] = [];
      if (parsed.ok) {
        if (!parsed.contrato) {
          contractErrors.push('[CONTRATO AUSENTE] O JSON do analista deve conter o bloco "contrato" com entidades, enums, funcoes e rotas.');
        } else {
          contractErrors.push(...validateContract(parsed.contrato, parsed.stages));
        }
      }

      const errors = [...stageErrors, ...contractErrors];

      if (parsed.ok && errors.length === 0 && parsed.contrato) {
        const result = buildDecompositionFromAnalystPlan({
          stages: parsed.stages,
          clusters: parsed.clusters,
          specText,
          titulo: titulo ?? parsedSpec?.titulo ?? null,
          declaredReqs,
          scaffold: baseDecomp.nodes.find((n) => (n.payload as { step?: string } | undefined)?.step === "scaffold"),
          contrato: parsed.contrato,
        });

        const cntEnt = parsed.contrato.entidades?.length ?? 0;
        const cntEnum = parsed.contrato.enums?.length ?? 0;
        const cntFn = parsed.contrato.funcoes?.length ?? 0;
        const cntRt = parsed.contrato.rotas?.length ?? 0;

        TelemetryLogger.log({
          sessionId,
          action: "ANALISTA_PLAN_APPROVED",
          details: {
            rodada,
            etapas: parsed.stages.length,
            model: modelUsed,
            t8bValid: true,
            entidades: cntEnt,
            enums: cntEnum,
            funcoes: cntFn,
            rotas: cntRt,
          },
        });
        return result;
      }

      TelemetryLogger.log({
        sessionId,
        action: "ANALISTA_PLAN_RETRY",
        details: {
          rodada,
          model: modelUsed,
          finishReason,
          contentChars: content.length,
          reasoningChars,
          erros: errors.length,
          amostra: errors.slice(0, 20),
        },
      });
      messages.push({ role: "assistant", content: content || "(resposta vazia)" });
      messages.push({
        role: "user",
        content:
          `A conferência do NextCode reprovou o plano (rodada ${rodada} de ${ANALISTA_MAX_RODADAS}). ` +
          "Corrija TODOS os erros abaixo e devolva o plano INTEIRO, só o JSON:\n" +
          errors.slice(0, 40).map((e) => `- ${e}`).join("\n") +
          (errors.length > 40 ? `\n- … e mais ${errors.length - 40}` : ""),
      });
    }

    TelemetryLogger.log({
      sessionId,
      action: "PLANO_REPROVADO",
      details: { motivo: "rodadas_esgotadas", rodadas: ANALISTA_MAX_RODADAS, dono: "analista" },
    });
    return fallback("rodadas_esgotadas", { rodadas: ANALISTA_MAX_RODADAS });
  }

  /**
   * Inferência Dinâmica de Escopo de Arquivos (Sem limites hardcoded estáticos).
   * Projetada para decompor a árvore completa de módulos para QUALQUER tecnologia ou objetivo do mundo.
   */
  public static inferDynamicFilesScope(goal: string): string[] {
    const extracted = extractFilePathsFromText(goal);
    if (extracted.length > 0) {
      return extracted;
    }
    const set = new Set<string>();

    const goalLower = goal.toLowerCase();

    // Identifica o domínio primário do pedido para nomear os módulos
    const domainMatch = goalLower.match(/(?:asaas|stripe|mercadopago|pix|pagamento|gateway|auth|usuario|produto|financeiro|webhook|api|dashboard|[a-z0-9_-]{3,})/i);
    const domain = domainMatch ? domainMatch[0].toLowerCase() : "module";

    if (
      goalLower.includes("pagamento") ||
      goalLower.includes("gateway") ||
      goalLower.includes("asaas") ||
      goalLower.includes("stripe") ||
      goalLower.includes("mercadopago") ||
      goalLower.includes("pix")
    ) {
      set.add(`src/services/${domain}/client.ts`);
      set.add(`src/services/${domain}/customers.ts`);
      set.add(`src/services/${domain}/payments.ts`);
      set.add(`src/services/${domain}/subscriptions.ts`);
      set.add(`src/app/api/webhooks/${domain}/route.ts`);
      set.add(`src/app/dashboard/${domain}/page.tsx`);
      set.add(`prisma/schema.prisma`);
    } else if (goalLower.includes("auth") || goalLower.includes("login") || goalLower.includes("usuario")) {
      set.add(`src/services/auth.ts`);
      set.add(`src/app/api/auth/route.ts`);
      set.add(`src/app/auth/page.tsx`);
      set.add(`prisma/schema.prisma`);
    } else {
      set.add(`src/services/${domain}.ts`);
      set.add(`src/app/api/${domain}/route.ts`);
      set.add(`src/app/${domain}/page.tsx`);
      set.add(`prisma/schema.prisma`);
    }

    return Array.from(set);
  }

  /**
   * Skill de decomposição de objetivos em nós encadeados de DAG com dependências explícitas e escopo dinâmico
   */
  public static decompose(
    goal: string,
    scopeContext?: string,
    filesScopeOverride?: string[]
  ): DecompositionResult {
    const nodes: DAGNode[] = [];
    // Prioridade: (1) arquivos_afetados já declarados na Spec Canônica aprovada
    // pelo usuário (fonte de verdade real, dinâmica por projeto, sem keyword-sniffing);
    // (2) caminhos de arquivo explícitos no texto do goal; (3) heurística de domínio
    // como último recurso, quando nenhuma das duas fontes acima existe.
    const devFilesScope =
      filesScopeOverride && filesScopeOverride.length > 0
        ? filesScopeOverride
        : SpecDecomposerSkill.inferDynamicFilesScope(goal);

    // Nó 1: Análise e Planejamento Arquitetural
    const planNodeId = `task-plan-${Date.now()}`;
    nodes.push({
      id: planNodeId,
      title: `Análise e Especificação: ${goal.substring(0, 40)}...`,
      role: "architect",
      status: "pending",
      dependencies: [],
      filesScope: ["docs/spec-architecture.md"],
      mcpScope: "read_file,grep_search",
      payload: { goal, context: scopeContext, step: "architecture" },
    });

    // Nó 2: Implementação / Desenvolvimento do Core
    const implNodeId = `task-impl-${Date.now() + 1}`;
    nodes.push({
      id: implNodeId,
      title: `Desenvolvimento dos Componentes e APIs`,
      role: "developer",
      status: "pending",
      dependencies: [planNodeId],
      filesScope: devFilesScope,
      mcpScope: "write_file,smart_patch",
      payload: { goal, context: scopeContext, step: "implementation" },
    });

    // Nó 3: Testes e Validação de Segurança
    const testNodeId = `task-test-${Date.now() + 2}`;
    nodes.push({
      id: testNodeId,
      title: `Testes de Unidade, Integração e Verificação`,
      role: "qa_engineer",
      status: "pending",
      dependencies: [implNodeId],
      filesScope: ["tests/verification.spec.ts"],
      mcpScope: "sandboxed_terminal",
      payload: { goal, context: scopeContext, step: "verification" },
    });

    return {
      goal,
      nodes,
      summary: `Objetivo decomposto em ${nodes.length} etapas sequenciais com Grafo Direcionado Acíclico (DAG) e escopo dinâmico (${devFilesScope.length} arquivos).`,
    };
  }
}

/** A2.2 — rodadas do analista (1 plano + 2 correções com a lista de erros da T8b). */
const ANALISTA_MAX_RODADAS = 3;
/**
 * Teto de saída do analista. O plano da Spec real (58 arquivos, 43 REQ) tem ~4 mil tokens, mas o
 * `deepseek-v4-pro` conta o raciocínio na saída: no replay A2.3 as 3 rodadas com 16.000 pararam em
 * `length` sem JSON (US$ 0,21). 32.000 dá folga ao raciocínio.
 */
const ANALISTA_MAX_TOKENS = 32000;
/**
 * Tempo de cada chamada do analista. Antes: 5 s (nunca dava tempo; 0 `ANALISTA_PLAN_*` no banco).
 * Replay A2.3: 16 mil tokens de saída levaram 90–104 s; com 32 mil o teto fixo de 120 s do gateway cortou.
 * R2 (21/10): 300 s cortou 2 de 3 rodadas no teste pesado `314176ef` (a 3ª: 26 mil tokens em 222 s);
 * 32 mil tokens no ritmo das rodadas cortadas passam de 300 s → 600 s.
 */
const ANALISTA_TIMEOUT_MS = 600_000;

const ANALYST_CLUSTERS: ClusterKind[] = ["core", "backend", "integration", "frontend"];

export type AnalystPlanParse =
  | { ok: true; stages: PlanStage[]; clusters: Record<string, ClusterKind>; contrato?: ContratoProjeto }
  | { ok: false; error: string };

/** Lê o JSON do analista. Formato e tipos errados viram um erro só, devolvido ao modelo. */
export function parseAnalystPlan(content: string): AnalystPlanParse {
  const match = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/(\{[\s\S]*"microbriefs"[\s\S]*\})/);
  if (!match) return { ok: false, error: '[FORMATO] A resposta não tem o JSON {"microbriefs": [...]}.' };
  let raw: any;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return { ok: false, error: "[FORMATO] O JSON da resposta é inválido (não abre com JSON.parse)." };
  }
  if (!Array.isArray(raw?.microbriefs) || raw.microbriefs.length === 0) {
    return { ok: false, error: '[FORMATO] "microbriefs" ausente ou vazio.' };
  }
  const stages: PlanStage[] = [];
  const clusters: Record<string, ClusterKind> = {};
  const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
  for (const [i, m] of raw.microbriefs.entries()) {
    const id = typeof m?.id === "string" && m.id.trim() ? m.id.trim() : "";
    if (!id) return { ok: false, error: `[FORMATO] A etapa na posição ${i + 1} não tem "id".` };
    if (clusters[id]) return { ok: false, error: `[FORMATO] O id "${id}" aparece em mais de uma etapa.` };
    if (!ANALYST_CLUSTERS.includes(m.cluster)) {
      return { ok: false, error: `[FORMATO] Etapa "${id}": cluster "${m?.cluster}" inválido (use ${ANALYST_CLUSTERS.join(", ")}).` };
    }
    if (!isStrList(m.arquivos) || !isStrList(m.reqs ?? []) || !isStrList(m.dependeDe ?? [])) {
      return { ok: false, error: `[FORMATO] Etapa "${id}": "arquivos", "reqs" e "dependeDe" têm de ser listas de texto.` };
    }
    clusters[id] = m.cluster;
    stages.push({
      id,
      arquivos: m.arquivos.map((f: string) => f.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").trim()),
      reqs: (m.reqs ?? []).map((r: string) => r.trim().toUpperCase()),
      dependeDe: (m.dependeDe ?? []).map((d: string) => d.trim()),
    });
  }

  // Bloco de contrato (opcional no parse preliminar, validado em seguida)
  let contrato: ContratoProjeto | undefined = undefined;
  if (raw.contrato && typeof raw.contrato === "object") {
    contrato = {
      entidades: Array.isArray(raw.contrato.entidades) ? raw.contrato.entidades : [],
      enums: Array.isArray(raw.contrato.enums) ? raw.contrato.enums : [],
      funcoes: Array.isArray(raw.contrato.funcoes) ? raw.contrato.funcoes : [],
      rotas: Array.isArray(raw.contrato.rotas) ? raw.contrato.rotas : [],
    };
  }

  return { ok: true, stages, clusters, contrato };
}

/** Ordem topológica (o plano já passou pela T8b, então não há ciclo). */
function topoOrder(stages: PlanStage[]): PlanStage[] {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const done = new Set<string>();
  const out: PlanStage[] = [];
  const visit = (s: PlanStage) => {
    if (done.has(s.id)) return;
    done.add(s.id);
    for (const d of s.dependeDe) {
      const dep = byId.get(d);
      if (dep) visit(dep);
    }
    out.push(s);
  };
  stages.forEach(visit);
  return out;
}

/** Monta nós e Microbriefs completos a partir do plano aprovado do analista (mesmo formato da heurística). */
export function buildDecompositionFromAnalystPlan(params: {
  stages: PlanStage[];
  clusters: Record<string, ClusterKind>;
  specText: string;
  titulo: string | null;
  declaredReqs: { id: string; titulo: string; criterio: string }[];
  scaffold?: DAGNode;
  contrato?: ContratoProjeto;
}): DecompositionResult {
  const { specText, titulo, declaredReqs, contrato } = params;
  const ordered = topoOrder(params.stages);
  const stamp = Date.now();
  const projectSlug = (titulo || "projeto").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const scaffold: DAGNode =
    params.scaffold ?? {
      id: `task-scaffold-${stamp}`,
      title: "Base do projeto: dependências e tsconfig (sem IA)",
      role: "scaffold",
      status: "pending",
      dependencies: [],
      filesScope: ["package.json", "tsconfig.json"],
      mcpScope: "",
      payload: { goal: specText, titulo, step: "scaffold" },
    };
  const idOf = new Map(ordered.map((s, i) => [s.id, `task-analista-${stamp}-${i + 1}`]));
  const byId = new Map(ordered.map((s) => [s.id, s]));
  const ancestorFiles = (s: PlanStage): string[] => {
    const seen = new Set<string>();
    const files: string[] = [];
    const stack = [...s.dependeDe];
    while (stack.length > 0) {
      const d = stack.pop()!;
      if (seen.has(d)) continue;
      seen.add(d);
      const dep = byId.get(d);
      if (!dep) continue;
      files.push(...dep.arquivos);
      stack.push(...dep.dependeDe);
    }
    return Array.from(new Set(files));
  };

  const nodes: DAGNode[] = [scaffold];
  const microbriefs: MicrobriefAndReportDocument[] = [];
  ordered.forEach((s, i) => {
    const id = idOf.get(s.id)!;
    const cluster = params.clusters[s.id];
    const deps = s.dependeDe.map((d) => idOf.get(d)!).filter(Boolean);
    const contratos = ancestorFiles(s);
    const criterios: Record<string, string[]> = {};
    for (const reqId of s.reqs) {
      const r = declaredReqs.find((x) => x.id === reqId);
      criterios[reqId] = [r ? `${r.titulo}: ${r.criterio}` : `Cumprir ${reqId}`];
    }

    // Fatia do contrato para a etapa: se houver contrato formal, gera fatias TS
    let interfacesProduz = s.arquivos.join(", ");
    let interfacesConsome: string[] = contratos;
    if (contrato) {
      const slice = renderContractSliceTs(contrato, s.id);
      if (slice.interfacesProduz.trim()) {
        interfacesProduz = slice.interfacesProduz;
      }
      if (slice.interfacesConsome.length > 0) {
        interfacesConsome = slice.interfacesConsome;
      }
    }

    const microbrief: MicrobriefAndReportDocument = {
      documento: "microbrief",
      idMicrobrief: id,
      idMacrobrief: `macro-analista-${stamp}`,
      idProjeto: projectSlug,
      cluster,
      nivelModeloSugerido: "pesado",
      dependeDe: deps,
      reqsCobertos: [...s.reqs],
      arquivosPermitidos: { criar: [...s.arquivos], modificar: [], lerContratos: contratos },
      statusExecucao: "PENDENTE",
      tentativaAtual: 0,
      medidoPeloHarness: { compilou: null, testes: null, arquivosAlterados: [] },
      interfacesConsome,
      interfacesProduz,
      criteriosAceitePorReq: criterios,
      registroCumprimento: s.reqs.map((reqId) => ({
        reqId,
        statusDeclarado: "PENDENTE",
        arquivoLinha: "PENDENTE",
        comoFoiImplementado: "PENDENTE",
      })),
    };
    microbriefs.push(microbrief);
    nodes.push({
      id,
      title: `Etapa ${i + 1}/${ordered.length}: ${shortList(s.arquivos)}`,
      role: roleForCluster(cluster),
      cluster,
      status: "pending",
      dependencies: deps.length > 0 ? deps : [scaffold.id],
      filesScope: [...s.arquivos],
      mcpScope: "write_file,smart_patch",
      payload: {
        goal: specText,
        titulo,
        step: "implementation",
        nodeFiles: [...s.arquivos],
        cluster,
        reqsCobertos: [...s.reqs],
        microbrief,
      },
    });
  });

  const contratosTypescript = contrato
    ? renderContractTs(contrato)
    : "// Contratos: arquivos das etapas de que cada etapa depende (lerContratos)";

  const macrobrief: MacrobriefDocument = {
    documento: "macrobrief",
    idMacrobrief: `macro-analista-${stamp}`,
    idProjeto: projectSlug,
    specVersao: 1,
    requisitosTotais: declaredReqs.map((r) => r.id),
    clustersAtivos: Array.from(new Set(Object.values(params.clusters))),
    microbriefs: microbriefs.map((m) => ({
      id: m.idMicrobrief,
      cluster: m.cluster,
      dependeDe: m.dependeDe,
      arquivos: m.arquivosPermitidos.criar,
      reqs: m.reqsCobertos,
    })),
    contratosTypescript,
  };

  return {
    goal: specText,
    nodes,
    summary: `Spec planejada pelo Analista em ${ordered.length} etapas, aprovada pela Trava T8b.`,
    macrobrief,
    microbriefs,
    t8bCheck: { valid: true, errors: [] },
  };
}
