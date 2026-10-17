import { describe, it, expect } from "vitest";
import { DualLensAuditor, fileLineRefExists } from "@/core/governance/dual-lens-auditor";
import { loadRoleSkill, buildSkillSystemPrompt } from "@/core/skills/skill-runtime";

const CODE = { "src/lib/soma.ts": "export function soma(a: number, b: number) {\n  return a + b;\n}\n" };
const type1 = DualLensAuditor.validateType1({ "src/lib/soma.ts": CODE["src/lib/soma.ts"] }, [], process.cwd(), ["src/lib/soma.ts"], []);
const ok = { id: "REQ-001", status: "implementado", evidencia: "src/lib/soma.ts:2" };

async function judge(answer: object | string, calls = { n: 0 }) {
  return DualLensAuditor.validateType2(type1, "# Brief\nREQ-001 soma", "feito", CODE, async () => {
    calls.n++;
    return typeof answer === "string" ? answer : JSON.stringify(answer);
  }, { expectedReqs: ["REQ-001"] });
}

describe("AV1.3 — evidência do avaliador conferida e problemas por severidade", () => {
  it("fileLineRefExists: aceita texto em volta e intervalo; recusa linha além do fim e arquivo de fora", () => {
    expect(fileLineRefExists("src/lib/soma.ts:2 retorna a+b", CODE)).toBe(true);
    expect(fileLineRefExists("src/lib/soma.ts:1-3", CODE)).toBe(true);
    expect(fileLineRefExists("src/lib/soma.ts:40", CODE)).toBe(false);
    expect(fileLineRefExists("src/lib/outro.ts:1", CODE)).toBe(false);
    expect(fileLineRefExists("arquivo:1", CODE)).toBe(false);
  });

  it("'implementado' com evidência inventada → resposta descartada (perguntado de novo) e etapa não aprovada", async () => {
    const calls = { n: 0 };
    const r = await judge({ implemented: true, missingRequirements: [], justification: "ok", reqVerdicts: [{ ...ok, evidencia: "src/lib/soma.ts:99" }] }, calls);
    expect(calls.n).toBe(2);
    expect(r.verdict).toBe("REJECTED");
    expect(r.method).toBe("heuristic_fallback");
  });

  it("problema crítico com arquivo:linha real → REPROVADO e o defeito vai no motivo para o executor", async () => {
    const r = await judge({
      implemented: true,
      missingRequirements: [],
      justification: "soma não trata NaN",
      reqVerdicts: [ok],
      problemas: [{ severidade: "critico", req: "REQ-001", arquivoLinha: "src/lib/soma.ts:2", descricao: "aceita NaN e devolve NaN" }],
    });
    expect(r.verdict).toBe("REJECTED");
    expect(r.rejectionReason).toContain("[critico] src/lib/soma.ts:2: aceita NaN e devolve NaN");
  });

  it("1 importante → APROVADO_COM_RESSALVA; 3 importantes → REPROVADO", async () => {
    const imp = (i: number) => ({ severidade: "importante", arquivoLinha: "src/lib/soma.ts:1", descricao: `imp ${i}` });
    const one = await judge({ implemented: true, missingRequirements: [], justification: "ok", reqVerdicts: [ok], problemas: [imp(1)] });
    expect(one.verdict).toBe("APPROVED");
    expect(one.rawVerdict).toBe("APROVADO_COM_RESSALVA");
    expect(one.ressalvas).toEqual(["src/lib/soma.ts:1: imp 1"]);
    const three = await judge({ implemented: true, missingRequirements: [], justification: "ok", reqVerdicts: [ok], problemas: [imp(1), imp(2), imp(3)] });
    expect(three.verdict).toBe("REJECTED");
  });

  it("problema 'menor' não muda o veredito nem precisa de linha", async () => {
    const r = await judge({
      implemented: true,
      missingRequirements: [],
      justification: "ok",
      reqVerdicts: [ok],
      problemas: [{ severidade: "menor", arquivoLinha: "", descricao: "nome" }],
    });
    expect(r.rawVerdict).toBe("APROVADO");
  });

  it("o prompt pede 'problemas' por severidade e avisa que citação inventada é descartada", async () => {
    let sys = "";
    await DualLensAuditor.validateType2(type1, "# Brief", "feito", CODE, async (m) => {
      sys = m[0].content;
      return JSON.stringify({ implemented: true, missingRequirements: [], justification: "ok", reqVerdicts: [ok] });
    }, { expectedReqs: ["REQ-001"] });
    expect(sys).toContain('"problemas":[{"severidade":"critico"|"importante"|"menor"');
    expect(sys).toContain("citação que não existe faz a resposta ser descartada");
  });

  it("skill avaliador diz a verdade: sem ferramentas, sem read_file, Lente 2 feita pelo harness, formato JSON", () => {
    const s = loadRoleSkill("avaliador");
    expect(s.ferramentas).toEqual([]);
    const prompt = buildSkillSystemPrompt(s);
    expect(prompt).not.toContain("read_file");
    expect(prompt).toContain("Lente 1");
    expect(prompt).toContain("A Lente 2 é feita pelo harness");
    expect(prompt).toContain('"problemas"');
  });
});
