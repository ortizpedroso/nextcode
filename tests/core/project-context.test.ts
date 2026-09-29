/**
 * Fase 14.2 — Testes do injetor de contexto de projeto local.
 * Cobre: fail-open (sem path / path inválido), leitura de manifesto/README,
 * ignorância de node_modules/.git, limites de truncamento e formato do bloco.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildProjectSnapshot,
  buildProjectContextBlock,
  formatProjectContext,
} from "@/core/project/project-context";

let tmpRoot = "";

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-ctx-"));

  // Projeto Node fake com node_modules (deve ser IGNORADO) e README
  const proj = path.join(tmpRoot, "meu-projeto");
  fs.mkdirSync(path.join(proj, "src"), { recursive: true });
  fs.mkdirSync(path.join(proj, "node_modules", "algum-pacote"), { recursive: true });
  fs.mkdirSync(path.join(proj, ".git"), { recursive: true });
  fs.writeFileSync(
    path.join(proj, "package.json"),
    JSON.stringify({ name: "meu-projeto", version: "1.0.0", description: "Micro-SaaS de teste" })
  );
  fs.writeFileSync(path.join(proj, "README.md"), "# Meu Projeto\nProjeto sobre gestão de cotas na Espanha e França.");
  fs.writeFileSync(path.join(proj, "src", "index.ts"), "export const x = 1;");
  fs.writeFileSync(path.join(proj, "node_modules", "algum-pacote", "index.js"), "noise");

  // Projeto Python (requirements.txt como manifesto)
  const py = path.join(tmpRoot, "projeto-py");
  fs.mkdirSync(py, { recursive: true });
  fs.writeFileSync(path.join(py, "requirements.txt"), "fastapi==0.100.0\nuvicorn");

  // Arquivo solto (não é diretório)
  fs.writeFileSync(path.join(tmpRoot, "arquivo-solto.txt"), "x");
});

afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* Windows pode travar temporariamente; ignora */
  }
});

describe("project-context — fail-open (não quebra o chat)", () => {
  it("retorna null sem path", () => {
    expect(buildProjectSnapshot({ name: "p", path: null })).toBeNull();
    expect(buildProjectSnapshot({ name: "p", path: "   " })).toBeNull();
  });

  it("retorna null para caminho inexistente", () => {
    expect(buildProjectSnapshot({ name: "p", path: path.join(tmpRoot, "nao-existe") })).toBeNull();
  });

  it("retorna null quando o path é um arquivo (não diretório)", () => {
    expect(buildProjectSnapshot({ name: "p", path: path.join(tmpRoot, "arquivo-solto.txt") })).toBeNull();
  });

  it("buildProjectContextBlock é null-safe", () => {
    expect(buildProjectContextBlock({ name: "p", path: null })).toBeNull();
  });
});

describe("project-context — snapshot real do projeto", () => {
  it("lê manifesto package.json e detecta stack Node", () => {
    const snap = buildProjectSnapshot({ name: "meu-projeto", path: path.join(tmpRoot, "meu-projeto") });
    expect(snap).not.toBeNull();
    expect(snap!.manifestName).toBe("package.json");
    expect(snap!.manifestContent).toContain("Micro-SaaS de teste");
    expect(snap!.readmeExcerpt).toContain("Espanha e França");
  });

  it("NUNCA inclui node_modules nem .git na árvore", () => {
    const snap = buildProjectSnapshot({ name: "meu-projeto", path: path.join(tmpRoot, "meu-projeto") });
    const treeText = snap!.tree.join("\n");
    expect(treeText).not.toContain("node_modules");
    expect(treeText).not.toContain(".git");
    expect(treeText).toContain("src/");
    expect(snap!.totalFilesScanned).toBeLessThanOrEqual(5); // nunca conta node_modules
  });

  it("suporta projetos Python via requirements.txt", () => {
    const snap = buildProjectSnapshot({ name: "py", path: path.join(tmpRoot, "projeto-py") });
    expect(snap!.manifestName).toBe("requirements.txt");
    expect(snap!.manifestContent).toContain("fastapi");
  });
});

describe("project-context — bloco <project_context> enviado à IA", () => {
  it("contém nome, caminho, manifesto e instrução de referência a 'o projeto'", () => {
    const block = buildProjectContextBlock({
      name: "meu-projeto",
      path: path.join(tmpRoot, "meu-projeto"),
      description: "SaaS de compliance UE",
    });
    expect(block).not.toBeNull();
    expect(block!).toContain("<project_context>");
    expect(block!).toContain("Nome do projeto: meu-projeto");
    expect(block!).toContain("Descrição cadastrada: SaaS de compliance UE");
    expect(block!).toContain("--- package.json ---");
    expect(block!).toContain("--- README (resumo) ---");
    expect(block!).toContain("--- Estrutura de arquivos ---");
    expect(block!).toContain("'o projeto'"); // instrução que resolve a pergunta ambígua
  });

  it("respeita o teto absoluto de caracteres em projetos grandes", () => {
    // Árvore + manifesto grande que ultrapassam MAX_TOTAL_SNAPSHOT_CHARS (24k)
    const bigTree = Array.from({ length: 500 }, (_, i) => `  arquivo-${i}.ts`);
    const out = formatProjectContext({
      projectName: "big",
      projectPath: "/tmp/big",
      manifestName: "package.json",
      manifestContent: "x".repeat(30_000),
      tree: bigTree,
      totalFilesScanned: 500,
      truncated: false,
    });
    expect(out.length).toBeLessThanOrEqual(24_000 + 200); // teto + sufixo de truncagem
    expect(out).toContain("[... contexto do projeto truncado ...]");
  });
});
