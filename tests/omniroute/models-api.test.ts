import { describe, it, expect, vi } from "vitest";
import { GET } from "@/app/api/omniroute/models/route";
import { NextRequest } from "next/server";

vi.mock("@/core/security/safe-fetch", () => ({
  safeFetch: vi.fn().mockImplementation(async (url: string) => {
    if (url.includes("/models")) {
      return {
        ok: true,
        json: async () => ({
          data: [
            { id: "auto/coding", name: "Auto Coding", owned_by: "omniroute" },
            { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", owned_by: "meta" },
          ],
        }),
      };
    }
    return { ok: false };
  }),
}));

describe("API /api/omniroute/models", () => {
  it("GET — descobre dinamicamente a lista de modelos do OmniRoute local", async () => {
    const req = new NextRequest("http://localhost/api/omniroute/models");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.status).toBe("connected");
    expect(data.total).toBe(2);
    expect(data.models[0].id).toBe("auto/coding");
  });
});
