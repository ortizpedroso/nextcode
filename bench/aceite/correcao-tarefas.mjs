import { importar, req, ctx, lerJson, comoTarefa, verificar } from "./comum.mjs";
import { testarApiTarefas } from "./api-tarefas.mjs";

/**
 * P4 — correção num projeto pronto (base com bugs em bench/projetos/p4-base/).
 * A1–A10: o comportamento pedido (inclui os bugs corrigidos: A4/A5 título vazio, A8 PATCH 404).
 * X1–X2: o que já funcionava e NÃO podia quebrar (GET por id, que existe só na base).
 */
export async function testarCorrecaoTarefas(root, r) {
  await testarApiTarefas(root, r);

  let lista;
  let item;
  try {
    lista = await importar(root, "src/app/api/tarefas/route.ts");
    item = await importar(root, "src/app/api/tarefas/[id]/route.ts");
  } catch (e) {
    lista = lista || {};
    item = { __erro: String(e).slice(0, 200) };
  }

  await r.teste("X1", "PRESERVAR", "GET /api/tarefas/[id] existente → 200 com a tarefa (já existia na base)", async () => {
    verificar(typeof item.GET === "function", `GET por id foi removido ${item.__erro || ""}`);
    const t = comoTarefa(await lerJson(await lista.POST(req("/api/tarefas", "POST", { titulo: "Tarefa X1" }))));
    verificar(t && t.id, "não foi possível criar tarefa");
    const res = await item.GET(req(`/api/tarefas/${t.id}`, "GET"), ctx(t.id));
    verificar(res.status === 200, `status ${res.status}`);
    const corpo = comoTarefa(await lerJson(res));
    verificar(corpo && corpo.id === t.id, "corpo não é a tarefa");
  });

  await r.teste("X2", "PRESERVAR", "GET /api/tarefas/[id] inexistente → 404 (já existia na base)", async () => {
    verificar(typeof item.GET === "function", "GET por id foi removido");
    const res = await item.GET(req("/api/tarefas/nao-existe", "GET"), ctx("nao-existe"));
    verificar(res.status === 404, `status ${res.status}`);
  });
}
