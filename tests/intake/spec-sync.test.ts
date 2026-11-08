import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { CANONICAL_SPEC_RELATIVE_PATH } from "@/core/intake/spec-file";
import {
  assessProjectSpecArtifacts,
  formatProjectSpecArtifactStatus,
  readMacrobriefSpecVersion,
} from "@/core/intake/spec-sync";

const storedSpec = `---
titulo: "API de Tarefas"
status: aguardando_aprovacao
stack:
  - "Next.js"
modulos:
  - id: api
    nome: "Rotas"
    resumo: "Criar e listar."
    arquivos:
      - "src/app/api/tasks/route.ts"
rotas:
  - caminho: "/api/tasks"
    descricao: "POST cria, GET lista."
arquivos_afetados:
  - "src/app/api/tasks/route.ts"
requisitos:
  - id: REQ-001
    titulo: "Listar e criar"
    criterio: "src/app/api/tasks/route.ts implementa GET e POST."
---

# API de Tarefas
`;

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nc-spec-sync-"));
  dirs.push(dir);
  return dir;
}

describe("Documento central no disco e na sessão", () => {
  it("lê spec_versao do macrobrief", () => {
    const root = tempProject();
    fs.mkdirSync(path.join(root, ".nextcode"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".nextcode", "macrobrief.md"),
      "---\nspec_versao: 4\n---\n",
      "utf8"
    );
    expect(readMacrobriefSpecVersion(root)).toBe(4);
  });

  it("detecta macrobrief sem spec como estado incompleto", () => {
    const root = tempProject();
    fs.mkdirSync(path.join(root, ".nextcode"), { recursive: true });
    fs.writeFileSync(path.join(root, ".nextcode", "macrobrief.md"), "---\nspec_versao: 1\n---\n", "utf8");
    const state = assessProjectSpecArtifacts(root, null);
    expect(state.macrobrief).toBe(true);
    expect(state.diskSpec).toBe(false);
    const msg = formatProjectSpecArtifactStatus(state).join("\n");
    expect(msg).toContain("Macrobrief");
    expect(msg).toContain("não há Spec");
  });

  it("marca divergência quando sessão e disco diferem", () => {
    const root = tempProject();
    fs.mkdirSync(path.join(root, ".nextcode"), { recursive: true });
    fs.writeFileSync(path.join(root, CANONICAL_SPEC_RELATIVE_PATH), storedSpec, "utf8");
    const other = storedSpec.replace("API de Tarefas", "API Outra");
    const state = assessProjectSpecArtifacts(root, other);
    expect(state.divergente).toBe(true);
  });
});
