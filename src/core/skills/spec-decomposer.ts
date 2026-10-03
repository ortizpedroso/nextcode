import { DAGNode } from "../dag/dag-engine";
import { extractFilePathsFromText } from "../shared/file-path-extractor";

export interface DecompositionResult {
  goal: string;
  nodes: DAGNode[];
  summary: string;
}

export { extractFilePathsFromText };

export class SpecDecomposerSkill {
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
  public static decompose(goal: string, scopeContext?: string): DecompositionResult {
    const nodes: DAGNode[] = [];
    const devFilesScope = SpecDecomposerSkill.inferDynamicFilesScope(goal);

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
