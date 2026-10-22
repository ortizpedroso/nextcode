import { describe, it, expect, afterAll } from "vitest";
import prisma from "../../src/lib/prisma.js";
import { buildDeliveryDiagnosis } from "../../src/core/orchestrator/delivery-diagnosis.js";
import { transition, initialContext } from "../../src/core/orchestrator/phase-machine.js";
import { humanActionText } from "../../src/core/orchestrator/human-notice.js";
import { authorizeRepairRound, isAuthorizeRoundCommand } from "../../src/core/orchestrator/session-resume.js";
import type { FinalDefect } from "../../src/core/governance/final-reviewer.js";

// Mudança 43.4 — fundador 22/10: o aviso "ajuste a Spec" depois das 3 rodadas invalidava a Spec e o trabalho.
const provado: FinalDefect = {
  req: "REQ-026",
  arquivo: "src/lib/cobrancas-service.ts",
  defeito: "revisão final: REQ-026 parcial — valida o pagador",
  prova: "reproduzido",
  teste: { caminho: "D2-contato.test.ts", conteudo: "x" },
  saida: "rejeita pagador sem contato: Error: promise resolved instead of rejecting\n at ...",
};
const tela: FinalDefect = { req: "REQ-033", arquivo: "src/app/pagar/[slug]/page.tsx", defeito: "revisão final: REQ-033 parcial — campo de valor", prova: "sem_prova" };
const esgotado = { tipo: "esgotado" as const, motivo: "**Reparo automático:** 3 rodada(s) gastas", todosComDono: true };

describe("43.4 — aviso montado com o diagnóstico", () => {
  it("rodadas gastas, só código com dona → REPARO_ESGOTADO: diz que a Spec está certa, mostra a prova e o progresso", () => {
    const d = buildDeliveryDiagnosis({ defeitos: [provado, tela], perguntasSpec: [], outrasLacunas: [], progresso: [15, 14, 5], reparo: esgotado });
    expect(d.evento).toBe("REPARO_ESGOTADO");
    expect(d.detalhe).toContain("A Spec está certa");
    expect(d.detalhe).toContain("teste `D2-contato.test.ts` falha: rejeita pagador sem contato");
    expect(d.detalhe).toContain("Defeitos de código sem teste");
    expect(d.detalhe).toContain("15 → 14 → 5");
  });

  it("pergunta de Spec junto com defeito de código → a rodada extra segue para o código e a pergunta fica listada", () => {
    const d = buildDeliveryDiagnosis({
      defeitos: [provado],
      perguntasSpec: ["REQ-035: com o whitelabel inativo, devolve a marca padrão ou os campos personalizados?"],
      outrasLacunas: [],
      progresso: [],
      reparo: esgotado,
    });
    expect(d.evento).toBe("REPARO_ESGOTADO");
    expect(d.detalhe).toContain("REQ-035: com o whitelabel inativo");
    expect(d.detalhe).toContain("O código pode seguir");
    expect(d.detalhe).not.toContain("A Spec está certa");
  });

  it("só pergunta de Spec (nenhum defeito de código) → VERIFICACAO_COM_LACUNAS com a pergunta exata", () => {
    const d = buildDeliveryDiagnosis({
      defeitos: [{ req: "REQ-035", arquivo: null, defeito: "revisão final: REQ-035 parcial", prova: "spec", pergunta: "marca padrão?" }],
      perguntasSpec: ["REQ-035: marca padrão?"],
      outrasLacunas: [],
      progresso: [],
      reparo: esgotado,
    });
    expect(d.evento).toBe("VERIFICACAO_COM_LACUNAS");
    expect(d.detalhe).toContain("A Spec precisa de resposta");
  });

  it("lacuna sem dona → VERIFICACAO_COM_LACUNAS (analista)", () => {
    const d = buildDeliveryDiagnosis({ defeitos: [], perguntasSpec: [], outrasLacunas: ["Verificação de tela reprovada (start)."], progresso: [], reparo: { tipo: "sem_dono", motivo: "**Dono:** analista" } });
    expect(d.evento).toBe("VERIFICACAO_COM_LACUNAS");
  });

  it("REPARO_ESGOTADO → BLOQUEADA com 'Autorizar mais uma rodada'", () => {
    const r = transition({ ...initialContext(), phase: "VERIFICACAO" }, { type: "REPARO_ESGOTADO" }, { etapa1Ativa: false });
    expect(r.ok && r.ctx.phase).toBe("BLOQUEADA");
    const aviso = r.ok ? r.effects.find((e) => e.type === "AVISAR_HUMANO") : undefined;
    expect(aviso && "acao" in aviso ? aviso.acao : null).toBe("autorizar_rodada");
    expect(humanActionText("autorizar_rodada")).toContain("Autorizar mais uma rodada");
    expect(humanActionText("autorizar_rodada")).toContain("a Spec está certa");
  });

  it("'autorizar rodada' sozinho no chat é o comando", () => {
    expect(isAuthorizeRoundCommand("autorizar rodada")).toBe(true);
    expect(isAuthorizeRoundCommand("Autorizar mais uma rodada!")).toBe(true);
    expect(isAuthorizeRoundCommand("autorizar rodada e mudar a tela")).toBe(false);
  });
});

