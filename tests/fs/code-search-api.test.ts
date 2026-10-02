import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/fs/search/route";
import { NextRequest } from "next/server";

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
});
