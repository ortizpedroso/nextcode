import { importar, req, ctx, lerJson, comoLista, comoTarefa, verificar } from "./comum.mjs";

/** REQ-001..REQ-003 da Spec de P1/P2 (API de tarefas em memória). */
export async function testarApiTarefas(root, r) {
  let lista;
  let item;

  await r.teste("A1", "REQ-001", "src/lib/tarefas.ts exporta listarTarefas, criarTarefa, atualizarTarefa, removerTarefa", async () => {
    const store = await importar(root, "src/lib/tarefas.ts");
    for (const f of ["listarTarefas", "criarTarefa", "atualizarTarefa", "removerTarefa"]) {
      verificar(typeof store[f] === "function", `${f} não é função exportada`);
    }
  });

  try {
    lista = await importar(root, "src/app/api/tarefas/route.ts");
  } catch (e) {
    lista = { __erro: String(e).slice(0, 200) };
  }
  try {
    item = await importar(root, "src/app/api/tarefas/[id]/route.ts");
  } catch (e) {
    item = { __erro: String(e).slice(0, 200) };
  }

  await r.teste("A2", "REQ-002", "GET /api/tarefas → 200 com lista", async () => {
    verificar(typeof lista.GET === "function", `GET não exportado ${lista.__erro || ""}`);
    const res = await lista.GET(req("/api/tarefas", "GET"));
    verificar(res.status === 200, `status ${res.status}`);
    verificar(comoLista(await lerJson(res)) !== null, "corpo não é lista");
  });

  // Cada teste cria a sua própria tarefa: um erro num teste não derruba os outros (sem cascata).
  async function novaTarefa(titulo) {
    verificar(typeof lista.POST === "function", `POST não exportado ${lista.__erro || ""}`);
    const t = comoTarefa(await lerJson(await lista.POST(req("/api/tarefas", "POST", { titulo }))));
    verificar(t && typeof t.id === "string" && t.id.length > 0, "não foi possível criar tarefa para o teste");
    return t;
  }

  await r.teste("A3", "REQ-002", "POST titulo válido → 201 com a tarefa (id, titulo, concluida=false, criadaEm)", async () => {
    verificar(typeof lista.POST === "function", `POST não exportado ${lista.__erro || ""}`);
    const res = await lista.POST(req("/api/tarefas", "POST", { titulo: "Comprar pão" }));
    verificar(res.status === 201, `status ${res.status}`);
    const t = comoTarefa(await lerJson(res));
    verificar(t, "corpo sem a tarefa");
    verificar(t.titulo === "Comprar pão", `titulo ${t.titulo}`);
    verificar(typeof t.id === "string" && t.id.length > 0, "id ausente ou não é texto");
    verificar(t.concluida === false, `concluida ${t.concluida}`);
    verificar(typeof t.criadaEm === "string" && t.criadaEm.length > 0, "criadaEm ausente");
  });

  await r.teste("A4", "REQ-002", "POST titulo vazio → 400", async () => {
    const res = await lista.POST(req("/api/tarefas", "POST", { titulo: "" }));
    verificar(res.status === 400, `status ${res.status}`);
  });

  await r.teste("A5", "REQ-002", "POST sem titulo → 400", async () => {
    const res = await lista.POST(req("/api/tarefas", "POST", {}));
    verificar(res.status === 400, `status ${res.status}`);
  });

  await r.teste("A6", "REQ-002", "GET depois do POST contém a tarefa criada", async () => {
    const criada = await novaTarefa("Tarefa A6");
    const l = comoLista(await lerJson(await lista.GET(req("/api/tarefas", "GET"))));
    verificar(l && l.some((t) => t.id === criada.id), "tarefa criada não aparece na lista");
  });

  await r.teste("A7", "REQ-003", "PATCH id existente (concluida=true) → 2xx e a lista reflete", async () => {
    const criada = await novaTarefa("Tarefa A7");
    verificar(typeof item.PATCH === "function", `PATCH não exportado ${item.__erro || ""}`);
    const res = await item.PATCH(req(`/api/tarefas/${criada.id}`, "PATCH", { concluida: true }), ctx(criada.id));
    verificar(res.status >= 200 && res.status < 300, `status ${res.status}`);
    const l = comoLista(await lerJson(await lista.GET(req("/api/tarefas", "GET"))));
    const t = l && l.find((x) => x.id === criada.id);
    verificar(t && t.concluida === true, "concluida não ficou true");
  });

  await r.teste("A8", "REQ-003", "PATCH id inexistente → 404", async () => {
    verificar(typeof item.PATCH === "function", `PATCH não exportado ${item.__erro || ""}`);
    const res = await item.PATCH(req("/api/tarefas/nao-existe", "PATCH", { concluida: true }), ctx("nao-existe"));
    verificar(res.status === 404, `status ${res.status}`);
  });

  await r.teste("A9", "REQ-003", "DELETE id existente → 2xx e some da lista", async () => {
    const criada = await novaTarefa("Tarefa A9");
    verificar(typeof item.DELETE === "function", `DELETE não exportado ${item.__erro || ""}`);
    const res = await item.DELETE(req(`/api/tarefas/${criada.id}`, "DELETE"), ctx(criada.id));
    verificar(res.status >= 200 && res.status < 300, `status ${res.status}`);
    const l = comoLista(await lerJson(await lista.GET(req("/api/tarefas", "GET"))));
    verificar(l && !l.some((x) => x.id === criada.id), "tarefa ainda aparece");
  });

  await r.teste("A10", "REQ-003", "DELETE id inexistente → 404", async () => {
    verificar(typeof item.DELETE === "function", `DELETE não exportado ${item.__erro || ""}`);
    const res = await item.DELETE(req("/api/tarefas/nao-existe", "DELETE"), ctx("nao-existe"));
    verificar(res.status === 404, `status ${res.status}`);
  });
}
