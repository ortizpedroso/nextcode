import { describe, it, expect } from "vitest";
import { checkReqOrigins, renderReqOriginNotice } from "../../src/core/intake/req-origin-check.js";
import { parseSpecDocument, renderCanonicalSpecDocument } from "../../src/core/intake/spec-format.js";

// J11 (E2, mudança 44) — porta: controle com REQ inventado aparece; Spec correta aprovada sem aviso.
const pedido = "Quero uma API de tarefas: listar e criar tarefas, e marcar uma tarefa como concluída. Título é obrigatório.";
const req = (id: string, origem?: string) => ({ id, titulo: "t", criterio: "c", ...(origem ? { origem } : {}) });

describe("J11 — cada REQ vem do pedido", () => {
  it("Spec correta: trechos do pedido (sem acento, caixa ou pontuação), premissa e derivado → nenhum suspeito", () => {
    const r = checkReqOrigins(
      [
        req("REQ-001", "listar e criar tarefas"),
        req("REQ-002", "Marcar uma tarefa como CONCLUIDA"),
        req("REQ-003", "premissa: armazenamento em memória"),
        req("REQ-004", "derivado: REQ-001"),
        req("REQ-005", "título é obrigatório"),
      ],
      pedido
    );
    expect(r.map((x) => x.status)).toEqual(["rastreado", "rastreado", "premissa", "derivado", "rastreado"]);
    const aviso = renderReqOriginNotice(r);
    expect(aviso).not.toContain("sem origem");
    expect(aviso).toContain("Premissas do elicitador");
  });

  it("controle com REQ inventado (exportar PDF não foi pedido) e sem origem → aparece para o usuário", () => {
    const r = checkReqOrigins([req("REQ-001", "listar e criar tarefas"), req("REQ-002", "exportar relatório em PDF mensal"), req("REQ-003")], pedido);
    expect(r.map((x) => x.status)).toEqual(["rastreado", "nao_encontrado", "sem_origem"]);
    const aviso = renderReqOriginNotice(r);
    expect(aviso).toContain("Requisitos sem origem no seu pedido");
    expect(aviso).toContain("REQ-002");
    expect(aviso).toContain("REQ-003");
  });

  it("derivado de REQ que não existe não vale; Spec antiga (nenhum REQ com origem) não gera aviso", () => {
    expect(checkReqOrigins([req("REQ-001", "derivado: REQ-009")], pedido)[0].status).toBe("nao_encontrado");
    expect(renderReqOriginNotice(checkReqOrigins([req("REQ-001"), req("REQ-002")], pedido))).toBe("");
  });

  it("o campo origem atravessa render → parse da Spec canônica (e Spec sem origem continua igual)", async () => {
    const { P1_SPEC } = await import("../../bench/specs/p1");
    const comOrigem = { ...P1_SPEC, requisitos: (P1_SPEC.requisitos ?? []).map((r, i) => (i === 0 ? { ...r, origem: "listar e criar tarefas" } : r)) };
    const doc = renderCanonicalSpecDocument(comOrigem);
    expect(parseSpecDocument(doc)?.requisitos?.[0].origem).toBe("listar e criar tarefas");
    expect(parseSpecDocument(renderCanonicalSpecDocument(P1_SPEC))?.requisitos?.[0].origem).toBeUndefined();
  });
});
