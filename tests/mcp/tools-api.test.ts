import { describe, it, expect, beforeEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { GET, POST } from "@/app/api/mcp/tools/route";
import { NextRequest } from "next/server";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
  requireReadAuth: vi.fn().mockReturnValue({ response: null }),
}));

describe("API /api/mcp/tools", () => {
  beforeEach(async () => {
    await prisma.mcpServer.deleteMany({});
    await prisma.mcpServer.create({
      data: {
        name: "Test Filesystem Server",
        type: "stdio",
        status: "online",
      },
    });
  });

  it("GET & POST — lista e executa ferramentas MCP via JSON-RPC", async () => {
    // 1. GET
    const reqGet = new NextRequest("http://localhost/api/mcp/tools");
    const resGet = await GET(reqGet);

    expect(resGet.status).toBe(200);
    const dataGet = await resGet.json();
    expect(dataGet.servers.length).toBe(1);
    expect(dataGet.servers[0].tools.length).toBeGreaterThanOrEqual(1);

    // 2. POST
    const reqPost = new NextRequest("http://localhost/api/mcp/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: "test_filesystem_server_read_file",
        args: { path: "package.json" },
      }),
    });

    const resPost = await POST(reqPost);
    expect(resPost.status).toBe(200);
    const dataPost = await resPost.json();
    expect(dataPost.success).toBe(true);
    expect(dataPost.result.status).toBe("success");
  });
});
