import { describe, expect, it } from "vitest";
import {
  appendOwnerDependency,
  decideCitedOwnerReopen,
  ownerReopenPrompt,
  priorReopensFromPayload,
  stripOwnerReopenAfterSuccess,
  withOwnerReopenHold,
  withOwnerReopenRequest,
  type StageFileOwner,
} from "@/core/orchestrator/owner-reopen";

const schema: StageFileOwner = {
  id: "etapa-1",
  title: "Etapa 1: schema",
  status: "completed",
  files: ["prisma/schema.prisma", "prisma/seed.ts"],
};

const apiKeys: StageFileOwner = {
  id: "etapa-4",
  title: "Etapa 4: api-keys",
  status: "failed",
  files: ["src/lib/api-keys.ts", "src/lib/precificacao.ts"],
};

function decide(
  rejection: string,
  extra?: Partial<{
    thisFiles: string[];
    stages: StageFileOwner[];
    prior: { ownerId: string; defectKey: string }[];
    thisStageId: string;
  }>
) {
  return decideCitedOwnerReopen({
    rejection,
    thisStageId: extra?.thisStageId ?? apiKeys.id,
    thisFiles: extra?.thisFiles ?? apiKeys.files,
    stages: extra?.stages ?? [schema, apiKeys],
    priorReopens: extra?.prior ?? [],
  });
}

describe("decideCitedOwnerReopen", () => {
  it("reabre a etapa concluída quando o crítico cita só o arquivo dela", () => {
    const decision = decide(
      "[critico] prisma/schema.prisma:40: model ApiKey não tem ultimoUsoEm. [importante] src/lib/api-keys.ts:8: o cast esconde o campo."
    );
    expect(decision.kind).toBe("reopen");
    if (decision.kind !== "reopen") return;
    expect(decision.ownerId).toBe(schema.id);
    expect(decision.citedFiles).toEqual(["prisma/schema.prisma"]);
    expect(decision.defectKey).toBe("prisma/schema.prisma");
  });

  it("campo ausente no modelo reabre o único dono do schema, mesmo citando o arquivo da etapa", () => {
    const decision = decide(
      "[critico] src/lib/api-keys.ts:65-70: O update grava ultimoUsoEm, campo que não existe no modelo ApiKey do schema. Acrescentar o campo ao schema."
    );
    expect(decision.kind).toBe("reopen");
    if (decision.kind !== "reopen") return;
    expect(decision.ownerId).toBe(schema.id);
    expect(decision.citedFiles).toEqual(["prisma/schema.prisma"]);
  });

  it("o crítico que nomeia prisma/schema.prisma sem a coluna reabre o dono", () => {
    const decision = decide(
      "[critico] src/lib/api-keys.ts:72-75: O update grava ultimoUsoEm, mas o modelo ApiKey em prisma/schema.prisma não tem essa coluna."
    );
    expect(decision.kind).toBe("reopen");
    if (decision.kind !== "reopen") return;
    expect(decision.defectKey).toBe("prisma/schema.prisma");
  });

  it("citação crítica no arquivo desta etapa fica nesta etapa", () => {
    const decision = decide(
      "[critico] src/app/api/lojista/onboarding/route.ts:56-62: derivarStatus ignora statusOnboarding. [importante] asaasSubcontaId não é asaasAccountId.",
      {
        thisStageId: "etapa-12",
        thisFiles: ["src/app/api/lojista/onboarding/route.ts"],
        stages: [
          schema,
          {
            id: "etapa-12",
            title: "Etapa 12",
            status: "failed",
            files: ["src/app/api/lojista/onboarding/route.ts"],
          },
        ],
      }
    );
    expect(decision).toEqual({ kind: "fix_here", reason: "in_scope" });
  });

  it("campo inventado com nome real na dependência fica nesta etapa", () => {
    const decision = decide(
      "[critico] src/app/api/lojista/onboarding/route.ts:176-185: O update grava asaasSubcontaId, e subcontas.ts usa só asaasAccountId. Esse campo provavelmente não existe no schema Prisma. Persistir apenas campos reais.",
      {
        thisStageId: "etapa-12",
        thisFiles: ["src/app/api/lojista/onboarding/route.ts"],
        stages: [
          schema,
          {
            id: "etapa-sub",
            title: "Subcontas",
            status: "completed",
            files: ["src/lib/asaas/subcontas.ts"],
          },
          {
            id: "etapa-12",
            title: "Etapa 12",
            status: "failed",
            files: ["src/app/api/lojista/onboarding/route.ts"],
          },
        ],
      }
    );
    expect(decision).toEqual({ kind: "fix_here", reason: "in_scope" });
  });

  it("crítico que aponta coluna ausente no schema reabre o dono junto com o arquivo da etapa", () => {
    const decision = decide(
      "[critico] src/lib/api-keys.ts:12: ultimoUsoEm. [critico] prisma/schema.prisma:40: coluna ausente."
    );
    expect(decision.kind).toBe("reopen");
    if (decision.kind !== "reopen") return;
    expect(decision.ownerId).toBe(schema.id);
  });

  it("a mesma cita, no mesmo dono, não reabre de novo", () => {
    const decision = decide("[critico] prisma/schema.prisma:40: coluna ausente.", {
      prior: [{ ownerId: schema.id, defectKey: "prisma/schema.prisma" }],
    });
    expect(decision).toEqual({ kind: "fix_here", reason: "already_reopened" });
  });

  it("dois donos para o mesmo final de arquivo não escolhem", () => {
    const decision = decide("[critico] route.ts:3: falta validação.", {
      thisStageId: "etapa-a",
      thisFiles: ["src/lib/nota.ts"],
      stages: [
        { id: "etapa-a", title: "A", status: "failed", files: ["src/lib/nota.ts"] },
        { id: "etapa-b", title: "B", status: "completed", files: ["src/app/api/a/route.ts"] },
        { id: "etapa-c", title: "C", status: "completed", files: ["src/app/api/b/route.ts"] },
      ],
    });
    expect(decision).toEqual({ kind: "fix_here", reason: "ambiguous_owner" });
  });

  it("dono que não está concluído não volta à fila", () => {
    const decision = decide("[critico] prisma/schema.prisma:4: campo ausente.", {
      stages: [{ ...schema, status: "blocked" }, apiKeys],
    });
    expect(decision).toEqual({ kind: "fix_here", reason: "owner_not_ready" });
  });

  it("campo ausente no tipo do Prisma reabre o dono do schema", () => {
    const decision = decide(
      "[SILENCIO] src/app/api/integracoes/webhook/route.ts:47 as any. [ESCONDIDO] Property 'webhookUrl' does not exist on type '{ id: string; }'. [ESCONDIDO] error TS2353: and 'webhookSecret' does not exist in type 'LojistaUpdateInput'."
    );
    expect(decision.kind).toBe("reopen");
    if (decision.kind !== "reopen") return;
    expect(decision.ownerId).toBe(schema.id);
    expect(decision.defectKey).toBe("prisma/schema.prisma|webhookSecret|webhookUrl");
  });

  it("cast do delegate sem propriedade ausente não reabre o schema", () => {
    const decision = decide(
      "[ESCONDIDO] error TS2352: Conversion of type 'LojistaDelegate<DefaultArgs>' to type '{ update: (args: { data: Record<string, unknown>; }) => Promise<unknown>; }' may be a mistake."
    );
    expect(decision).toEqual({ kind: "fix_here", reason: "no_critical" });
  });

  it("sem marca crítico não reabre", () => {
    const decision = decide("prisma/schema.prisma:40: coluna ausente.");
    expect(decision).toEqual({ kind: "fix_here", reason: "no_critical" });
  });
});

