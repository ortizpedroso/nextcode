import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import * as fs from "fs";
import * as path from "path";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".quarantine",
  ".gemini",
  "coverage",
]);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("query");
    const projectId = searchParams.get("projectId");
    const isRegex = searchParams.get("isRegex") === "true";

    if (!query || !query.trim()) {
      return NextResponse.json({ matches: [], total: 0 });
    }

    let rootPath = process.cwd();
    if (projectId) {
      const proj = await prisma.project.findUnique({ where: { id: projectId } });
      if (proj && proj.path && fs.existsSync(proj.path)) {
        rootPath = proj.path;
      }
    }

    const matches: Array<{
      filePath: string;
      relativePath: string;
      lineNumber: number;
      lineText: string;
    }> = [];

    const searchPattern = isRegex
      ? new RegExp(query, "i")
      : null;
    const lowerQuery = query.toLowerCase();

    function walk(currentDir: string) {
      if (matches.length >= 100) return; // Limite de 100 resultados para performance

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (matches.length >= 100) break;

        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) {
            walk(fullPath);
          }
        } else if (entry.isFile()) {
          // Filtra por extensões relevantes de código/texto
          const ext = path.extname(entry.name).toLowerCase();
          const allowedExts = [
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".json",
            ".md",
            ".prisma",
            ".css",
            ".html",
            ".py",
            ".sh",
            ".env",
          ];

          if (!allowedExts.includes(ext) && !entry.name.startsWith(".")) continue;

          try {
            const content = fs.readFileSync(fullPath, "utf-8");
            const lines = content.split("\n");

            for (let i = 0; i < lines.length; i++) {
              if (matches.length >= 100) break;
              const line = lines[i];

              let isMatch = false;
              if (searchPattern) {
                isMatch = searchPattern.test(line);
              } else {
                isMatch = line.toLowerCase().includes(lowerQuery);
              }

              if (isMatch) {
                matches.push({
                  filePath: fullPath,
                  relativePath: path.relative(rootPath, fullPath).replace(/\\/g, "/"),
                  lineNumber: i + 1,
                  lineText: line.trim().substring(0, 160),
                });
              }
            }
          } catch {
            // Ignora arquivos binários ou sem leitura
          }
        }
      }
    }

    walk(rootPath);

    return NextResponse.json({
      rootPath,
      total: matches.length,
      matches,
    });
  } catch (error: unknown) {
    console.error("Erro na busca de código do projeto:", error);
    return NextResponse.json(
      { error: "Falha na busca de código do projeto", details: String(error) },
      { status: 500 }
    );
  }
}
