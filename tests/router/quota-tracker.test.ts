import { describe, it, expect, beforeEach } from "vitest";
import {
  markComboExhausted,
  isComboOnCooldown,
  getQuotaStatus,
  clearQuotaCooldowns,
  nextUtcMidnightMs,
} from "../../src/core/router/quota-tracker";

describe("quota-tracker — cooldown de cota por combo (Fase 12)", () => {
  beforeEach(() => clearQuotaCooldowns());

  it("402 coloca o combo em cooldown", () => {
    markComboExhausted("auto/best-free", 402);
    expect(isComboOnCooldown("auto/best-free")).toBe(true);
    expect(isComboOnCooldown("auto/fast")).toBe(false);
  });

  it("429 também entra em cooldown (janela curta de 5 min)", () => {
    markComboExhausted("auto/chat", 429);
    expect(isComboOnCooldown("auto/chat")).toBe(true);
    const [entry] = getQuotaStatus();
    const remaining = new Date(entry.untilIso).getTime() - Date.now();
    expect(remaining).toBeLessThanOrEqual(5 * 60 * 1000 + 1000);
  });

  it("status que NÃO é cota (500, rede) não gera cooldown", () => {
    markComboExhausted("auto", 500);
    markComboExhausted("auto", 401);
    expect(isComboOnCooldown("auto")).toBe(false);
    expect(getQuotaStatus()).toHaveLength(0);
  });

  it("cooldown expira e o combo volta a ser elegível", () => {
    markComboExhausted("auto/fast", 429);
    const future = Date.now() + 10 * 60 * 1000; // além da janela de 5 min do 429
    expect(isComboOnCooldown("auto/fast", future)).toBe(false);
  });

  it("getQuotaStatus reporta modelo, motivo e contagem de hits", () => {
    markComboExhausted("auto/best-free", 402);
    markComboExhausted("auto/best-free", 402);
    const st = getQuotaStatus();
    expect(st).toHaveLength(1);
    expect(st[0].model).toBe("auto/best-free");
    expect(st[0].reason).toBe("HTTP 402");
    expect(st[0].hits).toBe(2);
  });

  it("clearQuotaCooldowns zera tudo", () => {
    markComboExhausted("auto", 402);
    clearQuotaCooldowns();
    expect(getQuotaStatus()).toHaveLength(0);
    expect(isComboOnCooldown("auto")).toBe(false);
  });

  it("nextUtcMidnightMs nunca ultrapassa a janela máxima (6h)", () => {
    const delta = nextUtcMidnightMs() - Date.now();
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThanOrEqual(6 * 60 * 60 * 1000);
  });
});
