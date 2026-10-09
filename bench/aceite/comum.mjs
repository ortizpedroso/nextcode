import path from "node:path";
import { pathToFileURL } from "node:url";

export function criarRegistro() {
  const resultados = [];
  return {
    resultados,
    async teste(id, reqId, nome, fn) {
      try {
        await fn();
        resultados.push({ id, req: reqId, nome, ok: true });
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        resultados.push({ id, req: reqId, nome, ok: false, detalhe: msg.slice(0, 300) });
      }
    },
  };
}

export function verificar(cond, msg) {
  if (!cond) throw new Error(msg);
}

export async function importar(root, rel) {
  return import(pathToFileURL(path.join(root, rel)).href);
}

export function req(url, method, body) {
  const init = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`http://localhost${url}`, init);
}

export const ctx = (id) => ({ params: Promise.resolve({ id }) });

export async function lerJson(res) {
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}

export function comoLista(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.tarefas)) return body.tarefas;
  if (body && Array.isArray(body.data)) return body.data;
  return null;
}

export function comoTarefa(body) {
  if (body && typeof body === "object" && "titulo" in body) return body;
  if (body && body.tarefa && typeof body.tarefa === "object") return body.tarefa;
  if (body && body.data && typeof body.data === "object") return body.data;
  return null;
}
