import { DAGNode } from "../dag/dag-engine";
import { extractFilePathsFromText } from "../shared/file-path-extractor";

export interface DecompositionResult {
  goal: string;
  nodes: DAGNode[];
  summary: string;
}

export { extractFilePathsFromText };

/** Arquivos que os demais importam: implementados primeiro, numa etapa própria. */
const FOUNDATION_RE =
  /(^|\/)(prisma\/|schema\.prisma$|package\.json$|tsconfig\.json$|next\.config|tailwind\.config|postcss\.config|\.env|middleware\.ts$|lib\/|types?\/|config\/|utils?\/)/i;

/** Arquivos por etapa: uma resposta de LLM precisa caber o código COMPLETO de todos. */
const FILES_PER_NODE = 4;

function shortList(files: string[]): string {
  const names = files.map((f) => f.split("/").slice(-2).join("/"));
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}

export class SpecDecomposerSkill {
  /**
   * DAG a partir da Spec Canônica aprovada: uma etapa por grupo pequeno de arquivos de
   * `arquivos_afetados`, com a base (schema, lib, tipos, config) primeiro e as demais
   * dependendo dela. Cada etapa carrega a Spec inteira como contexto e a lista exata do que
   * ela implementa (payload.nodeFiles) — o Auditor Cego julga só essa parte.
   *
   * Substitui o trio fixo "Análise / Desenvolvimento / Testes" para Specs com arquivos: a
   * etapa de "Análise" gerava um .md e era reprovada por "não implementar a Spec inteira"
   * (sessão gateway, 06/10), e a de "Desenvolvimento" pedia 15-30 arquivos numa resposta só.
   */
  public static decomposeSpec(specText: string, titulo: string | null, files: string[]): DecompositionResult {
    const unique = Array.from(new Set(files.map((f) => f.trim()).filter(Boolean)));
    const foundation = unique.filter((f) => FOUNDATION_RE.test(f));
    const rest = unique.filter((f) => !FOUNDATION_RE.test(f)).sort();

    const chunk = (list: string[]) => {
      const out: string[][] = [];
      for (let i = 0; i < list.length; i += FILES_PER_NODE) out.push(list.slice(i, i + FILES_PER_NODE));
      return out;
    };
    const foundationGroups = chunk(foundation);
    const restGroups = chunk(rest);
    const total = foundationGroups.length + restGroups.length;
    const stamp = Date.now();
    const nodes: DAGNode[] = [];
    let n = 0;

    const makeNode = (groupFiles: string[], deps: string[], label: string): string => {
      n++;
      const id = `task-${label}-${stamp}-${n}`;
      nodes.push({
        id,
        title: `Etapa ${n}/${total}: ${shortList(groupFiles)}`,
        role: label === "base" ? "architect" : "developer",
        status: "pending",
        dependencies: deps,
        filesScope: groupFiles,
        mcpScope: "write_file,smart_patch",
        payload: { goal: specText, titulo, step: "implementation", nodeFiles: groupFiles },
      });
      return id;
    };

    const foundationIds = foundationGroups.map((g, i) =>
      makeNode(g, i === 0 ? [] : [nodes[nodes.length - 1].id], "base")
    );
    const lastFoundation = foundationIds.length > 0 ? [foundationIds[foundationIds.length - 1]] : [];
    for (const g of restGroups) makeNode(g, lastFoundation, "impl");

    return {
      goal: specText,
      nodes,
      summary: `Spec decomposta em ${nodes.length} etapas (${foundation.length} arquivos de base, ${rest.length} de funcionalidade).`,
    };
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
