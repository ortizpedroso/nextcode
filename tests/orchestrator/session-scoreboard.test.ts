import { describe, it, expect, afterEach } from "vitest";
import prisma from "@/lib/prisma";
import { computeScoreboard, formatScoreboard, sessionScoreboardMarkdown } from "@/core/orchestrator/session-scoreboard";
import { enforceBudgetBeforeBatch } from "@/core/orchestrator/budget-guard";
import { recordLlmCost } from "@/core/llm/cost";
import { IncidentReporter } from "@/core/governance/incident-reporter";

const created: string[] = [];
afterEach(async () => {
  await prisma.taskNode.deleteMany({ where: { sessionId: { in: created } } });
  await prisma.message.deleteMany({ where: { sessionId: { in: created } } });
  await prisma.session.deleteMany({ where: { id: { in: created } } });
  created.length = 0;
});

const row = (id: string, status: string, deps: string[] = []) => ({
  id,
  title: `Etapa ${id}`,
  status,
  dependencies: JSON.stringify(deps),
});

describe("TR1 (5) — placar nas mensagens de bloqueio", () => {
  it("conta concluídas, fila, bloqueadas, quem espera bloqueio e quem roda; número = ordem do plano", () => {
    const p = computeScoreboard([
      row("a", "completed"),
      row("b", "blocked", ["a"]),
      row("c", "pending", ["b"]),
      row("d", "pending", ["c"]),
      row("e", "running", ["a"]),
      row("f", "pending"),
      row("x", "superseded"),
    ]);
    expect(p).toMatchObject({ total: 6, concluidas: 1, naFila: 3, esperandoBloqueio: 2 });
    expect(p.bloqueadas).toEqual([{ numero: 2, titulo: "Etapa b" }]);
    expect(p.rodando).toEqual([{ numero: 5, titulo: "Etapa e" }]);
    const txt = formatScoreboard(p);
    expect(txt).toContain("1/6 concluídas");
    expect(txt).toContain("3 na fila (2 esperando etapa bloqueada)");
    expect(txt).toContain('#2 "Etapa b"');
    expect(txt).toContain('**Rodando agora:** #5 "Etapa e"');
  });

  it("relatório de incidente traz o placar na seção do grafo", () => {
    const md = IncidentReporter.generateIncidentReport("n1", "Etapa b", "core", [], { placar: "**Placar:** 1/6 concluídas" });
    expect(md).toContain("## 4. Estado do grafo (DAG)\n**Placar:** 1/6 concluídas");
  });

  it("mensagem de teto de custo vem com o placar da sessão", async () => {
    const s = await prisma.session.create({ data: { title: "Placar", phase: "EXECUCAO", phaseContext: "{}" } });
    created.push(s.id);
    for (const st of ["completed", "pending"]) {
      await prisma.taskNode.create({ data: { sessionId: s.id, title: `T ${st}`, role: "executor", status: st, specVersion: 0 } });
    }
    expect(await sessionScoreboardMarkdown(s.id)).toContain("1/2 concluídas");
    await recordLlmCost({
      sessionId: s.id,
      papel: "executor",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      usage: { prompt_tokens: 0, completion_tokens: 600_000 },
    });
    expect(await enforceBudgetBeforeBatch(s.id)).toBe(false);
    const msg = await prisma.message.findFirst({ where: { sessionId: s.id, content: { contains: "Teto de custo atingido" } } });
    expect(msg?.content).toContain("**Placar:** 1/2 concluídas");
  });
});
