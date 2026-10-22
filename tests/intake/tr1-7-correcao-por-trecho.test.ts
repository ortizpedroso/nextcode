import { describe, it, expect } from "vitest";
import { applySpecPatch, extractSpecPatch, buildPatchSpecSystemPrompt } from "../../src/core/intake/spec-patch.js";
import { parseSpecDocument, renderCanonicalSpecDocument } from "../../src/core/intake/spec-format.js";
import { checkSpecStructure } from "../../src/core/intake/spec-check.js";

// TR1 (7) / mudança 7: ajuste da Spec por trecho — o modelo devolve só o que muda; o código aplica por âncora.
describe("TR1 (7) — correção da Spec por trecho", async () => {
  const { P1_SPEC } = await import("../../bench/specs/p1");
  const base = renderCanonicalSpecDocument(P1_SPEC);
  const reqs = parseSpecDocument(base)!.requisitos!;

  it("lê o bloco patch_spec da resposta; texto sem bloco → null (segue o fluxo da Spec inteira)", () => {
    expect(extractSpecPatch('Ok.\n```json patch_spec\n{"resposta":"x","requisitos":{"remover":["REQ-001"]}}\n```')).toMatchObject({ resposta: "x" });
    expect(extractSpecPatch("---\ntitulo: X\n---")).toBeNull();
    expect(extractSpecPatch("```json patch_spec\n{quebrado\n```")).toBeNull();
  });

  it("altera um critério e inclui um REQ com o próximo número; o resto da Spec fica idêntico e a estrutura continua válida", () => {
    const alvo = reqs[1].id;
    const r = applySpecPatch(base, {
      requisitos: {
        alterar: [{ id: alvo, criterio: `${reqs[1].criterio} Título com mais de 100 caracteres devolve 400.` }],
        incluir: [{ titulo: "Contagem", criterio: `${P1_SPEC.arquivosAfetados[0]} exporta contar() que devolve o total.`, origem: "premissa: contagem útil" }],
      },
    });
    expect(r.ok).toBe(true);
    const novo = parseSpecDocument(r.spec!)!;
    expect(novo.requisitos!.find((x) => x.id === alvo)!.criterio).toContain("mais de 100 caracteres");
    const ultimo = Math.max(...reqs.map((x) => Number(x.id.slice(4))));
    expect(novo.requisitos!.at(-1)!.id).toBe(`REQ-${String(ultimo + 1).padStart(3, "0")}`);
    expect(novo.requisitos!.length).toBe(reqs.length + 1);
    expect(novo.arquivosAfetados).toEqual(parseSpecDocument(base)!.arquivosAfetados);
    expect(novo.status).toBe("aguardando_aprovacao");
    // A correção não cria problema de estrutura novo (o REQ incluído, que cita o arquivo, até resolve um).
    const antes = checkSpecStructure(parseSpecDocument(base)!);
    expect(checkSpecStructure(novo).every((p) => antes.includes(p))).toBe(true);
    expect(r.resumo).toEqual([`alterado ${alvo}`, `incluído REQ-${String(ultimo + 1).padStart(3, "0")}`]);
  });

  it("âncora que não existe → nada aplicado, com o motivo (nunca reescrita calada)", () => {
    const r = applySpecPatch(base, { requisitos: { alterar: [{ id: "REQ-999", criterio: "x" }] }, arquivos_afetados: { remover: ["src/nao-existe.ts"] } });
    expect(r.ok).toBe(false);
    expect(r.erros).toEqual(["REQ-999 não existe na Spec (alterar)", 'arquivo: "src/nao-existe.ts" não existe (remover)']);
    expect(r.spec).toBeUndefined();
    expect(applySpecPatch(base, {}).erros).toEqual(["o trecho não muda nada na Spec"]);
  });

  it("o prompt de trecho leva a Spec atual e o formato do bloco", () => {
    const p = buildPatchSpecSystemPrompt(base);
    expect(p).toContain("CORREÇÃO POR TRECHO");
    expect(p).toContain("patch_spec");
    expect(p.endsWith(base.trim())).toBe(true);
  });
});
