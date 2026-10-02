import { describe, it, expect, vi } from "vitest";
import { GET, POST } from "@/app/api/auth/roles/route";
import { NextRequest } from "next/server";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
}));

describe("API /api/auth/roles", () => {
  it("GET — retorna lista de papéis e matriz de permissões RBAC", async () => {
    const req = new NextRequest("http://localhost/api/auth/roles");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.availableRoles.length).toBe(3);
  });

  it("GET com ?role=ADMIN — retorna permissões específicas do papel ADMIN", async () => {
    const req = new NextRequest("http://localhost/api/auth/roles?role=ADMIN");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.role.role).toBe("ADMIN");
    expect(data.role.permissions).toContain("admin:*");
  });

  it("POST — atribui papel RBAC e valida permissões", async () => {
    const req = new NextRequest("http://localhost/api/auth/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "AUDITOR" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.assignedRole.role).toBe("AUDITOR");
    expect(data.activePermissions).toContain("read:audit");
  });

  it("POST — rejeita papel inválido com status 400", async () => {
    const req = new NextRequest("http://localhost/api/auth/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "INVALID_ROLE" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
  });
});