describe("43.4 — autorizar mais uma rodada", () => {
  const created: string[] = [];
  afterAll(async () => {
    await prisma.job.deleteMany({ where: { sessionId: { in: created } } }).catch(() => {});
    await prisma.telemetryLog.deleteMany({ where: { sessionId: { in: created } } }).catch(() => {});
    await prisma.session.deleteMany({ where: { id: { in: created } } }).catch(() => {});
  });

  async function blockedBy(eventType: string) {
    const s = await prisma.session.create({
      data: { title: "Rodada", phase: "BLOQUEADA", phaseContext: JSON.stringify({ rodadasSemClareza: 0, voltasConferencia: 0, faseAntesDoBloqueio: "EXECUCAO" }) },
    });
    created.push(s.id);
    await prisma.telemetryLog.create({
      data: { sessionId: s.id, action: "PHASE_TRANSITION", details: JSON.stringify({ from: "VERIFICACAO", to: "BLOQUEADA", event: { type: eventType } }) },
    });
    return s;
  }

  it("bloqueio por rodadas gastas: registra a autorização, volta a EXECUCAO e põe na fila", async () => {
    const s = await blockedBy("REPARO_ESGOTADO");
    const r = await authorizeRepairRound(s.id, "chat");
    expect(r.ok).toBe(true);
    expect((await prisma.session.findUnique({ where: { id: s.id } }))?.phase).toBe("EXECUCAO");
    expect(await prisma.telemetryLog.count({ where: { sessionId: s.id, action: "REPAIR_ROUND_AUTHORIZED" } })).toBe(1);
    expect(await prisma.job.count({ where: { sessionId: s.id, status: "queued" } })).toBe(1);
  });

  it("bloqueio por outra causa: recusa sem mexer em nada", async () => {
    const s = await blockedBy("TETO_CUSTO");
    const r = await authorizeRepairRound(s.id, "painel");
    expect(r.ok).toBe(false);
    expect((await prisma.session.findUnique({ where: { id: s.id } }))?.phase).toBe("BLOQUEADA");
    expect(await prisma.telemetryLog.count({ where: { sessionId: s.id, action: "REPAIR_ROUND_AUTHORIZED" } })).toBe(0);
  });
});

describe("44 — entrega decidida pela prova", () => {
  it("provado e crítico reprovam; sem bancada (prova indefinida) reprova; só leitura vira ressalva; Spec à parte", async () => {
    const { splitDefectsByEvidence } = await import("../../src/core/orchestrator/delivery-diagnosis.js");
    const critico: FinalDefect = { arquivo: "src/lib/auth.ts", defeito: "revisão final [critico] src/lib/auth.ts:5: segredo fixo", prova: "sem_prova" };
    const semBancada: FinalDefect = { arquivo: "src/a.ts", defeito: "revisão final: REQ-001 parcial" };
    const spec: FinalDefect = { arquivo: null, defeito: "revisão final: REQ-035 parcial", prova: "spec", pergunta: "marca?" };
    const s = splitDefectsByEvidence([provado, tela, critico, semBancada, spec]);
    expect(s.bloqueiam).toEqual([provado, critico, semBancada]);
    expect(s.leitura).toEqual([tela]);
    expect(s.spec).toEqual([spec]);
    expect(splitDefectsByEvidence([tela]).bloqueiam).toEqual([]);
  });

  it("mensagem de entrega diz o que foi conferido, as ressalvas e as perguntas", async () => {
    const { buildDeliveryReport } = await import("../../src/core/orchestrator/delivery-diagnosis.js");
    const msg = buildDeliveryReport({
      reqs: ["REQ-001", "REQ-002"],
      revisaoFinal: ["REQ-001=implementado", "REQ-002=parcial"],
      telas: ["/login"],
      ressalvas: [tela],
      perguntasSpec: ["REQ-035: marca padrão?"],
    });
    expect(msg).toContain("Entrega concluída");
    expect(msg).toContain("1/2 REQ implementados");
    expect(msg).toContain("/login");
    expect(msg).toContain("Ressalvas");
    expect(msg).toContain("REQ-033");
    expect(msg).toContain("REQ-035: marca padrão?");
    expect(buildDeliveryReport({ reqs: ["REQ-001"], ressalvas: [], perguntasSpec: [] })).not.toContain("Ressalvas");
  });
});

describe("44 — problema importante acompanha o reparo e vira ressalva", () => {
  it("vira defeito de leitura sem repetir defeito já listado; sem etapa dona, não trava o plano", async () => {
    const { importantProblemsAsDefects } = await import("../../src/core/orchestrator/delivery-diagnosis.js");
    const { planDeliveryRepair } = await import("../../src/core/orchestrator/delivery-repair.js");
    const imp = importantProblemsAsDefects(
      [
        { severidade: "importante", arquivoLinha: "src/app/api/produtos/route.ts:7", descricao: "CARTAO não existe no enum → 500" },
        { severidade: "importante", arquivoLinha: "src/lib/cobrancas-service.ts:197", descricao: "já é defeito" },
        { severidade: "importante", arquivoLinha: "src/fora-do-plano.ts:1", descricao: "sem dona" },
        { severidade: "menor", arquivoLinha: "src/a.ts:1", descricao: "estilo" },
      ],
      [provado, { ...provado, defeito: "revisão final: REQ-052 parcial (src/lib/cobrancas-service.ts:197)" }]
    );
    expect(imp.map((d) => d.arquivo)).toEqual(["src/app/api/produtos/route.ts", "src/fora-do-plano.ts"]);
    expect(imp[0].prova).toBe("sem_prova");
    const dona = { id: "n1", title: "Etapa 1", role: "worker", status: "completed", filesScope: JSON.stringify(["src/app/api/produtos/route.ts"]), payload: "{}", createdAt: new Date() };
    const plan = planDeliveryRepair([dona as never], { missingFiles: [], unapprovedReqs: [], buildErrorLines: [], buildGapWithoutDetail: false, otherGaps: [], fileDefects: imp });
    expect(plan.semDono).toEqual([]);
    expect(plan.itens[0].defeitos).toHaveLength(1);
  });
});
