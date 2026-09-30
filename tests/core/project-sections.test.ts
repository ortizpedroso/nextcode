import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import prisma from "@/lib/prisma";
import {
  buildProjectSnapshot,
  buildProjectContextBlock,
} from "@/core/project/project-context";

let tmpRoot = "";
let createdProjectId = "";

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nextcode-sec-"));
  const projDir = path.join(tmpRoot, "proj-com-secao");
  fs.mkdirSync(path.join(projDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(projDir, "package.json"), JSON.stringify({ name: "proj-com-secao" }));

  // Criar projeto no banco SQLite para teste de integração
  const p = await prisma.project.create({
    data: {
      name: "Projeto com Seções",
      description: "Descrição do projeto de teste",
      path: projDir,
    },
  });
  createdProjectId = p.id;
});

afterAll(async () => {
  if (createdProjectId) {
    await prisma.project.delete({ where: { id: createdProjectId } }).catch(() => {});
  }
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {}
});

describe("Seções de Projeto — Injeção no Contexto LLM", () => {
  it("inclui seções anexadas no bloco <project_context>", () => {
    const block = buildProjectContextBlock({
      name: "Projeto Demo",
      path: null,
      sections: [
        { title: "Arquitetura e Padrões", content: "Usar Clean Architecture e DDD" },
        { title: "Regras de Negócio", content: "Todos os valores em EUR devem ter taxa de câmbio" },
      ],
    });

    expect(block).not.toBeNull();
    expect(block).toContain("<project_context>");
    expect(block).toContain("--- Seções Anexadas ao Projeto ---");
    expect(block).toContain("[Seção: Arquitetura e Padrões]");
    expect(block).toContain("Usar Clean Architecture e DDD");
    expect(block).toContain("[Seção: Regras de Negócio]");
    expect(block).toContain("Todos os valores em EUR devem ter taxa de câmbio");
  });

  it("combina estrutura de diretórios e seções anexadas no mesmo contexto", () => {
    const projDir = path.join(tmpRoot, "proj-com-secao");
    const block = buildProjectContextBlock({
      name: "proj-com-secao",
      path: projDir,
      sections: [
        { title: "Instruções do Sistema", content: "Priorizar respostas em Português" },
      ],
    });

    expect(block).not.toBeNull();
    expect(block).toContain("Nome do projeto: proj-com-secao");
    expect(block).toContain("--- package.json ---");
    expect(block).toContain("--- Seções Anexadas ao Projeto ---");
    expect(block).toContain("[Seção: Instruções do Sistema]");
  });
});

describe("Seções de Projeto — Persistência no Banco (Prisma CRUD)", () => {
  it("permite anexar seções a um projeto no banco", async () => {
    const section1 = await prisma.section.create({
      data: {
        projectId: createdProjectId,
        title: "Visão Geral do Módulo",
        content: "Módulo responsável pelo processamento de pagamentos.",
        order: 1,
      },
    });

    expect(section1.id).toBeDefined();
    expect(section1.projectId).toBe(createdProjectId);
    expect(section1.title).toBe("Visão Geral do Módulo");

    const fetchedProject = await prisma.project.findUnique({
      where: { id: createdProjectId },
      include: { sections: true },
    });

    expect(fetchedProject).not.toBeNull();
    expect(fetchedProject!.sections).toHaveLength(1);
    expect(fetchedProject!.sections[0].title).toBe("Visão Geral do Módulo");
  });

  it("permite atualizar e excluir uma seção do projeto", async () => {
    const section = await prisma.section.create({
      data: {
        projectId: createdProjectId,
        title: "Seção Temporária",
        content: "Para ser excluída",
      },
    });

    const updated = await prisma.section.update({
      where: { id: section.id },
      data: { title: "Seção Atualizada" },
    });
    expect(updated.title).toBe("Seção Atualizada");

    await prisma.section.delete({ where: { id: section.id } });

    const check = await prisma.section.findUnique({ where: { id: section.id } });
    expect(check).toBeNull();
  });
});
