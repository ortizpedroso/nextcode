import { describe, it, expect } from "vitest";
import {
  classifyBuildErrorLine,
  triageDeliveryLacunas,
  formatTriageForHumans,
  lacunasSoAmbienteOuHarness,
} from "@/core/orchestrator/delivery-triage";

describe("delivery-triage", () => {
  it("TS2307 classifica como ambiente", () => {
    const i = classifyBuildErrorLine(
      "src/app/api/cadastro/route.ts(2,20): error TS2307: Cannot find module 'bcryptjs'."
    );
    expect(i.classe).toBe("ambiente");
    expect(i.arquivo).toContain("cadastro");
  });

  it("erro em conformidade classifica como harness", () => {
    const i = classifyBuildErrorLine(
      "src/contracts/conformidade/mb-b2.ts(20,14): error TS2322: Type 'x' is not assignable to type 'NextRouteHandler'."
    );
    expect(i.classe).toBe("harness");
  });

  it("dominante ambiente recomenda retomar_ambiente", () => {
    const s = triageDeliveryLacunas({
      buildErrorLines: [
        "prisma/seed.ts(2,20): error TS2307: Cannot find module 'bcryptjs'.",
        "src/x.ts(1,1): error TS2307: Cannot find module 'next-auth'.",
      ],
      outrasLacunas: ["Type-check do projeto final com 45 erro(s)"],
      semDonoReparo: [],
      perguntasSpecCount: 0,
      reparoTipo: "sem_dono",
    });
    expect(s.dominante).toBe("ambiente");
    expect(s.acaoRecomendada).toBe("retomar_ambiente");
    expect(formatTriageForHumans(s)).toContain("Retomar");
  });

  it("UI check browser com NEXTAUTH classifica como ambiente", () => {
    const s = triageDeliveryLacunas({
      buildErrorLines: [],
      outrasLacunas: [
        "Verificação de tela reprovada (browser). Ambiente T10: NEXTAUTH_SECRET não chegou ao next start do ui-check.",
      ],
      semDonoReparo: [],
      perguntasSpecCount: 0,
      reparoTipo: "esgotado",
    });
    expect(s.dominante).toBe("ambiente");
    expect(s.acaoRecomendada).toBe("retomar_ambiente");
  });

  it("UI check install classifica como ambiente", () => {
    const s = triageDeliveryLacunas({
      buildErrorLines: [],
      outrasLacunas: ["Verificação de tela reprovada (install)."],
      semDonoReparo: [],
      perguntasSpecCount: 0,
      reparoTipo: "sem_dono",
    });
    expect(s.dominante).toBe("ambiente");
    expect(s.acaoRecomendada).toBe("retomar_ambiente");
  });

  it("log de next build com NODE_ENV não-padrão classifica como ambiente", () => {
    const s = triageDeliveryLacunas({
      buildErrorLines: [],
      outrasLacunas: [
        "Type-check do projeto final com 1 erro(s); primeiros: > gateway@0.1.0 build > next build ✓ Compiled successfully ⚠ non-standard NODE_ENV",
        "Requisitos não aprovados: REQ-031, REQ-032",
      ],
      semDonoReparo: [],
      perguntasSpecCount: 0,
      reparoTipo: "esgotado",
      reparoTodosComDono: false,
    });
    expect(s.porClasse.ambiente).toBeGreaterThan(0);
    expect(["retomar_ambiente", "autorizar_rodada"]).toContain(s.acaoRecomendada);
  });

  it("reparo esgotado com dono recomenda autorizar_rodada", () => {
    const s = triageDeliveryLacunas({
      buildErrorLines: [],
      outrasLacunas: [],
      semDonoReparo: [],
      perguntasSpecCount: 0,
      reparoTipo: "esgotado",
      reparoTodosComDono: true,
    });
    expect(s.acaoRecomendada).toBe("autorizar_rodada");
  });
});

describe("lacunasSoAmbienteOuHarness", () => {
  it("só TS2307 (ambiente) devolve true", () => {
    const r = lacunasSoAmbienteOuHarness({
      buildErrorLines: [
        "src/app/api/x/route.ts(2,20): error TS2307: Cannot find module 'bcryptjs'.",
      ],
      outrasLacunas: [],
      defeitosDeArquivo: [],
      arquivosAusentes: [],
      reqsNaoAprovados: [],
    });
    expect(r).toBe(true);
  });

  it("só TS2322 em src/contracts/conformidade/ (harness) devolve true", () => {
    const r = lacunasSoAmbienteOuHarness({
      buildErrorLines: [
        "src/contracts/conformidade/mb-b2.ts(20,14): error TS2322: Type 'x' is not assignable.",
      ],
      outrasLacunas: [],
      defeitosDeArquivo: [],
      arquivosAusentes: [],
      reqsNaoAprovados: [],
    });
    expect(r).toBe(true);
  });

  it("TS2307 + TS2322 em src/app/api/x/route.ts (codigo) devolve false", () => {
    const r = lacunasSoAmbienteOuHarness({
      buildErrorLines: [
        "src/app/api/x/route.ts(2,20): error TS2307: Cannot find module 'bcryptjs'.",
        "src/app/api/x/route.ts(5,10): error TS2322: Type 'string' is not assignable to type 'number'.",
      ],
      outrasLacunas: [],
      defeitosDeArquivo: [],
      arquivosAusentes: [],
      reqsNaoAprovados: [],
    });
    expect(r).toBe(false);
  });

  it("TS2307 com req em reqsNaoAprovados devolve false", () => {
    const r = lacunasSoAmbienteOuHarness({
      buildErrorLines: [
        "src/app/api/x/route.ts(2,20): error TS2307: Cannot find module 'bcryptjs'.",
      ],
      outrasLacunas: [],
      defeitosDeArquivo: [],
      arquivosAusentes: [],
      reqsNaoAprovados: ["REQ-001"],
    });
    expect(r).toBe(false);
  });

  it("todos os arrays vazios devolve false", () => {
    const r = lacunasSoAmbienteOuHarness({
      buildErrorLines: [],
      outrasLacunas: [],
      defeitosDeArquivo: [],
      arquivosAusentes: [],
      reqsNaoAprovados: [],
    });
    expect(r).toBe(false);
  });
});
