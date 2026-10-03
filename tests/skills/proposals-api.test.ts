import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import prisma from "@/lib/prisma";
import { GET, POST } from "@/app/api/skills/proposals/route";
import { POST as installGithubPOST } from "@/app/api/skills/install-github/route";
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
    expect(getData.proposals.some((p: { id: string }) => p.id === createData.proposal.id)).toBe(true);

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

  it("aprova proposta source=github grava no destino do projeto (não no diretório hardcoded de learned skills) e suporta disable/enable", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-proposal-approve-test-"));
    try {
      const proposal = await prisma.candidateSkillProposal.create({
        data: {
          name: "github-imported-skill",
          description: "Skill importada via GitHub",
          triggerPattern: "/github-imported-skill",
          sampleContent: `---\nname: github-imported-skill\ndescription: Skill importada via GitHub\n---\nConteúdo de teste.`,
          status: "pending",
          source: "github",
          detectedType: "google",
          targetPath: tmpDir,
        },
      });

      // Aprova — deve gravar em tmpDir/.gemini/skills/github-imported-skill/SKILL.md
      const approveReq = new NextRequest("http://localhost/api/skills/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", id: proposal.id }),
      });
      const approveRes = await POST(approveReq);
      expect(approveRes.status).toBe(200);
      const approveData = await approveRes.json();
      expect(approveData.proposal.status).toBe("approved");

      const expectedPath = path.join(tmpDir, ".gemini", "skills", "github-imported-skill", "SKILL.md");
      expect(fs.existsSync(expectedPath)).toBe(true);
      expect(approveData.proposal.installedPath).toBe(expectedPath);

      // Desativa — status muda, mas o arquivo continua em disco
      const disableReq = new NextRequest("http://localhost/api/skills/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable", id: proposal.id }),
      });
      const disableRes = await POST(disableReq);
      expect(disableRes.status).toBe(200);
      const disableData = await disableRes.json();
      expect(disableData.proposal.status).toBe("disabled");
      expect(fs.existsSync(expectedPath)).toBe(true);

      // Reativa
      const enableReq = new NextRequest("http://localhost/api/skills/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enable", id: proposal.id }),
      });
      const enableRes = await POST(enableReq);
      expect(enableRes.status).toBe(200);
      const enableData = await enableRes.json();
      expect(enableData.proposal.status).toBe("approved");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejeita disable/enable em propostas 'learned' (sem installedPath) ou não instaladas", async () => {
    const proposal = await prisma.candidateSkillProposal.create({
      data: {
        name: "learned-skill",
        description: "Skill minerada de telemetria",
        triggerPattern: "/learned-skill",
        sampleContent: "# conteúdo",
        status: "approved",
        source: "learned",
      },
    });

    const disableReq = new NextRequest("http://localhost/api/skills/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disable", id: proposal.id }),
    });
    const disableRes = await POST(disableReq);
    expect(disableRes.status).toBe(400);
  });

  it("aprova proposta source=bug_pattern apenas reconhece o bug — nunca escreve skill em disco", async () => {
    const proposal = await prisma.candidateSkillProposal.create({
      data: {
        name: "bug-type2-divergencia",
        description: "Erro recorrente detectado 3x no próprio NextCode (AUDIT_REJECTED).",
        triggerPattern: "(detecção automática — não é uma skill executável)",
        sampleContent: "Falha no Validador Tipo 1: [SYNTAX ERROR] ...",
        status: "pending",
        source: "bug_pattern",
      },
    });

    const approveReq = new NextRequest("http://localhost/api/skills/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", id: proposal.id }),
    });
    const approveRes = await POST(approveReq);
    expect(approveRes.status).toBe(200);
    const approveData = await approveRes.json();
    expect(approveData.proposal.status).toBe("approved");
    expect(approveData.proposal.installedPath).toBeNull();
  });

  it("POST /api/skills/install-github (quarantine gate) — não grava em disco, cria proposta pendente com source=github", async () => {
    const mockContent = `---
name: imported-reviewer
description: Skill importada via GitHub para teste
---
Instruções de revisão.`;

    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(mockContent, { status: 200, headers: { "Content-Type": "text/plain" } });

    try {
      const req = new NextRequest("http://localhost/api/skills/install-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubUrl: "https://github.com/user/imported-reviewer" }),
      });

      const res = await installGithubPOST(req);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.pendingReview).toBe(true);
      expect(data.skillName).toBe("imported-reviewer");

      const proposal = await prisma.candidateSkillProposal.findUnique({ where: { id: data.proposalId } });
      expect(proposal).not.toBeNull();
      expect(proposal!.status).toBe("pending");
      expect(proposal!.source).toBe("github");
      expect(proposal!.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(proposal!.installedPath).toBeNull();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
