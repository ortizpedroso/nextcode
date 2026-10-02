import { describe, it, expect, beforeEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { POST } from "@/app/api/dag/benchmark/route";
import { NextRequest } from "next/server";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
}));

describe("API /api/dag/benchmark", () => {
  let testSessionId: string;

  beforeEach(async () => {
    const session = await prisma.session.create({
      data: {
        title: "Benchmark Test Session Unique",
        tasks: {
          create: [
            { title: "Task 1 Unique", role: "developer" },
            { title: "Task 2 Unique", role: "auditor" },
          ],
        },
      },
    });

    testSessionId = session.id;
  });

  it("POST — simula e compara desempenho entre modelos para a DAG da sessão", async () => {
    const req = new NextRequest("http://localhost/api/dag/benchmark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: testSessionId,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.sessionId).toBe(testSessionId);
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBeGreaterThanOrEqual(3);
    expect(data.results[0].totalTimeMs).toBeGreaterThan(0);
  });
});
