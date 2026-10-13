import { NextResponse } from "next/server";
import { listarTarefas, criarTarefa } from "@/lib/tarefas";

export async function GET() {
  return NextResponse.json(listarTarefas(), { status: 200 });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const titulo = typeof body?.titulo === "string" ? body.titulo.trim() : "";
  if (!titulo) return NextResponse.json({ erro: "titulo obrigatório" }, { status: 400 });
  return NextResponse.json(criarTarefa(titulo), { status: 201 });
}
