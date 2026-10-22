import { describe, it, expect, vi } from "vitest";
import { parseNextBuildErrors } from "@/core/execution/ui-check";
import { touchesPrismaSchema } from "@/core/execution/project-base";
import { recheckFinalBuild } from "@/core/governance/empirical-gate";
import { planDeliveryRepair } from "@/core/orchestrator/delivery-repair";
import type { TaskNode } from "@prisma/client";

// Gateway real 22/10, reparo rodada 2: o schema mudou, o client do Prisma ficou velho, o tsc passou e o
// next build da verificação de tela reprovou — sem arquivo, o reparo não achava dona e a sessão bloqueou.
const RUN_LOG = [
  "[ui-check] next build",
  " ✓ Compiled successfully in 12.2s",
  "Failed to compile.",
  "",
  "./src/app/admin/page.tsx:197:50",
  "Type error: Property 'valorTotalCentavos' does not exist on type 'Cobranca'. Did you mean 'valorCentavos'?",
  "",
  "\u001b[0m \u001b[90m 195 |\u001b[39m for (const cobranca of cobrancas) {",
  "Next.js build worker exited with code: 1 and signal: null",
].join("\n");

describe("client do Prisma regerado e erro do next build com arquivo", () => {
  it("lê arquivo, linha e mensagem do run.log real", () => {
    expect(parseNextBuildErrors(RUN_LOG)).toEqual([
      {
        arquivo: "src/app/admin/page.tsx",
        linha: 197,
        mensagem: "Type error: Property 'valorTotalCentavos' does not exist on type 'Cobranca'. Did you mean 'valorCentavos'?",
      },
    ]);
    expect(parseNextBuildErrors("npm install falhou")).toEqual([]);
  });

  it("o erro do build vira reparo da etapa dona do arquivo, não lacuna sem dono", () => {
    const dona = { id: "e33", title: "Etapa 33/40: admin/page.tsx", role: "worker", status: "completed", filesScope: JSON.stringify(["src/app/admin/page.tsx"]), payload: "{}", createdAt: new Date() } as unknown as TaskNode;
    const [e] = parseNextBuildErrors(RUN_LOG);
    const plan = planDeliveryRepair([dona], {
      missingFiles: [],
      unapprovedReqs: [],
      buildErrorLines: [],
      buildGapWithoutDetail: false,
      otherGaps: [],
      fileDefects: [{ arquivo: e.arquivo, defeito: `verificação de tela (next build): ${e.arquivo}:${e.linha}: ${e.mensagem}` }],
    });
    expect(plan.semDono).toEqual([]);
    expect(plan.itens[0].dona.id).toBe("e33");
  });

  it("só o schema do Prisma dispara a regeração", () => {
    expect(touchesPrismaSchema(["prisma/schema.prisma", "src/a.ts"])).toBe(true);
    expect(touchesPrismaSchema(["./prisma\\schema.prisma"])).toBe(true);
    expect(touchesPrismaSchema(["src/lib/prisma.ts"])).toBe(false);
  });

  it("a conferência final regera o client ANTES do tsc", async () => {
    const ordem: string[] = [];
    await recheckFinalBuild("C:/p", {
      regenerate: async () => {
        ordem.push("generate");
        return "prisma generate";
      },
      verify: vi.fn(async () => {
        ordem.push("tsc");
        return { success: true, exitCode: 0, stdout: "", stderr: "", executionTimeMs: 1 };
      }),
      repair: vi.fn(),
    });
    expect(ordem).toEqual(["generate", "tsc"]);
  });
});
