import { describe, it, expect, vi } from "vitest";
import { GET, POST } from "@/app/api/quota/route";
import { NextRequest } from "next/server";
import { markComboExhausted } from "@/core/router/quota-tracker";

vi.mock("@/core/security/local-auth", () => ({
  requireAuth: vi.fn().mockReturnValue({ response: null }),
}));

describe("API /api/quota", () => {
  it("GET & POST — retorna status de cotas e permite zerar os cooldowns", async () => {
    // 1. Simula um estouro de cota (429)
    markComboExhausted("auto/test-combo", 429);

    // 2. GET
    const getRes = await GET();
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.totalTracked).toBeGreaterThanOrEqual(1);

    // 3. POST clear_cooldowns
    const postReq = new NextRequest("http://localhost/api/quota", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear_cooldowns" }),
    });

    const postRes = await POST(postReq);
    expect(postRes.status).toBe(200);
    const postData = await postRes.json();
    expect(postData.success).toBe(true);

    // 4. Verificação de reset
    const getResAfter = await GET();
    const getDataAfter = await getResAfter.json();
    expect(getDataAfter.totalTracked).toBe(0);
  });
});
