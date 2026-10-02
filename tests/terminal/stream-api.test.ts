import { describe, it, expect, vi } from "vitest";
import { GET } from "@/app/api/terminal/stream/route";
import { NextRequest } from "next/server";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
}));

describe("API /api/terminal/stream", () => {
  it("retorna 400 se o parâmetro command não for informado", async () => {
    const req = new NextRequest("http://localhost/api/terminal/stream");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("retorna Response com stream SSE quando comando é fornecido", async () => {
    const req = new NextRequest("http://localhost/api/terminal/stream?command=echo%20hello");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.body).toBeDefined();
  });
});
