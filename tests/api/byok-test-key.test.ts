import { describe, it, expect, vi } from "vitest";
import { POST } from "../../src/app/api/byok/test-key/route";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRawUnsafe: vi.fn().mockResolvedValue([
      {
        id: "default",
        geminiKey: "enc:v2:mockGeminiKey",
        groqKey: "enc:v2:mockGroqKey",
      },
    ]),
    setting: {
      findFirst: vi.fn().mockResolvedValue({
        id: "default",
        geminiKey: "enc:v2:mockGeminiKey",
        groqKey: "enc:v2:mockGroqKey",
      }),
    },
  },
}));

vi.mock("@/core/security/crypto", () => ({
  readSecret: vi.fn().mockImplementation((val) => {
    if (!val) return "";
    if (val.includes("mockGroqKey")) return "gsk_decrypted_groq_key";
    if (val.includes("mockGeminiKey")) return "AIzaSy_decrypted_gemini_key";
    return val;
  }),
}));

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
}));

vi.mock("@/core/security/safe-fetch", () => ({
  safeFetch: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: [] }),
  }),
}));

describe("API /api/byok/test-key - Descriptografia automática de chaves salvas", () => {
  it("recupera e decifra a chave salva do banco quando a string mascarada ('••••') for enviada", async () => {
    const req = new NextRequest("http://localhost:3000/api/byok/test-key", {
      method: "POST",
      body: JSON.stringify({
        provider: "groq",
        apiKey: "••••BJty",
      }),
    });

    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toContain("Groq");
  });
});
