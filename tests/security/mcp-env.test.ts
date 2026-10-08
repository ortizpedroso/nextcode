import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import * as localAuthModule from "@/core/security/local-auth";
import { isEncrypted } from "@/core/security/crypto";
import { encryptMcpEnv, maskMcpEnv, readMcpEnv } from "@/core/security/mcp-env";
import { GET, POST } from "@/app/api/mcp/servers/route";
import { PATCH } from "@/app/api/mcp/servers/[id]/route";

describe("Passo 0.1 — McpServer.env cifrado em repouso e mascarado nas respostas", () => {
  const prevMasterKey = process.env.NEXTCODE_MASTER_KEY;

  beforeEach(() => {
    process.env.NEXTCODE_MASTER_KEY =
      process.env.NEXTCODE_MASTER_KEY || Buffer.alloc(32, 21).toString("base64");
    vi.spyOn(localAuthModule, "requireAuth").mockReturnValue({ response: null } as any);
  });

  afterEach(() => {
    if (prevMasterKey === undefined) delete process.env.NEXTCODE_MASTER_KEY;
    else process.env.NEXTCODE_MASTER_KEY = prevMasterKey;
    vi.restoreAllMocks();
  });

  it("encryptMcpEnv cifra todo valor e mantém as chaves", () => {
    const val1 = "secret_value_alpha_12345";
    const val2 = "secret_value_beta_67890";
    const encryptedJson = encryptMcpEnv({ KEY_ONE: val1, KEY_TWO: val2 });

    expect(encryptedJson).not.toContain(val1);
    expect(encryptedJson).not.toContain(val2);

    const parsed = JSON.parse(encryptedJson);
    expect(Object.keys(parsed)).toEqual(["KEY_ONE", "KEY_TWO"]);
    expect(isEncrypted(parsed.KEY_ONE)).toBe(true);
    expect(isEncrypted(parsed.KEY_TWO)).toBe(true);

    expect(readMcpEnv(encryptedJson)).toEqual({
      KEY_ONE: val1,
      KEY_TWO: val2,
    });
  });

  it("encryptMcpEnv aceita string JSON e objeto", () => {
    const objInput = { TOKEN_A: "tok_abc_123", TOKEN_B: "tok_xyz_789" };
    const strInput = JSON.stringify(objInput);

    const fromObj = encryptMcpEnv(objInput);
    const fromStr = encryptMcpEnv(strInput);

    expect(Object.keys(JSON.parse(fromObj))).toEqual(Object.keys(JSON.parse(fromStr)));
    expect(readMcpEnv(fromObj)).toEqual(objInput);
    expect(readMcpEnv(fromStr)).toEqual(objInput);
    expect(maskMcpEnv(fromObj)).toBe(maskMcpEnv(fromStr));
  });

  it("encryptMcpEnv rejeita array e texto", () => {
    expect(() => encryptMcpEnv(["a", "b"])).toThrow("env deve ser um objeto JSON");
    expect(() => encryptMcpEnv('["a","b"]')).toThrow("env deve ser um objeto JSON");
    expect(() => encryptMcpEnv("texto-nao-json")).toThrow("env deve ser um objeto JSON");
    expect(() => encryptMcpEnv('"apenas-string"')).toThrow("env deve ser um objeto JSON");
    expect(() => encryptMcpEnv(123)).toThrow("env deve ser um objeto JSON");
  });

  it("valor mascarado mantém o segredo guardado", () => {
    const guardado = encryptMcpEnv({ API_KEY: "segredo_original_999" });
    const regravado = encryptMcpEnv({ API_KEY: "****" }, guardado);

    expect(regravado).toBe(guardado);
    expect(readMcpEnv(regravado)).toEqual({ API_KEY: "segredo_original_999" });
  });

  it("maskMcpEnv nunca devolve o valor", () => {
    const rawVal = "meu_segredo_super_confidencial";
    const guardado = encryptMcpEnv({ SECRET_A: rawVal, SECRET_B: "outro_segredo_1234" });
    const masked = maskMcpEnv(guardado);

    expect(masked).not.toContain(rawVal);
    expect(masked).not.toContain("outro_segredo_1234");
    expect(JSON.parse(masked)).toEqual({
      SECRET_A: "****",
      SECRET_B: "****",
    });
  });

  it("API: POST /api/mcp/servers grava env cifrado e responde mascarado", async () => {
    const rawSecret = "mcp_post_secret_token_987654";
    let capturedCreateData: any = null;

    vi.spyOn(prisma.mcpServer, "create").mockImplementation((async (args: any) => {
      capturedCreateData = args.data;
      return {
        id: "mcp-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...args.data,
      };
    }) as any);

    const req = new NextRequest("http://localhost/api/mcp/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Servidor Teste",
        type: "stdio",
        command: "npx",
        args: ["-y", "server"],
        env: { MCP_API_KEY: rawSecret },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(capturedCreateData).toBeDefined();
    expect(capturedCreateData.env).not.toContain(rawSecret);
    expect(readMcpEnv(capturedCreateData.env)).toEqual({ MCP_API_KEY: rawSecret });

    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain(rawSecret);
    expect(JSON.parse(body.server.env)).toEqual({ MCP_API_KEY: "****" });

    vi.spyOn(prisma.mcpServer, "findMany").mockResolvedValue([
      {
        id: "mcp-1",
        name: "Servidor Teste",
        type: "stdio",
        command: "npx",
        args: '["-y","server"]',
        url: null,
        env: capturedCreateData.env,
        status: "online",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as any);

    const resGet = await GET(new NextRequest("http://localhost/api/mcp/servers"));
    expect(resGet.status).toBe(200);
    const getBody = await resGet.json();
    expect(JSON.stringify(getBody)).not.toContain(rawSecret);
    expect(JSON.parse(getBody.servers[0].env)).toEqual({ MCP_API_KEY: "****" });
  });

  it("API: PATCH com env mascarado preserva o segredo", async () => {
    const rawSecret = "mcp_patch_secret_preserved_111";
    const storedEnv = encryptMcpEnv({ MCP_TOKEN: rawSecret });
    let capturedUpdateData: any = null;

    vi.spyOn(prisma.mcpServer, "findUnique").mockResolvedValue({
      id: "mcp-patch-1",
      name: "Servidor Antigo",
      type: "stdio",
      command: "node",
      args: "[]",
      url: null,
      env: storedEnv,
      status: "online",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    vi.spyOn(prisma.mcpServer, "update").mockImplementation((async (args: any) => {
      capturedUpdateData = args.data;
      return {
        id: "mcp-patch-1",
        name: "Servidor Antigo",
        type: "stdio",
        command: "node",
        args: "[]",
        url: null,
        status: "online",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...args.data,
      };
    }) as any);

    const req = new NextRequest("http://localhost/api/mcp/servers/mcp-patch-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        env: { MCP_TOKEN: "****" },
      }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "mcp-patch-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(capturedUpdateData.env).toBe(storedEnv);
    expect(readMcpEnv(capturedUpdateData.env)).toEqual({ MCP_TOKEN: rawSecret });
    expect(JSON.stringify(body)).not.toContain(rawSecret);
    expect(JSON.parse(body.server.env)).toEqual({ MCP_TOKEN: "****" });
  });

  it("API: env inválido responde 400", async () => {
    const reqPost = new NextRequest("http://localhost/api/mcp/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Servidor Inválido",
        env: ["nao", "objeto"],
      }),
    });

    const resPost = await POST(reqPost);
    expect(resPost.status).toBe(400);
    expect(await resPost.json()).toEqual({ error: "env deve ser um objeto JSON" });

    vi.spyOn(prisma.mcpServer, "findUnique").mockResolvedValue({
      id: "mcp-1",
      env: "{}",
    } as any);

    const reqPatch = new NextRequest("http://localhost/api/mcp/servers/mcp-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        env: "nao-json-valido",
      }),
    });

    const resPatch = await PATCH(reqPatch, { params: Promise.resolve({ id: "mcp-1" }) });
    expect(resPatch.status).toBe(400);
    expect(await resPatch.json()).toEqual({ error: "env deve ser um objeto JSON" });
  });
});
