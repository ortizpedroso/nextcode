import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const providers = await prisma.customProvider.findMany({
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ providers });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao buscar provedores customizados", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
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
        apiKey: apiKey ? apiKey.trim() : null,
        models: typeof models === "string" ? models : JSON.stringify(models || []),
        headers: typeof headers === "string" ? headers : JSON.stringify(headers || {}),
      },
      update: {
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey !== undefined ? (apiKey ? apiKey.trim() : null) : undefined,
        models: models !== undefined ? (typeof models === "string" ? models : JSON.stringify(models)) : undefined,
        headers: headers !== undefined ? (typeof headers === "string" ? headers : JSON.stringify(headers)) : undefined,
      },
    });

    return NextResponse.json({ success: true, provider });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao salvar provedor customizado", details: String(error) },
      { status: 500 }
    );
  }
}
