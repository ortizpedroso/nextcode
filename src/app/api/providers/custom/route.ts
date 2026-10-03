import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";
import { writeSecret, MasterKeyMissingError } from "@/core/security/crypto";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const providers = await prisma.customProvider.findMany({
      orderBy: { updatedAt: "desc" },
    });
    // Fase 4: nunca expor a apiKey (mesmo cifrada) para o cliente.
    const safeProviders = providers.map((p) => ({ ...p, apiKey: p.apiKey ? "••••" : null }));
    return NextResponse.json({ providers: safeProviders });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao buscar provedores customizados", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const guard = requireAuth(request);
  if (guard.response) return guard.response;
  try {
    const body = await request.json();
    const { id, name, baseUrl, apiKey, models, headers } = body;

    if (!id || typeof id !== "string" || !/^[a-z0-9_-]+$/.test(id.trim())) {
      return NextResponse.json(
        { error: "ID inválido. Use apenas letras minúsculas, números, hifens e sublinhados (ex: 'ollama-local')." },
        { status: 400 }
      );
    }

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Nome de exibição é obrigatório." }, { status: 400 });
    }

    if (!baseUrl || typeof baseUrl !== "string" || !baseUrl.trim()) {
      return NextResponse.json({ error: "URL Base é obrigatória." }, { status: 400 });
    }

    const provider = await prisma.customProvider.upsert({
      where: { id: id.trim() },
      create: {
        id: id.trim(),
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey ? writeSecret(apiKey) : null,
        models: typeof models === "string" ? models : JSON.stringify(models || []),
        headers: typeof headers === "string" ? headers : JSON.stringify(headers || {}),
      },
      update: {
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey !== undefined ? (apiKey ? writeSecret(apiKey) : null) : undefined,
        models: models !== undefined ? (typeof models === "string" ? models : JSON.stringify(models)) : undefined,
        headers: headers !== undefined ? (typeof headers === "string" ? headers : JSON.stringify(headers)) : undefined,
      },
    });

    return NextResponse.json({ success: true, provider });
  } catch (error) {
    if (error instanceof MasterKeyMissingError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: "Falha ao salvar provedor customizado", details: String(error) },
      { status: 500 }
    );
  }
}
