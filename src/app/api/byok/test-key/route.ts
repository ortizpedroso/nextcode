import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import { safeFetch } from "@/core/security/safe-fetch";
import { FAST_MODEL, HEAVY_MODEL } from "@/core/router/smart-router";

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
          // FIX DEFINITIVO ("sempre amarelo mesmo com chave válida"):
          //  1) A lista /v1beta/models NÃO é fonte confiável de elegibilidade: ela
          //     retorna modelos SEM "generateContent" na supportedActions (ex.:
          //     variantes -lite e thinking) que ainda assim funcionam via alias, e o
          //     filtro antigo descartava candidatos válidos → sobrava só o obsoleto
          //     gemini-2.5-flash-lite → HTTP 404 garantido.
          //  2) O erro de geração agora É retornado (antes era engolido por um
          //     clearTimeout() no caminho de sucesso).
          //  3) Timeout dedicado por tentativa de geração (sem AbortController
          //     externo competindo) e mensagem final com TODOS os erros vistos.
          const listJson = (await res.json().catch(() => null)) as
            | { models?: Array<{ name?: string; supportedActions?: string[] }> }
            | null;
          const all = listJson?.models ?? [];
          const canGenerate = new Set(
            all
              .filter((m) => !m.supportedActions || m.supportedActions.includes("generateContent"))
              .map((m) => (m.name || "").replace(/^models\//, ""))
          );

          // Cascata priorizada: modelo do router primeiro, depois aliases estáveis
          // atuais da família Flash/Pro. Modelos obsoletos (gemini-2.5) fora.
          const priority = [
            "gemini-1.5-flash",
            "gemini-2.0-flash",
            "gemini-1.5-pro",
            "gemini-2.0-flash-lite",
            FAST_MODEL,
            HEAVY_MODEL,
          ];
          // Candidatos = interseção com o catálogo (quando disponível), preservando
          // a ordem de prioridade; se a lista vier vazia, usa a prioridade inteira.
          const candidates = (canGenerate.size > 0
            ? priority.filter((id) => canGenerate.has(id))
            : priority
          ).filter(Boolean) as string[];

          let genOk: string | null = null;
          const errors: string[] = [];
          for (const modelId of candidates.slice(0, 5)) {
            try {
              const genRes = await safeFetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(key)}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: "responda apenas: OK" }] }],
                    generationConfig: { maxOutputTokens: 8 },
                  }),
                  timeoutMs: 12000,
                }
              );
              if (genRes.ok) {
                genOk = modelId;
                break;
              }
              const gj = (await genRes.json().catch(() => ({}))) as { error?: { message?: string; status?: string } };
              const msg = gj?.error?.message || `HTTP ${genRes.status}`;
              // 404 "no longer available" = modelo morto p/ esta conta: pula em silêncio.
              errors.push(`${modelId}: ${msg.slice(0, 120)}`);
              if (genRes.status === 401 || genRes.status === 403) break; // chave inválida: para
            } catch (e) {
              const isAbort = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
              errors.push(`${modelId}: ${isAbort ? "timeout (rede lenta)" : String(e).slice(0, 80)}`);
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
            message: `A chave autentica na API Google, mas nenhum modelo de teste respondeu (${errors.join(" | ") || "nenhum candidato elegível no catálogo"}). Verifique billing/free tier em https://aistudio.google.com/apikey`,
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
