import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import { safeFetch } from "@/core/security/safe-fetch";
import prisma from "@/lib/prisma";
import { readSecret } from "@/core/security/crypto";

async function resolveKeyForTest(provider: string, inputKey?: string): Promise<string> {
  const str = (inputKey || "").trim();
  if (str && !str.startsWith("••••") && !str.startsWith("****")) {
    return str;
  }
  let setting: any = null;
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "Setting" WHERE "id" = 'default' LIMIT 1`);
    if (rows && rows.length > 0) setting = rows[0];
  } catch {
    setting = null;
  }
  if (!setting) {
    setting = await prisma.setting.findFirst({ where: { id: "default" } });
  }
  if (!setting) return "";

  let encryptedVal: string | null = null;
  if (provider === "gemini") encryptedVal = setting.geminiKey;
  else if (provider === "claude") encryptedVal = setting.claudeKey;
  else if (provider === "openai") encryptedVal = setting.openaiKey;
  else if (provider === "deepseek") encryptedVal = setting.deepseekKey;
  else if (provider === "groq") encryptedVal = setting.groqKey;
  else if (provider === "nvidia") encryptedVal = setting.nvidiaKey;
  else if (provider === "omniRoute" || provider === "custom") encryptedVal = setting.omniRouteKey;

  if (!encryptedVal) return "";
  return readSecret(encryptedVal) || "";
}

export async function POST(request: NextRequest) {
  // Fases 3+4: rota que testa URLs/chaves fornecidas pelo usuário é o vetor SSRF
  // clássico; agora exige token local e passa todas as URLs por safeFetch.
  const guard = requireAuth(request);
  if (guard.response) return guard.response;
  try {
    const body = await request.json();
    const { provider, apiKey, baseUrl } = body;

    const key = await resolveKeyForTest(provider, apiKey);
    if (!key && provider !== "omniRoute" && provider !== "custom") {
      return NextResponse.json(
        { success: false, message: "Nenhuma chave salva no banco de dados ou informada no campo." },
        { status: 400 }
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    try {
      if (provider === "gemini") {
        const { getAvailableGeminiModels } = await import("@/core/router/gemini-client");
        const candidates = await getAvailableGeminiModels(key);
        clearTimeout(timeoutId);

        let genOk: string | null = null;
        const errors: string[] = [];

        for (const modelId of candidates.slice(0, 6)) {
          try {
            let genRes = await safeFetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(key)}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ role: "user", parts: [{ text: "responda apenas: OK" }] }],
                  generationConfig: { maxOutputTokens: 8 },
                }),
                timeoutMs: 10000,
              }
            );

            if (genRes.status === 503 || genRes.status === 429) {
              await new Promise((r) => setTimeout(r, 1000));
              genRes = await safeFetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(key)}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: "responda apenas: OK" }] }],
                    generationConfig: { maxOutputTokens: 8 },
                  }),
                  timeoutMs: 10000,
                }
              );
            }

            if (genRes.ok) {
              genOk = modelId;
              break;
            }

            const gj = (await genRes.json().catch(() => ({}))) as { error?: { message?: string } };
            const msg = gj?.error?.message || `HTTP ${genRes.status}`;
            if (!msg.includes("no longer available")) {
              errors.push(`${modelId}: ${msg.slice(0, 100)}`);
            }
            if (genRes.status === 401 || genRes.status === 403) break;
          } catch (e) {
            const isAbort = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
            errors.push(`${modelId}: ${isAbort ? "timeout" : "erro de rede"}`);
          }
        }

        if (genOk) {
          return NextResponse.json({
            success: true,
            message: `✅ Chave autenticada com sucesso! Conexão ativa com o modelo ${genOk}.`,
          });
        }

        return NextResponse.json(
          {
            success: false,
            warning: true,
            message: `A chave autentica na API Google, mas os modelos retornaram: ${errors.join(" | ") || "sem resposta"}. Verifique billing/free tier em https://aistudio.google.com/apikey`,
          },
          { status: 200 }
        );
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

      if (provider === "groq") {
        const url = "https://api.groq.com/openai/v1/models";
        const res = await safeFetch(url, {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          return NextResponse.json({ success: true, message: "⚡ Chave Groq Válida e Ativa!" });
        }
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error?.message || `Status HTTP ${res.status}`;
        return NextResponse.json({ success: false, message: `Erro Groq: ${errMsg}` });
      }

      if (provider === "nvidia") {
        const url = "https://integrate.api.nvidia.com/v1/models";
        const res = await safeFetch(url, {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          return NextResponse.json({ success: true, message: "🟢 Chave NVIDIA NIM Válida e Ativa!" });
        }
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error?.message || `Status HTTP ${res.status}`;
        return NextResponse.json({ success: false, message: `Erro NVIDIA: ${errMsg}` });
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
