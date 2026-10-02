import { describe, it, expect, vi } from "vitest";
import { GET, POST } from "@/app/api/quarantine/git-branch/route";
import { NextRequest } from "next/server";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
}));

describe("API /api/quarantine/git-branch", () => {
  it("POST — cria branch de quarentena a partir do taskId", async () => {
    const testTaskId = `test-${Date.now()}`;
    const req = new NextRequest("http://localhost/api/quarantine/git-branch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: testTaskId }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.branch).toContain(`nextcode/quarantine-${testTaskId}`);
  });

  it("GET — lista as branches de quarentena existentes", async () => {
    const req = new NextRequest("http://localhost/api/quarantine/git-branch");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.quarantineBranches)).toBe(true);
  });
});
