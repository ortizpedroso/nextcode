import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

function getWindowsDrives(): string[] {
  if (process.platform !== "win32") return [];
  const drives: string[] = [];
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let i = 0; i < letters.length; i++) {
    const drive = `${letters[i]}:\\`;
    try {
      if (fs.existsSync(drive)) {
        drives.push(drive);
      }
    } catch {}
  }
  return drives;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const paramPath = searchParams.get("targetPath");

    let targetPath = paramPath && paramPath.trim() ? paramPath.trim() : process.cwd();

    targetPath = path.normalize(targetPath);

    let exists = false;
    let isDirectory = false;

    try {
      const stat = fs.statSync(targetPath);
      exists = true;
      isDirectory = stat.isDirectory();
    } catch {
      exists = false;
      isDirectory = false;
    }

    if (!exists || !isDirectory) {
      // Fallback para diretório de trabalho atual se o caminho solicitado for inválido
      targetPath = process.cwd();
    }

    const parentPath = path.dirname(targetPath) !== targetPath ? path.dirname(targetPath) : null;
    const drives = getWindowsDrives();

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(targetPath, { withFileTypes: true });
    } catch {
      entries = [];
    }

    const directories = entries
      .filter((entry) => {
        if (!entry.isDirectory()) return false;
        if (entry.name.startsWith(".") && entry.name !== ".env.example") return false;
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next") return false;
        return true;
      })
      .map((entry) => ({
        name: entry.name,
        path: path.join(targetPath, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      currentPath: targetPath,
      parentPath,
      directories,
      drives,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Falha ao listar diretórios locais", details: String(error) },
      { status: 500 }
    );
  }
}
