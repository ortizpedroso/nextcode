import { DAGNode } from "../dag/dag-engine";

export interface DecompositionResult {
  goal: string;
  nodes: DAGNode[];
  summary: string;
}

export class SpecDecomposerSkill {
  /**
   * Skill de decomposição de objetivos em nós encadeados de DAG com dependências explícitas
   */
  public static decompose(goal: string, scopeContext?: string): DecompositionResult {
    const nodes: DAGNode[] = [];

    const goalLower = goal.toLowerCase();
    let devFilesScope: string[] = [];
    if (goalLower.includes("asaas") || goalLower.includes("pagamento")) {
      devFilesScope = ["src/services/asaas.ts", "src/app/api/webhooks/asaas/route.ts"];
    } else if (goalLower.includes("produto") || goalLower.includes("product")) {
      devFilesScope = ["src/app/dashboard/products/page.tsx"];
    } else if (goalLower.includes("financeiro") || goalLower.includes("financial")) {
      devFilesScope = ["src/app/dashboard/financial/page.tsx"];
    } else {
      devFilesScope = ["src/app/page.tsx", "src/core/engine.ts"];
    }

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
      summary: `Objetivo decomposto em ${nodes.length} etapas sequenciais com Grafo Direcionado Acíclico (DAG).`,
    };
  }
}
