import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { targetPath } = body;

    if (!targetPath || typeof targetPath !== "string" || !targetPath.trim()) {
      return NextResponse.json({ exists: false, isDirectory: false, message: "Caminho não fornecido." });
    }

    const normalized = path.normalize(targetPath.trim());
    const exists = fs.existsSync(normalized);

    let isDirectory = false;
    if (exists) {
      try {
        const stat = fs.statSync(normalized);
        isDirectory = stat.isDirectory();
      } catch {
        isDirectory = false;
      }
    }

    return NextResponse.json({
      exists,
      isDirectory,
      realPath: normalized,
      message: exists
        ? `Caminho verificado no sistema de arquivos local (${isDirectory ? "Diretório" : "Arquivo"}).`
        : "Caminho não encontrado no sistema de arquivos local.",
    });
  } catch (error) {
    return NextResponse.json(
      { exists: false, isDirectory: false, error: String(error) },
      { status: 500 }
    );
  }
}
