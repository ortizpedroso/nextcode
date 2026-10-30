import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { recheckFinalBuild } from "@/core/governance/empirical-gate";
import type { CommandResult } from "@/core/execution/terminal-execution-engine";

// Mudança 34: a entrega julga o projeto final, não o histórico das etapas.
const fail = (out: string): CommandResult => ({ success: false, exitCode: 2, stdout: out, stderr: "", executionTimeMs: 1 });
const ok: CommandResult = { success: true, exitCode: 0, stdout: "", stderr: "", executionTimeMs: 1 };

describe("recheckFinalBuild — type-check do projeto final na entrega", () => {
  it("falha só de ambiente (client do Prisma) → conserta e aprova", async () => {
    const verify = vi.fn().mockResolvedValueOnce(fail("src/a.ts(1,10): error TS2305: Module '\"@prisma/client\"' has no exported member 'X'.")).mockResolvedValueOnce(ok);
    const repair = vi.fn().mockResolvedValue({ changed: true });
    const r = await recheckFinalBuild("C:/p", { verify, repair });
    expect(r).toEqual({ checked: true, ok: true, errors: [] });
    expect(repair).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("erro real de código → reprova e devolve os erros", async () => {
    const out = "src/m.ts(54,7): error TS2345: Argument of type 'A' is not assignable to parameter of type 'B'.";
    const verify = vi.fn().mockResolvedValue(fail(out));
    const r = await recheckFinalBuild("C:/p", { verify, repair: vi.fn().mockResolvedValue({ changed: false }) });
    expect(r.checked).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(["src/m.ts: error TS2345: Argument of type 'A' is not assignable to parameter of type 'B'."]);
  });

  it("tsc ok mas next build falha → reprova com linhas parseadas", async () => {
    const verify = vi.fn().mockResolvedValue(ok);
    const verifyNextBuild = vi.fn().mockResolvedValue(
      fail(`./src/app/api/x/route.ts:12:5\nType error: params must be Promise`)
    );
    const r = await recheckFinalBuild("C:/p", { verify, verifyNextBuild, repair: vi.fn() });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("route.ts"))).toBe(true);
    expect(r.linhas?.some((l) => l.includes("Type error"))).toBe(true);
  });

  it("sem tsconfig → não conferido", async () => {
    const r = await recheckFinalBuild("C:/p", { verify: vi.fn().mockResolvedValue(null), repair: vi.fn() });
    expect(r).toEqual({ checked: false, ok: false, errors: [] });
  });
});

// Mudança 35: tsc que nem rodou (Windows 0xC0000142) não é reprovação de código.
describe("recheckFinalBuild — falha de ambiente", () => {
  beforeEach(() => {
    vi.stubEnv("NEXTCODE_TSC_ENV_RETRY_MS", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("saída de falha sem nenhum error TS → ambiente, sem erros de código", async () => {
    const naoAbriu: CommandResult = { success: false, exitCode: 3221225794, stdout: "", stderr: "", executionTimeMs: 1 };
    const verify = vi.fn().mockResolvedValue(naoAbriu);
    const repair = vi.fn().mockResolvedValue({ changed: true });
    const r = await recheckFinalBuild("C:/p", { verify, repair });
    expect(r.checked).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([]);
    expect(r.ambiente).toMatch(/não rodou/);
    expect(r.ambiente).toContain("0xC0000142");
    expect(verify.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("falha de ambiente intermitente → retenta e aprova na segunda tentativa", async () => {
    const naoAbriu: CommandResult = { success: false, exitCode: 1, stdout: "", stderr: "", executionTimeMs: 1 };
    const verify = vi.fn().mockResolvedValueOnce(naoAbriu).mockResolvedValueOnce(naoAbriu).mockResolvedValueOnce(ok);
    const r = await recheckFinalBuild("C:/p", { verify, repair: vi.fn().mockResolvedValue({ changed: false }) });
    expect(r).toEqual({ checked: true, ok: true, errors: [] });
    expect(verify).toHaveBeenCalledTimes(3);
  });

  it("erro real de código traz as linhas com posição (para o reparo J2b)", async () => {
    const out = "src/m.ts(54,7): error TS2345: Argument of type 'A' is not assignable to parameter of type 'B'.";
    const r = await recheckFinalBuild("C:/p", {
      verify: vi.fn().mockResolvedValue(fail(out)),
      repair: vi.fn().mockResolvedValue({ changed: false }),
    });
    expect(r.ambiente).toBeUndefined();
    expect(r.linhas).toEqual([out]);
  });
});
