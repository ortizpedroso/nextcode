export type TaskStatus = "pending" | "standby" | "running" | "quarantine" | "completed" | "failed" | "blocked";

export interface DAGNode {
  id: string;
  title: string;
  role: string;
  cluster?: "core" | "backend" | "frontend" | "integration";
  filesScope?: string[];
  attempts?: number;
  maxAttempts?: number;
  quarantinePath?: string;
  status: TaskStatus;
  dependencies: string[]; // Lista de IDs de nós de que esta tarefa depende
  mcpScope?: string;
  payload?: Record<string, unknown> | string;
  result?: Record<string, unknown> | string;
}

export interface DAGExecutionResult {
  executedNodeId: string;
  status: TaskStatus;
  output?: unknown;
  error?: string;
}

export class DAGEngine {
  private nodes: Map<string, DAGNode>;

  constructor(nodes: DAGNode[] = []) {
    this.nodes = new Map();
    for (const node of nodes) {
      this.nodes.set(node.id, {
        ...node,
        cluster: node.cluster || "backend",
        filesScope: node.filesScope || [],
        attempts: node.attempts || 0,
        maxAttempts: node.maxAttempts || 3,
        dependencies: [...node.dependencies],
      });
    }
  }

  /**
   * Verifica se dois nós possuem intersecção de arquivos no filesScope
   */
  public hasScopeCollision(nodeA: DAGNode, nodeB: DAGNode): boolean {
    if (!nodeA.filesScope || !nodeB.filesScope) return false;
    const scopeB = new Set(nodeB.filesScope);
    return nodeA.filesScope.some((file) => scopeB.has(file));
  }

  /**
   * Adiciona um nó ao grafo DAG
   */
  public addNode(node: DAGNode): void {
    this.nodes.set(node.id, {
      ...node,
      cluster: node.cluster || "backend",
      filesScope: node.filesScope || [],
      attempts: node.attempts || 0,
      maxAttempts: node.maxAttempts || 3,
      dependencies: [...node.dependencies],
    });
  }

  /**
   * Obtém todos os nós atualmente registrados no grafo
   */
  public getNodes(): DAGNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Obtém um nó específico pelo seu ID
   */
  public getNode(id: string): DAGNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Valida se o grafo é um Grafo Direcionado Acíclico (DAG) e não contém ciclos
   */
  public detectCycles(): { hasCycle: boolean; cycleNodes?: string[] } {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycleNodes: string[] = [];

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        for (const depId of node.dependencies) {
          if (!visited.has(depId)) {
            if (dfs(depId)) {
              cycleNodes.push(nodeId);
              return true;
            }
          } else if (recursionStack.has(depId)) {
            cycleNodes.push(nodeId);
            cycleNodes.push(depId);
            return true;
          }
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) {
          return { hasCycle: true, cycleNodes };
        }
      }
    }

    return { hasCycle: false };
  }

  /**
   * Realiza a ordenação topológica dos nós utlizando o algoritmo de Kahn
   */
  public topologicalSort(): DAGNode[] {
    const { hasCycle } = this.detectCycles();
    if (hasCycle) {
      throw new Error("Ciclo detectado no grafo de tarefas! Ordenação topológica impossível.");
    }

    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const nodeId of this.nodes.keys()) {
      inDegree.set(nodeId, 0);
      adjacency.set(nodeId, []);
    }

    // Monta o grau de entrada (inDegree) e a lista de adjacência invertida (depId -> nodeId)
    for (const [nodeId, node] of this.nodes.entries()) {
      for (const depId of node.dependencies) {
        if (this.nodes.has(depId)) {
          const dependents = adjacency.get(depId) || [];
          dependents.push(nodeId);
          adjacency.set(depId, dependents);
          inDegree.set(nodeId, (inDegree.get(nodeId) || 0) + 1);
        }
      }
    }

    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(nodeId);
      }
    }

    const sorted: DAGNode[] = [];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentNode = this.nodes.get(currentId);
      if (currentNode) {
        sorted.push(currentNode);
      }

      const neighbors = adjacency.get(currentId) || [];
      for (const neighborId of neighbors) {
        const currentDegree = inDegree.get(neighborId) || 0;
        inDegree.set(neighborId, currentDegree - 1);
        if (currentDegree - 1 === 0) {
          queue.push(neighborId);
        }
      }
    }

    return sorted;
  }

  /**
   * Retorna os nós que estão prontos para execução no momento (status pending e todas as dependências concluídas)
   */
  public getExecutableNodes(): DAGNode[] {
    const executable: DAGNode[] = [];

    for (const node of this.nodes.values()) {
      const isRetryable =
        node.status === "failed" && (node.attempts || 0) < (node.maxAttempts || 3);
      const isPending = node.status === "pending" || node.status === "standby" || isRetryable;

      if (!isPending) {
        continue;
      }

      const allDepsCompleted = node.dependencies.every((depId) => {
        const depNode = this.nodes.get(depId);
        return depNode && depNode.status === "completed";
      });

      const anyDepPermanentlyFailed = node.dependencies.some((depId) => {
        const depNode = this.nodes.get(depId);
        if (!depNode) return false;
        if (depNode.status === "blocked") return true;
        if (depNode.status === "failed" && (depNode.attempts || 0) >= (depNode.maxAttempts || 3)) {
          return true;
        }
        return false;
      });

      if (anyDepPermanentlyFailed) {
        node.status = "blocked";
      } else if (allDepsCompleted) {
        executable.push(node);
      }
    }

    return executable;
  }

  /**
   * Atualiza o estado de um nó no grafo, controlando a contagem de tentativas (D-RANHO)
   */
  public updateNodeStatus(
    nodeId: string,
    status: TaskStatus,
    result?: Record<string, unknown> | string
  ): DAGNode {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Nó de tarefa com ID '${nodeId}' não foi encontrado.`);
    }

    node.status = status;
    if (result !== undefined) {
      node.result = result;
    }

    if (status === "failed") {
      node.attempts = (node.attempts || 0) + 1;
      const maxAtt = node.maxAttempts || 3;
      if (node.attempts >= maxAtt) {
        node.status = "blocked";
      }
    }

    // Trava T6: o bloqueio precisa chegar aos dependentes também quando o chamador já
    // informa "blocked" diretamente (process_queue/execute_node decidem o limite por conta
    // própria) — antes a cascata só disparava pelo caminho "failed" acima.
    if (node.status === "blocked") {
      this.propagateBlockState();
    }

    return node;
  }

  /**
   * Propaga o estado 'blocked' para nós pendentes que dependem (direta ou transitivamente) de
   * tarefas falhadas DEFINITIVAMENTE — "blocked" ou "failed" sem tentativas restantes. Um
   * "failed" ainda elegível para retry não bloqueia ninguém (mesma regra de getExecutableNodes).
   * Retorna os IDs que passaram a "blocked" nesta chamada, para o chamador persistir.
   */
  public propagateBlockState(): string[] {
    const newlyBlocked: string[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of this.nodes.values()) {
        if (node.status === "pending" || node.status === "standby") {
          const hasPermanentlyFailedDep = node.dependencies.some((depId) => {
            const depNode = this.nodes.get(depId);
            if (!depNode) return false;
            if (depNode.status === "blocked") return true;
            return depNode.status === "failed" && (depNode.attempts || 0) >= (depNode.maxAttempts || 3);
          });
          if (hasPermanentlyFailedDep) {
            node.status = "blocked";
            newlyBlocked.push(node.id);
            changed = true;
          }
        }
      }
    }
    return newlyBlocked;
  }
}

