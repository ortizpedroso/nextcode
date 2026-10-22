import { describe, it, expect } from "vitest";
import { reviewFinalDelivery, parseFinalReview, fileOfRef } from "@/core/governance/final-reviewer";
import { planDeliveryRepair } from "@/core/orchestrator/delivery-repair";
import type { EvaluatorCallResult } from "@/core/llm/evaluator-models";
import type { TaskNode } from "@prisma/client";

// J3: revisão final cega (avaliador-final). Spec com 2 REQ; dois arquivos de etapas diferentes.
const SPEC = [
  "---",
  "titulo: Tarefas",
  "requisitos:",
  "  - id: REQ-001",
  "    titulo: store",
  "    criterio: criarTarefa grava titulo",
  "  - id: REQ-002",
  "    titulo: rota",
  "    criterio: POST usa criarTarefa",
  "arquivos_afetados:",
  "  - src/lib/tarefas.ts",
  "  - src/app/api/tarefas/route.ts",
  "---",
  "# Tarefas",
].join("\n");
const FILES = {
  "src/lib/tarefas.ts": "export function criarTarefa(titulo: string) {\n  return { titulo };\n}\n",
  "src/app/api/tarefas/route.ts": "import { criarTarefa } from '@/lib/tarefas';\nexport async function POST() {\n  return Response.json(criarTarefa('x'));\n}\n",
};
const answer = (o: object): EvaluatorCallResult => ({ content: JSON.stringify(o), provider: "claude", model: "claude-opus-5-5", independent: true, failures: [] });
const okVerdicts = [
  { id: "REQ-001", status: "implementado", evidencia: "src/lib/tarefas.ts:1-3" },
  { id: "REQ-002", status: "implementado", evidencia: "src/app/api/tarefas/route.ts:2-4" },
];

