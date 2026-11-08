import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSpecDocument } from "@/core/intake/spec-format";
import {
  CANONICAL_SPEC_RELATIVE_PATH,
  canonicalSpecFileNotice,
  writeCanonicalSpecFile,
} from "@/core/intake/spec-file";

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

Documento central do projeto.
`;

const essay = `\`\`\`yaml
title: "NextPay"
rotas:
  - { caminho: "/api/health", cad: "Healthcheck" }
\`\`\`

## Visão Geral

Qual ponto você gostaria de aprofundar?
`;

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-spec-file-"));
  dirs.push(dir);
  return dir;
}

describe("A Spec canônica vira arquivo na pasta do projeto", () => {
  it("grava .nextcode/spec.md e o arquivo continua parseável", () => {
    const root = tempProject();
    const res = writeCanonicalSpecFile(root, storedSpec);
    expect(res).toEqual({ ok: true, relativePath: CANONICAL_SPEC_RELATIVE_PATH, wrote: true });
    const onDisk = fs.readFileSync(path.join(root, CANONICAL_SPEC_RELATIVE_PATH), "utf8");
    expect(parseSpecDocument(onDisk)?.titulo).toBe("API de Tarefas");
    expect(canonicalSpecFileNotice(res)).toContain(CANONICAL_SPEC_RELATIVE_PATH);
  });

  it("a segunda gravação do mesmo texto não reescreve", () => {
    const root = tempProject();
    writeCanonicalSpecFile(root, storedSpec);
    const again = writeCanonicalSpecFile(root, storedSpec);
    expect(again).toMatchObject({ ok: true, wrote: false });
  });

  it("um ensaio não cria o arquivo", () => {
    const root = tempProject();
    const res = writeCanonicalSpecFile(root, essay);
    expect(res).toEqual({ ok: false, reason: "spec_invalida" });
    expect(fs.existsSync(path.join(root, CANONICAL_SPEC_RELATIVE_PATH))).toBe(false);
    expect(canonicalSpecFileNotice(res)).toBeNull();
  });

  it("sem pasta avisa que o arquivo não foi criado", () => {
    const res = writeCanonicalSpecFile("", storedSpec);
    expect(res).toEqual({ ok: false, reason: "sem_pasta" });
    expect(canonicalSpecFileNotice(res)).toContain("Vincule uma pasta");
  });
});
