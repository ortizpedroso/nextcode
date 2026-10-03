import { describe, it, expect, vi } from "vitest";
import prisma from "@/lib/prisma";
import { POST } from "@/app/api/dag/route";
import { NextRequest } from "next/server";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
}));

describe("API /api/dag — Trava T1 (Spec Approval Lock) não pode ser contornada", () => {
  it("create_dag NÃO deve aprovar a Spec automaticamente — a sessão permanece specApproved=false", async () => {
    const session = await prisma.session.create({
      data: { title: "Sessão Trava T1 Unique", specApproved: false },
    });

    const req = new NextRequest("http://localhost/api/dag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_dag",
        prompt: "Quero criar um gateway de pagamento completo",
        sessionId: session.id,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const refreshed = await prisma.session.findUnique({ where: { id: session.id } });
    expect(refreshed?.specApproved).toBe(false);
  });

  it("process_queue deve recusar execução (400) quando a Spec ainda não foi aprovada, mesmo após create_dag", async () => {
    const session = await prisma.session.create({
      data: { title: "Sessão Trava T1 Bloqueio Unique", specApproved: false },
    });

    await POST(
      new NextRequest("http://localhost/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_dag",
          prompt: "Quero criar um gateway de pagamento completo",
          sessionId: session.id,
        }),
      })
    );

    const procRes = await POST(
      new NextRequest("http://localhost/api/dag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process_queue", sessionId: session.id }),
      })
    );

    expect(procRes.status).toBe(400);
    const data = await procRes.json();
    expect(data.error).toContain("Trava T1");
  });
});