describe("payload da reabertura", () => {
  it("grava a espera, o pedido e a dependência sem apagar o resto", () => {
    const decision = decide("[critico] schema.prisma:2: falta o campo.");
    expect(decision.kind).toBe("reopen");
    if (decision.kind !== "reopen") return;

    const held = withOwnerReopenHold(JSON.stringify({ goal: "chaves" }), decision);
    expect(held).toBeTruthy();
    const parsed = JSON.parse(held || "{}");
    expect(parsed.goal).toBe("chaves");
    expect(priorReopensFromPayload(held)).toEqual([{ ownerId: schema.id, defectKey: "prisma/schema.prisma" }]);
    expect(parsed.esperaArquivoDono.ownerTitle).toBe(schema.title);

    const asked = withOwnerReopenRequest(JSON.stringify({ goal: "schema" }), {
      fromStageId: apiKeys.id,
      fromStageTitle: apiKeys.title,
      citedFiles: decision.citedFiles,
      defectKey: decision.defectKey,
      defectText: decision.defectText,
    });
    const prompt = ownerReopenPrompt(asked);
    expect(prompt).toContain("Acrescente só o que falta");
    expect(prompt).toContain("Mantenha o restante do arquivo");
    expect(prompt).toContain("prisma/schema.prisma");

    expect(appendOwnerDependency("[\"etapa-0\"]", schema.id)).toBe("[\"etapa-0\",\"etapa-1\"]");
    expect(appendOwnerDependency(`["${schema.id}"]`, schema.id)).toBe(`["${schema.id}"]`);

    const done = stripOwnerReopenAfterSuccess(asked);
    expect(done).toBeTruthy();
    expect(JSON.parse(done || "{}").reaberturaPedido).toBeUndefined();
    expect(JSON.parse(done || "{}").goal).toBe("schema");
    expect(stripOwnerReopenAfterSuccess(JSON.stringify({ goal: "schema" }))).toBeUndefined();
  });
});
