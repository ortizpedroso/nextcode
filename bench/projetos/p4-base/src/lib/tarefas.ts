export interface Tarefa { id: string; titulo: string; concluida: boolean; criadaEm: string }
const tarefas: Tarefa[] = [];
let seq = 0;
export function listarTarefas(): Tarefa[] { return [...tarefas]; }
export function criarTarefa(titulo: string): Tarefa { const t = { id: String(++seq), titulo, concluida: false, criadaEm: new Date().toISOString() }; tarefas.push(t); return t; }
export function atualizarTarefa(id: string, dados: Partial<Pick<Tarefa, "titulo" | "concluida">>): Tarefa | null { const t = tarefas.find((x) => x.id === id); if (!t) return null; Object.assign(t, dados); return t; }
export function removerTarefa(id: string): boolean { const i = tarefas.findIndex((x) => x.id === id); if (i < 0) return false; tarefas.splice(i, 1); return true; }
