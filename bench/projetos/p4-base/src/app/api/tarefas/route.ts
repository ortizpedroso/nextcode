import { NextResponse } from "next/server";
import { listarTarefas, criarTarefa } from "@/lib/tarefas";

export async function GET() {
  return NextResponse.json(listarTarefas(), { status: 200 });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const titulo = typeof body?.titulo === "string" ? body.titulo : "";
  return NextResponse.json(criarTarefa(titulo), { status: 201 });
}
