import { describe, it, expect, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { SkillMiner } from "@/core/telemetry/skill-miner";
import { buildErrorSignature } from "@/core/telemetry/error-signature";

describe("buildErrorSignature", () => {
  it("normaliza caminhos de arquivo e números para agrupar o mesmo erro em execuções diferentes", () => {
    const a = buildErrorSignature(
      "type1",
      "[SYNTAX ERROR] Desbalanceamento de chaves ({ }) detectado em src/app/foo.ts (3 abertas, 2 fechadas)"
    );
    const b = buildErrorSignature(
      "type1",
      "[SYNTAX ERROR] Desbalanceamento de chaves ({ }) detectado em src/app/bar.tsx (7 abertas, 1 fechadas)"
    );

    expect(a).toBe(b);
  });

  it("gera assinaturas diferentes para categorias de erro diferentes", () => {
    const a = buildErrorSignature("type1", "[SYNTAX ERROR] algo");
    const b = buildErrorSignature("type2", "[SYNTAX ERROR] algo");
    expect(a).not.toBe(b);
  });
});

describe("SkillMiner.detectRecurringBugs", () => {
  // TelemetryLog é append-only (Trava T3): em vez de apagar os logs entre testes, cada teste
  // só considera o que ele mesmo gravou (janela `since`).
  // CandidateSkillProposal é compartilhada com outros arquivos de teste que rodam em paralelo no
  // mesmo SQLite (rotas de skills, mineração em plano de fundo após executar nós): limpeza e
  // asserções ficam restritas às assinaturas deste arquivo.
  // TelemetryLog é append-only e acumula entre execuções da suíte; a mineração em plano de fundo
  // de outros arquivos (sem janela `since`) chegava a criar a proposta destas assinaturas antes do
  // teste. Assinaturas únicas por execução eliminam essa colisão.
  const RUN_ID = `${process.pid}-${Date.now()}`;
  const SIG_RARE = `type2:erro raro ${RUN_ID}`;
  const SIG_RECURRING = `type2:divergência semântica recorrente ${RUN_ID}`;
  const SIG_BUILD = `build:mesmo erro de build ${RUN_ID}`;
  const OWN_SIGNATURES = [
    SIG_RARE,
    SIG_RECURRING,
    SIG_BUILD,
  ];
  const ownProposalsWhere = (signature?: string) => ({
    source: "bug_pattern",
    OR: (signature ? [signature] : OWN_SIGNATURES).map((s) => ({
      description: { contains: `Assinatura normalizada: ${s}` },
    })),
  });

  let since: Date;
  beforeEach(async () => {
    await prisma.candidateSkillProposal.deleteMany({ where: ownProposalsWhere() });
    since = new Date(Date.now() - 1);
  });

  it("não propõe nada quando a mesma assinatura de erro aparece abaixo do limiar", async () => {
    for (let i = 0; i < 2; i++) {
      await prisma.telemetryLog.create({
        data: {
          action: "AUDIT_REJECTED",
          details: JSON.stringify({ errorSignature: SIG_RARE, sample: "erro raro" }),
        },
      });
    }

    const result = await SkillMiner.detectRecurringBugs(3, since);
    expect(result).toBeNull();

    const proposals = await prisma.candidateSkillProposal.findMany({ where: ownProposalsWhere(SIG_RARE) });
    expect(proposals.length).toBe(0);
  });

  it("cria uma CandidateSkillProposal com source=bug_pattern quando a mesma assinatura se repete acima do limiar", async () => {
    for (let i = 0; i < 3; i++) {
      await prisma.telemetryLog.create({
        data: {
          action: "AUDIT_REJECTED",
          details: JSON.stringify({
            errorSignature: SIG_RECURRING,
            sample: `Falha na tentativa ${i}`,
          }),
        },
      });
    }

    const result = await SkillMiner.detectRecurringBugs(3, since);
    expect(result).not.toBeNull();

    const created = await prisma.candidateSkillProposal.findFirst({
      where: { name: result!.name },
    });
    expect(created).not.toBeNull();
    expect(created!.source).toBe("bug_pattern");
    expect(created!.status).toBe("pending");
    expect(created!.description).toContain("3x");
  });

  it("não duplica a proposta quando o mesmo padrão de bug já foi detectado antes", async () => {
    for (let i = 0; i < 3; i++) {
      await prisma.telemetryLog.create({
        data: {
          action: "EMPIRICAL_BUILD_FAILED",
          details: JSON.stringify({ errorSignature: SIG_BUILD, sample: "erro" }),
        },
      });
    }

    const first = await SkillMiner.detectRecurringBugs(3, since);
    expect(first).not.toBeNull();

    const second = await SkillMiner.detectRecurringBugs(3, since);
    expect(second).toBeNull();

    const proposals = await prisma.candidateSkillProposal.findMany({
      where: ownProposalsWhere(SIG_BUILD),
    });
    expect(proposals.length).toBe(1);
  });

  it("ignora logs de outras ações que não carregam errorSignature", async () => {
    for (let i = 0; i < 5; i++) {
      await prisma.telemetryLog.create({
        data: {
          action: "router.complexity_decision",
          details: JSON.stringify({ complexity: "fast" }),
        },
      });
    }

    const result = await SkillMiner.detectRecurringBugs(3, since);
    expect(result).toBeNull();
  });
});
