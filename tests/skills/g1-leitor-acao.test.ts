import { describe, it, expect } from "vitest";
import { parseExecutorToolActions, parseJsonLenient } from "@/core/skills/executor-tool-loop";

// G1 (mudança 38): formatos reais recusados no teste real 4d019f00 (49 turnos com a ação certa).
const ok = (t: string) => {
  const r = parseExecutorToolActions(t);
  if (!r.ok) throw new Error(r.error);
  return r.actions;
};

describe("G1 — leitor de ação tolerante às variações reais do modelo", () => {
  it("rótulo acao na linha de baixo do ```json (etapas 11, 15, 19, 20)", () => {
    expect(ok('```json\nacao\n{"ferramenta": "run_check", "args": {"comando": "typecheck"}}\n```')[0].ferramenta).toBe("run_check");
    const lista = ok('```json\nacao\n[\n  {"ferramenta": "list_files", "args": {"pasta": "src/app/api"}},\n  {"ferramenta": "read_file", "args": {"caminho": "a.ts"}}\n]\n```');
    expect(lista.map((a) => a.ferramenta)).toEqual(["list_files", "read_file"]);
  });

  it("lista em ```json sem rótulo (etapa 14) continua valendo", () => {
    expect(ok('```json\n[{"ferramenta": "write_file", "args": {"caminho": "a.ts", "conteudo": "x"}}]\n```')).toHaveLength(1);
  });

  it("conteúdo com ``` dentro não fecha o bloco no meio", () => {
    const escapado = "# Leia-me\\n```bash\\nnpm i\\n```\\n";
    const a = ok('```json acao\n{"ferramenta": "write_file", "args": {"caminho": "README.md", "conteudo": "' + escapado + '"}}\n```');
    expect(a[0].args.conteudo).toBe("# Leia-me\n```bash\nnpm i\n```\n");
  });

  it("quebra de linha crua dentro de \"conteudo\" é aceita", () => {
    const cru = "linha 1\nlinha 2\n";
    const a = ok('```json acao\n{"ferramenta": "write_file", "args": {"caminho": "a.txt", "conteudo": "' + cru + '"}}\n```');
    expect(a[0].args.conteudo).toBe("linha 1\nlinha 2\n");
  });

  it("barra invertida sem escape (regex no código) é aceita", () => {
    const a = ok('```json acao\n{"ferramenta": "write_file", "args": {"caminho": "a.ts", "conteudo": "const r = /^\\d+$/;"}}\n```');
    expect(a[0].args.conteudo).toBe("const r = /^\\d+$/;");
    expect(parseJsonLenient('{"a":"\\\\d"}')).toEqual({ ok: true, value: { a: "\\d" } });
  });

  it("sobra de fechamento ou crase depois da lista (2 turnos reais) é aceita", () => {
    expect(ok('```json acao\n[{"ferramenta": "read_file", "args": {"caminho": "src/lib/erros.ts"}}, {"ferramenta": "list_files", "args": {"pasta": "src/lib"}}]}]```\n')).toHaveLength(2);
    expect(ok('```json acao\n[{"ferramenta": "list_files", "args": {"pasta": "tests"}}]`\n```')).toHaveLength(1);
  });

  it("resposta cortada: o erro diz que o bloco não fechou", () => {
    const r = parseExecutorToolActions('```json acao\n{"ferramenta": "write_file", "args": {"caminho": "a.ts", "conteudo": "abc');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/terminou antes de fechar o bloco/);
  });

  it("JSON quebrado: o erro aponta onde", () => {
    const r = parseExecutorToolActions('```json acao\n{"ferramenta": "write_file", "args": {"caminho": "a.ts" "conteudo": "x"}}\n```');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/perto de/);
  });

  it("bloco de código comum (```typescript) não é ação", () => {
    const r = parseExecutorToolActions("```typescript\nconst a = { b: 1 };\n```");
    expect(r.ok).toBe(false);
  });
});