describe("J3 — avaliador-final", () => {
  it("lê o arquivo de uma citação", () => {
    expect(fileOfRef("src/app/api/tarefas/[id]/route.ts:10-12 faz x")).toBe("src/app/api/tarefas/[id]/route.ts");
    expect(fileOfRef("sem citação")).toBeNull();
  });

  it("projeto correto → aprovado, cego (a mensagem não leva relatório do executor nem veredito anterior)", async () => {
    const seen: string[] = [];
    const r = await reviewFinalDelivery({
      spec: SPEC,
      files: FILES,
      dispatch: async (m) => {
        seen.push(m.map((x) => x.content).join("\n"));
        return answer({ aprovado: true, justificativa: "ok", reqVerdicts: okVerdicts, problemas: [] });
      },
    });
    expect(r.executado).toBe(true);
    expect(r.aprovado).toBe(true);
    expect(seen[0]).toContain("[SPEC CANÔNICA]");
    expect(seen[0]).toContain("[ARQUIVOS GERADOS]");
    expect(seen[0]).not.toMatch(/relatorio_executor|APPROVED|Lente 2/);
  });

  it("REQ parcial e problema crítico de integração → reprovado com defeito por arquivo", async () => {
    const r = await reviewFinalDelivery({
      spec: SPEC,
      files: FILES,
      dispatch: async () =>
        answer({
          aprovado: false,
          reqVerdicts: [okVerdicts[0], { id: "REQ-002", status: "parcial", evidencia: "src/app/api/tarefas/route.ts:3" }],
          problemas: [{ severidade: "critico", arquivoLinha: "src/lib/tarefas.ts:2", descricao: "não grava em lugar nenhum" }],
        }),
    });
    expect(r.aprovado).toBe(false);
    expect(r.defeitos.map((d) => d.arquivo)).toEqual(["src/app/api/tarefas/route.ts", "src/lib/tarefas.ts"]);
    // os defeitos viram reparo da etapa dona (J2b)
    const t = (id: string, file: string) =>
      ({ id, title: id, role: "worker", status: "completed", filesScope: JSON.stringify([file]), payload: "{}", createdAt: new Date() }) as unknown as TaskNode;
    const plan = planDeliveryRepair([t("e1", "src/lib/tarefas.ts"), t("e2", "src/app/api/tarefas/route.ts")], {
      missingFiles: [],
      unapprovedReqs: [],
      buildErrorLines: [],
      buildGapWithoutDetail: false,
      otherGaps: [],
      fileDefects: r.defeitos,
    });
    expect(plan.itens.map((i) => i.dona.id).sort()).toEqual(["e1", "e2"]);
    expect(plan.semDono).toEqual([]);
  });

  it("muitas citações inventadas → descarta, repete com o motivo; 2 descartes → não executado (não reprova sozinho)", async () => {
    const prompts: string[] = [];
    const r = await reviewFinalDelivery({
      spec: SPEC,
      files: FILES,
      dispatch: async (m) => {
        prompts.push(m[1].content);
        return answer({
          aprovado: true,
          reqVerdicts: [
            { ...okVerdicts[0], evidencia: "src/lib/tarefas.ts:90" },
            { ...okVerdicts[1], evidencia: "src/app/api/tarefas/route.ts:99" },
          ],
          problemas: [],
        });
      },
    });
    expect(prompts[1]).toContain("[SUA RESPOSTA ANTERIOR FOI DESCARTADA]");
    expect(r.executado).toBe(false);
    expect(r.descartes).toHaveLength(2);
    expect(r.descartes[0]).toMatch(/2 de 2 citações/);
  });

  it("Gateway real: fim do intervalo além do arquivo é cortado; 1 citação inválida isolada só tira aquele item", async () => {
    // tarefas.ts tem 4 linhas (3 + a vazia do fim); "1-6" passa do fim como no tenant.ts:15-25 de 24 linhas.
    const r = await reviewFinalDelivery({
      spec: SPEC,
      files: FILES,
      dispatch: async () =>
        answer({
          aprovado: true,
          reqVerdicts: [
            { ...okVerdicts[0], evidencia: "src/lib/tarefas.ts:1-6" },
            { ...okVerdicts[1], evidencia: "src/app/api/tarefas/route.ts:99" },
          ],
          problemas: [
            { severidade: "importante", arquivoLinha: "src/lib/tarefas.ts:2", descricao: "x" },
            { severidade: "importante", arquivoLinha: "src/lib/tarefas.ts:2", descricao: "y" },
            { severidade: "importante", arquivoLinha: "src/lib/tarefas.ts:2", descricao: "z" },
          ],
        }),
    });
    expect(r.executado).toBe(true);
    expect(r.aprovado).toBe(true);
    expect(r.reqVerdicts.map((v) => v.id)).toEqual(["REQ-001"]);
    expect(r.naoVerificados).toEqual(["REQ-002"]);
    expect(r.citacoesInvalidas).toHaveLength(1);
  });

  it("as linhas vão numeradas para o modelo citar com precisão", async () => {
    let user = "";
    await reviewFinalDelivery({
      spec: SPEC,
      files: FILES,
      dispatch: async (m) => {
        user = m[1].content;
        return answer({ aprovado: true, reqVerdicts: okVerdicts, problemas: [] });
      },
    });
    expect(user).toContain("--- src/lib/tarefas.ts ---\n1| export function criarTarefa(titulo: string) {\n2|   return { titulo };");
  });

  it("REQ faltando na resposta é descartado", () => {
    const p = parseFinalReview(JSON.stringify({ aprovado: true, reqVerdicts: [okVerdicts[0]], problemas: [] }), ["REQ-001", "REQ-002"], FILES);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.discard).toContain("REQ-002");
  });

  it("projeto grande demais não roda (registrado, não reprova)", async () => {
    const prev = process.env.FINAL_REVIEW_MAX_TOTAL_CHARS;
    process.env.FINAL_REVIEW_MAX_TOTAL_CHARS = "100";
    const r = await reviewFinalDelivery({ spec: SPEC, files: FILES, dispatch: async () => answer({}) });
    process.env.FINAL_REVIEW_MAX_TOTAL_CHARS = prev;
    expect(r.executado).toBe(false);
    expect(r.motivoNaoExecutado).toMatch(/não coube/);
  });
});
