import { describe, it, expect } from "vitest";
import { checkMandatoryGaps, renderMandatoryGapsNotice } from "../../src/core/intake/mandatory-gaps.js";
import type { IntakeFunnelResult } from "../../src/core/intake/universal-funnel.js";

// J8 (E2, mudança 44): o que o tipo de projeto exige e a Spec não diz aparece para o usuário.
const funil = (o: Partial<IntakeFunnelResult>): IntakeFunnelResult => ({
  appKind: "web_fullstack",
  userModel: "authenticated_users",
  complexityScore: 2,
  hasDatabase: true,
  hasAuth: false,
  hasFinancialPayments: false,
  hasExternalComms: false,
  hasPublicApi: false,
  hasWhitelabel: false,
  financialSplitModel: "",
  notificationChannels: "",
  hasStrictBusinessRules: false,
  source: "jev",
  aConfirmar: [],
  ...o,
});
const req = (id: string, criterio: string) => ({ id, titulo: id, criterio });

describe("J8 — lacunas obrigatórias", () => {
  it("projeto sem categoria sensível (P1) → nada a conferir, nenhuma chamada ao Jev", async () => {
    let chamadas = 0;
    const r = await checkMandatoryGaps({ funnel: funil({}), requisitos: [req("REQ-001", "lista tarefas")], ask: (async () => { chamadas++; return {}; }) as never });
    expect(r.aplicaveis).toEqual([]);
    expect(chamadas).toBe(0);
    expect(renderMandatoryGapsNotice(r)).toBe("");
  });

  it("pagamento: palavra-chave cobre sem Jev; o resto vai em UMA chamada; o que o Jev nega aparece para o usuário", async () => {
    const perguntas: string[][] = [];
    const r = await checkMandatoryGaps({
      funnel: funil({ hasFinancialPayments: true }),
      requisitos: [
        req("REQ-001", "valorCentavos é inteiro em centavos"),
        req("REQ-002", "webhook com token inválido devolve 401; evento já processado devolve 200 sem reprocessar"),
        req("REQ-003", "cobrança paga muda para PAGA"),
      ],
      ask: (async (p: { questions: Record<string, unknown> }) => {
        perguntas.push(Object.keys(p.questions));
        return { estorno: { type: "noul", noul: 0.1, symmetricConfidence: 0.8 } };
      }) as never,
    });
    expect(r.cobertosPorChave).toEqual(["valor_centavos", "webhook_idempotente", "webhook_autenticado"]);
    expect(perguntas).toEqual([["estorno"]]);
    expect(r.faltando.map((i) => i.id)).toEqual(["estorno"]);
    const aviso = renderMandatoryGapsNotice(r);
    expect(aviso).toContain("estorno");
    expect(aviso).toContain("pode decidir");
  });

  it("Jev fora → os não achados aparecem como 'não confirmado' (nunca contam como cobertos)", async () => {
    const r = await checkMandatoryGaps({ funnel: funil({ hasAuth: true, userModel: "multi_tenant_saas" }), requisitos: [req("REQ-001", "senha com bcrypt")], ask: (async () => null) as never });
    expect(r.jevDisponivel).toBe(false);
    expect(r.faltando.map((i) => i.id)).toEqual(["login", "permissao", "isolamento_tenant"]);
    expect(renderMandatoryGapsNotice(r)).toContain("Jev fora, não confirmado");
  });

  it("login simples (um tipo de usuário, como o P3) não cobra papéis/permissões", async () => {
    const r = await checkMandatoryGaps({ funnel: funil({ hasAuth: true }), requisitos: [req("REQ-001", "login devolve token; senha com bcrypt")], ask: (async () => ({})) as never });
    expect(r.aplicaveis).toEqual(["login", "senha_hash"]);
    expect(r.faltando).toEqual([]);
  });
});
