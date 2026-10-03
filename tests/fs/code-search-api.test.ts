import { describe, it, expect, vi } from "vitest";
import { GET } from "@/app/api/fs/search/route";
import { NextRequest } from "next/server";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
}));

describe("API /api/fs/search", () => {
  it("GET — busca texto e regex em arquivos do projeto local", async () => {
    const req = new NextRequest("http://localhost/api/fs/search?query=DashboardOrchestrator");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(data.matches[0].filePath).toBeDefined();
    expect(data.matches[0].lineNumber).toBeGreaterThan(0);
  });

  it("GET — nunca retorna conteúdo de dotfiles (ex: .env), mesmo que contenham o termo buscado", async () => {
    const req = new NextRequest("http://localhost/api/fs/search?query=SECRET_TOKEN_MARKER_XYZ");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    for (const match of data.matches || []) {
      const base = String(match.filePath).split(/[/\\]/).pop() || "";
      expect(base.startsWith(".")).toBe(false);
    }
  });
});
