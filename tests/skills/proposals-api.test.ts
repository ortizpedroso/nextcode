import { describe, it, expect, beforeEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { GET, POST } from "@/app/api/skills/proposals/route";
import { NextRequest } from "next/server";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
}));

describe("API /api/skills/proposals", () => {
  beforeEach(async () => {
    await prisma.candidateSkillProposal.deleteMany({});
  });

  it("GET & POST — cria, lista e aprova propostas de novas skills aprendidas", async () => {
    // 1. Criar proposta
    const createReq = new NextRequest("http://localhost/api/skills/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        name: "test-auto-skill",
        description: "Skill para automação de testes",
        sampleContent: "# Instruções da Skill",
      }),
    });

    const createRes = await POST(createReq);
    expect(createRes.status).toBe(200);
    const createData = await createRes.json();
    expect(createData.success).toBe(true);
    expect(createData.proposal.name).toBe("test-auto-skill");

    // 2. Listar propostas
    const getRes = await GET();
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.proposals.length).toBe(1);

    // 3. Aprovar proposta
    const approveReq = new NextRequest("http://localhost/api/skills/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        id: createData.proposal.id,
      }),
    });

    const approveRes = await POST(approveReq);
    expect(approveRes.status).toBe(200);
    const approveData = await approveRes.json();
    expect(approveData.proposal.status).toBe("approved");
  });
});
