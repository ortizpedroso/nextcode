import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "@/lib/prisma";

let project1Id = "";
let project2Id = "";
let sessionId = "";

beforeAll(async () => {
  const p1 = await prisma.project.create({
    data: { name: "Projeto Alfa" },
  });
  project1Id = p1.id;

  const p2 = await prisma.project.create({
    data: { name: "Projeto Beta" },
  });
  project2Id = p2.id;

  const session = await prisma.session.create({
    data: { title: "Sessão Teste Anexação" },
  });
  sessionId = session.id;
});

afterAll(async () => {
  if (sessionId) await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
  if (project1Id) await prisma.project.delete({ where: { id: project1Id } }).catch(() => {});
  if (project2Id) await prisma.project.delete({ where: { id: project2Id } }).catch(() => {});
});

describe("Anexar Sessão a um Projeto (Vínculo & Transição)", () => {
  it("inicia como sessão ad-hoc sem projeto (projectId é null)", async () => {
    const sess = await prisma.session.findUnique({ where: { id: sessionId } });
    expect(sess).not.toBeNull();
    expect(sess!.projectId).toBeNull();
  });

  it("anexa a sessão ao Projeto Alfa (project1Id)", async () => {
    const updated = await prisma.session.update({
      where: { id: sessionId },
      data: { projectId: project1Id },
      include: { project: true },
    });

    expect(updated.projectId).toBe(project1Id);
    expect(updated.project).not.toBeNull();
    expect(updated.project!.name).toBe("Projeto Alfa");
  });

  it("move a sessão do Projeto Alfa para o Projeto Beta", async () => {
    const updated = await prisma.session.update({
      where: { id: sessionId },
      data: { projectId: project2Id },
      include: { project: true },
    });

    expect(updated.projectId).toBe(project2Id);
    expect(updated.project!.name).toBe("Projeto Beta");
  });

  it("desvincula a sessão de volta para Ad-hoc (projectId = null)", async () => {
    const updated = await prisma.session.update({
      where: { id: sessionId },
      data: { projectId: null },
      include: { project: true },
    });

    expect(updated.projectId).toBeNull();
    expect(updated.project).toBeNull();
  });
});
