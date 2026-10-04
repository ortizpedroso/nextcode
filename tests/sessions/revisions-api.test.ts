import { describe, it, expect, vi } from "vitest";
import prisma from "@/lib/prisma";
import { GET, POST } from "@/app/api/sessions/revisions/route";
import { NextRequest } from "next/server";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
  requireReadAuth: vi.fn().mockReturnValue({ response: null }),
}));

describe("API /api/sessions/revisions", () => {
  it("GET & POST — cria, lista e restaura snapshots de revisão de DAG", async () => {
    const session = await prisma.session.create({
      data: {
        title: "Revision Test Session Unique",
        canonicalSpec: "# Initial Spec Unique",
        tasks: {
          create: [{ title: "Initial Task Unique", role: "architect" }],
        },
      },
    });

    const testSessionId = session.id;

    // 1. Criar snapshot
    const createReq = new NextRequest("http://localhost/api/sessions/revisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_snapshot",
        sessionId: testSessionId,
        label: "Ponto de Restauração 1",
      }),
    });

    const createRes = await POST(createReq);
    expect(createRes.status).toBe(200);
    const createData = await createRes.json();
    expect(createData.success).toBe(true);
    expect(createData.revisionId).toBeDefined();

    // 2. GET revisões
    const getReq = new NextRequest(`http://localhost/api/sessions/revisions?sessionId=${testSessionId}`);
    const getRes = await GET(getReq);
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.revisions.length).toBe(1);
    expect(getData.revisions[0].label).toBe("Ponto de Restauração 1");

    // 3. Restaurar snapshot
    const restoreReq = new NextRequest("http://localhost/api/sessions/revisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "restore_snapshot",
        sessionId: testSessionId,
        snapshotId: createData.revisionId,
      }),
    });

    const restoreRes = await POST(restoreReq);
    expect(restoreRes.status).toBe(200);
    const restoreData = await restoreRes.json();
    expect(restoreData.success).toBe(true);
  });
});
