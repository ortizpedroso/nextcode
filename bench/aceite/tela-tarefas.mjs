import fs from "node:fs";
import path from "node:path";
import { verificar } from "./comum.mjs";

/** REQ-004 (P2), parte estática. A tela em execução é coberta pelo ui-check. */
export async function testarTelaTarefas(root, r) {
  const arq = path.join(root, "src/app/tarefas/page.tsx");
  let src = "";

  await r.teste("T1", "REQ-004", "src/app/tarefas/page.tsx existe e começa com a diretiva use client", async () => {
    verificar(fs.existsSync(arq), "arquivo ausente");
    src = fs.readFileSync(arq, "utf8");
    const semComentarios = src
      .replace(/^﻿/, "")
      .replace(/^(\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*/, "")
      .trimStart();
    verificar(/^["']use client["']/.test(semComentarios), "não começa com a diretiva use client");
  });

  await r.teste("T2", "REQ-004", "tem export default", async () => {
    verificar(/export\s+default\s+/.test(src), "sem export default");
  });

  await r.teste("T3", "REQ-004", "consome /api/tarefas com POST, PATCH e DELETE", async () => {
    verificar(/\/api\/tarefas/.test(src), "não referencia /api/tarefas");
    for (const m of ["POST", "PATCH", "DELETE"]) {
      verificar(new RegExp(`["'\`]${m}["'\`]`).test(src), `não usa ${m}`);
    }
  });
}
