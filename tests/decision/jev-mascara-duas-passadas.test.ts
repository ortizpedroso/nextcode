import { describe, it, expect } from "vitest";
import { maskSecretsForJev } from "@/core/governance/secret-guard";

describe("P5.5b — Máscara do Jev coleta todos os segredos antes de esconder (duas passadas)", () => {
  // Montado em tempo de execução conforme Trava T-G
  const fakeHighEntropySecret = "7xK9" + "mP2q" + "vL5w" + "8zRt" + "4nYb" + "1cDf";

  it("(a) JSON com segredo solto no 1º campo e atribuído no 2º campo → valor não aparece em nenhum campo, count: 1", () => {
    const input = JSON.stringify({
      mensagem: `use ${fakeHighEntropySecret} no checkout`,
      resumoSpec: `ASAAS_API_KEY=${fakeHighEntropySecret}`,
    });

    const res = maskSecretsForJev(input);

    expect(res.text).not.toContain(fakeHighEntropySecret);
    expect(res.text).toContain("«valor oculto:");
    expect(res.count).toBe(1);

    const parsed = JSON.parse(res.text);
    expect(parsed.mensagem).toContain("«valor oculto:");
    expect(parsed.mensagem).not.toContain(fakeHighEntropySecret);
    expect(parsed.resumoSpec).toContain("«valor oculto:");
    expect(parsed.resumoSpec).not.toContain(fakeHighEntropySecret);
  });

  it("(b) mesmo caso com a ordem dos campos invertida", () => {
    const input = JSON.stringify({
      resumoSpec: `ASAAS_API_KEY=${fakeHighEntropySecret}`,
      mensagem: `use ${fakeHighEntropySecret} no checkout`,
    });

    const res = maskSecretsForJev(input);

    expect(res.text).not.toContain(fakeHighEntropySecret);
    expect(res.text).toContain("«valor oculto:");
    expect(res.count).toBe(1);

    const parsed = JSON.parse(res.text);
    expect(parsed.resumoSpec).toContain("«valor oculto:");
    expect(parsed.resumoSpec).not.toContain(fakeHighEntropySecret);
    expect(parsed.mensagem).toContain("«valor oculto:");
    expect(parsed.mensagem).not.toContain(fakeHighEntropySecret);
  });

  it("(c) segredo só no 1º campo, 2º campo limpo → 2º campo idêntico ao original", () => {
    const textoLimpo = "este texto não possui nenhum segredo e permanece intacto";
    const input = JSON.stringify({
      resumoSpec: `ASAAS_API_KEY=${fakeHighEntropySecret}`,
      instrucao: textoLimpo,
    });

    const res = maskSecretsForJev(input);

    expect(res.text).not.toContain(fakeHighEntropySecret);
    expect(res.count).toBe(1);

    const parsed = JSON.parse(res.text);
    expect(parsed.resumoSpec).toContain("«valor oculto:");
    expect(parsed.instrucao).toBe(textoLimpo);
  });
});
