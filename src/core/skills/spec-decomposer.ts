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
      const matched = declaredReqs.filter((r) => {
        const fullText = `${r.titulo} ${r.criterio}`;
        return groupFiles.some((gf) => fullText.includes(gf) || fullText.includes(gf.split("/").pop() || ""));
      });
      const chosen =
        matched.length > 0
          ? matched
          : [declaredReqs[groupIndexZeroBased % declaredReqs.length]];
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
   * Decomposição com o modelo LLM da skill `analista` (Item 4 do PLANO-DE-ACAO):
   * 1. Consulta o modelo forte da skill `analista` (skills/analista/SKILL.md);
   * 2. Submete os Microbriefs propostos à Trava T8b mecânica (validateMacrobriefMechanical);
   * 3. Se aprovado pela Trava T8b, adota o particionamento do Analista;
   * 4. Se falhar na Trava T8b ou se o modelo estiver offline, faz fallback gracioso para decomposeSpec.
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

    const baseDecomp = SpecDecomposerSkill.decomposeSpec(
      specText,
      titulo,
      files,
      stack,
      sessionId
    );

    if (skipModel || !smartRouter) {
      return baseDecomp;
    }

    try {
      const analistaSkill = loadRoleSkill("analista");
      const systemPrompt = buildSkillSystemPrompt(analistaSkill);
      const prompt = [
        `Você é o Analista arquitetural. Analise a Spec Canônica abaixo e proponha a divisão em Microbriefs por cluster (core, backend, frontend, integration).`,
        `DIRETRIZES DA TRAVA T8b:`,
        `1. Todo requisito REQ-xxx declarado na Spec DEVE estar coberto em pelo menos um Microbrief.`,
        `2. Cada arquivo do projeto DEVE pertencer a EXATAMENTE UM Microbrief (partição disjunta; proibido dois executores no mesmo arquivo).`,
        `3. A DAG deve ser sem ciclos: cluster core (contratos/schemas) na Onda 1 (dependeDe: []), e demais clusters nas ondas seguintes.`,
        `4. Retorne EXCLUSIVAMENTE um bloco JSON no formato:`,
        `\`\`\`json`,
        `{`,
        `  "microbriefs": [`,
        `    {`,
        `      "id": "mb-core-1",`,
        `      "cluster": "core",`,
        `      "arquivos": ["prisma/schema.prisma"],`,
        `      "reqs": ["REQ-001"],`,
        `      "dependeDe": [],`,
        `      "contratosTypescript": "// interfaces core"`,
        `    }`,
        `  ]`,
        `}`,
        `\`\`\``,
        `\n--- SPEC CANÔNICA ---\n${specText}`,
      ].join("\n");

      const dispatchRes = await smartRouter.dispatchWithFallback({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        tier: "heavy",
        maxTokens: 4096,
        geminiKey: options.geminiKey,
        omniRouteUrl: options.omniRouteUrl,
        omniRouteKey: options.omniRouteKey,
        stream: false,
        signal: AbortSignal.timeout(5000),
      });

      const resJson = await dispatchRes.response.json().catch(() => ({}));
      const content = resJson.choices?.[0]?.message?.content || "";
      const jsonMatch =
        content.match(/```json\s*([\s\S]*?)\s*```/) ||
        content.match(/(\{[\s\S]*"microbriefs"[\s\S]*\})/);

      if (jsonMatch) {
        const rawParsed = JSON.parse(jsonMatch[1]);
        if (Array.isArray(rawParsed.microbriefs) && rawParsed.microbriefs.length > 0) {
          const macrobrief: MacrobriefDocument = {
            documento: "macrobrief",
            idMacrobrief: `macro-analista-${Date.now()}`,
            idProjeto: (titulo || "projeto").toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
            specVersao: 1,
            requisitosTotais: baseDecomp.macrobrief?.requisitosTotais || [],
            clustersAtivos: Array.from(new Set(rawParsed.microbriefs.map((m: any) => m.cluster))),
            microbriefs: rawParsed.microbriefs.map((m: any) => ({
              id: m.id,
              cluster: m.cluster,
              dependeDe: Array.isArray(m.dependeDe) ? m.dependeDe : [],
              arquivos: Array.isArray(m.arquivos) ? m.arquivos : [],
              reqs: Array.isArray(m.reqs) ? m.reqs : [],
            })),
            contratosTypescript: "// Contratos propostos pelo Analista",
          };

          const t8bCheck = validateMacrobriefMechanical(
            macrobrief,
            macrobrief.requisitosTotais,
            FILES_PER_NODE
          );

          if (t8bCheck.valid) {
            const nodes: DAGNode[] = macrobrief.microbriefs.map((mb, idx) => ({
              id: `task-analista-${mb.id}`,
              title: `Etapa ${idx + 1} (${mb.cluster}): ${mb.arquivos.slice(0, 2).join(", ")}`,
              role: roleForCluster(mb.cluster),
              status: "pending",
              dependencies: mb.dependeDe.map((d: string) => `task-analista-${d}`),
              filesScope: mb.arquivos,
              mcpScope: "write_file,edit_file,run_check,finish",
              payload: {
                step: `analista_step_${idx + 1}`,
                cluster: mb.cluster,
                reqs: mb.reqs,
                files: mb.arquivos,
                macrobriefId: macrobrief.idMacrobrief,
              },
            }));

            TelemetryLogger.log({
              sessionId,
              action: "ANALISTA_PLAN_APPROVED",
              details: {
                microbriefsCount: nodes.length,
                clusters: macrobrief.clustersAtivos,
                t8bValid: true,
              },
            });

            return {
              goal: specText,
              nodes,
              summary: `Spec decomposta com sucesso pelo Analista LLM em ${nodes.length} etapas, aprovada pela Trava T8b.`,
              macrobrief,
              t8bCheck,
            };
          } else {
            TelemetryLogger.log({
              sessionId,
              action: "ANALISTA_PLAN_FALLBACK",
              details: {
                reason: "t8b_validation_failed",
                errors: t8bCheck.errors,
              },
            });
          }
        }
      }
    } catch (err) {
      TelemetryLogger.log({
        sessionId,
        action: "ANALISTA_PLAN_FALLBACK",
        details: {
          reason: "exception_or_offline",
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }

    return baseDecomp;
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
