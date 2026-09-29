export class DAGEngine {
    nodes;
    constructor(nodes = []) {
        this.nodes = new Map();
        for (const node of nodes) {
            this.nodes.set(node.id, { ...node, dependencies: [...node.dependencies] });
        }
    }
    /**
     * Adiciona um nó ao grafo DAG
     */
    addNode(node) {
        this.nodes.set(node.id, { ...node, dependencies: [...node.dependencies] });
    }
    /**
     * Obtém todos os nós atualmente registrados no grafo
     */
    getNodes() {
        return Array.from(this.nodes.values());
    }
    /**
     * Obtém um nó específico pelo seu ID
     */
    getNode(id) {
        return this.nodes.get(id);
    }
    /**
     * Valida se o grafo é um Grafo Direcionado Acíclico (DAG) e não contém ciclos
     */
    detectCycles() {
        const visited = new Set();
        const recursionStack = new Set();
        const cycleNodes = [];
        const dfs = (nodeId) => {
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
                    }
                    else if (recursionStack.has(depId)) {
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
    topologicalSort() {
        const { hasCycle } = this.detectCycles();
        if (hasCycle) {
            throw new Error("Ciclo detectado no grafo de tarefas! Ordenação topológica impossível.");
        }
        const inDegree = new Map();
        const adjacency = new Map();
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
        const queue = [];
        for (const [nodeId, degree] of inDegree.entries()) {
            if (degree === 0) {
                queue.push(nodeId);
            }
        }
        const sorted = [];
        while (queue.length > 0) {
            const currentId = queue.shift();
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
    getExecutableNodes() {
        const executable = [];
        for (const node of this.nodes.values()) {
            if (node.status !== "pending") {
                continue;
            }
            const allDepsCompleted = node.dependencies.every((depId) => {
                const depNode = this.nodes.get(depId);
                return depNode && depNode.status === "completed";
            });
            const anyDepFailed = node.dependencies.some((depId) => {
                const depNode = this.nodes.get(depId);
                return depNode && (depNode.status === "failed" || depNode.status === "blocked");
            });
            if (anyDepFailed) {
                node.status = "blocked";
            }
            else if (allDepsCompleted) {
                executable.push(node);
            }
        }
        return executable;
    }
    /**
     * Atualiza o estado de um nó no grafo
     */
    updateNodeStatus(nodeId, status, result) {
        const node = this.nodes.get(nodeId);
        if (!node) {
            throw new Error(`Nó de tarefa com ID '${nodeId}' não foi encontrado.`);
        }
        node.status = status;
        if (result !== undefined) {
            node.result = result;
        }
        // Se o nó falhou, bloqueia nós dependentes
        if (status === "failed") {
            this.propagateBlockState();
        }
        return node;
    }
    /**
     * Propaga o estado 'blocked' para nós que dependem de tarefas que falharam
     */
    propagateBlockState() {
        let changed = true;
        while (changed) {
            changed = false;
            for (const node of this.nodes.values()) {
                if (node.status === "pending") {
                    const hasFailedOrBlockedDep = node.dependencies.some((depId) => {
                        const depNode = this.nodes.get(depId);
                        return depNode && (depNode.status === "failed" || depNode.status === "blocked");
                    });
                    if (hasFailedOrBlockedDep) {
                        node.status = "blocked";
                        changed = true;
                    }
                }
            }
        }
    }
}
