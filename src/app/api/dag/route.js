import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { DAGEngine } from "@/core/dag/dag-engine";
import { SpecDecomposerSkill } from "@/core/skills/spec-decomposer";
import { SmartRouter } from "@/core/router/smart-router";
import { MCPClient } from "@/core/mcp/mcp-client";
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const sessionId = searchParams.get("sessionId");
        // Limpa mensagens técnicas legadas do tipo 'system' para garantir chat limpo
        await prisma.message.deleteMany({ where: { role: "system" } }).catch(() => { });
        if (sessionId) {
            const session = await prisma.session.findUnique({
                where: { id: sessionId },
                include: {
                    project: {
                        select: { id: true, name: true, path: true },
                    },
                    tasks: {
                        orderBy: { createdAt: "asc" },
                    },
                    messages: {
                        where: { role: { in: ["user", "assistant"] } },
                        orderBy: { createdAt: "asc" },
                    },
                },
            });
            if (!session) {
                return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
            }
            return NextResponse.json({
                session,
                tasks: session.tasks,
                messages: session.messages,
            });
        }
        const latestSession = await prisma.session.findFirst({
            orderBy: { createdAt: "desc" },
            include: {
                project: {
                    select: { id: true, name: true, path: true },
                },
                tasks: { orderBy: { createdAt: "asc" } },
                messages: {
                    where: { role: { in: ["user", "assistant"] } },
                    orderBy: { createdAt: "asc" },
                },
            },
        });
        return NextResponse.json({
            session: latestSession,
            tasks: latestSession?.tasks || [],
            messages: latestSession?.messages || [],
        });
    }
    catch (error) {
        return NextResponse.json({ error: "Falha ao recuperar tarefas da DAG", details: String(error) }, { status: 500 });
    }
}
export async function POST(request) {
    try {
        const body = await request.json();
        const { action, prompt, sessionId, projectId, tierOverride } = body;
        const nodeId = body.nodeId;
        // Limpa mensagens de log do tipo 'system'
        await prisma.message.deleteMany({ where: { role: "system" } }).catch(() => { });
        // Ação 1: Criar e Decompor um novo objetivo em nós de DAG
        if (action === "create_dag" || prompt) {
            const targetPrompt = prompt || "Novo Objetivo NextCode";
            let activeSessionId = sessionId;
            if (!activeSessionId) {
                const session = await prisma.session.create({
                    data: {
                        title: targetPrompt.length > 30 ? `${targetPrompt.substring(0, 30)}...` : targetPrompt,
                        projectId: projectId || null,
                    },
                });
                activeSessionId = session.id;
            }
            else {
                const existingSession = await prisma.session.findUnique({ where: { id: activeSessionId } });
                if (existingSession && existingSession.title.startsWith("Nova Sessão")) {
                    await prisma.session.update({
                        where: { id: activeSessionId },
                        data: {
                            title: targetPrompt.length > 30 ? `${targetPrompt.substring(0, 30)}...` : targetPrompt,
                        },
                    });
                }
            }
            // Consulta chaves para classificação do SmartRouter
            const setting = await prisma.setting.findUnique({ where: { id: "default" } });
            const availableKeys = {
                hasGeminiKey: Boolean(setting?.geminiKey),
                hasClaudeKey: Boolean(setting?.claudeKey),
                hasOpenaiKey: Boolean(setting?.openaiKey),
                hasOmniRouteKey: Boolean(setting?.omniRouteKey),
                customEndpoint: setting?.customEndpoint,
            };
            const smartRouter = new SmartRouter();
            const rawAnalysis = smartRouter.routeTask({ prompt: targetPrompt });
            const intent = smartRouter.resolveFallback(rawAnalysis, availableKeys);
            // Decompõe em nós via SpecDecomposerSkill
            const { nodes: decomposedNodes } = SpecDecomposerSkill.decompose(targetPrompt);
            // Salva os nós no banco de dados SQLite
            const createdTasks = [];
            for (const node of decomposedNodes) {
                const dbTask = await prisma.taskNode.create({
                    data: {
                        sessionId: activeSessionId,
                        title: node.title,
                        role: node.role,
                        status: "pending",
                        dependencies: JSON.stringify(node.dependencies),
                        mcpScope: node.mcpScope,
                        payload: JSON.stringify({
                            ...(typeof node.payload === "object" && node.payload !== null ? node.payload : { data: node.payload }),
                            intent,
                        }),
                    },
                });
                createdTasks.push(dbTask);
            }
            const updatedSession = await prisma.session.findUnique({
                where: { id: activeSessionId },
                include: {
                    project: { select: { id: true, name: true } },
                    tasks: { orderBy: { createdAt: "asc" } },
                    messages: {
                        where: { role: { in: ["user", "assistant"] } },
                        orderBy: { createdAt: "asc" },
                    },
                },
            });
            return NextResponse.json({
                success: true,
                sessionId: activeSessionId,
                intent,
                tasks: updatedSession?.tasks || createdTasks,
                messages: updatedSession?.messages || [],
                session: updatedSession,
            });
        }
        // Ação 2: Executar um nó específico da DAG (SEM criar mensagens no chat)
        if (action === "execute_node" && nodeId) {
            const task = await prisma.taskNode.findUnique({
                where: { id: nodeId },
            });
            if (!task) {
                return NextResponse.json({ error: "Nó não encontrado" }, { status: 404 });
            }
            // Atualiza estado para 'running'
            await prisma.taskNode.update({
                where: { id: nodeId },
                data: { status: "running" },
            });
            // Execução MCP
            const mcpClient = new MCPClient();
            mcpClient.registerTool({
                name: "execute_step",
                description: "Executa etapa da DAG no ecossistema NextCode",
                parameters: {
                    nodeId: { type: "string", description: "ID do nó" },
                },
            }, async () => {
                return {
                    success: true,
                    result: `Etapa '${task.title}' concluída com sucesso via MCP Protocol.`,
                };
            });
            const mcpRes = await mcpClient.executeTool({
                name: "execute_step",
                arguments: { nodeId },
            });
            // Atualiza estado para 'completed' no SQLite
            const updatedTask = await prisma.taskNode.update({
                where: { id: nodeId },
                data: {
                    status: "completed",
                    result: JSON.stringify(mcpRes),
                },
            });
            // Avalia dependências dos outros nós na sessão via DAGEngine
            const sessionTasks = await prisma.taskNode.findMany({
                where: { sessionId: task.sessionId },
            });
            const dagNodes = sessionTasks.map((t) => ({
                id: t.id,
                title: t.title,
                role: t.role,
                status: t.status,
                dependencies: JSON.parse(t.dependencies || "[]"),
                mcpScope: t.mcpScope || undefined,
                payload: t.payload ? JSON.parse(t.payload) : undefined,
                result: t.result ? JSON.parse(t.result) : undefined,
            }));
            const dagEngine = new DAGEngine(dagNodes);
            const executableNodes = dagEngine.getExecutableNodes();
            return NextResponse.json({
                success: true,
                executedTask: updatedTask,
                nextExecutableNodes: executableNodes,
            });
        }
        return NextResponse.json({ error: "Ação não suportada" }, { status: 400 });
    }
    catch (error) {
        return NextResponse.json({ error: "Erro no processamento da DAG", details: String(error) }, { status: 500 });
    }
}
