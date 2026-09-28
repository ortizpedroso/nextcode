import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { provider, apiKey, baseUrl } = body;

    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json(
        { success: false, message: "Nenhuma chave API fornecida." },
        { status: 400 }
      );
    }

    const key = apiKey.trim();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    try {
      if (provider === "gemini") {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          return NextResponse.json({ success: true, message: "Chave Gemini Válida e Ativa!" });
        }
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error?.message || `Status HTTP ${res.status}`;
        return NextResponse.json({ success: false, message: `Erro Gemini: ${errMsg}` }, { status: 401 });
      }

      if (provider === "claude") {
        const url = "https://api.anthropic.com/v1/models";
        const res = await fetch(url, {
          headers: {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          return NextResponse.json({ success: true, message: "Chave Claude Válida e Ativa!" });
        }
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error?.message || `Status HTTP ${res.status}`;
        return NextResponse.json({ success: false, message: `Erro Anthropic: ${errMsg}` });
      }

      if (provider === "openai") {
        const targetUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}/models` : "https://api.openai.com/v1/models";
        const res = await fetch(targetUrl, {
          headers: {
            Authorization: `Bearer ${key}`,
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          return NextResponse.json({ success: true, message: "Chave OpenAI Válida e Ativa!" });
        }
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error?.message || `Status HTTP ${res.status}`;
        return NextResponse.json({ success: false, message: `Erro OpenAI: ${errMsg}` });
      }

      if (provider === "deepseek") {
        const url = "https://api.deepseek.com/v1/models";
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${key}`,
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          return NextResponse.json({ success: true, message: "Chave DeepSeek Válida e Ativa!" });
        }
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error?.message || `Status HTTP ${res.status}`;
        return NextResponse.json({ success: false, message: `Erro DeepSeek: ${errMsg}` });
      }

      if (provider === "omniRoute" || provider === "custom") {
        const targetUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}/models` : "https://openrouter.ai/api/v1/models";
        const headers: Record<string, string> = {};
        if (key) {
          headers["Authorization"] = `Bearer ${key}`;
        }
        const res = await fetch(targetUrl, { headers, signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          return NextResponse.json({ success: true, message: "Conexão e Chave Verificadas!" });
        }
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error?.message || `Status HTTP ${res.status}`;
        return NextResponse.json({ success: false, message: `Erro de Conexão: ${errMsg}` });
      }

      clearTimeout(timeoutId);
      return NextResponse.json({ success: false, message: "Provedor desconhecido." }, { status: 400 });
    } catch (fetchErr: unknown) {
      clearTimeout(timeoutId);
      const isAbort = fetchErr instanceof Error && fetchErr.name === "AbortError";
      return NextResponse.json({
        success: false,
        message: isAbort ? "Timeout na conexão (7s excede o limite)" : `Erro de rede: ${String(fetchErr)}`,
      });
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, message: "Falha ao processar teste de chave", details: String(error) },
      { status: 500 }
    );
  }
}
