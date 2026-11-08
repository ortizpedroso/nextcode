import * as path from "path";
import prisma from "@/lib/prisma";

export function projectPathsEqual(a: string, b: string): boolean {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

/** Body `path` só pode auditar pastas já cadastradas como Project.path no Prisma. */
export async function assertRegisteredProjectDirectory(
  resolvedPath: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const projects = await prisma.project.findMany({
    where: { path: { not: null } },
    select: { path: true },
  });
  const match = projects.some((p) => p.path && projectPathsEqual(p.path, resolvedPath));
  if (!match) {
    return {
      ok: false,
      message:
        "Caminho não corresponde a nenhum projeto cadastrado no NextCode. Informe projectId ou cadastre o projeto com esta pasta antes de auditar.",
    };
  }
  return { ok: true };
}
