import { describe, it, expect } from "vitest";
import { secaoMenoresConsumidos } from "@/core/orchestrator/node-executor";
import { DualLensAuditor } from "@/core/governance/dual-lens-auditor";

describe("F1.3: problemas menores de dependências no Microbrief", () => {
  it("retorna null quando não há interfacesConsome", () => {
    const res = secaoMenoresConsumidos(undefined, []);
    expect(res).toBeNull();
  });

  it("retorna null quando não há problemas menores nas dependências", () => {
    const interfacesConsome = ["export type User = { id: string };"];
    const resultadosDependencias = [
      {
        problemas: [{ severidade: "importante", arquivoLinha: "src/dep.ts:5", descricao: "User sem validação" }],
      },
    ];
    const res = secaoMenoresConsumidos(interfacesConsome, resultadosDependencias);
    expect(res).toBeNull();
  });

  it("retorna seção formatada quando há problema menor citando símbolo consumido", () => {
    const interfacesConsome = ["export type User = { id: string };"];
    const resultadosDependencias = [
      {
        problemas: [{ severidade: "menor", arquivoLinha: "src/dep.ts:5", descricao: "User não tem validação de email" }],
      },
    ];
    const res = secaoMenoresConsumidos(interfacesConsome, resultadosDependencias);
    expect(res).toContain("[menor] src/dep.ts:5: User não tem validação de email");
  });

  it("interfacesConsome com export function criarSessao e menor citando criarSessao → o retorno contém [menor] e criarSessao", () => {
    const interfacesConsome = ["export function criarSessao(papel: string): Sessao;"];
    const resultadosDependencias = [
      {
        problemas: [{ severidade: "menor", arquivoLinha: "src/auth.ts:10", descricao: "criarSessao não valida expiração" }],
      },
    ];
    const res = secaoMenoresConsumidos(interfacesConsome, resultadosDependencias);
    expect(res).toContain("[menor]");
    expect(res).toContain("criarSessao");
  });

  it("um importante que cita criarSessao → null", () => {
    const interfacesConsome = ["export function criarSessao(papel: string): Sessao;"];
    const resultadosDependencias = [
      {
        problemas: [{ severidade: "importante", arquivoLinha: "src/auth.ts:10", descricao: "criarSessao falha com papel inválido" }],
      },
    ];
    const res = secaoMenoresConsumidos(interfacesConsome, resultadosDependencias);
    expect(res).toBeNull();
  });

  it("menor que cita só outraCoisa → null", () => {
    const interfacesConsome = ["export function criarSessao(papel: string): Sessao;"];
    const resultadosDependencias = [
      {
        problemas: [{ severidade: "menor", arquivoLinha: "src/auth.ts:15", descricao: "outraCoisa precisa de refatoração" }],
      },
    ];
    const res = secaoMenoresConsumidos(interfacesConsome, resultadosDependencias);
    expect(res).toBeNull();
  });

  it("ignora problema menor que não cita nenhum símbolo consumido", () => {
    const interfacesConsome = ["export type User = { id: string };"];
    const resultadosDependencias = [
      {
        problemas: [{ severidade: "menor", arquivoLinha: "src/outro.ts:10", descricao: "função Xyz não tem doc" }],
      },
    ];
    const res = secaoMenoresConsumidos(interfacesConsome, resultadosDependencias);
    expect(res).toBeNull();
  });

  it("ignora Json como nome de símbolo (nome exato)", () => {
    const interfacesConsome = ["export type Json = Record<string, unknown>;"];
    const resultadosDependencias = [
      {
        problemas: [{ severidade: "menor", arquivoLinha: "src/lib.ts:1", descricao: "Json mal formatado" }],
      },
    ];
    const res = secaoMenoresConsumidos(interfacesConsome, resultadosDependencias);
    expect(res).toBeNull();
  });

  it("DualLensAuditor.validateType2 com problema menor traz menor em problemas, rawVerdict APROVADO e verdict APPROVED", async () => {
    const CODE = { "src/lib/soma.ts": "export function soma(a: number, b: number) {\n  return a + b;\n}\n" };
    const type1 = DualLensAuditor.validateType1({ "src/lib/soma.ts": CODE["src/lib/soma.ts"] }, [], process.cwd(), ["src/lib/soma.ts"], []);
    const ok = { id: "REQ-001", status: "implementado" as const, evidencia: "src/lib/soma.ts:1" };
    const problemaMenor = { severidade: "menor" as const, arquivoLinha: "src/lib/soma.ts:1", descricao: "nome de variável curto" };

    const res = await DualLensAuditor.validateType2(
      type1,
      "# Brief\nREQ-001 soma",
      "feito",
      CODE,
      async () =>
        JSON.stringify({
          implemented: true,
          missingRequirements: [],
          justification: "ok",
          reqVerdicts: [ok],
          problemas: [problemaMenor],
        }),
      { expectedReqs: ["REQ-001"] }
    );

    expect(res.verdict).toBe("APPROVED");
    expect(res.rawVerdict).toBe("APROVADO");
    expect(res.problemas).toBeDefined();
    expect(res.problemas?.some((p) => p.severidade === "menor" && p.descricao === "nome de variável curto")).toBe(true);
  });
});