import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { POST as postChat } from "@/app/api/chat/route";
import * as jevDecisions from "@/core/decision/jev-decisions";
import * as fs from "fs";
import * as path from "path";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
  requireReadAuth: vi.fn().mockReturnValue({ response: null }),
}));

describe("Pacote E4 — Integração do Chat com Telemetria Graphify via JEV", () => {
  const fakeTmpDir = path.join(process.cwd(), "tmp", "test-graphify-e4");
  const createdSessionIds: string[] = [];
  const createdProjectIds: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    if (fs.existsSync(fakeTmpDir)) {
      fs.rmSync(fakeTmpDir, { recursive: true, force: true });
    }
    if (createdSessionIds.length > 0) {
      await prisma.message.deleteMany({ where: { sessionId: { in: createdSessionIds } } });
      await prisma.session.deleteMany({ where: { id: { in: createdSessionIds } } });
      createdSessionIds.length = 0;
    }
    if (createdProjectIds.length > 0) {
      await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
      createdProjectIds.length = 0;
    }
  });

  it("sugere Graphify quando o prompt pede arquitetura e o projeto ainda não foi indexado", async () => {
    if (!fs.existsSync(fakeTmpDir)) {
      fs.mkdirSync(fakeTmpDir, { recursive: true });
    }
    // Mudança 25 (b): Graphify só com código de verdade na pasta.
    fs.mkdirSync(path.join(fakeTmpDir, "src"), { recursive: true });
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(fakeTmpDir, "src", `m${i}.ts`), `export const m${i} = ${i};
`);

    const project = await prisma.project.create({
      data: { name: "Sistema Piloto E4", path: fakeTmpDir },
    });
    createdProjectIds.push(project.id);

    const session = await prisma.session.create({
      data: {
        projectId: project.id,
        phase: "ENTRADA",
        specApproved: false,
      },
    });
    createdSessionIds.push(session.id);

    // Mock da decisão do Jev para simular resposta afirmativa
    vi.spyOn(jevDecisions, "decideGraphifyEligibilityWithJev").mockResolvedValue({
      elegivel: true,
      probabilidadeNoul: 0.95,
      confianca: 0.9,
      foco: "arquitetura_e_dependencias",
      motivo: "Mapear arquitetura e relações de dependência entre arquivos com Graphify.",
      source: "jev",
    });

    const req = new NextRequest("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        projectId: project.id,
        prompt: "Quais são as dependências e como os módulos conversam?",
      }),
    });

    const res = await postChat(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.graphifySuggestion).not.toBeNull();
    expect(json.graphifySuggestion.projectId).toBe(project.id);
    expect(json.graphifySuggestion.reasoning).toContain("Graphify");
  });

  it("não sugere Graphify se o grafo já existe no disco (graphify-out/graph.json)", async () => {
    const outDir = path.join(fakeTmpDir, "graphify-out");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "graph.json"), '{"nodes":[],"edges":[]}');

    const project = await prisma.project.create({
      data: { name: "Sistema Indexado E4", path: fakeTmpDir },
    });
    createdProjectIds.push(project.id);

    const session = await prisma.session.create({
      data: {
        projectId: project.id,
        phase: "ENTRADA",
        specApproved: false,
      },
    });
    createdSessionIds.push(session.id);

    const spyJev = vi.spyOn(jevDecisions, "decideGraphifyEligibilityWithJev");

    const req = new NextRequest("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        projectId: project.id,
        prompt: "Quais são as dependências e como os módulos conversam?",
      }),
    });

    const res = await postChat(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.graphifySuggestion).toBeNull();
    // Nem gasta tokens/chamada ao Jev se o grafo já existe!
    expect(spyJev).not.toHaveBeenCalled();
  });

  it("mudança 25 (b): pasta só com package.json e README não sugere Graphify nem chama o Jev", async () => {
    const emptyDir = path.join(process.cwd(), "tmp", "test-graphify-vazio");
    fs.rmSync(emptyDir, { recursive: true, force: true });
    fs.mkdirSync(emptyDir, { recursive: true });
    fs.writeFileSync(path.join(emptyDir, "package.json"), '{"name":"x"}');
    fs.writeFileSync(path.join(emptyDir, "README.md"), "# x");
    const project = await prisma.project.create({ data: { name: "Projeto Vazio", path: emptyDir } });
    createdProjectIds.push(project.id);
    const session = await prisma.session.create({ data: { projectId: project.id, phase: "ENTRADA", specApproved: false } });
    createdSessionIds.push(session.id);
    const spyJev = vi.spyOn(jevDecisions, "decideGraphifyEligibilityWithJev");

    const res = await postChat(
      new NextRequest("http://localhost:3000/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, projectId: project.id, prompt: "Quais são as dependências do projeto?" }),
      })
    );
    const json = await res.json();
    expect(json.graphifySuggestion ?? null).toBeNull();
    expect(spyJev).not.toHaveBeenCalled();
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
