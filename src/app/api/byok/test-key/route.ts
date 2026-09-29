import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import { safeFetch } from "@/core/security/safe-fetch";
import { FAST_MODEL } from "@/core/router/smart-router";

export async function POST(request: NextRequest) {
  // Fases 3+4: rota que testa URLs/chaves fornecidas pelo usuário é o vetor SSRF
  // clássico; agora exige token local e passa todas as URLs por safeFetch.
  const guard = requireAuth(request);
  if (guard.response) return guard.response;
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
        const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${key}`;
        const res = await safeFetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          // FIX DEFINITIVO ("verde mas quebrado"): validar uma chave Gemini contra
          // /v1beta/models prova apenas AUTENTICIDADE — não que a chave consegue gerar
          // conteúdo nos modelos que o chat realmente usa. Agora testamos também uma
          // geração mínima no modelo preferido do router (cascata FAST_MODEL -> lite ->
          // 2.0-flash). Se autenticar mas falhar na geração, o card fica AMARELO com o
          // motivo real (ex.: free tier sem acesso ao modelo), em vez de mentir verde.
          const listJson = (await res.json().catch(() => null)) as
            | { models?: Array<{ name?: string }> }
            | null;
          const supported = (listJson?.models ?? [])
            .map((m) => (m.name || "").replace(/^models\//, ""))
            .filter(Boolean);
          const candidates = [FAST_MODEL, "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash"].filter((id) =>
            supported.length === 0 ? true : supported.includes(id)
          );
          let genOk: string | null = null;
          let genErr = "";
          for (const modelId of candidates.slice(0, 4)) {
            try {
              const genRes = await safeFetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${key}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: "responda apenas: OK" }] }],
                    generationConfig: { maxOutputTokens: 8 },
                  }),
                  timeoutMs: 9000,
                }
              );
              if (genRes.ok) {
                genOk = modelId;
                break;
              }
              const gj = (await genRes.json().catch(() => ({}))) as { error?: { message?: string } };
              genErr = `${modelId}: HTTP ${genRes.status} ${gj?.error?.message || ""}`.slice(0, 160);
              if (genRes.status === 401 || genRes.status === 403) break;
            } catch (e) {
              genErr = `${modelId}: ${String(e).slice(0, 80)}`;
            }
          }
          if (genOk) {
            return NextResponse.json({
              success: true,
              message: `✅ Chave autenticada com sucesso! Conexão ativa com o modelo ${genOk}.`,
            });
          }
          return NextResponse.json({
            success: false,
            warning: true,
            message: `A chave autentica na API Google, mas NENHUM modelo de geração respondeu (${genErr || "nenhum candidato suportado"}). Verifique limites do free tier/quota em https://aistudio.google.com/apikey — modelos marcados como "no longer available to new users" são pulados automaticamente pela cascata.`,
          }, { status: 200 });
        }
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error?.message || `Status HTTP ${res.status}`;
        return NextResponse.json({ success: false, message: `Erro Gemini: ${errMsg}` }, { status: 401 });
      }

      if (provider === "claude") {
        const url = "https://api.anthropic.com/v1/models";
        const res = await safeFetch(url, {
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
        const res = await safeFetch(targetUrl, {
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
        const res = await safeFetch(url, {
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
        const res = await safeFetch(targetUrl, { headers, signal: controller.signal });
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
