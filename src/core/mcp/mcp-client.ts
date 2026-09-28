export interface MCPToolParam {
  type: string;
  description: string;
  required?: boolean;
}

export interface MCPToolSchema {
  name: string;
  description: string;
  parameters: Record<string, MCPToolParam>;
}

export interface MCPToolInvocation {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

export type MCPToolHandler = (args: Record<string, unknown>) => Promise<MCPToolResponse>;

export class MCPClient {
  private tools: Map<string, { schema: MCPToolSchema; handler: MCPToolHandler }>;

  constructor() {
    this.tools = new Map();
  }

  /**
   * Registra uma nova ferramenta no protocolo MCP
   */
  public registerTool(schema: MCPToolSchema, handler: MCPToolHandler): void {
    this.tools.set(schema.name, { schema, handler });
  }

  /**
   * Retorna os schemas de todas as ferramentas ativas no cliente MCP
   */
  public listTools(): MCPToolSchema[] {
    return Array.from(this.tools.values()).map((t) => t.schema);
  }

  /**
   * Executa uma ferramenta registrada através do padrão Model Context Protocol
   */
  public async executeTool(invocation: MCPToolInvocation): Promise<MCPToolResponse> {
    const tool = this.tools.get(invocation.name);
    if (!tool) {
      return {
        success: false,
        error: `Ferramenta MCP '${invocation.name}' não registrada. Ferramentas disponíveis: ${Array.from(
          this.tools.keys()
        ).join(", ")}`,
      };
    }

    try {
      return await tool.handler(invocation.arguments);
    } catch (err) {
      return {
        success: false,
        error: `Erro ao executar ferramenta MCP '${invocation.name}': ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }
}
