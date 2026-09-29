export class MCPClient {
    tools;
    constructor() {
        this.tools = new Map();
    }
    /**
     * Registra uma nova ferramenta no protocolo MCP
     */
    registerTool(schema, handler) {
        this.tools.set(schema.name, { schema, handler });
    }
    /**
     * Retorna os schemas de todas as ferramentas ativas no cliente MCP
     */
    listTools() {
        return Array.from(this.tools.values()).map((t) => t.schema);
    }
    /**
     * Executa uma ferramenta registrada através do padrão Model Context Protocol
     */
    async executeTool(invocation) {
        const tool = this.tools.get(invocation.name);
        if (!tool) {
            return {
                success: false,
                error: `Ferramenta MCP '${invocation.name}' não registrada. Ferramentas disponíveis: ${Array.from(this.tools.keys()).join(", ")}`,
            };
        }
        try {
            return await tool.handler(invocation.arguments);
        }
        catch (err) {
            return {
                success: false,
                error: `Erro ao executar ferramenta MCP '${invocation.name}': ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}
